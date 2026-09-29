import "server-only";

import type { DietStyle, Profile } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import {
  DEFAULT_CONFIG,
  distribute,
  generateMenu,
  kcalForDeficit,
  macrosFor,
  pautasDeSuplementos,
  pickDeficit,
  resumenTomas,
  tdee,
  tomasDeHoy,
  type MealSlotId,
  type Sugerencia,
  type TomaDelDia,
} from "engine";

import { tipoLecheDe } from "@/lib/coachy/leche";
import { engineConfigForActivity, parsePantry } from "@/lib/coachy/mapping";
import { currentMealPlan, decisionVigente, listaDeSuperDe, seedFromDate } from "@/lib/coachy/menu";
import { toMenuView, type GroceryItemView, type MenuView } from "@/lib/coachy/menu-view";
import { DIAS_SEMANA, parseMealTimes, parseMealTimesByDay, type DiaSemana } from "@/lib/coachy/horarios";
import { perfilDelMotor } from "@/lib/coachy/perfil-motor";
import {
  avisosDelPlan,
  despensaDelPlan,
  horariosEfectivos,
  porqueDelPlan,
  recordatoriosDelPlan,
  tomasDelPlan,
  type AvisoDelPlan,
  type DespensaDelPlan,
  type RecordatorioDelPlan,
  type SenalesClinicas,
} from "@/lib/coachy/plan-nutricion-reglas";
import { preferenciaDePreparaciones } from "@/lib/coachy/preparaciones";
import { avisoDeMenuActualizado } from "@/lib/coachy/version-menu";
import type { EngineDecision, EngineProfile } from "@/lib/engine-types";
import { decimalToNumber, shiftISODate, toISODate } from "@/lib/format";
import { activityWindow } from "@/lib/health/db";
import { prisma } from "@/lib/prisma";
import { sugerenciasPara, tomasPara } from "@/lib/suplementos/db";

/**
 * El plan de nutrición, una sola verdad (K1).
 *
 * Todo lo que se construyó por partes —fase y macros del motor, estilo de
 * dieta, presupuesto, tiempo de cocina, favoritos y excluidos, despensa,
 * alimentos propios, preparaciones, leche, suplementos, horarios por día,
 * estudios con su freno— se lee AQUÍ y sale ya cruzado. La pestaña
 * Nutrición, la hoja del plan, los menús, la lista de súper, "Mis comidas
 * hoy", las tomas del día y los recordatorios leen de este objeto; ninguna
 * pantalla vuelve a cruzar dos fuentes por su cuenta.
 *
 * Los menús se materializan con `currentMealPlan` (que arma el perfil con
 * `perfilDelMotor`, igual que el check-in y "regenerar"): este módulo no
 * genera menús propios salvo en la vista previa, que no escribe nada.
 */

const ESTILOS: Record<DietStyle, { nombre: string; detalle: string }> = {
  ESTANDAR: {
    nombre: "Estándar por equivalencias",
    detalle: "Comida normal repartida en tus comidas, con intercambios por alimento.",
  },
  AYUNO: {
    nombre: "Ayuno intermitente",
    detalle: "Las mismas comidas, comprimidas en tu ventana de alimentación.",
  },
  VEGETARIANA: {
    nombre: "Vegetariana",
    detalle: "Sin carne, pollo ni pescado; huevo y lácteos se quedan.",
  },
  KETO: {
    nombre: "Keto",
    detalle: "Carbohidrato con tope; lo que sobra de calorías va a grasa.",
  },
  MENU_FIJO: {
    nombre: "Menú fijo",
    detalle: "Un solo menú para los siete días.",
  },
};

export interface MacrosDelPlan {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number | null;
}

export interface PlanDeNutricion {
  decision: ({ id: string; phase: string } & MacrosDelPlan) | null;
  /** "Corte: −500 kcal para bajar ≈0.5 kg/semana; proteína alta (210 g) para conservar músculo." */
  porque: string | null;
  estilo: { valor: DietStyle; nombre: string; detalle: string };
  preferencias: {
    comidas: number;
    presupuesto: Profile["budget"];
    maxPrepMin: number | null;
    leche: string;
    preparaciones: { licuados: boolean; sopas: boolean; cremas: boolean };
  };
  menus: MenuView[];
  menuPreference: string;
  /** El menú que se come hoy (el 1, salvo que cocine solo el 2). */
  menuDeHoy: number;
  groceries: GroceryItemView[];
  despensa: DespensaDelPlan;
  tomas: TomaDelDia[];
  /** Cuántas tomas quedaron en pausa por el freno clínico. */
  tomasPausadas: number;
  resumenTomas: { hechas: number; total: number; linea: string };
  sugerencias: Sugerencia[];
  freno: string | null;
  notasSuplementos: string[];
  /** Los horarios propios generales (lo que ya existía). */
  horarios: Record<string, string>;
  /** La hora que rige cada comida cada día. */
  horariosPorDia: Record<DiaSemana, Record<string, string>>;
  hoy: {
    fecha: string;
    dia: DiaSemana;
    comidas: Array<{ slot: string; label: string; hora: string; resumen: string; tomas: string[] }>;
  };
  recordatorios: RecordatorioDelPlan[];
  avisos: AvisoDelPlan[];
  senales: SenalesClinicas;
  materialized: boolean;
  /**
   * "Tu menú se actualizó con las reglas nuevas" mientras los menús vigentes
   * sean los que se rehicieron solos al subir `MENU_ENGINE_VERSION`
   * (`actualizaMenusPorVersion`); `null` si no. La app lo muestra una vez.
   */
  aviso: string | null;
}

