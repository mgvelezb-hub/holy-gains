import type { Menu } from "@/lib/api";
import type { PlanNutricion, VistaPreviaPlan } from "@/lib/api-nutricion";

/**
 * Las líneas de la pestaña Nutrición (K1) — lógica PURA.
 *
 * Todo sale de `planDeNutricion` en el servidor: aquí solo se dice en una
 * línea. Lo único que se decide en el teléfono es cuál es la PRÓXIMA comida,
 * porque depende del reloj de quien la mira.
 */

const FASES: Record<string, string> = {
  REINTRO: "Reintroducción",
  BASE: "Base",
  CUT: "Corte",
  CUT_AGRESIVO: "Corte fuerte",
  REFEED: "Recarga",
  ESTABILIZACION: "Estabilización",
  MANTENIMIENTO: "Mantenimiento",
};

const DIAS_NOMBRE: Record<string, string> = {
  LUN: "lunes",
  MAR: "martes",
  MIE: "miércoles",
  JUE: "jueves",
  VIE: "viernes",
  SAB: "sábado",
  DOM: "domingo",
};

export function faseLegible(phase: string): string {
  return FASES[phase] ?? phase.replace(/_/g, " ").toLowerCase();
}

/** "2500 kcal · Corte". */
export function lineaPlan(plan: PlanNutricion): string {
  return plan.decision ? `${plan.decision.kcal} kcal · ${faseLegible(plan.decision.phase)}` : "Sin plan publicado todavía";
}

function minutos(hora: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hora.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** "Cena 20:00 + magnesio": la siguiente comida de hoy, con sus tomas. */
export function lineaHoy(plan: PlanNutricion, ahora: Date = new Date()): string {
  const comidas = plan.hoy.comidas;
  if (comidas.length === 0) return "Sin comidas hoy";
  const actual = ahora.getHours() * 60 + ahora.getMinutes();
  const siguiente =
    comidas.find((comida) => (minutos(comida.hora) ?? -1) >= actual) ?? comidas[comidas.length - 1]!;
  const tomas = siguiente.tomas.length > 0 ? ` + ${siguiente.tomas.join(" + ")}` : "";
  return `${siguiente.label} ${siguiente.hora}${tomas}`;
}

/** "4 comidas · empieza 06:30", con la hora de hoy. */
export function lineaMenu(menu: Menu, plan: PlanNutricion): string {
  if (menu.meals.length === 0) return "Sin comidas";
  const primera = menu.meals[0]!;
  const hora = plan.horariosPorDia[plan.hoy.dia]?.[primera.slot] ?? primera.timeHint;
  const n = menu.meals.length;
  return `${n} ${n === 1 ? "comida" : "comidas"}${hora ? ` · empieza ${hora}` : ""}`;
}

/** "32 artículos · 7 ya los tienes". */
export function lineaSuper(plan: PlanNutricion): string {
  const total = plan.groceries.length;
  if (total === 0) return "Sin artículos todavía";
  const enCasa = plan.groceries.filter((item) => item.enDespensa).length;
  const articulos = `${total} ${total === 1 ? "artículo" : "artículos"}`;
  if (enCasa === 0) return articulos;
  return `${articulos} · ${enCasa} ${enCasa === 1 ? "ya lo tienes" : "ya los tienes"}`;
}

/** La línea de tomas de hoy; con freno, la pausa. */
export function lineaSuplementos(plan: PlanNutricion): string {
  if (plan.freno) {
    const n = plan.tomasPausadas;
    return n > 0
      ? `En pausa: ${n} ${n === 1 ? "toma" : "tomas"} hasta que lo veas con tu médico`
      : "En pausa hasta que lo veas con tu médico";
  }
  return plan.resumenTomas.total > 0 ? plan.resumenTomas.linea : "Sin tomas";
}

/** "Propios · sábado distinto" / "Propios" / "Los del motor". */
export function lineaHorarios(plan: PlanNutricion): string {
  const dias = Object.entries(plan.horariosPorDia);
  const lunes = JSON.stringify(plan.horariosPorDia.LUN ?? {});
  const distintos = dias.filter(([, horas]) => JSON.stringify(horas) !== lunes).map(([dia]) => DIAS_NOMBRE[dia] ?? dia);
  const propios = Object.keys(plan.horarios).length > 0 || distintos.length > 0;
  if (!propios) return "Los del motor";
  if (distintos.length === 0) return "Propios";
  return `Propios · ${distintos.join(", ")} ${distintos.length === 1 ? "distinto" : "distintos"}`;
}

/** "2585 kcal · P 210 · C 290 · G 65 · fibra 35 g". */
export function lineaPrevia(previa: VistaPreviaPlan): string {
  const { kcal, proteinG, carbsG, fatG, fiberG } = previa.macros;
  const fibra = fiberG !== null ? ` · fibra ${fiberG} g` : "";
  return `${kcal} kcal · P ${proteinG} · C ${carbsG} · G ${fatG}${fibra}`;
}
