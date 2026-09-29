import { NextResponse } from "next/server";
import { z } from "zod";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { resolveWeekReference } from "@/lib/api/date-param";
import { cardioDelDia } from "@/lib/training/view";
import { EQUIPOS_CARDIO, TIPOS_CARDIO } from "@/lib/training/types";

/**
 * `GET /api/v1/training/cardio?date=YYYY-MM-DD&maquina=ELIPTICA&modalidad=ZONA2`
 * — el cardio de ese día con otra máquina y/o modalidad (P1b): "hoy la
 * caminadora está ocupada → elíptica". Mismos minutos que el del plan; la
 * preferencia guardada NO se toca (eso es `PATCH /me/entrenamiento`, cuando
 * la persona toca "Usar siempre").
 *
 * Responde `{ fecha, minutes, ordinal, sesion }`; 404 si ese día no hay
 * cardio con plan.
 */

export const dynamic = "force-dynamic";

const querySchema = z.object({
  maquina: z.enum(EQUIPOS_CARDIO).optional(),
  modalidad: z.enum(TIPOS_CARDIO).optional(),
});

export async function GET(request: Request): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  if (!user.profile?.onboardingCompletedAt) {
    return NextResponse.json({ error: "onboarding incompleto" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const fecha = searchParams.get("date");
  const reference = resolveWeekReference(fecha);
  if (fecha === null || !reference.ok) return NextResponse.json({ error: "fecha inválida" }, { status: 400 });

  const query = querySchema.safeParse({
    maquina: searchParams.get("maquina") ?? undefined,
    modalidad: searchParams.get("modalidad") ?? undefined,
  });
  if (!query.success) return NextResponse.json({ error: "máquina o modalidad inválida" }, { status: 400 });

  const cardio = await cardioDelDia(user.id, user.profile, reference.date, {
    ...(query.data.maquina ? { equipo: query.data.maquina } : {}),
    ...(query.data.modalidad ? { tipo: query.data.modalidad } : {}),
  });
  if (!cardio) return NextResponse.json({ error: "ese día no hay cardio" }, { status: 404 });
  return NextResponse.json(cardio);
}
