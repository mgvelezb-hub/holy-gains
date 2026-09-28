import { fromISODate, shiftISODate, toISODate, weekdayIn } from "@/lib/format";
import { calentamientoPara } from "@/lib/training/calentamiento";
import { aplicaEsquemaDeCoach, esUnilateral } from "@/lib/training/coach";
import { gruposFatigados } from "@/lib/training/carga-muscular";
import {
  buildTargetSets,
  lastPerformance,
  repsObjetivo,
  roundWeight,
  suggestTopWeight,
  warmupRepsFor,
} from "@/lib/training/progression";
import {
  minutosDeEjercicio,
  minutosDeSesion,
  recortarPorPrioridad,
  redondeaMinutos,
} from "@/lib/training/duracion";
import { exerciseCountFor, recipeFor, type Slot } from "@/lib/training/recipes";
import { SCHEMES, isoWeekNumber, schemeForExercise, schemeForWeek } from "@/lib/training/schemes";
import { esqueletoDeSemana } from "@/lib/training/esqueleto";
import {
  DAY_LABELS,
  DAY_GROUPS,
  WEEK_DAYS,
  parseInjuries,
  type InjuryState,
} from "@/lib/training/split";
import type {
  DayKind,
  ExerciseOption,
  GenerateWeekConfig,
  GeneratedWeek,
  HistoryWorkout,
  MuscleGroup,
  PlannedExercise,
  PlannedWorkout,
  TrainingProfile,
} from "@/lib/training/types";

/**
 * Generador de la rutina semanal.
 *
 * Es una función pura: mismas entradas, misma rutina. La fecha llega por
 * `config.weekStart` — nada aquí lee el reloj, para que se pueda probar.
 */

/** Ejercicios con impacto: se suspenden mientras haya lesión activa. */
const IMPACT_HINTS = ["desplante", "caminando", "salto", "burpee", "sprint"];

function hasImpact(name: string): boolean {
  const lower = name.toLowerCase();
  return IMPACT_HINTS.some((hint) => lower.includes(hint));
}

/**
 * Serie de aproximación del primer ejercicio: 1 sola, al ~50% del peso tope.
 * El calentamiento general (2-3 min de pulso + movilidad dinámica del grupo
 * del día) ya no vive aquí — vive en `calentamientoPara`, antes de la
 * sesión. Ver el docblock de `WARMUP_REPS_MIN` en `progression.ts`.
 */
const WARMUP_SETS = 1;

/**
 * Roles pesados: en el día de rehabilitación de la zona lesionada no se tocan.
 * "Reps altas, peso bajo" no se hace con sentadilla ni peso muerto.
 */
const HEAVY_ROLES = new Set([
  "cuadriceps_compuesto",
  "cadena_posterior",
  "unilateral",
  "empuje_vertical",
  "empuje_horizontal",
  "empuje_inclinado",
  "jalon_vertical",
  "jalon_horizontal",
  "empuje_cerrado",
  "bicep_compuesto",
]);

function dateOfDay(weekStart: Date, dayIndex: number): string {
  const copy = new Date(weekStart);
  copy.setDate(copy.getDate() + dayIndex);
  return toISODate(copy);
}

/**
 * Elige qué huecos de la receta caben en el tiempo disponible, respetando el
 * orden de la sesión: primero se descartan los de prioridad más baja.
 */
/**
 * Baja la prioridad de los huecos que tocan un grupo ya cansado.
 *
 * `chooseSlots` recorta por prioridad; esto hace que lo primero en caer sea el
 * accesorio del grupo que otra disciplina ya trabajó. Los compuestos no se
 * mueven —son el trabajo principal del día— y por eso solo se penalizan los
 * huecos de prioridad 2 en adelante.
 */
