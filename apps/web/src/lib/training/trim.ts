import "server-only";

import type { Prisma, Profile, Workout } from "@prisma/client";

import { fromISODate, isoFromDateColumn } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { parseCambiosDeBloque } from "@/lib/training/bloques";
import { parseDayBlocks } from "@/lib/training/bloques-dia";
import { calentamientoPara } from "@/lib/training/calentamiento";
import { minutosDeSesion } from "@/lib/training/duracion";
import { mondayOf } from "@/lib/training/generate";
import {
  ensureWeekMaterialized,
  loadCatalog,
  loadHistory,
  parseStoredPlan,
  planGuardable,
  toTrainingProfile,
} from "@/lib/training/db";
import { armarPlanSemana, firmaDelPlan } from "@/lib/training/semana";
import type { DayKind, PlannedExercise } from "@/lib/training/types";

/**
 * "Hoy tengo menos tiempo": la sesión de un día se vuelve a armar para los
 * minutos que de verdad hay.
 *
 * No inventa nada nuevo. El generador ya decide cuántos ejercicios caben según
 * los minutos de sesión y ya sabe qué soltar primero —los huecos de prioridad
 * más baja, que son los accesorios— así que recortar es correr el mismo
 * generador con otro número de minutos y quedarse con el día que toca. Lo
 * compuesto se queda, el aislado se va: exactamente el orden que uno seguiría
 * con prisa.
 *
 * Dos reglas que la hacen segura:
 *
 * 1. **Lo hecho no se toca.** Una sesión cerrada no se recorta. Una empezada
 *    —aunque sea solo la serie de aproximación— sí: se quedan intactos los
 *    ejercicios hasta el último que tiene series (sus índices son los que
 *    apuntan las series capturadas) y se recorta solo lo pendiente. Antes
 *    lanzaba `SessionAlreadyStartedError` y "hoy tengo menos tiempo" no
 *    hacía nada justo cuando más se necesita: ya en el gimnasio.
 * 2. **Queda marcada.** `trimmedMinutes` guarda a cuántos minutos se recortó,
 *    para que la retro del check-in pueda decir "entrenaste, con menos tiempo"
 *    en vez de contarlo como sesión incompleta. Tres semanas recortando los
 *    mismos días no es falta de disciplina: es que el horario declarado no es
 *    el horario real, y la respuesta correcta es mover el día.
 */

export class SessionNotFoundError extends Error {
  constructor() {
    super("No existe esa sesión.");
    this.name = "SessionNotFoundError";
  }
}

export class SessionAlreadyStartedError extends Error {
  constructor() {
    super("Esa sesión ya está cerrada: lo entrenado no se recorta.");
    this.name = "SessionAlreadyStartedError";
  }
}

/** Piso y techo de lo que tiene sentido pedir. */
export const MIN_TRIM_MINUTES = 10;
export const MAX_TRIM_MINUTES = 180;

export type TrimResult = {
  workoutId: string;
  date: string;
  muscleGroup: string;
  minutes: number;
  /** Cuántos ejercicios quedaron y cuántos había antes. */
  exercises: number;
  removed: number;
};

/**
 * Lo que queda de la sesión con los minutos nuevos, sin mover lo ya empezado.
 *
 * Puro. `hechos` es cuántos ejercicios del principio ya tienen series: esos se
 * quedan tal cual y en su lugar (las series capturadas apuntan a su índice).
 * Lo pendiente sale del plan recortado, en su orden, mientras quepa.
 */
export function recortarPendiente(
  anterior: PlannedExercise[],
  recortado: PlannedExercise[],
  hechos: number,
  minutos: number,
  warmupSeg: number,
  /** Recortar aunque no haya nada empezado (días sin plan de dónde rearmarse). */
  forzar = false,
): PlannedExercise[] {
  if (hechos <= 0 && !forzar) return recortado;

  const intactos = anterior.slice(0, hechos);
  const nombres = new Set(intactos.map((exercise) => exercise.name));
  const salida = [...intactos];
  for (const exercise of recortado) {
    if (nombres.has(exercise.name)) continue;
    if (salida.length > 0 && minutosDeSesion([...salida, exercise], warmupSeg) > minutos) break;
    salida.push(exercise);
  }
  return salida;
}

/**
 * La sesión a recortar: por id y, si ese id ya no existe, por `(userId, fecha)`.
 *
 * O1 — una app con la semana de antes en memoria manda un id que un rearmado
 * viejo (antes de que los ids fueran estables) o un cambio de bloque ya
 * reemplazó. La fecha es lo que la persona está mirando: "hoy". Si la semana
 * de esa fecha no está materializada todavía, se materializa primero.
 */
async function sesionDe(userId: string, profile: Profile, workoutId: string, fecha?: string) {
  const include = { sets: { select: { exerciseName: true, clientId: true } } } as const;
  const porId = await prisma.workout.findFirst({ where: { id: workoutId, userId }, include });
  if (porId || !fecha) return porId;

  const date = fromISODate(fecha);
  await ensureWeekMaterialized(userId, profile, date);
  return prisma.workout.findUnique({ where: { userId_date: { userId, date } }, include });
}

