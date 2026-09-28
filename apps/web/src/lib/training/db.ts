import "server-only";

import type { Phase, Prisma, Profile, Workout } from "@prisma/client";

import { fromISODate, isoFromDateColumn, shiftISODate, toISODate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { parseCambiosDeBloque } from "@/lib/training/bloques";
import { parsePreferenciasCardio } from "@/lib/training/cargas-schema";
import { parseDayBlocks } from "@/lib/training/bloques-dia";
import { emphasisFor } from "@/lib/training/emphasis";
import type { OtherSession } from "@/lib/training/disciplines";
import { esqueletoDeSemana } from "@/lib/training/esqueleto";
import { mondayOf, sundayEndOf } from "@/lib/training/generate";
import { esUnilateral } from "@/lib/training/coach";
import { SCHEME_PREFERENCES } from "@/lib/training/schemes";
import { armarPlanSemana, completarSesiones, firmaDelPlan, type PlanDeSemana } from "@/lib/training/semana";
import {
  DAY_KIND_VALUES,
  WEEK_DAYS,
  normalizeCustomSplit,
  type WeekDay,
} from "@/lib/training/split";
import { lastPerformance, type LastPerformance } from "@/lib/training/progression";
import { DISCIPLINES, MUSCLE_GROUPS } from "@/lib/training/types";
import type {
  DayKind,
  Discipline,
  DisciplineLoad,
  ExerciseOption,
  HistorySet,
  HistoryWorkout,
  MuscleGroup,
  PlannedExercise,
  Proposito,
  TargetSet,
  SchemePreference,
  SwimLevel,
  Tempo,
  TrainingProfile,
  UnilateralMode,
  VolumeBias,
  Warmup,
  WarmupStep,
} from "@/lib/training/types";

/** Mismos valores que `PROPOSITOS` en `replan.ts`, para validar el JSON crudo. */
const PROPOSITOS: readonly Proposito[] = ["ENTRENAMIENTO", "COMPLEMENTO", "HOBBY"];

/**
 * Traduce la fase de la dieta (`Phase`, del motor de nutrición) al único dato
 * que el generador de rutinas necesita de ella: cuánto volumen meter.
 *
 * Esta función es **la única frontera** entre nutrición y entrenamiento — el
 * resto de `training/` no importa `Phase` ni conoce sus 7 valores (ver
 * `VolumeBias` en `types.ts`). Si mañana aparece un segundo método de
 * nutrición (con otras fases, o sin fases), aquí es el único lugar que se
 * toca: se agrega el `if`/`switch` que corresponda y todo lo demás sigue
 * igual.
 *
 * Hoy la única regla real es la de siempre: en corte agresivo se recorta un
 * ejercicio por sesión.
 */
export function volumeBiasForPhase(phase: Phase): VolumeBias {
  return phase === "CUT_AGRESIVO" ? "reducido" : "normal";
}

/**
 * `other_disciplines` es JSON libre en la base: lo que llegue mal formado se
 * ignora en vez de tumbar la rutina de la semana. Una preferencia corrupta no
 * puede dejar a nadie sin entrenar.
 *
 * `discipline` y `sessionsPerWeek` siguen siendo obligatorios — sin ellos la
 * entrada entera no dice nada útil y se descarta. `proposito`, `importancia`
 * y `modo` (Fase 11) son **tolerantes campo por campo**: una entrada vieja
 * que no los trae sigue siendo válida sin ellos, y un valor fuera de rango
 * (`importancia: 7`, un `proposito` o `modo` que no existe) tira solo ese
 * campo, no la entrada — la persona no se queda sin su disciplina activa por
 * un dato corrupto en un campo que ni siquiera pidió.
 */
export function parseDisciplineLoads(raw: unknown): DisciplineLoad[] {
  if (!Array.isArray(raw)) return [];

  const loads: DisciplineLoad[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const { discipline, sessionsPerWeek, proposito, importancia, modo, cardio } = entry as Record<
      string,
      unknown
    >;
    if (typeof discipline !== "string") continue;
    if (!(DISCIPLINES as readonly string[]).includes(discipline)) continue;
    if (typeof sessionsPerWeek !== "number" || !Number.isFinite(sessionsPerWeek)) continue;

    const load: DisciplineLoad = {
      discipline: discipline as Discipline,
      sessionsPerWeek: Math.max(0, Math.min(7, Math.trunc(sessionsPerWeek))),
    };

    if (typeof proposito === "string" && (PROPOSITOS as readonly string[]).includes(proposito)) {
      load.proposito = proposito as Proposito;
    }
    if (
      typeof importancia === "number" &&
      Number.isFinite(importancia) &&
      Number.isInteger(importancia) &&
      importancia >= 1 &&
      importancia <= 3
    ) {
      load.importancia = importancia;
    }
    if (modo === "DESPUES" || modo === "DIA_PROPIO") {
      load.modo = modo;
    }
    if (discipline === "CARDIO") {
      const prefs = parsePreferenciasCardio(cardio);
      if (prefs) load.cardio = prefs;
    }

    loads.push(load);
  }
  return loads;
}

/** Los días de la semana que entiende el generador. Igual que `WEEK_DAYS` de `split.ts`. */
const DIAS: readonly WeekDay[] = ["LUN", "MAR", "MIE", "JUE", "VIE", "SAB", "DOM"];

/**
 * `time_per_day` es JSON libre en la base, igual que `other_disciplines`:
 * tolerante campo por campo. Una llave que no es un día conocido se ignora,
 * un valor fuera de 0-300 se clampa en vez de tirar el día entero, y si no
 * queda ninguna llave usable se devuelve `null` — igual que "no se ha
 * declarado", que es el estado que hace que el planificador use sus defaults.
 */
export function parseTimePerDay(raw: unknown): Partial<Record<WeekDay, number>> | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;

  const result: Partial<Record<WeekDay, number>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(DIAS as readonly string[]).includes(key)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    result[key as WeekDay] = Math.max(0, Math.min(300, Math.trunc(value)));
  }

  return Object.keys(result).length > 0 ? result : null;
}

