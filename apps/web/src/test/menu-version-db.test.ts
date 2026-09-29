import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * L1-B — los menús guardados con reglas viejas se rehacen solos al leerlos.
 *
 * Clon de Mau (CUT, 182 cm, 120 kg, cuatro comidas, entrena de mañana): su
 * menú se guarda como versión 1 (sin `versionMotor`) y con tilapia en el
 * desayuno, que es lo que salía antes de la auditoría. Al leer
 * `/api/v1/nutrition` el menú sale en la versión del motor, con la misma
 * decisión, sin pescado antes de las 11:00 y con el aviso; la segunda
 * lectura no vuelve a generar. Solo se mockea `apiUser`.
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

const nutritionRoute = await import("@/app/api/v1/nutrition/route");
const { prisma } = await import("@/lib/prisma");
const { persistCheckIn } = await import("@/lib/checkin-write");
const { runCoachy } = await import("@/lib/coachy");
const { checkInSchema } = await import("@/lib/validation/checkin");
const { shiftISODate, toISODate } = await import("@/lib/format");
const { FOODS, MENU_ENGINE_VERSION } = await import("engine");
const { AVISO_MENU_ACTUALIZADO } = await import("@/lib/coachy/version-menu");

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

type Comida = { slot: string; timeHint: string; items: Array<{ foodId?: string; name: string; grams: number }> } & Record<string, unknown>;
type Nutrition = { decision: { id: string; phase: string; kcal: number } | null; aviso: string | null; menus: unknown[] };

const PESCADO = new Set(["tilapia", "bacalao", "pescado_blanco", "camaron", "salmon", "atun_agua", "atun_aceite", "sardina_agua"]);
const TILAPIA = FOODS.find((food) => food.id === "tilapia")!;

function lee(userId: string): Promise<Nutrition> {
  const request = new Request("http://localhost/api/v1/nutrition", { headers: { "x-test-user-id": userId } });
  return nutritionRoute.GET(request).then((respuesta) => respuesta.json() as Promise<Nutrition>);
}

function minutos(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return (h ?? 12) * 60 + (m ?? 0);
}

/** El menú como se guardaba antes: sin versión, sin semilla, y tilapia en el desayuno. */
function comoVersionUno(meals: Comida[]): Comida[] {
  return meals.map((meal, index) => {
    const { versionMotor: _v, semillaMenu: _s, menuPorReglasNuevas: _m, ...resto } = meal;
    if (index !== 0) return resto as Comida;
    return { ...resto, items: [{ foodId: TILAPIA.id, name: TILAPIA.name, grams: 150 }, ...meal.items] } as Comida;
  });
}

