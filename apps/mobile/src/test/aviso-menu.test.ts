import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * El aviso "Tu menú se actualizó con las reglas nuevas" se ve UNA vez por
 * decisión: el servidor lo manda mientras los menús sean los rehechos por
 * versión, y el teléfono recuerda que ya lo enseñó.
 */

const almacen = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (llave: string) => almacen.get(llave) ?? null,
    setItem: async (llave: string, valor: string) => {
      almacen.set(llave, valor);
    },
  },
}));

const { avisoDeMenuPorMostrar, marcaAvisoDeMenuVisto } = await import("@/lib/aviso-menu");

const AVISO = "Tu menú se actualizó con las reglas nuevas";

describe("aviso de menú actualizado", () => {
  beforeEach(() => almacen.clear());

  it("sin aviso del servidor no hay nada que mostrar", async () => {
    expect(await avisoDeMenuPorMostrar({ decision: { id: "d1" }, aviso: null })).toBeNull();
    expect(await avisoDeMenuPorMostrar({ decision: { id: "d1" } })).toBeNull();
    expect(await avisoDeMenuPorMostrar({ decision: null, aviso: AVISO })).toBeNull();
  });

  it("se muestra una vez por decisión", async () => {
    const plan = { decision: { id: "d1" }, aviso: AVISO };
    const primero = await avisoDeMenuPorMostrar(plan);
    expect(primero?.texto).toBe(AVISO);

    await marcaAvisoDeMenuVisto(primero!.llave);
    expect(await avisoDeMenuPorMostrar(plan)).toBeNull();

    // Otra decisión rehecha por otra versión vuelve a avisar.
    expect((await avisoDeMenuPorMostrar({ decision: { id: "d2" }, aviso: AVISO }))?.texto).toBe(AVISO);
  });
});
