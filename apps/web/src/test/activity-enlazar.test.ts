import { describe, expect, it } from "vitest";

import { buscaGemela, type SesionComparable } from "@/lib/activity/enlazar";

/**
 * H2 — el cardio de después de pesas se registra desde la sesión en vivo
 * (APP), y si el reloj lo grabó también llega por HealthKit. Es la MISMA
 * sesión: se enlaza, no se duplica.
 */

function sesion(overrides: Partial<SesionComparable> = {}): SesionComparable {
  return {
    discipline: "CARDIO",
    source: "APP",
    externalId: null,
    date: "2026-09-28",
    startedAt: "2026-09-28T19:30:00.000Z",
    endedAt: "2026-09-28T19:50:00.000Z",
    durationMin: 20,
    ...overrides,
  };
}

describe("buscaGemela", () => {
  it("HealthKit que se traslapa con la del app, misma disciplina y día: es la gemela", () => {
    const app = sesion();
    const reloj = sesion({
      source: "HEALTHKIT",
      externalId: "hk-1",
      startedAt: "2026-09-28T19:31:00.000Z",
      endedAt: "2026-09-28T19:52:00.000Z",
    });
    expect(buscaGemela(reloj, [app])).toBe(app);
    expect(buscaGemela(app, [reloj])).toBe(reloj);
  });

  it("misma fuente, otra disciplina, otro día o sin traslape: no enlaza", () => {
    const reloj = sesion({ source: "HEALTHKIT", externalId: "hk-1" });
    expect(buscaGemela(reloj, [sesion({ source: "HEALTHKIT", externalId: "hk-2" })])).toBeNull();
    expect(buscaGemela(reloj, [sesion({ discipline: "NATACION" })])).toBeNull();
    expect(buscaGemela(reloj, [sesion({ date: "2026-09-27" })])).toBeNull();
    expect(
      buscaGemela(reloj, [
        sesion({ startedAt: "2026-09-28T12:00:00.000Z", endedAt: "2026-09-28T12:20:00.000Z" }),
      ]),
    ).toBeNull();
  });

  it("una del app que ya se enlazó (trae externalId) no vuelve a enlazar", () => {
    const reloj = sesion({ source: "HEALTHKIT", externalId: "hk-1" });
    expect(buscaGemela(reloj, [sesion({ externalId: "hk-0" })])).toBeNull();
  });
});
