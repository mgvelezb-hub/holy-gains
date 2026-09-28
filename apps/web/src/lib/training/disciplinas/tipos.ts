import type { Discipline } from "@/lib/training/types";

/**
 * El molde común de una sesión de disciplina — tipos PUROS.
 *
 * Natación fue la primera y sirvió de plantilla; esto es esa plantilla hecha
 * contrato, para que squash, box, funcional, running y CrossFit se escriban
 * igual y la app las pinte con la misma pantalla. Sin esto, cada disciplina
 * traería su propia forma y la app terminaría con seis pantallas que dicen lo
 * mismo de seis maneras.
 *
 * Tres decisiones que valen para todas:
 *
 * - **La carga se dice en la unidad de la disciplina.** Metros para nadar,
 *   rondas para CrossFit, asaltos para box, minutos para correr. Traducirlo
 *   todo a "series y reps" fue lo que hizo que el registro de pesas no supiera
 *   guardar una sesión de alberca.
 * - **El esfuerzo va como sensación, no como porcentaje.** Un "80 % del
 *   máximo" solo significa algo cuando existe un máximo medido, y en estas
 *   disciplinas casi nunca existe. "Firme", "fuerte", "de conversación" es lo
 *   que un entrenador dice en la orilla.
 * - **El nivel se declara, no se infiere.** El reloj sabe cuánto duró tu
 *   sesión; no sabe si sabes caer de una caja o respirar de tres. Prescribir
 *   por encima del nivel real es como se lesiona la gente.
 */

export const NIVELES = ["PRINCIPIANTE", "INTERMEDIO", "AVANZADO"] as const;
export type NivelDisciplina = (typeof NIVELES)[number];

/** Los objetivos del perfil, tal como los conoce el motor de nutrición. */
export const OBJETIVOS = [
  "RECOMPOSICION",
  "PERDIDA_GRASA",
  "GANANCIA_MUSCULO",
  "SALUD",
  "RENDIMIENTO",
] as const;
export type ObjetivoAtleta = (typeof OBJETIVOS)[number];

/** Un bloque de la sesión: calentamiento, técnica, principal, vuelta a la calma. */
export type BloqueSesion = {
  title: string;
  /** Cómo se lee la serie: "4 × 50 m", "3 rondas de 12", "6 × 2 min". */
  detail: string;
  /**
   * La carga del bloque en la unidad de la disciplina, para poder sumarla.
   * `null` cuando el bloque no se mide así (técnica libre, movilidad).
   */
  carga: number | null;
  /** Descanso entre repeticiones, en segundos. `null` = continuo. */
  restSeconds: number | null;
  /** Qué se busca, en una línea. */
  note: string;
};

export type SesionDisciplina = {
  discipline: Discipline;
  nivel: NivelDisciplina;
  /** "Resistencia", "Técnica y velocidad", "Fuerza-resistencia"... */
  focus: string;
  /** Cómo se llama la unidad de carga: "m", "rondas", "asaltos", "min". */
  unidad: string;
  /** La suma de la carga de los bloques. */
  cargaTotal: number;
  minutes: number;
  blocks: BloqueSesion[];
  /** Semana de descarga del ciclo. */
  deload: boolean;
  notes: string[];
  /**
   * Solo el cardio en máquina (`disciplinas/cardio.ts`): máquina, tipo, nivel
   * sugerido y, si es HIIT, los intervalos que corre el timer de la sesión en
   * vivo.
   */
  cardio?: DetalleCardio;
};

export type DetalleCardio = {
  equipo: "CAMINADORA" | "ESCALERA" | "BICI" | "ELIPTICA" | "LIBRE";
  tipo: "HIIT" | "CONTINUO";
  /** El nivel de la máquina del bloque principal (el "fuerte" en HIIT). */
  nivelMaquina: number;
  /** "Cardio HIIT caminadora". */
  etiqueta: string;
  intervalos: {
    rondas: number;
    fuerteSeg: number;
    suaveSeg: number;
    nivelFuerte: number;
    nivelSuave: number;
  } | null;
  calentamientoSeg: number;
  enfriamientoSeg: number;
};

export type PrescripcionInput = {
  nivel: NivelDisciplina;
  /** Semana ISO: de ahí sale la progresión y la descarga. */
  isoWeek: number;
  /** Qué sesión de esa disciplina es en la semana (1ª, 2ª...). */
  ordinal: number;
  minutes: number;
  /** El objetivo del perfil. Modula volumen e intensidad, no la técnica. */
  objetivo: ObjetivoAtleta;
};

/** Lo que cada disciplina tiene que saber hacer. */
export type Prescriptor = {
  discipline: Discipline;
  /** Nombre en la app. */
  nombre: string;
  /** Los niveles que maneja, con qué significa cada uno. */
  niveles: Array<{ nivel: NivelDisciplina; descripcion: string }>;
  sesion: (input: PrescripcionInput) => SesionDisciplina;
};

/**
 * Cómo mueve el objetivo el volumen de una sesión.
 *
 * No cambia la técnica ni la estructura —un principiante hace lo mismo con
 * cualquier objetivo—, cambia cuánto. Quien busca músculo hace menos trabajo
 * de resistencia porque compite con la fuerza; quien busca perder grasa hace
 * más, porque ahí el gasto sí ayuda.
 *
 * Los factores son deliberadamente suaves: ±15 % es lo que se puede sostener
 * sin que la sesión deje de parecerse a la que la disciplina pide.
 */
export const FACTOR_POR_OBJETIVO: Record<ObjetivoAtleta, number> = {
  PERDIDA_GRASA: 1.15,
  RECOMPOSICION: 1,
  GANANCIA_MUSCULO: 0.85,
  SALUD: 0.9,
  RENDIMIENTO: 1.1,
};

/** La nota que explica ese ajuste, cuando lo hay. */
export function notaDeObjetivo(objetivo: ObjetivoAtleta): string | null {
  switch (objetivo) {
    case "PERDIDA_GRASA":
      return "Volumen un poco más alto que el estándar: con tu objetivo, el gasto de esta sesión suma.";
    case "GANANCIA_MUSCULO":
      return "Volumen recortado a propósito: con tu objetivo, esta sesión compite con la fuerza y no al revés.";
    case "RENDIMIENTO":
      return "Volumen alto: tu objetivo es rendir en la disciplina, no solo acompañar al gimnasio.";
    case "SALUD":
      return "Volumen moderado: lo que sostiene el hábito sin dejarte hecho polvo.";
    default:
      return null;
  }
}

/**
 * Ciclo de cuatro semanas: tres de progresión y una de descarga.
 *
 * Es el mismo principio del glidepath —el escalón sale de donde estás—: la
 * descarga existe para poder sostener el ciclo siguiente, no como premio.
 */
export function factorDeSemana(isoWeek: number): { factor: number; deload: boolean } {
  const posicion = isoWeek % 4;
  if (posicion === 0) return { factor: 0.8, deload: true };
  return { factor: 1 + 0.05 * (posicion - 1), deload: false };
}

/** El aviso que va en toda sesión de una disciplina que no es pesas. */
export const AVISO_DISCIPLINA =
  "Esto prescribe volumen y estructura, no técnica en vivo: un entrenador de la disciplina ve lo que una app no puede ver.";
