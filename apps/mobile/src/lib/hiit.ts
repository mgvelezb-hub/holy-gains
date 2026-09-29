import type {
  DetalleCardio,
  DetalleCardioConProtocolo,
  DisciplineLoad,
  EsfuerzoHiit,
  PreferenciasCardioN1,
  ProtocoloHiit,
  TramoHiit,
  UnidadVelocidad,
  WarmupStep,
} from "@/lib/api";
import type { Palette } from "@/lib/theme";

/**
 * El HIIT de caminadora por velocidad real (N1) en el teléfono — lógica PURA.
 *
 * La web elige el protocolo (catálogo de Mau, duración que cabe, nivel con
 * progresión) y lo manda en `sesion.cardio.protocolo` en km/h. Aquí se
 * traduce a lo que se ve: la tabla Tiempo · Velocidad · Esfuerzo, los pasos
 * del timer (los tramos más la caminata suave que rellena el bloque), el
 * aviso 5 s antes de cada cambio de velocidad y el texto corto para el
 * reloj. La conversión a mph es la misma de la web: por extremo, a 0.1.
 */

export const MPH_POR_KMH = 0.621371;

/** Lo que sobra del bloque se camina suave a esta velocidad. */
export const CAMINATA_SUAVE_KMH: [number, number] = [5, 6];

/** Segundos antes del cambio de velocidad en que se avisa. */
export const AVISO_PREVIO_SEG = 5;

/** El tramo de la caminata de relleno se nombra así en la tabla y en el timer. */
export type EsfuerzoDeFila = EsfuerzoHiit | "Caminata";

export function kmhAMph(kmh: number): number {
  return Math.round(kmh * MPH_POR_KMH * 10) / 10;
}

/** "4–5 km/h" o "2.5–3.1 mph". */
export function textoVelocidad(kmh: readonly [number, number], unidad: UnidadVelocidad = "kmh"): string {
  if (unidad === "mph") return `${kmhAMph(kmh[0])}–${kmhAMph(kmh[1])} mph`;
  return `${kmh[0]}–${kmh[1]} km/h`;
}

/** El protocolo del detalle de cardio, si es caminadora HIIT de N1. */
export function protocoloDe(detalle: DetalleCardio | null | undefined): ProtocoloHiit | null {
  return (detalle as DetalleCardioConProtocolo | null | undefined)?.protocolo ?? null;
}

/** La unidad que manda la prescripción (la preferencia guardada), km/h si no viene. */
export function unidadDe(detalle: DetalleCardio | null | undefined): UnidadVelocidad {
  return (detalle as DetalleCardioConProtocolo | null | undefined)?.unidad ?? "kmh";
}

/** "HIIT 15' · Nivel 3". */
export function tituloProtocolo(protocolo: ProtocoloHiit): string {
  return `HIIT ${protocolo.duracion}' · Nivel ${protocolo.nivel}`;
}

/** Un tramo de la sesión: los del protocolo más, si sobra bloque, la caminata. */
export type TramoDeSesion = Omit<TramoHiit, "esfuerzo"> & { esfuerzo: EsfuerzoDeFila };

export function tramosDeSesion(protocolo: ProtocoloHiit): TramoDeSesion[] {
  const tramos: TramoDeSesion[] = [...protocolo.tramos];
  if (protocolo.caminataMin > 0) {
    tramos.push({
      desdeMin: protocolo.duracion,
      hastaMin: protocolo.duracion + protocolo.caminataMin,
      kmh: CAMINATA_SUAVE_KMH,
      esfuerzo: "Caminata",
    });
  }
  return tramos;
}

export type FilaProtocolo = {
  tiempo: string;
  velocidad: string;
  esfuerzo: EsfuerzoDeFila;
  /** Solo para la vista de detalle: el "?" discreto. La sesión no lo enseña. */
  inferido: boolean;
};

/** Las filas de la tabla, como en las capturas: Tiempo · Velocidad · Esfuerzo. */
export function filasDeProtocolo(protocolo: ProtocoloHiit, unidad: UnidadVelocidad): FilaProtocolo[] {
  return tramosDeSesion(protocolo).map((tramo) => ({
    tiempo: `${tramo.desdeMin}–${tramo.hastaMin} min`,
    velocidad: textoVelocidad(tramo.kmh, unidad),
    esfuerzo: tramo.esfuerzo,
    inferido: tramo.inferido === true,
  }));
}

