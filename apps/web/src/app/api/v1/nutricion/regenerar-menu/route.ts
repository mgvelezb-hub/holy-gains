import { NextResponse } from "next/server";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { decisionVigente, materializeMealPlans } from "@/lib/coachy/menu";
import { planDeNutricion } from "@/lib/coachy/plan-nutricion";
import { prisma } from "@/lib/prisma";

/**
 * `POST /api/v1/nutricion/regenerar-menu` — rearma los menús vigentes
 * AHORA, con las preferencias de hoy.
 *
 * Antes, cambiar un alimento excluido/favorito, el presupuesto o la dieta
 * decía "entra en tu siguiente menú" y obligaba a esperar el check-in de la
 * semana. La decisión de producto cambió: regenerar a demanda es válido —
 * con el costo dicho de frente, nunca oculto. Este endpoint es ese costo
 * hecho explícito: se avisa en la app, no se bloquea aquí.
 *
 * Re-corre EXACTAMENTE la maquinaria de `ensureMealPlans`
 * (`materializeMealPlans` en `@/lib/coachy/menu`) pero con `overwrite: true`,
 * así que si ya había menús los pisa de verdad — a diferencia de
 * `ensureMealPlans`, que nunca toca lo que ya existe.
 *
 * Los MACROS NO se tocan: `distribute` corre sobre los mismos
 * `kcal/proteinG/fatG/carbsG` de la última `Decision` aprobada. Lo único que
 * cambia con `toEngineProfile(profile de HOY)` es CON QUÉ alimentos se
 * cumplen esos números — exclusiones, favoritos, presupuesto, dieta,
 * suplementos, tiempo de cocina. Y la MISMA semilla (`menuSeed` o su
 * respaldo por fecha) entra siempre, para que regenerar cambie solo lo
 * necesario y no entregue un menú irreconocible a media semana.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  if (!user.profile?.onboardingCompletedAt) {
    return NextResponse.json({ error: "onboarding incompleto" }, { status: 403 });
  }
  const profile = user.profile;

  // La misma decisión que pinta Nutrición: rearmar otra sería rearmar un
  // menú que la pantalla no enseña.
  const decision = await decisionVigente(user.id);

  if (!decision) {
    return NextResponse.json(
      {
        error:
          "Todavía no tienes una decisión aprobada con la que regenerar tu menú. En cuanto tu " +
          "coach publique una, este botón funciona.",
      },
      { status: 409 },
    );
  }

  const latest = await prisma.checkIn.findFirst({
    where: { userId: user.id, weightKg: { not: null } },
    orderBy: { date: "desc" },
    select: { weightKg: true },
  });

  try {
    await materializeMealPlans(decision, profile, {
      overwrite: true,
      latestWeightKg: latest?.weightKg === null || latest?.weightKg === undefined
        ? null
        : Number(latest.weightKg),
    });
  } catch (error) {
    console.error("[coachy] no se pudo regenerar el menú", error);
    return NextResponse.json(
      { error: "No se pudo regenerar tu menú ahora. Intenta de nuevo en un momento." },
      { status: 500 },
    );
  }

  // Lo que devuelve es el plan canónico recién rearmado: la lista de súper
  // respeta el menú elegido y la despensa, igual que la pantalla después.
  const plan = await planDeNutricion(user.id, null, { profile });
  return NextResponse.json({ ...plan, materialized: true });
}
