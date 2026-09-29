import { describe, expect, it } from "vitest";

import { cardioDelDia, ordinalDeCardio } from "@/lib/training/cardio-del-dia";
import { esqueletoDeSemana } from "@/lib/training/esqueleto";
import { isoWeekNumber } from "@/lib/training/schemes";
import { presetSplit } from "@/lib/training/split";
import type { TrainingProfile } from "@/lib/training/types";

/**
 * P1b — cambiar la máquina o la modalidad de UN día desde la hoja de cardio:
 * mismos minutos, mismo ordinal, la preferencia guardada intacta.
 */

function mau(overrides: Partial<TrainingProfile> = {}): TrainingProfile {
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
      {
        discipline: "CARDIO",
        sessionsPerWeek: 5,
        modo: "DESPUES",
        cardio: { equipo: "CAMINADORA", tipo: "HIIT", nivel: "BASICO", minutos: 20, nivelBase: { ELIPTICA: 8 } },
      },
    ],
    disciplineLevels: {},
    gymLevel: "INTERMEDIO",
    goal: "PERDIDA_GRASA",
    timePerDay: { LUN: 90, MAR: 90, MIE: 90, JUE: 90, VIE: 90, SAB: 0, DOM: 0 },
    compactDays: true,
    schemePreference: "RECOMENDADO",
    customSplit: presetSplit("INFERIOR_SUPERIOR_3_3", 6),
    edad: 40,
    ...overrides,
  };
}

const LUNES = new Date("2026-09-28T12:00:00");

function semana(profile: TrainingProfile) {
  return esqueletoDeSemana(profile, LUNES).disciplines.sessions;
}

describe("cardio del día con otra máquina o modalidad", () => {
  it("el ordinal es el orden del cardio en la semana", () => {
    const sesiones = semana(mau());
    const fechas = sesiones.filter((s) => s.discipline === "CARDIO").map((s) => s.date).sort();
    expect(ordinalDeCardio(sesiones, fechas[0]!)).toBe(1);
    expect(ordinalDeCardio(sesiones, fechas[2]!)).toBe(3);
    expect(ordinalDeCardio(sesiones, "2026-10-04")).toBeNull();
  });

  it("caminadora → elíptica: mismos minutos, controles de la elíptica sobre su base, pulso incluido", () => {
    const profile = mau();
    const sesiones = semana(profile);
    const original = sesiones.find((s) => s.discipline === "CARDIO")!;
    const hoy = cardioDelDia({ sesiones, fecha: original.date, training: profile, isoWeek: isoWeekNumber(LUNES), cambios: { equipo: "ELIPTICA" } })!;
    expect(hoy.minutes).toBe(original.minutes);
    expect(hoy.sesion.cardio!.equipo).toBe("ELIPTICA");
    const programa = hoy.sesion.cardio!.programa!;
    expect(programa.maquina).toBe("ELIPTICA");
    expect(programa.duracion).toBe(original.minutes);
    expect(programa.base).toBe(8);
    expect(programa.tramos.every((t) => t.control.resistencia !== undefined && t.fcLpm !== undefined)).toBe(true);
    // La preferencia guardada no se tocó.
    expect(profile.otherDisciplines[0]!.cardio!.equipo).toBe("CAMINADORA");
  });

  it("solo la modalidad: zona 2 en la misma caminadora", () => {
    const profile = mau();
    const sesiones = semana(profile);
    const original = sesiones.find((s) => s.discipline === "CARDIO")!;
    const hoy = cardioDelDia({ sesiones, fecha: original.date, training: profile, isoWeek: isoWeekNumber(LUNES), cambios: { tipo: "ZONA2" } })!;
    expect(hoy.sesion.cardio!.programa).toMatchObject({ maquina: "CAMINADORA", modalidad: "ZONA2", duracion: original.minutes });
  });

  it("máquina sin base el 1.er cardio de la semana: calibra", () => {
    const profile = mau();
    const sesiones = semana(profile);
    const primero = sesiones.filter((s) => s.discipline === "CARDIO").sort((a, b) => a.date.localeCompare(b.date))[0]!;
    const hoy = cardioDelDia({ sesiones, fecha: primero.date, training: profile, isoWeek: isoWeekNumber(LUNES), cambios: { equipo: "REMO" } })!;
    expect(hoy.sesion.cardio!.programa!.modalidad).toBe("CALIBRACION");
    expect(hoy.sesion.cardio!.programa!.calibracion!.pasos).toHaveLength(5);
  });

  it("sin cardio ese día: null", () => {
    const profile = mau();
    expect(cardioDelDia({ sesiones: semana(profile), fecha: "2026-10-04", training: profile, isoWeek: 40, cambios: {} })).toBeNull();
  });
});
