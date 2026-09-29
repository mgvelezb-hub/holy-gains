import type { Prisma } from "@prisma/client";
import { FOODS, equivalenciasDeAlimento, familiaDe, normalize } from "engine";
import type { MealSlotId, Profile as EngineProfile } from "engine";

/**
 * Relleno de equivalencias sobre menús YA guardados.
 *
 * El motor mejoró dos veces después de que la gente ya tenía menús: primero
 * aprendió a dar equivalencias de los vegetales libres, y luego a llenar la
 * lista hasta cinco opciones en vez de quedarse con la primera exacta. Un
 * menú guardado no se entera de ninguna de las dos: sus equivalencias son las
 * que había el día que se generó, y la única forma de refrescarlas era
 * regenerar el menú completo — que le borra a la persona los cambios que ya
 * eligió. Por eso esto rellena SOLO los huecos:
 *
 *  - Un alimento sin ninguna equivalencia recibe su lista completa.
 *  - Un alimento con pocas opciones recibe las que le faltan, AGREGADAS al
 *    final; las que ya estaban no se tocan ni se reordenan, porque entre
 *    ellas está la opción de "volver" que dejó un intercambio anterior.
 *
 * Y dos reglas que valen también para lo ya guardado:
 *
 *  - El ingrediente de un platillo (la lenteja de la sopa) solo ofrece
 *    hermanos del platillo: sus opciones se rehacen desde la receta y se
 *    descartan las que no pertenecen (el arroz suelto que ofrecía antes).
 *  - Ninguna opción repite la proteína principal o el cereal de OTRA comida
 *    del día: cambiar el pollo de la comida por el atún de la cena es comer
 *    atún dos veces.
 *
 * Es una transformación pura sobre el JSON: no sabe de Prisma, así que se
 * prueba sin base de datos. Quien la llama decide si vale la pena guardar
 * (`cambiado`).
 */

type JsonRecord = Record<string, unknown>;

export interface BackfillResult {
  mealsJson: Prisma.JsonValue;
  equivalencesJson: Prisma.JsonValue;
  /** false si no faltaba nada: el caller se ahorra el UPDATE. */
  cambiado: boolean;
}

function asRecordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? (value as JsonRecord[]) : [];
}

