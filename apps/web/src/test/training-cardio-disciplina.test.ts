import { describe, expect, it } from "vitest";

import { prescribirSesion } from "@/lib/training/disciplinas";
import {
  baseEstimada,
  etiquetaCardio,
  pasosDeCalibracion,
  prescribirCardio,
  ROTACION_VARIADO,
} from "@/lib/training/disciplinas/cardio";
import { protocoloDelCatalogo } from "@/lib/training/disciplinas/hiit-caminadora";
import { parsePreferenciasCardio, preferenciasCardioSchema } from "@/lib/training/cargas-schema";
import { intensidadDeCardio } from "@/lib/training/combinaciones";

/**
 * El cardio en máquina (H2 → P1): cualquier máquina, cualquier modalidad,
 * anclado al nivel base personal; calibración si falta; +1 nivel de HIIT
 * por semana cumplida y descarga la 4.ª.
 */

/** Semana ISO 5 = posición 1 del ciclo (arranque); 8 = descarga. */
const ARRANQUE = 5;
const base = { isoWeek: ARRANQUE, objetivo: "RECOMPOSICION" as const };

describe("prescribirCardio · máquinas con nivel base", () => {
  it("elíptica HIIT 20' con base 8: programa por plantilla, controles sobre la base", () => {
    const sesion = prescribirCardio({
      ...base,
      minutes: 20,
      prefs: { equipo: "ELIPTICA", tipo: "HIIT", nivel: "MEDIO", nivelBase: { ELIPTICA: 8 } },
    });
    const programa = sesion.cardio!.programa!;
    expect(programa.titulo).toBe("HIIT 20' · Nivel 2 · Elíptica");
    expect(programa.baseEstimada).toBe(false);
    expect(programa.tramos.at(-1)!.hastaMin).toBe(20);
    expect(sesion.blocks.map((b) => b.title)).toEqual(["Calentamiento", "HIIT 20' · Nivel 2 · Elíptica", "Enfriamiento"]);
    expect(sesion.cargaTotal).toBe(20);
    expect(sesion.cardio!.etiqueta).toBe("Cardio HIIT elíptica");
    expect(sesion.cardio!.modalidad).toBe("HIIT");
    expect(sesion.cardio!.tipo).toBe("HIIT");
  });

  it("sin base, la 1.ª sesión de la semana calibra: 5 pasos de 1 min y lo que se guarda", () => {
    const sesion = prescribirCardio({ ...base, minutes: 20, ordinal: 1, prefs: { equipo: "ELIPTICA", nivel: "BASICO" } });
    const programa = sesion.cardio!.programa!;
    expect(programa.modalidad).toBe("CALIBRACION");
    expect(programa.calibracion!.pasos.map((p) => p.valor)).toEqual([4, 5, 6, 7, 8]);
    expect(programa.calibracion!.pasos[2]!.control.texto).toBe("Resist. 6 · 130–140 SPM");
    expect(programa.tramos.filter((t) => t.fase === "calibracion")).toHaveLength(5);
    expect(programa.tramos.at(-1)!.hastaMin).toBe(20);
    expect(sesion.blocks.map((b) => b.title)).toEqual(["Calibración", "Zona 2", "Enfriamiento"]);
    expect(sesion.focus).toBe("Calibración");
  });

  it("sin base, la 2.ª sesión va con la base estimada y lo dice", () => {
    const sesion = prescribirCardio({ ...base, minutes: 20, ordinal: 2, prefs: { equipo: "ELIPTICA", nivel: "BASICO" } });
    expect(sesion.cardio!.programa!.baseEstimada).toBe(true);
    expect(sesion.cardio!.programa!.base).toBe(6);
    expect(sesion.notes.some((n) => /calibras/.test(n))).toBe(true);
  });

  it("remo: calibración por ritmo, zona 2 con ritmo base y damper", () => {
    expect(pasosDeCalibracion("REMO", "BASICO")).toEqual([
      { ritmo500: "2:50" },
      { ritmo500: "2:45" },
      { ritmo500: "2:40" },
      { ritmo500: "2:35" },
      { ritmo500: "2:30" },
    ]);
    const sesion = prescribirCardio({ ...base, minutes: 30, prefs: { equipo: "REMO", tipo: "ZONA2", nivelBase: { REMO: { ritmo500: "2:20" } } } });
    const programa = sesion.cardio!.programa!;
    expect(programa.titulo).toBe("Zona 2 · 30' · Remo");
    expect(programa.tramos.find((t) => t.esfuerzo === "Moderado")!.control.texto).toBe("2:20/500 · 20–24 SPM");
    expect(sesion.notes.some((n) => /damper/i.test(n))).toBe(true);
    expect(sesion.cardio!.tipo).toBe("CONTINUO");
  });

  it("bici de aire calibra en watts", () => {
    expect(baseEstimada("BICI_AIRE", "MEDIO")).toEqual({ watts: 110 });
  });

  it("el HIIT sube +1 nivel por semana cumplida en cualquier máquina y descarga la 4.ª", () => {
    const historial = [37, 38, 39].map((isoWeek) => ({ isoWeek, planeadas: 4, registradas: 4 }));
    const prefs = { equipo: "BICI" as const, tipo: "HIIT" as const, nivelBase: { BICI: 10 } };
    expect(prescribirCardio({ minutes: 20, isoWeek: 39, objetivo: "RECOMPOSICION", prefs, historial }).cardio!.programa!.nivel).toBe(3);
    const descarga = prescribirCardio({ minutes: 20, isoWeek: 40, objetivo: "RECOMPOSICION", prefs, historial });
    expect(descarga.deload).toBe(true);
    expect(descarga.cardio!.programa!.nivel).toBe(2);
  });
});

