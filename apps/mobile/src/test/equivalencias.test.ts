import { describe, expect, it } from "vitest";

import { seccionesDeEquivalencia, textoDeOpcion } from "@/lib/equivalencias";

describe("la hoja de cambiar un alimento", () => {
  const eq = {
    forName: "Tortilla de nopal",
    options: [
      { name: "Tostada de maiz horneada", grams: 15, portion: "1 tostada", enDespensa: true },
      { name: "Tortilla de maiz", grams: 30, portion: "1 tortilla" },
      { name: "Pan integral", grams: 30, portion: null, aproximada: true },
    ],
    noVan: [{ name: "Arroz blanco cocido", grams: 40, portion: null, motivo: "no va con tu papa" }],
  };

  it("la despensa primero, luego los equivalentes", () => {
    const s = seccionesDeEquivalencia(eq);
    expect(s.enDespensa.map((o) => o.name)).toEqual(["Tostada de maiz horneada"]);
    expect(s.equivalentes.map((o) => o.name)).toEqual(["Tortilla de maiz", "Pan integral"]);
  });

  it("lo que no va se dice con su motivo", () => {
    expect(seccionesDeEquivalencia(eq).noVan).toEqual([{ texto: "Arroz blanco cocido (40 g)", motivo: "no va con tu papa" }]);
  });

  it("sin datos nuevos del servidor, todo es equivalente y nada queda en gris", () => {
    const viejo = { forName: "Avena", options: [{ name: "Amaranto", grams: 55, portion: null }] };
    const s = seccionesDeEquivalencia(viejo);
    expect(s.enDespensa).toEqual([]);
    expect(s.equivalentes).toHaveLength(1);
    expect(s.noVan).toEqual([]);
  });

  it("el texto usa la porción natural si la hay", () => {
    expect(textoDeOpcion({ name: "Tortilla de maiz", grams: 90, portion: "3 tortillas" })).toBe("3 tortillas");
  });
});

describe("lo que ya va en otra comida", () => {
  it("se puede elegir: va al final de su sección, no a los que no van", () => {
    const secciones = seccionesDeEquivalencia({
      forName: "Tortilla de nopal",
      options: [
        { name: "Tostada horneada", grams: 20, portion: null, enOtraComida: true },
        { name: "Tortilla de maíz", grams: 30, portion: null },
      ],
    });
    expect(secciones.equivalentes.map((o) => o.name)).toEqual(["Tortilla de maíz", "Tostada horneada"]);
    expect(secciones.noVan).toEqual([]);
  });
});
