import type { Prisma } from "@prisma/client";
import { DEFAULT_CONFIG, distribute, generateMenu, kcalForDeficit, macrosFor, pickDeficit } from "engine";
import type { Profile } from "engine";
import { describe, expect, it } from "vitest";

import {
  CambioPlatilloError,
  aplicaCambioDePlatillo,
  opcionesDePlatilloGuardado,
} from "@/lib/coachy/cambio-platillo";

const MAU: Profile = {
  sex: "male",
  ageYears: 38,
  heightCm: 182,
  weightKg: 120,
  strengthDaysPerWeek: 5,
  cardioMinPerWeek: 90,
  work: "sedentario",
  mealsPerDay: 4,
  trainingTime: "manana",
  budget: "medio",
};

/** Un menú guardado de Mau con una sopa, tal como queda en `mealsJson`. */
function menuConSopa() {
  const kcal = kcalForDeficit(MAU, pickDeficit("CUT", DEFAULT_CONFIG), DEFAULT_CONFIG);
  const slots = distribute(macrosFor("CUT", MAU, kcal, DEFAULT_CONFIG), MAU, "CUT");
  for (const seed of [101, 102, 103, 104, 105, 106, 107]) {
    for (const menu of generateMenu(slots, MAU, DEFAULT_CONFIG, seed, { phase: "CUT" }).menus) {
      const meal = menu.meals.find((m) => m.preparacion && m.preparacion.tipo !== "licuado");
      if (!meal) continue;
      const mealsJson = JSON.parse(JSON.stringify(menu.meals)) as Prisma.JsonValue;
      const opciones = opcionesDePlatilloGuardado(mealsJson, meal.slot, MAU);
      if (opciones.length === 0) continue;
      const equivalencesJson = menu.meals.flatMap((m) =>
        m.equivalences.map((e) => ({ slot: m.slot, ...e })),
      ) as unknown as Prisma.JsonValue;
      return { mealsJson, equivalencesJson, slot: meal.slot, actual: meal.preparacion!, opciones };
    }
  }
  throw new Error("la semana de Mau no trajo sopa con opciones");
}

describe("cambiar el platillo guardado", () => {
  it("ofrece sopas, cremas o caldos por la sopa", () => {
    const { opciones, actual } = menuConSopa();
    for (const o of opciones) {
      expect(["sopa", "crema", "caldo"]).toContain(o.tipo);
      expect(o.id).not.toBe(actual.id);
    }
  });

  it("reemplaza todos los ingredientes del platillo y rehace su equivalencia aplanada", () => {
    const { mealsJson, equivalencesJson, slot, opciones } = menuConSopa();
    const elegida = opciones[0]!;
    const r = aplicaCambioDePlatillo(mealsJson, equivalencesJson, { slot, preparacionId: elegida.id }, MAU);
    const comida = (r.mealsJson as any[]).find((m) => m.slot === slot);
    expect(comida.preparacion.id).toBe(elegida.id);
    const delPlatillo = comida.items.filter((i: any) => i.preparacion);
    expect(delPlatillo.length).toBeGreaterThanOrEqual(2);
    expect(delPlatillo.every((i: any) => i.preparacion.id === elegida.id)).toBe(true);
    const planoDelSlot = (r.equivalencesJson as any[]).filter((e) => e.slot === slot);
    expect(planoDelSlot.map((e) => e.forName).sort()).toEqual(
      comida.equivalences.map((e: any) => e.forName).sort(),
    );
    // Las demás comidas no se tocan.
    const otras = (r.mealsJson as any[]).filter((m) => m.slot !== slot);
    expect(otras).toEqual((mealsJson as any[]).filter((m) => m.slot !== slot));
  });

  it("rechaza un platillo que no es opción o una comida sin platillo", () => {
    const { mealsJson, equivalencesJson, slot } = menuConSopa();
    expect(() =>
      aplicaCambioDePlatillo(mealsJson, equivalencesJson, { slot, preparacionId: "licuado_verde" }, MAU),
    ).toThrow(CambioPlatilloError);
    expect(() => opcionesDePlatilloGuardado(mealsJson, "NO_EXISTE", MAU)).toThrow(CambioPlatilloError);
  });
});
