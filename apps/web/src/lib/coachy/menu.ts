import "server-only";

import type { Decision, MealPlan, Profile } from "@prisma/client";
import type { Prisma, PrismaClient } from "@prisma/client";
import { catalogoCon, distribute, generateMenu, listaDeSuper } from "engine";
import type { Food } from "engine";

import { rellenaEquivalencias } from "@/lib/coachy/equivalencias-backfill";
import { toGroceries } from "@/lib/coachy/menu-view";
import { perfilDelMotor } from "@/lib/coachy/perfil-motor";
import { porcionNatural } from "@/lib/coachy/porciones";
import { menusDesactualizados, semillaGuardada, sellaMenu } from "@/lib/coachy/version-menu";
import type { EngineDecision } from "@/lib/engine-types";
import { prisma } from "@/lib/prisma";

/**
 * Menús de la decisión.
 *
 * Cadencias de la metodología §2: el **refresco de menú** ocurre cada ~2 semanas
 * (misma fase, mismos macros, alimentos distintos) y el **cambio de fase** es
 * mensual y por señal. El motor ya resuelve las dos: `menuSeed` cambia cada
 * quincena y `phase` cambia cuando toca. Aquí solo se materializan.
 *
 * El generador es determinista: con la misma semilla salen los mismos menús, así
 * que regenerar no sorprende al atleta a media semana.
 */

export interface SyncMenuOptions {
  /** La fase cambió respecto a la decisión anterior. */
  phaseChanged: boolean;
  /** El motor movió la semilla: toca quincena. */
  menuSeedChanged: boolean;
  /** Peso más reciente del historial; el del perfil puede estar viejo. */
  latestWeightKg?: number | null;
  /**
   * Menú nuevo aunque el motor no lo pida (el check-in mensual). Los menús
   * son de la decisión, no del día, así que lo ya registrado en `MealLog`
   * no se toca: el menú nuevo manda de hoy en adelante.
   */
  forceRefresh?: boolean;
}

/**
 * La semilla con la que se arma el menú de la decisión.
 *
 * La del motor cambia cada quincena; con la misma semilla sale el mismo
 * menú. Para forzar alimentos distintos sin esperar la quincena se corre una
 * posición — solo si la semilla no cambió ya por sí sola, que es cuando el
 * menú saldría idéntico al anterior. No se guarda en `Decision.menuSeed`: esa
 * columna es la del motor y es la que dice cuándo toca la siguiente quincena.
 */
export function semillaDelMenu(
  menuSeed: number,
  options: { forceRefresh?: boolean; menuSeedChanged: boolean },
): number {
  return options.forceRefresh && !options.menuSeedChanged ? menuSeed + 1 : menuSeed;
}

export async function syncMealPlans(
  decisionId: string,
  profile: Profile,
  engineDecision: EngineDecision,
  options: SyncMenuOptions,
): Promise<MealPlan[]> {
  const existing = await prisma.mealPlan.findMany({
    where: { decisionId },
    orderBy: { menuNumber: "asc" },
  });

  const needsMenu =
    existing.length === 0 ||
    options.phaseChanged ||
    options.menuSeedChanged ||
    engineDecision.menuRefresh ||
    options.forceRefresh === true;

  if (!needsMenu) return existing;

  // El mismo perfil que el resto de los caminos: estudios y alimentos
  // propios incluidos (`perfil-motor.ts`).
  const { engineProfile, extraFoods } = await perfilDelMotor(profile.userId, profile, {
    latestWeightKg: options.latestWeightKg ?? null,
  });
  const semilla = semillaDelMenu(engineDecision.menuSeed, options);
  const plan = generateMenu(engineDecision.meals, engineProfile, undefined, semilla, {
    phase: engineDecision.phase,
    extraFoods,
  });

  return guardaMenus(decisionId, plan, true, { semilla });
}

/** Lo que basta de Prisma para guardar menús: el cliente o una transacción. */
type ClienteMenus = Pick<PrismaClient, "mealPlan">;

/**
 * Guarda los dos menús de un plan del motor. `overwrite: false` deja intactos
 * los que ya existen. Cada comida se guarda sellada con la versión del motor
 * y la semilla (`version-menu.ts`).
 */
