import "server-only";

import type { Profile } from "@prisma/client";
import {
  pautasDeSuplementos,
  resumenTomas,
  sugerirSuplementos,
  tomasDeHoy,
  type MealSlotId,
  type ResultadoSugerencias,
  type TomaDelDia,
} from "engine";

import { toEngineProfile } from "@/lib/coachy/mapping";
import { currentMealPlan } from "@/lib/coachy/menu";
import { toMenuView } from "@/lib/coachy/menu-view";
import type { EngineProfile } from "@/lib/engine-types";
import { decimalToNumber, fromISODate, isoFromDateColumn, shiftISODate, toISODate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { entradaDeSugerencias } from "@/lib/suplementos/entrada";

/**
 * Suplementos contra la base: trae las filas y se las da al motor.
 *
 * Aquí no se decide nada. Qué se sugiere lo decide `sugerirSuplementos` y a
 * qué comida se amarra cada toma lo decide `tomasDeHoy`; esta capa solo junta
 * lo que esas funciones necesitan leer.
 */

const SLOTS: readonly MealSlotId[] = ["PRE", "POST", "DESAYUNO", "COMIDA", "CENA", "SNACK"];

async function pesoActual(userId: string, profile: Profile): Promise<number> {
  const ultimo = await prisma.checkIn.findFirst({
    where: { userId, weightKg: { not: null } },
    orderBy: { date: "desc" },
    select: { weightKg: true },
  });
  return decimalToNumber(ultimo?.weightKg ?? null) ?? decimalToNumber(profile.weightKg) ?? 70;
}

async function decisionVigente(userId: string) {
  return prisma.decision.findFirst({
    where: { userId, publishedAt: { not: null } },
    orderBy: { publishedAt: "desc" },
    select: { phase: true, kcal: true, proteinG: true },
  });
}

/**
 * Las sugerencias de hoy. `decision` permite pasar la recién calculada en el
 * check-in, que todavía puede no estar publicada.
 */
export async function sugerenciasPara(
  userId: string,
  profile: Profile,
  opciones: { hoy?: string; decision?: { phase: Profile["currentPhase"]; kcal: number; proteinG: number } } = {},
): Promise<ResultadoSugerencias> {
  const hoy = opciones.hoy ?? toISODate(new Date());
  const hace14 = fromISODate(shiftISODate(hoy, -14));

  const [checkIns, healthDays, labs, cardio, decision, pesoKg] = await Promise.all([
    prisma.checkIn.findMany({
      where: { userId, date: { lte: fromISODate(hoy) } },
      orderBy: { date: "desc" },
      take: 2,
      select: { date: true, energy: true, hunger: true, satiety: true, sleep: true, symptoms: true },
    }),
    prisma.healthDay.findMany({
      where: { userId, date: { gte: hace14, lte: fromISODate(hoy) } },
      select: { date: true, sleepMin: true, restingHr: true, hrvMs: true, steps: true, exerciseMin: true },
    }),
    prisma.labResult.findMany({
      where: { userId, kind: "QUIMICA", takenOn: { gte: fromISODate(shiftISODate(hoy, -365)) } },
      select: { takenOn: true, valuesJson: true },
    }),
    prisma.activitySession.findMany({
      where: { userId, discipline: "CARDIO", date: { gte: hace14 } },
      select: { durationMin: true },
    }),
    opciones.decision ? Promise.resolve(opciones.decision) : decisionVigente(userId),
    pesoActual(userId, profile),
  ]);

  return sugerirSuplementos(
    entradaDeSugerencias({
      hoy,
      perfil: profile,
      pesoKg,
      decision: decision ?? null,
      checkIns: checkIns.map((c) => ({ ...c, date: isoFromDateColumn(c.date) })),
      healthDays: healthDays.map((d) => ({ ...d, date: isoFromDateColumn(d.date) })),
      labs: labs.map((l) => ({ takenOn: isoFromDateColumn(l.takenOn), valuesJson: l.valuesJson })),
      cardioSesionesMin: cardio.map((s) => s.durationMin),
    }),
  );
}

/** El perfil del motor para la pauta; si al perfil le faltan datos, lo mínimo que la pauta usa. */
function perfilParaPauta(profile: Profile, pesoKg: number): EngineProfile {
  try {
    return toEngineProfile(profile, pesoKg);
  } catch {
    return { weightKg: pesoKg, supplements: profile.supplements } as unknown as EngineProfile;
  }
}

/** Los slots del menú vigente, en el orden del día. Sin menú, el día de tres comidas. */
async function slotsDelDia(userId: string, profile: Profile): Promise<MealSlotId[]> {
  const plan = await currentMealPlan(userId, profile).catch(() => null);
  const primero = plan?.plans[0];
  if (!primero) return ["DESAYUNO", "COMIDA", "CENA"];
  return toMenuView(primero.menuNumber, primero.mealsJson)
    .meals.map((meal) => meal.slot)
    .filter((slot): slot is MealSlotId => (SLOTS as readonly string[]).includes(slot));
}

export async function tomasPara(
  userId: string,
  profile: Profile,
  hoy: string = toISODate(new Date()),
  /** Los slots del menú de hoy, si quien pregunta ya los tiene (`planDeNutricion`). */
  slotsDeHoy?: MealSlotId[],
): Promise<{ tomas: TomaDelDia[]; resumen: ReturnType<typeof resumenTomas> }> {
  const [pesoKg, decision, slots, logs] = await Promise.all([
    pesoActual(userId, profile),
    decisionVigente(userId),
    slotsDeHoy ? Promise.resolve(slotsDeHoy) : slotsDelDia(userId, profile),
    prisma.supplementLog.findMany({
      where: { userId, date: fromISODate(hoy) },
      select: { supplement: true, taken: true, createdAt: true },
    }),
  ]);

  const pautas = pautasDeSuplementos({
    profile: perfilParaPauta(profile, pesoKg),
    macros: { kcal: decision?.kcal ?? 0, proteinG: decision?.proteinG ?? 0, carbG: 0, fatG: 0, fiberG: 0 },
    phase: decision?.phase ?? profile.currentPhase,
  });
  // `createdAt` es cuándo se marcó (el registro lo renueva al marcar): la
  // app dice "tomada 14:05".
  const tomas = tomasDeHoy({
    pautas,
    slots,
    logs: logs.map((log) => ({ supplement: log.supplement, taken: log.taken, at: log.createdAt })),
  });
  return { tomas, resumen: resumenTomas(tomas) };
}