/** `LUN`..`DOM` de una fecha ISO. */
export function diaDeSemana(iso: string): DiaSemana {
  const getDay = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return DIAS_SEMANA[(getDay + 6) % 7]!;
}

async function pesoReciente(userId: string, profile: Profile): Promise<number | null> {
  const ultimo = await prisma.checkIn.findFirst({
    where: { userId, weightKg: { not: null } },
    orderBy: { date: "desc" },
    select: { weightKg: true },
  });
  return decimalToNumber(ultimo?.weightKg ?? null) ?? decimalToNumber(profile.weightKg);
}

/** El gasto del día con el PAL del reloj si hay dos semanas de pasos (como la decisión). */
async function gastoDe(userId: string, perfil: EngineProfile): Promise<number> {
  const ventana = await activityWindow(userId).catch(() => null);
  return tdee(perfil, engineConfigForActivity(ventana)?.config ?? DEFAULT_CONFIG);
}

function idsDe(mealsJson: Prisma.JsonValue): string[] {
  if (!Array.isArray(mealsJson)) return [];
  return mealsJson.flatMap((meal) => {
    const items = (meal as { items?: unknown }).items;
    return Array.isArray(items)
      ? items.map((item) => String((item as { foodId?: unknown }).foodId ?? "")).filter(Boolean)
      : [];
  });
}

function resumenDeComida(items: Array<{ name: string; display: string | null }>): string {
  return items
    .slice(0, 3)
    .map((item) => item.display ?? item.name)
    .join(" · ");
}

function preferenciasDe(profile: Profile): PlanDeNutricion["preferencias"] {
  return {
    comidas: profile.mealsPerDay,
    presupuesto: profile.budget,
    maxPrepMin: profile.maxPrepMin,
    leche: tipoLecheDe(profile.excludedFoods),
    preparaciones: preferenciaDePreparaciones(profile.excludedFoods),
  };
}

/**
 * El plan vigente de la semana que empieza en `weekStart` (lunes ISO; por
 * defecto la de hoy). "Hoy" —las tomas, la próxima comida— es hoy si cae en
 * esa semana, y su lunes si no.
 */
