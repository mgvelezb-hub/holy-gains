import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/v1/suplementos/log` con la hora que eligió la persona: "me la
 * tomé a las 7" se guarda a las 7, no a la hora en que tocó el botón.
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

const { POST } = await import("@/app/api/v1/suplementos/log/route");
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

function registrar(userId: string, body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/v1/suplementos/log", {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user-id": userId },
      body: JSON.stringify(body),
    }),
  );
}

describe.skipIf(!available)("registro de una toma con su hora", () => {
  const userId = randomUUID();

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email: `sup-${userId}@coachy.invalid`, role: "ATHLETE" },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("guarda la hora elegida", async () => {
    const takenAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const hoy = takenAt.slice(0, 10);
    const response = await registrar(userId, { date: hoy, supplement: "CREATINA", taken: true, takenAt });
    expect(response.status).toBe(200);
    const fila = await prisma.supplementLog.findFirstOrThrow({ where: { userId, supplement: "CREATINA" } });
    expect(fila.createdAt.toISOString()).toBe(takenAt);
  });

  it("sin hora usa ahora", async () => {
    const antes = Date.now();
    const hoy = new Date().toISOString().slice(0, 10);
    await registrar(userId, { date: hoy, supplement: "OMEGA3", taken: true });
    const fila = await prisma.supplementLog.findFirstOrThrow({ where: { userId, supplement: "OMEGA3" } });
    expect(fila.createdAt.getTime()).toBeGreaterThanOrEqual(antes - 1000);
  });

  it("rechaza una hora del futuro", async () => {
    const futuro = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const response = await registrar(userId, {
      date: futuro.slice(0, 10),
      supplement: "MAGNESIO",
      taken: true,
      takenAt: futuro,
    });
    expect(response.status).toBe(422);
  });
});
