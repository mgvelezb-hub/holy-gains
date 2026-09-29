/**
 * Sincronización app → widgets de iOS (WidgetKit), fase N6.
 *
 * La app ya trae toda esta info al cargar Hoy (`src/app/(tabs)/index.tsx`)
 * y Tu resumen (`src/app/resumen.tsx`); el widget NUNCA hace red — solo lee
 * lo último que se escribió aquí en el App Group `group.com.holygains.app`.
 *
 * Cada campo del payload vive en SU PROPIA llave de `UserDefaults` (no un
 * solo blob JSON). Esto permite que Hoy y Resumen sincronicen cada quien su
 * pedazo sin pisar los campos que el otro ya dejó — `syncWidgetData` solo
 * escribe las llaves presentes en el payload que recibe.
 *
 * iOS-only: en Android es un no-op completo (los widgets nativos de este
 * paquete no existen ahí).
 *
 * IMPORTANTE — contrato compartido con Swift: las llaves de abajo deben
 * coincidir letra por letra con `WidgetData.load()` en
 * `targets/widget/Shared.swift`. Si agregas/renombras un campo, actualiza
 * los dos lados.
 */

import { Platform } from "react-native";
import { ExtensionStorage } from "@bacons/apple-targets";

import { parseTimeHintMinutes, type SiguienteComida } from "@/lib/siguiente-comida";

export { parseTimeHintMinutes };

const APP_GROUP = "group.com.holygains.app";

/**
 * Cada campo es `T | null | undefined`:
 *  - `undefined` (omitido): esta llamada no sabe nada de este campo — se deja
 *    tal cual quedó de la última sincronización (así /resumen, que solo trae
 *    racha, no le borra a Hoy sus campos de entrenamiento/comida).
 *  - `null`: este campo SÍ aplica a esta llamada pero hoy no hay valor (p. ej.
 *    día de descanso) — se borra explícitamente en vez de dejar dato viejo.
 *  - valor: se escribe.
 */
export type WidgetPayload = {
  /** Racha actual en días. */
  racha?: number | null;
  /** Mejor racha histórica en días. */
  mejorRacha?: number | null;
  /** Grupo muscular de hoy, o "Descanso" si no hay sesión. */
  hoyGrupo?: string | null;
  hoyEjercicios?: number | null;
  hoyEsquema?: string | null;
  hoyHecho?: boolean | null;
  /** Nombre del tiempo de comida ya elegido (ver `pickNextMeal`). */
  comidaLabel?: string | null;
  comidaHora?: string | null;
  /** Ya formateados: ["Naranja — 180 g", "Pollo — 150 g"]. TODOS: el widget decide cuántos caben y avisa "+N más". */
  comidaItems?: string[] | null;
  /**
   * La siguiente comida completa (`siguienteComida`), en JSON: renglones con
   * el platillo marcado y las tomas ("Ashwagandha 300 mg"). El widget la
   * prefiere sobre `comidaItems`, que queda para builds viejos del widget.
   */
  comidaDetalle?: SiguienteComida | null;
};

/** `undefined` no toca la llave; `null` la borra; un valor la escribe (transformado por `toStored`). */
function writeField<T>(
  storage: ExtensionStorage,
  key: string,
  value: T | null | undefined,
  toStored: (value: T) => string | number,
): void {
  if (value === undefined) return;
  if (value === null) {
    storage.remove(key);
    return;
  }
  storage.set(key, toStored(value));
}

/**
 * Escribe el payload en el App Group y pide a WidgetKit que repinte.
 * Ver el contrato `undefined` vs `null` vs valor arriba en `WidgetPayload`.
 */
export function syncWidgetData(payload: WidgetPayload): void {
  if (Platform.OS !== "ios") return;

  const storage = new ExtensionStorage(APP_GROUP);

  writeField(storage, "racha", payload.racha, (value) => value);
  writeField(storage, "mejorRacha", payload.mejorRacha, (value) => value);
  writeField(storage, "hoyGrupo", payload.hoyGrupo, (value) => value);
  writeField(storage, "hoyEjercicios", payload.hoyEjercicios, (value) => value);
  writeField(storage, "hoyEsquema", payload.hoyEsquema, (value) => value);
  writeField(storage, "hoyHecho", payload.hoyHecho, (value) => (value ? 1 : 0));
  writeField(storage, "comidaLabel", payload.comidaLabel, (value) => value);
  writeField(storage, "comidaHora", payload.comidaHora, (value) => value);
  writeField(storage, "comidaItems", payload.comidaItems, (value) => value.join("|"));
  writeField(storage, "comidaDetalle", payload.comidaDetalle, (value) => JSON.stringify(value));

  storage.set("actualizado", new Date().toISOString());

  ExtensionStorage.reloadWidget();
}

// ---------------------------------------------------------------------------
// Selección del siguiente tiempo de comida — lógica PURA, sin React ni red.
// ---------------------------------------------------------------------------

export type WidgetMealItem = {
  name: string;
  grams: number;
  free: boolean;
  /** "3 tortillas de maíz", cuando el alimento se sirve por pieza. */
  portion?: string | null;
};

export type WidgetMeal = {
  label: string;
  timeHint: string;
  items: WidgetMealItem[];
};

/** "1 naranja", "Naranja — 180 g" o "Café (libre)", en ese orden de preferencia. */
export function formatMealItem(item: WidgetMealItem): string {
  if (item.free) return `${item.name} (libre)`;
  // En el widget cabe una línea por alimento: gana la unidad en que se sirve.
  return item.portion ? item.portion : `${item.name} — ${item.grams} g`;
}

/**
 * El próximo tiempo de comida a partir de `now`: el primero cuya hora todavía
 * no pasó hoy; si ya pasaron todos, se envuelve al primero del menú (el
 * siguiente día). Si ninguna `timeHint` se puede leer, regresa el primer
 * tiempo del menú tal cual venga — nunca deja el widget vacío por un texto
 * raro del motor.
 */
export function pickNextMeal(meals: WidgetMeal[], now: Date = new Date()): WidgetMeal | null {
  if (meals.length === 0) return null;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const withTimes = meals
    .map((meal) => ({ meal, minutes: parseTimeHintMinutes(meal.timeHint) }))
    .filter((entry): entry is { meal: WidgetMeal; minutes: number } => entry.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes);

  if (withTimes.length === 0) return meals[0] ?? null;

  const upcoming = withTimes.find((entry) => entry.minutes >= nowMinutes);
  return (upcoming ?? withTimes[0])!.meal;
}