/** "10–12 km/h · Moderado Alto" — lo que se lee grande durante el tramo. */
export function textoDelTramo(tramo: TramoDeSesion, unidad: UnidadVelocidad): string {
  const esfuerzo = tramo.esfuerzo === "Caminata" ? "Caminata suave" : tramo.esfuerzo;
  return `${textoVelocidad(tramo.kmh, unidad)} · ${esfuerzo}`;
}

/** Los pasos que corre el timer de la sesión en vivo. */
export function pasosDeProtocolo(protocolo: ProtocoloHiit, unidad: UnidadVelocidad): WarmupStep[] {
  return tramosDeSesion(protocolo).map((tramo) => ({
    nombre: textoDelTramo(tramo, unidad),
    segundos: (tramo.hastaMin - tramo.desdeMin) * 60,
  }));
}

/**
 * ¿Toca el aviso de "cambia la velocidad"? Una vez por paso, cuando faltan
 * `AVISO_PREVIO_SEG` o menos, y solo si después viene otro tramo.
 */
export function debeAvisarCambio(input: {
  restanteSeg: number;
  /** El paso en que ya se avisó, o `null`. */
  avisadoEn: number | null;
  paso: number;
  hayCambio: boolean;
}): boolean {
  if (!input.hayCambio || input.avisadoEn === input.paso) return false;
  return input.restanteSeg > 0 && input.restanteSeg <= AVISO_PREVIO_SEG;
}

const ABREVIADO: Record<EsfuerzoDeFila, string> = {
  Fácil: "Fácil",
  Moderado: "Moderado",
  "Moderado Alto": "M. Alto",
  Fuerte: "Fuerte",
  Máximo: "Máximo",
  Caminata: "Caminata",
};

function reloj(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Lo que va al reloj por el canal de sesión que ya existe
 * (`enviarSesionAlReloj`): una sesión SIN ejercicios cuyo título es el tramo
 * en corto ("10–12 km/h · M. Alto · 1:15"). El reloj de hoy pinta el título;
 * `cardio` viaja para cuando `targets/watch` aprenda a leerlo (el Swift no se
 * toca en N1: lo lleva otro frente).
 */
export function textoParaReloj(input: {
  protocolo: ProtocoloHiit;
  paso: number;
  restanteSeg: number;
  unidad: UnidadVelocidad;
}): {
  workoutId: string;
  titulo: string;
  ejercicios: [];
  cardio: { tramo: string; restanteSeg: number; siguiente: string | null };
} {
  const tramos = tramosDeSesion(input.protocolo);
  const actual = tramos[input.paso] ?? tramos.at(-1)!;
  const siguiente = tramos[input.paso + 1];
  return {
    workoutId: "cardio",
    titulo: `${textoVelocidad(actual.kmh, input.unidad)} · ${ABREVIADO[actual.esfuerzo]} · ${reloj(input.restanteSeg)}`,
    ejercicios: [],
    cardio: {
      tramo: textoDelTramo(actual, input.unidad),
      restanteSeg: input.restanteSeg,
      siguiente: siguiente ? textoDelTramo(siguiente, input.unidad) : null,
    },
  };
}

/** El color del esfuerzo, del tema activo. La caminata es Fácil. */
export function colorDeEsfuerzo(esfuerzo: EsfuerzoDeFila, colors: Palette): string {
  switch (esfuerzo) {
    case "Moderado":
      return colors.esfuerzoModerado;
    case "Moderado Alto":
      return colors.esfuerzoModeradoAlto;
    case "Fuerte":
      return colors.esfuerzoFuerte;
    case "Máximo":
      return colors.esfuerzoMaximo;
    default:
      return colors.esfuerzoFacil;
  }
}

/**
 * `otherDisciplines` con la unidad de velocidad guardada en las preferencias
 * de CARDIO (sin columna propia). Lo demás de la carga no se toca, y sin
 * CARDIO no hay nada que guardar.
 */
export function conUnidadVelocidad(otras: readonly DisciplineLoad[], unidad: UnidadVelocidad): DisciplineLoad[] {
  return otras.map((carga) => {
    if (carga.discipline !== "CARDIO") return carga;
    const actual = carga as DisciplineLoad & { cardio?: PreferenciasCardioN1 };
    return { ...actual, cardio: { ...actual.cardio, unidadVelocidad: unidad } } as DisciplineLoad;
  });
}
