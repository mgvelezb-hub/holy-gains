import { describe, expect, it } from "vitest";

import { prescribirSesion } from "@/lib/training/disciplinas";
import { etiquetaCardio, prescribirCardio } from "@/lib/training/disciplinas/cardio";

/**
 * El cardio en máquina después de pesas (H2): calentamiento, bloque
 * principal y enfriamiento; nivel de máquina por nivel de cardio; +1 nivel
 * por semana y descarga la 4.ª.
 */

/** Semana ISO 5 = posición 1 del ciclo (arranque); 8 = descarga. */
const ARRANQUE = 5;

describe("prescribirCardio", () => {
  it("HIIT básico de 20 min en caminadora: 3 + 7 rondas de 1/1 + 2", () => {
    const sesion = prescribirCardio({
      minutes: 20,
      isoWeek: ARRANQUE,
      objetivo: "RECOMPOSICION",
      prefs: { equipo: "CAMINADORA", tipo: "HIIT", nivel: "BASICO" },
    });

    expect(sesion.blocks.map((bloque) => bloque.title)).toEqual(["Calentamiento", "Intervalos", "Enfriamiento"]);
    expect(sesion.blocks[0]!.carga).toBe(3);
    expect(sesion.blocks[2]!.carga).toBe(2);
    expect(sesion.cardio?.intervalos).toMatchObject({ rondas: 7, fuerteSeg: 60, suaveSeg: 60 });
    // Básico arranca en 6–8: el "fuerte" del arranque es 8.
    expect(sesion.cardio?.nivelMaquina).toBe(8);
    expect(sesion.cardio?.etiqueta).toBe("Cardio HIIT caminadora");
  });

  it("el nivel de máquina sale del nivel: básico 6–8, medio 9–12, avanzado 13+", () => {
    const nivelDe = (nivel: "BASICO" | "MEDIO" | "AVANZADO") =>
      prescribirCardio({ minutes: 20, isoWeek: ARRANQUE, objetivo: "RECOMPOSICION", prefs: { tipo: "CONTINUO", nivel } })
        .cardio!.nivelMaquina;
    expect(nivelDe("BASICO")).toBeGreaterThanOrEqual(6);
    expect(nivelDe("BASICO")).toBeLessThanOrEqual(8);
    expect(nivelDe("MEDIO")).toBeGreaterThanOrEqual(9);
    expect(nivelDe("MEDIO")).toBeLessThanOrEqual(12);
    expect(nivelDe("AVANZADO")).toBeGreaterThanOrEqual(13);
  });

  it("continuo es zona 2 sin intervalos", () => {
    const sesion = prescribirCardio({
      minutes: 20,
      isoWeek: ARRANQUE,
      objetivo: "RECOMPOSICION",
      prefs: { tipo: "CONTINUO" },
    });
    expect(sesion.blocks[1]!.title).toBe("Zona 2");
    expect(sesion.cardio?.intervalos).toBeNull();
  });

  it("sube +1 nivel por semana y descarga la 4.ª por debajo del arranque", () => {
    const nivelEn = (isoWeek: number) =>
      prescribirCardio({ minutes: 20, isoWeek, objetivo: "RECOMPOSICION", prefs: { nivel: "BASICO" } }).cardio!
        .nivelMaquina;
    expect(nivelEn(ARRANQUE + 1)).toBe(nivelEn(ARRANQUE) + 1);
    expect(nivelEn(ARRANQUE + 2)).toBe(nivelEn(ARRANQUE) + 2);
    const descarga = prescribirCardio({ minutes: 20, isoWeek: 8, objetivo: "RECOMPOSICION", prefs: {} });
    expect(descarga.deload).toBe(true);
    expect(descarga.cardio!.nivelMaquina).toBeLessThan(nivelEn(ARRANQUE));
  });

  it("libre no dice nivel de máquina", () => {
    const sesion = prescribirCardio({ minutes: 20, isoWeek: ARRANQUE, objetivo: "RECOMPOSICION", prefs: { equipo: "LIBRE" } });
    expect(sesion.blocks.some((bloque) => bloque.detail.includes("nivel"))).toBe(false);
    expect(etiquetaCardio({ equipo: "LIBRE" })).toBe("Cardio HIIT");
  });
});

describe("prescribirSesion con CARDIO", () => {
  it("con preferencias prescribe cardio en máquina; sin ellas, correr como siempre", () => {
    const base = { discipline: "CARDIO" as const, nivel: "PRINCIPIANTE" as const, isoWeek: ARRANQUE, ordinal: 1, minutes: 20, objetivo: "RECOMPOSICION" as const };
    expect(prescribirSesion({ ...base, cardio: {} })?.cardio).toBeDefined();
    expect(prescribirSesion(base)?.cardio).toBeUndefined();
  });
});
