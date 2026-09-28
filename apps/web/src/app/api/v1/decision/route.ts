import { NextResponse } from "next/server";
import type { Decision, Prisma } from "@prisma/client";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { estadoDelAnalisis } from "@/lib/api/decision-estado";
import { puntoCeroDe } from "@/lib/checkins";
import { replyToText } from "@/lib/coachy/compose";
import { aMedida, proximoMensual } from "@/lib/coachy/mensual";
import type { CoachyReply } from "@/lib/coachy/types";
import { isoFromDateColumn, toISODate } from "@/lib/format";
import { prisma } from "@/lib/prisma";

/**
 * `GET /api/v1/decision` — la decisión publicada más reciente del atleta,
 * para la app nativa. Mismo patrón que el home (`src/app/app/page.tsx`):
 * solo lo publicado, nunca `replyJson` crudo (trae el texto redactado, no un
 * contrato de API estable) — de él salen solo `mensual` y `retro`, que sí
 * son estructura.
 *
 * Además dice en qué va el análisis del último check-in:
 *
 * - `estado`: `"lista"` cuando ya está publicada y con su retro,
 *   `"analizando"` mientras tanto (`lib/api/decision-estado.ts`).
 * - `checkInId`: el check-in al que se refiere `estado`.
 * - `enRevisionHumana`: la decisión espera a su coach, no a la IA.
 * - `proximoMensual`: cuánto falta para el siguiente mensual, con la regla
 *   de 28 días del servidor (`lib/coachy/mensual.ts`).
 *
 * `?desde=<checkInId>` pregunta por ESE check-in: `decision` es `null` y
 * `estado` es `"analizando"` hasta que su decisión quede lista. Es lo que la
 * app sondea después de enviar.
 */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function replyFrom(value: Prisma.JsonValue | null): CoachyReply | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as unknown as CoachyReply;
}

async function alreadyAnsweredFor(userId: string, decisionId: string): Promise<boolean> {
  // Mismo alcance que el home: últimas 5 respuestas del atleta alcanzan para
  // saber si ya contestó la decisión vigente.
  const answered = await prisma.conversation.findMany({
    where: { userId, role: "ATHLETE" },
    orderBy: { date: "desc" },
    take: 5,
    select: { contextJson: true },
  });

  return answered.some(
    (row) =>
      row.contextJson !== null &&
      typeof row.contextJson === "object" &&
      !Array.isArray(row.contextJson) &&
      (row.contextJson as Record<string, unknown>).decisionId === decisionId,
  );
}

async function serialize(
  userId: string,
  decision: Decision & { checkIn: { id: string; date: Date } },
) {
  const reply = replyFrom(decision.replyJson);

  return {
    id: decision.id,
    checkInId: decision.checkIn.id,
    phase: decision.phase,
    kcal: decision.kcal,
    proteinG: decision.proteinG,
    carbsG: decision.carbsG,
    fatG: decision.fatG,
    checkInDate: isoFromDateColumn(decision.checkIn.date),
    publishedAt: decision.publishedAt?.toISOString() ?? null,
    texto: reply ? replyToText(reply) : null,
    meta: reply?.meta ?? null,
    preguntas: reply?.preguntas ?? [],
    alreadyAnswered: await alreadyAnsweredFor(userId, decision.id),
    mensual: reply?.mensual ?? null,
    retro: reply?.retro ?? null,
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const desde = new URL(request.url).searchParams.get("desde");
  const ahora = new Date();

  // Un id que ni siquiera es UUID no es de nadie: 404, no un 500 de Prisma.
  if (desde !== null && !UUID.test(desde)) {
    return NextResponse.json({ error: "check-in no encontrado" }, { status: 404 });
  }

  const punto = await puntoCeroDe(user.id);
  const serie = await prisma.checkIn.findMany({
    where: { userId: user.id, ...(punto ? { date: { gte: punto.date } } : {}) },
    orderBy: { date: "asc" },
    select: {
      id: true,
      date: true,
      waistCm: true,
      weightKg: true,
      armLeftCm: true,
      armRightCm: true,
      legLeftCm: true,
      legRightCm: true,
    },
  });
  const proximo = proximoMensual(serie.map(aMedida), toISODate(ahora));

  // El check-in del que se pregunta: el pedido, o el último que mandó.
  const objetivo = desde
    ? await prisma.checkIn.findFirst({
        where: { id: desde, userId: user.id },
        select: { id: true },
      })
    : await prisma.checkIn.findFirst({
        where: { userId: user.id },
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        select: { id: true },
      });

  if (desde && !objetivo) {
    return NextResponse.json({ error: "check-in no encontrado" }, { status: 404 });
  }

  const suya = objetivo
    ? await prisma.decision.findUnique({
        where: { checkInId: objetivo.id },
        include: { checkIn: { select: { id: true, date: true } } },
      })
    : null;

  const { estado, enRevisionHumana } = estadoDelAnalisis(
    suya
      ? { status: suya.status, publishedAt: suya.publishedAt, tieneTexto: suya.replyJson !== null }
      : null,
    ahora,
  );

  const base = {
    estado,
    checkInId: objetivo?.id ?? null,
    enRevisionHumana,
    proximoMensual: proximo,
  };

  if (desde) {
    return NextResponse.json({
      ...base,
      decision: estado === "lista" && suya ? await serialize(user.id, suya) : null,
    });
  }

  const publicada = await prisma.decision.findFirst({
    where: { userId: user.id, publishedAt: { not: null } },
    orderBy: { publishedAt: "desc" },
    include: { checkIn: { select: { id: true, date: true } } },
  });

  return NextResponse.json({
    ...base,
    decision: publicada ? await serialize(user.id, publicada) : null,
  });
}