function ordenarPorFatiga(slots: Slot[], cansados: MuscleGroup[]): Slot[] {
  return slots.map((slot) => {
    if (slot.priority < 2) return slot;
    const tocaCansado = slot.groups.some((group) => cansados.includes(group));
    // La prioridad está acotada a 4 en el tipo: `chooseSlots` ordena de menor a
    // mayor, así que empujar al último peldaño ya lo pone primero en la fila de
    // lo que se suelta.
    return tocaCansado ? { ...slot, priority: 4 as const } : slot;
  });
}

function chooseSlots(slots: Slot[], count: number): Slot[] {
  // Misma regla de recorte que el de minutos (`duracion.ts`): cae primero el
  // accesorio y, a igualdad de prioridad, lo que va más tarde en la sesión.
  return recortarPorPrioridad(
    slots,
    (slot) => slot.priority,
    (candidatos) => candidatos.length <= count,
  );
}

/**
 * Qué niveles puede elegir alguien.
 *
 * Hacia abajo siempre: quien va avanzado sigue usando la prensa, y quien
 * empieza no toca la sentadilla frontal. El generador nunca sube de nivel
 * solo — eso lo declara la persona en Ajustes.
 */
const NIVELES_PERMITIDOS: Record<string, string[]> = {
  PRINCIPIANTE: ["PRINCIPIANTE"],
  INTERMEDIO: ["PRINCIPIANTE", "INTERMEDIO"],
  AVANZADO: ["PRINCIPIANTE", "INTERMEDIO", "AVANZADO"],
};

type PickContext = {
  catalog: ExerciseOption[];
  usedToday: Set<string>;
  lastWeekNames: Set<string>;
  noImpact: boolean;
  /** Grupos donde hoy no se admite nada pesado (día de rehabilitación). */
  lightOnly: MuscleGroup[];
  /** Nivel de la atleta en el gimnasio. */
  /** Lo que esta persona ya cambió: `{originalId: reemplazoId}`. */
  exerciseSwaps?: Record<string, string>;
  gymLevel: string;
  seed: number;
};

/**
 * Ejercicio para un hueco.
 *
 * Prioriza los que tienen video (es lo que la atleta ve en el gym), luego los
 * trazadores en los huecos básicos, y castiga repetir el accesorio exacto de la
 * semana pasada. El desempate rota con la semana, así que la selección varía
 * sin dejar de ser determinista.
 */
/** ¿El reemplazo elegido sigue sirviendo para este hueco? */
function reemplazoCabe(
  reemplazoId: string,
  slot: Slot,
  context: PickContext,
  permitidos: readonly string[],
): boolean {
  const reemplazo = context.catalog.find((exercise) => exercise.id === reemplazoId);
  if (!reemplazo) return false;
  if (context.usedToday.has(reemplazo.id)) return false;

  return (
    permitidos.includes(reemplazo.level) &&
    slot.groups.includes(reemplazo.muscleGroup as MuscleGroup) &&
    slot.roles.includes(reemplazo.poolRole) &&
    !(context.noImpact && hasImpact(reemplazo.name)) &&
    !(
      context.lightOnly.includes(reemplazo.muscleGroup as MuscleGroup) &&
      HEAVY_ROLES.has(reemplazo.poolRole)
    )
  );
}

