import "server-only";

import { cycleNoteForProfile } from "@/lib/cycle";
import type { Profile } from "@prisma/client";

import { isoFromDateColumn, toISODate } from "@/lib/format";
import { readinessNote } from "@/lib/health/activity";
import { sleepMinutesFor } from "@/lib/health/db";
import { prisma } from "@/lib/prisma";
import { signedExerciseVideoUrls } from "@/lib/storage";
import type { OtherSession } from "@/lib/training/disciplines";
import { diasDelPlan, type DiaDelPlan } from "@/lib/training/semana";
import {
  ensureWeekMaterialized,
  otherPlanFor,
  otherSessionsFor,
  lastPerformances,
  loadCatalog,
  parseStoredPlan,
  personalRecords,
  toTrainingProfile,
  type PersonalRecord,
} from "@/lib/training/db";
import {
  tendenciaSemanal,
  type SemanaDeEjercicio,
  type SerieComparada,
} from "@/lib/training/progreso";
import { alternativesFor, type ExerciseAlternative } from "@/lib/training/substitutes";
import { mondayOf, sundayEndOf } from "@/lib/training/generate";
import { prefillSets } from "@/lib/training/progression";
import { SCHEMES } from "@/lib/training/schemes";
import type { PlannedExercise, Warmup } from "@/lib/training/types";

/**
 * Lo que el modo gimnasio necesita para funcionar sin red: la semana entera,
 * ya resuelta. Se guarda tal cual en IndexedDB, así que aquí no puede quedar
 * nada que dependa del servidor para pintarse.
 */

export type SessionExerciseView = PlannedExercise & {
  /** URL firmada del video. Caduca; sin red la pantalla se pinta igual. */
  videoUrl: string | null;
  /** Último peso registrado en ese ejercicio, para prellenar. */
  lastWeightKg: number | null;
  /** El mejor peso histórico: la vara del PR. */
  bestWeightKg: number | null;
  /** El récord con su contexto: peso × reps y cuándo fue. */
  record: PersonalRecord | null;
  /**
   * A qué se puede cambiar si la máquina está ocupada. Viaja con la semana
   * (y por lo tanto a IndexedDB) para que el cambio funcione sin señal.
   */
  alternatives: ExerciseAlternative[];
};

export type SessionView = {
  workoutId: string;
  date: string;
  muscleGroup: string;
  scheme: string;
  schemeLabel: string;
  cardioMinutes: number | null;
  /**
   * Minutos estimados de la sesión, calentamiento incluido (Fase 3). `null`
   * en sesiones materializadas antes — la cabecera simplemente no lo enseña.
   */
  estimatedMin: number | null;
  completedAt: string | null;
  /** Minutos a los que se recortó la sesión, o `null` si está completa. */
  trimmedMinutes: number | null;
  cycleNote: string | null;
  /**
   * Nota de readiness (Fase 8): si el reloj registró menos de 6 h de sueño
   * anoche, se dice. **Las cargas no se tocan solas**: es una sugerencia, y la
   * decisión sigue siendo de quien tiene la barra en las manos.
   */
  readinessNote: string | null;
  /**
   * Calentamiento dinámico previo al primer ejercicio. `null` en sesiones
   * materializadas antes de esta fase — la app simplemente no lo enseña.
   */
  warmup: Warmup | null;
  exercises: SessionExerciseView[];
};

export type WeekView = {
  weekStart: string;
  today: string;
  sessions: SessionView[];
  /**
   * Las sesiones de las otras disciplinas activas (Fase 7). Viajan con la
   * semana para que la app las pinte sin otra llamada — y para que la de
   * natación se pueda leer en la orilla de la alberca, sin señal.
   */
  otherSessions: OtherSession[];
  /**
   * Lo que estorba en el split y no se puede arreglar sin decidir: hombro el
   * día antes de pecho, pierna pesada antes de squash. Solo aparecen cuando
   * el split lo fijó ella — el automático se reordena solo. Ajustes los pinta
   * tal cual, porque cada uno termina en la acción ("Cambiar").
   */
  avisos: string[];
  /**
   * La semana día por día en el formato que comparten Rutinas, Ajustes "Tu
   * semana", el Resumen y Hoy (I1): "LUN · Pierna · cuádriceps · 6 ejercicios
   * · + Cardio HIIT 20 min". Sale de las sesiones materializadas —que ya son
   * la semana canónica— y de las mismas disciplinas que `otherSessions`.
   */
  plan: DiaDelPlan[];
};

/**
 * Semana completa de entrenamiento, materializándola si es la primera vez que
 * se abre en la semana.
 */
