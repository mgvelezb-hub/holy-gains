import { describe, expect, it } from "vitest";
import { MENU_ENGINE_VERSION } from "engine";

import {
  AVISO_MENU_ACTUALIZADO,
  avisoDeMenuActualizado,
  menusDesactualizados,
  semillaGuardada,
  sellaMenu,
  versionDelMenu,
} from "@/lib/coachy/version-menu";

const comida = (slot: string, extra: Record<string, unknown> = {}) => ({ slot, items: [], equivalences: [], ...extra });

describe("versión del motor guardada en mealsJson", () => {
  it("un menú sin versión es de la versión 1 (antes de guardarla)", () => {
    expect(versionDelMenu([comida("DESAYUNO"), comida("COMIDA")])).toBe(1);
    expect(versionDelMenu(null)).toBe(1);
  });

  it("sellaMenu pone versionMotor y la semilla en cada comida sin tocar lo demás", () => {
    const sellado = sellaMenu([comida("DESAYUNO", { label: "Desayuno" })], { semilla: 77 });
    expect(sellado).toEqual([
      { slot: "DESAYUNO", items: [], equivalences: [], label: "Desayuno", versionMotor: MENU_ENGINE_VERSION, semillaMenu: 77 },
    ]);
    expect(versionDelMenu(sellado)).toBe(MENU_ENGINE_VERSION);
    expect(semillaGuardada(sellado)).toBe(77);
  });

  it("la versión del menú es la más vieja de sus comidas", () => {
    expect(versionDelMenu([comida("A", { versionMotor: 2 }), comida("B")])).toBe(1);
  });

  it("menusDesactualizados: algún menú con versión menor; sin menús no hay nada que rehacer", () => {
    const viejo = { mealsJson: [comida("A")] };
    const nuevo = { mealsJson: sellaMenu([comida("A")], { semilla: 1 }) };
    expect(menusDesactualizados([viejo, nuevo])).toBe(true);
    expect(menusDesactualizados([nuevo, nuevo])).toBe(false);
    expect(menusDesactualizados([])).toBe(false);
  });

  it("el aviso solo sale si el menú se rehízo por las reglas nuevas", () => {
    const rehecho = { mealsJson: sellaMenu([comida("A")], { semilla: 1, porReglasNuevas: true }) };
    const normal = { mealsJson: sellaMenu([comida("A")], { semilla: 1 }) };
    expect(avisoDeMenuActualizado([rehecho, rehecho])).toBe(AVISO_MENU_ACTUALIZADO);
    expect(avisoDeMenuActualizado([normal])).toBeNull();
    expect(avisoDeMenuActualizado([])).toBeNull();
    expect(AVISO_MENU_ACTUALIZADO).toBe("Tu menú se actualizó con las reglas nuevas");
  });

  it("semillaGuardada: null si el menú no la trae", () => {
    expect(semillaGuardada([comida("A")])).toBeNull();
  });
});