async function guardaMenus(
  decisionId: string,
  plan: ReturnType<typeof generateMenu>,
  overwrite: boolean,
  sello: { semilla: number; porReglasNuevas?: boolean },
  cliente: ClienteMenus = prisma,
): Promise<MealPlan[]> {
  const saved: MealPlan[] = [];

  for (const menu of plan.menus) {
    const equivalences = menu.meals.flatMap((meal) =>
      meal.equivalences.map((equivalence) => ({ slot: meal.slot, ...equivalence })),
    );

    const data = {
      mealsJson: sellaMenu(menu.meals, sello) as unknown as Prisma.InputJsonValue,
      equivalencesJson: equivalences as unknown as Prisma.InputJsonValue,
      groceryListJson: plan.shoppingList as unknown as Prisma.InputJsonValue,
    };

    saved.push(
      await cliente.mealPlan.upsert({
        where: { decisionId_menuNumber: { decisionId, menuNumber: menu.id } },
        create: { decisionId, menuNumber: menu.id, ...data },
        update: overwrite ? data : {},
      }),
    );
  }

  return saved;
}

/**
 * Fibra por defecto cuando la decisión se guardó sin ella (el importador de
 * historial no la trae). El motor la necesita para repartir el menú.
 */
const DEFAULT_FIBER_G = 25;

/** Semilla quincenal derivada de la fecha, para decisiones sin `menuSeed`. */
export function seedFromDate(date: Date): number {
  return Math.floor(date.getTime() / (14 * 86_400_000));
}

/** Los menús guardados de una decisión, del 1 al 2. */
export async function mealPlansOf(decisionId: string): Promise<MealPlan[]> {
  return prisma.mealPlan.findMany({ where: { decisionId }, orderBy: { menuNumber: "asc" } });
}

export interface MaterializeOptions {
  /** El peso más reciente del historial; el del perfil puede estar viejo. */
  latestWeightKg?: number | null;
  /**
   * Si ya hay menús guardados para esta decisión, `false` los deja intactos
   * (el caso de `ensureMealPlans`: solo rellena lo que nunca se generó) y
   * `true` los pisa con lo recién calculado (el caso de "regenerar mi menú
   * ahora": la persona pidió explícitamente que sus alimentos de hoy entren
   * YA, no hasta el siguiente check-in).
   */
  overwrite: boolean;
}

/**
 * `distribute` + `generateMenu` sobre los macros ya decididos, y guarda el
 * resultado.
 *
 * Único lugar donde se corre el generador de menús a partir de una
 * `Decision` ya guardada — `ensureMealPlans` (primera vez, nunca pisa) y
 * `POST /api/v1/nutricion/regenerar-menu` (a demanda, sí pisa) son los dos
 * llamadores, y comparten esta función para no tener la lógica del motor
 * duplicada con la oportunidad de que un día se desincronicen.
 *
 * Los MACROS no se tocan: `targets` sale de la `Decision` tal cual está
 * guardada. Lo único que cambia con `toEngineProfile(profile)` son las
 * preferencias con las que se elige QUÉ alimentos cumplen esos números —
 * exclusiones, favoritos, presupuesto, dieta, suplementos, tiempo de cocina.
 *
 * La MISMA semilla (`decision.menuSeed` o su respaldo por fecha) entra
 * siempre: mismo seed + catálogo filtrado por las preferencias de hoy es lo
 * que hace que regenerar cambie solo lo necesario y no entregue un menú
 * irreconocible.
 */
export async function materializeMealPlans(
  decision: Decision & { checkIn?: { date: Date } | null },
  profile: Profile,
  options: MaterializeOptions,
): Promise<MealPlan[]> {
  const { plan, semilla } = await planDeLaDecision(decision, profile, options);
  return guardaMenus(decision.id, plan, options.overwrite, { semilla });
}

/**
 * El plan del motor para una decisión ya guardada: sus macros tal cual, el
 * perfil de hoy (`perfilDelMotor`: despensa, leche, preparaciones, propios,
 * suplementos) y la semilla de la decisión — o la que se pida.
 */