export async function weekView(
  userId: string,
  profile: Profile,
  reference: Date,
): Promise<WeekView> {
  const workouts = await ensureWeekMaterialized(userId, profile, reference);
  const plans = workouts.map((workout) => ({
    workout,
    plan: parseStoredPlan(workout.exercisesJson),
  }));

  const allExercises = plans.flatMap((entry) => entry.plan.exercises);
  const names = [...new Set(allExercises.map((exercise) => exercise.name))];

  const today = toISODate(reference);

  const [videos, records, last, catalog, sleepMin] = await Promise.all([
    signedExerciseVideoUrls(allExercises.map((exercise) => exercise.videoPath)).catch(() => ({})),
    personalRecords(userId, names),
    lastPerformances(
      userId,
      mondayOf(reference),
      allExercises.map((exercise) => ({ id: exercise.exerciseId, name: exercise.name })),
    ),
    loadCatalog().catch(() => []),
    // Sin datos del reloj no hay nota, y el gimnasio abre igual.
    sleepMinutesFor(userId, today).catch(() => null),
  ]);

  const sessions = plans.map(({ workout, plan }): SessionView => {
    const date = isoFromDateColumn(workout.date);

    return {
      workoutId: workout.id,
      date,
      muscleGroup: workout.muscleGroup,
      scheme: workout.scheme,
      schemeLabel: plan.schemeLabel,
      cardioMinutes: plan.cardioMinutes,
      estimatedMin: plan.estimatedMin,
      completedAt: workout.completedAt ? workout.completedAt.toISOString() : null,
      trimmedMinutes: workout.trimmedMinutes,
      cycleNote: cycleNoteForProfile(profile, date),
      // El sueño de anoche solo habla de la sesión de hoy.
      readinessNote: date === today ? readinessNote(sleepMin) : null,
      warmup: plan.warmup,
      exercises: plan.exercises.map((exercise) => {
        const previous = last[exercise.name] ?? null;
        const scheme = SCHEMES[exercise.scheme] ?? SCHEMES.PIRAMIDAL;

        return {
          ...exercise,
          // El plan pudo materializarse sin historial: aquí ya lo hay, así que
          // se rellena serie a serie con la rampa del esquema.
          sets: prefillSets(exercise, scheme, exercise.sets, previous),
          videoUrl: exercise.videoPath
            ? ((videos as Record<string, string>)[exercise.videoPath] ?? null)
            : null,
          lastWeightKg: previous?.topWeightKg ?? null,
          bestWeightKg: records[exercise.name]?.weightKg ?? null,
          record: records[exercise.name] ?? null,
          // Los ejercicios del plan, no solo sus nombres: la exclusión por id
          // es la que evita ofrecer uno que ya está en la sesión guardado con
          // otro nombre que el del catálogo.
          alternatives: alternativesFor(exercise, catalog, plan.exercises),
        };
      }),
    };
  });

  const disciplinas = otherPlanFor(profile, mondayOf(reference), workouts);
  const weekStart = toISODate(mondayOf(reference));

  return {
    weekStart,
    today: toISODate(reference),
    sessions,
    otherSessions: disciplinas.sessions,
    // El split avisa vecindad ("hombro antes de pecho"); las disciplinas
    // avisan lo que no cupo o lo que se combinó con riesgo (Fase 9 y 11). Los
    // dos salen del mismo esqueleto de la semana (I1) — una sola lista para
    // que Ajustes no tenga que saber de dos fuentes.
    avisos: disciplinas.avisos,
    plan: planVisible(weekStart, workouts, disciplinas.sessions, profile),
  };
}

/** Las sesiones materializadas, en el formato común de la semana (`diasDelPlan`). */
function planVisible(
  weekStart: string,
  workouts: Array<{ date: Date; muscleGroup: string; exercisesJson: unknown; trimmedMinutes: number | null }>,
  otras: OtherSession[],
  profile: Profile,
): DiaDelPlan[] {
  return diasDelPlan(
    weekStart,
    workouts.map((workout) => {
      const plan = parseStoredPlan(workout.exercisesJson as never);
      return {
        date: isoFromDateColumn(workout.date),
        dayKind: plan.dayKind,
        muscleGroup: workout.muscleGroup,
        ejercicios: plan.exercises.length,
        minutos: plan.estimatedMin,
        recortada: workout.trimmedMinutes,
      };
    }),
    otras,
    toTrainingProfile(profile).timePerDay,
  );
}

/**
 * El día de hoy en el formato común de la semana, para la pantalla de Hoy:
 * la misma línea que Rutinas y el Resumen ("+ Cardio HIIT 20 min" incluido).
 */
