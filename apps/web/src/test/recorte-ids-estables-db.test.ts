import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * O1 — "¿Cuánto tiempo tienes?" → "Poco tiempo" respondía "No existe esa
 * sesión." en la mano de Mau (29-sep), con los tests de I1 en verde.
 *
 * El flujo real, contra la base local y con los handlers de verdad: Rutinas
 * lee la semana y se queda con el `workoutId` de hoy en memoria; en la misma
 * pantalla Mau toca km/h ↔ mph en la hoja del cardio (PATCH de
 * `otherDisciplines`); otra superficie (Hoy, el widget) vuelve a leer la
 * semana; y entonces recorta. Antes, ese cambio movía la firma del plan y la
 * lectura borraba y recreaba todos los días no entrenados con ids nuevos: el
 * id que mandaba Rutinas ya no existía.
 *
 * Solo se mockea `apiUser` (JWT de Supabase por red).
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

const replanRoute = await import("@/app/api/v1/training/replan/route");
const weekRoute = await import("@/app/api/v1/training/week/route");
const todayRoute = await import("@/app/api/v1/training/today/route");
const trimRoute = await import("@/app/api/v1/training/trim/route");
const entrenamientoRoute = await import("@/app/api/v1/me/entrenamiento/route");
const { prisma } = await import("@/lib/prisma");
const { presetSplit } = await import("@/lib/training/split");

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
vi.setConfig({ testTimeout: 60_000 });

/** "Poco tiempo" en la hoja de Rutinas (`OPCIONES_DE_TIEMPO`). */
const POCO_TIEMPO = 20;

type Sesion = { workoutId: string; date: string; exercises: unknown[]; trimmedMinutes: number | null; estimatedMin: number | null };
type Semana = { today: string; sessions: Sesion[] };

function peticion(userId: string, url: string, method: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user-id": userId },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe.skipIf(!available)("O1 — ids de sesión estables y recorte que persiste (clon de Mau)", () => {
  const userId = randomUUID();

  const semana = async (): Promise<Semana> =>
    (await (await weekRoute.GET(peticion(userId, "/api/v1/training/week", "GET"))).json()) as Semana;
  const deHoy = (s: Semana): Sesion => s.sessions.find((sesion) => sesion.date === s.today)!;
  const ids = (s: Semana): string[] => s.sessions.map((sesion) => `${sesion.date}:${sesion.workoutId}`);
  const recorta = (body: Record<string, unknown>) =>
    trimRoute.POST(peticion(userId, "/api/v1/training/trim", "POST", body));
  const cambiaCardio = async (cambio: Record<string, unknown>): Promise<void> => {
    const perfil = await prisma.profile.findUniqueOrThrow({ where: { userId } });
    const otras = (perfil.otherDisciplines as Array<Record<string, unknown>>).map((carga) =>
      carga.discipline === "CARDIO" ? { ...carga, cardio: { ...((carga.cardio as object) ?? {}), ...cambio } } : carga,
    );
    const respuesta = await entrenamientoRoute.PATCH(
      peticion(userId, "/api/v1/me/entrenamiento", "PATCH", { otherDisciplines: otras }),
    );
    expect(respuesta.status).toBe(200);
  };

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `test-o1-${userId}@coachy.invalid`, role: "ATHLETE" } });
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
        liftingDays: 6,
        sessionMinutes: 90,
        mealsPerDay: 4,
        trainingTime: "MANANA",
        primaryDiscipline: "PESAS",
        customSplit: presetSplit("INFERIOR_SUPERIOR_3_3", 6),
        onboardingCompletedAt: new Date(),
      },
    });
    // La semana de Mau: L–V a 90, fin de semana en 0, cardio después de pesas.
    const replan = await replanRoute.POST(
      peticion(userId, "/api/v1/training/replan", "POST", {
        tiempo: { LUN: 90, MAR: 90, MIE: 90, JUE: 90, VIE: 90, SAB: 0, DOM: 0 },
        primaria: "PESAS",
        sesionesPrimaria: 5,
        secundarias: [{ discipline: "CARDIO", proposito: "ENTRENAMIENTO", importancia: 2 }],
      }),
    );
    expect(replan.status).toBe(200);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("tres lecturas seguidas sin cambios dan los mismos ids", async () => {
    const primera = await semana();
    expect(primera.sessions.length).toBeGreaterThan(0);
    expect(ids(await semana())).toEqual(ids(primera));
    expect(ids(await semana())).toEqual(ids(primera));
  });

  it("Rutinas en memoria → km/h↔mph → otra pantalla lee → 'Poco tiempo' recorta con el id de Rutinas", async () => {
    const rutinas = await semana();
    const enMemoria = deHoy(rutinas);
    // `Hoy` se prepara con el día de hoy tal como lo pinta Rutinas.
    expect(enMemoria).toBeDefined();
    const antes = enMemoria.exercises.length;

    await cambiaCardio({ unidadVelocidad: "mph" });
    await todayRoute.GET(peticion(userId, "/api/v1/training/today", "GET"));
    expect(ids(await semana())).toEqual(ids(rutinas));

    const respuesta = await recorta({ workoutId: enMemoria.workoutId, minutes: POCO_TIEMPO, date: enMemoria.date });
    expect(respuesta.status).toBe(200);
    const { sesion } = (await respuesta.json()) as { sesion: { workoutId: string; exercises: number } };
    expect(sesion.workoutId).toBe(enMemoria.workoutId);
    expect(sesion.exercises).toBeLessThan(antes);

    // La siguiente lectura no lo deshace.
    const despues = deHoy(await semana());
    expect(despues.workoutId).toBe(enMemoria.workoutId);
    expect(despues.trimmedMinutes).toBe(POCO_TIEMPO);
    expect(despues.exercises).toHaveLength(sesion.exercises);
  });

  it("un cambio que sí mueve el plan rearma los días en su misma fila y respeta el recorte", async () => {
    const antes = await semana();
    const hoy = deHoy(antes);
    const otro = antes.sessions.find((sesion) => sesion.date !== antes.today && sesion.date > antes.today);

    await cambiaCardio({ minutos: 30 });
    const despues = await semana();
    expect(ids(despues)).toEqual(ids(antes));
    expect(deHoy(despues).trimmedMinutes).toBe(POCO_TIEMPO);
    expect(deHoy(despues).exercises).toHaveLength(hoy.exercises.length);
    if (otro) {
      // Rearmado de verdad (menos minutos de gym con más cardio), mismo id.
      const rearmado = despues.sessions.find((sesion) => sesion.date === otro.date)!;
      expect(rearmado.workoutId).toBe(otro.workoutId);
      expect(rearmado.estimatedMin ?? 0).toBeLessThanOrEqual(otro.estimatedMin ?? 0);
    }
  });

  it("con un id que ya no existe (app vieja en memoria), recorta igual por fecha", async () => {
    const hoy = deHoy(await semana());
    const respuesta = await recorta({ workoutId: randomUUID(), minutes: 30, date: hoy.date });
    expect(respuesta.status).toBe(200);
    const { sesion } = (await respuesta.json()) as { sesion: { workoutId: string } };
    expect(sesion.workoutId).toBe(hoy.workoutId);
    expect(deHoy(await semana()).trimmedMinutes).toBe(30);

    // Sin fecha sigue siendo 404: no se adivina el día.
    expect((await recorta({ workoutId: randomUUID(), minutes: 30 })).status).toBe(404);
  });
});
