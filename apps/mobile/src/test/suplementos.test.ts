import { describe, expect, it } from "vitest";

import type { FichaSuplemento, SugerenciaSuplemento, TomaDelDia } from "@/lib/api";
import {
  buscaEnCatalogo,
  lineaSugerencia,
  lineaToma,
  motivoCorto,
  resumenRenglon,
} from "@/lib/suplementos";

function toma(over: Partial<TomaDelDia>): TomaDelDia {
  return {
    supplement: "OMEGA3",
    categoria: "SUPLEMENTO",
    nombre: "Omega-3",
    corto: "omega-3",
    dosis: "1 a 2 cápsulas",
    slot: "COMIDA",
    cuando: "con la comida",
    hecho: false,
    ...over,
  };
}

describe("líneas de suplementos", () => {
  it("el renglón de Ajustes cuenta tomas y sugerencias", () => {
    expect(resumenRenglon(3, 2)).toBe("3 tomas · 2 sugerencias");
    expect(resumenRenglon(1, 0)).toBe("1 toma");
    expect(resumenRenglon(0, 1)).toBe("1 sugerencia");
    expect(resumenRenglon(0, 0)).toBe("Nada por ahora");
  });

  it("el motivo corto se queda con la primera frase", () => {
    expect(motivoCorto("Duermes poco: 6 h en promedio.")).toBe("Duermes poco");
    expect(motivoCorto("Entrenas fuerza 5 días por semana.")).toBe("Entrenas fuerza 5 días por semana");
  });

  it("una sugerencia y una toma en una línea", () => {
    const s = { nombre: "Magnesio (glicinato)", motivo: "Duermes poco: 6 h en promedio." } as SugerenciaSuplemento;
    expect(lineaSugerencia(s)).toBe("Magnesio (glicinato) · Duermes poco");
    expect(lineaToma(toma({}))).toBe("1 a 2 cápsulas · con la comida");
  });

  it("el buscador ignora acentos y lo que ya toma", () => {
    const catalogo = [
      { id: "MAGNESIO", nombre: "Magnesio (glicinato)", corto: "magnesio" },
      { id: "MANZANILLA", nombre: "Té de manzanilla", corto: "té de manzanilla" },
      { id: "CAFEINA", nombre: "Cafeína (pre-entreno)", corto: "cafeína" },
    ] as FichaSuplemento[];
    expect(buscaEnCatalogo(catalogo, "cafeina", []).map((f) => f.id)).toEqual(["CAFEINA"]);
    expect(buscaEnCatalogo(catalogo, "ma", ["MAGNESIO"]).map((f) => f.id)).toEqual(["MANZANILLA"]);
    expect(buscaEnCatalogo(catalogo, "m", [])).toEqual([]);
  });
});
