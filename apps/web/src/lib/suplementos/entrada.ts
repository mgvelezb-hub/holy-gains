import type { DietStyle, Goal, Phase as PrismaPhase, TrainingTime } from "@prisma/client";
import {
  esSuplemento,
  parseElecciones,
  type CheckInSenal,
  type DiaSalud,
  type EntradaSugerencias,
  type ResultadoSugerencias,
  type Sugerencia,
  type ValorLab,
} from "engine";

/**
 * Traducción de las filas de la base a la entrada de `sugerirSuplementos`.
 *
 * Funciones puras: el caller (`db.ts`) trae las filas y aquí solo se aplanan.
 * Así la regla que decide qué datos cuentan —dos check-ins, catorce días de
 * reloj, químicas del último año— se prueba sin base.
 */

export interface PerfilParaSugerencias {
  goal: Goal;
  currentPhase: PrismaPhase;
  dietStyle: DietStyle;
  liftingDays: number;
  cardioMinWk: number;
  trainingTime: TrainingTime;
  conditions: string[];
  supplements: string[];
  supplementChoices: unknown;
}

export interface FilasParaSugerencias {
  hoy: string;
  perfil: PerfilParaSugerencias;
  pesoKg: number;
  /** Fase y macros de la decisión vigente; si no hay, manda el perfil. */
  decision: { phase: PrismaPhase; kcal: number; proteinG: number } | null;
  checkIns: Array<{
    date: string;
    energy: number;
    hunger: number;
    satiety: number | null;
    sleep: number | null;
    symptoms: string[];
  }>;
  healthDays: DiaSalud[];
  /** `valuesJson` de cada estudio QUIMICA, con su fecha. */
  labs: Array<{ takenOn: string; valuesJson: unknown }>;
  /** Minutos de las sesiones de cardio de las últimas dos semanas. */
  cardioSesionesMin: number[];
}

const DIETA: Record<DietStyle, NonNullable<EntradaSugerencias["dieta"]>> = {
  ESTANDAR: "estandar",
  AYUNO: "ayuno",
  VEGETARIANA: "vegetariana",
  KETO: "keto",
  MENU_FIJO: "menu_fijo",
};

function valoresDeLab(takenOn: string, valuesJson: unknown): ValorLab[] {
  if (!Array.isArray(valuesJson)) return [];
  const valores: ValorLab[] = [];
  for (const crudo of valuesJson) {
    if (typeof crudo !== "object" || crudo === null) continue;
    const fila = crudo as Record<string, unknown>;
    if (typeof fila.key !== "string" || typeof fila.value !== "number") continue;
    valores.push({
      takenOn,
      key: fila.key,
      value: fila.value,
      refLow: typeof fila.refLow === "number" ? fila.refLow : null,
      refHigh: typeof fila.refHigh === "number" ? fila.refHigh : null,
    });
  }
  return valores;
}

export function entradaDeSugerencias(filas: FilasParaSugerencias): EntradaSugerencias {
  const { perfil, decision } = filas;
  const { elecciones, quiereInfusiones } = parseElecciones(perfil.supplementChoices);
  const checkIns: CheckInSenal[] = filas.checkIns.map((c) => ({
    date: c.date,
    energy: c.energy,
    hunger: c.hunger,
    satiety: c.satiety,
    sleep: c.sleep,
    symptoms: c.symptoms,
  }));

  return {
    hoy: filas.hoy,
    objetivo: perfil.goal,
    fase: decision?.phase ?? perfil.currentPhase,
    dieta: DIETA[perfil.dietStyle],
    pesoKg: filas.pesoKg,
    diasFuerza: perfil.liftingDays,
    cardioMinSemana: perfil.cardioMinWk,
    sesionCardioMaxMin: filas.cardioSesionesMin.length > 0 ? Math.max(...filas.cardioSesionesMin) : null,
    // Mediodía cuenta como mañana: antes de las 14:00 la cafeína aún se va.
    entrenaTemprano: perfil.trainingTime === "MANANA" || perfil.trainingTime === "MEDIODIA",
    ...(decision ? { proteinaObjetivoG: decision.proteinG, kcalObjetivo: decision.kcal } : {}),
    condiciones: perfil.conditions,
    suplementos: perfil.supplements.filter(esSuplemento),
    elecciones,
    quiereInfusiones,
    checkIns,
    healthDays: filas.healthDays,
    labs: filas.labs.flatMap((lab) => valoresDeLab(lab.takenOn, lab.valuesJson)),
  };
}

/**
 * Las líneas para "Hay que ajustar". Las escribe el código, no el modelo: la
 * dosis y el motivo salen del motor y la redacción de Claude no los toca.
 */
export function lineasParaAjustar(resultado: ResultadoSugerencias): string[] {
  return resultado.sugerencias.map((s: Sugerencia) => {
    const tipo = s.categoria === "INFUSION" ? "Infusión sugerida" : "Suplemento sugerido";
    return `${tipo}: ${s.nombre.toLowerCase()} — ${s.motivo} Decide en Ajustes → Suplementos.`;
  });
}

/** Los tres que las pantallas viejas (alacena, replantear) saben editar. */
export const NUCLEO = ["WHEY", "CREATINA", "OMEGA3"] as const;

/**
 * La lista de suplementos tras un guardado que solo conoce el núcleo.
 *
 * Replantear y la alacena mandan la lista de tres completa; si se guardara
 * tal cual, borraría el magnesio que la persona aceptó ayer. Lo que no es del
 * núcleo se conserva; el núcleo queda como llegó.
 */
export function conNucleo(actuales: readonly string[], nucleo: readonly string[]): string[] {
  const esNucleo = (valor: string) => (NUCLEO as readonly string[]).includes(valor);
  return [...new Set([...nucleo.filter(esNucleo), ...actuales.filter((valor) => !esNucleo(valor))])];
}
