import datos from "@/lib/training/disciplinas/hiit-caminadora.json";
import type { NivelCardio } from "@/lib/training/types";

/**
 * Los protocolos HIIT de caminadora que Mau ya probó y le gustaron (N1).
 *
 * En la caminadora no hay "niveles de rapidez": hay velocidad en km/h (o en
 * mph, según la máquina). Por eso aquí el HIIT se prescribe como en las
 * tablas que él usa —minuto a minuto, velocidad y esfuerzo— y no como el
 * "nivel de máquina 6–8" de H2, que se queda para elíptica, bici y escalera.
 *
 * El catálogo (`hiit-caminadora.json`) es la transcripción de sus capturas:
 * 25' y 15' en niveles 0–5 y 10' solo en niveles 4–5. **Los 10' de niveles
 * 0–3 no venían y no se inventan**: si el bloque pide 10' con nivel < 4, se
 * usa el 15' del mismo nivel recortado a sus primeros 9 min más 1 min de
 * enfriamiento Fácil (ver `recortarADiez`). Un tramo `inferido` no se veía en
 * la captura (calentamiento, enfriamiento o uno intermedio); la vista de
 * detalle lo marca con un "?" discreto.
 */

export const ESFUERZOS_HIIT = ["Fácil", "Moderado", "Moderado Alto", "Fuerte", "Máximo"] as const;
export type EsfuerzoHiit = (typeof ESFUERZOS_HIIT)[number];

export type TramoHiit = {
  desdeMin: number;
  hastaMin: number;
  /** Rango de velocidad en km/h, `[mín, máx]`. */
  kmh: [number, number];
  esfuerzo: EsfuerzoHiit;
  /** No se veía en la captura: se completó por el patrón del protocolo. */
  inferido?: boolean;
};

export const DURACIONES_HIIT = [10, 15, 25] as const;
export type DuracionHiit = (typeof DURACIONES_HIIT)[number];

export type ProtocoloHiit = {
  duracion: DuracionHiit;
  /** 0 a 5. */
  nivel: number;
  tramos: TramoHiit[];
};

/** El protocolo que corre el bloque de cardio, ya adaptado a sus minutos. */
export type ProtocoloPrescrito = ProtocoloHiit & {
  /** `true` = 10' armado desde el 15' del mismo nivel (no hay 10' < nivel 4). */
  recortado: boolean;
  /** Minutos que sobran tras el protocolo: caminata suave 5–6 km/h. */
  caminataMin: number;
};

export const CATALOGO_HIIT: readonly ProtocoloHiit[] = (datos.protocolos as Array<{
  duracion: number;
  nivel: number;
  tramos: Array<{ desdeMin: number; hastaMin: number; kmh: number[]; esfuerzo: string; inferido?: boolean }>;
}>).map((protocolo) => ({
  duracion: protocolo.duracion as DuracionHiit,
  nivel: protocolo.nivel,
  tramos: protocolo.tramos.map((tramo) => ({
    desdeMin: tramo.desdeMin,
    hastaMin: tramo.hastaMin,
    kmh: [tramo.kmh[0]!, tramo.kmh[1]!] as [number, number],
    esfuerzo: tramo.esfuerzo as EsfuerzoHiit,
    ...(tramo.inferido ? { inferido: true } : {}),
  })),
}));

export const NIVEL_MAXIMO_HIIT = 5;

/** La caminata que rellena los minutos que sobran tras el protocolo. */
export const CAMINATA_SUAVE_KMH: [number, number] = [5, 6];

export function protocoloDelCatalogo(duracion: number, nivel: number): ProtocoloHiit | null {
  return CATALOGO_HIIT.find((protocolo) => protocolo.duracion === duracion && protocolo.nivel === nivel) ?? null;
}

/** La mayor de 10/15/25 que quepa en el bloque; nunca menos de 10. */
export function duracionParaMinutos(minutos: number): DuracionHiit {
  const cabe = [...DURACIONES_HIIT].reverse().find((duracion) => duracion <= minutos);
  return cabe ?? 10;
}

/**
 * El 10' de un nivel < 4, que no venía en las capturas: los primeros 9 min
 * del 15' del mismo nivel y 1 min Fácil a la velocidad de su enfriamiento.
 * Si el minuto 9 ya era Fácil, el tramo se alarga en vez de repetirse.
 */
