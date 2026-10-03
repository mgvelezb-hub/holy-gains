import { describe, expect, it } from "vitest";

import type { TomaDelDia } from "@/lib/api";
import {
  AYUDA_TOMAS,
  alternaToma,
  estadoToma,
  renglonToma,
  sufijoTomas,
  tomasDeComida,
  tomasSueltas,
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

describe("las tomas dentro de la comida", () => {
  it("cada comida trae solo las suyas, en el orden del día", () => {
    expect(tomasDeComida(TOMAS, "COMIDA").map((t) => t.supplement)).toEqual(["OMEGA3", "VITAMINA_D3"]);
    expect(tomasDeComida(TOMAS, "CENA")).toEqual([]);
  });

  it("las que no van con comida salen aparte", () => {
    expect(tomasSueltas(TOMAS).map((t) => t.supplement)).toEqual(["MELATONINA"]);
  });

  it("el renglón dice qué hacer: sin marcar invita a tocarlo al tomarlo", () => {
    expect(renglonToma(TOMAS[0]!)).toBe("Creatina 5 g · tócalo al tomarlo");
    expect(renglonToma(TOMAS[1]!)).toBe("Omega-3 1 a 2 cápsulas · tócalo al tomarlo");
    expect(estadoToma(TOMAS[0]!)).toBe("pendiente");
  });

  it("marcada dice a qué hora se tomó, sin tachar", () => {
    const hecha = toma({ hecho: true, hechaA: new Date(2026, 8, 29, 14, 5).toISOString() });
    expect(renglonToma(hecha)).toBe("Creatina 5 g · tomada 14:05");
    expect(estadoToma(hecha)).toBe("tomada");
  });

  it("marcada sin hora (la que se acaba de tocar) dice tomada", () => {
    expect(renglonToma(toma({ hecho: true }))).toBe("Creatina 5 g · tomada");
  });

  it("la ayuda explica que el check es haberla tomado, no aceptarla", () => {
    expect(AYUDA_TOMAS).toBe("Marca cada suplemento cuando lo tomes; así sabemos si lo llevas diario");
  });

  it("la tarjeta de la comida lo dice en corto", () => {
    expect(sufijoTomas(tomasDeComida(TOMAS, "DESAYUNO"))).toBe("+ creatina");
    expect(sufijoTomas(tomasDeComida(TOMAS, "COMIDA"))).toBe("+ 2 tomas");
    expect(sufijoTomas([])).toBe("");
    expect(sufijoTomas([toma({ hecho: true })])).toBe("+ creatina ✓");
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
