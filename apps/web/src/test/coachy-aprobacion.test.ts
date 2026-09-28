import { describe, expect, it } from "vitest";

import { DIAS_REVISION_HUMANA, necesitaRevisionHumana } from "@/lib/coachy/aprobacion";

/**
 * ¿La decisión espera a un humano o sale publicada?
 *
 * `REQUIRE_APPROVAL` es global, pero "tener coach humano" es de cada perfil:
 * lo tiene quien recibió una revisión humana (aprobar o corregir) hace poco.
 * Un perfil guiado por IA no puede quedarse esperando a nadie.
 */
describe("necesitaRevisionHumana", () => {
  const ahora = new Date("2026-09-28T18:00:00.000Z");
  const haceDias = (dias: number): Date => new Date(ahora.getTime() - dias * 86_400_000);

  it("con REQUIRE_APPROVAL apagado nunca espera", () => {
    expect(
      necesitaRevisionHumana({ requireApproval: false, ultimaRevisionHumana: haceDias(1), ahora }),
    ).toBe(false);
  });

  it("sin revisión humana nunca, el perfil lo guía la IA y se publica solo", () => {
    expect(
      necesitaRevisionHumana({ requireApproval: true, ultimaRevisionHumana: null, ahora }),
    ).toBe(false);
  });

  it("con un humano revisando en las últimas semanas, espera su aprobación", () => {
    expect(
      necesitaRevisionHumana({ requireApproval: true, ultimaRevisionHumana: haceDias(7), ahora }),
    ).toBe(true);
    expect(
      necesitaRevisionHumana({
        requireApproval: true,
        ultimaRevisionHumana: haceDias(DIAS_REVISION_HUMANA),
        ahora,
      }),
    ).toBe(true);
  });

  it("si el humano dejó de revisar hace más de la ventana, vuelve a la IA", () => {
    expect(
      necesitaRevisionHumana({
        requireApproval: true,
        ultimaRevisionHumana: haceDias(DIAS_REVISION_HUMANA + 1),
        ahora,
      }),
    ).toBe(false);
  });
});
