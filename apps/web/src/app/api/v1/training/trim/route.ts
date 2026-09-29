import { NextResponse } from "next/server";
import { z } from "zod";

import { apiUser, unauthorized } from "@/lib/api/auth";
import {
  MAX_TRIM_MINUTES,
  MIN_TRIM_MINUTES,
  SessionAlreadyStartedError,
  SessionNotFoundError,
  restoreSession,
  trimSession,
} from "@/lib/training/trim";

/**
 * `POST /api/v1/training/trim` — "hoy tengo menos tiempo".
 *
 * Vuelve a armar la sesión del día para los minutos que de verdad hay, y la
 * deja marcada como recortada. Con `minutes: null` se deshace el recorte y la
 * sesión regresa a los minutos del perfil.
 *
 * El `userId` sale del Bearer, nunca del cuerpo: se puede recortar la sesión
 * propia y ninguna otra.
 */

export const dynamic = "force-dynamic";

const trimSchema = z.object({
  workoutId: z.uuid("workoutId inválido"),
  /** `null` deshace el recorte. */
  minutes: z.number().int().min(MIN_TRIM_MINUTES).max(MAX_TRIM_MINUTES).nullable(),
  /**
   * El día (`YYYY-MM-DD`). Opcional: una app vieja no lo manda. Con él, un
   * `workoutId` que ya no existe se resuelve por `(usuario, fecha)` (O1).
   */
  date: z.iso.date().optional(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  if (!user.profile?.onboardingCompletedAt) {
    return NextResponse.json({ error: "onboarding incompleto" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "cuerpo inválido" }, { status: 400 });
  }

  const parsed = trimSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "datos inválidos", detalles: parsed.error.issues.slice(0, 3) },
      { status: 422 },
    );
  }

  try {
    const result =
      parsed.data.minutes === null
        ? await restoreSession(user.id, user.profile, parsed.data.workoutId, parsed.data.date)
        : await trimSession(user.id, user.profile, parsed.data.workoutId, parsed.data.minutes, parsed.data.date);

    return NextResponse.json({ sesion: result });
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof SessionAlreadyStartedError) {
      // 409: no es un error del cliente ni del servidor, es un conflicto con
      // el estado — la sesión ya empezó y sus series apuntan a este plan.
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
