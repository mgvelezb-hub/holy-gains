import { NextResponse } from "next/server";
import { CATALOGO_SUPLEMENTOS, parseElecciones } from "engine";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { toISODate } from "@/lib/format";
import { sugerenciasPara, tomasPara } from "@/lib/suplementos/db";

/**
 * `GET /api/v1/suplementos` — lo que la pantalla de suplementos pinta:
 *
 * - `tomas`: lo que toma hoy, cada una amarrada a su comida, con lo ya marcado.
 * - `resumen.linea`: "1 de 3 · siguiente: omega-3 con la comida" (Hoy).
 * - `sugerencias`: máximo tres, con motivo, evidencia, dosis y qué cambiaría.
 *   Se calculan al pedirlas, así una elección nueva se refleja sin esperar al
 *   check-in. Si hay freno clínico, vienen vacías y `freno` trae la línea.
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
  const hoy = toISODate(new Date());

  const [{ tomas, resumen }, sugerencias] = await Promise.all([
    tomasPara(user.id, profile, hoy),
    sugerenciasPara(user.id, profile, { hoy }),
  ]);
  const { elecciones, quiereInfusiones } = parseElecciones(profile.supplementChoices);

  return NextResponse.json({
    hoy,
    tomas,
    resumen: { hechas: resumen.hechas, total: resumen.total, linea: resumen.linea },
    sugerencias: sugerencias.sugerencias,
    freno: sugerencias.freno,
    notas: sugerencias.notas,
    elecciones,
    quiereInfusiones,
    catalogo: CATALOGO_SUPLEMENTOS,
  });
}