/** Las etiquetas de grupo que el generador entiende; el resto se descarta. */
function parseMuscleGroups(raw: string[]): MuscleGroup[] {
  return raw.filter((group): group is MuscleGroup =>
    (MUSCLE_GROUPS as readonly string[]).includes(group),
  );
}

/** El perfil de Prisma, aplanado a lo que el generador necesita. */
/** El `Json` del perfil, sin confiar en su forma. */
function parseExerciseSwaps(json: unknown): Record<string, string> {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return {};
  const salida: Record<string, string> = {};
  for (const [original, reemplazo] of Object.entries(json as Record<string, unknown>)) {
    if (typeof reemplazo === "string" && reemplazo.length > 0) salida[original] = reemplazo;
  }
  return salida;
}

/**
 * Los ejercicios elegidos a mano, por tipo de día.
 *
 * Tolerante llave por llave, igual que `exercise_swaps`: un `DayKind` que ya
 * no existe o una lista con basura adentro se ignoran, no dejan a nadie sin
 * rutina. Los ids no se validan contra el catálogo aquí —eso lo hace el
 * generador, que es quien lo tiene cargado— porque un ejercicio retirado del
 * catálogo no debe borrar los demás de la lista.
 */
export function parseManualExercises(json: unknown): Partial<Record<DayKind, string[]>> {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return {};

  const salida: Partial<Record<DayKind, string[]>> = {};
  for (const [dia, lista] of Object.entries(json as Record<string, unknown>)) {
    if (!(DAY_KIND_VALUES as readonly string[]).includes(dia)) continue;
    if (!Array.isArray(lista)) continue;

    const ids = [
      ...new Set(lista.filter((id): id is string => typeof id === "string" && id.length > 0)),
    ];
    if (ids.length > 0) salida[dia as DayKind] = ids;
  }
  return salida;
}

/**
 * `scheme_preference` es `TEXT` libre en la base, no un enum de Postgres
 * (ver el docblock del campo en `schema.prisma`): tolerante igual que
 * `other_disciplines` o `time_per_day` — un valor que ya no existe (una
 * migración vieja, un dato corrupto) cae a `RECOMENDADO` en vez de tumbar la
 * generación de la semana.
 */
export function parseSchemePreference(raw: string): SchemePreference {
  return (SCHEME_PREFERENCES as readonly string[]).includes(raw)
    ? (raw as SchemePreference)
    : "RECOMENDADO";
}

