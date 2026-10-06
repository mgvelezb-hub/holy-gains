import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `GET/PUT /api/v1/ciclo` contra la base local: prender el seguimiento,
 * "hoy empezó mi periodo" y la duración. Se salta sola si no hay Postgres.
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

const { GET, PUT } = await import("@/app/api/v1/ciclo/route");
const { prisma } = await import("@/lib/prisma");
const { toISODate } = await import("@/lib/format");

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

function pedir(userId: string, method: "GET" | "PUT", body?: unknown): Request {
  return new Request("http://localhost/api/v1/ciclo", {
    method,
    headers: { "content-type": "application/json", "x-test-user-id": userId },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe.skipIf(!available)("seguimiento del ciclo desde la app", () => {
  const userId = randomUUID();

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `ciclo-${userId}@coachy.invalid`, role: "ATHLETE" } });
    await prisma.profile.create({
      data: {
        userId,
        displayName: "Atleta de prueba",
        sex: "FEMALE",
        heightCm: "162.0",
        weightKg: "60.0",
        liftingDays: 4,
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

  it("arranca apagado y disponible para una mujer", async () => {
    const vista = await (await GET(pedir(userId, "GET"))).json();
    expect(vista.disponible).toBe(true);
    expect(vista.activo).toBe(false);
    expect(vista.ajuste).toBeNull();
  });

  it("'hoy empezó mi periodo' lo prende y estima día 1", async () => {
    const hoy = toISODate(new Date());
    const respuesta = await PUT(pedir(userId, "PUT", { ultimoPeriodo: hoy }));
    expect(respuesta.status).toBe(200);
    const vista = await respuesta.json();
    expect(vista.activo).toBe(true);
    expect(vista.ultimoPeriodo).toBe(hoy);
    expect(vista.ajuste.fase).toBe("MENSTRUACION");
    expect(vista.ajuste.dia).toBe(1);
  });

  it("guarda la duración y rechaza fechas futuras o fuera de rango", async () => {
    expect((await PUT(pedir(userId, "PUT", { duracion: 32 }))).status).toBe(200);
    expect((await prisma.profile.findUniqueOrThrow({ where: { userId } })).cycleAvgLength).toBe(32);
    expect((await PUT(pedir(userId, "PUT", { duracion: 60 }))).status).toBe(422);
    expect((await PUT(pedir(userId, "PUT", { ultimoPeriodo: "2099-01-01" }))).status).toBe(422);
  });

  it("apagarlo quita el ajuste", async () => {
    const vista = await (await PUT(pedir(userId, "PUT", { activo: false }))).json();
    expect(vista.activo).toBe(false);
    expect(vista.ajuste).toBeNull();
  });
});