export async function planDeNutricion(
  userId: string,
  weekStart?: string | null,
  opciones: { profile?: Profile; hoy?: string } = {},
): Promise<PlanDeNutricion> {
  const profile = opciones.profile ?? (await prisma.profile.findUniqueOrThrow({ where: { userId } }));
  const hoyReal = opciones.hoy ?? toISODate(new Date());
  const hoy =
    weekStart && (hoyReal < weekStart || hoyReal > shiftISODate(weekStart, 6)) ? weekStart : hoyReal;
  const dia = diaDeSemana(hoy);

  const [actual, pesoKg] = await Promise.all([
    currentMealPlan(userId, profile).catch((error: unknown) => {
      console.error("[coachy] no se pudo cargar el plan de nutrición", error);
      return null;
    }),
    pesoReciente(userId, profile),
  ]);

  // El mismo perfil que armó el menú: aquí solo se lee para el porqué, las
  // señales y los avisos. Un perfil incompleto deja el plan sin porqué, no
  // sin pantalla.
  const motor = await perfilDelMotor(userId, profile, { latestWeightKg: pesoKg, hoy }).catch(() => null);

  const generales = parseMealTimes(profile.mealTimes);
  const porDiaPropios = parseMealTimesByDay(profile.mealTimesByDay);
  const plans = actual?.plans ?? [];
  const menus = plans.map((plan) => toMenuView(plan.menuNumber, plan.mealsJson, generales));
  const menuDeHoy = profile.menuPreference === "MENU_2" && menus.some((m) => m.menuNumber === 2) ? 2 : 1;
  const menuHoy = menus.find((m) => m.menuNumber === menuDeHoy) ?? menus[0] ?? null;
  const horariosPorDia = horariosEfectivos(menuHoy?.meals ?? [], generales, porDiaPropios);

  const pantry = parsePantry(profile.pantry);
  const groceries = actual
    ? listaDeSuperDe(plans, profile.menuPreference, pantry, motor?.extraFoods ?? [])
    : [];
  const despensa = despensaDelPlan(pantry, plans.map((plan) => idsDe(plan.mealsJson)), groceries);

  const slotsHoy = (menuHoy?.meals ?? []).map((meal) => meal.slot as MealSlotId);
  const [pauta, sugerencias] = await Promise.all([
    tomasPara(userId, profile, hoy, slotsHoy.length > 0 ? slotsHoy : undefined),
    sugerenciasPara(userId, profile, { hoy }).catch(() => ({ freno: null, sugerencias: [], notas: [] })),
  ]);
  const { tomas, pausadas } = tomasDelPlan(pauta.tomas, sugerencias.freno);
  const resumen = resumenTomas(tomas);

  const decision = actual?.decision ?? null;
  const porque =
    decision && motor
      ? porqueDelPlan({
          phase: decision.phase,
          kcal: decision.kcal,
          gastoKcal: await gastoDe(userId, motor.engineProfile),
          proteinG: decision.proteinG,
        })
      : null;

  const senales = motor?.senales ?? { glucosaAyuno: null, vitaminaD: null };
  const avisos = avisosDelPlan({
    freno: sugerencias.freno,
    tomasPausadas: pausadas,
    senales,
    glucosaAlta: motor?.engineProfile.conditions?.glucosaAlta === true,
    fibraG: decision?.fiberG ?? null,
    sugiereD3: sugerencias.sugerencias.some((s) => s.supplement === "VITAMINA_D3"),
    despensa,
  });

  const horasHoy = horariosPorDia[dia];

  return {
    decision: decision
      ? {
          id: decision.id,
          phase: decision.phase,
          kcal: decision.kcal,
          proteinG: decision.proteinG,
          carbsG: decision.carbsG,
          fatG: decision.fatG,
          fiberG: decision.fiberG,
        }
      : null,
    porque,
    estilo: { valor: profile.dietStyle, ...ESTILOS[profile.dietStyle] },
    preferencias: preferenciasDe(profile),
    menus,
    menuPreference: profile.menuPreference,
    menuDeHoy,
    groceries,
    despensa,
    tomas,
    tomasPausadas: pausadas,
    resumenTomas: { hechas: resumen.hechas, total: resumen.total, linea: resumen.linea },
    sugerencias: sugerencias.sugerencias,
    freno: sugerencias.freno,
    notasSuplementos: sugerencias.notas,
    horarios: generales,
    horariosPorDia,
    hoy: {
      fecha: hoy,
      dia,
      comidas: (menuHoy?.meals ?? []).map((meal) => ({
        slot: meal.slot,
        label: meal.label,
        hora: horasHoy[meal.slot] ?? meal.timeHint,
        resumen: resumenDeComida(meal.items),
        tomas: tomas.filter((toma) => toma.slot === meal.slot).map((toma) => toma.corto),
      })),
    },
    recordatorios: menuHoy ? recordatoriosDelPlan(menuHoy.menuNumber, menuHoy.meals, tomas, horariosPorDia) : [],
    avisos,
    senales,
    materialized: actual?.materialized ?? false,
    aviso: avisoDeMenuActualizado(plans),
  };
}

// ---------------------------------------------------------------------------
// Vista previa del replanteo: lo mismo, sin escribir
// ---------------------------------------------------------------------------

export interface VistaPreviaDelPlan {
  fase: string;
  macros: MacrosDelPlan;
  /** Los macros cambian respecto a la decisión vigente (keto, glucosa, comidas). */
  cambiaMacros: boolean;
  porque: string;
  estilo: { valor: DietStyle; nombre: string };
  /** Un día del menú 1, en medidas caseras. */
  diaMuestra: Array<{ slot: string; label: string; hora: string; items: string[] }>;
  despensa: DespensaDelPlan;
  tomas: Array<{ corto: string; cuando: string; slot: string | null }>;
  tomasPausadas: number;
  avisos: AvisoDelPlan[];
  /** Cuándo entra lo que se ve. */
  cuando: string;
}

/**
 * Lo que saldría con estas respuestas, sin guardar nada: los macros del motor
 * con este perfil en la fase vigente, un día de muestra, cuánto de la
 * despensa entra, las tomas del día y los avisos.
 *
 * Mismos ingredientes que `planDeNutricion` y que los menús de verdad
 * (`perfilDelMotor`, la semilla de la decisión vigente): lo que se ve aquí es
 * lo que sale al rearmar.
 */
