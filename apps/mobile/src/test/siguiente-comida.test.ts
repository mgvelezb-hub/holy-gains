import { describe, expect, it } from "vitest";

import type { MenuMeal, TomaDelDia } from "@/lib/api";
import {
  comidaCompleta,
  comidasPendientesDesde,
  itemsParaAviso,
  recortarConAviso,
  renglonDeToma,
  renglonesPlanos,
  siguienteComida,
  type PlanParaSiguienteComida,
} from "@/lib/siguiente-comida";

function meal(slot: string, label: string, timeHint: string, items: MenuMeal["items"], extra: object = {}): MenuMeal {
  return { slot, label, timeHint, allowDenseCarb: false, items, equivalences: [], ...extra } as MenuMeal;
}

const item = (name: string, grams: number, portion: string | null = null, free = false) => ({ name, grams, portion, free });

const ashwagandha: TomaDelDia = {
  supplement: "ASHWAGANDHA",
  categoria: "SUPLEMENTO",
  nombre: "Ashwagandha KSM-66",
  corto: "ashwagandha",
  dosis: "300 mg",
  slot: "CENA",
  cuando: "con la cena",
  hecho: false,
};

/** El caso de Mau: la cena con cuatro alimentos y la ashwagandha. */
const PLAN: PlanParaSiguienteComida = {
  menuDeHoy: 2,
  menus: [
    { menuNumber: 1, meals: [meal("CENA", "Cena", "20:00", [item("Otra cosa", 100)])] },
    {
      menuNumber: 2,
      meals: [
        meal("DESAYUNO", "Desayuno", "8:00", [item("Avena", 40)], {
          preparacion: { id: "p1", nombre: "Licuado de fresa con avena" },
          items: [
            { ...item("Leche", 250), preparacionId: "p1" },
            { ...item("Fresa", 120), preparacionId: "p1" },
            { ...item("Avena", 40), preparacionId: "p1" },
            item("Café", 0, null, true),
          ],
        }),
        meal("CENA", "Cena", "20:00", [
          item("Pavo", 120),
          item("Tortilla de maíz", 90, "3 tortillas de maíz"),
          item("Aguacate", 50),
          item("Nopales", 150),
        ]),
      ],
    },
  ],
  hoy: {
    comidas: [
      { slot: "DESAYUNO", label: "Desayuno", hora: "08:00" },
      { slot: "CENA", label: "Cena", hora: "21:00" },
    ],
  },
  tomas: [ashwagandha, { ...ashwagandha, supplement: "MELATONINA", corto: "melatonina", slot: null }],
};

const a = (h: number, m = 0): Date => new Date(2026, 8, 28, h, m);

describe("siguienteComida", () => {
  it("trae TODOS los ingredientes de la cena y su toma, con la hora de hoy", () => {
    const cena = siguienteComida(PLAN, a(15));
    expect(cena).toEqual({
      slot: "CENA",
      nombre: "Cena",
      hora: "21:00",
      items: [
        { display: "Pavo — 120 g", nombre: "Pavo" },
        { display: "3 tortillas de maíz", nombre: "Tortilla de maíz" },
        { display: "Aguacate — 50 g", nombre: "Aguacate" },
        { display: "Nopales — 150 g", nombre: "Nopales" },
      ],
      tomas: [{ nombre: "Ashwagandha", dosis: "300 mg" }],
    });
    expect(renglonDeToma(cena!.tomas[0]!)).toBe("+ Ashwagandha 300 mg");
  });

  it("lee el menú de HOY (menuDeHoy), no el menú 1", () => {
    expect(siguienteComida(PLAN, a(15))?.items).toHaveLength(4);
  });

  it("una preparación va primero con sus ingredientes debajo; lo suelto después", () => {
    const desayuno = siguienteComida(PLAN, a(6))!;
    expect(desayuno.slot).toBe("DESAYUNO");
    expect(renglonesPlanos(desayuno)).toEqual([
      "Licuado de fresa con avena",
      "Leche — 250 g",
      "Fresa — 120 g",
      "Avena — 40 g",
      "Café (libre)",
    ]);
    expect(desayuno.items[0]!.platillo).toBe(true);
    expect(desayuno.items.slice(1, 4).every((r) => r.enPlatillo)).toBe(true);
    expect(desayuno.items[4]!.enPlatillo).toBeUndefined();
  });

  it("ya pasada la última, envuelve a la primera del día", () => {
    expect(siguienteComida(PLAN, a(22))?.slot).toBe("DESAYUNO");
    expect(comidasPendientesDesde(PLAN, a(22)).map((c) => c.slot)).toEqual(["DESAYUNO"]);
  });

  it("las pendientes van en orden desde la siguiente", () => {
    expect(comidasPendientesDesde(PLAN, a(7)).map((c) => c.slot)).toEqual(["DESAYUNO", "CENA"]);
  });

  it("sin menú no inventa nada; sin `hoy` (API viejo) usa el timeHint", () => {
    expect(siguienteComida({}, a(7))).toBeNull();
    const viejo = { menus: PLAN.menus, menuDeHoy: 2 };
    expect(siguienteComida(viejo, a(15))?.hora).toBe("20:00");
  });

  it("comidaCompleta de un slot que hoy no existe es null", () => {
    expect(comidaCompleta(PLAN, "COLACION")).toBeNull();
  });
});

describe("recortarConAviso", () => {
  const cuatro = ["a", "b", "c", "d"];
  it("si cabe, todo", () => {
    expect(recortarConAviso(cuatro, 4)).toEqual(cuatro);
  });
  it("si no cabe, nunca corta callado: el último renglón dice cuántos faltan", () => {
    expect(recortarConAviso(cuatro, 3)).toEqual(["a", "b", "+2 más"]);
    expect(recortarConAviso(cuatro, 0)).toEqual(["+4 más"]);
  });
});

describe("itemsParaAviso", () => {
  it("nombres sin cantidad; el platillo con sus ingredientes entre paréntesis", () => {
    const desayuno = siguienteComida(PLAN, a(6))!;
    expect(itemsParaAviso(desayuno)).toEqual([
      { name: "Licuado de fresa con avena (leche, fresa, avena)" },
      { name: "Café" },
    ]);
    expect(itemsParaAviso(siguienteComida(PLAN, a(15))!).map((i) => i.name)).toEqual([
      "Pavo",
      "Tortilla de maíz",
      "Aguacate",
      "Nopales",
    ]);
  });
});
