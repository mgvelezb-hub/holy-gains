import { fallbackDecisionText } from "@/lib/coachy/compose";
import type { CoachyReply, ComposeInput, PlanAdelante, RetroCheckIn } from "@/lib/coachy/types";
import type { EngineDecision } from "@/lib/engine-types";
import type { MuscleGroup } from "@/lib/training/types";

/**
 * La retro del check-in en tres partes — "Va bien", "Hay que ajustar" y "Tu
 * plan de aquí en adelante" — y la respuesta completa cuando no hay Claude.
 *
 * El plan siempre lo escribimos nosotros: lleva kcal y gramos, y la regla de
 * `compose.ts` es que el modelo cita los números del motor pero nunca los
 * escribe. Claude redacta "va bien" y "ajustar"; si no está, salen de
 * `mensual.ts#valoraAvance`.
 */

const GRUPO: Record<MuscleGroup, string> = {
  PIERNA: "pierna",
  HOMBRO: "hombro",
  PECHO: "pecho",
  ESPALDA: "espalda",
  BICEP: "bíceps",
  TRICEP: "tríceps",
  ABDOMEN: "abdomen",
};

function enumera(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
}

export interface LineasDelPlanInput {
  targets: EngineDecision["targets"];
  /** kcal de la decisión anterior; `null` en la primera. */
  previousKcal: number | null;
  /** El menú de esta decisión trae alimentos distintos a los de la anterior. */
  menuNuevo: boolean;
  esMensual: boolean;
  /** `null` si la rutina no se pudo rearmar. */
  rutina: { sesiones: number; prioridad: MuscleGroup[] } | null;
}

export function lineasDelPlan(input: LineasDelPlanInput): PlanAdelante {
  const { kcal, proteinG, carbG, fatG } = input.targets;
  const cambio =
    input.previousKcal === null
      ? ""
      : input.previousKcal === kcal
        ? " (sin cambio)"
        : ` (antes ${input.previousKcal} kcal)`;

  const macros = `${kcal} kcal · ${proteinG} g de proteína · ${carbG} g de carbohidratos · ${fatG} g de grasa${cambio}.`;

  let menu = "Mismo menú: lo que ya te funciona se queda.";
  if (input.menuNuevo && input.esMensual) menu = "Menú nuevo desde hoy: toca mes nuevo, alimentos distintos.";
  else if (input.menuNuevo) menu = "Menú nuevo desde hoy.";

  let rutina = "Tu rutina se rearma en cuanto abras Rutinas.";
  if (input.rutina) {
    const prioridad = [...new Set(input.rutina.prioridad.map((grupo) => GRUPO[grupo]))];
    const sesiones = `${input.rutina.sesiones} ${input.rutina.sesiones === 1 ? "sesión" : "sesiones"}`;
    rutina = `Rutina rearmada: ${sesiones} de hoy al próximo domingo${
      prioridad.length > 0 ? `, con prioridad en ${enumera(prioridad)}` : ""
    }.`;
  }

  return { macros, menu, rutina };
}

/** La retro sin Claude: "va bien" y "ajustar" del bloque mensual, plan tal cual. */
export function retroDeterminista(input: ComposeInput): RetroCheckIn | undefined {
  if (!input.plan) return undefined;
  return {
    va_bien: input.mensual?.objetivo.vaBien ?? [],
    ajustar: input.mensual?.objetivo.ajustar ?? [],
    plan: input.plan,
  };
}

function cmConSigno(valor: number): string {
  const signo = valor > 0 ? "+" : valor < 0 ? "−" : "";
  return `${signo}${Math.abs(valor)} cm`;
}

function comparacionDeterminista(input: ComposeInput): string {
  const { cinturaCm, cinturaDeltaCm, cinturaDeltaDesdeInicioCm } = input.signals;
  if (cinturaCm === null) return "Esta semana no hubo cintura con qué comparar.";

  const partes: string[] = [];
  if (cinturaDeltaCm !== null) partes.push(`${cmConSigno(cinturaDeltaCm)} contra la semana pasada`);
  if (cinturaDeltaDesdeInicioCm !== null) partes.push(`${cmConSigno(cinturaDeltaDesdeInicioCm)} desde el inicio`);

  return partes.length > 0
    ? `Cintura en ${cinturaCm} cm: ${partes.join(" y ")}.`
    : `Cintura en ${cinturaCm} cm: es tu primera medida, desde aquí se compara.`;
}

/**
 * La respuesta completa sin Claude (sin llave, o si la redacción falla).
 *
 * Mismo contrato que `composeReply`: los seis campos de la metodología más la
 * retro. Un perfil guiado por IA no puede quedarse sin retroalimentación
 * porque no haya modelo: la retro es lo que se prometió al enviar.
 */
export function respuestaDeterminista(input: ComposeInput): CoachyReply {
  const retro = retroDeterminista(input);

  return {
    celebracion: retro?.va_bien[0] ?? "Check-in recibido y revisado.",
    preguntas: input.questions.map((question) => question.text),
    comparacion: comparacionDeterminista(input),
    decision_texto: fallbackDecisionText(input),
    meta: "Esta semana: el plan completo y tus comidas registradas.",
    cierre: "Vamos con todo.",
    ...(retro ? { retro } : {}),
  };
}
