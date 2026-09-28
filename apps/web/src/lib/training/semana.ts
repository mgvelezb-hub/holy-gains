import { shiftISODate, toISODate } from "@/lib/format";
import { aplicaCambios, type CambiosDeBloque } from "@/lib/training/bloques";
import { sesionesDeBloquesDelDia, type BloquesPorFecha } from "@/lib/training/bloques-dia";
import { sesionesDeDiaOverride, type OtherSession } from "@/lib/training/disciplines";
import { generateWeek } from "@/lib/training/generate";
import { WEEK_DAYS, type WeekDay } from "@/lib/training/split";
import type {
  Discipline,
  ExerciseOption,
  HistoryWorkout,
  MuscleGroup,
  PlannedWorkout,
  TrainingProfile,
} from "@/lib/training/types";

/**
 * La semana canónica (I1): lo que la app promete entrenar, de lunes a
 * domingo, en UN solo lugar.
 *
 * `armarPlanSemana` es pura y es la única que responde "¿qué toca esta
 * semana?": días declarados → días de fuerza → split mapeado a esos días →
 * disciplinas con su modo (el cardio "después" cediendo minutos al gym) →
 * bloques del día → ejercicios recortados a los minutos de pesas reales. La
 * materialización (`ensureWeekMaterialized`), la vista previa del replanteo y
 * `planDeSemana` (`plan.ts`) la llaman a ella; Rutinas, Ajustes "Tu semana",
 * el Resumen y Hoy leen lo que salió de aquí (`diasDelPlan`).
 */

/**
 * Sube cuando cambia CÓMO se arma la semana. Una fila materializada con otra
 * versión se rearma (si nadie la ha tocado): así un arreglo del planificador
 * llega a la semana en curso y no hasta el lunes siguiente.
 */
export const VERSION_DEL_PLAN = 2;

/** Objeto con llaves ordenadas, para que la firma no dependa del orden del JSON. */
function ordenado(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenado);
  if (valor === null || typeof valor !== "object") return valor;
  return Object.fromEntries(
    Object.keys(valor as Record<string, unknown>)
      .sort()
      .map((llave) => [llave, ordenado((valor as Record<string, unknown>)[llave])]),
  );
}

/**
 * La huella de las preferencias con las que se armó una sesión.
 *
 * EL DEFECTO QUE CIERRA: la semana se materializaba una vez y solo se
 * rearmaba si cambiaban las FECHAS. Marcar el cardio "después de pesas" en
 * Ajustes dejaba los `Workout` con sus 8 ejercicios de 90 min aunque la vista
 * ya enseñara "Gym 70 + Cardio 20". Con la firma guardada en cada fila, un
 * cambio de preferencias rearma lo que nadie ha entrenado.
 *
 * FNV-1a de 32 bits: no es criptografía, es un "¿cambió algo?" barato.
 */
export function firmaDelPlan(training: TrainingProfile): string {
  const texto = JSON.stringify(ordenado({ v: VERSION_DEL_PLAN, training }));
  let hash = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    hash ^= texto.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `v${VERSION_DEL_PLAN}-${hash.toString(16).padStart(8, "0")}`;
}

/**
 * Las sesiones de las otras disciplinas, con las excepciones de fecha
 * aplicadas: los cambios de bloque ("hoy no pude ir a squash", "hoy solo
 * natación, sin gym") y los bloques agregados el día.
 */
export function completarSesiones(entrada: {
  planeadas: OtherSession[];
  cambios: CambiosDeBloque;
  bloquesDelDia: BloquesPorFecha;
  monday: Date;
  training: TrainingProfile;
  isoWeek: number;
  diasConGimnasio: WeekDay[];
}): OtherSession[] {
  const { planeadas, cambios, bloquesDelDia, monday, training, isoWeek, diasConGimnasio } = entrada;
  const mondayISO = toISODate(monday);

  const sessions = aplicaCambios(planeadas, cambios);

  for (const [fecha, cambio] of Object.entries(cambios)) {
    if (!Array.isArray(cambio)) continue;
    const index = WEEK_DAYS.findIndex((_, position) => shiftISODate(mondayISO, position) === fecha);
    if (index === -1) continue;
    const weekday = WEEK_DAYS[index]!;
    sessions.push(
      ...sesionesDeDiaOverride({
        date: fecha,
        weekday,
        disciplinas: cambio,
        niveles: training.disciplineLevels,
        objetivo: training.goal as never,
        isoWeek,
        minutos: training.timePerDay?.[weekday] ?? null,
      }),
    );
  }

  sessions.push(
    ...sesionesDeBloquesDelDia(bloquesDelDia, monday, {
      niveles: training.disciplineLevels,
      objetivo: training.goal,
      isoWeek,
      diasConGimnasio,
    }),
  );

  return sessions.sort((a, b) => a.date.localeCompare(b.date) || a.orden - b.orden);
}

/** Nombre de un bloque en la línea del día. Vocabulario del dueño, no el enum. */
const NOMBRE_BLOQUE: Record<Discipline, string> = {
  PESAS: "Gimnasio",
  FUNCIONAL: "Funcional",
  CROSSFIT: "CrossFit",
  NATACION: "Natación",
  BOX: "Box",
  SQUASH: "Squash",
  CARDIO: "Cardio",
  GOLF: "Golf",
  OTRO: "Otra actividad",
};

/** "Cardio HIIT", "Natación". */
export function etiquetaDeBloque(sesion: Pick<OtherSession, "discipline" | "sesion">): string {
  const base = NOMBRE_BLOQUE[sesion.discipline] ?? sesion.discipline;
  const focus = (sesion.sesion as { focus?: unknown } | null)?.focus;
  return sesion.discipline === "CARDIO" && typeof focus === "string" ? `${base} ${focus}` : base;
}

