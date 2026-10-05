import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { rellenaEquivalencias } from "@/lib/coachy/equivalencias-backfill";

/**
 * El perfil mínimo que el motor necesita para saber qué alimentos son
 * elegibles (presupuesto, dieta, exclusiones).
 */
const PERFIL = {
  sex: "M",
  age: 34,
  heightCm: 178,
  weightKg: 86,
  activity: "moderada",
  goal: "recomposicion",
  budget: "alto",
  diet: "omnivora",
  excludedFoods: [],
  allergies: [],
  favoriteFoods: [],
  cookMinutes: 40,
  mealsPerDay: 5,
} as never;

function comidaCon(
  items: Array<Record<string, unknown>>,
  equivalences: unknown[] = [],
): Prisma.JsonValue {
  return [
    { slot: "desayuno", label: "Desayuno", timeHint: "7:00 am", items, equivalences },
  ] as unknown as Prisma.JsonValue;
}

describe("rellenaEquivalencias", () => {
  it("le da opciones a un vegetal libre que se guardó sin ninguna", () => {
    const meals = comidaCon([{ name: "Espinaca", grams: 200, free: true }]);

    const resultado = rellenaEquivalencias(meals, [], PERFIL);

    expect(resultado.cambiado).toBe(true);
    const equivalencias = (resultado.mealsJson as any[])[0].equivalences;
    expect(equivalencias).toHaveLength(1);
    expect(equivalencias[0].forName).toBe("Espinaca");
    expect(equivalencias[0].options.length).toBeGreaterThanOrEqual(3);
  });

  it("completa una lista corta sin mover ni borrar lo que ya estaba", () => {
    // "Amaranto" es la opción de volver que dejó un intercambio anterior: no
    // se puede perder ni cambiar de lugar.
    const meals = comidaCon(
      [{ name: "Avena", grams: 60, free: false }],
      [{ forName: "Avena", options: [{ name: "Amaranto", grams: 55 }] }],
    );

    const resultado = rellenaEquivalencias(meals, [], PERFIL);

    expect(resultado.cambiado).toBe(true);
    const opciones = (resultado.mealsJson as any[])[0].equivalences[0].options;
    expect(opciones[0]).toEqual({ name: "Amaranto", grams: 55 });
    expect(opciones.length).toBeGreaterThan(1);
  });

  it("a una lista que ya tiene opciones le agrega las que faltan, al final y sin quitar ninguna", () => {
    const meals = comidaCon(
      [{ name: "Avena", grams: 60, free: false }],
      [
        {
          forName: "Avena",
          options: [
            { name: "Amaranto", grams: 55 },
            { name: "Arroz integral", grams: 50 },
            { name: "Quinoa", grams: 50 },
          ],
        },
      ],
    );

    const resultado = rellenaEquivalencias(meals, [], PERFIL);

    // Antes se dejaba en paz con tres opciones y la lista se quedaba corta;
    // ahora crece con el resto del catálogo (3-oct, Mau: más variedad).
    expect(resultado.cambiado).toBe(true);
    const nombres = (resultado.mealsJson as any[])[0].equivalences[0].options.map((o: any) => o.name);
    expect(nombres.slice(0, 3)).toEqual(["Amaranto", "Arroz integral", "Quinoa"]);
    expect(nombres.length).toBeGreaterThan(3);

    // Y una segunda pasada ya no cambia nada.
    expect(rellenaEquivalencias(resultado.mealsJson, resultado.equivalencesJson, PERFIL).cambiado).toBe(false);
  });

  it("un alimento que no está en el catálogo se deja en paz", () => {
    const meals = comidaCon([{ name: "Guiso de la abuela", grams: 200, free: false }]);

    const resultado = rellenaEquivalencias(meals, [], PERFIL);

    expect(resultado.cambiado).toBe(false);
  });

  it("la copia aplanada queda con el slot de cada equivalencia", () => {
    const meals = comidaCon([{ name: "Espinaca", grams: 200, free: true }]);

    const resultado = rellenaEquivalencias(meals, [], PERFIL);

    const plano = resultado.equivalencesJson as any[];
    expect(plano.length).toBeGreaterThan(0);
    expect(plano[0].slot).toBe("desayuno");
    expect(plano[0].forName).toBe("Espinaca");
  });

  // Menú 1 de Mau: tocar "cambiar" en la lenteja de la sopa ofrecía arroz y
  // papa sueltos. El ingrediente de un platillo se cambia dentro del platillo.
  it("el ingrediente de una sopa guardada solo ofrece hermanos del platillo", () => {
    const sopa = { id: "sopa_lentejas", nombre: "Sopa de lentejas", tipo: "sopa" };
    const meals = [
      {
        slot: "COMIDA",
        label: "Comida",
        timeHint: "14:00",
        preparacion: sopa,
        items: [
          { foodId: "lenteja", name: "Lenteja cocida", grams: 180, free: false, preparacion: sopa },
          { foodId: "jitomate", name: "Jitomate", grams: 60, free: true, preparacion: sopa },
          { foodId: "atun_agua", name: "Atun en agua drenado", grams: 200, free: false },
        ],
        equivalences: [
          {
            forName: "Lenteja cocida",
            options: [
              { foodId: "arroz_blanco", name: "Arroz blanco cocido", grams: 130 },
              { foodId: "papa", name: "Papa cocida", grams: 180 },
              { foodId: "quinoa", name: "Quinoa cocida", grams: 170 },
            ],
          },
        ],
      },
    ] as unknown as Prisma.JsonValue;

    const resultado = rellenaEquivalencias(meals, [], PERFIL);

    expect(resultado.cambiado).toBe(true);
    const comida = (resultado.mealsJson as any[])[0];
    const lenteja = comida.equivalences.find((e: any) => e.forName === "Lenteja cocida");
    expect(lenteja.options.length).toBeGreaterThan(0);
    for (const opcion of lenteja.options) {
      expect(["frijol_negro", "garbanzo", "haba"]).toContain(opcion.foodId);
    }
    const jitomate = comida.equivalences.find((e: any) => e.forName === "Jitomate");
    for (const opcion of jitomate?.options ?? []) {
      expect(opcion.foodId).not.toBe("arroz_blanco");
    }
  });

  it("la proteína de otra comida del día se queda, marcada y al final", () => {
    const meals = [
      {
        slot: "COMIDA",
        label: "Comida",
        timeHint: "14:00",
        items: [{ foodId: "pechuga_pollo", name: "Pechuga de pollo cocida", grams: 150, free: false }],
        equivalences: [
          {
            forName: "Pechuga de pollo cocida",
            options: [
              { foodId: "atun_agua", name: "Atun en agua drenado", grams: 180 },
              { foodId: "tilapia", name: "Tilapia", grams: 180 },
              { foodId: "pechuga_pavo", name: "Pechuga de pavo cocida", grams: 160 },
            ],
          },
        ],
      },
      {
        slot: "CENA",
        label: "Cena",
        timeHint: "20:00",
        items: [{ foodId: "atun_aceite", name: "Atun en aceite drenado", grams: 120, free: false }],
        equivalences: [],
      },
    ] as unknown as Prisma.JsonValue;

    const resultado = rellenaEquivalencias(meals, [], PERFIL);

    expect(resultado.cambiado).toBe(true);
    const pollo = (resultado.mealsJson as any[])[0].equivalences[0];
    const atun = pollo.options.find((o: any) => o.foodId === "atun_agua");
    expect(atun?.enOtraComida).toBe(true);
    const marcas = pollo.options.map((o: any) => o.enOtraComida === true);
    expect(marcas.slice(marcas.indexOf(true)).every(Boolean)).toBe(true);
    expect(pollo.options.map((o: any) => o.foodId)).toContain("tilapia");
  });
});
