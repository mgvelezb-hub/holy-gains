import type { Prisma } from "@prisma/client";
import { FOODS, maxGrams, normalize } from "engine";
import type { Food } from "engine";

/**
 * Transformación pura de un intercambio de equivalencia sobre el JSON del
 * motor (`MealPlan.mealsJson` / `equivalencesJson`).
 *
 * Antes, elegir una equivalencia en el menú era de solo lectura: la app
 * mostraba la opción pero nada se guardaba, así que un refresh la perdía. Esta
 * función es el corazón de que el cambio SÍ se quede — la usa
 * `POST /api/v1/nutricion/swap`, que solo se encarga de cargar/guardar con
 * Prisma; la transformación en sí no sabe nada de la base, así que se prueba
 * sin levantar Postgres.
 *
 * El intercambio es REVERSIBLE a propósito: la opción elegida se reemplaza en
 * la equivalencia por el alimento que salió, con sus gramos originales — así
 * volver a tocar "cambiar" y elegir el original regresa exactamente a donde
 * estaba. Nunca se inventan gramos: los que entran son siempre los que ya
 * traía la opción elegida en el JSON guardado.
 */

export class SwapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SwapError";
  }
}

export interface SwapInput {
  slot: string;
  forName: string;
  toName: string;
}

export interface SwapResult {
  mealsJson: Prisma.JsonValue;
  equivalencesJson: Prisma.JsonValue;
  /**
   * Si el alimento elegido ya estaba en la comida, el cambio se SUMA a ese
   * renglón en vez de repetirlo, y aquí se dice: "Ya había aguacate: se sumó
   * (95 g)" o, si pasó del tope, que se recortó.
   */
  aviso?: string;
}

type JsonRecord = Record<string, unknown>;

function asRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? (value as JsonRecord[]) : [];
}

/**
 * Aplica el intercambio sobre el JSON guardado y regresa las dos copias ya
 * actualizadas (`mealsJson` completo y `equivalencesJson` aplanado). Lanza
 * `SwapError` — nunca inventa un hueco — si el `slot`, el `forName` o el
 * `toName` no existen tal cual en lo guardado.
 */
export function applySwap(
  mealsJson: Prisma.JsonValue,
  equivalencesJson: Prisma.JsonValue,
  input: SwapInput,
  /** El catálogo de la persona (con sus alimentos propios), para el tope de porción. */
  catalogo: Food[] = FOODS,
): SwapResult {
  const meals = asRecordArray(mealsJson);
  const meal = meals.find((entry) => entry.slot === input.slot);
  if (!meal) {
    throw new SwapError(`No existe la comida "${input.slot}" en este menú.`);
  }

  const items = asRecordArray(meal.items);
  const itemIndex = items.findIndex((item) => item.name === input.forName);
  if (itemIndex === -1) {
    throw new SwapError(`"${input.forName}" no está en la comida "${input.slot}".`);
  }
  const item = items[itemIndex]!;

  const equivalences = asRecordArray(meal.equivalences);
  const equivIndex = equivalences.findIndex((entry) => entry.forName === input.forName);
  if (equivIndex === -1) {
    throw new SwapError(`"${input.forName}" no tiene equivalencias en la comida "${input.slot}".`);
  }
  const equivalence = equivalences[equivIndex]!;

  const options = asRecordArray(equivalence.options);
  const optionIndex = options.findIndex((option) => option.name === input.toName);
  if (optionIndex === -1) {
    throw new SwapError(`"${input.toName}" no es una opción para "${input.forName}".`);
  }
  const option = options[optionIndex]!;

  const originalName = item.name;
  const originalGrams = item.grams;
  // El id del alimento viaja en los dos sentidos. Sin él, un alimento
  // intercambiado quedaba sin `foodId` y la lista de súper —que agrupa por
  // id— metía a todos los intercambiados en la misma cubeta y sumaba sus
  // gramos entre sí.
  const originalFoodId = item.foodId;

  // El item se vuelve la elección: la equivalencia deja de ser lectura.
  // `free` se hereda del alimento que sale: un vegetal libre intercambiado por
  // otro vegetal libre sigue siendo libre — la etiqueta "libre" describe el
  // hueco (cantidad sin contar), no al alimento concreto que lo ocupa.
  const newItem: JsonRecord = {
    ...(option.foodId !== undefined ? { foodId: option.foodId } : {}),
    name: option.name,
    grams: option.grams,
    free: item.free === true,
  };
  // ¿El alimento elegido ya está en esta comida? Entonces no es un renglón
  // nuevo: es más de lo mismo. Se suma a ese renglón —respetando el tope de
  // su porción— y el renglón que se cambió desaparece.
  const repetidoIndex = items.findIndex(
    (entry, index) => index !== itemIndex && mismoAlimento(entry, option),
  );
  if (repetidoIndex !== -1) {
    return fusionar({
      meals,
      meal,
      items,
      equivalences,
      equivalencesJson,
      input,
      itemIndex,
      repetidoIndex,
      gramosQueLlegan: Number(option.grams ?? 0),
      catalogo,
    });
  }

  const newItems = items.map((entry, index) => (index === itemIndex ? newItem : entry));

  // La equivalencia de ese hueco ahora se busca desde la elección, y la
  // opción que se tomó se reemplaza por el alimento original — así la
  // próxima vez que se abra, "volver" está entre las opciones.
  const newOptions = options.map((entry, index) =>
    index === optionIndex
      ? {
          ...(originalFoodId !== undefined ? { foodId: originalFoodId } : {}),
          name: originalName,
          grams: originalGrams,
        }
      : entry,
  );
  const newEquivalence: JsonRecord = { ...equivalence, forName: option.name, options: newOptions };
  const newEquivalences = equivalences.map((entry, index) =>
    index === equivIndex ? newEquivalence : entry,
  );

  const newMeal: JsonRecord = { ...meal, items: newItems, equivalences: newEquivalences };
  const newMeals = meals.map((entry) => (entry === meal ? newMeal : entry));

  // `equivalencesJson` es la copia aplanada con `slot` — mismo intercambio,
  // localizado por slot + forName. Si no está (JSON viejo o inconsistente),
  // se deja tal cual: `mealsJson` ya es la fuente de verdad de la vista.
  const flat = asRecordArray(equivalencesJson);
  const flatIndex = flat.findIndex(
    (entry) => entry.slot === input.slot && entry.forName === input.forName,
  );
  const newFlat =
    flatIndex === -1
      ? flat
      : flat.map((entry, index) =>
          index === flatIndex ? { ...entry, forName: option.name, options: newOptions } : entry,
        );

  return {
    mealsJson: newMeals as unknown as Prisma.JsonValue,
    equivalencesJson: newFlat as unknown as Prisma.JsonValue,
  };
}

