import { describe, expect, it } from "vitest";

import { accionListo, correrAlGuardar } from "@/lib/api/checkin-flujo";

/**
 * Cuándo corre Coachy tras un check-in de la app: al guardar si no vienen
 * fotos; si vienen, hasta que la app avisa que ya las subió (`/listo`), para
 * que la lectura de fotos use las de ESE check-in.
 */
describe("correrAlGuardar", () => {
  it("sin fotos pendientes corre al guardar, como siempre", () => {
    expect(correrAlGuardar({})).toBe(true);
    expect(correrAlGuardar({ fotosPendientes: false })).toBe(true);
  });

  it("con fotos pendientes espera a /listo", () => {
    expect(correrAlGuardar({ fotosPendientes: true })).toBe(false);
  });

  it("solo el booleano true cuenta: un string no lo apaga", () => {
    expect(correrAlGuardar({ fotosPendientes: "true" })).toBe(true);
  });
});

describe("accionListo", () => {
  it("sin decisión todavía, corre", () => {
    expect(accionListo({ tieneDecision: false })).toBe("correr");
  });

  it("si ya hay decisión, no vuelve a correr (idempotente)", () => {
    expect(accionListo({ tieneDecision: true })).toBe("ya_corrio");
  });
});
