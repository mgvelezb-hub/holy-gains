import type { Prisma } from "@prisma/client";
import { catalogoCon } from "engine";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { alimentosPropiosDe } from "@/lib/coachy/alimentos-propios-db";
import {
  CambioPlatilloError,
  aplicaCambioDePlatillo,
  opcionesDePlatilloGuardado,
} from "@/lib/coachy/cambio-platillo";
import { toEngineProfile } from "@/lib/coachy/mapping";
import { decisionVigente } from "@/lib/coachy/menu";
import { toMenuView } from "@/lib/coachy/menu-view";
import { prisma } from "@/lib/prisma";

/**
 * Cambiar el platillo de una comida: sopa por sopa (o crema, o caldo),
 * licuado por licuado.
 *
 * - `GET ?menuNumber=1&slot=COMIDA`: los platillos por los que se puede
 *   cambiar, con los macros con que quedaría la comida.
 * - `POST { menuNumber, slot, preparacionId }`: lo aplica y lo guarda. Todos
 *   los ingredientes del platillo se reemplazan; lo que acompaña se queda y
 *   ajusta sus gramos para conservar los macros de la comida.
 *
 * Mismo menú que `POST /nutricion/swap` (`decisionVigente`, la que pinta el menú), y
 * como ahí, la lista de súper no se rehace por un cambio puntual.
 */

export const dynamic = "force-dynamic";

async function menuDe(userId: string, menuNumber: number) {
  const decision = await decisionVigente(userId);
  if (!decision) return null;
  return prisma.mealPlan.findUnique({
    where: { decisionId_menuNumber: { decisionId: decision.id, menuNumber } },
  });
}

const consulta = z.object({
  menuNumber: z.coerce.number().int().positive(),
  slot: z.string().trim().min(1),
});

export async function GET(request: Request): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  if (!user.profile) return NextResponse.json({ error: "onboarding incompleto" }, { status: 403 });

  const url = new URL(request.url);
  const parsed = consulta.safeParse({
    menuNumber: url.searchParams.get("menuNumber"),
    slot: url.searchParams.get("slot"),
  });
  if (!parsed.success) return NextResponse.json({ error: "datos inválidos" }, { status: 422 });

  const mealPlan = await menuDe(user.id, parsed.data.menuNumber);
  if (!mealPlan) return NextResponse.json({ error: "No hay menú vigente." }, { status: 404 });

  try {
    const catalogo = catalogoCon(await alimentosPropiosDe(user.id));
    const opciones = opcionesDePlatilloGuardado(
      mealPlan.mealsJson,
      parsed.data.slot,
      toEngineProfile(user.profile, null),
      catalogo,
    );
    return NextResponse.json({ opciones });
  } catch (error) {
    if (error instanceof CambioPlatilloError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}

const cuerpo = z.object({
  menuNumber: z.number().int().positive(),
  slot: z.string().trim().min(1),
  preparacionId: z.string().trim().min(1),
});

export async function POST(request: Request): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  if (!user.profile) return NextResponse.json({ error: "onboarding incompleto" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "cuerpo inválido" }, { status: 400 });
  }
  const parsed = cuerpo.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "datos inválidos" }, { status: 422 });

  const { menuNumber, slot, preparacionId } = parsed.data;
  const mealPlan = await menuDe(user.id, menuNumber);
  if (!mealPlan) return NextResponse.json({ error: `No existe el menú ${menuNumber}.` }, { status: 404 });

  let result;
  try {
    const catalogo = catalogoCon(await alimentosPropiosDe(user.id));
    result = aplicaCambioDePlatillo(
      mealPlan.mealsJson,
      mealPlan.equivalencesJson,
      { slot, preparacionId },
      toEngineProfile(user.profile, null),
      catalogo,
    );
  } catch (error) {
    if (error instanceof CambioPlatilloError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }

  const updated = await prisma.mealPlan.update({
    where: { id: mealPlan.id },
    data: {
      mealsJson: result.mealsJson as Prisma.InputJsonValue,
      equivalencesJson: result.equivalencesJson as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({ menu: toMenuView(updated.menuNumber, updated.mealsJson) });
}
