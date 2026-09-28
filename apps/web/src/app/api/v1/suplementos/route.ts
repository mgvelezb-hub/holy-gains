import { NextResponse } from "next/server";
import { CATALOGO_SUPLEMENTOS, parseElecciones } from "engine";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { planDeNutricion } from "@/lib/coachy/plan-nutricion";

/**
 * `GET /api/v1/suplementos` — lo que la pantalla de suplementos pinta:
 *
 * - `tomas`: lo que toma hoy, cada una amarrada a su comida, con lo ya marcado.
 * - `resumen.linea`: "1 de 3 · siguiente: omega-3 con la comida" (Hoy).
 * - `sugerencias`: máximo tres, con motivo, evidencia, dosis y qué cambiaría.
 *   Se calculan al pedirlas, así una elección nueva se refleja sin esperar al
 *   check-in. Si hay freno clínico, vienen vacías, `freno` trae la línea y
 *   las tomas quedan en pausa (`tomasPausadas`).
 * - `catalogo`: para el buscador de "agregar".
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  if (!user.profile) {
    return NextResponse.json({ error: "onboarding incompleto" }, { status: 403 });
  }
  const profile = user.profile;

  // Tomas, sugerencias y freno salen del plan canónico: las mismas que ve
  // Nutrición y las que viajan en el "Prepárate".
  const plan = await planDeNutricion(user.id, null, { profile });
  const { elecciones, quiereInfusiones } = parseElecciones(profile.supplementChoices);

  return NextResponse.json({
    hoy: plan.hoy.fecha,
    tomas: plan.tomas,
    tomasPausadas: plan.tomasPausadas,
    resumen: plan.resumenTomas,
    sugerencias: plan.sugerencias,
    freno: plan.freno,
    notas: plan.notasSuplementos,
    elecciones,
    quiereInfusiones,
    catalogo: CATALOGO_SUPLEMENTOS,
  });
}
