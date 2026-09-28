import { NextResponse } from "next/server";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { prisma } from "@/lib/prisma";

import { conMontaje, edadEnAnios, ejercicioPrefsSchema, leeMontajes } from "./prefs";

/**
 * `GET|PATCH /api/v1/me/ejercicio-prefs` — cómo está montado cada ejercicio
 * (carga por lado y cuánto pesa la barra o el carro).
 *
 * La sesión en vivo pregunta una sola vez por ejercicio "¿se carga por
 * lado?" y "¿cuánto pesa la barra?", y lo guarda aquí para no volver a
 * preguntar ni en otro teléfono. Ver `prefs.ts`.
 *
 * El GET trae además lo que el descanso por pulso necesita y el teléfono no
 * tiene a mano sin red: la edad (FC máxima estimada) y la última FC en reposo
 * que llegó de Salud. El teléfono lo guarda para la sesión.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  if (!user.profile) {
    return NextResponse.json({ error: "onboarding incompleto" }, { status: 403 });
  }

  const reposo = await prisma.healthDay.findFirst({
    where: { userId: user.id, restingHr: { not: null } },
    orderBy: { date: "desc" },
    select: { restingHr: true },
  });

  return NextResponse.json({
    prefs: leeMontajes(user.profile.exercisePrefs),
    edad: edadEnAnios(user.profile.birthDate, user.profile.ageRange),
    fcReposo: reposo?.restingHr ?? null,
  });
}

export async function PATCH(request: Request): Promise<NextResponse> {
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

  const parsed = ejercicioPrefsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "montaje inválido" }, { status: 422 });
  }

  const prefs = conMontaje(leeMontajes(user.profile.exercisePrefs), parsed.data);
  await prisma.profile.update({
    where: { userId: user.id },
    data: { exercisePrefs: prefs },
  });

  return NextResponse.json({ prefs });
}
