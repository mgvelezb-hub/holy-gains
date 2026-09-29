import AsyncStorage from "@react-native-async-storage/async-storage";

import { corredorGuardado, type CorredorCardio } from "@/lib/cardio";

/**
 * Dónde vas en el cardio y qué cardio ya quedó hecho, en el teléfono (N2).
 *
 * Mismo patrón que `sesion-en-curso.ts` para las pesas: salir a contestar un
 * mensaje desmonta la pantalla, y sin el cursor el HIIT volvía al minuto 0.
 * Se guarda solo el CURSOR (horas absolutas), nada que no se pueda perder sin
 * consecuencias — por eso todo falla en silencio.
 *
 * "Hecho" es el respaldo local de "ya lo registraste hoy": si la lista de
 * actividades no llega (sin señal), la hoja igual dice "Hecho · 15 min".
 */

const LLAVE_CURSOR = "holygains.cardio.encurso";
const LLAVE_HECHO = "holygains.cardio.hecho";

export async function guardaCardioEnCurso(estado: CorredorCardio): Promise<void> {
  try {
    await AsyncStorage.setItem(LLAVE_CURSOR, JSON.stringify(estado));
  } catch {
    // Perder el cursor solo cuesta volver a empezar el tramo.
  }
}

/** Lo guardado, solo si es de esa fecha y cabe en el plan de hoy. */
export async function leeCardioEnCurso(fecha: string, totalPasos: number): Promise<CorredorCardio | null> {
  try {
    const crudo = await AsyncStorage.getItem(LLAVE_CURSOR);
    return crudo ? corredorGuardado(JSON.parse(crudo), fecha, totalPasos) : null;
  } catch {
    return null;
  }
}

export async function olvidaCardioEnCurso(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LLAVE_CURSOR);
  } catch {
    // Sin consecuencias: `leeCardioEnCurso` filtra por fecha.
  }
}

/** Anota que el cardio de `fecha` quedó hecho, con sus minutos. Solo se guarda el último día. */
export async function marcaCardioHecho(fecha: string, minutos: number): Promise<void> {
  try {
    await AsyncStorage.setItem(LLAVE_HECHO, JSON.stringify({ fecha, minutos }));
  } catch {
    // La lista de actividades del servidor lo dice igual cuando haya señal.
  }
}

export async function leeCardioHecho(fecha: string): Promise<number | null> {
  try {
    const crudo = await AsyncStorage.getItem(LLAVE_HECHO);
    if (!crudo) return null;
    const leido = JSON.parse(crudo) as { fecha?: unknown; minutos?: unknown };
    return leido.fecha === fecha && typeof leido.minutos === "number" ? leido.minutos : null;
  } catch {
    return null;
  }
}
