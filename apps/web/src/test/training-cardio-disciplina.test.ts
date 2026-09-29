import { describe, expect, it } from "vitest";

import { prescribirSesion } from "@/lib/training/disciplinas";
import { etiquetaCardio, prescribirCardio } from "@/lib/training/disciplinas/cardio";
import { protocoloDelCatalogo } from "@/lib/training/disciplinas/hiit-caminadora";

/**
 * El cardio en máquina después de pesas (H2): calentamiento, bloque
 * principal y enfriamiento; nivel de máquina por nivel de cardio; +1 nivel
 * por semana y descarga la 4.ª.
 */

/** Semana ISO 5 = posición 1 del ciclo (arranque); 8 = descarga. */
const ARRANQUE = 5;

describe("prescribirCardio", () => {
  // Desde N1 la caminadora HIIT corre los protocolos por km/h; el "nivel de
  // máquina" sigue para elíptica, bici y escalera.
  it("HIIT básico de 20 min en elíptica: 3 + 7 rondas de 1/1 + 2", () => {
    const sesion = prescribirCardio({
      minutes: 20,
      isoWeek: ARRANQUE,
      objetivo: "RECOMPOSICION",
      prefs: { equipo: "ELIPTICA", tipo: "HIIT", nivel: "BASICO" },
    });

    expect(sesion.blocks.map((bloque) => bloque.title)).toEqual(["Calentamiento", "Intervalos", "Enfriamiento"]);
    expect(sesion.blocks[0]!.carga).toBe(3);
    expect(sesion.blocks[2]!.carga).toBe(2);
    expect(sesion.cardio?.intervalos).toMatchObject({ rondas: 7, fuerteSeg: 60, suaveSeg: 60 });
    // Básico arranca en 6–8: el "fuerte" del arranque es 8.
    expect(sesion.cardio?.nivelMaquina).toBe(8);
    expect(sesion.cardio?.etiqueta).toBe("Cardio HIIT elíptica");
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
      prescribirCardio({ minutes: 20, isoWeek, objetivo: "RECOMPOSICION", prefs: { equipo: "BICI", nivel: "BASICO" } }).cardio!
        .nivelMaquina;
    expect(nivelEn(ARRANQUE + 1)).toBe(nivelEn(ARRANQUE) + 1);
    expect(nivelEn(ARRANQUE + 2)).toBe(nivelEn(ARRANQUE) + 2);
    const descarga = prescribirCardio({ minutes: 20, isoWeek: 8, objetivo: "RECOMPOSICION", prefs: { equipo: "BICI" } });
    expect(descarga.deload).toBe(true);
    expect(descarga.cardio!.nivelMaquina).toBeLessThan(nivelEn(ARRANQUE));
  });

  it("libre no dice nivel de máquina", () => {
    const sesion = prescribirCardio({ minutes: 20, isoWeek: ARRANQUE, objetivo: "RECOMPOSICION", prefs: { equipo: "LIBRE" } });
    expect(sesion.blocks.some((bloque) => bloque.detail.includes("nivel"))).toBe(false);
    expect(etiquetaCardio({ equipo: "LIBRE" })).toBe("Cardio HIIT");
  });
});

