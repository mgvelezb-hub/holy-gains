import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { persistCheckIn } from "@/lib/checkin-write";
import { runCheckinAnalysis } from "@/lib/coachy/analyze";
import { prisma } from "@/lib/prisma";
import { checkInSchema, type CheckInInput } from "@/lib/validation/checkin";

/**
 * L1-A — la fase declarada en el perfil manda en la primera decisión.
 *
 * `analyze.ts` corría `decide()` sin fase inicial: un perfil que declara CUT
 * salía en BASE. Con historial de decisiones, la fase la pone lo ya decidido.
 * Se salta sola si no hay Postgres.
 */
async function databaseReachable(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  try {
    await prisma.$queryRaw`select 1`;
    return true;
  } catch {
    return false;
  }
}

const available = await databaseReachable();

function input(overrides: Partial<CheckInInput> = {}): CheckInInput {
  return checkInSchema.parse({
    date: "2026-08-16",
    waistCm: 110,
    weightKg: 118,
    inflammation: 2,
    energy: 4,
    hunger: 2,
    satiety: 4,
    sleep: 4,
    strengthRpe: 8,
    strengthTrend: "IGUAL",
    dietCompliance: 95,
    trainingCompliance: 100,
    symptoms: [],
    comment: "",
    ...overrides,
  });
}

async function creaPerfilCut(userId: string): Promise<void> {
  await prisma.user.create({
    data: { id: userId, email: `fase-${userId}@coachy.invalid`, role: "ATHLETE" },
  });
  await prisma.profile.create({
    data: {
      userId,
      displayName: "Declara CUT",
      sex: "MALE",
      heightCm: "182.0",
      weightKg: "120.0",
      liftingDays: 5,
      cardioMinWk: 90,
      mealsPerDay: 4,
      goal: "PERDIDA_GRASA",
      currentPhase: "CUT",
      onboardingCompletedAt: new Date(),
    },
  });
}

describe.skipIf(!available)("L1-A — fase declarada en el check-in", () => {
  const sinHistorial = randomUUID();
  const conHistorial = randomUUID();

  beforeAll(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await creaPerfilCut(sinHistorial);
    await creaPerfilCut(conHistorial);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [sinHistorial, conHistorial] } } });
    await prisma.$disconnect();
  });

  it("perfil CUT sin decisiones → la primera decisión sale CUT", async () => {
    const checkIn = await persistCheckIn(sinHistorial, input());
    const { decision } = await runCheckinAnalysis(checkIn.id);
    expect(decision.phase).toBe("CUT");
  });

  it("con una decisión previa BASE → sigue la transición normal desde BASE", async () => {
    const primero = await persistCheckIn(conHistorial, input());
    // La decisión que ya existía (nació desde BASE, como antes del cambio).
    await prisma.decision.create({
      data: {
        checkInId: primero.id,
        userId: conHistorial,
        phase: "BASE",
        kcal: 2600,
        proteinG: 200,
        fatG: 80,
        carbsG: 260,
        explanation: "decisión previa",
        status: "APROBADA",
        publishedAt: new Date(),
      },
    });

    const segundo = await persistCheckIn(conHistorial, input({ date: "2026-08-23", weightKg: 117.4, waistCm: 109.5 }));
    const { decision, engineDecision } = await runCheckinAnalysis(segundo.id);

    // Lo mismo que el motor decide partiendo de BASE, no de la fase declarada.
    expect(engineDecision.previousPhase).toBe("BASE");
    expect(decision.phase).toBe(engineDecision.phase);
    expect(decision.phase).not.toBe("CUT");
  });
});
