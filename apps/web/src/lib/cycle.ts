import { z } from "zod";

/**
 * Ciclo menstrual — estimación por calendario (Fase 7).
 *
 * Esto **no es un diagnóstico ni un método anticonceptivo**. Es aritmética de
 * calendario sobre dos datos que la atleta escribe: cuándo empezó su último
 * periodo y cuánto le dura el ciclo en promedio. Sirve para una sola cosa:
 * marcar las semanas en las que la retención de líquido distorsiona la cinta,
 * que es lo que el motor ya sabe tratar como "semana no concluyente" (regla R1).
 *
 * Módulo puro: sin IO, sin Prisma, sin `server-only`. Determinista y probable.
 */

export const CYCLE_PHASES_CALENDAR = [
  "MENSTRUACION",
  "FOLICULAR",
  "OVULACION",
  "LUTEA",
] as const;

export type CyclePhaseName = (typeof CYCLE_PHASES_CALENDAR)[number];

/** Duración típica del ciclo: fuera de esta banda la estimación no aplica. */
export const MIN_CYCLE_LENGTH = 21;
export const MAX_CYCLE_LENGTH = 45;
export const DEFAULT_CYCLE_LENGTH = 28;

/** Días de sangrado que asume la estimación. */
const MENSTRUATION_DAYS = 5;
/** La fase lútea es la parte estable del ciclo: ~14 días, casi sin variar. */
const LUTEAL_DAYS = 14;
/** Días a cada lado del día de ovulación que se marcan como ovulación. */
const OVULATION_HALF_WINDOW = 1;

/**
 * Después de este tiempo sin registrar un periodo la cuenta ya no significa
 * nada: mejor no estimar que estimar mal.
 */
const MAX_DAYS_SINCE_PERIOD = 120;
/** A partir de dos ciclos sin actualizar la fecha, la estimación va marcada. */
const STALE_AFTER_CYCLES = 2;

export const CYCLE_ESTIMATE_NOTE =
  "Es una estimación de calendario a partir de las fechas que tú escribiste. " +
  "No es un diagnóstico, no detecta embarazo y no sirve como método anticonceptivo.";

export const CYCLE_OPT_IN_NOTE =
  "Opcional. Ayuda a interpretar tus semanas: en la semana lútea y en la de tu " +
  "periodo la retención de líquido mueve la cinta, y esas semanas no deben " +
  "leerse como estancamiento.";

/** Lo que el módulo necesita del perfil. Sin Prisma de por medio. */
export interface CycleSettings {
  enabled: boolean;
  /** ISO `YYYY-MM-DD` del primer día del último periodo. */
  lastPeriodStart: string | null;
  avgLengthDays: number;
}

