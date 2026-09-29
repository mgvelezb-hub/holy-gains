import { NextResponse } from "next/server";
import { FOODS, terminosDeBusqueda } from "engine";
import { z } from "zod";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { decisionVigente, materializeMealPlans } from "@/lib/coachy/menu";
import { prisma } from "@/lib/prisma";
import { alimentosPropiosDe } from "@/lib/coachy/alimentos-propios-db";
import { grupoDeRol } from "@/lib/coachy/alimentos-propios";
import { parsePantry } from "@/lib/coachy/mapping";

/**
 * La despensa: lo que la persona YA tiene comprado.
 *
 * Nació de un cambio del motor que rotó los alimentos y dejó sin uso la
 * despensa comprada con el menú anterior. La comida que ya se pagó manda
 * sobre la variedad: el motor elige primero lo que hay en casa dentro de cada
 * rol, y solo cuando la despensa no cubre un rol entra el resto del catálogo.
 *
 * `GET` trae el catálogo con el que se pinta la pantalla —la app no tiene la
 * base de alimentos— y lo del menú vigente, para marcar rápido lo que se
 * acaba de comprar. `PATCH` guarda y rearma la semana.
 */

export const dynamic = "force-dynamic";

/** Tope: 60 alimentos es una despensa, más es el catálogo entero. */
const MAX_DESPENSA = 60;

/** Los cinco grupos con los que la pantalla filtra. `suplemento` vive en Alacena. */
const GRUPOS = {
  proteina: ["proteina_magra", "proteina_grasa"],
  carbo: ["carbo_pre", "carbo_post", "carbo_complejo"],
  grasa: ["grasa"],
  fruta: ["fruta"],
  verdura: ["vegetal_libre"],
} as const;

export type GrupoDespensa = keyof typeof GRUPOS;

function grupoDe(role: string): GrupoDespensa | null {
  for (const [grupo, roles] of Object.entries(GRUPOS)) {
    if ((roles as readonly string[]).includes(role)) return grupo as GrupoDespensa;
  }
  return null;
}

/**
 * El catálogo como lo necesita la pantalla: nombre para leer, grupo para el
 * chip y `busqueda` para encontrarlo.
 *
 * `busqueda` son los términos del motor —nombre, id, tags y sus sinónimos, ya
 * sin acentos ni plurales—. Viaja con el catálogo para que la app filtre con
 * la misma tolerancia que el motor sin cargar la tabla de sinónimos ni pedir
 * al servidor una búsqueda por cada tecla: quien escribe "Yogurt Griego"
 * encuentra el "Yogur griego natural 0%".
 */
// El agua es la base del licuado, no algo que se compra: no va en la despensa.
const CATALOGO = FOODS.filter((food) => !food.tags.includes("base_agua")).map((food) => ({
  id: food.id,
  nombre: food.name,
  grupo: grupoDe(food.role),
  busqueda: terminosDeBusqueda(food),
}))
  .filter(
    (item): item is { id: string; nombre: string; grupo: GrupoDespensa; busqueda: string[] } =>
      item.grupo !== null,
  )
  .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

const IDS_VALIDOS = new Set(CATALOGO.map((item) => item.id));

type ItemDeCatalogo = (typeof CATALOGO)[number] & { tuyo?: boolean };

/**
 * El catálogo de esa persona: el de siempre más lo que dio de alta ella.
 *
 * Los propios van marcados con `tuyo` porque la pantalla les ofrece lo que a
 * los del catálogo no: editarlos y borrarlos.
 */
async function catalogoDe(userId: string): Promise<{ catalogo: ItemDeCatalogo[]; ids: Set<string> }> {
  const propios = await alimentosPropiosDe(userId);
  const suyos: ItemDeCatalogo[] = propios.map((food) => ({
    id: food.id,
    nombre: food.name,
    grupo: grupoDeRol(food.role) as GrupoDespensa,
    busqueda: terminosDeBusqueda(food),
    tuyo: true,
  }));

  const catalogo = [...suyos, ...CATALOGO];
  return { catalogo, ids: new Set(catalogo.map((item) => item.id)) };
}