function pickExercise(slot: Slot, context: PickContext): ExerciseOption | null {
  const permitidos = NIVELES_PERMITIDOS[context.gymLevel] ?? NIVELES_PERMITIDOS.PRINCIPIANTE!;

  // Lo que esta persona ya cambió, y por cuál. Se aplica ANTES de puntuar:
  // proponer otra vez el ejercicio que ya rechazó —y obligarla a cambiarlo
  // cada semana— es la definición de no escuchar.
  const cambiados = context.exerciseSwaps ?? {};

  const candidates = context.catalog.filter(
    (exercise) =>
      permitidos.includes(exercise.level) &&
      slot.groups.includes(exercise.muscleGroup as MuscleGroup) &&
      slot.roles.includes(exercise.poolRole) &&
      !context.usedToday.has(exercise.id) &&
      // El que ya cambió no vuelve, siempre que su reemplazo siga cabiendo en
      // este hueco: si el reemplazo ya no aplica (cambió el grupo del día, o
      // una lesión lo prohíbe), el original vuelve a ser candidato antes que
      // dejar el hueco vacío.
      !(cambiados[exercise.id] !== undefined && reemplazoCabe(cambiados[exercise.id]!, slot, context, permitidos)) &&
      !(context.noImpact && hasImpact(exercise.name)) &&
      !(
        context.lightOnly.includes(exercise.muscleGroup as MuscleGroup) &&
        HEAVY_ROLES.has(exercise.poolRole)
      ),
  );

  if (candidates.length === 0) return null;

  const scored = candidates.map((exercise) => {
    let score = 0;
    // El reemplazo que la persona eligió con sus manos gana a cualquier
    // heurística de catálogo.
    if (Object.values(cambiados).includes(exercise.id)) score += 6;
    if (exercise.videoUrl) score += 4;
    if (exercise.isTracker && slot.priority === 1) score += 2;
    if (slot.priority >= 2 && context.lastWeekNames.has(exercise.name)) score -= 3;
    return { exercise, score };
  });

  const best = Math.max(...scored.map((entry) => entry.score));
  const pool = scored
    .filter((entry) => entry.score === best)
    .map((entry) => entry.exercise)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

  return pool[context.seed % pool.length] ?? null;
}

/**
 * Los huecos de la receta que este día puede llenar, con el protocolo de
 * lesión ya aplicado.
 *
 * Vive aparte porque lo necesitan dos caminos: la semana que se genera y la
 * sugerencia que se enseña en Ajustes. Si cada uno filtrara por su cuenta, la
 * hoja acabaría proponiendo ejercicios que el generador nunca elegiría.
 */
function huecosDelDia(kind: DayKind, injury: InjuryState, rehabDay: boolean): Slot[] {
  return recipeFor(kind).filter((slot) => {
    if (injury.zones.length === 0) return true;
    const touches = slot.groups.some((group) => injury.zones.includes(group));
    if (!touches) return true;
    if (!rehabDay) return false;
    // Día de rehabilitación: solo aislados y máquinas, nada pesado.
    return slot.roles.some((role) => !HEAVY_ROLES.has(role));
  });
}

/**
 * ¿Este ejercicio se puede hacer hoy, aunque ella lo haya elegido a mano?
 *
 * El protocolo de lesión no es una sugerencia que se pueda desactivar
 * eligiendo el ejercicio uno mismo: con lesión activa no hay impacto, y en la
 * zona en rehabilitación no hay nada pesado. Lo que sí se le concede a la
 * elección manual es el nivel: quien pone un ejercicio avanzado en su lista
 * sabe lo que está poniendo.
 */
function permitidoHoy(exercise: ExerciseOption, context: PickContext): boolean {
  if (context.usedToday.has(exercise.id)) return false;
  if (context.noImpact && hasImpact(exercise.name)) return false;
  return !(
    context.lightOnly.includes(exercise.muscleGroup as MuscleGroup) &&
    HEAVY_ROLES.has(exercise.poolRole)
  );
}

/**
 * Los ejercicios que la persona fijó a mano para este tipo de día, resueltos
 * contra el catálogo y emparejados con un hueco de la receta.
 *
 * El hueco es lo que le da esquema, prioridad de recorte y series: un
 * ejercicio suelto no sabe si es el básico del día o el último accesorio.
 * Cuando ninguno de la receta le queda —porque ella metió algo que esa receta
 * no contempla— se le arma uno a su medida, con la prioridad que le
 * corresponde por rol: los compuestos pesados son intocables, el resto se
 * recorta como accesorio.
 */
