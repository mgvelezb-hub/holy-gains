/**
 * Tipos de la capa de IA de Coachy.
 *
 * Frontera clara: el motor (`packages/engine`) produce los números; esta capa
 * solo los redacta y hace preguntas. Nada de aquí puede cambiar kcal ni macros.
 */

import type { BloqueMensual } from "@/lib/coachy/mensual";
import type { EngineDecision, Phase } from "@/lib/engine-types";

/** Zonas que compara la visión. Coinciden con la spec 03 §2.2.2. */
export const PHOTO_ZONES = ["abdomen", "cintura", "espalda", "brazos", "piernas"] as const;
export type PhotoZone = (typeof PHOTO_ZONES)[number];

export const PHOTO_CHANGES = ["mejora", "igual", "retroceso", "no_comparable"] as const;
export type PhotoChange = (typeof PHOTO_CHANGES)[number];

/** Una fila del análisis de fotos. Solo cambio; jamás estética ni apariencia. */
export interface PhotoZoneReading {
  zona: PhotoZone;
  cambio: PhotoChange;
  nota_breve: string;
}

export interface VisionAnalysis {
  /** Semana N contra semana N−1. */
  vsPrevious: PhotoZoneReading[];
  /** Semana N contra el día 1. */
  vsBaseline: PhotoZoneReading[];
  /** Resumen que consume el motor como `photosTrend`. */
  trend: PhotoChange;
  model: string;
  analyzedAt: string;
}

/** Pregunta del banco (spec 03 §2.2.4). */
export interface CoachyQuestion {
  id: string;
  /** Señal que la dispara. Sirve para depurar por qué se preguntó. */
  signal: string;
  text: string;
}

/** Salida estructurada de `composeReply`. Orden de metodología §1. */
export interface CoachyReply {
  celebracion: string;
  preguntas: string[];
  comparacion: string;
  decision_texto: string;
  meta: string;
  cierre: string;
  /**
   * El mensual (`mensual.ts`): si este check-in lo es, sus deltas contra el
   * mes anterior y el inicio, la lectura de fotos contra la referencia y qué
   * va bien / qué ajustar. Viaja en `replyJson` porque no hay columna para
   * él — es parte de la respuesta de esa semana, no un dato nuevo del motor.
   * Opcional: las respuestas de antes de que existiera no lo traen.
   */
  mensual?: BloqueMensual;
  /**
   * La retro en tres partes que ve la app: qué va bien, qué hay que ajustar
   * y el plan de aquí en adelante. Opcional por lo mismo que `mensual`.
   */
  retro?: RetroCheckIn;
}

/** "Tu plan de aquí en adelante": una línea por pieza, escrita por nosotros. */
export interface PlanAdelante {
  macros: string;
  menu: string;
  rutina: string;
}

export interface RetroCheckIn {
  va_bien: string[];
  ajustar: string[];
  plan: PlanAdelante;
}

export interface FewShotExample {
  id: string;
  contexto: Record<string, unknown>;
  respuesta: string;
}

/** Señales legibles de la semana, ya resueltas fuera del prompt. */
export interface WeekSignals {
  fecha: string;
  cinturaCm: number | null;
  cinturaDeltaCm: number | null;
  cinturaDeltaDesdeInicioCm: number | null;
  pesoKg: number | null;
  pesoDeltaKg: number | null;
  inflamacion: number;
  energia: number;
  hambre: number;
  saciedad: number;
  sueno: number;
  fuerzaRpe: number | null;
  fuerzaTendencia: string | null;
  cumplimientoDieta: number;
  cumplimientoEntreno: number;
  sintomas: string[];
  faseCiclo: string | null;
  comentario: string | null;
  semanasEnFase: number;
  semanasSinProgreso: number;
  /**
   * La semana de entrenamiento tal como quedó: planeadas, cerradas y de esas
   * cuántas se recortaron por falta de tiempo.
   *
   * Existe para que la retro distinga "entrené menos" de "no entrené". Tres
   * semanas recortando los mismos días no es falta de disciplina: es que el
   * horario declarado no es el horario real, y la respuesta correcta es mover
   * el día, no pedir más ganas.
   */
  entrenamiento: {
    planeadas: number;
    completadas: number;
    recortadas: number;
  };
}

export interface ComposeInput {
  /** Nombre del perfil. Nunca se codifica un nombre en el prompt. */
  athleteName: string;
  weekLabel: string;
  phase: Phase;
  previousPhase: Phase;
  targets: EngineDecision["targets"];
  category: EngineDecision["category"];
  rules: Array<{ id: string; nombre: string; explicacion: string }>;
  engineExplanation: string;
  signals: WeekSignals;
  vision: VisionAnalysis | null;
  questions: CoachyQuestion[];
  menuRefresh: boolean;
  electrolyteProtocol: boolean;
  injuryTrainingProtocol: boolean;
  simplifyMenu: boolean;
  /** El bloque mensual (también en semanal: trae qué va bien / qué ajustar). */
  mensual?: BloqueMensual;
  /** El plan de aquí en adelante, ya escrito. Sin él no hay retro. */
  plan?: PlanAdelante;
}