describe.skipIf(!available)("L1-B — menús que se ponen al día con el motor (clon de Mau)", () => {
  const userId = randomUUID();
  const hoy = toISODate(new Date());
  let decisionId = "";

  beforeAll(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await prisma.user.create({ data: { id: userId, email: `test-l1b-${userId}@coachy.invalid`, role: "ATHLETE" } });
    await prisma.profile.create({
      data: {
        userId,
        displayName: "Clon de Mau",
        sex: "MALE",
        birthDate: new Date("1988-03-10T12:00:00Z"),
        heightCm: "182.0",
        weightKg: "120.0",
        goal: "PERDIDA_GRASA",
        currentPhase: "CUT",
        liftingDays: 5,
        sessionMinutes: 90,
        mealsPerDay: 4,
        trainingTime: "MANANA",
        budget: "MEDIO",
        dietStyle: "ESTANDAR",
        maxPrepMin: 20,
        excludedFoods: [],
        favoriteFoods: [],
        supplements: ["CREATINA", "OMEGA3"],
        allergies: [],
        conditions: [],
        pantry: ["yogur_griego_0", "avena", "huevo_entero"],
        onboardingCompletedAt: new Date(),
      },
    });

    const checkIn = await persistCheckIn(
      userId,
      checkInSchema.parse({
        date: shiftISODate(hoy, -3),
        waistCm: 118,
        weightKg: 120,
        inflammation: 2,
        energy: 3,
        hunger: 3,
        satiety: 3,
        sleep: 3,
        strengthRpe: 8,
        strengthTrend: "IGUAL",
        dietCompliance: 90,
        trainingCompliance: 100,
        symptoms: [],
        comment: "",
      }),
    );
    await runCoachy(checkIn.id);

    const decision = await prisma.decision.findUniqueOrThrow({ where: { checkInId: checkIn.id } });
    decisionId = decision.id;
    // Los menús de este usuario, como se guardaban antes de la versión.
    const plans = await prisma.mealPlan.findMany({ where: { decisionId } });
    for (const plan of plans) {
      await prisma.mealPlan.update({
        where: { id: plan.id },
        data: { mealsJson: comoVersionUno(plan.mealsJson as unknown as Comida[]) as never },
      });
    }
    await prisma.mealLog.create({
      data: { userId, date: new Date(`${hoy}T00:00:00Z`), slot: "DESAYUNO", taken: true },
    });
  }, 90_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("al leer /nutrition sale la versión nueva, misma decisión, sin pescado en el desayuno", async () => {
    const antes = await prisma.decision.findUniqueOrThrow({ where: { id: decisionId } });
    const guardadoV1 = await prisma.mealPlan.findMany({ where: { decisionId } });
    expect(guardadoV1.length).toBe(2);
    expect(JSON.stringify(guardadoV1[0]!.mealsJson)).toContain(TILAPIA.name);

    const nutricion = await lee(userId);

    expect(nutricion.decision?.id).toBe(decisionId);
    expect(nutricion.aviso).toBe(AVISO_MENU_ACTUALIZADO);

    const plans = await prisma.mealPlan.findMany({ where: { decisionId }, orderBy: { menuNumber: "asc" } });
    expect(plans.length).toBe(2);
    for (const plan of plans) {
      const meals = plan.mealsJson as unknown as Comida[];
      expect(meals.every((meal) => meal.versionMotor === MENU_ENGINE_VERSION)).toBe(true);
      const pescadoTemprano = meals
        .filter((meal) => minutos(meal.timeHint) <= 11 * 60)
        .flatMap((meal) => meal.items)
        .filter((item) => PESCADO.has(item.foodId ?? ""));
      expect(pescadoTemprano).toEqual([]);
    }

    // La decisión y lo registrado no se tocan.
    const despues = await prisma.decision.findUniqueOrThrow({ where: { id: decisionId } });
    expect({ phase: despues.phase, kcal: despues.kcal, proteinG: despues.proteinG, menuSeed: despues.menuSeed }).toEqual({
      phase: antes.phase,
      kcal: antes.kcal,
      proteinG: antes.proteinG,
      menuSeed: antes.menuSeed,
    });
    expect(await prisma.mealLog.count({ where: { userId } })).toBe(1);
  }, 60_000);

  it("la segunda lectura no vuelve a generar", async () => {
    // Una marca que solo sobrevive si nadie reescribe el menú.
    const plan = await prisma.mealPlan.findFirstOrThrow({ where: { decisionId, menuNumber: 1 } });
    const meals = plan.mealsJson as unknown as Comida[];
    await prisma.mealPlan.update({
      where: { id: plan.id },
      data: { mealsJson: meals.map((meal, i) => (i === 0 ? { ...meal, marcaPrueba: true } : meal)) as never },
    });

    const nutricion = await lee(userId);
    expect(nutricion.decision?.id).toBe(decisionId);

    const releido = await prisma.mealPlan.findFirstOrThrow({ where: { decisionId, menuNumber: 1 } });
    expect((releido.mealsJson as unknown as Comida[])[0]?.marcaPrueba).toBe(true);
  }, 60_000);

  it("dos lecturas a la vez sobre menús viejos regeneran una sola vez y coinciden", async () => {
    const plans = await prisma.mealPlan.findMany({ where: { decisionId } });
    for (const plan of plans) {
      await prisma.mealPlan.update({
        where: { id: plan.id },
        data: { mealsJson: comoVersionUno(plan.mealsJson as unknown as Comida[]) as never },
      });
    }

    const [a, b] = await Promise.all([lee(userId), lee(userId)]);
    expect(a.decision?.id).toBe(decisionId);
    expect(JSON.stringify(a.menus)).toBe(JSON.stringify(b.menus));
    const finales = await prisma.mealPlan.findMany({ where: { decisionId } });
    expect(finales.length).toBe(2);
    expect(
      finales.every((plan) => (plan.mealsJson as unknown as Comida[]).every((meal) => meal.versionMotor === MENU_ENGINE_VERSION)),
    ).toBe(true);
  }, 60_000);
});
