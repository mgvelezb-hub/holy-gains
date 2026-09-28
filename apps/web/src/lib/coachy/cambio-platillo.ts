import type { Prisma } from "@prisma/client";
import { FOODS, cambiarPlatillo, opcionesDePlatillo } from "engine";
import type { Food, MenuMeal, OpcionDePlatillo, Profile as EngineProfile } from "engine";

/**
 * Cambiar el platillo de una comida ya guardada: sopa por sopa, crema o
 * caldo; licuado por licuado.
 *
 * Menú 1 de Mau: tocar "cambiar" dentro de la sopa de lentejas ofrecía cosas
 * que no eran sopa. Lo que se espera es cambiar LA SOPA por otra sopa y que
 * lo que la acompaña se ajuste. El motor decide qué platillos caben y arma
 * la comida nueva con su mismo solver; aquí solo se localiza la comida en el
 * JSON guardado y se reescribe. Pura: sin Prisma, se prueba sin base.
 */

export class CambioPlatilloError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CambioPlatilloError";
  }
}

type JsonRecord = Record<string, unknown>;

function asRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? (value as JsonRecord[]) : [];
}

function localiza(mealsJson: Prisma.JsonValue, slot: string) {
  const meals = asRecordArray(mealsJson);
  const index = meals.findIndex((meal) => meal.slot === slot);
  if (index === -1) throw new CambioPlatilloError(`No existe la comida "${slot}" en este menú.`);
  const meal = meals[index]!;
  if (typeof meal.preparacion !== "object" || meal.preparacion === null) {
    throw new CambioPlatilloError(`La comida "${slot}" no trae un platillo que cambiar.`);
  }
  // Lo que hay en las otras comidas del día: el platillo nuevo no repite su
  // proteína principal ni su cereal.
  const enElDia = meals
    .filter((_, i) => i !== index)
    .flatMap((otra) => asRecordArray(otra.items))
    .map((item) => String(item.foodId ?? item.name ?? ""))
    .filter((valor) => valor !== "");
  return { meals, index, meal: meal as unknown as MenuMeal, enElDia };
}

/** Los platillos por los que se puede cambiar el de esa comida. */
export function opcionesDePlatilloGuardado(
  mealsJson: Prisma.JsonValue,
  slot: string,
  profile: EngineProfile,
  catalogo: Food[] = FOODS,
): OpcionDePlatillo[] {
  const { meal, enElDia } = localiza(mealsJson, slot);
  return opcionesDePlatillo({ meal, profile, pool: catalogo, enElDia });
}

export interface CambioPlatilloResult {
  mealsJson: Prisma.JsonValue;
  equivalencesJson: Prisma.JsonValue;
}

/**
 * Reemplaza el platillo de la comida. La copia aplanada de equivalencias se
 * rehace para ese slot desde la comida nueva; las de los demás slots no se
 * tocan.
 */
export function aplicaCambioDePlatillo(
  mealsJson: Prisma.JsonValue,
  equivalencesJson: Prisma.JsonValue,
  input: { slot: string; preparacionId: string },
  profile: EngineProfile,
  catalogo: Food[] = FOODS,
): CambioPlatilloResult {
  const { meals, index, meal, enElDia } = localiza(mealsJson, input.slot);
  const nueva = cambiarPlatillo({
    meal,
    profile,
    pool: catalogo,
    enElDia,
    preparacionId: input.preparacionId,
  });
  if (nueva === null) {
    throw new CambioPlatilloError(`Ese platillo no cabe en "${input.slot}".`);
  }

  // Lo que la comida guardada traía y el motor no maneja (el `allowDenseCarb`
  // de la vista) se conserva.
  const conservada: JsonRecord = { ...meals[index], ...(nueva as unknown as JsonRecord) };
  const newMeals = meals.map((entry, i) => (i === index ? conservada : entry));

  const flat = asRecordArray(equivalencesJson).filter((entry) => entry.slot !== input.slot);
  const newFlat = [
    ...flat,
    ...nueva.equivalences.map((equivalence) => ({ slot: input.slot, ...equivalence })),
  ];

  return {
    mealsJson: newMeals as unknown as Prisma.JsonValue,
    equivalencesJson: newFlat as unknown as Prisma.JsonValue,
  };
}
