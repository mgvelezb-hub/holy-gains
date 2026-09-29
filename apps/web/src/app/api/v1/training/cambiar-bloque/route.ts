import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { generateWeek, mondayOf, sundayEndOf } from "@/lib/training/generate";
import { conCambio, parseCambiosDeBloque } from "@/lib/training/bloques";
import {
  ensureWeekMaterialized,
  loadCatalog,
  loadHistory,
  planGuardable,
  toTrainingProfile,
} from "@/lib/training/db";
import { firmaDelPlan } from "@/lib/training/semana";
import { prisma } from "@/lib/prisma";
import { DISCIPLINES } from "@/lib/training/types";

/**
 * `POST /api/v1/training/cambiar-bloque` — "hoy no pude ir a squash, dame gym".
 *
 * Pasa todo el tiempo: la cancha ocupada, la alberca cerrada, la lluvia. Antes
 * la salida era no entrenar —y que el día contara como falla— o registrar una
 * sesión libre a mano, que deja sin rutina que seguir. Aquí el bloque de ESE
 * día cambia de disciplina y, si se cambia a pesas, la sesión de gimnasio se
 * materializa completa: split, ejercicios y pesos, como cualquier otra.
 *
 * `discipline` también acepta un arreglo de una o dos disciplinas (Fase 11):
 * "hoy solo squash / natación, sin gym" desde Rutinas. Ese día no hay gimnasio
 * — si ya había una sesión materializada (por ejemplo, un cambio previo a
 * pesas), se borra, siempre que no esté ya entrenada.
 *
 * Es una excepción de fecha, no un cambio de plan: el plan se cambia en
 * Ajustes. Por eso se guarda por día y se olvida a las tres semanas.
 *
 * Lo que NO hace: tocar días pasados con sesión ya registrada. Un día
 * entrenado es historia.
 */

export const dynamic = "force-dynamic";

const schema = z.object({
  /** ISO `YYYY-MM-DD`. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  discipline: z.union([
    z.enum(DISCIPLINES),
    z
      .array(z.enum(DISCIPLINES))
      .min(1)
      .max(2)
      .refine((items) => !items.includes("PESAS"), "PESAS no va en el arreglo: significa 'sin gym'.")
      .refine((items) => new Set(items).size === items.length, "disciplinas repetidas"),
  ]),
});

export async function POST(request: Request): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  if (!user.profile) {
    return NextResponse.json({ error: "onboarding incompleto" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "cuerpo inválido" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "cambio inválido" }, { status: 422 });
  }

  const { date, discipline } = parsed.data;
  const hoy = new Date();
  const hoyISO = hoy.toISOString().slice(0, 10);

  if (date < hoyISO) {
    return NextResponse.json(
      { error: "Ese día ya pasó. Lo que se entrenó es historia y no se reescribe." },
      { status: 422 },
    );
  }

  const cambios = conCambio(parseCambiosDeBloque(user.profile.blockOverrides), date, discipline, hoyISO);

  await prisma.profile.update({
    where: { userId: user.id },
    data: { blockOverrides: cambios as unknown as Prisma.InputJsonValue },
  });

  // Cambiar a pesas es el caso que hay que construir: la sesión de gimnasio no
  // existe todavía para ese día porque el plan no lo tenía como día de pesas.
  let sesionCreada = false;
  if (discipline === "PESAS") {
    sesionCreada = await materializaGimnasioEn(user.id, date);
  } else if (Array.isArray(discipline)) {
    // "Hoy solo squash / natación, sin gym": si ya había una sesión de
    // gimnasio materializada ese día (un cambio anterior a PESAS, o un día
    // que ya era de pesas), deja de serlo. No se toca si ya se entrenó.
    await borraGimnasioSinEntrenarEn(user.id, date);
  }

  return NextResponse.json({ date, discipline, sesionCreada });
}

/**
 * Quita la sesión de gimnasio de un día que se acaba de decir que ya NO es de
 * gimnasio. Solo si nadie la entrenó — un día entrenado es historia, la misma
 * regla que ya vale para no tocar el pasado.
 */
async function borraGimnasioSinEntrenarEn(userId: string, dateISO: string): Promise<void> {
  const fecha = new Date(`${dateISO}T12:00:00`);
  await prisma.workout.deleteMany({ where: { userId, date: fecha, completedAt: null, sets: { none: {} } } });
}

/**
 * Crea la sesión de gimnasio de un día que el plan no tenía como día de pesas.
 *
 * Se genera la semana con el perfil "como si" ese día fuera de gimnasio, y se
 * toma solo ese día: así el split, el esquema de la semana y los pesos
 * sugeridos salen del mismo motor que el resto, en vez de una rutina
 * improvisada aparte.
 *
 * Si ya hay sesión ese día no se toca nada: dos sesiones de gimnasio el mismo
 * día no es lo que se pidió.
 */
async function materializaGimnasioEn(userId: string, dateISO: string): Promise<boolean> {
  const fecha = new Date(`${dateISO}T12:00:00`);

  const yaHay = await prisma.workout.findFirst({
    where: { userId, date: fecha },
    select: { id: true },
  });
  if (yaHay) return false;

  const profile = await prisma.profile.findUniqueOrThrow({ where: { userId } });
  const monday = mondayOf(fecha);

  // Primero la semana normal: sin esto, generar "una más" sobre una semana que
  // todavía no existe crearía la sesión suelta y dejaría el resto sin armar.
  await ensureWeekMaterialized(userId, profile, fecha);

  const [catalog, history] = await Promise.all([loadCatalog(), loadHistory(userId, monday)]);

  const base = toTrainingProfile(profile);
  const dia = ["LUN", "MAR", "MIE", "JUE", "VIE", "SAB", "DOM"][
    (fecha.getDay() + 6) % 7
  ] as string;

  const semana = generateWeek(
    {
      ...base,
      // Un día más de gimnasio, y ese día marcado como entrenable: es la única
      // forma de que el generador le asigne un split.
      liftingDays: base.liftingDays + 1,
      trainingSchedule: { ...(base.trainingSchedule ?? {}), [dia]: "TARDE" },
      // I1: un día con 0 min declarados nunca tiene gimnasio. Aquí la persona
      // acaba de pedirlo para ESE día, así que ese día sí tiene tiempo.
      ...(base.timePerDay && !base.timePerDay[dia as keyof typeof base.timePerDay]
        ? { timePerDay: { ...base.timePerDay, [dia]: base.sessionMinutes } }
        : {}),
    },
    history,
    { weekStart: monday, catalog, emphasis: [] },
  );

  const plan = semana.workouts.find((workout) => workout.date === dateISO);
  if (!plan) return false;

  await prisma.workout.create({
    data: {
      userId,
      date: fecha,
      muscleGroup: plan.muscleGroup,
      scheme: plan.scheme,
      // Completo (con calentamiento): sin él, la siguiente reconciliación lo
      // leía como plan viejo. Y el día queda protegido por el cambio a pesas.
      exercisesJson: planGuardable(plan, firmaDelPlan(base)),
    },
  });

  return true;
}
