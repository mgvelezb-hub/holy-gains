import { NextResponse } from "next/server";
import { TIPOS_LECHE } from "engine";
import { z } from "zod";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { conTipoLeche } from "@/lib/coachy/leche";
import { materializeMealPlans } from "@/lib/coachy/menu";
import { prisma } from "@/lib/prisma";

/**
 * `PATCH /api/v1/me/leche` — la leche de licuados y cremas, y la semana
 * rearmada con ella.
 *
 * Cambiar de descremada a entera cambia kcal y grasa de cada licuado: el
 * menú que ya está publicado quedaría mintiendo. Por eso se rearma igual que
 * con la despensa —mismos macros, misma semilla, solo cambian los
 * alimentos— y con la misma regla: si ya hay comidas registradas esta semana,
 * el menú está congelado y solo se toca con `?rearmar=1`. Los días ya
 * registrados viven en `meal_logs`, que esto no toca.
 *
 * Se guarda como marca `leche:<tipo>` en los excluidos (`lib/coachy/leche.ts`).
 */

export const dynamic = "force-dynamic";

const schema = z.object({ tipoLeche: z.enum(TIPOS_LECHE) });

/** Lunes de la semana de esa fecha, a medianoche. */
function lunesDe(date: Date): Date {
  const lunes = new Date(date);
  lunes.setHours(0, 0, 0, 0);
  lunes.setDate(lunes.getDate() - ((lunes.getDay() + 6) % 7));
  return lunes;
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

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "leche inválida" }, { status: 422 });
  }
  const { tipoLeche } = parsed.data;

  const profile = await prisma.profile.update({
    where: { userId: user.id },
    data: { excludedFoods: conTipoLeche(user.profile.excludedFoods, tipoLeche) },
  });

  const decision = await prisma.decision.findFirst({
    where: { userId: user.id, status: "APROBADA" },
    orderBy: { checkIn: { date: "desc" } },
    include: { checkIn: { select: { date: true } } },
  });
  if (!decision) return NextResponse.json({ tipoLeche, rearmado: false, congelado: false });

  const registrados = await prisma.mealLog.count({
    where: { userId: user.id, date: { gte: lunesDe(new Date()) } },
  });
  const congelada = registrados > 0;
  const rearmar = new URL(request.url).searchParams.get("rearmar") === "1";
  if (congelada && !rearmar) {
    return NextResponse.json({ tipoLeche, rearmado: false, congelado: true });
  }

  const latest = await prisma.checkIn.findFirst({
    where: { userId: user.id, weightKg: { not: null } },
    orderBy: { date: "desc" },
    select: { weightKg: true },
  });

  try {
    await materializeMealPlans(decision, profile, {
      overwrite: true,
      latestWeightKg: latest?.weightKg == null ? null : Number(latest.weightKg),
    });
  } catch (error) {
    console.error("[coachy] no se pudo rearmar la semana con la leche nueva", error);
    return NextResponse.json(
      { error: "Guardamos tu leche, pero no se pudo rearmar tu semana. Intenta de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ tipoLeche, rearmado: true, congelado: congelada });
}