describe("HIIT en caminadora por velocidad real (N1)", () => {
  const caminadora = { equipo: "CAMINADORA" as const, tipo: "HIIT" as const };

  it("los 20 min de Mau, básico, sin historial: HIIT 15' nivel 0 + 5 min de caminata suave", () => {
    const sesion = prescribirCardio({
      minutes: 20,
      isoWeek: ARRANQUE,
      objetivo: "RECOMPOSICION",
      prefs: { ...caminadora, nivel: "BASICO" },
    });
    const protocolo = sesion.cardio!.protocolo!;
    expect(protocolo).toMatchObject({ duracion: 15, nivel: 0, caminataMin: 5, recortado: false });
    expect(protocolo.tramos).toEqual(protocoloDelCatalogo(15, 0)!.tramos);
    expect(sesion.cardio!.unidad).toBe("kmh");
    expect(sesion.cardio!.intervalos).toBeNull();
    expect(sesion.blocks.map((bloque) => bloque.title)).toEqual([
      "Calentamiento",
      "HIIT 15' · Nivel 0",
      "Enfriamiento",
      "Caminata suave",
    ]);
    expect(sesion.blocks.at(-1)!.detail).toBe("5 min · 5–6 km/h");
    expect(sesion.cargaTotal).toBe(20);
    // Ni rastro del "nivel de máquina" de H2: aquí se habla en km/h.
    expect(sesion.blocks.some((bloque) => /nivel \d/.test(bloque.detail))).toBe(false);
  });

  it("≥ 25 min: el 25'; justo 25 no deja caminata", () => {
    const sesion = prescribirCardio({ minutes: 25, isoWeek: ARRANQUE, objetivo: "RECOMPOSICION", prefs: caminadora });
    expect(sesion.cardio!.protocolo).toMatchObject({ duracion: 25, caminataMin: 0 });
    expect(sesion.blocks.map((bloque) => bloque.title)).not.toContain("Caminata suave");
  });

  it("el nivel sube con las semanas cumplidas del historial y descarga la 4.ª", () => {
    const historial = [37, 38, 39].map((isoWeek) => ({ isoWeek, planeadas: 5, registradas: 5 }));
    const nivelEn = (isoWeek: number) =>
      prescribirCardio({ minutes: 20, isoWeek, objetivo: "RECOMPOSICION", prefs: caminadora, historial }).cardio!
        .protocolo!.nivel;
    expect(nivelEn(39)).toBe(3);
    const descarga = prescribirCardio({ minutes: 20, isoWeek: 40, objetivo: "RECOMPOSICION", prefs: caminadora, historial });
    expect(descarga.deload).toBe(true);
    expect(descarga.cardio!.protocolo!.nivel).toBe(2);
  });

  it("medio arranca en 2 y avanzado en 4", () => {
    const nivelDe = (nivel: "MEDIO" | "AVANZADO") =>
      prescribirCardio({ minutes: 15, isoWeek: ARRANQUE, objetivo: "RECOMPOSICION", prefs: { ...caminadora, nivel } })
        .cardio!.protocolo!.nivel;
    expect(nivelDe("MEDIO")).toBe(2);
    expect(nivelDe("AVANZADO")).toBe(4);
  });

  it("en mph si la preferencia lo pide", () => {
    const sesion = prescribirCardio({
      minutes: 20,
      isoWeek: ARRANQUE,
      objetivo: "RECOMPOSICION",
      prefs: { ...caminadora, unidadVelocidad: "mph" },
    });
    expect(sesion.cardio!.unidad).toBe("mph");
    expect(sesion.blocks.at(-1)!.detail).toBe("5 min · 3.1–3.7 mph");
  });

  it("elíptica, bici, escalera y caminadora continua siguen con el nivel de máquina", () => {
    for (const prefs of [{ equipo: "ELIPTICA" as const, tipo: "HIIT" as const }, { equipo: "CAMINADORA" as const, tipo: "CONTINUO" as const }]) {
      const sesion = prescribirCardio({ minutes: 20, isoWeek: ARRANQUE, objetivo: "RECOMPOSICION", prefs });
      expect(sesion.cardio!.protocolo).toBeUndefined();
    }
  });
});

describe("prescribirSesion con CARDIO", () => {
  it("pasa el historial de cardio al HIIT de caminadora", () => {
    const sesion = prescribirSesion({
      discipline: "CARDIO",
      nivel: "PRINCIPIANTE",
      isoWeek: 39,
      ordinal: 1,
      minutes: 20,
      objetivo: "RECOMPOSICION",
      cardio: {},
      historialCardio: [{ isoWeek: 38, planeadas: 5, registradas: 4 }],
    });
    expect(sesion?.cardio?.protocolo?.nivel).toBe(1);
  });

  it("con preferencias prescribe cardio en máquina; sin ellas, correr como siempre", () => {
    const base = { discipline: "CARDIO" as const, nivel: "PRINCIPIANTE" as const, isoWeek: ARRANQUE, ordinal: 1, minutes: 20, objetivo: "RECOMPOSICION" as const };
    expect(prescribirSesion({ ...base, cardio: {} })?.cardio).toBeDefined();
    expect(prescribirSesion(base)?.cardio).toBeUndefined();
  });
});
