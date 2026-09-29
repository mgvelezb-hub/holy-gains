import { planDisciplines, type DisciplinePlan } from "@/lib/training/disciplines";
import { isoWeekNumber } from "@/lib/training/schemes";
import { buildSplit, diasDeGimnasio, type InjuryState, type WeekDay } from "@/lib/training/split";
import type { DayKind, TrainingProfile } from "@/lib/training/types";

/**
 * El esqueleto de la semana: qué días hay gimnasio, qué se entrena cada uno y
 * dónde caen las demás disciplinas (I1).
 *
 * EL DEFECTO QUE CIERRA: la semana se calculaba por cuatro caminos —el
 * generador, la reconciliación (`plannedDatesOf`), los avisos de la vista y
 * las disciplinas de la vista (que leían el `dayKind` ya guardado)—, cada uno
 * con su propia copia de "días por horario → presupuesto → split". Bastaba con
 * que uno leyera distinto (el horario sin los minutos, el preset con sus días
 * fijos) para que Rutinas, Ajustes y el Resumen contaran semanas diferentes.
 * Ahora hay una sola función pura; todos llaman a esta.
 *
 * Puro: sin Prisma ni reloj. Mismo perfil y misma semana → mismo esqueleto.
 */
export type EsqueletoDeSemana = {
  isoWeek: number;
  /** Tipos de día, en el orden de `days`. */
  kinds: DayKind[];
  /** Días de gimnasio, en orden de calendario. Un día con 0 min nunca está aquí. */
  days: WeekDay[];
  rehabIndexes: number[];
  injury: InjuryState;
  gymByDay: Map<WeekDay, DayKind>;
  /** Las otras disciplinas ya repartidas, con los minutos que el gym cede. */
  disciplines: DisciplinePlan;
  /** Vecindad del split + lo que las disciplinas no pudieron colocar. */
  avisos: string[];
};

export function esqueletoDeSemana(profile: TrainingProfile, weekStart: Date): EsqueletoDeSemana {
  const inicio = new Date(weekStart);
  inicio.setHours(12, 0, 0, 0);
  const isoWeek = isoWeekNumber(inicio);

  const dias = diasDeGimnasio(profile);
  const split = buildSplit(
    {
      liftingDays: dias.length,
      conditions: profile.conditions,
      avoidRepeatGroups: profile.avoidRepeatGroups,
      customSplit: profile.customSplit,
    },
    { semana: isoWeek, objetivo: profile.goal, dias },
  );
  const days = split.days ?? dias;

  const gymByDay = new Map<WeekDay, DayKind>();
  split.kinds.forEach((kind, index) => {
    const day = days[index];
    if (day) gymByDay.set(day, kind);
  });

  const disciplines = planDisciplines({
    weekStart: inicio,
    otherDisciplines: profile.otherDisciplines,
    gymByDay,
    niveles: profile.disciplineLevels,
    objetivo: profile.goal as never,
    isoWeek,
    timePerDay: profile.timePerDay,
    compactos: profile.compactDays,
    ...(profile.historialCardio ? { historialCardio: profile.historialCardio } : {}),
  });

  return {
    isoWeek,
    kinds: split.kinds,
    days,
    rehabIndexes: split.rehabIndexes,
    injury: split.injury,
    gymByDay,
    disciplines,
    avisos: [...split.avisos, ...disciplines.avisos],
  };
}
