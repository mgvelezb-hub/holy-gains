import { describe, expect, it } from "vitest";
import { sugerirSuplementos } from "engine";

import {
  conNucleo,
  entradaDeSugerencias,
  lineasParaAjustar,
  type FilasParaSugerencias,
} from "@/lib/suplementos/entrada";

/**
 * El puente base → motor de las sugerencias de suplementos. Lo que se prueba
 * es qué filas cuentan y cómo se leen; las reglas viven en el motor.
 */

function filas(over: Partial<FilasParaSugerencias> = {}): FilasParaSugerencias {
  return {
    hoy: "2026-09-28",
    perfil: {
      goal: "PERDIDA_GRASA",
      currentPhase: "CUT",
      dietStyle: "ESTANDAR",
      liftingDays: 5,
      cardioMinWk: 120,
      trainingTime: "MANANA",
      conditions: [],
      supplements: ["WHEY", "OMEGA3", "INVENTADO"],
      supplementChoices: { MAGNESIO: { eleccion: "no_quiero", fecha: "2026-09-01" }, _infusiones: false },
    },
    pesoKg: 120,
    decision: { phase: "CUT", kcal: 2400, proteinG: 220 },
    checkIns: [{ date: "2026-09-21", energy: 2, hunger: 3, satiety: 3, sleep: 2, symptoms: [] }],
    healthDays: [],
    labs: [
      {
        takenOn: "2026-09-01",
        valuesJson: [
          { key: "vitamina_d", label: "Vitamina D", value: 22, unit: "ng/mL", refLow: 30, refHigh: 100 },
          { key: "basura" },
        ],
      },
    ],
    cardioSesionesMin: [30, 50],
    ...over,
  };
}

describe("entradaDeSugerencias", () => {
  it("traduce perfil, elecciones y preferencia de infusiones", () => {
    const e = entradaDeSugerencias(filas());
    expect(e.dieta).toBe("estandar");
    expect(e.entrenaTemprano).toBe(true);
    expect(e.suplementos).toEqual(["WHEY", "OMEGA3"]);
    expect(e.elecciones?.MAGNESIO?.eleccion).toBe("no_quiero");
    expect(e.quiereInfusiones).toBe(false);
    expect(e.sesionCardioMaxMin).toBe(50);
    expect(e.proteinaObjetivoG).toBe(220);
  });

  it("lee los valores del estudio y descarta los mal formados", () => {
    const e = entradaDeSugerencias(filas());
    expect(e.labs).toEqual([
      { takenOn: "2026-09-01", key: "vitamina_d", value: 22, refLow: 30, refHigh: 100 },
    ]);
  });

  it("la vitamina D del estudio llega hasta la sugerencia, y el descarte de magnesio se respeta", () => {
    const r = sugerirSuplementos(entradaDeSugerencias(filas()));
    expect(r.freno).toBeNull();
    const ids = r.sugerencias.map((s) => s.supplement);
    expect(ids).toContain("VITAMINA_D3");
    expect(ids).not.toContain("MAGNESIO");
    expect(ids.every((id) => !["MANZANILLA", "TILA", "TE_VERDE", "JAMAICA"].includes(id))).toBe(true);
  });

  it("las líneas de 'Hay que ajustar' salen del código, con nombre y motivo", () => {
    const r = sugerirSuplementos(entradaDeSugerencias(filas()));
    const lineas = lineasParaAjustar(r);
    expect(lineas).toHaveLength(r.sugerencias.length);
    expect(lineas[0]).toMatch(/^Suplemento sugerido: vitamina d3 — Tu vitamina D salió en 22/);
  });
});

describe("conNucleo", () => {
  it("guardar el núcleo no borra lo aceptado fuera de él", () => {
    expect(conNucleo(["WHEY", "MAGNESIO", "MANZANILLA"], ["CREATINA"])).toEqual([
      "CREATINA",
      "MAGNESIO",
      "MANZANILLA",
    ]);
  });
});