export function toTrainingProfile(profile: Profile): TrainingProfile {
  const schedule =
    profile.trainingSchedule !== null &&
    typeof profile.trainingSchedule === "object" &&
    !Array.isArray(profile.trainingSchedule)
      ? (profile.trainingSchedule as Record<string, string>)
      : null;

  return {
    liftingDays: profile.liftingDays,
    trainingSchedule: schedule,
    conditions: profile.conditions,
    volumeBias: volumeBiasForPhase(profile.currentPhase),
    sessionMinutes: profile.sessionMinutes,
    cardioMinWk: profile.cardioMinWk,
    avoidRepeatGroups: parseMuscleGroups(profile.avoidRepeatGroups),
    primaryDiscipline: profile.primaryDiscipline as Discipline,
    // Lo que ya cambió con sus manos: el generador deja de proponer el que
    // rechazó mientras el reemplazo siga cabiendo en ese hueco.
    exerciseSwaps: parseExerciseSwaps(profile.exerciseSwaps),
    otherDisciplines: parseDisciplineLoads(profile.otherDisciplines),
    disciplineLevels: parseNiveles(profile.disciplineLevels, profile.swimLevel as SwimLevel),
    gymLevel: parseNiveles(profile.disciplineLevels, profile.swimLevel as SwimLevel).PESAS ?? "PRINCIPIANTE",
    goal: profile.goal,
    timePerDay: parseTimePerDay(profile.timePerDay),
    compactDays: profile.compactDays,
    schemePreference: parseSchemePreference(profile.schemePreference),
    // El split que ella fijó. `normalizeCustomSplit` tolera JSON viejo o
    // corrupto llave por llave: un día mal escrito no puede dejarla sin
    // semana.
    customSplit: normalizeCustomSplit(profile.customSplit),
    unilateralMode: parseUnilateralMode(profile.customSplit),
    // Lo que ella eligió con sus manos por tipo de día. Vacío = sugerencia de
    // Coachy, que es el default de toda la vida.
    manualExercises: parseManualExercises(profile.manualExercises),
  };
}

/**
 * Los niveles declarados por disciplina.
 *
 * `swimLevel` sigue siendo el respaldo de natación: existía antes de que el
 * nivel fuera por disciplina, y quien ya lo había elegido no tiene por qué
 * volver a hacerlo.
 */
export function parseNiveles(
  raw: unknown,
  swimLevel: SwimLevel,
): Partial<Record<Discipline, SwimLevel>> {
  const niveles: Partial<Record<Discipline, SwimLevel>> = { NATACION: swimLevel };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return niveles;

  for (const [clave, valor] of Object.entries(raw as Record<string, unknown>)) {
    if (!(DISCIPLINES as readonly string[]).includes(clave)) continue;
    if (valor !== "PRINCIPIANTE" && valor !== "INTERMEDIO" && valor !== "AVANZADO") continue;
    niveles[clave as Discipline] = valor;
  }
  return niveles;
}

export async function loadCatalog(): Promise<ExerciseOption[]> {
  const rows = await prisma.exercise.findMany({ orderBy: { name: "asc" } });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    muscleGroup: row.muscleGroup,
    poolRole: row.poolRole,
    videoUrl: row.videoUrl,
    isTracker: row.isTracker,
    substitutes: row.substitutes,
    level: row.level,
    equipment: row.equipment,
    // `exercises` no tiene columna `unilateral` y el schema está congelado en
    // esta fase: se deduce aquí, una sola vez, para que el generador y la
    // biblioteca vean lo mismo. Ver `esUnilateral` en `coach.ts`.
    unilateral: esUnilateral(row),
  }));
}

/** Sesiones anteriores con sus series, para progresión y para no repetirse. */
export async function loadHistory(
  userId: string,
  before: Date,
  weeks = 8,
): Promise<HistoryWorkout[]> {
  const from = new Date(before);
  from.setDate(from.getDate() - weeks * 7);

  const rows = await prisma.workout.findMany({
    where: { userId, date: { gte: from, lt: before } },
    include: { sets: true },
    orderBy: { date: "asc" },
  });

  return rows.map((row) => ({
    date: isoFromDateColumn(row.date),
    exerciseNames: parseStoredPlan(row.exercisesJson).exercises.map((exercise) => exercise.name),
    sets: row.sets.map(
      (set): HistorySet => ({
        exerciseId: set.exerciseId,
        exerciseName: set.exerciseName,
        setIndex: set.setIndex,
        targetReps: set.targetReps,
        reps: set.reps,
        weightKg: set.weightKg === null ? null : Number(set.weightKg),
        rpe: set.rpe,
        warmup: set.warmup,
      }),
    ),
  }));
}

