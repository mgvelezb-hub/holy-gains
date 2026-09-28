import { NextResponse } from "next/server";
import { z } from "zod";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { conTipoLeche, sinMarcaDeLeche, tipoLecheDe } from "@/lib/coachy/leche";
import { conPreferenciaDePreparaciones } from "@/lib/coachy/preparaciones";
import { prisma } from "@/lib/prisma";
import { conNucleo } from "@/lib/suplementos/entrada";

/**
 * `PATCH /api/v1/me/nutricion` — las preferencias que cambian el menú.
 *
 * Presupuesto, tope de tiempo de cocina y los alimentos que sí y que no.
 * Cambiarlas NO regenera los menús ya publicados: el menú de esta semana ya se
 * compró, y rehacerlo a media semana obligaría a tirar comida. El siguiente
 * check-in lo arma con lo nuevo.
 *
 * Cada campo es opcional y se aplica solo si viene: la pantalla guarda un
 * ajuste a la vez, y mandar el resto en cada toque pisaría con valores viejos
 * lo que se acaba de cambiar.
 */

export const dynamic = "force-dynamic";

/** Lista de alimentos escritos a mano: normalizada, sin repetidos y acotada. */
function foodList(max: number) {
  return z
    .array(z.string())
    .max(200)
    .transform((items) =>
      Array.from(new Set(items.map((item) => item.trim().toLowerCase()).filter(Boolean))).slice(
        0,
        max,
      ),
    );
}

const schema = z
  .object({
    budget: z.enum(["BAJO", "MEDIO", "ALTO"]).optional(),
    /**
     * Minutos de cocina por preparación. `null` = sin tope. El piso de 5 evita
     * un tope que solo dejaría pasar lo que se come crudo.
     */
    maxPrepMin: z.number().int().min(5).max(120).nullable().optional(),
    favoriteFoods: foodList(30).optional(),
    excludedFoods: foodList(30).optional(),
    /** Estilo de dieta. Se elige; la app no lo decide por ti. */
    dietStyle: z.enum(["ESTANDAR", "AYUNO", "VEGETARIANA", "KETO"]).optional(),
    /** Ventana de alimentación del ayuno, en horas locales. */
    fastingStartHour: z.number().int().min(0).max(23).nullable().optional(),
    fastingEndHour: z.number().int().min(0).max(23).nullable().optional(),
    /** Lo que la persona tiene, no lo que le recomendamos comprar. */
    supplements: z.array(z.enum(["WHEY", "CREATINA", "OMEGA3"])).max(3).optional(),
    /**
     * Qué platillos compuestos acepta el menú. Se guarda como marcas en los
     * excluidos (`lib/coachy/preparaciones.ts`): no pisa los demás excluidos.
     */
    preparaciones: z
      .object({ licuados: z.boolean(), sopas: z.boolean(), cremas: z.boolean() })
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "no hay nada que guardar" })
  .refine(
    (value) =>
      value.fastingStartHour === undefined ||
      value.fastingEndHour === undefined ||
      value.fastingStartHour === null ||
      value.fastingEndHour === null ||
      value.fastingEndHour - value.fastingStartHour >= 1,
    { message: "la ventana de alimentación tiene que durar al menos una hora" },
  );

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
    return NextResponse.json(
      { error: "preferencias inválidas", detalles: parsed.error.issues.slice(0, 3) },
      { status: 422 },
    );
  }

  const {
    budget,
    maxPrepMin,
    favoriteFoods,
    excludedFoods,
    dietStyle,
    fastingStartHour,
    fastingEndHour,
    supplements,
    preparaciones,
  } = parsed.data;

  // Las marcas de preparación viven en los excluidos: se aplican sobre la
  // lista que llega en esta misma petición, o sobre la guardada si no llega.
  const conPreparaciones =
    preparaciones === undefined
      ? excludedFoods
      : conPreferenciaDePreparaciones(excludedFoods ?? user.profile.excludedFoods, preparaciones);
  // La marca de leche no viaja a la pantalla (GET /me la quita): la lista que
  // regresa sin ella conserva la leche guardada. Se cambia en PATCH /me/leche.
  const excluidos =
    conPreparaciones === undefined
      ? undefined
      : conTipoLeche(conPreparaciones, tipoLecheDe(user.profile.excludedFoods));

  const profile = await prisma.profile.update({
    where: { userId: user.id },
    data: {
      ...(budget !== undefined ? { budget } : {}),
      ...(maxPrepMin !== undefined ? { maxPrepMin } : {}),
      ...(favoriteFoods !== undefined ? { favoriteFoods } : {}),
      ...(excluidos !== undefined ? { excludedFoods: excluidos } : {}),
      ...(dietStyle !== undefined ? { dietStyle } : {}),
      ...(fastingStartHour !== undefined ? { fastingStartHour } : {}),
      ...(fastingEndHour !== undefined ? { fastingEndHour } : {}),
      // Solo el núcleo viaja aquí: lo aceptado fuera de él (magnesio, té) se conserva.
      ...(supplements !== undefined ? { supplements: conNucleo(user.profile.supplements, supplements) } : {}),
    },
    select: {
      budget: true,
      maxPrepMin: true,
      favoriteFoods: true,
      excludedFoods: true,
      dietStyle: true,
      fastingStartHour: true,
      fastingEndHour: true,
      supplements: true,
    },
  });

  return NextResponse.json({ ...profile, excludedFoods: sinMarcaDeLeche(profile.excludedFoods) });
}
