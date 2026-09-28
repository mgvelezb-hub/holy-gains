import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { SUPPLEMENTS, fijaInfusiones, parseElecciones, registraEleccion } from "engine";
import { z } from "zod";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { toISODate } from "@/lib/format";
import { prisma } from "@/lib/prisma";

/**
 * `POST /api/v1/suplementos/eleccion` — la persona decide.
 *
 * - `{ supplement, eleccion: "acepto" | "ya_lo_tomo" }`: se registra y el
 *   suplemento pasa a sus tomas (`supplements`).
 * - `{ supplement, eleccion: "no_quiero" }`: se registra con fecha —no vuelve
 *   a sugerirse en 90 días— y, si lo tomaba, sale de sus tomas. Es también
 *   el "quitar" de la hoja de una toma.
 * - `{ infusiones: false }`: apaga las sugerencias de tés e infusiones.
 */

export const dynamic = "force-dynamic";

const schema = z.union([
  z.object({
    supplement: z.enum(SUPPLEMENTS),
    eleccion: z.enum(["acepto", "no_quiero", "ya_lo_tomo"]),
  }),
  z.object({ infusiones: z.boolean() }),
]);

export async function POST(request: Request): Promise<NextResponse> {
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
    return NextResponse.json({ error: "elección inválida" }, { status: 422 });
  }

  const actual = user.profile.supplementChoices;
  let choices: Record<string, unknown>;
  let supplements = user.profile.supplements;

  if ("infusiones" in parsed.data) {
    choices = fijaInfusiones(actual, parsed.data.infusiones);
  } else {
    const { supplement, eleccion } = parsed.data;
    choices = registraEleccion(actual, supplement, eleccion, toISODate(new Date()));
    supplements =
      eleccion === "no_quiero"
        ? supplements.filter((valor) => valor !== supplement)
        : [...new Set([...supplements, supplement])];
  }

  const profile = await prisma.profile.update({
    where: { userId: user.id },
    data: { supplementChoices: choices as Prisma.InputJsonValue, supplements },
    select: { supplements: true, supplementChoices: true },
  });

  const { elecciones, quiereInfusiones } = parseElecciones(profile.supplementChoices);
  return NextResponse.json({ supplements: profile.supplements, elecciones, quiereInfusiones });
}