async function planDeLaDecision(
  decision: Decision & { checkIn?: { date: Date } | null },
  profile: Profile,
  options: { latestWeightKg?: number | null; semilla?: number | null },
): Promise<{ plan: ReturnType<typeof generateMenu>; semilla: number }> {
  const { engineProfile, extraFoods } = await perfilDelMotor(profile.userId, profile, {
    latestWeightKg: options.latestWeightKg ?? null,
  });
  const targets = {
    kcal: decision.kcal,
    proteinG: decision.proteinG,
    fatG: decision.fatG,
    carbG: decision.carbsG,
    fiberG: decision.fiberG ?? DEFAULT_FIBER_G,
  };

  const slots = distribute(targets, engineProfile, decision.phase as EngineDecision["phase"]);
  const seed =
    options.semilla ?? decision.menuSeed ?? seedFromDate(decision.checkIn?.date ?? decision.createdAt);

  const plan = generateMenu(slots, engineProfile, undefined, seed, {
    phase: decision.phase as EngineDecision["phase"],
    // Los alimentos que dio de alta la persona entran por el mismo camino que
    // el catálogo: sin esto, darlos de alta no cambiaba nada del menú.
    extraFoods,
  });

  return { plan, semilla: seed };
}

/** Regeneraciones por versión en curso en este proceso, por persona. */
const actualizacionesEnCurso = new Map<string, Promise<MealPlan[]>>();

/**
 * Rehace los menús de la decisión vigente cuando se armaron con reglas más
 * viejas que `MENU_ENGINE_VERSION` — sin acceso a producción, la única
 * manera de que los menús de antes de la auditoría se pongan al día es que
 * se rehagan solos al leerlos.
 *
 * - Misma decisión (macros y fase intactos), misma semilla (la guardada en el
 *   menú; los de versión 1 no la traen y usan la de la decisión, igual que
 *   "regenerar"), mismo perfil de hoy. `MealLog` no se toca.
 * - Idempotente: si ya están en la versión vigente, no escribe nada.
 * - Con candado: dentro del proceso, dos lecturas simultáneas de la misma
 *   persona esperan la misma promesa; entre procesos, un candado de
 *   Postgres por persona (`pg_advisory_xact_lock`) serializa la escritura y
 *   el que llega segundo vuelve a leer, ve la versión nueva y se queda con
 *   lo que escribió el primero.
 * - Los cambios a mano (equivalencias elegidas, platillos cambiados) se
 *   guardan dentro de `mealsJson` sin marca que los distinga de lo que armó
 *   el motor, así que NO se pueden re-aplicar: se pierden. Por eso el menú
 *   queda marcado (`menuPorReglasNuevas`) y el plan trae el aviso.
 */
export async function actualizaMenusPorVersion(
  decision: Decision & { checkIn?: { date: Date } | null },
  profile: Profile,
  plans: MealPlan[],
  latestWeightKg?: number | null,
): Promise<MealPlan[]> {
  if (!menusDesactualizados(plans)) return plans;

  const llave = profile.userId;
  const enCurso = actualizacionesEnCurso.get(llave);
  if (enCurso) return enCurso;

  const trabajo = (async () => {
    const semilla = plans.map((plan) => semillaGuardada(plan.mealsJson)).find((s) => s !== null) ?? null;
    const { plan, semilla: usada } = await planDeLaDecision(decision, profile, { latestWeightKg, semilla });

    return prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`select pg_advisory_xact_lock(hashtext(${`menus-version:${llave}`}))`;
        const actuales = await tx.mealPlan.findMany({
          where: { decisionId: decision.id },
          orderBy: { menuNumber: "asc" },
        });
        // Otro proceso terminó primero: su resultado manda.
        if (actuales.length > 0 && !menusDesactualizados(actuales)) return actuales;
        return guardaMenus(decision.id, plan, true, { semilla: usada, porReglasNuevas: true }, tx);
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  })().finally(() => actualizacionesEnCurso.delete(llave));

  actualizacionesEnCurso.set(llave, trabajo);
  return trabajo;
}

