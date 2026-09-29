import { describe, expect, it } from "vitest";

import { toGroceries, toMenuView } from "@/lib/coachy/menu-view";

describe("toMenuView", () => {
  it("aplana un menú completo con items y equivalencias", () => {
    const mealsJson = [
      {
        slot: "desayuno",
        label: "Desayuno",
        timeHint: "7:00 am",
        allowDenseCarb: true,
        items: [{ name: "Avena", grams: 60, free: false }],
        equivalences: [
          {
            forName: "Avena",
            options: [{ name: "Amaranto", grams: 55 }],
          },
        ],
      },
    ];

    const view = toMenuView(1, mealsJson);

    expect(view).toEqual({
      menuNumber: 1,
      meals: [
        {
          slot: "desayuno",
          label: "Desayuno",
          timeHint: "7:00 am",
          allowDenseCarb: true,
          // La avena y el amaranto se pesan: su porción natural es `null`.
          // Un alimento por pieza —tortilla, huevo— sí trae texto aquí.
          // `display` y `why` son del motor F1: un menú guardado antes no los
          // trae, y la pantalla cae a la porción natural y luego a los gramos.
          items: [
            { name: "Avena", grams: 60, free: false, portion: null, display: null, why: null },
          ],
          equivalences: [
            { forName: "Avena", options: [{ name: "Amaranto", grams: 55, portion: null }] },
          ],
        },
      ],
    });
  });

  it("pasa la porción legible y el porqué que ya trae el motor", () => {
    const view = toMenuView(1, [
      {
        slot: "comida",
        label: "Comida",
        timeHint: "14:00",
        items: [
          {
            name: "Aceite de oliva extra virgen",
            grams: 10,
            free: false,
            display: "2 cditas de aceite de oliva extra virgen (10 g)",
            why: { role: "grasa", closes: "grasa", units: 2, unitLabel: "cditas", note: "tope de la porcion" },
          },
        ],
      },
    ]);

    const item = view.meals[0]!.items[0]!;
    expect(item.display).toBe("2 cditas de aceite de oliva extra virgen (10 g)");
    expect(item.why).toEqual({
      closes: "grasa",
      units: 2,
      unitLabel: "cditas",
      note: "tope de la porcion",
    });
  });

  it("ignora un porqué que no viene del motor", () => {
    const view = toMenuView(1, [
      { slot: "a", label: "A", timeHint: "", items: [{ name: "X", grams: 1, why: { closes: "vitaminas" } }] },
    ]);
    expect(view.meals[0]!.items[0]!.why).toBeNull();
  });

  it("trata allowDenseCarb ausente como true: solo false lo apaga", () => {
    const view = toMenuView(1, [{ slot: "a", label: "A", timeHint: "", items: [] }]);
    expect(view.meals[0]?.allowDenseCarb).toBe(true);
  });

  it("no truena si mealsJson no es un arreglo", () => {
    expect(toMenuView(1, null)).toEqual({ menuNumber: 1, meals: [] });
    expect(toMenuView(2, { foo: "bar" })).toEqual({ menuNumber: 2, meals: [] });
  });

  it("no truena si items o equivalences faltan en una comida", () => {
    const view = toMenuView(1, [{ slot: "a", label: "A", timeHint: "" }]);
    expect(view.meals[0]?.items).toEqual([]);
    expect(view.meals[0]?.equivalences).toEqual([]);
  });
});

describe("toGroceries", () => {
  it("aplana la lista de súper", () => {
    const json = [{ name: "Pollo", grams: 500, unit: "g" }];
    // `portion` es null para lo que se compra a granel: la pechuga se pesa,
    // no se cuenta.
    expect(toGroceries(json)).toEqual([
      { name: "Pollo", grams: 500, unit: "g", portion: null },
    ]);
  });

  it("lo que se vende por pieza se pide en piezas", () => {
    // "1260 g de naranja" no se pide en el súper: se piden siete naranjas.
    const json = [{ name: "Naranja", grams: 1260, unit: "g" }];
    expect(toGroceries(json)[0]?.portion).toContain("naranja");
  });

  it("devuelve un arreglo vacío si el json no es un arreglo", () => {
    expect(toGroceries(null)).toEqual([]);
    expect(toGroceries({ not: "an array" })).toEqual([]);
  });
});

describe("equivalencias por grupo SMAE en la vista", () => {
  it("marca lo que está en casa y pasa lo que no va con su motivo", () => {
    const view = toMenuView(1, [
      {
        slot: "CENA",
        label: "Cena",
        timeHint: "20:30",
        items: [{ foodId: "nopal_asado_carb", name: "Tortilla de nopal", grams: 30, free: false }],
        equivalences: [
          {
            forName: "Tortilla de nopal",
            options: [
              { foodId: "tostada_horneada", name: "Tostada de maiz horneada", grams: 15, enDespensa: true },
              { foodId: "tortilla_maiz", name: "Tortilla de maiz", grams: 30 },
            ],
            noVan: [{ foodId: "arroz_blanco", name: "Arroz blanco cocido", grams: 40, motivo: "no va con tu papa" }],
          },
        ],
      },
    ]);
    const eq = view.meals[0]!.equivalences[0]!;
    expect(eq.options[0]).toMatchObject({ name: "Tostada de maiz horneada", enDespensa: true });
    expect(eq.options[1]!.enDespensa).toBeUndefined();
    expect(eq.noVan).toEqual([{ name: "Arroz blanco cocido", grams: 40, portion: null, motivo: "no va con tu papa" }]);
  });
});

describe("platillos mexicanos en la vista", () => {
  it("el platillo (tacos) se lee como la sopa: nombre y sus ingredientes agrupados", () => {
    const prep = { id: "tacos_pollo", nombre: "Tacos de pollo", tipo: "platillo" };
    const view = toMenuView(1, [
      {
        slot: "COMIDA",
        label: "Comida",
        timeHint: "14:00",
        preparacion: { ...prep, display: "Tacos de pollo — 150 g de pechuga · 3 tortillas" },
        items: [
          { foodId: "pechuga_pollo", name: "Pechuga de pollo cocida", grams: 150, free: false, preparacion: prep },
          { foodId: "tortilla_maiz", name: "Tortilla de maiz", grams: 90, free: false, preparacion: prep },
        ],
        equivalences: [],
      },
    ]);
    expect(view.meals[0]!.preparacion).toEqual({ id: "tacos_pollo", nombre: "Tacos de pollo", tipo: "platillo" });
    expect(view.meals[0]!.items.every((i) => i.preparacionId === "tacos_pollo")).toBe(true);
  });
});