export async function vistaPreviaDelPlan(userId: string, perfil: Profile): Promise<VistaPreviaDelPlan> {
  const hoy = toISODate(new Date());
  const [vigente, pesoKg] = await Promise.all([decisionVigente(userId), pesoReciente(userId, perfil)]);
  const { engineProfile, extraFoods, senales } = await perfilDelMotor(userId, perfil, { latestWeightKg: pesoKg, hoy });

  const fase = (vigente?.phase ?? perfil.currentPhase) as EngineDecision["phase"];
  const kcal = vigente?.kcal ?? Math.round(kcalForDeficit(engineProfile, pickDeficit(fase, DEFAULT_CONFIG), DEFAULT_CONFIG));

  // Los macros que daría el motor con ESTE perfil a las calorías vigentes.
  // Si el perfil nuevo no cabe (piso de calorías), se quedan los vigentes.
  let objetivo = vigente
    ? { kcal: vigente.kcal, proteinG: vigente.proteinG, carbG: vigente.carbsG, fatG: vigente.fatG, fiberG: vigente.fiberG ?? 25 }
    : null;
  try {
    objetivo = macrosFor(fase, engineProfile, kcal, DEFAULT_CONFIG);
  } catch {
    // Se queda con los de la decisión.
  }
  if (!objetivo) objetivo = macrosFor(fase, engineProfile, Math.max(kcal, 1200), DEFAULT_CONFIG);

  const slots = distribute(objetivo, engineProfile, fase);
  const semilla = vigente?.menuSeed ?? seedFromDate(vigente?.checkIn?.date ?? new Date());
  const plan = generateMenu(slots, engineProfile, undefined, semilla, { phase: fase, extraFoods });
  const menu1 = plan.menus[0];

  const generales = parseMealTimes(perfil.mealTimes);
  const porDia = parseMealTimesByDay(perfil.mealTimesByDay);
  const vista = toMenuView(1, (menu1?.meals ?? []) as unknown as Prisma.JsonValue, generales);
  const horas = horariosEfectivos(vista.meals, generales, porDia)[diaDeSemana(hoy)];

  const pantry = parsePantry(perfil.pantry);
  const despensa = despensaDelPlan(
    pantry,
    plan.menus.map((menu) => menu.meals.flatMap((meal) => meal.items.map((item) => item.foodId))),
    plan.shoppingList.map((item) => ({ name: item.name, grams: item.grams, unit: item.unit, ...(item.enDespensa ? { enDespensa: true } : {}) })),
  );

  const pautas = pautasDeSuplementos({ profile: engineProfile, macros: objetivo, phase: fase });
  const todas = tomasDeHoy({ pautas, slots: vista.meals.map((meal) => meal.slot as MealSlotId), logs: [] });
  const sugerencias = await sugerenciasPara(userId, perfil, { hoy }).catch(() => ({ freno: null, sugerencias: [], notas: [] }));
  const { tomas, pausadas } = tomasDelPlan(todas, sugerencias.freno);

  const macros: MacrosDelPlan = {
    kcal: objetivo.kcal,
    proteinG: objetivo.proteinG,
    carbsG: objetivo.carbG,
    fatG: objetivo.fatG,
    fiberG: objetivo.fiberG,
  };

  return {
    fase,
    macros,
    cambiaMacros: vigente
      ? vigente.proteinG !== macros.proteinG || vigente.carbsG !== macros.carbsG || vigente.fatG !== macros.fatG
      : true,
    porque: porqueDelPlan({
      phase: fase,
      kcal: macros.kcal,
      gastoKcal: await gastoDe(userId, engineProfile),
      proteinG: macros.proteinG,
    }),
    estilo: { valor: perfil.dietStyle, nombre: ESTILOS[perfil.dietStyle].nombre },
    diaMuestra: vista.meals.map((meal) => ({
      slot: meal.slot,
      label: meal.label,
      hora: horas[meal.slot] ?? meal.timeHint,
      items: meal.items.map((item) => item.display ?? item.portion ?? `${item.grams} g de ${item.name}`),
    })),
    despensa,
    tomas: tomas.map((toma) => ({ corto: toma.corto, cuando: toma.cuando, slot: toma.slot })),
    tomasPausadas: pausadas,
    avisos: avisosDelPlan({
      freno: sugerencias.freno,
      tomasPausadas: pausadas,
      senales,
      glucosaAlta: engineProfile.conditions?.glucosaAlta === true,
      fibraG: macros.fiberG,
      sugiereD3: sugerencias.sugerencias.some((s) => s.supplement === "VITAMINA_D3"),
      despensa,
    }),
    cuando: vigente
      ? "Al guardar puedes rearmar tu menú ya; las calorías se ajustan con tu siguiente check-in."
      : "Entra con tu primer check-in.",
  };
}
