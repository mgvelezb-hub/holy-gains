import "server-only";

import type { Profile, Workout } from "@prisma/client";

import { goalStatusFor, type GoalStatus } from "@/lib/coachy/goal";
import type { FotosMensuales } from "@/lib/coachy/mensual";
import { fromISODate, isoFromDateColumn, shiftISODate, toISODate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { ensureWeekMaterialized } from "@/lib/training/db";
import { emphasisFor } from "@/lib/training/emphasis";
import { mondayOf } from "@/lib/training/generate";
import { planDeSemana } from "@/lib/training/plan";
import type { MuscleGroup } from "@/lib/training/types";

/**
 * Lo que se rehace después de un check-in, fuera del motor.
 *
 * El motor ya decidió los números; aquí se materializa "el plan de aquí en
 * adelante" que no depende de él: la lectura de fotos contra la referencia y
 * la rutina de lo que queda de esta semana y la siguiente.
 */

/** El estado de "Rumbo a tu objetivo" como lo guarda el bloque mensual. */
export function fotosDe(status: GoalStatus | null): FotosMensuales | null {
  if (status === null) return null;
  if (status.state === "listo") return { estado: "listo", zonas: status.readings };
  return { estado: status.state, zonas: [] };
}

/**
 * La lectura contra la referencia al cerrar el check-in.
 *
 * En el mensual se fuerza (sin esperar la quincena); en el semanal respeta su
 * cadencia de 14 días. Nunca lanza: sin referencia, sin visión o sin llave,
 * regresa el estado que lo dice, y un error de red regresa `null`.
 */
export async function lecturaDelObjetivo(
  userId: string,
  profile: Profile,
  esMensual: boolean,
): Promise<GoalStatus | null> {
  return goalStatusFor(userId, profile, new Date().toISOString(), { force: esMensual }).catch(
    (error: unknown) => {
      console.error("[coachy] no se pudo leer el objetivo tras el check-in", error);
      return null;
    },
  );
}

export interface RutinaRearmada {
  /** Sesiones de pesas que quedaron planeadas de hoy al domingo siguiente. */
  sesiones: number;
  /** Grupos con volumen extra por el objetivo (vacío si no hay lectura). */
  prioridad: MuscleGroup[];
}

/**
 * Rearma lo no entrenado de esta semana y arma la siguiente.
 *
 * I1: sale de `planDeSemana`, la misma semana canónica que ven Rutinas, el
 * Resumen y el replanteo — no de un camino propio. Por ahí entra todo lo que
 * el check-in pudo mover: el objetivo y la fase (el perfil se vuelve a leer:
 * el que llega aquí es de ANTES del análisis, y una fase nueva cambia el
 * volumen), las zonas lejos de la referencia (el énfasis, del caché que
 * `lecturaDelObjetivo` acaba de refrescar) y las preferencias (split,
 * ejercicios a mano, disciplinas, cardio). Un día con series o completado no
 * se toca.
 */
export async function rearmaRutina(userId: string, profile: Profile): Promise<RutinaRearmada> {
  const hoyISO = toISODate(new Date());
  const hoy = fromISODate(hoyISO);
  const lunesSiguiente = fromISODate(shiftISODate(toISODate(mondayOf(hoy)), 7));

  const fresco = (await prisma.profile.findUnique({ where: { userId } })) ?? profile;

  const semanas: Workout[] = [];
  for (const referencia of [hoy, lunesSiguiente]) {
    const plan = await planDeSemana(userId, referencia, { profile: fresco });
    semanas.push(...(await ensureWeekMaterialized(userId, fresco, referencia, { force: true, plan })));
  }

  const pendientes = semanas.filter(
    (workout) => isoFromDateColumn(workout.date) >= hoyISO && workout.completedAt === null,
  );

  return {
    sesiones: pendientes.length,
    prioridad: await emphasisFor(userId).catch(() => []),
  };
}