/**
 * Cómo se hacen los unilaterales, guardado DENTRO de `custom_split`.
 *
 * No hay columna para esto y el schema está congelado en esta fase, así que
 * viaja como una llave reservada del JSON del split (`_unilateral`), que es el
 * único JSON del perfil que habla de cómo se arma el entrenamiento.
 * `normalizeCustomSplit` ignora todo lo que no sea un día de la semana, así
 * que la llave no puede ensuciar el split; cuando haya columna, este parser se
 * queda como respaldo de los perfiles ya guardados.
 */
export function parseUnilateralMode(raw: unknown): UnilateralMode {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return "SEGUIDO";
  const valor = (raw as Record<string, unknown>)._unilateral;
  return valor === "ALTERNADO" ? "ALTERNADO" : "SEGUIDO";
}

/** El tempo tal como se guardó. Cualquier cosa que no sean tres números se ignora. */
function parseTempo(raw: unknown): Tempo | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { ecc, pause, con } = raw as Record<string, unknown>;
  if (typeof ecc !== "number" || typeof pause !== "number" || typeof con !== "number") return null;
  return { ecc, pause, con };
}

export type StoredPlan = {
  dayKind: string;
  schemeLabel: string;
  cardioMinutes: number | null;
  /** Minutos estimados de la sesión. `null` en planes anteriores a la Fase 3. */
  estimatedMin: number | null;
  /**
   * El calentamiento dinámico previo a la sesión. `null` en sesiones que ya
   * estaban guardadas ANTES de esta fase (el generador de entonces no lo
   * escribía) — la app simplemente no lo enseña, nada truena.
   */
  warmup: Warmup | null;
  exercises: PlannedExercise[];
  /**
   * La huella de las preferencias con que se armó (`firmaDelPlan`, I1).
   * `null` en filas de antes: se rearman una vez si nadie las ha tocado.
   */
  firma: string | null;
};

/**
 * `row.warmup` → el calentamiento tipado, o `null` si no viene, viene
 * corrupto, o no trae ni un paso utilizable. Tolerante igual que
 * `other_disciplines` o `time_per_day`: un dato mal formado no puede tumbar
 * la sesión, solo hace que la app no enseñe el bloque.
 */
function parseWarmup(raw: unknown): Warmup | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;

  const row = raw as Record<string, unknown>;
  if (!Array.isArray(row.pasos)) return null;

  const pasos: WarmupStep[] = [];
  for (const rawPaso of row.pasos) {
    if (rawPaso === null || typeof rawPaso !== "object") continue;
    const paso = rawPaso as Record<string, unknown>;
    if (typeof paso.nombre !== "string" || typeof paso.segundos !== "number") continue;
    pasos.push({ nombre: paso.nombre, segundos: paso.segundos });
  }
  if (pasos.length === 0) return null;

  const totalSeg =
    typeof row.totalSeg === "number"
      ? row.totalSeg
      : pasos.reduce((total, paso) => total + paso.segundos, 0);

  return { pasos, totalSeg };
}

/**
 * `exercises_json` → el plan tipado.
 *
 * Acepta las dos formas: el objeto que escribe el generador y un array pelón
 * (cómo se veía la columna antes de la Fase 4).
 */
export function parseStoredPlan(json: Prisma.JsonValue): StoredPlan {
  if (Array.isArray(json)) {
    return {
      dayKind: "",
      schemeLabel: "",
      cardioMinutes: null,
      estimatedMin: null,
      warmup: null,
      exercises: parsePlan(json),
      firma: null,
    };
  }
  if (json === null || typeof json !== "object") {
    return {
      dayKind: "",
      schemeLabel: "",
      cardioMinutes: null,
      estimatedMin: null,
      warmup: null,
      exercises: [],
      firma: null,
    };
  }

  const row = json as Record<string, unknown>;
  return {
    dayKind: String(row.dayKind ?? ""),
    schemeLabel: String(row.schemeLabel ?? ""),
    cardioMinutes: typeof row.cardioMinutes === "number" ? row.cardioMinutes : null,
    estimatedMin: typeof row.estimatedMin === "number" ? row.estimatedMin : null,
    warmup: parseWarmup(row.warmup),
    exercises: parsePlan((row.exercises ?? []) as Prisma.JsonValue),
    firma: typeof row.firma === "string" ? row.firma : null,
  };
}

