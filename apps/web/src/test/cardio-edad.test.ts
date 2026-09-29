import { describe, expect, it } from "vitest";

import { edadEnAnios } from "@/lib/edad";
import { esqueletoDeSemana } from "@/lib/training/esqueleto";
import { presetSplit } from "@/lib/training/split";
import type { TrainingProfile } from "@/lib/training/types";

/**
 * P1b — la edad llega del perfil a la prescripción de cardio. Antes
 * `CardioInput.edad` nunca venía (el perfil de entrenamiento no la traía) y la
 * app no enseñaba los lpm de cada tramo.
 */

function perfil(overrides: Partial<TrainingProfile> = {}): TrainingProfile {
  return {
    liftingDays: 5,
    trainingSchedule: { LUN: "MANANA", MAR: "MANANA", MIE: "MANANA", JUE: "MANANA", VIE: "MANANA", SAB: "DESCANSO", DOM: "DESCANSO" },
    conditions: [],
    volumeBias: "normal",
    sessionMinutes: 90,
    cardioMinWk: 0,
    avoidRepeatGroups: [],
    primaryDiscipline: "PESAS",
    otherDisciplines: [
      { discipline: "CARDIO", sessionsPerWeek: 5, modo: "DESPUES", cardio: { equipo: "CAMINADORA", tipo: "HIIT", minutos: 20 } },
    ],
    disciplineLevels: {},
    gymLevel: "INTERMEDIO",
    goal: "PERDIDA_GRASA",
    timePerDay: { LUN: 90, MAR: 90, MIE: 90, JUE: 90, VIE: 90, SAB: 0, DOM: 0 },
    compactDays: true,
    schemePreference: "RECOMENDADO",
    customSplit: presetSplit("INFERIOR_SUPERIOR_3_3", 6),
    ...overrides,
  };
}

const LUNES = new Date("2026-09-28T12:00:00");

function programas(profile: TrainingProfile) {
  return esqueletoDeSemana(profile, LUNES)
    .disciplines.sessions.filter((sesion) => sesion.discipline === "CARDIO")
    .map((sesion) => sesion.sesion?.cardio?.programa);
}

describe("edad para las zonas de pulso", () => {
  it("edadEnAnios: fecha exacta, punto medio del rango o nada", () => {
    const hoy = new Date("2026-09-28T12:00:00Z");
    expect(edadEnAnios(new Date("1986-10-01"), null, hoy)).toBe(39);
    expect(edadEnAnios(new Date("1986-09-01"), "25_34", hoy)).toBe(40);
    expect(edadEnAnios(null, "35_44", hoy)).toBe(40);
    expect(edadEnAnios(null, null, hoy)).toBeNull();
  });

  it("con edad en el perfil, cada tramo del cardio trae sus lpm (208 − 0.7 × 40 = 180)", () => {
    const lista = programas(perfil({ edad: 40 }));
    expect(lista.length).toBeGreaterThan(0);
    for (const programa of lista) {
      expect(programa?.fcMaxima).toBe(180);
      expect(programa?.tramos.every((tramo) => tramo.fcLpm !== undefined)).toBe(true);
    }
    const facil = lista[0]!.tramos.find((tramo) => tramo.esfuerzo === "Fácil")!;
    expect(facil.fcLpm).toEqual([90, 108]);
  });

  it("sin edad, el cardio sale igual pero sin lpm", () => {
    const [programa] = programas(perfil());
    expect(programa?.fcMaxima).toBeNull();
    expect(programa?.tramos.some((tramo) => tramo.fcLpm !== undefined)).toBe(false);
  });
});
