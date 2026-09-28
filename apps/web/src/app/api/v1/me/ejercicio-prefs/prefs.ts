import { z } from "zod";

/**
 * Cómo está montado cada ejercicio en el gimnasio de esta persona — lógica
 * pura de `PATCH /api/v1/me/ejercicio-prefs`, aparte para probarla sin base.
 *
 * `Profile.exercisePrefs = {[exerciseId]: {cargaPorLado, barraKg}}`. Con
 * `cargaPorLado` el teléfono deja teclear lo que se puso de UN lado y calcula
 * el total (lado × 2 + barra); se pregunta una vez por ejercicio y se
 * recuerda. En `WorkoutSet.weightKg` se sigue guardando el total.
 */

export type Montaje = { cargaPorLado: boolean; barraKg: number };

export const ejercicioPrefsSchema = z.object({
  exerciseId: z.string().trim().min(1).max(120),
  cargaPorLado: z.boolean(),
  // Una barra olímpica pesa 20 kg y el carro de una prensa hasta ~50: 100 kg
  // es un techo holgado que igual detiene un número tecleado en libras × 10.
  barraKg: z.number().finite().min(0).max(100),
});

export type EjercicioPrefsInput = z.infer<typeof ejercicioPrefsSchema>;

/** Lo guardado, descartando lo que no tenga la forma: la columna es JSON libre. */
export function leeMontajes(valor: unknown): Record<string, Montaje> {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) return {};
  const salida: Record<string, Montaje> = {};
  for (const [id, crudo] of Object.entries(valor as Record<string, unknown>)) {
    if (typeof crudo !== "object" || crudo === null) continue;
    const { cargaPorLado, barraKg } = crudo as Record<string, unknown>;
    if (typeof cargaPorLado !== "boolean") continue;
    if (typeof barraKg !== "number" || !Number.isFinite(barraKg) || barraKg < 0) continue;
    salida[id] = { cargaPorLado, barraKg };
  }
  return salida;
}

/** Guarda el montaje de un ejercicio sin tocar los demás. */
export function conMontaje(
  previos: Record<string, Montaje>,
  entrada: EjercicioPrefsInput,
): Record<string, Montaje> {
  return {
    ...previos,
    [entrada.exerciseId]: { cargaPorLado: entrada.cargaPorLado, barraKg: entrada.barraKg },
  };
}

/**
 * Años cumplidos, para estimar la FC máxima del descanso por pulso. Con solo
 * el rango declarado ("35_44") se usa su punto medio; sin nada, `null` y el
 * teléfono se queda con la FC en reposo.
 */
export function edadEnAnios(
  birthDate: Date | null,
  ageRange: string | null,
  hoy: Date = new Date(),
): number | null {
  if (birthDate) {
    let anios = hoy.getUTCFullYear() - birthDate.getUTCFullYear();
    const mes = hoy.getUTCMonth() - birthDate.getUTCMonth();
    if (mes < 0 || (mes === 0 && hoy.getUTCDate() < birthDate.getUTCDate())) anios -= 1;
    return anios > 0 ? anios : null;
  }
  const rango = /^(\d{2})_(\d{2})$/.exec(ageRange ?? "");
  if (rango) return Math.round((Number(rango[1]) + Number(rango[2]) + 1) / 2);
  return null;
}