/** La lista de ejercicios del plan, tolerando filas viejas o a medias. */
export function parsePlan(json: Prisma.JsonValue): PlannedExercise[] {
  if (!Array.isArray(json)) return [];

  return json.map((raw) => {
    const row = raw as Record<string, unknown>;
    const sets = Array.isArray(row.sets) ? row.sets : [];

    return {
      exerciseId: typeof row.exerciseId === "string" ? row.exerciseId : null,
      name: String(row.name ?? ""),
      muscleGroup: String(row.muscleGroup ?? ""),
      poolRole: String(row.poolRole ?? ""),
      scheme: String(row.scheme ?? "PIRAMIDAL") as PlannedExercise["scheme"],
      schemeLabel: String(row.schemeLabel ?? ""),
      restSeconds: Number(row.restSeconds ?? 45),
      videoPath: typeof row.videoPath === "string" ? row.videoPath : null,
      tracker: row.tracker === true,
      note: typeof row.note === "string" ? row.note : null,
      // Los planes viejos no traen minutos ni lados: se dejan ausentes y la
      // app se pinta igual, que es lo que hace segura una columna JSON.
      ...(typeof row.estimatedMin === "number" ? { estimatedMin: row.estimatedMin } : {}),
      ...(row.unilateral === true ? { unilateral: true } : {}),
      sets: sets.map((rawSet): TargetSet => {
        const set = rawSet as Record<string, unknown>;
        return {
          reps: Number(set.reps ?? 0),
          weightKg: typeof set.weightKg === "number" ? set.weightKg : null,
          warmup: set.warmup === true,
          ...(parseTempo(set.tempo) ? { tempo: parseTempo(set.tempo)! } : {}),
          ...(set.intensity === "fallo" || set.intensity === "dropset"
            ? { intensity: set.intensity }
            : {}),
          ...(set.side === "IZQ" || set.side === "DER" || set.side === "AMBOS"
            ? { side: set.side }
            : {}),
        };
      }),
    };
  });
}

/**
 * Las fechas ISO de gimnasio de esa semana.
 *
 * Aplica el presupuesto semanal, igual que el generador: si hay disciplinas
 * activas, los días que se llevan NO son días de pesas. Sin esto, la
 * reconciliación dejaría vivos los días que el presupuesto ya no paga.
 */
export function plannedDatesOf(profile: Profile, monday: Date): string[] {
  const mondayISO = toISODate(monday);
  // El mismo esqueleto que usa el generador (I1): antes aquí se repetía
  // "horario → presupuesto → split" a mano, y bastaba un detalle distinto
  // para que la reconciliación borrara lo que el generador acababa de crear.
  const { days } = esqueletoDeSemana(toTrainingProfile(profile), monday);
  const cambios = parseCambiosDeBloque(profile.blockOverrides);
  return days
    .map((day) => shiftISODate(mondayISO, WEEK_DAYS.indexOf(day)))
    // "Hoy solo squash / natación, sin gym" (Fase 11): ese día no es de pesas.
    .filter((date) => !Array.isArray(cambios[date]));
}

/**
 * Las sesiones de las otras disciplinas de la semana.
 *
 * Se recalculan a partir de la semana de pesas ya materializada en vez de
 * guardarse: son sugerencias de día con su plan, no filas que alguien vaya a
 * editar. Lo que sí queda registrado es lo que se hizo, y eso vive en
 * `ActivitySession`.
 *
 * **Por qué esto no diverge de lo que ya se generó.** Desde I1 no hay dos
 * caminos: el generador (`ensureWeekMaterialized`) y esta función leen el
 * MISMO `esqueletoDeSemana(toTrainingProfile(profile), monday)` —días, split
 * y disciplinas con los minutos que el gym cede—. Antes esta leía el `dayKind`
 * ya guardado y bastaba una fila vieja para que la vista y la semana
 * materializada contaran semanas distintas.
 */
export type OtherPlan = {
  sessions: OtherSession[];
  /**
   * Lo que `planDisciplines` no pudo colocar en ningún lado (Fase 9) más lo
   * que la Fase 11 avisa cuando una combinación explícita (`modo: 'DESPUES'`)
   * se aceptó con riesgo. Nunca vacío en silencio.
   */
  avisos: string[];
};

