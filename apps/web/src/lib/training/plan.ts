import "server-only";

import type { Profile } from "@prisma/client";

import { isoFromDateColumn, toISODate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { parseCambiosDeBloque } from "@/lib/training/bloques";
import { parseDayBlocks } from "@/lib/training/bloques-dia";
import {
  loadCatalog,
  loadHistory,
  parseStoredPlan,
  plannedDatesOf,
  seRearma,
  toTrainingProfile,
} from "@/lib/training/db";
import { emphasisFor } from "@/lib/training/emphasis";
import { mondayOf, sundayEndOf } from "@/lib/training/generate";
import { armarPlanSemana, diasDelPlan, firmaDelPlan, type PlanDeSemana } from "@/lib/training/semana";

export type { DiaDelPlan, PlanDeSemana } from "@/lib/training/semana";

/**
 * `planDeSemana(userId, weekStart)` — la semana canónica de una persona (I1).
 *
 * Carga lo que la función pura necesita (perfil, catálogo, historial y el
 * énfasis del objetivo) y llama a `armarPlanSemana`, la MISMA que usa la
 * materialización. Es lo que consumen la vista previa del replanteo, el
 * rearmado tras el check-in y cualquier pantalla que necesite la semana antes
 * de que exista en `workouts`.
 *
 * `profile` permite planear con un perfil que todavía no se guarda (la vista
 * previa del replanteo). `conLoVivido` superpone lo que la materialización NO
 * rearmaría —días entrenados, empezados, recortados—, para que la vista
 * previa prometa exactamente lo que va a quedar.
 */
export async function planDeSemana(
  userId: string,
  weekStart: Date,
  opciones: { profile?: Profile; conLoVivido?: boolean; hoy?: Date } = {},
): Promise<PlanDeSemana> {
  const profile = opciones.profile ?? (await prisma.profile.findUniqueOrThrow({ where: { userId } }));
  const monday = mondayOf(weekStart);
  const training = toTrainingProfile(profile);
  const cambios = parseCambiosDeBloque(profile.blockOverrides);

  const [catalog, history, emphasis] = await Promise.all([
    loadCatalog(),
    loadHistory(userId, monday),
    emphasisFor(userId).catch(() => []),
  ]);

  const plan = armarPlanSemana({
    training,
    cambios,
    bloquesDelDia: parseDayBlocks(profile.dayBlocks),
    weekStart: monday,
    catalog,
    history,
    emphasis,
  });
  if (!opciones.conLoVivido) return plan;

  const existentes = await prisma.workout.findMany({
    where: { userId, date: { gte: monday, lte: sundayEndOf(monday) } },
    include: { _count: { select: { sets: true } } },
  });
  const contexto = {
    todayISO: toISODate(opciones.hoy ?? new Date()),
    planned: new Set(plannedDatesOf(profile, monday)),
    firma: firmaDelPlan(training),
    cambios,
  };
  const sobreviven = existentes.filter(
    (workout) => !seRearma({ ...workout, sets: workout._count.sets }, contexto),
  );
  const fechasVivas = new Set(sobreviven.map((workout) => isoFromDateColumn(workout.date)));

  const filas = [
    ...plan.workouts
      .filter((workout) => !fechasVivas.has(workout.date))
      .map((workout) => ({
        date: workout.date,
        dayKind: workout.dayKind,
        muscleGroup: workout.muscleGroup,
        ejercicios: workout.exercises.length,
        minutos: workout.estimatedMin ?? null,
        recortada: null,
      })),
    ...sobreviven.map((workout) => {
      const guardado = parseStoredPlan(workout.exercisesJson);
      return {
        date: isoFromDateColumn(workout.date),
        dayKind: guardado.dayKind,
        muscleGroup: workout.muscleGroup,
        ejercicios: guardado.exercises.length,
        minutos: guardado.estimatedMin,
        recortada: workout.trimmedMinutes,
      };
    }),
  ];

  return { ...plan, dias: diasDelPlan(plan.weekStart, filas, plan.otherSessions, training.timePerDay) };
}
