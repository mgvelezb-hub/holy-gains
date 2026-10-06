import { NextResponse } from "next/server";
import { z } from "zod";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { ajusteDelCiclo } from "@/lib/ciclo/ajustes";
import {
  CYCLE_ESTIMATE_NOTE,
  CYCLE_OPT_IN_NOTE,
  MAX_CYCLE_LENGTH,
  MIN_CYCLE_LENGTH,
  cycleSettingsFromProfile,
  estimateCyclePhase,
} from "@/lib/cycle";
import { fromISODate, toISODate } from "@/lib/format";
import { prisma } from "@/lib/prisma";

/**
 * `GET/PUT /api/v1/ciclo` — el seguimiento del ciclo desde la app.
 *
 * La base y la estimación existían desde la web (Fase 7), pero la app nativa
 * no tenía cómo prenderlo ni cómo decir "hoy empezó mi periodo". Es opt-in y
 * dato de salud de ella: solo lo lee y lo escribe la propia atleta.
 *
 * Estimación de calendario, jamás diagnóstico ni anticoncepción.
 */

export const dynamic = "force-dynamic";

type Perfil = NonNullable<NonNullable<Awaited<ReturnType<typeof apiUser>>>["profile"]>;

function vista(profile: Perfil) {
  const ajustes = cycleSettingsFromProfile(profile);
  const hoy = toISODate(new Date());
  return {
    // Solo se ofrece a quien se registró como mujer; nadie más lo ve.
    disponible: profile.sex === "FEMALE",
    activo: ajustes.enabled,
    ultimoPeriodo: ajustes.lastPeriodStart,
    duracion: ajustes.avgLengthDays,
    rango: { min: MIN_CYCLE_LENGTH, max: MAX_CYCLE_LENGTH },
    ajuste: ajusteDelCiclo(estimateCyclePhase(ajustes, hoy)),
    notaActivar: CYCLE_OPT_IN_NOTE,
    nota: CYCLE_ESTIMATE_NOTE,
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  if (!user.profile) return NextResponse.json({ error: "onboarding incompleto" }, { status: 403 });
  return NextResponse.json(vista(user.profile));
}

const schema = z.object({
  activo: z.boolean().optional(),
  /** Primer día del último periodo; "hoy empezó" manda la fecha de hoy. No puede ser futuro. */
  ultimoPeriodo: z.iso
    .date("Fecha inválida")
    .refine((value) => value <= toISODate(new Date()), "La fecha no puede ser futura")
    .nullable()
    .optional(),
  duracion: z.number().int().min(MIN_CYCLE_LENGTH).max(MAX_CYCLE_LENGTH).optional(),
});

export async function PUT(request: Request): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  if (!user.profile) return NextResponse.json({ error: "onboarding incompleto" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "cuerpo inválido" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "datos inválidos" },
      { status: 422 },
    );
  }

  const { activo, ultimoPeriodo, duracion } = parsed.data;
  const actualizado = await prisma.profile.update({
    where: { userId: user.id },
    data: {
      // Registrar un periodo es prender el seguimiento: no tiene sentido
      // guardar la fecha y seguir sin usarla.
      ...(activo !== undefined ? { cycleTrackingEnabled: activo } : {}),
      ...(ultimoPeriodo ? { cycleTrackingEnabled: activo ?? true } : {}),
      ...(ultimoPeriodo !== undefined
        ? { cycleLastPeriodStart: ultimoPeriodo === null ? null : fromISODate(ultimoPeriodo) }
        : {}),
      ...(duracion !== undefined ? { cycleAvgLength: duracion } : {}),
    },
  });

  return NextResponse.json(vista(actualizado));
}
