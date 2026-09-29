import type { Prisma } from "@prisma/client";
import { MENU_ENGINE_VERSION } from "engine";

/**
 * Con qué reglas del motor se armó un menú guardado.
 *
 * `MealPlan.mealsJson` es la lista de comidas tal como la entrega el motor;
 * sin columna nueva, la versión viaja DENTRO de cada comida (`versionMotor`),
 * junto con la semilla con la que se generó (`semillaMenu`), para que rehacer
 * el menú use exactamente la misma. Los que modifican una comida guardada
 * (intercambio de equivalencia, cambio de platillo, relleno de
 * equivalencias) copian la comida con `...meal`, así que las llaves se
 * quedan.
 *
 * Un menú sin `versionMotor` es de antes de guardarla: versión 1.
 *
 * `menuPorReglasNuevas` marca que el menú se rehízo solo porque subió
 * `MENU_ENGINE_VERSION`; mientras esté, el plan trae el aviso para la persona.
 * La siguiente generación normal (check-in, regenerar, despensa) lo quita.
 *
 * Pura: se prueba sin base.
 */

export const AVISO_MENU_ACTUALIZADO = "Tu menú se actualizó con las reglas nuevas";

type JsonRecord = Record<string, unknown>;

function comidas(mealsJson: unknown): JsonRecord[] {
  return Array.isArray(mealsJson)
    ? mealsJson.filter((meal): meal is JsonRecord => typeof meal === "object" && meal !== null)
    : [];
}

/** La versión más vieja entre las comidas del menú; 1 si alguna no la trae. */
export function versionDelMenu(mealsJson: unknown): number {
  const lista = comidas(mealsJson);
  if (lista.length === 0) return 1;
  return Math.min(
    ...lista.map((meal) => (typeof meal.versionMotor === "number" ? meal.versionMotor : 1)),
  );
}

/** La semilla con la que se generó el menú, si la guardó. */
export function semillaGuardada(mealsJson: unknown): number | null {
  const semilla = comidas(mealsJson)[0]?.semillaMenu;
  return typeof semilla === "number" ? semilla : null;
}

/** Las comidas del motor, con la versión vigente y la semilla con la que salieron. */
export function sellaMenu<T extends object>(
  meals: T[],
  sello: { semilla: number; porReglasNuevas?: boolean },
): Array<T & { versionMotor: number; semillaMenu: number; menuPorReglasNuevas?: true }> {
  return meals.map((meal) => ({
    ...meal,
    versionMotor: MENU_ENGINE_VERSION,
    semillaMenu: sello.semilla,
    ...(sello.porReglasNuevas === true ? { menuPorReglasNuevas: true as const } : {}),
  }));
}

/** ¿Algún menú guardado es de reglas más viejas que las del motor? */
export function menusDesactualizados(plans: ReadonlyArray<{ mealsJson: Prisma.JsonValue | unknown }>): boolean {
  return plans.some((plan) => versionDelMenu(plan.mealsJson) < MENU_ENGINE_VERSION);
}

/** El aviso para la persona si sus menús se rehicieron por las reglas nuevas. */
export function avisoDeMenuActualizado(
  plans: ReadonlyArray<{ mealsJson: Prisma.JsonValue | unknown }>,
): string | null {
  const rehecho = plans.some((plan) =>
    comidas(plan.mealsJson).some((meal) => meal.menuPorReglasNuevas === true),
  );
  return rehecho ? AVISO_MENU_ACTUALIZADO : null;
}
