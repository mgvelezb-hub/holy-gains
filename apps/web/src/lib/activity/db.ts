import "server-only";

import type { Prisma } from "@prisma/client";

import { fromISODate, isoFromDateColumn } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { buscaGemela } from "@/lib/activity/enlazar";
import type { ActivitySessionInput } from "@/lib/activity/schema";

/**
 * Persistencia de `ActivitySession` (registro multi-disciplina fuera del
 * modo gimnasio de pesas).
 *
 * Idempotencia: **solo** las sesiones con `externalId` (las de HealthKit) se
 * resuelven con `upsert` sobre `(userId, source, externalId)`. Las sesiones
 * `APP` capturadas a mano no traen `externalId`, y Postgres no garantiza
 * unicidad entre varios `NULL` — si se intentara un `upsert` con
 * `externalId: null` en el `where`, Prisma podría emparejar (y pisar) más de
 * una fila existente. Por eso esas siempre van por `create`: cada POST manual
 * es una fila nueva, nunca una corrección.
 */
export async function saveActivities(
  userId: string,
  activities: ActivitySessionInput[],
): Promise<number> {
  let saved = 0;

  for (const activity of activities) {
    const values = {
      discipline: activity.discipline,
      source: activity.source,
      startedAt: new Date(activity.startedAt),
      endedAt: activity.endedAt ? new Date(activity.endedAt) : null,
      date: fromISODate(activity.date),
      durationMin: activity.durationMin,
      activeKcal: activity.activeKcal ?? null,
      avgHr: activity.avgHr ?? null,
      maxHr: activity.maxHr ?? null,
      distanceM: activity.distanceM ?? null,
      notes: activity.notes ?? null,
    };

    // H2 — la misma sesión por dos caminos (registrada en la app y grabada
    // por el reloj) se enlaza en una sola fila en vez de duplicarse.
    if (await enlazaConGemela(userId, activity, values)) {
      saved += 1;
      continue;
    }

    if (activity.externalId) {
      await prisma.activitySession.upsert({
        where: {
          userId_source_externalId: {
            userId,
            source: activity.source,
            externalId: activity.externalId,
          },
        },
        create: { userId, externalId: activity.externalId, ...values },
        update: values,
      });
    } else {
      await prisma.activitySession.create({ data: { userId, externalId: null, ...values } });
    }

    saved += 1;
  }

  return saved;
}

/**
 * Si la sesión que llega ya existe por el otro camino (`buscaGemela`), la
 * fusiona en esa fila y devuelve `true`:
 *
 * - llega la del reloj y ya estaba la del app → la fila toma los datos del
 *   reloj (pulso, kcal, `externalId`) y conserva las notas del app (tipo y
 *   nivel del cardio), que el reloj no sabe;
 * - llega la del app y ya estaba la del reloj → solo se le agregan las notas.
 *
 * Una del reloj que ya se guardó antes (mismo `externalId`) no se busca: la
 * resuelve el `upsert` de siempre.
 */
async function enlazaConGemela(
  userId: string,
  activity: ActivitySessionInput,
  values: Omit<Prisma.ActivitySessionUncheckedCreateInput, "userId" | "externalId"> & {
    notes: string | null;
  },
): Promise<boolean> {
  if (activity.externalId) {
    const yaExiste = await prisma.activitySession.findFirst({
      where: { userId, source: activity.source, externalId: activity.externalId },
      select: { id: true },
    });
    if (yaExiste) return false;
  }

  const delDia = await prisma.activitySession.findMany({
    where: { userId, discipline: activity.discipline, date: fromISODate(activity.date) },
  });
  const gemela = buscaGemela(
    { ...activity, externalId: activity.externalId ?? null, endedAt: activity.endedAt ?? null },
    delDia.map((fila) => ({
      ...fila,
      date: isoFromDateColumn(fila.date),
      startedAt: fila.startedAt.toISOString(),
      endedAt: fila.endedAt ? fila.endedAt.toISOString() : null,
    })),
  );
  if (!gemela) return false;

  if (activity.source === "HEALTHKIT") {
    await prisma.activitySession.update({
      where: { id: gemela.id },
      data: {
        ...values,
        externalId: activity.externalId ?? null,
        notes: values.notes ?? gemela.notes,
      },
    });
  } else if (values.notes && !gemela.notes) {
    await prisma.activitySession.update({ where: { id: gemela.id }, data: { notes: values.notes } });
  }
  return true;
}

/** Una sesión tal como la ve el cliente: fechas en ISO, no `Date` de Prisma. */
export type ActivitySessionRecord = {
  id: string;
  discipline: string;
  source: string;
  externalId: string | null;
  startedAt: string;
  endedAt: string | null;
  date: string;
  durationMin: number;
  activeKcal: number | null;
  avgHr: number | null;
  maxHr: number | null;
  distanceM: number | null;
  notes: string | null;
};

/** Las últimas `take` sesiones de la atleta, de la más reciente a la más vieja. */
export async function recentActivities(
  userId: string,
  take = 30,
): Promise<ActivitySessionRecord[]> {
  const rows = await prisma.activitySession.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
    take,
  });

  return rows.map((row) => ({
    id: row.id,
    discipline: row.discipline,
    source: row.source,
    externalId: row.externalId,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    date: isoFromDateColumn(row.date),
    durationMin: row.durationMin,
    activeKcal: row.activeKcal,
    avgHr: row.avgHr,
    maxHr: row.maxHr,
    distanceM: row.distanceM,
    notes: row.notes,
  }));
}
