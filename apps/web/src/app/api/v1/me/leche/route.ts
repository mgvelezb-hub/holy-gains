import { NextResponse } from "next/server";
import { BASES_LICUADO, TIPOS_LECHE } from "engine";
import { z } from "zod";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { baseLicuadoDe, conBaseLicuado, conTipoLeche, tipoLecheDe } from "@/lib/coachy/leche";
import { decisionVigente, materializeMealPlans } from "@/lib/coachy/menu";
import { prisma } from "@/lib/prisma";

/**
 * `PATCH /api/v1/me/leche` — la leche de licuados y cremas, o la base de los
 * licuados (leche o agua), y la semana rearmada con ella.
 *
 * Cambiar de descremada a entera cambia kcal y grasa de cada licuado: el
 * menú que ya está publicado quedaría mintiendo. Por eso se rearma igual que
 * con la despensa —mismos macros, misma semilla, solo cambian los
 * alimentos— y con la misma regla: si ya hay comidas registradas esta semana,
 * el menú está congelado y solo se toca con `?rearmar=1`. Los días ya
 * registrados viven en `meal_logs`, que esto no toca.
 *
 * Se guarda como marca `leche:<tipo>` (y `base:agua`) en los excluidos
 * (`lib/coachy/leche.ts`). Licuar con agua quita los macros de la taza de
 * leche: el menú se rearma por lo mismo que con la leche.
 */

export const dynamic = "force-dynamic";

const schema = z
  .object({
    tipoLeche: z.enum(TIPOS_LECHE).optional(),
    baseLicuado: z.enum(BASES_LICUADO).optional(),
  })
  .refine((datos) => datos.tipoLeche !== undefined || datos.baseLicuado !== undefined);

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
    return NextResponse.json({ error: "leche o base inválida" }, { status: 422 });
  }
  const guardados = user.profile.excludedFoods;
  const tipoLeche = parsed.data.tipoLeche ?? tipoLecheDe(guardados);
  const baseLicuado = parsed.data.baseLicuado ?? baseLicuadoDe(guardados);

  const profile = await prisma.profile.update({
    where: { userId: user.id },
    data: { excludedFoods: conBaseLicuado(conTipoLeche(guardados, tipoLeche), baseLicuado) },
  });

  // La misma decisión que pinta Nutrición (`decisionVigente`).
  const decision = await decisionVigente(user.id);
  if (!decision) return NextResponse.json({ tipoLeche, baseLicuado, rearmado: false, congelado: false });

  const registrados = await prisma.mealLog.count({
    where: { userId: user.id, date: { gte: lunesDe(new Date()) } },
  });
  const congelada = registrados > 0;
  const rearmar = new URL(request.url).searchParams.get("rearmar") === "1";
  if (congelada && !rearmar) {
    return NextResponse.json({ tipoLeche, baseLicuado, rearmado: false, congelado: true });
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

  return NextResponse.json({ tipoLeche, baseLicuado, rearmado: true, congelado: congelada });
}
