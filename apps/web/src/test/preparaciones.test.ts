import { describe, expect, it } from "vitest";

import {
  PREPARACIONES_TODAS,
  conPreferenciaDePreparaciones,
  preferenciaDePreparaciones,
  sinMarcasDePreparacion,
} from "@/lib/coachy/preparaciones";
import { toGroceries, toMenuView } from "@/lib/coachy/menu-view";

describe("preferencia de preparaciones guardada en los excluidos", () => {
  it("sin marcas, todas prendidas", () => {
    expect(preferenciaDePreparaciones(["atún", "pepino"])).toEqual(PREPARACIONES_TODAS);
  });

  it("excluir 'licuados' apaga los licuados, sin importar acentos ni mayúsculas", () => {
    expect(preferenciaDePreparaciones(["Licuados", "SOPAS"])).toEqual({
      licuados: false,
      sopas: false,
      cremas: true,
    });
  });

  it("apagar un tipo lo agrega a los excluidos sin tocar lo demás, y prenderlo lo quita", () => {
    const apagado = conPreferenciaDePreparaciones(["atún"], {
      licuados: false,
      sopas: true,
      cremas: false,
    });
    expect(apagado).toEqual(["atún", "licuados", "cremas"]);
    expect(conPreferenciaDePreparaciones(apagado, PREPARACIONES_TODAS)).toEqual(["atún"]);
  });

  it("al motor le llegan los excluidos sin las marcas", () => {
    expect(sinMarcasDePreparacion(["atún", "licuados", "cremas"])).toEqual(["atún"]);
  });
});

describe("el menú aplanado conserva la preparación", () => {
  const mealsJson = [
    {
      slot: "PRE",
      label: "Desayuno",
      timeHint: "07:00",
      items: [
        {
          name: "Yogur griego natural 0%",
          grams: 200,
          free: false,
          display: "200 g de yogur griego natural 0%",
          preparacion: { id: "licuado_fresa_avena", nombre: "Licuado de fresa con avena", tipo: "licuado" },
        },
        { name: "Platano", grams: 120, free: false, display: "1 pieza de platano (120 g)" },
      ],
      equivalences: [],
      preparacion: {
        id: "licuado_fresa_avena",
        nombre: "Licuado de fresa con avena",
        tipo: "licuado",
        display: "Licuado de fresa con avena — 200 g de yogur griego natural 0%",
      },
    },
  ];

  it("la comida trae el platillo y cada ingrediente sabe a cuál pertenece", () => {
    const [meal] = toMenuView(1, mealsJson).meals;
    expect(meal?.preparacion).toEqual({
      id: "licuado_fresa_avena",
      nombre: "Licuado de fresa con avena",
      tipo: "licuado",
    });
    expect(meal?.items[0]?.preparacionId).toBe("licuado_fresa_avena");
    expect(meal?.items[1]?.preparacionId).toBeUndefined();
  });

  it("la lista de súper dice para qué platillo se compra", () => {
    const [item] = toGroceries([
      { name: "Fresa", grams: 560, unit: "g", preparaciones: ["Licuado de fresa con avena"] },
    ]);
    expect(item?.preparaciones).toEqual(["Licuado de fresa con avena"]);
  });
});
