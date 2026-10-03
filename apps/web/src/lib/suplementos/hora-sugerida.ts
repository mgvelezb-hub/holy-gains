import type { AnclaSuplemento, TomaDelDia } from "engine";

import { horaDeMinutos, minutosDeHora } from "@/lib/coachy/horarios";

/**
 * La hora sugerida de cada toma de hoy — una sugerencia, nunca una regla.
 *
 * Las tomas se amarran a un ancla (una comida, el entreno, dormir). La
 * persona ya fija sus horarios de comida y su momento de entrenar en Ajustes:
 * de ahí sale la hora a la que conviene cada suplemento. La app la dice como
 * "Sugerido ~18:00" y la usa para el recordatorio que viaja con la comida;
 * la hora real de la toma la marca la persona.
 *
 * Módulo puro: no sabe de Prisma, así que se prueba sin base.
 */

/** Los momentos de entrenar del perfil (`TrainingTime`), más el día libre. */
export type MomentoEntreno = "MANANA" | "MEDIODIA" | "TARDE" | "NOCHE" | "DESCANSO";

/** La hora típica de arranque de cada momento, si el menú no trae pre-entreno. */
const HORA_DE_MOMENTO: Record<Exclude<MomentoEntreno, "DESCANSO">, string> = {
  MANANA: "07:00",
  MEDIODIA: "13:00",
  TARDE: "18:00",
  NOCHE: "20:00",
};

/** El pre-entreno se come una hora antes de entrenar. */
const PRE_A_ENTRENO_MIN = 60;
/** Lo de "antes de entrenar" va media hora antes. */
const ANTES_DE_ENTRENAR_MIN = 30;
/** Dormir: dos horas después de la última comida, nunca después de las 23:30. */
const CENA_A_DORMIR_MIN = 120;
const DORMIR_TOPE_MIN = 23 * 60 + 30;

const ANCLAS_DE_ENTRENO: ReadonlySet<AnclaSuplemento> = new Set(["PRE_ENTRENO", "ENTRENO", "POST_ENTRENO"]);

export interface ContextoHoraSugerida {
  /** La hora efectiva de cada comida de hoy (`{ COMIDA: "14:30" }`). */
  horasComida: Record<string, string>;
  /** El momento de entrenar de hoy (`trainingSchedule` del día o `trainingTime`). */
  entreno: MomentoEntreno;
  /** Lo que dura la sesión, para el post-entreno. */
  minutosSesion: number;
}

export type TomaConSugerencia = TomaDelDia & {
  /** `"HH:MM"`; `null` si la toma es libre ("cuando te acomode"). */
  horaSugerida: string | null;
  /** La línea que lee la persona: "Sugerido ~18:00 · antes de entrenar". */
  sugerencia: string;
};

function minutos(hora: string | undefined): number | null {
  return hora === undefined ? null : minutosDeHora(hora);
}

/** A qué hora arranca el entreno hoy; `null` si hoy se descansa. */
function inicioDelEntreno(contexto: ContextoHoraSugerida): number | null {
  if (contexto.entreno === "DESCANSO") return null;
  const pre = minutos(contexto.horasComida.PRE);
  if (pre !== null) return pre + PRE_A_ENTRENO_MIN;
  return minutosDeHora(HORA_DE_MOMENTO[contexto.entreno]);
}

/** Las horas de comida de hoy, en orden. */
function horasOrdenadas(contexto: ContextoHoraSugerida): number[] {
  return Object.values(contexto.horasComida)
    .map((hora) => minutosDeHora(hora))
    .filter((valor): valor is number => valor !== null)
    .sort((a, b) => a - b);
}

function horaDeLaToma(toma: TomaDelDia, contexto: ContextoHoraSugerida): number | null {
  if (toma.slot) return minutos(contexto.horasComida[toma.slot]);

  if (ANCLAS_DE_ENTRENO.has(toma.ancla)) {
    const inicio = inicioDelEntreno(contexto);
    if (inicio === null) {
      // Día de descanso: lo que va con el entreno (la creatina) se toma con
      // la comida fuerte; si no hay, con la primera.
      const horas = horasOrdenadas(contexto);
      return minutos(contexto.horasComida.COMIDA) ?? horas[0] ?? null;
    }
    if (toma.ancla === "PRE_ENTRENO") return inicio - ANTES_DE_ENTRENAR_MIN;
    if (toma.ancla === "POST_ENTRENO") return inicio + contexto.minutosSesion;
    return inicio;
  }

  if (toma.ancla === "DORMIR") {
    const ultima = horasOrdenadas(contexto).at(-1);
    if (ultima === undefined) return null;
    return Math.min(ultima + CENA_A_DORMIR_MIN, DORMIR_TOPE_MIN);
  }

  // LIBRE, o un ancla de comida que el menú de hoy no tiene.
  return null;
}

function lineaDeSugerencia(toma: TomaDelDia, hora: string | null, descanso: boolean): string {
  if (hora === null) return "Cuando te acomode";
  if (descanso && ANCLAS_DE_ENTRENO.has(toma.ancla)) return `Sugerido ~${hora} · hoy descansas, con la comida`;
  return `Sugerido ~${hora} · ${toma.cuando}`;
}

/**
 * Cada toma con su hora sugerida y la línea que la dice. No cambia el orden
 * ni filtra nada: solo agrega.
 */
export function conHoraSugerida(tomas: TomaDelDia[], contexto: ContextoHoraSugerida): TomaConSugerencia[] {
  const descanso = contexto.entreno === "DESCANSO";
  return tomas.map((toma) => {
    const valor = horaDeLaToma(toma, contexto);
    const horaSugerida = valor === null ? null : horaDeMinutos(Math.max(0, valor));
    return { ...toma, horaSugerida, sugerencia: lineaDeSugerencia(toma, horaSugerida, descanso) };
  });
}

/** El momento de entrenar de hoy: el del día en `trainingSchedule`, o el general. */
export function momentoDeHoy(trainingSchedule: unknown, trainingTime: string, dia: string): MomentoEntreno {
  const validos: readonly string[] = ["MANANA", "MEDIODIA", "TARDE", "NOCHE", "DESCANSO"];
  if (trainingSchedule && typeof trainingSchedule === "object") {
    const delDia = (trainingSchedule as Record<string, unknown>)[dia];
    if (typeof delDia === "string" && validos.includes(delDia)) return delDia as MomentoEntreno;
  }
  return validos.includes(trainingTime) ? (trainingTime as MomentoEntreno) : "MANANA";
}