/**
 * Menús de una decisión que nació sin ellos.
 *
 * `syncMealPlans` corre dentro de `runCoachy`, así que toda decisión que llegó
 * por otro camino — el importador de historial, por ejemplo — quedó con sus
 * números pero sin menú, y la atleta abre la app y no ve nada de nutrición.
 * Aquí se materializan **a demanda**, con el mismo patrón que la rutina:
 * la primera vez que alguien abre el home, no un cron.
 *
 * `overwrite: false`: si ya hay menús (aunque vengan de otra fuente), esta
 * función nunca los toca — para reemplazarlos a propósito está
 * `materializeMealPlans` directo, con `overwrite: true`.
 */
export async function ensureMealPlans(
  decision: Decision & { checkIn?: { date: Date } | null },
  profile: Profile,
  latestWeightKg?: number | null,
): Promise<MealPlan[]> {
  const existing = await mealPlansOf(decision.id);
  if (existing.length > 0) return existing;

  return materializeMealPlans(decision, profile, { overwrite: false, latestWeightKg });
}

export type CurrentMealPlan = {
  decision: Decision;
  plans: MealPlan[];
  /** El menú se acaba de materializar en este render. */
  materialized: boolean;
};

/**
 * El plan de alimentación vigente del atleta, materializándolo si hace falta.
 *
 * Prefiere lo publicado; si nada se publicó todavía pero hay una decisión
 * aprobada, esa manda — es exactamente el caso del historial importado, donde
 * la decisión existe desde el día uno y el menú nunca se generó.
 */
/**
 * Rellena las equivalencias que le faltan a un menú ya guardado y las
 * persiste, de una sola pasada.
 *
 * Se hace al LEER y no al generar porque el problema es justamente el de los
 * menús que ya existen: quien tiene uno de antes vería sus huecos para
 * siempre, y regenerarlo —la otra salida— le borra los cambios que ya eligió.
 * Si no falta nada no hay UPDATE, así que la lectura normal no paga nada.
 *
 * Un error aquí NO puede tumbar la pantalla de alimentación: si algo falla se
 * devuelven los menús tal como estaban, que es exactamente lo que se veía
 * antes de que esto existiera.
 */
async function rellenaEquivalenciasGuardadas(
  plans: MealPlan[],
  profile: Profile,
): Promise<MealPlan[]> {
  try {
    const { engineProfile } = await perfilDelMotor(profile.userId, profile);
    const salida: MealPlan[] = [];

    for (const plan of plans) {
      const relleno = rellenaEquivalencias(plan.mealsJson, plan.equivalencesJson, engineProfile);
      if (!relleno.cambiado) {
        salida.push(plan);
        continue;
      }

      salida.push(
        await prisma.mealPlan.update({
          where: { id: plan.id },
          data: {
            mealsJson: relleno.mealsJson as Prisma.InputJsonValue,
            equivalencesJson: relleno.equivalencesJson as Prisma.InputJsonValue,
          },
        }),
      );
    }

    return salida;
  } catch (error) {
    console.error("[coachy] no se pudieron rellenar las equivalencias", error);
    return plans;
  }
}


/** Los tres modos de cocinar la semana. */
export const MENU_PREFERENCES = ["AMBOS", "MENU_1", "MENU_2"] as const;
export type MenuPreference = (typeof MENU_PREFERENCES)[number];

/**
 * La lista de súper de lo que de verdad se va a cocinar esta semana.
 *
 * Los dos menús NO son dos semanas: son dos variantes de LA MISMA semana, con
 * los mismos macros y distintos alimentos, para no comer lo mismo siete días.
 * Por defecto la semana se reparte entre ambos (3.5 días cada uno) y hay que
 * comprar para los dos. Quien prefiere cocinar uno solo lo come los 7 días, y
 * entonces comprar los ingredientes del otro es tirar comida: por eso la
 * lista se recalcula desde los menús elegidos en vez de leer la que se guardó
 * al generarlos, que siempre asume los dos.
 */
