import { NextResponse, after } from "next/server";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { accionListo } from "@/lib/api/checkin-flujo";
import { runCoachy } from "@/lib/coachy";
import { prisma } from "@/lib/prisma";

/**
 * `POST /api/v1/checkins/[id]/listo` — la app ya subió las fotos del
 * check-in (o lo intentó): ahora sí corre Coachy.
 *
 * Solo el dueño del check-in, e idempotente: si ya tiene decisión no se
 * vuelve a analizar. Contesta de inmediato y el análisis va en `after()`,
 * igual que el POST; la app sondea `GET /decision?desde=`.
 */

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND = { error: "check-in no encontrado" };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json(NOT_FOUND, { status: 404 });

  const checkIn = await prisma.checkIn.findFirst({
    where: { id, userId: user.id },
    select: { id: true, decision: { select: { id: true } } },
  });
  if (!checkIn) return NextResponse.json(NOT_FOUND, { status: 404 });

  const accion = accionListo({ tieneDecision: checkIn.decision !== null });
  if (accion === "correr") {
    after(async () => {
      try {
        await runCoachy(checkIn.id);
      } catch (error) {
        console.error("[coachy] falló el análisis del check-in (listo)", checkIn.id, error);
      }
    });
  }

  return NextResponse.json({ checkInId: checkIn.id, accion }, { status: 202 });
}
