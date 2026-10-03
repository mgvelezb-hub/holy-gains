import { describe, expect, it } from "vitest";

import type { TomaDelDia } from "@/lib/api";
import {
  AYUDA_TOMAS,
  alternaToma,
  lineaTomada,
  tomasPorComida,
} from "@/lib/tomas-comida";

function toma(parcial: Partial<TomaDelDia>): TomaDelDia {
  return {
    supplement: "CREATINA",
    categoria: "SUPLEMENTO",
    nombre: "Creatina monohidratada",
    corto: "creatina",
    dosis: "5 g",
    slot: "DESAYUNO",
    cuando: "con el desayuno, todos los días",
    hecho: false,
    ...parcial,
  };
}

const TOMAS: TomaDelDia[] = [
  toma({}),
  toma({ supplement: "OMEGA3", corto: "omega-3", dosis: "1 a 2 cápsulas", slot: "COMIDA", cuando: "con la comida" }),
  toma({ supplement: "VITAMINA_D3", corto: "vitamina D", dosis: "2000 UI", slot: "COMIDA", cuando: "con la comida" }),
  toma({ supplement: "MELATONINA", corto: "melatonina", dosis: "0.5 mg", slot: null, cuando: "30 min antes de dormir" }),
];

describe("el renglón de la toma", () => {
  it("marcada dice a qué hora se tomó, sin tachar", () => {
    const hecha = toma({ hecho: true, hechaA: new Date(2026, 8, 29, 14, 5).toISOString() });
    expect(lineaTomada(hecha)).toBe("Tomada 14:05");
  });

  it("marcada sin hora (servidor viejo) dice tomada", () => {
    expect(lineaTomada(toma({ hecho: true }))).toBe("Tomada");
  });

  it("la ayuda dice que la hora es sugerencia y el check es haberla tomado", () => {
    expect(AYUDA_TOMAS).toContain("sugerencia");
    expect(AYUDA_TOMAS).toContain("cuando lo tomes");
  });

  it("marcar una toma solo cambia esa, con la hora; desmarcar la quita", () => {
    const ahora = new Date(2026, 8, 29, 9, 30);
    const despues = alternaToma(TOMAS, "OMEGA3", ahora);
    expect(despues.find((t) => t.supplement === "OMEGA3")!.hecho).toBe(true);
    expect(despues.find((t) => t.supplement === "OMEGA3")!.hechaA).toBe(ahora.toISOString());
    expect(alternaToma(despues, "OMEGA3").find((t) => t.supplement === "OMEGA3")!.hechaA).toBeUndefined();
    expect(despues.filter((t) => t.hecho)).toHaveLength(1);
    expect(TOMAS.find((t) => t.supplement === "OMEGA3")!.hecho).toBe(false);
  });
});

describe("tomasPorComida — el recordatorio que viaja con la comida", () => {
  const comidas = [
    { slot: "DESAYUNO", hora: "08:00" },
    { slot: "COMIDA", hora: "14:00" },
    { slot: "CENA", hora: "20:30" },
  ];
  const creatina = toma({ supplement: "CREATINA", corto: "creatina", horaSugerida: "13:00" });
  const omega = toma({ supplement: "OMEGA3", corto: "omega-3", horaSugerida: "08:00" });
  const melatonina = toma({ supplement: "MELATONINA", corto: "melatonina", horaSugerida: "22:30" });

  it("otro día: cada toma una vez, en la comida que le toca", () => {
    expect(tomasPorComida([creatina, omega, melatonina], comidas, { soloPendientes: false })).toEqual({
      DESAYUNO: ["omega-3"],
      COMIDA: ["creatina"],
      CENA: ["melatonina"],
    });
  });

  it("hoy: la que no se ha marcado sigue en los avisos que vienen", () => {
    expect(tomasPorComida([omega, creatina], comidas, { soloPendientes: true })).toEqual({
      DESAYUNO: ["omega-3"],
      COMIDA: ["omega-3", "creatina"],
      CENA: ["omega-3", "creatina"],
    });
  });

  it("hoy: la marcada ya no se recuerda", () => {
    const tomada = { ...omega, hecho: true };
    expect(tomasPorComida([tomada, creatina], comidas, { soloPendientes: true })).toEqual({
      DESAYUNO: [],
      COMIDA: ["creatina"],
      CENA: ["creatina"],
    });
  });

  it("la libre va con la primera comida", () => {
    const libre = toma({ supplement: "FIBRA", corto: "fibra", horaSugerida: null });
    expect(tomasPorComida([libre], comidas, { soloPendientes: false }).DESAYUNO).toEqual(["fibra"]);
  });
});