export function rellenaEquivalencias(
  mealsJson: Prisma.JsonValue,
  equivalencesJson: Prisma.JsonValue,
  profile: EngineProfile,
): BackfillResult {
  const meals = asRecordArray(mealsJson);
  if (meals.length === 0) {
    return { mealsJson, equivalencesJson, cambiado: false };
  }

  let cambiado = false;

  const nuevasMeals: JsonRecord[] = meals.map((meal, mealIndex) => {
    const items = asRecordArray(meal.items);
    const equivalences = asRecordArray(meal.equivalences);
    const porNombre = new Map(equivalences.map((e) => [String(e.forName ?? ""), e]));
    const platilloDeLaComida = preparacionIdDe(meal.preparacion);

    // Lo que hay en las OTRAS comidas del día: sus familias no se ofrecen.
    const enElDia = meals
      .filter((_, index) => index !== mealIndex)
      .flatMap((otra) => asRecordArray(otra.items))
      .map((otro) => String(otro.foodId ?? otro.name ?? ""))
      .filter((valor) => valor !== "");
    const familiasFuera = new Set(
      enElDia.map((valor) => familiaDeValor(valor)).filter((f): f is string => f !== undefined),
    );

    for (const item of items) {
      const nombre = String(item.name ?? "");
      const gramos = Number(item.grams ?? 0);
      if (nombre === "" || gramos <= 0) continue;

      const existente = porNombre.get(nombre);
      const guardadas = existente ? asRecordArray(existente.options) : [];
      const preparacionId = preparacionIdDe(item.preparacion) ?? undefined;
      const esDePlatillo = preparacionId !== undefined && preparacionId === platilloDeLaComida;

      // Lo demás de esta comida y su hora: el arroz no se ofrece junto a la
      // papa, ni lo que no es de desayuno a las 8 (grupo SMAE, motor R2).
      const enLaComida = items
        .filter((otro) => otro !== item)
        .map((otro) => String(otro.foodId ?? otro.name ?? ""))
        .filter((valor) => valor !== "");
      const frescas = equivalenciasDeAlimento(nombre, gramos, profile, undefined, undefined, {
        enElDia,
        enLaComida,
        ...(typeof meal.slot === "string" && typeof meal.timeHint === "string"
          ? { slot: { id: meal.slot as MealSlotId, timeHint: meal.timeHint } }
          : {}),
        ...(esDePlatillo ? { preparacionId } : {}),
      });

      // Las guardadas que rompen una regla se van: las de fuera del platillo
      // y las que repiten la familia de otra comida (salvo la propia).
      const propia = familiaDeValor(String(item.foodId ?? nombre));
      const validas = new Set((frescas?.options ?? []).map((o) => o.name));
      const opcionesActuales = guardadas.filter((opcion) => {
        if (esDePlatillo) return validas.has(String(opcion.name ?? ""));
        const familia = familiaDeValor(String(opcion.foodId ?? opcion.name ?? ""));
        return familia === undefined || familia === propia || !familiasFuera.has(familia);
      });
      const depuradas = opcionesActuales.length !== guardadas.length;

      if (depuradas && frescas === null) {
        porNombre.set(nombre, { ...(existente ?? {}), forName: nombre, options: opcionesActuales });
        if (opcionesActuales.length === 0) porNombre.delete(nombre);
        cambiado = true;
        continue;
      }

      // Ya tiene de dónde elegir: no se toca. Rellenar de más movería una
      // lista que la persona ya conoce sin que ella haya pedido nada.
      if (!depuradas && opcionesActuales.length >= 3) continue;
      if (frescas === null) continue;

      // Las que ya estaban se conservan tal cual —incluida la opción de
      // "volver" que deja un intercambio— y solo se agregan las que no
      // estaban, hasta completar la lista.
      const yaEstan = new Set(opcionesActuales.map((o) => String(o.name ?? "")));
      const agregadas = frescas.options
        .filter((opcion) => opcion.name !== nombre && !yaEstan.has(opcion.name))
        .map((opcion) => ({
          // El id viaja con la opción: al intercambiar, el alimento nuevo lo
          // hereda y la lista de súper puede seguir agrupando por alimento.
          foodId: opcion.foodId,
          name: opcion.name,
          grams: opcion.grams,
          ...(opcion.aproximada === true ? { aproximada: true } : {}),
          ...(opcion.enDespensa === true ? { enDespensa: true } : {}),
        }));

      if (agregadas.length === 0 && !depuradas) continue;

      const opciones = [...opcionesActuales, ...agregadas];
      const aproximada =
        opciones.some((o) => o.aproximada === true) || frescas.aproximada === true;

      porNombre.set(nombre, {
        ...(existente ?? {}),
        forName: nombre,
        options: opciones,
        ...(aproximada ? { aproximada: true } : {}),
      });
      cambiado = true;
    }

    return { ...meal, equivalences: [...porNombre.values()] } satisfies JsonRecord;
  });

  if (!cambiado) return { mealsJson, equivalencesJson, cambiado: false };

  // La copia aplanada se reconstruye desde las comidas ya rellenadas: es un
  // espejo, nunca la fuente de verdad.
  const plano = nuevasMeals.flatMap((meal) =>
    asRecordArray(meal.equivalences).map((equivalencia) => ({
      slot: meal.slot,
      ...equivalencia,
    })),
  );

  return {
    mealsJson: nuevasMeals as unknown as Prisma.JsonValue,
    equivalencesJson: plano as unknown as Prisma.JsonValue,
    cambiado: true,
  };
}

/** El id del platillo guardado en la comida o en el renglón, si lo hay. */
function preparacionIdDe(valor: unknown): string | null {
  if (typeof valor !== "object" || valor === null) return null;
  const id = (valor as JsonRecord).id;
  return typeof id === "string" ? id : null;
}

/** La familia (proteína principal o cereal) de un id o nombre del catálogo. */
function familiaDeValor(valor: string): string | undefined {
  const buscado = normalize(valor);
  const food =
    FOODS.find((f) => f.id === valor) ?? FOODS.find((f) => normalize(f.name) === buscado);
  return food ? familiaDe(food) : undefined;
}
