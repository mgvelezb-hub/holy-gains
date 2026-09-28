import type { ExerciseOption, PlannedExercise } from "@/lib/training/types";

/**
 * Cambiar un ejercicio en el gimnasio.
 *
 * La máquina está ocupada, el gimnasio no la tiene, o la rodilla dijo que no.
 * El catálogo ya traía `substitutes` desde la Fase 4 y el generador los usaba,
 * pero la atleta no tenía cómo pedirlos con el teléfono en la mano.
 *
 * El orden de lo que se ofrece no es casual:
 *
 * 1. Los **sustitutos declarados** del ejercicio: los que el coach considera
 *    equivalentes (prensa por hack squat, no prensa por curl).
 * 2. Los **compañeros del mismo grupo muscular con video**, como respaldo. Con
 *    video porque este cambio pasa en el gimnasio, sin señal, y un ejercicio
 *    sin demostración no sirve de nada a media serie.
 *
 * Todo aquí es puro: recibe el catálogo y devuelve opciones. Eso permite
 * mandarlas dentro de la semana que se guarda en IndexedDB, que es lo que hace
 * que el cambio funcione sin red.
 */

export type ExerciseAlternative = {
  exerciseId: string;
  name: string;
  /** `true` si el catálogo lo declara sustituto directo. */
  declared: boolean;
  videoPath: string | null;
};

/** Cuántas opciones caben en una pantalla de teléfono sin volverse un menú. */
export const MAX_ALTERNATIVES = 8;

/** Sin acentos y en minúsculas: "Prensa" y "prensa de pierna" deben cruzarse. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ¿Este nombre del catálogo es el que nombra `substitutes`?
 *
 * Los sustitutos del seed están escritos a mano ("Prensa" contra "Prensa de
 * pierna"), así que además del match exacto se acepta que uno sea prefijo del
 * otro. Es tolerante a propósito: perder un sustituto bueno cuesta más que
 * ofrecer uno de más, que de todos modos ella elige.
 */
function namesMatch(catalogName: string, wanted: string): boolean {
  const a = normalize(catalogName);
  const b = normalize(wanted);
  if (!a || !b) return false;
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
}

/** El ejercicio del catálogo que corresponde a uno ya planeado. */
export function catalogEntryFor(
  exercise: Pick<PlannedExercise, "exerciseId" | "name">,
  catalog: ExerciseOption[],
): ExerciseOption | null {
  if (exercise.exerciseId) {
    const byId = catalog.find((option) => option.id === exercise.exerciseId);
    if (byId) return byId;
  }
  return catalog.find((option) => namesMatch(option.name, exercise.name)) ?? null;
}

/** Lo que ya ocupa la sesión: un nombre suelto o un ejercicio con su id. */
export type TakenExercise = string | Pick<PlannedExercise, "exerciseId" | "name">;

/**
 * Las opciones para cambiar un ejercicio, ya ordenadas.
 *
 * `taken` es lo que ya está en la sesión de hoy: nadie quiere cambiar prensa
 * por el mismo jalón que va a hacer tres ejercicios después.
 *
 * Se excluye por **id** además de por nombre. Antes solo se comparaban
 * nombres exactos, y un ejercicio guardado en el plan con otro nombre que el
 * del catálogo ("Hack squat (máquina)" contra "Hack squat") se colaba como
 * alternativa del de arriba.
 */
export function alternativesFor(
  exercise: Pick<PlannedExercise, "exerciseId" | "name" | "muscleGroup">,
  catalog: ExerciseOption[],
  taken: TakenExercise[] = [],
): ExerciseAlternative[] {
  const entry = catalogEntryFor(exercise, catalog);
  const group = entry?.muscleGroup ?? exercise.muscleGroup;
  const busy = new Set(
    [...taken.map((item) => (typeof item === "string" ? item : item.name)), exercise.name].map(normalize),
  );
  const busyIds = new Set<string>();
  for (const item of [...taken, exercise]) {
    if (typeof item === "string") continue;
    if (item.exerciseId) busyIds.add(item.exerciseId);
  }
  if (entry) busyIds.add(entry.id);
  const isBusy = (option: ExerciseOption): boolean =>
    busyIds.has(option.id) || busy.has(normalize(option.name));

  const declared: ExerciseAlternative[] = [];
  const companions: ExerciseAlternative[] = [];
  const seen = new Set<string>();

  for (const wanted of entry?.substitutes ?? []) {
    const option = catalog.find((row) => namesMatch(row.name, wanted));
    if (!option || isBusy(option) || seen.has(option.id)) continue;
    seen.add(option.id);
    declared.push({
      exerciseId: option.id,
      name: option.name,
      declared: true,
      videoPath: option.videoUrl,
    });
  }

  for (const option of catalog) {
    if (option.muscleGroup !== group) continue;
    if (isBusy(option) || seen.has(option.id)) continue;
    // El respaldo exige video: este cambio ocurre sin señal y sin
    // demostración el ejercicio no se puede hacer bien.
    if (!option.videoUrl) continue;
    seen.add(option.id);
    companions.push({
      exerciseId: option.id,
      name: option.name,
      declared: false,
      videoPath: option.videoUrl,
    });
  }

  return [...declared, ...companions].slice(0, MAX_ALTERNATIVES);
}

