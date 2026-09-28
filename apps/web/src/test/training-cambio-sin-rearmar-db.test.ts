import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isoFromDateColumn } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { ensureWeekMaterialized, loadCatalog, parseStoredPlan } from "@/lib/training/db";
import { applySubstitutions } from "@/lib/training/substitute-write";
import { alternativesFor } from "@/lib/training/substitutes";

/**
 * I1 — cambiar la máquina ANTES de la primera serie no se pierde.
 *
 * El cambio se escribía sin calentamiento ni firma, y la siguiente lectura de
 * la semana (`ensureWeekMaterialized`, la que corre al abrir Rutinas) lo leía
 * como plan viejo: borraba la sesión y la rearmaba, con otro id y sin el
 * cambio. Se salta sola si no hay Postgres.
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

describe.skipIf(!available)("un día con ejercicio cambiado y sin series no se rearma", () => {
  const userId = randomUUID();
  const reference = new Date("2026-09-02T12:00:00");

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `test-${userId}@coachy.invalid`, role: "ATHLETE" } });
    await prisma.profile.create({
      data: {
        userId,
        displayName: "Atleta de prueba",
        sex: "MALE",
        heightCm: "180.0",
        liftingDays: 5,
        sessionMinutes: 60,
        mealsPerDay: 4,
        onboardingCompletedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("conserva la sesión (mismo id) y el ejercicio elegido tras releer la semana", async () => {
    const perfil = await prisma.profile.findUniqueOrThrow({ where: { userId } });
    const semana = await ensureWeekMaterialized(userId, perfil, reference);
    // Un día de hoy en adelante y sin series: justo el que la reconciliación puede rearmar.
    const dia = semana.find((w) => isoFromDateColumn(w.date) > "2026-09-02")!;
    const plan = parseStoredPlan(dia.exercisesJson);
    const catalog = await loadCatalog();

    const index = plan.exercises.findIndex((e) => alternativesFor(e, catalog, plan.exercises).length > 0);
    expect(index).toBeGreaterThanOrEqual(0);
    const elegido = alternativesFor(plan.exercises[index]!, catalog, plan.exercises)[0]!;

    const [resultado] = await applySubstitutions(userId, dia.id, [
      { exerciseIndex: index, exerciseId: elegido.exerciseId },
    ]);
    expect(resultado?.ok).toBe(true);

    // Lo que pasa al abrir Rutinas otra vez, con el perfil ya actualizado.
    const fresco = await prisma.profile.findUniqueOrThrow({ where: { userId } });
    const despues = await ensureWeekMaterialized(userId, fresco, reference);
    const mismo = despues.find((w) => isoFromDateColumn(w.date) === isoFromDateColumn(dia.date))!;

    expect(mismo.id).toBe(dia.id);
    const guardado = parseStoredPlan(mismo.exercisesJson);
    expect(guardado.exercises[index]!.exerciseId).toBe(elegido.exerciseId);
    expect(guardado.warmup).not.toBeNull();
  });
});
