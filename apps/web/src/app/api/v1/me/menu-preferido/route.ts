import { NextResponse } from "next/server";
import { z } from "zod";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { MENU_PREFERENCES } from "@/lib/coachy/menu";
import { planDeNutricion } from "@/lib/coachy/plan-nutricion";
import { prisma } from "@/lib/prisma";

/**
 * `PUT /api/v1/me/menu-preferido` — cuál de los dos menús se va a cocinar.
 *
 * Los dos menús NO son dos semanas: son dos variantes de la misma semana,
 * mismos macros y distintos alimentos, para no comer lo mismo siete días. Por
 * defecto la semana se reparte entre ambos y hay que comprar para los dos.
 * Quien decide cocinar uno solo lo come los 7 días, y entonces la lista de
 * súper tiene que traer ese menú completo y NADA del otro: comprar los
 * ingredientes de un menú que no se va a cocinar es tirar comida.
 *
 * Devuelve la lista ya recalculada para que la pantalla la enseñe sin volver
 * a pedirla.
 */

export const dynamic = "force-dynamic";

const schema = z.object({ menuPreference: z.enum(MENU_PREFERENCES) });

export async function PUT(request: Request): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  if (!user.profile) {
    return NextResponse.json({ error: "onboarding incompleto" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "cuerpo inválido" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "opción inválida" }, { status: 422 });
  }

  const { menuPreference } = parsed.data;

  const profile = await prisma.profile.update({
    where: { userId: user.id },
    data: { menuPreference },
  });

  // La lista sale del plan canónico: la misma que pinta Nutrición después.
  const plan = await planDeNutricion(user.id, null, { profile }).catch(() => null);

  return NextResponse.json({
    menuPreference,
    groceries: plan?.groceries ?? [],
    ...(plan ? { despensa: plan.despensa } : {}),
  });
}
