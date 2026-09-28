import { describe, expect, it } from "vitest";

import type { DetalleCardio } from "@/lib/api";
import { actividadDeCardio, notasDeCardio, pasosDeCardio, renglonDeCardio, tituloTarjetaCardio } from "@/lib/cardio";

/**
 * H2 — el bloque de cardio al cerrar la última serie: su tarjeta, los pasos
 * que corre el timer del calentamiento dinámico y lo que se registra.
 */

const HIIT: DetalleCardio = {
  equipo: "CAMINADORA",
  tipo: "HIIT",
  nivelMaquina: 8,
  etiqueta: "Cardio HIIT caminadora",
  intervalos: { rondas: 7, fuerteSeg: 60, suaveSeg: 60, nivelFuerte: 8, nivelSuave: 3 },
  calentamientoSeg: 180,
  enfriamientoSeg: 120,
};

describe("cardio después de pesas", () => {
  it("la tarjeta se lee 'Cardio · 20 min · caminadora HIIT nivel 8'", () => {
    expect(tituloTarjetaCardio(HIIT, 20)).toBe("Cardio · 20 min · caminadora HIIT nivel 8");
    expect(tituloTarjetaCardio({ ...HIIT, equipo: "LIBRE" }, 20)).toBe("Cardio · 20 min · HIIT");
  });

  it("HIIT: calentamiento, rondas fuerte/suave con su nivel, enfriamiento", () => {
    const pasos = pasosDeCardio(HIIT, 20);
    expect(pasos[0]).toEqual({ nombre: "Calentamiento · nivel 3", segundos: 180 });
    expect(pasos[1]).toEqual({ nombre: "Fuerte · nivel 8 · ronda 1 de 7", segundos: 60 });
    expect(pasos[2]).toEqual({ nombre: "Suave · nivel 3 · ronda 1 de 7", segundos: 60 });
    expect(pasos.at(-1)).toEqual({ nombre: "Enfriamiento", segundos: 120 });
    expect(pasos).toHaveLength(1 + 7 * 2 + 1);
  });

  it("continuo: un solo tramo de zona 2 con lo que queda del bloque", () => {
    const pasos = pasosDeCardio({ ...HIIT, tipo: "CONTINUO", intervalos: null, nivelMaquina: 7 }, 20);
    expect(pasos.map((paso) => paso.segundos)).toEqual([180, 20 * 60 - 180 - 120, 120]);
    expect(pasos[1]!.nombre).toBe("Zona 2 · nivel 7");
  });

  it("registra minutos reales, tipo y nivel como sesión de CARDIO del día", () => {
    const inicio = new Date("2026-09-28T19:30:00.000Z");
    const fin = new Date("2026-09-28T19:49:40.000Z");
    expect(actividadDeCardio(HIIT, "2026-09-28", inicio, fin)).toEqual({
      discipline: "CARDIO",
      source: "APP",
      externalId: null,
      startedAt: inicio.toISOString(),
      endedAt: fin.toISOString(),
      date: "2026-09-28",
      durationMin: 20,
      notes: notasDeCardio(HIIT),
    });
    expect(notasDeCardio(HIIT)).toBe("HIIT · caminadora · nivel 8");
  });
});

describe("renglón de Ajustes (H2)", () => {
  it("'Cardio · 5/semana · después de pesas · HIIT caminadora 20 min'", () => {
    expect(
      renglonDeCardio({
        discipline: "CARDIO",
        sessionsPerWeek: 5,
        modo: "DESPUES",
        cardio: { equipo: "CAMINADORA", tipo: "HIIT", minutos: 20 },
      }),
    ).toBe("Cardio · 5/semana · después de pesas · HIIT caminadora 20 min");
  });

  it("sin preferencias declaradas usa los defaults del motor", () => {
    expect(renglonDeCardio({ discipline: "CARDIO", sessionsPerWeek: 1, modo: "DESPUES" })).toBe(
      "Cardio · 1/semana · después de pesas · HIIT caminadora 20 min",
    );
  });
});