const schema = z.object({
  pantry: z.array(z.string()).max(200),
});

/** Lunes de la semana de esa fecha, a medianoche. */
function lunesDe(date: Date): Date {
  const lunes = new Date(date);
  lunes.setHours(0, 0, 0, 0);
  lunes.setDate(lunes.getDate() - ((lunes.getDay() + 6) % 7));
  return lunes;
}

/** Los alimentos del menú vigente: lo que se compró con la última lista de súper. */
async function deLaUltimaLista(userId: string): Promise<string[]> {
  const decision = await prisma.decision.findFirst({
    where: { userId, status: { in: ["APROBADA", "CORREGIDA"] } },
    orderBy: { checkIn: { date: "desc" } },
    select: { id: true },
  });
  if (!decision) return [];

  const plans = await prisma.mealPlan.findMany({
    where: { decisionId: decision.id },
    select: { mealsJson: true },
  });

  const ids = new Set<string>();
  for (const plan of plans) {
    const meals = Array.isArray(plan.mealsJson) ? plan.mealsJson : [];
    for (const meal of meals as Array<{ items?: Array<{ foodId?: unknown }> }>) {
      for (const item of meal.items ?? []) {
        if (typeof item.foodId === "string" && IDS_VALIDOS.has(item.foodId)) ids.add(item.foodId);
      }
    }
  }
  return [...ids];
}

export async function GET(request: Request): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  if (!user.profile) {
    return NextResponse.json({ error: "onboarding incompleto" }, { status: 403 });
  }

  const { catalogo } = await catalogoDe(user.id);

  return NextResponse.json({
    pantry: parsePantry(user.profile.pantry),
    catalogo,
    deTuLista: await deLaUltimaLista(user.id),
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

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "despensa inválida", detalles: parsed.error.issues.slice(0, 3) },
      { status: 422 },
    );
  }

  // Los ids se validan contra el catálogo DE ESA PERSONA: el de siempre más
  // sus alimentos propios, que ningún set global puede conocer.
  const { ids } = await catalogoDe(user.id);
  const pantry = [...new Set(parsed.data.pantry)]
    .filter((id) => ids.has(id))
    .slice(0, MAX_DESPENSA);
  const profile = await prisma.profile.update({
    where: { userId: user.id },
    data: { pantry },
  });

  // La misma decisión que pinta Nutrición (`decisionVigente`).
  const decision = await decisionVigente(user.id);
  if (!decision) return NextResponse.json({ pantry, rearmado: false, congelado: false });

  // La semana está congelada cuando ya se comió con ella: rehacerla a media
  // semana cambiaría el menú de días que la persona ya registró. Por eso se
  // rearma sola mientras nadie haya comido todavía, y en cuanto hay registros
  // hay que pedirlo de frente con `?rearmar=1`.
  const registrados = await prisma.mealLog.count({
    where: { userId: user.id, date: { gte: lunesDe(new Date()) } },
  });
  const congelada = registrados > 0;
  const rearmar = new URL(request.url).searchParams.get("rearmar") === "1";

  if (congelada && !rearmar) {
    return NextResponse.json({ pantry, rearmado: false, congelado: true });
  }

  const latest = await prisma.checkIn.findFirst({
    where: { userId: user.id, weightKg: { not: null } },
    orderBy: { date: "desc" },
    select: { weightKg: true },
  });

  try {
    // El mismo camino que "regenerar mi menú": los macros no se tocan, solo
    // CON QUÉ alimentos se cumplen. Los días ya registrados viven en
    // `meal_logs`, que esto no toca: lo que cambia es el menú de hoy en
    // adelante.
    await materializeMealPlans(decision, profile, {
      overwrite: true,
      latestWeightKg: latest?.weightKg == null ? null : Number(latest.weightKg),
    });
  } catch (error) {
    console.error("[coachy] no se pudo rearmar la semana con la despensa", error);
    return NextResponse.json(
      { error: "Guardamos tu despensa, pero no se pudo rearmar tu semana. Intenta de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ pantry, rearmado: true, congelado: congelada });
}
