import { describe, expect, it } from "vitest";

import { MINUTOS_SIN_TEXTO, estadoDelAnalisis } from "@/lib/api/decision-estado";

/**
 * `GET /api/v1/decision` le dice a la app si el análisis del check-in ya
 * está: "lista" es publicada y con su retro; mientras tanto, "analizando".
 */
describe("estadoDelAnalisis", () => {
  const ahora = new Date("2026-09-28T18:00:00.000Z");
  const hace = (min: number): Date => new Date(ahora.getTime() - min * 60_000);

  it("sin decisión todavía, analizando", () => {
    expect(estadoDelAnalisis(null, ahora)).toEqual({ estado: "analizando", enRevisionHumana: false });
  });

  it("publicada y con texto, lista", () => {
    expect(
      estadoDelAnalisis({ status: "APROBADA", publishedAt: hace(1), tieneTexto: true }, ahora),
    ).toEqual({ estado: "lista", enRevisionHumana: false });
  });

  it("publicada pero todavía sin texto: el pipeline sigue corriendo", () => {
    expect(
      estadoDelAnalisis({ status: "APROBADA", publishedAt: hace(1), tieneTexto: false }, ahora)
        .estado,
    ).toBe("analizando");
  });

  it("publicada sin texto hace mucho: no se queda girando para siempre", () => {
    expect(
      estadoDelAnalisis(
        { status: "APROBADA", publishedAt: hace(MINUTOS_SIN_TEXTO + 1), tieneTexto: false },
        ahora,
      ).estado,
    ).toBe("lista");
  });

  it("esperando a su coach humano: analizando, y lo dice", () => {
    expect(
      estadoDelAnalisis({ status: "PENDIENTE", publishedAt: null, tieneTexto: true }, ahora),
    ).toEqual({ estado: "analizando", enRevisionHumana: true });
  });

  it("corregida por el coach cuenta como lista", () => {
    expect(
      estadoDelAnalisis({ status: "CORREGIDA", publishedAt: hace(5), tieneTexto: true }, ahora)
        .estado,
    ).toBe("lista");
  });
});