function manualesDelDia(
  ids: string[],
  slots: Slot[],
  context: PickContext,
): Array<{ option: ExerciseOption; slot: Slot }> {
  const salida: Array<{ option: ExerciseOption; slot: Slot }> = [];
  const tomados = new Set<Slot>();

  for (const id of ids) {
    // Un id que ya no está en el catálogo (ejercicio retirado) se ignora: no
    // puede dejar el día a medias ni tumbar la generación.
    const option = context.catalog.find((exercise) => exercise.id === id);
    if (!option || !permitidoHoy(option, context)) continue;

    const exacto = slots.find(
      (slot) =>
        !tomados.has(slot) &&
        slot.groups.includes(option.muscleGroup as MuscleGroup) &&
        slot.roles.includes(option.poolRole),
    );
    const porGrupo =
      exacto ??
      slots.find((slot) => !tomados.has(slot) && slot.groups.includes(option.muscleGroup as MuscleGroup));
    const slot: Slot =
      porGrupo ??
      {
        groups: [option.muscleGroup as MuscleGroup],
        roles: [option.poolRole],
        priority: HEAVY_ROLES.has(option.poolRole) ? 1 : 3,
      };

    if (porGrupo) tomados.add(porGrupo);
    context.usedToday.add(option.id);
    salida.push({ option, slot });
  }

  return salida;
}

/**
 * Lo que Coachy propondría para un tipo de día, sin generar la semana.
 *
 * Es lo que enseña la hoja de "Ejercicios" en Ajustes para que la elección
 * manual arranque de algo, no de una lista vacía. Sale de la MISMA receta y
 * el MISMO `pickExercise` que la semana real — por eso se puede prometer que
 * lo que ahí se ve es lo que se entrena.
 */
export function sugerenciaDeEjercicios(
  profile: Pick<
    TrainingProfile,
    "conditions" | "sessionMinutes" | "volumeBias" | "gymLevel" | "exerciseSwaps"
  >,
  kind: DayKind,
  catalog: ExerciseOption[],
  semana = 0,
): ExerciseOption[] {
  const injury = parseInjuries(profile.conditions);
  const slots = huecosDelDia(kind, injury, false);
  const cupo = Math.max(3, exerciseCountFor(profile.sessionMinutes, profile.volumeBias));
  const usedToday = new Set<string>();

  const salida: ExerciseOption[] = [];
  chooseSlots(slots, cupo).forEach((slot, index) => {
    const option = pickExercise(slot, {
      catalog,
      usedToday,
      lastWeekNames: new Set<string>(),
      noImpact: injury.active,
      lightOnly: [],
      gymLevel: profile.gymLevel,
      exerciseSwaps: profile.exerciseSwaps,
      seed: semana + index,
    });
    if (!option) return;
    usedToday.add(option.id);
    salida.push(option);
  });

  return salida;
}

