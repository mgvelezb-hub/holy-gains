import { NextResponse } from "next/server";
import { z } from "zod";

import { apiUser, unauthorized } from "@/lib/api/auth";
import type { Profile } from "@prisma/client";

import { baseLicuadoDe, conBaseLicuado, conTipoLeche, tipoLecheDe } from "@/lib/coachy/leche";
import { vistaPreviaDelPlan } from "@/lib/coachy/plan-nutricion";
import { prisma } from "@/lib/prisma";
import { conNucleo } from "@/lib/suplementos/entrada";

/**
 * `POST /api/v1/nutricion/replan` — rearmar el perfil de alimentación.
 *
 * El equivalente nutricional de rearmar la rutina: se contestan las preguntas
 * que de verdad cambian el menú y el perfil queda de nuevo, con una lectura de
 * qué implica cada respuesta.
 *
 * Lo que NO hace: regenerar el menú de la semana en curso. Ese ya se compró, y
 * rehacerlo a media semana obliga a tirar comida — el nuevo entra con la
 * siguiente decisión, igual que con el presupuesto.
 *
 * Las implicaciones se calculan aquí y no en la app porque salen de las mismas
 * reglas del motor: un texto en el cliente se desincroniza el día que el motor
 * cambia y nadie se entera.
 *
 * `?preview=1` (K1) NO escribe: devuelve la lectura y la vista previa del plan
 * con esas respuestas —kcal y macros, un día de muestra en medidas caseras,
 * cuánto de la despensa entra, las tomas del día y los avisos— para que la
 * pantalla la enseñe mientras se contesta. Sale de `vistaPreviaDelPlan`, con
 * el mismo perfil del motor que arma los menús de verdad.
 */

export const dynamic = "force-dynamic";

const schema = z.object({
  goal: z.enum(["RECOMPOSICION", "PERDIDA_GRASA", "GANANCIA_MUSCULO", "SALUD", "RENDIMIENTO"]),
  mealsPerDay: z.number().int().min(3).max(5),
  budget: z.enum(["BAJO", "MEDIO", "ALTO"]),
  dietStyle: z.enum(["ESTANDAR", "AYUNO", "VEGETARIANA", "KETO"]),
  maxPrepMin: z.number().int().min(5).max(120).nullable(),
  supplements: z.array(z.enum(["WHEY", "CREATINA", "OMEGA3"])).max(3),
  excludedFoods: z.array(z.string().trim().min(1).max(40)).max(30),
  favoriteFoods: z.array(z.string().trim().min(1).max(40)).max(30),
});

/**
 * Qué implica cada respuesta, en el vocabulario de quien come.
 *
 * Se dice antes de que llegue el menú: una dieta que aparece sin explicación
 * se sigue tres días. Y se dice lo que cuesta, no solo lo que se gana.
 */
function lecturaDe(datos: z.infer<typeof schema>): string[] {
  const lectura: string[] = [];

  if (datos.dietStyle === "KETO") {
    lectura.push(
      "En keto el carbohidrato baja a un tope y las calorías que sobran se van a grasa. Tu " +
        "proteína no se mueve. Es el único estilo que cambia la fórmula, y el que menos historia " +
        "tiene detrás en esta app: conviene mirar tus primeras semanas de cerca.",
    );
  }
  if (datos.dietStyle === "AYUNO") {
    lectura.push(
      "El ayuno mueve horarios, no gramos: las mismas comidas comprimidas en tu ventana. Si " +
        "entrenas antes de que abra, vas a entrenar en ayuno.",
    );
  }
  if (datos.dietStyle === "VEGETARIANA") {
    lectura.push(
      "Vegetariana aquí es ovolactovegetariana: salen carne, pollo y pescado; huevo y lácteos se " +
        "quedan. Tu proteína va a venir sobre todo de lácteos, huevo, soya y legumbres.",
    );
  }

  if (datos.mealsPerDay === 3) {
    lectura.push(
      "Con tres comidas cada una carga más gramos. Es más simple de preparar y más pesada de " +
        "digerir cerca del entrenamiento.",
    );
  }
  if (datos.mealsPerDay === 5) {
    lectura.push(
      "Cinco comidas reparten mejor la proteína del día, y son cinco momentos que hay que " +
        "resolver: funciona si tu día lo permite.",
    );
  }

  if (datos.budget === "BAJO") {
    lectura.push(
      "Con presupuesto bajo el menú se arma solo con lo más barato del catálogo. Cubre todos los " +
        "roles —proteína, carbohidrato, grasa y vegetales—, pero repite más.",
    );
  }

  if (datos.maxPrepMin !== null && datos.maxPrepMin <= 10) {
    lectura.push(
      "Con poco tiempo entra lo que se calienta y se sirve. Lo que se cocina en lote —arroz, " +
        "legumbres, pollo— sigue entrando: cuenta como calentar, porque se hace de una vez.",
    );
  }

  if (datos.supplements.length === 0) {
    lectura.push(
      "Sin suplementos declarados, el menú va con comida entera y no vas a ver polvos en tu plan.",
    );
  }

  if (datos.excludedFoods.length > 12) {
    lectura.push(
      `Excluiste ${datos.excludedFoods.length} alimentos. Cuantos más salen, más se repite lo que ` +
        "queda: si el menú se vuelve monótono, ahí está la razón.",
    );
  }

  return lectura;
}

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
    return NextResponse.json(
      { error: "respuestas inválidas", detalles: parsed.error.issues.slice(0, 3) },
      { status: 422 },
    );
  }

  const datos = parsed.data;
  const cambios = cambiosDelPerfil(user.profile, datos);

  if (new URL(request.url).searchParams.get("preview") === "1") {
    const previa = await vistaPreviaDelPlan(user.id, { ...user.profile, ...cambios }).catch((error: unknown) => {
      console.error("[coachy] no se pudo armar la vista previa del plan", error);
      return null;
    });
    return NextResponse.json({ lectura: lecturaDe(datos), previa });
  }

  await prisma.profile.update({ where: { userId: user.id }, data: cambios });

  return NextResponse.json({
    lectura: lecturaDe(datos),
    // Se dice explícitamente para que nadie espere que el menú cambie hoy.
    cuando: "Entra en tu siguiente decisión, con el check-in. El menú de esta semana ya se compró.",
  });
}

/** Lo que las respuestas cambian del perfil: lo mismo para guardar que para la vista previa. */
function cambiosDelPerfil(
  perfil: Profile,
  datos: z.infer<typeof schema>,
): Pick<
  Profile,
  "goal" | "mealsPerDay" | "budget" | "dietStyle" | "maxPrepMin" | "supplements" | "excludedFoods" | "favoriteFoods"
> {
  const normaliza = (lista: string[]) =>
    [...new Set(lista.map((valor) => valor.trim().toLowerCase()).filter(Boolean))];

  return {
    goal: datos.goal,
    mealsPerDay: datos.mealsPerDay,
    budget: datos.budget,
    dietStyle: datos.dietStyle,
    maxPrepMin: datos.maxPrepMin,
    // Replantear solo edita el núcleo; lo aceptado fuera de él se conserva.
    supplements: conNucleo(perfil.supplements, datos.supplements),
    // La leche y la base de licuados no son respuestas del cuestionario: se conservan.
    excludedFoods: conBaseLicuado(
      conTipoLeche(normaliza(datos.excludedFoods), tipoLecheDe(perfil.excludedFoods)),
      baseLicuadoDe(perfil.excludedFoods),
    ),
    favoriteFoods: normaliza(datos.favoriteFoods),
  };
}