export function otherPlanFor(
  profile: Profile,
  monday: Date,
  workouts: Array<{ date: Date; exercisesJson: Prisma.JsonValue }>,
): OtherPlan {
  const mondayISO = toISODate(monday);
  const training = toTrainingProfile(profile);

  // I1: las disciplinas salen del MISMO esqueleto que el generador —no de los
  // `dayKind` guardados—, así que los minutos que el gym le cede al cardio
  // aquí son los mismos con los que se materializó la sesión.
  const esqueleto = esqueletoDeSemana(training, monday);

  // Días con gimnasio para los bloques agregados el día: los del plan más los
  // que se materializaron por un cambio de bloque a pesas.
  const conGimnasio = new Set<WeekDay>(esqueleto.days);
  for (const workout of workouts) {
    const iso = isoFromDateColumn(workout.date);
    const index = WEEK_DAYS.findIndex((_, position) => shiftISODate(mondayISO, position) === iso);
    if (index !== -1) conGimnasio.add(WEEK_DAYS[index]!);
  }

  const sessions = completarSesiones({
    planeadas: esqueleto.disciplines.sessions,
    cambios: parseCambiosDeBloque(profile.blockOverrides),
    bloquesDelDia: parseDayBlocks(profile.dayBlocks),
    monday,
    training,
    isoWeek: esqueleto.isoWeek,
    diasConGimnasio: WEEK_DAYS.filter((day) => conGimnasio.has(day)),
  });

  return { sessions, avisos: esqueleto.avisos };
}

/** Las sesiones de las otras disciplinas de la semana, sin los avisos.
 *
 * Se recalculan a partir de la semana de pesas ya materializada en vez de
 * guardarse: son sugerencias de día con su plan, no filas que alguien vaya a
 * editar. Lo que sí queda registrado es lo que se hizo, y eso vive en
 * `ActivitySession`.
 *
 * **Por qué esto no diverge de lo que ya se generó.** Sale de `otherPlanFor`,
 * que lee el mismo esqueleto que el generador (I1).
 */
export function otherSessionsFor(
  profile: Profile,
  monday: Date,
  workouts: Array<{ date: Date; exercisesJson: Prisma.JsonValue }>,
): OtherSession[] {
  return otherPlanFor(profile, monday, workouts).sessions;
}

/**
 * Materializa la semana en `workouts`, y la RECONCILIA con el perfil de hoy.
 *
 * Corre a demanda: la primera vez que la atleta abre `/app` o el modo gimnasio
 * en la semana. No hay cron que dependa de que alguien esté despierto un lunes
 * a las 6am, y volver a llamarla no duplica nada — `(user_id, date)` es único.
 *
 * Reconciliar es lo que arregla el hueco de "cambié mis días y la semana se
 * quedó como estaba": si el perfil pasa de 4 a 5 días a media semana, el día
 * que falta se genera aquí mismo. Nada de lo ya vivido se toca — solo se
 * BORRAN los días que el horario nuevo ya no pide, y únicamente si están de
 * hoy en adelante, sin series capturadas y sin completar. Un día entrenado es
 * historia, y la historia no se reescribe.
 */
export interface EnsureWeekOptions {
  /**
   * Rearma TODO lo que no se ha entrenado de hoy en adelante, aunque el
   * horario no haya cambiado. Lo usa el cierre del check-in: con la semana
   * cerrada hay historial nuevo (cargas, progresión) y quizá una lectura
   * nueva del objetivo, y el plan de aquí en adelante tiene que salir de
   * eso. Lo ya vivido sigue intocable: un día con series o completado no se
   * borra nunca, con o sin `force`.
   */
  force?: boolean;
  /**
   * La semana ya planeada por `planDeSemana` (I1): quien ya la tiene —el
   * rearmado tras el check-in— la pasa y no se vuelve a calcular. Tiene que
   * ser de la misma semana y del mismo perfil; si no, se ignora.
   */
  plan?: PlanDeSemana;
}

/**
 * ¿Esta fila se rearma? La misma regla para la materialización y para la
 * vista previa del replanteo (que tiene que prometer lo que después queda).
 *
 * Solo se rearma lo que nadie ha tocado: de hoy en adelante, sin series y sin
 * cerrar. Y dentro de eso, lo que ya no corresponde al plan: un día que el
 * plan ya no pide, un plan de antes del calentamiento o —I1— uno armado con
 * otras preferencias (`firma`). Lo que la persona decidió para ESE día
 * (recortarlo, cambiarlo a pesas) no se pisa por un cambio de preferencias.
 */