/**
 * ¿Se vale cambiar a este ejercicio?
 *
 * El teléfono manda un id; el servidor no le cree. Se acepta si el catálogo lo
 * declara sustituto del planeado o si comparte grupo muscular — que es
 * exactamente lo que la pantalla ofreció.
 */
export function isAllowedSubstitute(
  exercise: Pick<PlannedExercise, "exerciseId" | "name" | "muscleGroup">,
  candidate: ExerciseOption,
  catalog: ExerciseOption[],
): boolean {
  const entry = catalogEntryFor(exercise, catalog);
  const group = entry?.muscleGroup ?? exercise.muscleGroup;

  if (candidate.muscleGroup === group) return true;
  return (entry?.substitutes ?? []).some((wanted) => namesMatch(candidate.name, wanted));
}

/**
 * El ejercicio planeado, con otro nombre encima.
 *
 * Se conservan el esquema, el descanso y la **forma** de las series (reps y
 * cuáles son calentamiento): lo que cambia es la máquina, no el estímulo. Los
 * pesos sugeridos se borran a propósito — el peso de la prensa no es el del
 * hack squat, y prellenar con el ajeno es peor que dejarlo vacío.
 */
export function withSubstitute(
  exercise: PlannedExercise,
  candidate: ExerciseOption,
): PlannedExercise {
  return {
    ...exercise,
    exerciseId: candidate.id,
    name: candidate.name,
    muscleGroup: candidate.muscleGroup,
    poolRole: candidate.poolRole,
    videoPath: candidate.videoUrl,
    tracker: candidate.isTracker,
    sets: exercise.sets.map((set) => ({ ...set, weightKg: null })),
  };
}

/** ¿El ejercicio planeado es este del catálogo? Por id, o por nombre exacto. */
function isSameExercise(
  exercise: Pick<PlannedExercise, "exerciseId" | "name">,
  candidate: ExerciseOption,
): boolean {
  if (exercise.exerciseId && exercise.exerciseId === candidate.id) return true;
  return normalize(exercise.name) === normalize(candidate.name);
}

/**
 * Aplica un cambio de ejercicio a la sesión SIN dejarla con un repetido.
 *
 * El caso que lo pidió: la máquina estaba ocupada, se cambió por su
 * alternativa, y dos ejercicios después tocaba justo esa alternativa. Si el
 * ejercicio elegido ya estaba **más abajo**, ese de abajo se reemplaza por
 * otra opción del mismo grupo —del mismo rol primero— que no esté en la
 * sesión ni sea la máquina que se acaba de dejar (está ocupada). Lo de arriba
 * no se toca: ya se hizo. Si no hay con qué reemplazarlo, se queda.
 *
 * Devuelve los índices que cambiaron, para borrar sus series capturadas.
 */
export function planSubstitution(
  exercises: PlannedExercise[],
  index: number,
  candidate: ExerciseOption,
  catalog: ExerciseOption[],
): { exercises: PlannedExercise[]; replaced: number[] } {
  const current = exercises[index];
  if (!current) return { exercises, replaced: [] };

  const next = [...exercises];
  next[index] = withSubstitute(current, candidate);
  const replaced = [index];

  for (let below = index + 1; below < next.length; below += 1) {
    const repeated = next[below]!;
    if (!isSameExercise(repeated, candidate)) continue;

    const taken: TakenExercise[] = [...next.filter((_, position) => position !== below), current];
    const options = alternativesFor(repeated, catalog, taken);
    const pick =
      options.find(
        (option) =>
          catalog.find((row) => row.id === option.exerciseId)?.poolRole === repeated.poolRole,
      ) ?? options[0];
    const replacement = pick ? catalog.find((row) => row.id === pick.exerciseId) : undefined;
    if (!replacement) continue;

    next[below] = withSubstitute(repeated, replacement);
    replaced.push(below);
  }

  return { exercises: next, replaced };
}