export async function todayPlan(userId: string, profile: Profile, reference: Date): Promise<DiaDelPlan | null> {
  const workouts = await ensureWeekMaterialized(userId, profile, reference);
  const monday = mondayOf(reference);
  const { sessions } = otherPlanFor(profile, monday, workouts);
  const iso = toISODate(reference);
  return planVisible(toISODate(monday), workouts, sessions, profile).find((dia) => dia.date === iso) ?? null;
}

/** La sesión de hoy, o null si hoy toca descanso. */
export function sessionOf(week: WeekView, isoDate: string): SessionView | null {
  return week.sessions.find((session) => session.date === isoDate) ?? null;
}

export type TodayCard = {
  workoutId: string;
  muscleGroup: string;
  schemeLabel: string;
  exerciseCount: number;
  cardioMinutes: number | null;
  completed: boolean;
  /** Minutos a los que se recortó la sesión, o `null` si está completa. */
  trimmedMinutes: number | null;
};

/**
 * Lo mínimo para la tarjeta "Hoy" del home: sin firmar videos ni cargar el
 * historial completo. Materializa la semana si es la primera visita.
 */
export async function todayCard(
  userId: string,
  profile: Profile,
  reference: Date,
): Promise<TodayCard | null> {
  const workouts = await ensureWeekMaterialized(userId, profile, reference);
  const iso = toISODate(reference);
  const workout = workouts.find((row) => isoFromDateColumn(row.date) === iso);
  if (!workout) return null;

  const plan = parseStoredPlan(workout.exercisesJson);
  return {
    workoutId: workout.id,
    muscleGroup: workout.muscleGroup,
    schemeLabel: plan.schemeLabel,
    exerciseCount: plan.exercises.length,
    cardioMinutes: plan.cardioMinutes,
    completed: workout.completedAt !== null,
    trimmedMinutes: workout.trimmedMinutes,
  };
}

/**
 * La sesión de otra disciplina que toca hoy, si hay.
 *
 * Vive aparte de `todayCard` porque son dos preguntas distintas: "¿qué me toca
 * en el gimnasio?" y "¿qué más tengo hoy?". Un día puede tener las dos, una, o
 * ninguna — y la pantalla necesita distinguirlo para no decir "descanso"
 * cuando en realidad toca alberca.
 */
export async function todayOtherSession(
  userId: string,
  profile: Profile,
  reference: Date,
): Promise<OtherSession | null> {
  const workouts = await ensureWeekMaterialized(userId, profile, reference);
  const iso = toISODate(reference);
  const sessions = otherSessionsFor(profile, mondayOf(reference), workouts);
  return sessions.find((session) => session.date === iso) ?? null;
}

export type TrainingHistoryRow = {
  workoutId: string;
  date: string;
  muscleGroup: string;
  volumeKg: number;
  sets: number;
  prs: Array<{ exerciseName: string; weightKg: number }>;
  completed: boolean;
};

/** Últimas sesiones entrenadas, para el historial. */
export async function trainingHistory(userId: string, take = 12): Promise<TrainingHistoryRow[]> {
  const rows = await prisma.workout.findMany({
    where: { userId, completedAt: { not: null } },
    orderBy: { date: "desc" },
    take,
    include: { sets: { where: { warmup: false } } },
  });

  return rows.map((row) => {
    const loads =
      row.loadsJson !== null && typeof row.loadsJson === "object" && !Array.isArray(row.loadsJson)
        ? (row.loadsJson as Record<string, unknown>)
        : {};

    const volumeFromSets = row.sets.reduce(
      (total, set) => total + Number(set.weightKg ?? 0) * set.reps,
      0,
    );

    const prsRaw = Array.isArray(loads.prs) ? loads.prs : [];

    return {
      workoutId: row.id,
      date: isoFromDateColumn(row.date),
      muscleGroup: row.muscleGroup,
      volumeKg: typeof loads.volumeKg === "number" ? loads.volumeKg : Math.round(volumeFromSets),
      sets: row.sets.length,
      prs: prsRaw.map((raw) => {
        const pr = raw as Record<string, unknown>;
        return { exerciseName: String(pr.exerciseName ?? ""), weightKg: Number(pr.weightKg ?? 0) };
      }),
      completed: true,
    };
  });
}

/**
 * Los récords vigentes por ejercicio, del más pesado al más ligero.
 *
 * Es lo que la sección de récords del historial marca: peso × reps y la fecha
 * en que ocurrió. Sale de `workout_sets`, no del resumen de la sesión, así que
 * sobrevive aunque `loads_json` se haya escrito antes de que existieran los PRs.
 */
export async function personalRecordList(userId: string, take = 8): Promise<PersonalRecord[]> {
  const records = await personalRecords(userId);

  return Object.values(records)
    .sort(
      (a, b) =>
        b.weightKg - a.weightKg ||
        b.reps - a.reps ||
        a.exerciseName.localeCompare(b.exerciseName, "es"),
    )
    .slice(0, take);
}