export function seRearma(
  workout: { date: Date; completedAt: Date | null; trimmedMinutes: number | null; exercisesJson: Prisma.JsonValue; sets: number },
  contexto: { todayISO: string; planned: Set<string>; firma: string; cambios: ReturnType<typeof parseCambiosDeBloque>; force?: boolean },
): boolean {
  const date = isoFromDateColumn(workout.date);
  const intocado = date >= contexto.todayISO && workout.completedAt === null && workout.sets === 0;
  if (!intocado) return false;
  if (contexto.force) return true;

  const aPesas = contexto.cambios[date] === "PESAS";
  if (!contexto.planned.has(date)) return !aPesas;

  // Decisión del día: se respeta hasta que cambie el plan de fechas.
  if (workout.trimmedMinutes !== null || aPesas) return false;

  const guardado = parseStoredPlan(workout.exercisesJson);
  return guardado.warmup === null || guardado.firma !== contexto.firma;
}

export async function ensureWeekMaterialized(
  userId: string,
  profile: Profile,
  reference: Date,
  options: EnsureWeekOptions = {},
): Promise<Workout[]> {
  const monday = mondayOf(reference);
  const sunday = sundayEndOf(reference);

  const existing = await prisma.workout.findMany({
    where: { userId, date: { gte: monday, lte: sunday } },
    orderBy: { date: "asc" },
    include: { _count: { select: { sets: true } } },
  });

  const training = toTrainingProfile(profile);
  const planned = plannedDatesOf(profile, monday);
  const contexto = {
    todayISO: toISODate(reference),
    planned: new Set(planned),
    firma: firmaDelPlan(training),
    cambios: parseCambiosDeBloque(profile.blockOverrides),
    force: options.force,
  };

  const stale = existing.filter((workout) => seRearma({ ...workout, sets: workout._count.sets }, contexto));

  const staleDates = new Set(stale.map((workout) => isoFromDateColumn(workout.date)));
  const existingDates = new Set(
    existing
      .map((workout) => isoFromDateColumn(workout.date))
      // Lo que se va a borrar cuenta como faltante: si no, un día planeado
      // que se rearma quedaría borrado y nunca recreado.
      .filter((date) => !staleDates.has(date)),
  );
  const missing = planned.filter((date) => !existingDates.has(date));

  if (missing.length === 0 && stale.length === 0) {
    return existing.map(({ _count, ...workout }) => workout);
  }

  if (stale.length > 0) {
    await prisma.workout.deleteMany({ where: { id: { in: stale.map((workout) => workout.id) } } });
  }

  const conPlan = options.plan?.weekStart === toISODate(monday) && options.plan?.firma === contexto.firma;
  const [catalog, history, emphasis] = conPlan
    ? [[], [], []]
    : await Promise.all([
        loadCatalog(),
        loadHistory(userId, monday),
        // Lo que salió de comparar sus fotos contra su referencia: qué grupo
        // lleva prioridad. Sin análisis todavía, llega vacío.
        emphasisFor(userId).catch(() => []),
      ]);

  // La semana canónica (I1): la misma función que la vista previa del
  // replanteo y `planDeSemana`.
  const semana =
    conPlan && options.plan
      ? options.plan
      : armarPlanSemana({
          training,
          cambios: contexto.cambios,
          bloquesDelDia: parseDayBlocks(profile.dayBlocks),
          weekStart: monday,
          catalog,
          history,
          emphasis,
        });

  // Solo se escriben los días que faltaban: `update: {}` protegería la fila
  // existente de todos modos, pero ni siquiera se toca.
  const missingSet = new Set(missing);
  for (const workout of semana.workouts) {
    if (!missingSet.has(workout.date)) continue;

    const date = fromISODate(workout.date);
    await prisma.workout.upsert({
      where: { userId_date: { userId, date } },
      create: {
        userId,
        date,
        muscleGroup: workout.muscleGroup,
        scheme: workout.scheme,
        exercisesJson: planGuardable(workout, semana.firma),
      },
      update: {},
    });
  }

  return prisma.workout.findMany({
    where: { userId, date: { gte: monday, lte: sunday } },
    orderBy: { date: "asc" },
  });
}

/**
 * El `exercises_json` de una sesión, completo. Todas las escrituras pasan por
 * aquí: el recorte y el cambio a pesas escribían el objeto sin `warmup` y la
 * siguiente reconciliación lo leía como "plan viejo" y lo rearmaba — por eso
 * "hoy tengo menos tiempo" parecía no hacer nada.
 */