export function generateWeek(
  profile: TrainingProfile,
  history: HistoryWorkout[],
  config: GenerateWeekConfig,
): GeneratedWeek {
  const weekStart = new Date(config.weekStart);
  weekStart.setHours(12, 0, 0, 0);

  const isoWeek = isoWeekNumber(weekStart);
  // `RECOMENDADO` (o cualquier valor viejo/corrupto) deja la rotación tal
  // cual siempre se comportó; una preferencia fija la sobreescribe.
  const weekScheme = schemeForWeek(weekStart, profile.schemePreference);

  // El esqueleto —días, split y disciplinas— sale de UNA sola función
  // (`esqueletoDeSemana`, I1): la misma que leen la reconciliación, la vista
  // y el replanteo. Antes cada uno lo recalculaba por su lado y la semana
  // materializada acababa distinta de la que enseñaba Ajustes.
  const esqueleto = esqueletoDeSemana(profile, weekStart);
  const { kinds, days, rehabIndexes, injury } = esqueleto;
  const disciplines = esqueleto.disciplines;

  const weekStartISO = toISODate(weekStart);
  const previousWeekStart = new Date(weekStart);
  previousWeekStart.setDate(previousWeekStart.getDate() - 7);
  const previousISO = toISODate(previousWeekStart);
  const lastWeekNames = new Set(
    history
      .filter((workout) => workout.date >= previousISO && workout.date < weekStartISO)
      .flatMap((workout) => workout.exerciseNames),
  );

  const emphasis = config.emphasis ?? [];
  const workouts: PlannedWorkout[] = [];

  /**
   * Qué grupos llegan cansados cada día por otra disciplina.
   *
   * No es lo mismo haber nadado que haber jugado squash: el crol deja la
   * espalda y el hombro trabajados, el squash la pierna. Quitar "un accesorio
   * cualquiera" por compartir día recortaba a ciegas — a veces el del grupo
   * que estaba fresco.
   *
   * Cuenta el día de la sesión y el anterior: la fatiga de ayer es la que
   * decide cuánto aguanta hoy.
   */
  const fatigaPorDia = new Map<string, MuscleGroup[]>();
  for (const sesion of disciplines.sessions) {
    const grupos = gruposFatigados(sesion.discipline);
    if (grupos.length === 0) continue;

    for (const fecha of [sesion.date, shiftISODate(sesion.date, 1)]) {
      fatigaPorDia.set(fecha, [...new Set([...(fatigaPorDia.get(fecha) ?? []), ...grupos])]);
    }
  }

  kinds.forEach((kind, index) => {
    const day = days[index];
    if (!day) return;

    const rehabDay = rehabIndexes.includes(index);
    const dayIndex = WEEK_DAYS.indexOf(day);

    // En un día normal no se toca la zona lesionada: ese trabajo vive en su
    // único día de rehabilitación.
    const slots = huecosDelDia(kind, injury, rehabDay);

    // Un ejercicio extra en los días que tocan un grupo con prioridad —la que
    // salió de comparar tus fotos contra tu referencia—. Es lo único que el
    // énfasis mueve: ni el split, ni los días, ni las cargas.
    const tocaPrioridad = DAY_GROUPS[kind].some((group) => emphasis.includes(group));
    const fecha = dateOfDay(weekStart, dayIndex);

    // Regla 4 del modelo: un día que además trae sesión de otra disciplina se
    // redimensiona a los minutos reales que le tocan (Fase 9). Antes esto era
    // "pierde un accesorio" sin importar si al día le quedaban 50 minutos o
    // 25 — un parche parejo para un recorte que no lo es. `gymMinutesPorFecha`
    // ya trae el resultado de `repartirMinutos`, así que la cuenta base sale
    // de los minutos de verdad, no de una resta fija.
    //
    // I1: sin otra disciplina ese día, los minutos son los que ella declaró
    // PARA ESE DÍA (`timePerDay`), no `sessionMinutes` —que es el día más
    // corto de la semana y solo queda como respaldo—. Y "hoy tengo menos
    // tiempo" (`minutosGymPorFecha`) gana sobre todo: es el tiempo real de hoy.
    const minutosDelDia =
      config.minutosGymPorFecha?.[fecha] ??
      disciplines.gymMinutesPorFecha[fecha] ??
      (profile.timePerDay?.[day] ? profile.timePerDay[day] : undefined) ??
      profile.sessionMinutes;
    const cuentaBase = exerciseCountFor(minutosDelDia, profile.volumeBias);

    // Y el recorte se hace DONDE toca: si ayer nadaste, el que sobra es un
    // accesorio de espalda, no el de pierna que hoy está fresca.
    const cansados = (fatigaPorDia.get(fecha) ?? []).filter((grupo) =>
      DAY_GROUPS[kind].includes(grupo),
    );
    const disponibles =
      cansados.length > 0
        ? ordenarPorFatiga(slots, cansados)
        : slots;

    // El +1 de énfasis se suma DESPUÉS de todo recorte —el de huecos y el de
    // minutos—: el ejercicio del objetivo prioritario nunca es el que se cae
    // por compartir día ni por ir justos de tiempo. Es el único que puede
    // empujar la sesión por encima de los minutos declarados, y lo hace
    // porque la persona pidió expresamente ese grupo.
    const cupo = Math.max(3, cuentaBase);
    const chosenBase = chooseSlots(disponibles, cupo);
    const chosen = tocaPrioridad ? chooseSlots(disponibles, cupo + 1) : chosenBase;
    const extraDeEnfasis = chosen.filter((slot) => !chosenBase.includes(slot));
    const usedToday = new Set<string>();
    // Se guardan con su prioridad: el recorte por minutos suelta primero el
    // accesorio, igual que el recorte por número de huecos.
    const candidatos: Array<{ exercise: PlannedExercise; priority: number; enfasis: boolean }> = [];

    const contextoDelDia: PickContext = {
      catalog: config.catalog,
      usedToday,
      lastWeekNames,
      noImpact: injury.active,
      lightOnly: rehabDay ? injury.zones : [],
      gymLevel: profile.gymLevel,
      exerciseSwaps: profile.exerciseSwaps,
      seed: 0,
    };

    // Lo que ella eligió a mano va PRIMERO y en su orden; la sugerencia solo
    // completa lo que falte de volumen. Es la diferencia entre una app que
    // propone y una que impone.
    const manuales = manualesDelDia(
      profile.manualExercises?.[kind] ?? [],
      slots,
      contextoDelDia,
    );
    const huecosManuales = new Set(manuales.map((entrada) => entrada.slot));
    const cupoAuto = Math.max(0, cupo - manuales.length);
    let automaticos = 0;

    const elegidos: Array<{ option: ExerciseOption; slot: Slot; enfasis: boolean }> = manuales.map(
      (entrada) => ({ ...entrada, enfasis: false }),
    );

    chosen.forEach((slot, slotIndex) => {
      if (huecosManuales.has(slot)) return;

      const esEnfasis = extraDeEnfasis.includes(slot);
      // El ejercicio del énfasis nunca cuenta contra el cupo: es el +1 que la
      // persona pidió expresamente.
      if (!esEnfasis && automaticos >= cupoAuto) return;

      const option = pickExercise(slot, {
        ...contextoDelDia,
        seed: isoWeek + slotIndex + index * 3,
      });
      if (!option) return;

      usedToday.add(option.id);
      if (!esEnfasis) automaticos += 1;
      elegidos.push({ option, slot, enfasis: esEnfasis });
    });

    elegidos.forEach(({ option, slot, enfasis }) => {

      const rehabExercise =
        rehabDay && injury.zones.includes(option.muscleGroup as MuscleGroup);
      const schemeId = schemeForExercise(option.poolRole, weekScheme, { rehab: rehabExercise });
      const scheme = SCHEMES[schemeId];

      const last = lastPerformance(history, { id: option.id, name: option.name });
      const suggested = rehabExercise
        ? last
          ? roundWeight(last.topWeightKg * 0.5)
          : null
        : suggestTopWeight(option, scheme, last);

      const isFirst = candidatos.length === 0;

      // El catálogo no trae la columna: se deduce del nombre y el rol (ver
      // `esUnilateral`).
      const unilateral = option.unilateral ?? esUnilateral(option);

      const sets = aplicaEsquemaDeCoach(
        buildTargetSets(scheme, suggested, {
          warmupSets: isFirst ? WARMUP_SETS : 0,
          // Si la última vez se quedó corta, esta semana arranca en lo que sí
          // hizo: pedirle otra vez el número que no alcanzó no es un objetivo.
          reps: repsObjetivo(scheme, last),
        }),
        {
          scheme: schemeId,
          preference: profile.schemePreference,
          topWeightKg: suggested,
          // Accesorio = lo que la receta puso en prioridad 3 o 4. El fallo va
          // ahí y nunca en el básico del día.
          accesorio: slot.priority >= 3,
          unilateral,
          unilateralMode: profile.unilateralMode ?? "SEGUIDO",
        },
      );

      const exercise: PlannedExercise = {
        exerciseId: option.id,
        name: option.name,
        muscleGroup: option.muscleGroup,
        poolRole: option.poolRole,
        scheme: schemeId,
        schemeLabel: scheme.label,
        restSeconds: scheme.restSeconds,
        videoPath: option.videoUrl,
        tracker: option.isTracker,
        note: rehabExercise
          ? "Zona en recuperación: reps altas, peso bajo, sin forzar."
          : isFirst
            ? `Antes de la serie 1: 1 serie de aproximación de ${warmupRepsFor(scheme)} reps a ~50% del peso.`
            : null,
        sets,
        estimatedMin: minutosDeEjercicio(sets, scheme.restSeconds),
        ...(unilateral ? { unilateral: true } : {}),
      };

      candidatos.push({ exercise, priority: slot.priority, enfasis });
    });

    // El recorte por MINUTOS, antes de emitir. La cuenta de `exerciseCountFor`
    // traduce minutos a número de ejercicios sin saber el esquema del día, y
    // por eso un perfil de 60 minutos podía salir con una sesión de 110: seis
    // ejercicios de 9×20 no duran lo que seis de 5×6. Aquí se mide de verdad
    // —serie por serie, con descansos y calentamiento— y lo que no cabe se
    // suelta por prioridad.
    const minutosTope = minutosDelDia;
    const warmup = calentamientoPara(kind);
    const recortables = candidatos.filter((candidato) => !candidato.enfasis);
    const exercises = [
      ...recortarPorPrioridad(
        recortables,
        (candidato) => candidato.priority,
        (quedan) => minutosDeSesion(quedan.map((c) => c.exercise), warmup.totalSeg) <= minutosTope,
        // Piso: por debajo de cuatro ejercicios no es una sesión recortada, es
        // no haber entrenado. Si ni con cuatro cabe, se emite y el número que
        // ve la atleta dice la verdad.
        Math.min(4, recortables.length),
      ),
      ...candidatos.filter((candidato) => candidato.enfasis),
    ].map((candidato) => candidato.exercise);

    workouts.push({
      date: dateOfDay(weekStart, dayIndex),
      dayKind: kind,
      muscleGroup: DAY_LABELS[kind],
      scheme: weekScheme,
      schemeLabel: SCHEMES[weekScheme].label,
      cardioMinutes:
        injury.active || profile.cardioMinWk <= 0
          ? null
          : Math.round(profile.cardioMinWk / Math.max(1, kinds.length)),
      // El calentamiento dinámico previo, específico del grupo del día —
      // corre ANTES del primer ejercicio, no dentro de él.
      warmup,
      exercises,
      estimatedMin: minutosDeSesion(exercises, warmup.totalSeg),
    });
  });

  return {
    weekStart: weekStartISO,
    isoWeek,
    scheme: weekScheme,
    workouts,
    otherSessions: disciplines.sessions,
    avisos: esqueleto.avisos,
  };
}

/** Grupos que toca un tipo de día. Reexportado para las vistas. */
export { DAY_GROUPS, DAY_LABELS };

/** Lunes de la semana ISO de `date`. */
export function mondayOf(date: Date): Date {
  // El día de la semana se lee en la zona de la atleta, no en la del servidor:
  // en Vercel (UTC) un jueves por la noche en CDMX ya es viernes, y la semana
  // entera se recorría un día.
  const day = weekdayIn(date) || 7;
  return fromISODate(shiftISODate(toISODate(date), -(day - 1)));
}

/** Domingo (fin) de la semana ISO de `date`. */
export function sundayEndOf(date: Date): Date {
  return fromISODate(shiftISODate(toISODate(mondayOf(date)), 6));
}

export type { HistoryWorkout };