function recortarADiez(quince: ProtocoloHiit): TramoHiit[] {
  const enfriamiento = quince.tramos.at(-1)!;
  const tramos = quince.tramos
    .filter((tramo) => tramo.desdeMin < 9)
    .map((tramo) => ({ ...tramo, hastaMin: Math.min(tramo.hastaMin, 9) }));
  const ultimo = tramos.at(-1)!;
  if (ultimo.esfuerzo === "Fácil") {
    tramos[tramos.length - 1] = { ...ultimo, hastaMin: 10 };
  } else {
    tramos.push({ desdeMin: 9, hastaMin: 10, kmh: [...enfriamiento.kmh], esfuerzo: "Fácil" });
  }
  return tramos;
}

/** El protocolo para un bloque de `minutos` a `nivel` (0–5). */
export function protocoloParaBloque(minutos: number, nivel: number): ProtocoloPrescrito {
  const n = Math.max(0, Math.min(NIVEL_MAXIMO_HIIT, Math.round(nivel)));
  const duracion = duracionParaMinutos(minutos);
  const caminataMin = Math.max(0, Math.round(minutos) - duracion);
  const exacto = protocoloDelCatalogo(duracion, n);
  if (exacto) return { ...exacto, recortado: false, caminataMin };

  // Solo pasa con 10' y nivel < 4: el 15' del mismo nivel siempre existe.
  const quince = protocoloDelCatalogo(15, n)!;
  return { duracion: 10, nivel: n, tramos: recortarADiez(quince), recortado: true, caminataMin };
}

/* ------------------------------------------------------------------------ */
/* Nivel y progresión                                                        */
/* ------------------------------------------------------------------------ */

/** Dónde arranca cada nivel declarado: básico 0–1, medio 2–3, avanzado 4–5. */
export const NIVEL_INICIAL_HIIT: Record<NivelCardio, number> = { BASICO: 0, MEDIO: 2, AVANZADO: 4 };

/** Una semana pasada de cardio: cuántas sesiones pedía el plan y cuántas se registraron. */
export type SemanaCardio = { isoWeek: number; planeadas: number; registradas: number };

/** Semana cumplida: ≥ 80 % de las sesiones de cardio planeadas, registradas. */
export const UMBRAL_SEMANA_CUMPLIDA = 0.8;

export function esDescarga(isoWeek: number): boolean {
  return isoWeek % 4 === 0;
}

/**
 * El nivel de HIIT de esta semana.
 *
 * Arranca en el piso del nivel declarado y sube **+1 por cada semana
 * cumplida** del historial (nunca más de +1 por semana, por muchas sesiones
 * que traiga). La 4.ª semana del ciclo (`isoWeek % 4 === 0`, el mismo de
 * `factorDeSemana`) descarga un nivel y no cuenta como subida: se hizo a
 * propósito más fácil. Topa en 5 y nunca baja de 0.
 *
 * El historial son las semanas ANTERIORES que el cargador alcanza a ver
 * (`historialCardioDe`, ~8 semanas): quien deja el cardio un par de meses
 * vuelve a un nivel más bajo, que es lo que pide el cuerpo.
 */
export function nivelHiitDeSemana(input: {
  nivel: NivelCardio;
  isoWeek: number;
  historial: readonly SemanaCardio[];
}): { nivel: number; inicial: number; subidas: number; descarga: boolean } {
  const inicial = NIVEL_INICIAL_HIIT[input.nivel];
  const subidas = input.historial.filter(
    (semana) =>
      !esDescarga(semana.isoWeek) &&
      semana.planeadas > 0 &&
      semana.registradas / semana.planeadas >= UMBRAL_SEMANA_CUMPLIDA,
  ).length;
  const acumulado = Math.min(NIVEL_MAXIMO_HIIT, inicial + subidas);
  const descarga = esDescarga(input.isoWeek);
  return { nivel: descarga ? Math.max(0, acumulado - 1) : acumulado, inicial, subidas, descarga };
}

/* ------------------------------------------------------------------------ */
/* Unidades                                                                  */
/* ------------------------------------------------------------------------ */

export const UNIDADES_VELOCIDAD = ["kmh", "mph"] as const;
export type UnidadVelocidad = (typeof UNIDADES_VELOCIDAD)[number];

export const MPH_POR_KMH = 0.621371;

/** km/h → mph, redondeado a 0.1. */
export function kmhAMph(kmh: number): number {
  return Math.round(kmh * MPH_POR_KMH * 10) / 10;
}

/** "4–5 km/h" o "2.5–3.1 mph": el rango se convierte por extremo. */
export function textoVelocidad(kmh: readonly [number, number], unidad: UnidadVelocidad = "kmh"): string {
  if (unidad === "mph") return `${kmhAMph(kmh[0])}–${kmhAMph(kmh[1])} mph`;
  return `${kmh[0]}–${kmh[1]} km/h`;
}