/** La sesión de gimnasio de un día, ya resuelta a lo que se enseña. */
export type GymDelDia = {
  dayKind: string;
  muscleGroup: string;
  ejercicios: number;
  /** Minutos estimados de la sesión de pesas. `null` en filas viejas. */
  minutos: number | null;
  /** Minutos a los que se recortó ("hoy tengo menos tiempo"), o `null`. */
  recortada: number | null;
};

/** Un día de la semana canónica, tal como lo pintan Rutinas, Ajustes, Resumen y Hoy. */
export type DiaDelPlan = {
  date: string;
  weekday: WeekDay;
  /** Lo que la persona declaró para ese día. `null` = no declarado. */
  minutosDeclarados: number | null;
  gym: GymDelDia | null;
  bloques: Array<{ discipline: Discipline; etiqueta: string; minutes: number; orden: 1 | 2 }>;
  /** "Pierna · cuádriceps · 6 ejercicios · + Cardio HIIT 20 min", o "Descanso". */
  linea: string;
};

/**
 * La semana día por día, en el formato que comparten todas las pantallas.
 *
 * Es el único lugar que decide cómo se nombra un día: si Rutinas dijera "6
 * ejercicios" y el Resumen "8", volvería a haber dos semanas.
 */
export function diasDelPlan(
  weekStartISO: string,
  gym: Array<GymDelDia & { date: string }>,
  otras: OtherSession[],
  timePerDay: Partial<Record<WeekDay, number>> | null,
): DiaDelPlan[] {
  return WEEK_DAYS.map((weekday, index) => {
    const date = shiftISODate(weekStartISO, index);
    const delGym = gym.find((fila) => fila.date === date) ?? null;
    const bloques = otras
      .filter((otra) => otra.date === date)
      .sort((a, b) => a.orden - b.orden)
      .map((otra) => ({
        discipline: otra.discipline,
        etiqueta: etiquetaDeBloque(otra),
        minutes: otra.minutes,
        orden: otra.orden,
      }));

    const partes: string[] = [];
    if (delGym) {
      partes.push(delGym.muscleGroup, `${delGym.ejercicios} ${delGym.ejercicios === 1 ? "ejercicio" : "ejercicios"}`);
      for (const bloque of bloques) partes.push(`+ ${bloque.etiqueta} ${bloque.minutes} min`);
    } else {
      partes.push(bloques.map((bloque) => `${bloque.etiqueta} ${bloque.minutes} min`).join(" → "));
    }
    const linea = partes.filter((parte) => parte.length > 0).join(" · ") || "Descanso";

    const { date: _date, ...gymSinFecha } = delGym ?? { date: "" };
    return {
      date,
      weekday,
      minutosDeclarados: timePerDay?.[weekday] ?? null,
      gym: delGym ? (gymSinFecha as GymDelDia) : null,
      bloques,
      linea,
    };
  });
}

export type PlanDeSemana = {
  weekStart: string;
  isoWeek: number;
  dias: DiaDelPlan[];
  /** Las sesiones de pesas, listas para materializarse. */
  workouts: PlannedWorkout[];
  otherSessions: OtherSession[];
  avisos: string[];
  firma: string;
};

/**
 * La semana canónica. Pura: el mismo perfil, historial y catálogo dan la
 * misma semana — por eso la vista previa del replanteo puede prometer lo que
 * después se guarda.
 */
export function armarPlanSemana(entrada: {
  training: TrainingProfile;
  cambios: CambiosDeBloque;
  bloquesDelDia: BloquesPorFecha;
  weekStart: Date;
  catalog: ExerciseOption[];
  history: HistoryWorkout[];
  emphasis?: MuscleGroup[];
  minutosGymPorFecha?: Record<string, number>;
}): PlanDeSemana {
  const { training, cambios, bloquesDelDia, weekStart, catalog, history, emphasis } = entrada;

  const semana = generateWeek(training, history, {
    weekStart,
    catalog,
    emphasis,
    minutosGymPorFecha: entrada.minutosGymPorFecha,
  });

  // "Hoy solo squash y natación, sin gym": ese día no hay pesas.
  const workouts = semana.workouts.filter((workout) => !Array.isArray(cambios[workout.date]));
  const conGimnasio = new Set<string>([
    ...workouts.map((workout) => workout.date),
    ...Object.entries(cambios)
      .filter(([, cambio]) => cambio === "PESAS")
      .map(([fecha]) => fecha),
  ]);
  const diasConGimnasio = WEEK_DAYS.filter((_, index) =>
    conGimnasio.has(shiftISODate(semana.weekStart, index)),
  );

  const lunes = new Date(weekStart);
  lunes.setHours(12, 0, 0, 0);
  const otherSessions = completarSesiones({
    planeadas: semana.otherSessions as OtherSession[],
    cambios,
    bloquesDelDia,
    monday: lunes,
    training,
    isoWeek: semana.isoWeek,
    diasConGimnasio,
  });

  return {
    weekStart: semana.weekStart,
    isoWeek: semana.isoWeek,
    dias: diasDelPlan(
      semana.weekStart,
      workouts.map((workout) => ({
        date: workout.date,
        dayKind: workout.dayKind,
        muscleGroup: workout.muscleGroup,
        ejercicios: workout.exercises.length,
        minutos: workout.estimatedMin ?? null,
        recortada: null,
      })),
      otherSessions,
      training.timePerDay,
    ),
    workouts,
    otherSessions,
    avisos: semana.avisos ?? [],
    firma: firmaDelPlan(training),
  };
}