export function planGuardable(
  workout: Pick<
    PlannedWorkoutLike,
    "dayKind" | "schemeLabel" | "cardioMinutes" | "estimatedMin" | "warmup" | "exercises"
  >,
  firma: string,
): Prisma.InputJsonValue {
  return {
    dayKind: workout.dayKind,
    schemeLabel: workout.schemeLabel,
    cardioMinutes: workout.cardioMinutes,
    estimatedMin: workout.estimatedMin ?? null,
    warmup: workout.warmup,
    exercises: workout.exercises,
    firma,
  } as unknown as Prisma.InputJsonValue;
}

type PlannedWorkoutLike = {
  dayKind: string;
  schemeLabel: string;
  cardioMinutes: number | null;
  estimatedMin?: number | null;
  warmup: Warmup | null;
  exercises: PlannedExercise[];
};

/** El mejor peso levantado por ejercicio: la vara contra la que se mide un PR. */
export async function personalBests(
  userId: string,
  exerciseNames: string[],
): Promise<Record<string, number>> {
  if (exerciseNames.length === 0) return {};

  const rows = await prisma.workoutSet.groupBy({
    by: ["exerciseName"],
    where: {
      workout: { userId },
      warmup: false,
      exerciseName: { in: exerciseNames },
      weightKg: { not: null },
    },
    _max: { weightKg: true },
  });

  const best: Record<string, number> = {};
  for (const row of rows) {
    if (row._max.weightKg !== null && row._max.weightKg !== undefined) {
      best[row.exerciseName] = Number(row._max.weightKg);
    }
  }
  return best;
}

/**
 * Lo que hizo la última vez en cada ejercicio, para prellenar los steppers
 * cuando la rutina se generó sin historial (o cuando el ejercicio se estrenó
 * después). Trae reps y RPE, no solo el peso: sin eso no se puede traducir la
 * carga al esquema de esta semana ni aplicar la progresión doble.
 */
export async function lastPerformances(
  userId: string,
  reference: Date,
  exercises: Array<{ id: string | null; name: string }>,
): Promise<Record<string, LastPerformance>> {
  const history = await loadHistory(userId, reference);
  const map: Record<string, LastPerformance> = {};

  for (const exercise of exercises) {
    const last = lastPerformance(history, exercise);
    if (last) map[exercise.name] = last;
  }
  return map;
}

/** Un récord: el mejor peso levantado en un ejercicio, con sus reps y su fecha. */
export type PersonalRecord = {
  exerciseName: string;
  weightKg: number;
  reps: number;
  /** ISO `YYYY-MM-DD` de la sesión donde ocurrió. */
  date: string;
  /**
   * El ejercicio del catálogo, para poder abrir su tendencia desde el récord.
   * `null` cuando la serie se capturó suelta o el catálogo cambió después: el
   * récord sigue valiendo, lo que no hay es a dónde ir.
   */
  exerciseId: string | null;
};

/**
 * Récord por ejercicio: el mejor peso, y a ese peso las mejores reps.
 *
 * El calentamiento nunca cuenta (`warmup: false`), que es la razón de que la
 * serie ligera de arranque no pueda ensuciar un PR.
 */
export async function personalRecords(
  userId: string,
  exerciseNames?: string[],
): Promise<Record<string, PersonalRecord>> {
  if (exerciseNames !== undefined && exerciseNames.length === 0) return {};

  const rows = await prisma.workoutSet.findMany({
    where: {
      workout: { userId },
      warmup: false,
      weightKg: { not: null },
      reps: { gt: 0 },
      ...(exerciseNames === undefined ? {} : { exerciseName: { in: exerciseNames } }),
    },
    select: {
      exerciseId: true,
      exerciseName: true,
      reps: true,
      weightKg: true,
      workout: { select: { date: true } },
    },
  });

  const best: Record<string, PersonalRecord> = {};

  for (const row of rows) {
    const weightKg = Number(row.weightKg);
    const current = best[row.exerciseName];
    const better =
      current === undefined ||
      weightKg > current.weightKg ||
      (weightKg === current.weightKg && row.reps > current.reps);

    if (better) {
      best[row.exerciseName] = {
        exerciseName: row.exerciseName,
        weightKg,
        reps: row.reps,
        date: isoFromDateColumn(row.workout.date),
        exerciseId: row.exerciseId,
      };
    }
  }

  return best;
}
