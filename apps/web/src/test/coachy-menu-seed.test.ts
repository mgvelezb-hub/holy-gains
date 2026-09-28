import { describe, expect, it } from "vitest";

import { semillaDelMenu } from "@/lib/coachy/menu";

/**
 * El menú nuevo del mensual: con la misma semilla el generador entrega el
 * mismo menú, así que forzar el refresco es correr la semilla — pero solo
 * cuando no cambió ya por sí sola.
 */
describe("semillaDelMenu", () => {
  it("sin forzar, manda la semilla del motor", () => {
    expect(semillaDelMenu(1450, { menuSeedChanged: false })).toBe(1450);
    expect(semillaDelMenu(1450, { forceRefresh: false, menuSeedChanged: false })).toBe(1450);
  });

  it("forzado con la misma quincena, se corre una posición", () => {
    expect(semillaDelMenu(1450, { forceRefresh: true, menuSeedChanged: false })).toBe(1451);
  });

  it("forzado cuando la quincena ya cambió, no hace falta correrla", () => {
    expect(semillaDelMenu(1451, { forceRefresh: true, menuSeedChanged: true })).toBe(1451);
  });
});