/** El mismo alimento: por id si los dos lo traen, si no por nombre. */
function mismoAlimento(a: JsonRecord, b: JsonRecord): boolean {
  if (typeof a.foodId === "string" && typeof b.foodId === "string") return a.foodId === b.foodId;
  return normalize(String(a.name ?? "")) === normalize(String(b.name ?? ""));
}

function alimentoDelCatalogo(item: JsonRecord, catalogo: Food[]): Food | undefined {
  const nombre = normalize(String(item.name ?? ""));
  return (
    catalogo.find((food) => food.id === item.foodId) ??
    catalogo.find((food) => normalize(food.name) === nombre)
  );
}

function redondea1(valor: number): number {
  return Math.round(valor * 10) / 10;
}

/**
 * Suma el alimento elegido al renglón donde ya estaba. Los gramos se topan al
 * máximo de su porción (el catálogo manda); los macros del renglón se
 * recalculan, y las opciones de su equivalencia se escalan a los gramos
 * nuevos para que "cambiar" siga ofreciendo lo equivalente a lo que hay.
 */
function fusionar(args: {
  meals: JsonRecord[];
  meal: JsonRecord;
  items: JsonRecord[];
  equivalences: JsonRecord[];
  equivalencesJson: Prisma.JsonValue;
  input: SwapInput;
  itemIndex: number;
  repetidoIndex: number;
  gramosQueLlegan: number;
  catalogo: Food[];
}): SwapResult {
  const { meals, meal, items, equivalences, input, itemIndex, repetidoIndex, catalogo } = args;
  const repetido = items[repetidoIndex]!;
  const antes = Number(repetido.grams ?? 0);
  const food = alimentoDelCatalogo(repetido, catalogo);
  const tope = food ? maxGrams(food) : Number.POSITIVE_INFINITY;
  const suma = antes + args.gramosQueLlegan;
  const gramos = Math.round(Math.min(suma, tope));
  const recortado = suma > tope;

  const fusionado: JsonRecord = {
    ...(repetido.foodId !== undefined ? { foodId: repetido.foodId } : {}),
    name: repetido.name,
    grams: gramos,
    free: repetido.free === true,
    ...(repetido.preparacion !== undefined ? { preparacion: repetido.preparacion } : {}),
    ...(food
      ? {
          proteinG: redondea1((food.proteinPer100 * gramos) / 100),
          carbG: redondea1((food.carbPer100 * gramos) / 100),
          fatG: redondea1((food.fatPer100 * gramos) / 100),
          fiberG: redondea1((food.fiberPer100 * gramos) / 100),
          kcal: Math.round((food.kcalPer100 * gramos) / 100),
        }
      : {}),
  };

  const newItems = items
    .map((entry, index) => (index === repetidoIndex ? fusionado : entry))
    .filter((_, index) => index !== itemIndex);

  const factor = antes > 0 ? gramos / antes : 1;
  const escalar = (entry: JsonRecord): JsonRecord =>
    entry.forName === repetido.name
      ? {
          ...entry,
          options: asRecordArray(entry.options).map((option) => ({
            ...option,
            grams: Math.round(Number(option.grams ?? 0) * factor),
          })),
        }
      : entry;
  const newEquivalences = equivalences
    .filter((entry) => entry.forName !== input.forName)
    .map(escalar);

  const newMeal: JsonRecord = { ...meal, items: newItems, equivalences: newEquivalences };
  const newMeals = meals.map((entry) => (entry === meal ? newMeal : entry));

  const flat = asRecordArray(args.equivalencesJson);
  const newFlat = flat
    .filter((entry) => !(entry.slot === input.slot && entry.forName === input.forName))
    .map((entry) => (entry.slot === input.slot ? escalar(entry) : entry));

  const nombre = String(repetido.name ?? "");
  const aviso = recortado
    ? `Ya había ${nombre.toLowerCase()} en esta comida: se sumó hasta el tope de la porción (${gramos} g).`
    : `Ya había ${nombre.toLowerCase()} en esta comida: se sumó (${gramos} g).`;

  return {
    mealsJson: newMeals as unknown as Prisma.JsonValue,
    equivalencesJson: newFlat as unknown as Prisma.JsonValue,
    aviso,
  };
}
