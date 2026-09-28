import { describe, expect, it } from "vitest";

import type { Menu } from "@/lib/api";
import type { PlanNutricion } from "@/lib/api-nutricion";
import { comidaDeHoy, filasDeHoy } from "@/lib/comidas-hoy";

function menu(menuNumber: number, hora: string): Menu {
  return {
    menuNumber,
    meals: [
      { slot: "DESAYUNO", label: "Desayuno", timeHint: hora, allowDenseCarb: true, items: [], equivalences: [] },
      { slot: "COMIDA", label: "Comida", timeHint: "14:00", allowDenseCarb: true, items: [], equivalences: [] },
    ],
  };
}

const PLAN = {
  menus: [menu(1, "07:00"), menu(2, "07:30")],
  menuDeHoy: 2,
  hoy: {
    fecha: "2026-09-29",
    dia: "MAR",
    comidas: [
      { slot: "DESAYUNO", label: "Desayuno", hora: "09:15", resumen: "", tomas: ["creatina"] },
      { slot: "COMIDA", label: "Comida", hora: "15:00", resumen: "", tomas: [] },
    ],
  },
} as unknown as PlanNutricion;

describe("Mis comidas hoy lee el día del plan", () => {
  it("las filas salen de hoy.comidas, con la hora que rige hoy", () => {
    expect(filasDeHoy(PLAN)).toEqual([
      { slot: "DESAYUNO", label: "Desayuno", hora: "09:15" },
      { slot: "COMIDA", label: "Comida", hora: "15:00" },
    ]);
  });

  it("la hoja de una comida usa el menú de HOY, no el primero", () => {
    const { meal, hora } = comidaDeHoy(PLAN, "DESAYUNO");
    expect(meal?.timeHint).toBe("07:30");
    expect(hora).toBe("09:15");
  });

  it("sin la comida en el día, cae a la hora del menú", () => {
    const sinHoy = { ...PLAN, hoy: { ...PLAN.hoy, comidas: [] } } as unknown as PlanNutricion;
    expect(comidaDeHoy(sinHoy, "COMIDA").hora).toBe("14:00");
    expect(comidaDeHoy(sinHoy, "CENA")).toEqual({ meal: null, hora: null });
  });
});
