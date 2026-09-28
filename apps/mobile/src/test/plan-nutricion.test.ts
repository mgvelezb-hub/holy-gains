import { describe, expect, it } from "vitest";

import type { PlanNutricion, VistaPreviaPlan } from "@/lib/api-nutricion";
import {
  faseLegible,
  lineaHorarios,
  lineaHoy,
  lineaMenu,
  lineaPlan,
  lineaPrevia,
  lineaSuper,
  lineaSuplementos,
} from "@/lib/plan-nutricion";

/**
 * K1 — las líneas de la pestaña Nutrición. Solo dicen en una línea lo que el
 * plan canónico ya trae: ninguna calcula kcal, horarios ni tomas.
 */

function plan(parcial: Partial<PlanNutricion> = {}): PlanNutricion {
  return {
    decision: { id: "d", phase: "CUT", kcal: 2500, proteinG: 210, carbsG: 250, fatG: 70, fiberG: 30 },
    porque: "Corte: −500 kcal para bajar ≈0.5 kg/semana; proteína alta (210 g) para conservar músculo.",
    estilo: { valor: "ESTANDAR", nombre: "Estándar por equivalencias", detalle: "" },
    preferencias: {
      comidas: 4,
      presupuesto: "MEDIO",
      maxPrepMin: 20,
      leche: "descremada",
      preparaciones: { licuados: true, sopas: true, cremas: true },
    },
    menus: [],
    menuPreference: "AMBOS",
    menuDeHoy: 1,
    groceries: [
      { name: "Yogur", grams: 700, unit: "g", enDespensa: true },
      { name: "Pollo", grams: 1200, unit: "g" },
    ],
    despensa: { total: 8, enMenu: 7, enCasa: 1, sinUso: ["nuez"] },
    tomas: [],
    tomasPausadas: 0,
    resumenTomas: { hechas: 1, total: 3, linea: "1 de 3 · siguiente: omega-3 con la comida" },
    sugerencias: [],
    freno: null,
    notasSuplementos: [],
    horarios: { PRE: "06:30" },
    horariosPorDia: {
      LUN: { PRE: "06:30", CENA: "20:00" },
      MAR: { PRE: "06:30", CENA: "20:00" },
      MIE: { PRE: "06:30", CENA: "20:00" },
      JUE: { PRE: "06:30", CENA: "20:00" },
      VIE: { PRE: "06:30", CENA: "20:00" },
      SAB: { PRE: "08:00", CENA: "20:00" },
      DOM: { PRE: "06:30", CENA: "20:00" },
    },
    hoy: {
      fecha: "2026-09-28",
      dia: "LUN",
      comidas: [
        { slot: "PRE", label: "Desayuno (pre-entreno)", hora: "06:30", resumen: "avena", tomas: ["creatina"] },
        { slot: "CENA", label: "Cena", hora: "20:00", resumen: "pollo", tomas: ["magnesio"] },
      ],
    },
    recordatorios: [],
    avisos: [],
    materialized: false,
    ...parcial,
  };
}

describe("líneas de la pestaña Nutrición", () => {
  it("Plan: kcal y fase legible", () => {
    expect(lineaPlan(plan())).toBe("2500 kcal · Corte");
    expect(lineaPlan(plan({ decision: null }))).toBe("Sin plan publicado todavía");
    expect(faseLegible("CUT_AGRESIVO")).toBe("Corte fuerte");
  });

  it("Hoy: la próxima comida a su hora y sus tomas", () => {
    const mediodia = new Date(2026, 8, 28, 12, 0);
    expect(lineaHoy(plan(), mediodia)).toBe("Cena 20:00 + magnesio");
    const madrugada = new Date(2026, 8, 28, 5, 0);
    expect(lineaHoy(plan(), madrugada)).toBe("Desayuno (pre-entreno) 06:30 + creatina");
    expect(lineaHoy(plan({ hoy: { fecha: "x", dia: "LUN", comidas: [] } }), mediodia)).toBe("Sin comidas hoy");
  });

  it("Menú: comidas y a qué hora empieza hoy", () => {
    const menu = { menuNumber: 1, meals: [{ slot: "PRE" }, { slot: "CENA" }] } as never;
    expect(lineaMenu(menu, plan())).toBe("2 comidas · empieza 06:30");
  });

  it("Súper: artículos y cuántos ya tienes", () => {
    expect(lineaSuper(plan())).toBe("2 artículos · 1 ya lo tienes");
    expect(lineaSuper(plan({ groceries: [] }))).toBe("Sin artículos todavía");
  });

  it("Suplementos: la línea de tomas, o la pausa por freno", () => {
    expect(lineaSuplementos(plan())).toBe("1 de 3 · siguiente: omega-3 con la comida");
    expect(lineaSuplementos(plan({ freno: "Consulta con tu médico.", tomasPausadas: 3 }))).toBe(
      "En pausa: 3 tomas hasta que lo veas con tu médico",
    );
    expect(lineaSuplementos(plan({ resumenTomas: { hechas: 0, total: 0, linea: "" } }))).toBe("Sin tomas");
  });

  it("Horarios: los días que se salen del general", () => {
    expect(lineaHorarios(plan())).toBe("Propios · sábado distinto");
    const iguales = Object.fromEntries(
      ["LUN", "MAR", "MIE", "JUE", "VIE", "SAB", "DOM"].map((d) => [d, { PRE: "07:00" }]),
    );
    expect(lineaHorarios(plan({ horarios: {}, horariosPorDia: iguales }))).toBe("Los del motor");
  });

  it("Vista previa: kcal, macros y fibra en una línea", () => {
    const previa = {
      macros: { kcal: 2585, proteinG: 210, carbsG: 290, fatG: 65, fiberG: 35 },
    } as VistaPreviaPlan;
    expect(lineaPrevia(previa)).toBe("2585 kcal · P 210 · C 290 · G 65 · fibra 35 g");
  });
});