export function listaDeSuperDe(
  plans: MealPlan[],
  preference: string,
  /** Ids de lo que ya está en casa: la lista lo marca en vez de mandarlo a comprar. */
  pantry: string[] = [],
  /** Los alimentos propios, para que la lista los reconozca como al resto. */
  extraFoods: Food[] = [],
): ReturnType<typeof toGroceries> {
  const elegidos =
    preference === "MENU_1"
      ? plans.filter((plan) => plan.menuNumber === 1)
      : preference === "MENU_2"
        ? plans.filter((plan) => plan.menuNumber === 2)
        : plans;

  if (elegidos.length === 0) {
    // La preferencia apunta a un menú que no existe (todavía). Antes que
    // dejar a alguien sin lista de súper, se cae a lo que sí hay.
    return plans[0] ? toGroceries(plans[0].groceryListJson) : [];
  }

  // Un solo menú se come los 7 días; dos se reparten la semana.
  const diasPorMenu = 7 / elegidos.length;

  const menus = elegidos.map((plan) => ({
    id: plan.menuNumber as 1 | 2,
    meals: (Array.isArray(plan.mealsJson) ? plan.mealsJson : []) as never,
  }));

  return listaDeSuper(menus as never, diasPorMenu, catalogoCon(extraFoods), pantry).map((item) => ({
    name: item.name,
    grams: item.grams,
    unit: item.unit,
    // Se compra en piezas cuando así se vende: "7 naranjas", no "1260 g".
    portion: porcionNatural(item.name, item.grams),
    ...(item.enDespensa === true ? { enDespensa: true } : {}),
  }));
}

/**
 * La decisión que rige el plan: la última publicada; si nada se publicó, la
 * última aprobada o corregida.
 *
 * Una sola regla para todos: antes "regenerar", la despensa y la leche
 * buscaban la última APROBADA mientras la pantalla leía la última publicada,
 * y con una decisión corregida cada uno rearmaba un menú distinto.
 */
export async function decisionVigente(
  userId: string,
): Promise<(Decision & { checkIn: { date: Date } | null }) | null> {
  return (
    (await prisma.decision.findFirst({
      where: { userId, publishedAt: { not: null } },
      orderBy: { publishedAt: "desc" },
      include: { checkIn: { select: { date: true } } },
    })) ??
    (await prisma.decision.findFirst({
      where: { userId, status: { in: ["APROBADA", "CORREGIDA"] } },
      orderBy: { checkIn: { date: "desc" } },
      include: { checkIn: { select: { date: true } } },
    }))
  );
}

export async function currentMealPlan(
  userId: string,
  profile: Profile,
): Promise<CurrentMealPlan | null> {
  const decision = await decisionVigente(userId);

  if (decision === null) return null;

  const existing = await mealPlansOf(decision.id);
  if (existing.length > 0 && !menusDesactualizados(existing)) {
    return { decision, plans: await rellenaEquivalenciasGuardadas(existing, profile), materialized: false };
  }

  const latest = await prisma.checkIn.findFirst({
    where: { userId, weightKg: { not: null } },
    orderBy: { date: "desc" },
    select: { weightKg: true },
  });
  const latestWeightKg =
    latest?.weightKg === null || latest?.weightKg === undefined ? null : Number(latest.weightKg);

  if (existing.length > 0) {
    // Menús de reglas viejas: se rehacen solos. Si algo falla, se ven los de
    // antes — mejor un menú viejo que una pantalla vacía.
    const plans = await actualizaMenusPorVersion(decision, profile, existing, latestWeightKg).catch(
      (error: unknown) => {
        console.error("[coachy] no se pudieron actualizar los menús a la versión nueva", error);
        return existing;
      },
    );
    return { decision, plans: await rellenaEquivalenciasGuardadas(plans, profile), materialized: false };
  }

  try {
    const plans = await ensureMealPlans(decision, profile, latestWeightKg);
    return { decision, plans, materialized: plans.length > 0 };
  } catch (error) {
    // Un perfil incompleto no puede tumbar el home: la tarjeta lo dice y ya.
    console.error("[coachy] no se pudo materializar el menú", error);
    return { decision, plans: [], materialized: false };
  }
}
