import { describe, expect, it } from "vitest";

import { HOJA_ABRIR_MS, HOJA_CERRAR_MS, destinoHoja, inicioHoja } from "@/lib/hoja-animacion";
import { VELO_OPACIDAD } from "@/lib/theme";

/**
 * La hoja sin parpadeo: el velo va en opacidad y la hoja se desliza OPACA.
 * Nada de lo que aquí se calcula toca la opacidad de la hoja — esa es la
 * regla que evita que su texto se encime con la pantalla de atrás.
 */
describe("inicioHoja", () => {
  it("arranca con el velo apagado y la hoja fuera de la pantalla, abajo", () => {
    expect(inicioHoja({ reducirMovimiento: false, distancia: 800 })).toEqual({ velo: 0, desplazamiento: 800 });
  });

  it("con Reducir movimiento la hoja ya está en su lugar: no hay deslizamiento", () => {
    expect(inicioHoja({ reducirMovimiento: true, distancia: 800 })).toEqual({ velo: 0, desplazamiento: 0 });
  });
});

describe("destinoHoja", () => {
  it("al abrir, el velo sube a su opacidad y la hoja llega a 0", () => {
    expect(destinoHoja({ visible: true, reducirMovimiento: false, distancia: 800 })).toEqual({
      velo: VELO_OPACIDAD,
      desplazamiento: 0,
      duracionMs: HOJA_ABRIR_MS,
    });
  });

  it("al cerrar hace el camino inverso, un poco más rápido", () => {
    expect(destinoHoja({ visible: false, reducirMovimiento: false, distancia: 800 })).toEqual({
      velo: 0,
      desplazamiento: 800,
      duracionMs: HOJA_CERRAR_MS,
    });
    expect(HOJA_CERRAR_MS).toBeLessThan(HOJA_ABRIR_MS);
  });

  it("con Reducir movimiento aparece y se va de inmediato, sin moverse", () => {
    expect(destinoHoja({ visible: true, reducirMovimiento: true, distancia: 800 })).toEqual({
      velo: VELO_OPACIDAD,
      desplazamiento: 0,
      duracionMs: 0,
    });
    expect(destinoHoja({ visible: false, reducirMovimiento: true, distancia: 800 })).toEqual({
      velo: 0,
      desplazamiento: 0,
      duracionMs: 0,
    });
  });
});
