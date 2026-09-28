import { describe, expect, it } from "vitest";

import { cargaDisciplinaSchema } from "@/lib/training/cargas-schema";
import { planDisciplines } from "@/lib/training/disciplines";
import { replanificar, type TiempoPorDia } from "@/lib/training/replan";
import { WEEK_DAYS, type WeekDay } from "@/lib/training/split";
import type { DayKind } from "@/lib/training/types";

/**
 * H2 — el perfil real de Mau: PESAS 5 días (L–V, 90 min), CARDIO como
 * disciplina adicional "después de pesas", 5 por semana. Antes de este
 * cambio el cardio se perdía por DOS caminos, ninguno de los que se
 * sospechaban en `combinaciones.ts`:
 *
 * 1. `PATCH /me/entrenamiento` validaba cada carga con un `z.object` SIN
 *    `modo`: zod tira las llaves desconocidas, así que "después de pesas" se
 *    guardaba como carga sin modo (= día propio).
 * 2. `replanificar` le daba a la primaria los 5 días con tiempo: sin huecos,
 *    el cardio salía con 0 sesiones, sin aviso, y `cargas` ni lo nombraba —
 *    la ruta sobrescribía `otherDisciplines` y el cardio desaparecía del
 *    perfil.
 */

const MONDAY = new Date("2026-01-05T12:00:00");

const TIEMPO_MAU: TiempoPorDia = Object.fromEntries(
  WEEK_DAYS.map((dia) => [dia, ["SAB", "DOM"].includes(dia) ? 0 : 90]),
) as TiempoPorDia;

const GYM_MAU = new Map<WeekDay, DayKind>([
  ["LUN", "PIERNA_CUADRICEPS"],
  ["MAR", "PECHO_ESPALDA"],
  ["MIE", "HOMBRO"],
  ["JUE", "PIERNA_FEMORAL"],
  ["VIE", "BRAZO"],
]);

describe("H2 · el cardio después de pesas de Mau", () => {
  it("Ajustes: la carga conserva modo y preferencias de cardio al validarse", () => {
    const carga = cargaDisciplinaSchema.parse({
      discipline: "CARDIO",
      sessionsPerWeek: 5,
      modo: "DESPUES",
      cardio: { equipo: "CAMINADORA", tipo: "HIIT", nivel: "BASICO", minutos: 20 },
    });
    expect(carga.modo).toBe("DESPUES");
    expect(carga.cardio).toEqual({ equipo: "CAMINADORA", tipo: "HIIT", nivel: "BASICO", minutos: 20 });
  });

  it("replanificar: 5 bloques de cardio pegados al gym, y el gym cede los minutos", () => {
    const replan = replanificar({
      tiempo: TIEMPO_MAU,
      primaria: "PESAS",
      sesionesPrimaria: 5,
      secundarias: [
        {
          discipline: "CARDIO",
          proposito: "COMPLEMENTO",
          importancia: 2,
          modo: "DESPUES",
          sesiones: 5,
          cardio: { minutos: 20 },
        },
      ],
    });

    const cardio = replan.asignadas.filter((sesion) => sesion.discipline === "CARDIO");
    expect(cardio.map((sesion) => sesion.weekday)).toEqual(["LUN", "MAR", "MIE", "JUE", "VIE"]);
    expect(cardio.every((sesion) => sesion.minutos === 20)).toBe(true);
    const pesas = replan.asignadas.filter((sesion) => sesion.discipline === "PESAS");
    expect(pesas.every((sesion) => sesion.minutos === 70)).toBe(true);

    const carga = replan.cargas.find((entrada) => entrada.discipline === "CARDIO");
    expect(carga).toMatchObject({ sessionsPerWeek: 5, modo: "DESPUES", cardio: { minutos: 20 } });
  });

  it("replanificar: una secundaria de día propio sin hueco se avisa y no se borra del perfil", () => {
    const replan = replanificar({
      tiempo: TIEMPO_MAU,
      primaria: "PESAS",
      sesionesPrimaria: 5,
      secundarias: [{ discipline: "CARDIO", proposito: "COMPLEMENTO", importancia: 2 }],
    });

    expect(replan.cargas.find((entrada) => entrada.discipline === "CARDIO")).toBeDefined();
    expect(replan.avisos.some((aviso) => aviso.toLowerCase().includes("cardio"))).toBe(true);
  });

  it("planDisciplines: 5 bloques de 20 min, gym a 70, sin aviso de pierna (cardio ligero)", () => {
    const plan = planDisciplines({
      weekStart: MONDAY,
      otherDisciplines: [
        {
          discipline: "CARDIO",
          sessionsPerWeek: 5,
          modo: "DESPUES",
          cardio: { equipo: "CAMINADORA", tipo: "HIIT", nivel: "BASICO", minutos: 20 },
        },
      ],
      gymByDay: GYM_MAU,
      niveles: {},
      objetivo: "RECOMPOSICION",
      isoWeek: 2,
      timePerDay: TIEMPO_MAU,
      compactos: true,
    });

    const cardio = plan.sessions.filter((sesion) => sesion.discipline === "CARDIO");
    expect(cardio).toHaveLength(5);
    expect(cardio.every((sesion) => sesion.minutes === 20 && sesion.orden === 2)).toBe(true);
    expect(Object.values(plan.gymMinutesPorFecha)).toEqual([70, 70, 70, 70, 70]);
    expect(plan.avisos).toEqual([]);
  });

  it("planDisciplines: el día de menos de 45 min se avisa con su nombre, no se tira", () => {
    const plan = planDisciplines({
      weekStart: MONDAY,
      otherDisciplines: [{ discipline: "CARDIO", sessionsPerWeek: 5, modo: "DESPUES", cardio: { minutos: 20 } }],
      gymByDay: GYM_MAU,
      niveles: {},
      objetivo: "RECOMPOSICION",
      isoWeek: 2,
      timePerDay: { ...TIEMPO_MAU, MAR: 40 },
    });

    expect(plan.sessions.filter((sesion) => sesion.discipline === "CARDIO")).toHaveLength(4);
    expect(plan.avisos).toContain("El cardio no cupo el martes: 40 min declarados (pide al menos 45).");
  });

  it("planDisciplines: HIIT avanzado en día de pierna entra, con aviso de riesgo", () => {
    const plan = planDisciplines({
      weekStart: MONDAY,
      otherDisciplines: [
        { discipline: "CARDIO", sessionsPerWeek: 5, modo: "DESPUES", cardio: { tipo: "HIIT", nivel: "AVANZADO" } },
      ],
      gymByDay: GYM_MAU,
      niveles: {},
      objetivo: "RECOMPOSICION",
      isoWeek: 2,
      timePerDay: TIEMPO_MAU,
    });

    expect(plan.sessions.filter((sesion) => sesion.discipline === "CARDIO")).toHaveLength(5);
    expect(plan.avisos.filter((aviso) => aviso.includes("riesgo de lesión"))).toHaveLength(2);
  });
});