export interface CycleEstimate {
  phase: CyclePhaseName;
  /** Día del ciclo, 1-based. */
  dayOfCycle: number;
  /** Ciclos completos transcurridos desde la fecha registrada. */
  cyclesElapsed: number;
  /** La fecha registrada ya tiene varios ciclos encima: pídele que la actualice. */
  stale: boolean;
  /** Siempre `true`: por diseño, esto nunca es una medición. */
  estimated: true;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Días enteros entre dos fechas ISO, contando en UTC para no arrastrar zona. */
export function daysBetweenISO(from: string, to: string): number | null {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return null;
  const a = Date.parse(`${from}T00:00:00.000Z`);
  const b = Date.parse(`${to}T00:00:00.000Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

function clampLength(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CYCLE_LENGTH;
  return Math.min(MAX_CYCLE_LENGTH, Math.max(MIN_CYCLE_LENGTH, Math.round(value)));
}

/**
 * Fase por día del ciclo.
 *
 * Sangrado al inicio; ovulación anclada a 14 días **antes** del siguiente
 * periodo (la mitad estable del ciclo); folicular entre una y otra; lútea al
 * final. En ciclos cortos la ventana de ovulación se recorre para no pisar el
 * sangrado, y la fase folicular puede quedar vacía: es correcto, no un bug.
 */
export function phaseForDay(dayOfCycle: number, avgLengthDays: number): CyclePhaseName {
  const length = clampLength(avgLengthDays);
  const day = Math.min(length, Math.max(1, Math.round(dayOfCycle)));

  const ovulationDay = Math.max(MENSTRUATION_DAYS + 1, length - LUTEAL_DAYS);
  const bleedingDays = Math.min(MENSTRUATION_DAYS, ovulationDay - OVULATION_HALF_WINDOW - 1);

  if (day <= bleedingDays) return "MENSTRUACION";
  if (day >= ovulationDay - OVULATION_HALF_WINDOW && day <= ovulationDay + OVULATION_HALF_WINDOW) {
    return "OVULACION";
  }
  if (day < ovulationDay) return "FOLICULAR";
  return "LUTEA";
}

/**
 * Estimación para una fecha. `null` cuando no hay con qué estimar: tracking
 * apagado, sin fecha registrada, fecha futura, o tan vieja que ya no dice nada.
 */
export function estimateCyclePhase(
  settings: CycleSettings,
  onISODate: string,
): CycleEstimate | null {
  if (!settings.enabled) return null;
  if (!settings.lastPeriodStart) return null;

  const elapsed = daysBetweenISO(settings.lastPeriodStart, onISODate);
  if (elapsed === null || elapsed < 0) return null;
  if (elapsed > MAX_DAYS_SINCE_PERIOD) return null;

  const length = clampLength(settings.avgLengthDays);
  const cyclesElapsed = Math.floor(elapsed / length);
  const dayOfCycle = (elapsed % length) + 1;

  return {
    phase: phaseForDay(dayOfCycle, length),
    dayOfCycle,
    cyclesElapsed,
    stale: cyclesElapsed >= STALE_AFTER_CYCLES,
    estimated: true,
  };
}

/**
 * Fases en las que la medida de la semana no es concluyente. Es exactamente el
 * criterio de la regla R1 del motor; aquí solo se nombra para la UI.
 */
export function isInconclusivePhase(phase: CyclePhaseName | null | undefined): boolean {
  return phase === "LUTEA" || phase === "MENSTRUACION";
}

/**
 * Nota suave para el modo gimnasio. **No cambia la rutina**: el generador no se
 * entera de esto. Es texto, y solo en la semana del periodo.
 */
export function cycleNote(phase: CyclePhaseName | null | undefined): string | null {
  if (phase !== "MENSTRUACION") return null;
  return "Semana de escuchar al cuerpo: si lo necesitas, baja pesos o series. No pasa nada.";
}

/**
 * Los tres campos del perfil, sin arrastrar el tipo de Prisma hasta aquí. Es
 * estructural a propósito: `lib/cycle.ts` no depende de la base.
 */
export interface ProfileCycleFields {
  cycleTrackingEnabled: boolean;
  cycleLastPeriodStart: Date | null;
  cycleAvgLength: number;
}

/**
 * Una columna `date` de Postgres llega como medianoche UTC: leerla con la hora
 * local la corría un día hacia atrás en México (el periodo del 5 salía el 4).
 */
function toISODateUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function cycleSettingsFromProfile(profile: ProfileCycleFields): CycleSettings {
  return {
    enabled: profile.cycleTrackingEnabled,
    lastPeriodStart: profile.cycleLastPeriodStart
      ? toISODateUTC(profile.cycleLastPeriodStart)
      : null,
    avgLengthDays: profile.cycleAvgLength || DEFAULT_CYCLE_LENGTH,
  };
}

/**
 * Atajo para el modo gimnasio: de perfil a nota, en una línea.
 *
 * Devuelve texto o `null`, nunca la fase. Quien lo llame no se entera de en qué
 * parte del ciclo va nadie: solo recibe una frase que puede pintar o no.
 *
 * Uso previsto en `lib/training/view.ts`:
 *
 * ```ts
 * cycleNote: cycleNoteForProfile(profile, isoDate)
 * ```
 */
export function cycleNoteForProfile(
  profile: ProfileCycleFields,
  onISODate: string,
): string | null {
  const estimate = estimateCyclePhase(cycleSettingsFromProfile(profile), onISODate);
  return cycleNote(estimate?.phase ?? null);
}

export const CYCLE_PHASE_LABELS: Record<CyclePhaseName, string> = {
  MENSTRUACION: "Menstruación",
  FOLICULAR: "Folicular",
  OVULACION: "Ovulación",
  LUTEA: "Lútea",
};

// ---------------------------------------------------------------------------
// Entrada del formulario
// ---------------------------------------------------------------------------

/**
 * Los tres campos del opt-in. Viven aquí y no en `validation/onboarding.ts`
 * porque el mismo bloque se usa en el onboarding y en el check-in.
 */
export const cycleSettingsSchema = z.object({
  cycleTrackingEnabled: z.boolean().default(false),
  cycleLastPeriodStart: z.iso.date("Fecha inválida").nullable().optional(),
  cycleAvgLength: z
    .number()
    .int()
    .min(MIN_CYCLE_LENGTH, `Mínimo ${MIN_CYCLE_LENGTH} días`)
    .max(MAX_CYCLE_LENGTH, `Máximo ${MAX_CYCLE_LENGTH} días`)
    .default(DEFAULT_CYCLE_LENGTH),
});

export type CycleSettingsInput = z.infer<typeof cycleSettingsSchema>;

/** Normaliza el FormData (todo strings) a lo que espera el schema. */
export function coerceCycleSettings(raw: Record<string, unknown>): unknown {
  const enabled =
    raw.cycleTrackingEnabled === true ||
    raw.cycleTrackingEnabled === "on" ||
    raw.cycleTrackingEnabled === "true";

  const rawLength = raw.cycleAvgLength;
  const parsedLength =
    rawLength === null || rawLength === undefined || rawLength === ""
      ? DEFAULT_CYCLE_LENGTH
      : Number(String(rawLength));

  const start = raw.cycleLastPeriodStart;

  return {
    cycleTrackingEnabled: enabled,
    cycleLastPeriodStart: typeof start === "string" && start !== "" ? start : null,
    cycleAvgLength: Number.isFinite(parsedLength) ? Math.round(parsedLength) : Number.NaN,
  };
}

/**
 * Parseo tolerante: si el bloque opcional viene incompleto o roto, se ignora en
 * vez de tumbar el formulario entero. El ciclo nunca debe impedir un check-in.
 */
export function parseCycleSettings(raw: Record<string, unknown>): CycleSettingsInput | null {
  const result = cycleSettingsSchema.safeParse(coerceCycleSettings(raw));
  return result.success ? result.data : null;
}