describe("prescribirCardio · modalidades", () => {
  it("CONTINUO (nombre viejo) es zona 2", () => {
    const sesion = prescribirCardio({ ...base, minutes: 20, prefs: { tipo: "CONTINUO" } });
    expect(sesion.cardio!.modalidad).toBe("ZONA2");
    expect(sesion.focus).toBe("Zona 2");
    expect(sesion.cardio!.intervalos).toBeNull();
  });

  it("descarga: tempo, 4×4 y pirámide pasan a recuperación", () => {
    for (const tipo of ["TEMPO", "NORUEGO", "PIRAMIDAL"] as const) {
      const sesion = prescribirCardio({ minutes: 40, isoWeek: 8, objetivo: "RENDIMIENTO", prefs: { equipo: "BICI", tipo, nivelBase: { BICI: 10 } } });
      expect(sesion.cardio!.modalidad, tipo).toBe("RECUPERACION");
      expect(sesion.notes.some((n) => /descarga/.test(n))).toBe(true);
    }
  });

  it("variado rota por objetivo: bajar grasa = HIIT, zona 2, HIIT, recuperación", () => {
    expect(ROTACION_VARIADO.PERDIDA_GRASA).toEqual(["HIIT", "ZONA2", "HIIT", "RECUPERACION"]);
    const modalidades = [1, 2, 3, 4, 5].map(
      (ordinal) =>
        prescribirCardio({
          minutes: 25,
          isoWeek: ARRANQUE,
          objetivo: "PERDIDA_GRASA",
          ordinal,
          prefs: { equipo: "ELIPTICA", tipo: "VARIADO", nivelBase: { ELIPTICA: 8 } },
        }).cardio!.modalidad,
    );
    expect(modalidades).toEqual(["HIIT", "ZONA2", "HIIT", "RECUPERACION", "HIIT"]);
  });

  it("4×4 que no cabe va HIIT y lo explica", () => {
    const sesion = prescribirCardio({ ...base, minutes: 20, prefs: { equipo: "CAMINADORA", tipo: "NORUEGO" } });
    expect(sesion.cardio!.modalidad).toBe("HIIT");
    expect(sesion.notes.some((n) => /35 min/.test(n))).toBe(true);
  });

  it("con edad, los tramos traen pulso", () => {
    const sesion = prescribirCardio({ ...base, minutes: 20, edad: 40, prefs: { equipo: "CAMINADORA", tipo: "ZONA2" } });
    expect(sesion.cardio!.programa!.fcMaxima).toBe(180);
    expect(sesion.cardio!.programa!.tramos.every((t) => t.fcLpm !== undefined)).toBe(true);
  });

  it("libre no dice nivel de máquina", () => {
    const sesion = prescribirCardio({ ...base, minutes: 20, prefs: { equipo: "LIBRE" } });
    expect(sesion.blocks.some((bloque) => /nivel \d/i.test(bloque.detail))).toBe(false);
    expect(sesion.cardio!.programa!.modalidad).toBe("HIIT");
    expect(etiquetaCardio({ equipo: "LIBRE" })).toBe("Cardio HIIT");
  });
});