/** Rango de la semana ISO de `date`, para consultas. */
export function weekRange(date: Date): { from: Date; to: Date } {
  return { from: mondayOf(date), to: sundayEndOf(date) };
}

export type { PersonalRecord, SemanaDeEjercicio, SerieComparada };

/**
 * El detalle de UNA sesión, serie por serie, con el plan al lado.
 *
 * El historial contestaba "5 series · 4,200 kg" y ahí se acababa. La pregunta
 * de después de entrenar es otra: cuál serie se quedó corta y en qué
 * ejercicio. El objetivo ya vivía en `WorkoutSet.targetReps`; el peso planeado
 * sale del plan guardado (`exercisesJson`), que es donde está.
 */
export type SessionDetailView = {
  workoutId: string;
  date: string;
  muscleGroup: string;
  completedAt: string | null;
  /** Minutos estimados del plan, si la sesión se armó con la Fase 3 en pie. */
  estimatedMin: number | null;
  ejercicios: Array<{
    name: string;
    series: SerieComparada[];
  }>;
};

export async function sessionDetail(
  userId: string,
  workoutId: string,
): Promise<SessionDetailView | null> {
  const workout = await prisma.workout.findFirst({
    where: { id: workoutId, userId },
    include: { sets: { orderBy: { setIndex: "asc" } } },
  });
  if (!workout) return null;

  const plan = parseStoredPlan(workout.exercisesJson);

  // El plan se indexa por nombre: es lo que sobrevive a un cambio de
  // ejercicio a media sesión (`exerciseName` se guarda con la serie justo
  // por eso) y a que el catálogo cambie después.
  const planPorNombre = new Map(plan.exercises.map((exercise) => [exercise.name, exercise]));

  const porEjercicio = new Map<string, SerieComparada[]>();
  for (const set of workout.sets) {
    const planeado = planPorNombre.get(set.exerciseName)?.sets[set.setIndex];
    const fila: SerieComparada = {
      exerciseName: set.exerciseName,
      setIndex: set.setIndex,
      targetReps: set.targetReps,
      targetWeightKg: planeado?.weightKg ?? null,
      reps: set.reps,
      weightKg: set.weightKg === null ? null : Number(set.weightKg),
      rpe: set.rpe,
      warmup: set.warmup,
      side: planeado?.side ?? null,
      intensity: planeado?.intensity ?? null,
    };
    porEjercicio.set(set.exerciseName, [...(porEjercicio.get(set.exerciseName) ?? []), fila]);
  }

  // El orden de la sesión manda: primero los ejercicios del plan, y al final
  // los que se hayan capturado fuera de él (una sustitución vieja, por ejemplo).
  const nombresDelPlan = plan.exercises.map((exercise) => exercise.name);
  const extras = [...porEjercicio.keys()].filter((name) => !nombresDelPlan.includes(name));

  return {
    workoutId: workout.id,
    date: isoFromDateColumn(workout.date),
    muscleGroup: workout.muscleGroup,
    completedAt: workout.completedAt ? workout.completedAt.toISOString() : null,
    estimatedMin: plan.estimatedMin,
    ejercicios: [...nombresDelPlan, ...extras]
      .map((name) => ({ name, series: porEjercicio.get(name) ?? [] }))
      .filter((entrada) => entrada.series.length > 0),
  };
}

export type ExerciseProgressView = {
  exerciseId: string;
  name: string;
  semanas: SemanaDeEjercicio[];
  /** El récord vigente, para tener contra qué leer la tendencia. */
  record: PersonalRecord | null;
};

/**
 * La tendencia semanal de un ejercicio: peso tope y volumen.
 *
 * Se lee por semana y no por sesión a propósito — ver `tendenciaSemanal`.
 */
export async function exerciseProgress(
  userId: string,
  exerciseId: string,
): Promise<ExerciseProgressView | null> {
  const exercise = await prisma.exercise.findUnique({
    where: { id: exerciseId },
    select: { id: true, name: true },
  });
  if (!exercise) return null;

  const sets = await prisma.workoutSet.findMany({
    where: { exerciseId, workout: { userId } },
    select: { reps: true, weightKg: true, warmup: true, workout: { select: { date: true } } },
    orderBy: { performedAt: "asc" },
  });

  const records = await personalRecords(userId, [exercise.name]);

  return {
    exerciseId: exercise.id,
    name: exercise.name,
    semanas: tendenciaSemanal(
      sets.map((set) => ({
        date: isoFromDateColumn(set.workout.date),
        reps: set.reps,
        weightKg: set.weightKg === null ? null : Number(set.weightKg),
        warmup: set.warmup,
      })),
    ),
    record: records[exercise.name] ?? null,
  };
}
