import { NextResponse } from "next/server";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { todayCard, todayOtherSession, todayPlan } from "@/lib/training/view";

/**
 * `GET /api/v1/training/today` — lo que toca hoy: la tarjeta del gimnasio y,
 * desde la Fase 7, la sesión de otra disciplina si el día la trae. Espejo de cómo `src/app/app/page.tsx` arma `today` para
 * `todayCard()`: mediodía en vez de la hora exacta, para no cruzar de día por
 * un redondeo cerca de medianoche.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  if (!user.profile?.onboardingCompletedAt) {
    return NextResponse.json({ error: "onboarding incompleto" }, { status: 403 });
  }

  const today = new Date();
  today.setHours(12, 0, 0, 0);

  // En serie: las tres materializan la semana si hace falta, y en paralelo
  // competirían por crear las mismas filas.
  const card = await todayCard(user.id, user.profile, today);
  // Un día sin pesas puede tener alberca: sin esto la app diría "descanso".
  const other = await todayOtherSession(user.id, user.profile, today);
  // El día en el formato común de la semana (I1): la misma línea que Rutinas
  // y el Resumen, con el "+ Cardio" que la tarjeta sola no dice.
  const dia = await todayPlan(user.id, user.profile, today);

  return NextResponse.json({ today: card, otherSession: other, dia });
}