/**
 * Rearma UN día con los minutos dados (`null` = los del plan), desde la misma
 * semana canónica que la materialización (`armarPlanSemana`).
 */
async function rearmarDia(
  userId: string,
  profile: Profile,
  workoutId: string,
  minutes: number | null,
  fecha?: string,
): Promise<TrimResult & { trimmed: number | null }> {
  const workout = await sesionDe(userId, profile, workoutId, fecha);
  if (!workout) throw new SessionNotFoundError();
  if (workout.completedAt !== null) throw new SessionAlreadyStartedError();

  const anterior = parseStoredPlan(workout.exercisesJson);
  const date = isoFromDateColumn(workout.date);
  // Desde la fecha ISO, no desde la columna: `workout.date` es medianoche UTC
  // y en CDMX eso todavía es el día anterior — un lunes caía en la semana
  // pasada y el recorte no encontraba su día.
  const monday = mondayOf(fromISODate(date));

  const [catalog, history] = await Promise.all([loadCatalog(), loadHistory(userId, monday)]);
  const training = toTrainingProfile(profile);

  // La semana de siempre, con los minutos de HOY para este día. Antes se
  // cambiaba `sessionMinutes`, y un día con cardio después seguía armándose
  // con sus 70 min: el recorte salía idéntico a la sesión original.
  const semana = armarPlanSemana({
    training,
    cambios: parseCambiosDeBloque(profile.blockOverrides),
    bloquesDelDia: parseDayBlocks(profile.dayBlocks),
    weekStart: monday,
    catalog,
    history,
    ...(minutes !== null ? { minutosGymPorFecha: { [date]: minutes } } : {}),
  });

  const delPlan = semana.workouts.find((candidate) => candidate.date === date);
  const warmup = anterior.warmup ?? calentamientoPara((delPlan?.dayKind ?? anterior.dayKind) as DayKind);
  const tope = minutes ?? delPlan?.estimatedMin ?? Number.POSITIVE_INFINITY;

  // Hasta el último ejercicio con series, intacto. El índice sale del
  // `clientId` (`{workout}:{índice}:{serie}`) y, si no, del nombre.
  const indices = workout.sets.map((set) => {
    const porClave = Number(set.clientId?.split(":")[1]);
    return Number.isInteger(porClave) ? porClave : anterior.exercises.findIndex((e) => e.name === set.exerciseName);
  });
  const hechos = indices.length > 0 ? Math.max(...indices) + 1 : 0;

  // Un día que no es del plan (se cambió a pesas a mano) no tiene de dónde
  // rearmarse: se recorta su propia lista, que ya está en orden de prioridad.
  const base = delPlan?.exercises ?? anterior.exercises;
  const exercises =
    delPlan && hechos === 0
      ? base
      : recortarPendiente(anterior.exercises, base, hechos, tope, warmup.totalSeg, !delPlan);

  await prisma.workout.update({
    where: { id: workout.id },
    data: {
      trimmedMinutes: minutes,
      exercisesJson: planGuardable(
        {
          dayKind: delPlan?.dayKind ?? anterior.dayKind,
          schemeLabel: delPlan?.schemeLabel ?? anterior.schemeLabel,
          cardioMinutes: delPlan?.cardioMinutes ?? anterior.cardioMinutes,
          estimatedMin: minutosDeSesion(exercises, warmup.totalSeg),
          warmup,
          exercises,
        },
        firmaDelPlan(training),
      ) as Prisma.InputJsonValue,
    },
  });

  return {
    workoutId: workout.id,
    date,
    muscleGroup: delPlan?.muscleGroup ?? workout.muscleGroup,
    minutes: minutes ?? Math.round(minutosDeSesion(exercises, warmup.totalSeg)),
    exercises: exercises.length,
    removed: Math.max(0, anterior.exercises.length - exercises.length),
    trimmed: minutes,
  };
}

export async function trimSession(
  userId: string,
  profile: Profile,
  workoutId: string,
  minutes: number,
  /** `YYYY-MM-DD` del día: respaldo si el id ya no existe (O1). */
  fecha?: string,
): Promise<TrimResult> {
  const { trimmed: _trimmed, ...resultado } = await rearmarDia(userId, profile, workoutId, minutes, fecha);
  return resultado;
}

/** Deshace el recorte: la sesión vuelve a lo que dice el plan para ese día. */
export async function restoreSession(
  userId: string,
  profile: Profile,
  workoutId: string,
  fecha?: string,
): Promise<TrimResult> {
  const { trimmed: _trimmed, ...resultado } = await rearmarDia(userId, profile, workoutId, null, fecha);
  return resultado;
}

/** Para las vistas: los minutos del recorte, o `null` si está completa. */
export function trimmedMinutesOf(workout: Pick<Workout, "trimmedMinutes">): number | null {
  return workout.trimmedMinutes;
}
