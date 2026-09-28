import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { persistCheckIn } from "@/lib/checkin-write";
import { runCoachy } from "@/lib/coachy";
import { fromISODate, isoFromDateColumn, shiftISODate, toISODate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { ensureWeekMaterialized } from "@/lib/training/db";
import { mondayOf } from "@/lib/training/generate";
import { checkInSchema, type CheckInInput } from "@/lib/validation/checkin";

/**
 * El ciclo completo tras un check-in mensual, contra la base local y sin
 * Anthropic: la decisión queda publicada, el menú cambia aunque el motor no
 * lo pida y la rutina se rearma de hoy en adelante sin tocar lo entrenado.
 *
 * Se salta sola si no hay Postgres, igual que `coachy-db.test.ts`.
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
    date: "2026-08-02",
    waistCm: 90,
    weightKg: 75,
    inflammation: 2,
    energy: 4,
    hunger: 2,
    satiety: 4,
    sleep: 4,
    strengthRpe: 8,
    strengthTrend: "SUBE",
    dietCompliance: 95,
    trainingCompliance: 100,
    symptoms: [],
    comment: "",
    ...overrides,
  });
}

describe.skipIf(!available)("check-in mensual: el plan de aquí en adelante", () => {
  const userId = randomUUID();

  beforeAll(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.REQUIRE_APPROVAL = "false";

    await prisma.user.create({
      data: { id: userId, email: `mensual-${userId}@coachy.invalid`, role: "ATHLETE" },
    });
    await prisma.profile.create({
      data: {
        userId,
        displayName: "Atleta mensual",
        sex: "FEMALE",
        heightCm: "162.0",
        weightKg: "75.0",
        liftingDays: 4,
        cardioMinWk: 105,
        mealsPerDay: 4,
        goal: "RECOMPOSICION",
        onboardingCompletedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    process.env.REQUIRE_APPROVAL = "true";
    await prisma.$disconnect();
  });

  it("deja la decisión publicada, menú nuevo y la semana rearmada", async () => {
    // Punto cero con brazos y piernas (ancla del contador) y una semana normal.
    const inicio = await persistCheckIn(
      userId,
      input({ armLeftCm: 30, armRightCm: 30, legLeftCm: 55, legRightCm: 55 }),
    );
    await runCoachy(inicio.id);
    const semanal = await persistCheckIn(userId, input({ date: "2026-08-09", waistCm: 89.6 }));
    const resultadoSemanal = await runCoachy(semanal.id);
    expect(resultadoSemanal.mensual?.esMensual).toBe(false);

    // Un día ya entrenado de esta semana (si queda alguno de hoy en adelante)
    // tiene que sobrevivir al rearmado.
    const profile = await prisma.profile.findUniqueOrThrow({ where: { userId } });
    const hoyISO = toISODate(new Date());
    const semana = await ensureWeekMaterialized(userId, profile, fromISODate(hoyISO));
    const entrenado = semana.find((workout) => isoFromDateColumn(workout.date) >= hoyISO) ?? null;
    if (entrenado) {
      await prisma.workoutSet.create({
        data: {
          workoutId: entrenado.id,
          exerciseName: "Sentadilla",
          setIndex: 0,
          targetReps: 10,
          reps: 10,
          clientId: randomUUID(),
        },
      });
    }

    // 28 días después del ancla: mensual por días, sin brazos.
    const mensual = await persistCheckIn(userId, input({ date: "2026-08-30", waistCm: 88.8 }));
    const resultado = await runCoachy(mensual.id);

    expect(resultado.mensual?.esMensual).toBe(true);
    expect(resultado.mensual?.previoMensualId).toBe(inicio.id);
    expect(resultado.mensual?.deltas.cintura.vsMesAnterior).toBe(-1.2);

    const decision = await prisma.decision.findUniqueOrThrow({
      where: { checkInId: mensual.id },
      include: { mealPlans: { orderBy: { menuNumber: "asc" } } },
    });
    expect(decision.status).toBe("APROBADA");
    expect(decision.publishedAt).not.toBeNull();
    expect(decision.mealPlans.length).toBe(2);

    const anterior = await prisma.decision.findUniqueOrThrow({
      where: { checkInId: semanal.id },
      include: { mealPlans: { orderBy: { menuNumber: "asc" } } },
    });
    expect(JSON.stringify(decision.mealPlans[0]?.mealsJson)).not.toBe(
      JSON.stringify(anterior.mealPlans[0]?.mealsJson),
    );

    // La semana siguiente ya existe y la de hoy sigue teniendo su día entrenado.
    const lunesSiguiente = shiftISODate(toISODate(mondayOf(fromISODate(hoyISO))), 7);
    const siguiente = await prisma.workout.count({
      where: { userId, date: { gte: fromISODate(lunesSiguiente) } },
    });
    expect(siguiente).toBeGreaterThan(0);
    expect(resultado.rutina?.sesiones ?? 0).toBeGreaterThan(0);

    if (entrenado) {
      const sigue = await prisma.workout.findUnique({ where: { id: entrenado.id } });
      expect(sigue).not.toBeNull();
    }
  });
});

describe.skipIf(available)("check-in mensual sin base", () => {
  it("se salta la suite de integración cuando no hay Postgres", () => {
    expect(available).toBe(false);
  });
});
