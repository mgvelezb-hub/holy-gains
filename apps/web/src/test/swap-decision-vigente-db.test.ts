import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * "No me deja sustituir nada": el cambio de alimento decía que el alimento
 * "no está en la comida" aunque se eligiera de las opciones que la app mostraba.
 *
 * El menú que se ve (`GET /nutrition` → `currentMealPlan`) sale de
 * `decisionVigente`: la última PUBLICADA, incluida una CORREGIDA desde el
 * admin. El cambio (`POST /nutricion/swap`) buscaba otra: la última APROBADA
 * por fecha de check-in. Cuando no coinciden, el cambio se aplicaba sobre el
 * menú de otra decisión y ahí el alimento no existía.
 *
 * Se salta sola si no hay Postgres, igual que las demás pruebas de base.
 */
vi.mock("@/lib/api/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/auth")>("@/lib/api/auth");
  return {
    ...actual,
    apiUser: vi.fn(async (request: Request) => {
      const userId = request.headers.get("x-test-user-id");
      if (!userId) return null;
      const { prisma } = await import("@/lib/prisma");
      return prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
    }),
  };
});

const { POST } = await import("@/app/api/v1/nutricion/swap/route");
const { currentMealPlan } = await import("@/lib/coachy/menu");
const { prisma } = await import("@/lib/prisma");

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

type JsonRecord = Record<string, unknown>;

describe.skipIf(!available)("el cambio de alimento usa el menú que se ve", () => {
  const userId = randomUUID();
  let corregidaId = "";

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email: `swap-${userId}@coachy.invalid`, role: "ATHLETE" },
    });
    await prisma.profile.create({
      data: {
        userId,
        displayName: "Atleta de prueba",
        sex: "FEMALE",
        heightCm: "165.0",
        weightKg: "70.0",
        liftingDays: 5,
        cardioMinWk: 20,
        mealsPerDay: 4,
        trainingTime: "MEDIODIA",
        goal: "PERDIDA_GRASA",
        currentPhase: "BASE",
        onboardingCompletedAt: new Date(),
      },
    });

    const checkIn = (date: string) =>
      prisma.checkIn.create({
        data: {
          userId,
          date: new Date(date),
          weightKg: "70.0",
          inflammation: 2,
          energy: 4,
          hunger: 3,
          satiety: 3,
          sleep: 4,
          dietCompliance: 80,
          trainingCompliance: 80,
          symptoms: [],
        },
      });

    // La semana anterior: aprobada y publicada.
    const vieja = await checkIn("2026-09-14T12:00:00.000Z");
    await prisma.decision.create({
      data: {
        checkInId: vieja.id,
        userId,
        phase: "BASE",
        kcal: 1900,
        proteinG: 140,
        fatG: 55,
        carbsG: 210,
        explanation: "Semana anterior.",
        status: "APROBADA",
        publishedAt: new Date("2026-09-14T13:00:00.000Z"),
        menuSeed: 11,
      },
    });

    // La vigente: corregida desde el admin y publicada después.
    const nueva = await checkIn("2026-09-28T12:00:00.000Z");
    const corregida = await prisma.decision.create({
      data: {
        checkInId: nueva.id,
        userId,
        phase: "BASE",
        kcal: 1700,
        proteinG: 130,
        fatG: 45,
        carbsG: 195,
        explanation: "Corregida por el coach.",
        status: "CORREGIDA",
        publishedAt: new Date("2026-09-28T13:00:00.000Z"),
        menuSeed: 22,
      },
    });
    corregidaId = corregida.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("aplica el cambio sobre el menú de la decisión vigente", async () => {
    const profile = await prisma.profile.findUniqueOrThrow({ where: { userId } });
    const current = await currentMealPlan(userId, profile);
    expect(current?.decision.id).toBe(corregidaId);

    const plan = current!.plans.find((p) => p.menuNumber === 1)!;
    const meals = plan.mealsJson as JsonRecord[];
    const meal = meals.find((m) => Array.isArray(m.equivalences) && m.equivalences.length > 0)!;
    const equivalencia = (meal.equivalences as JsonRecord[]).find(
      (e) => Array.isArray(e.options) && e.options.length > 0,
    )!;
    const forName = String(equivalencia.forName);
    const toName = String((equivalencia.options as JsonRecord[])[0]!.name);

    const response = await POST(
      new Request("http://localhost/api/v1/nutricion/swap", {
        method: "POST",
        headers: { "content-type": "application/json", "x-test-user-id": userId },
        body: JSON.stringify({ menuNumber: 1, slot: meal.slot, forName, toName }),
      }),
    );

    expect(response.status).toBe(200);
    const guardado = await prisma.mealPlan.findUniqueOrThrow({ where: { id: plan.id } });
    const comida = (guardado.mealsJson as JsonRecord[]).find((m) => m.slot === meal.slot)!;
    const nombres = (comida.items as JsonRecord[]).map((item) => item.name);
    expect(nombres).toContain(toName);
  });
});