describe("HIIT en caminadora (N1 → P1)", () => {
  const caminadora = { equipo: "CAMINADORA" as const, tipo: "HIIT" as const };

  it("15' y 25' corren el protocolo real de Mau, sin calibrar", () => {
    const sesion = prescribirCardio({ ...base, minutes: 15, prefs: { ...caminadora, nivel: "BASICO" } });
    expect(sesion.cardio!.programa!.fuente).toBe("catalogo");
    expect(sesion.cardio!.protocolo).toMatchObject({ duracion: 15, nivel: 0, caminataMin: 0, recortado: false });
    expect(sesion.cardio!.protocolo!.tramos).toEqual(protocoloDelCatalogo(15, 0)!.tramos);
    expect(sesion.cardio!.programa!.tramos[0]!.control.kmh).toEqual([4, 5]);
    expect(sesion.cardio!.unidad).toBe("kmh");
  });

  it("20' (lo de Mau) ya no es 15' + caminata: plantilla de 20' con km/h del nivel", () => {
    const sesion = prescribirCardio({ ...base, minutes: 20, prefs: { ...caminadora, nivel: "BASICO" } });
    const programa = sesion.cardio!.programa!;
    expect(programa).toMatchObject({ fuente: "plantilla", duracion: 20, nivel: 0, titulo: "HIIT 20' · Nivel 0 · Caminadora" });
    expect(sesion.cardio!.protocolo).toBeUndefined();
    expect(programa.tramos.every((t) => t.control.kmh !== undefined)).toBe(true);
    expect(sesion.blocks.map((b) => b.title)).not.toContain("Caminata suave");
  });

  it("medio arranca en 2 y avanzado en 4", () => {
    const nivelDe = (nivel: "MEDIO" | "AVANZADO") =>
      prescribirCardio({ ...base, minutes: 15, prefs: { ...caminadora, nivel } }).cardio!.programa!.nivel;
    expect(nivelDe("MEDIO")).toBe(2);
    expect(nivelDe("AVANZADO")).toBe(4);
  });

  it("en mph si la preferencia lo pide (la app convierte los km/h)", () => {
    const sesion = prescribirCardio({ ...base, minutes: 20, prefs: { ...caminadora, unidadVelocidad: "mph" } });
    expect(sesion.cardio!.unidad).toBe("mph");
  });
});

describe("prescribirSesion con CARDIO", () => {
  it("pasa el historial y el ordinal", () => {
    const sesion = prescribirSesion({
      discipline: "CARDIO",
      nivel: "PRINCIPIANTE",
      isoWeek: 39,
      ordinal: 2,
      minutes: 15,
      objetivo: "RECOMPOSICION",
      cardio: { equipo: "ELIPTICA" },
      historialCardio: [{ isoWeek: 38, planeadas: 5, registradas: 4 }],
    });
    // Ordinal 2: no calibra, va con base estimada; nivel 0 + 1 semana cumplida.
    expect(sesion?.cardio?.programa?.modalidad).toBe("HIIT");
    expect(sesion?.cardio?.programa?.nivel).toBe(1);
  });

  it("con preferencias prescribe cardio en máquina; sin ellas, correr como siempre", () => {
    const entrada = { discipline: "CARDIO" as const, nivel: "PRINCIPIANTE" as const, isoWeek: ARRANQUE, ordinal: 1, minutes: 20, objetivo: "RECOMPOSICION" as const };
    expect(prescribirSesion({ ...entrada, cardio: {} })?.cardio).toBeDefined();
    expect(prescribirSesion(entrada)?.cardio).toBeUndefined();
  });
});

describe("preferencias de cardio (P1)", () => {
  it("la API acepta las máquinas, modalidades y el nivel base nuevos", () => {
    const leido = preferenciasCardioSchema.parse({
      equipo: "REMO",
      tipo: "VARIADO",
      nivelBase: { ELIPTICA: 8, REMO: { ritmo500: "2:20" }, BICI_AIRE: { watts: 120 } },
    });
    expect(leido.nivelBase).toEqual({ ELIPTICA: 8, REMO: { ritmo500: "2:20" }, BICI_AIRE: { watts: 120 } });
    expect(preferenciasCardioSchema.safeParse({ nivelBase: { REMO: { ritmo500: "2:75" } } }).success).toBe(false);
  });

  it("del JSON guardado, cada base inválida se descarta sola", () => {
    expect(parsePreferenciasCardio({ tipo: "TEMPO", nivelBase: { ELIPTICA: 8, BICI: "diez", REMO: { ritmo500: "x" } } })).toEqual({
      tipo: "TEMPO",
      nivelBase: { ELIPTICA: 8 },
    });
  });

  it("intensidad: recuperación baja, 4×4 alta, tempo media", () => {
    expect(intensidadDeCardio({ tipo: "RECUPERACION" })).toBe("baja");
    expect(intensidadDeCardio({ tipo: "NORUEGO" })).toBe("alta");
    expect(intensidadDeCardio({ tipo: "TEMPO" })).toBe("media");
    expect(intensidadDeCardio({ tipo: "ZONA2" })).toBe("baja");
  });
});
