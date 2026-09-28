import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { persistCheckIn } from "@/lib/checkin-write";
import { runCheckinAnalysis } from "@/lib/coachy/analyze";
import { runCoachy } from "@/lib/coachy";
import { prisma } from "@/lib/prisma";
import { checkInSchema, type CheckInInput } from "@/lib/validation/checkin";

/**
 * El orquestador contra la base local, sin API de Anthropic.
 *
 * Es el escenario que más importa que aguante: si Claude no contesta (sin
 * llave, timeout, deploy a media ejecución), la decisión del motor tiene que
 * quedar guardada igual, con sus preguntas y sus menús. El texto es lo único
 * que se pierde.
 *
 * Se salta sola si no hay Postgres, igual que `checkin-db.test.ts`.
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

describe.skipIf(!available)("runCoachy contra la base", () => {
  const userId = randomUUID();

  beforeAll(async () => {
    // La suite corre sin llave de Anthropic a propósito.
    delete process.env.ANTHROPIC_API_KEY;
    process.env.REQUIRE_APPROVAL = "true";

    await prisma.user.create({
      data: { id: userId, email: `coachy-${userId}@coachy.invalid`, role: "ATHLETE" },
    });
    await prisma.profile.create({
      data: {
        userId,
        displayName: "Atleta de prueba",
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
    await prisma.$disconnect();
  });

  it("sin API de Anthropic guarda la decisión y una retro determinista", async () => {
    const checkIn = await persistCheckIn(userId, input());

    const result = await runCoachy(checkIn.id);

    expect(result.status).toBe("ok");
    expect(result.redaccion).toBe("determinista");
    expect(result.reason).toContain("ANTHROPIC_API_KEY");

    const decision = await prisma.decision.findUnique({ where: { checkInId: checkIn.id } });
    expect(decision).not.toBeNull();
    expect(decision?.kcal).toBeGreaterThan(1000);
    expect(decision?.proteinG).toBeGreaterThan(0);
    expect(decision?.explanation.length).toBeGreaterThan(0);

    const reply = decision?.replyJson as { retro?: { plan?: { macros?: string } } } | null;
    expect(reply?.retro?.plan?.macros).toContain(`${decision?.kcal} kcal`);
  });

  it("sin coach humano se publica sola aunque REQUIRE_APPROVAL esté prendido", async () => {
    // Nadie ha aprobado ni corregido nada de este perfil: lo guía la IA.
    const decision = await prisma.decision.findFirstOrThrow({ where: { userId } });
    expect(decision.status).toBe("APROBADA");
    expect(decision.publishedAt).not.toBeNull();
  });

  it("nace PENDIENTE y sin publicar si un humano la está revisando", async () => {
    // Un admin aprobó la decisión anterior: este perfil tiene coach humano.
    await prisma.decision.updateMany({ where: { userId }, data: { approvedAt: new Date() } });

    const checkIn = await persistCheckIn(userId, input({ date: "2026-08-23", waistCm: 89.5 }));

    await runCoachy(checkIn.id);

    const decision = await prisma.decision.findUnique({ where: { checkInId: checkIn.id } });
    expect(decision?.status).toBe("PENDIENTE");
    expect(decision?.publishedAt).toBeNull();
  });

  it("guarda entre 1 y 3 preguntas, y no repite las de la semana pasada", async () => {
    const decisions = await prisma.decision.findMany({
      where: { userId },
      orderBy: { checkIn: { date: "asc" } },
      include: { checkIn: true },
    });

    expect(decisions.length).toBeGreaterThanOrEqual(2);

    for (const decision of decisions) {
      expect(decision.questionIds.length).toBeGreaterThan(0);
      expect(decision.questionIds.length).toBeLessThanOrEqual(3);
    }

    const [first, second] = decisions;
    const repeated = second?.questionIds.filter((id) => first?.questionIds.includes(id)) ?? [];
    expect(repeated).toEqual([]);
  });

  it("genera los dos menús con su lista de súper", async () => {
    const decision = await prisma.decision.findFirst({
      where: { userId },
      orderBy: { checkIn: { date: "desc" } },
      include: { mealPlans: { orderBy: { menuNumber: "asc" } } },
    });

    expect(decision?.mealPlans.length).toBe(2);
    expect(decision?.mealPlans[0]?.menuNumber).toBe(1);
    expect(Array.isArray(decision?.mealPlans[0]?.mealsJson)).toBe(true);
    expect(Array.isArray(decision?.mealPlans[0]?.groceryListJson)).toBe(true);
  });

  it("es idempotente: correrlo dos veces no duplica decisiones ni menús", async () => {
    const checkIn = await prisma.checkIn.findFirstOrThrow({
      where: { userId },
      orderBy: { date: "desc" },
    });

    await runCoachy(checkIn.id);
    await runCoachy(checkIn.id);

    const decisions = await prisma.decision.count({ where: { checkInId: checkIn.id } });
    const plans = await prisma.mealPlan.count({ where: { decision: { checkInId: checkIn.id } } });

    expect(decisions).toBe(1);
    expect(plans).toBe(2);
  });

  it("publica sola cuando REQUIRE_APPROVAL está apagado", async () => {
    process.env.REQUIRE_APPROVAL = "false";

    const checkIn = await persistCheckIn(userId, input({ date: "2026-08-30", waistCm: 89 }));
    await runCheckinAnalysis(checkIn.id);

    const decision = await prisma.decision.findUnique({ where: { checkInId: checkIn.id } });
    expect(decision?.status).toBe("APROBADA");
    expect(decision?.publishedAt).not.toBeNull();

    process.env.REQUIRE_APPROVAL = "true";
  });

  it("no analiza el check-in de nadie más: cada corrida se ata a su atleta", async () => {
    const decisions = await prisma.decision.findMany({ where: { userId } });
    expect(decisions.every((decision) => decision.userId === userId)).toBe(true);
  });
});

describe.skipIf(available)("runCoachy sin base", () => {
  it("se salta la suite de integración cuando no hay Postgres", () => {
    expect(available).toBe(false);
  });
});
