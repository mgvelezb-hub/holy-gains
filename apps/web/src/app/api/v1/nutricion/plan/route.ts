import { NextResponse } from "next/server";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { planDeNutricion } from "@/lib/coachy/plan-nutricion";

/**
 * `GET /api/v1/nutricion/plan[?semana=YYYY-MM-DD]` — el plan canónico de
 * nutrición (K1): macros y su porqué, estilo, menús, lista de súper, despensa,
 * tomas ancladas, horarios efectivos por día, "hoy", recordatorios y avisos.
 *
 * Una sola verdad: la pestaña Nutrición, la hoja del plan y los recordatorios
 * pintan esto y no calculan nada por su cuenta.
 */

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  if (!user.profile?.onboardingCompletedAt) {
    return NextResponse.json({ error: "onboarding incompleto" }, { status: 403 });
  }

  const semana = new URL(request.url).searchParams.get("semana");

  try {
    return NextResponse.json(
      await planDeNutricion(user.id, semana && ISO.test(semana) ? semana : null, { profile: user.profile }),
    );
  } catch (error) {
    console.error("[coachy] no se pudo armar el plan de nutrición", error);
    return NextResponse.json({ error: "No se pudo cargar tu plan" }, { status: 500 });
  }
}
