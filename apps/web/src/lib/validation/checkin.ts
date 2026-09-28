import { z } from "zod";

/**
 * Validación del check-in semanal (spec 03 §2.1).
 * Cuatro pasos: medidas → fotos → sensaciones → cumplimiento/síntomas.
 */

/** Medida corporal en cm: un decimal, rango fisiológico razonable. */
const measurementCm = z
  .number({ message: "Escribe un número" })
  .min(10, "Muy bajo para ser una medida en cm")
  .max(250, "Muy alto para ser una medida en cm")
  .multipleOf(0.1, "Máximo un decimal");

const scale1to5 = z
  .number({ message: "Elige un valor" })
  .int()
  .min(1, "Mínimo 1")
  .max(5, "Máximo 5");

const percent = z
  .number({ message: "Escribe un porcentaje" })
  .int()
  .min(0, "Mínimo 0%")
  .max(100, "Máximo 100%");

export const STRENGTH_TRENDS = ["SUBE", "IGUAL", "BAJA"] as const;
export const CYCLE_PHASES = ["FOLICULAR", "OVULACION", "LUTEA", "MENSTRUACION", "NA"] as const;
export const PHOTO_VIEWS = ["FRENTE", "PERFIL", "ESPALDA"] as const;

/** Chips de síntoma de la spec, más `otro` como texto libre. */
export const SYMPTOMS = [
  "calambres",
  "mareo",
  "dolor_espalda",
  "dolor_pie",
  "dolor_cabeza",
  "estrenimiento",
  "inflamacion_abdominal",
  "otro",
] as const;

export const SYMPTOM_LABELS: Record<(typeof SYMPTOMS)[number], string> = {
  calambres: "Calambres",
  mareo: "Mareo",
  dolor_espalda: "Dolor de espalda",
  dolor_pie: "Dolor de pie",
  dolor_cabeza: "Dolor de cabeza",
  estrenimiento: "Estreñimiento",
  inflamacion_abdominal: "Inflamación abdominal",
  otro: "Otro",
};

/** Paso 1 — medidas. Cintura es el KPI: es el único obligatorio. */
export const measurementsStepSchema = z.object({
  date: z.iso.date("Fecha inválida"),
  waistCm: measurementCm,
  weightKg: z
    .number()
    .min(25, "Muy bajo")
    .max(400, "Muy alto")
    .multipleOf(0.1, "Máximo un decimal")
    .nullable()
    .optional(),
  legLeftCm: measurementCm.nullable().optional(),
  legRightCm: measurementCm.nullable().optional(),
  armLeftCm: measurementCm.nullable().optional(),
  armRightCm: measurementCm.nullable().optional(),
});

/** Paso 3 — sensaciones. */
export const sensationsStepSchema = z.object({
  inflammation: scale1to5,
  energy: scale1to5,
  hunger: scale1to5,
  satiety: scale1to5,
  /**
   * Descanso 1-5.
   *
   * Opcional desde que el reloj sube los minutos exactos de cada noche: la app
   * nativa ya no lo pregunta y el servidor lo deriva de `health_days` (ver
   * `sleepScoreFor` en lib/health/db.ts). El formulario web todavía lo manda,
   * y quien no traiga reloj puede seguir escribiéndolo.
   *
   * `nullable` además de `optional` porque `coerceCheckInPayload` convierte
   * lo que no viene en `null`, y un `null` no pasa por `optional()`: la app
   * nativa mandaba el check-in completo y el servidor lo rechazaba por un
   * campo que la pantalla ni muestra ("Revisa los campos marcados" con todo
   * lleno).
   */
  sleep: scale1to5.nullable().optional(),
  strengthRpe: z.number().int().min(1).max(10).nullable().optional(),
  strengthTrend: z.enum(STRENGTH_TRENDS).nullable().optional(),
});

/** Paso 4 — cumplimiento, síntomas, ciclo y comentario. */
export const complianceStepSchema = z.object({
  dietCompliance: percent,
  trainingCompliance: percent,
  symptoms: z.array(z.enum(SYMPTOMS)).max(SYMPTOMS.length).default([]),
  otherSymptom: z.string().trim().max(120).optional(),
  cyclePhase: z.enum(CYCLE_PHASES).nullable().optional(),
  /**
   * "Esta semana empezó mi periodo" (Fase 7). No se guarda en el check-in: es
   * la señal que reancla `profiles.cycle_last_period_start`, y con eso la
   * estimación de calendario vuelve a servir.
   */
  periodStarted: z.boolean().default(false),
  comment: z.string().trim().max(2000, "Máximo 2000 caracteres").optional(),
});

/** Check-in completo. Es lo que valida la server action antes de escribir. */
export const checkInSchema = measurementsStepSchema
  .extend(sensationsStepSchema.shape)
  .extend(complianceStepSchema.shape);

export type CheckInInput = z.infer<typeof checkInSchema>;
export type MeasurementsStep = z.infer<typeof measurementsStepSchema>;
export type SensationsStep = z.infer<typeof sensationsStepSchema>;
export type ComplianceStep = z.infer<typeof complianceStepSchema>;

export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic"];

export type PhotoValidation = { ok: true } | { ok: false; error: string };

/** Las fotos son opcionales, pero si vienen deben ser imágenes y no gigantes. */
export function validatePhotoFile(file: { size: number; type: string }): PhotoValidation {
  if (file.size === 0) return { ok: false, error: "El archivo está vacío" };
  if (file.size > MAX_PHOTO_BYTES) {
    return { ok: false, error: "La foto pesa más de 8 MB" };
  }
  if (file.type && !ALLOWED_PHOTO_TYPES.includes(file.type)) {
    return { ok: false, error: `Formato no soportado: ${file.type}` };
  }
  return { ok: true };
}

/**
 * Convierte el objeto plano del formulario (todo strings) a los tipos que
 * espera `checkInSchema`. Los vacíos se vuelven null, no 0.
 */
export function coerceCheckInPayload(raw: Record<string, unknown>): unknown {
  const num = (value: unknown): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = typeof value === "number" ? value : Number(String(value).replace(",", "."));
    return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : Number.NaN;
  };
  const int = (value: unknown): number | null => {
    const parsed = num(value);
    return parsed === null ? null : Math.round(parsed);
  };

  return {
    date: raw.date,
    waistCm: num(raw.waistCm),
    weightKg: num(raw.weightKg),
    legLeftCm: num(raw.legLeftCm),
    legRightCm: num(raw.legRightCm),
    armLeftCm: num(raw.armLeftCm),
    armRightCm: num(raw.armRightCm),
    inflammation: int(raw.inflammation),
    energy: int(raw.energy),
    hunger: int(raw.hunger),
    satiety: int(raw.satiety),
    sleep: int(raw.sleep),
    strengthRpe: int(raw.strengthRpe),
    strengthTrend: raw.strengthTrend === "" ? null : raw.strengthTrend,
    dietCompliance: int(raw.dietCompliance),
    trainingCompliance: int(raw.trainingCompliance),
    symptoms: Array.isArray(raw.symptoms) ? raw.symptoms : [],
    otherSymptom: typeof raw.otherSymptom === "string" ? raw.otherSymptom : undefined,
    cyclePhase: raw.cyclePhase === "" ? null : raw.cyclePhase,
    periodStarted: raw.periodStarted === true || raw.periodStarted === "on",
    comment: typeof raw.comment === "string" ? raw.comment : undefined,
  };
}
