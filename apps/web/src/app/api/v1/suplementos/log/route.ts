import { NextResponse } from "next/server";
import { SUPPLEMENTS } from "engine";
import { z } from "zod";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { fromISODate, isoFromDateColumn } from "@/lib/format";
import { prisma } from "@/lib/prisma";

/**
 * `POST /api/v1/suplementos/log` — "ya me la tomé" (o la desmarca).
 *
 * Sin registro la pauta es un letrero; con él se sabe si la creatina se toma
 * todos los días, que es lo único que hace que funcione. El mismo día y el
 * mismo suplemento se reescriben: corregirse no duplica.
 */

export const dynamic = "force-dynamic";

const schema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "la fecha va en formato YYYY-MM-DD")
    .refine((value) => !Number.isNaN(Date.parse(`${value}T12:00:00.000Z`)), "fecha inexistente"),
  supplement: z.enum(SUPPLEMENTS),
  taken: z.boolean(),
});

export async function POST(request: Request): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "cuerpo inválido" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "registro inválido" }, { status: 422 });
  }

  const { date, supplement, taken } = parsed.data;
  const fila = await prisma.supplementLog.upsert({
    where: { userId_date_supplement: { userId: user.id, date: fromISODate(date), supplement } },
    create: { userId: user.id, date: fromISODate(date), supplement, taken },
    update: { taken },
  });

  return NextResponse.json({
    registro: { date: isoFromDateColumn(fila.date), supplement: fila.supplement, taken: fila.taken },
  });
}
