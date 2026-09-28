import { NextResponse } from "next/server";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { planDeNutricion } from "@/lib/coachy/plan-nutricion";

/**
 * `GET /api/v1/nutrition` — el plan de alimentación vigente del atleta, para
 * la app nativa.
 *
 * Sale de `planDeNutricion` (K1), la misma función que alimenta
 * `/api/v1/nutricion/plan`: menús, lista de súper con "ya lo tienes",
 * horarios por día, tomas, avisos y el porqué. Las pantallas viejas leen las
 * llaves de siempre (`decision`, `menus`, `groceries`, `menuPreference`,
 * `horarios`, `materialized`); las nuevas, el resto. Nadie cruza fuentes.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  if (!user.profile?.onboardingCompletedAt) {
    return NextResponse.json({ error: "onboarding incompleto" }, { status: 403 });
  }

  try {
    return NextResponse.json(await planDeNutricion(user.id, null, { profile: user.profile }));
  } catch (error) {
    console.error("[coachy] no se pudo cargar la alimentación (api)", error);
    return NextResponse.json({ error: "No se pudo cargar tu alimentación" }, { status: 500 });
  }
}
