import type { MenuMeal } from "@/lib/api";
import type { PlanNutricion } from "@/lib/api-nutricion";

/**
 * "Mis comidas hoy" y la hoja de cada comida — lógica PURA.
 *
 * Antes leían `menus[0]` con la hora general: el día que se come el menú 2,
 * o un martes con otro horario, la hoja decía otra cosa que el plan. El plan
 * canónico ya trae `hoy.comidas` (el menú del día, la hora efectiva de hoy) y
 * `menuDeHoy`; aquí solo se lee.
 */

export type FilaDeHoy = { slot: string; label: string; hora: string };

/** Las comidas de hoy, en su orden y con la hora que rige hoy. */
export function filasDeHoy(plan: Pick<PlanNutricion, "hoy">): FilaDeHoy[] {
  return plan.hoy.comidas.map(({ slot, label, hora }) => ({ slot, label, hora }));
}

/** La comida de ese slot en el menú de hoy, con la hora de hoy. */
export function comidaDeHoy(
  plan: Pick<PlanNutricion, "hoy" | "menus" | "menuDeHoy">,
  slot: string,
): { meal: MenuMeal | null; hora: string | null } {
  const menu = plan.menus.find((m) => m.menuNumber === plan.menuDeHoy) ?? plan.menus[0] ?? null;
  const meal = menu?.meals.find((m) => m.slot === slot) ?? null;
  const hora = plan.hoy.comidas.find((c) => c.slot === slot)?.hora ?? meal?.timeHint ?? null;
  return { meal, hora };
}
