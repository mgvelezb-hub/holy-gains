import type { BloqueMensual, EstadoAnalisis, ProximoMensual } from "@/lib/api";

/**
 * Lo que la app dice y decide mientras el servidor analiza un check-in, y
 * las líneas de la retro. Puro: la pantalla solo lo pinta.
 */

/** Cada cuánto se pregunta al servidor con la app en primer plano. */
export const SONDEO_MS = 5000;

/**
 * A cuánto se programa el aviso local. Sin APNs no hay push real: con la app
 * en segundo plano el teléfono no puede preguntarle al servidor, así que el
 * aviso se programa a ciegas con un margen que casi siempre alcanza.
 */
export const AVISO_ANALISIS_SEGUNDOS = 180;

/** Cuántas veces se mueve el aviso +3 min si la retro no está a tiempo. */
export const MAX_REPROGRAMACIONES = 3;

/**
 * Cuánto antes de que venza se reprograma el aviso con la app abierta. Tiene
 * que cubrir más de un sondeo: si no, el aviso viejo suena antes de moverse.
 */
export const MARGEN_REPROGRAMAR_MS = 15_000;

export type AccionAviso = { tipo: "programar"; segundos: number } | { tipo: "cancelar" } | { tipo: "nada" };

/** El aviso de "tu retro está lista", mientras el servidor analiza. */
export interface AvisoAnalisis {
  terminado: boolean;
  /** Cuándo suena el aviso programado (ms). */
  venceEn: number;
  reprogramaciones: number;
  /** Ya venció una vez sin retro: la pantalla dice "sigo con ello". */
  sigoConEllo: boolean;
}

export type EventoAviso =
  | { tipo: "sondeo"; estado: EstadoAnalisis; ahora: number }
  | { tipo: "revisionHumana" };

/**
 * Al enviar el check-in, antes de cualquier transición: programar al irse a
 * segundo plano es una carrera async que iOS puede cortar suspendiendo la app.
 */
export function alEnviar(ahora: number): { aviso: AvisoAnalisis; accion: AccionAviso } {
  return {
    aviso: {
      terminado: false,
      venceEn: ahora + AVISO_ANALISIS_SEGUNDOS * 1000,
      reprogramaciones: 0,
      sigoConEllo: false,
    },
    accion: { tipo: "programar", segundos: AVISO_ANALISIS_SEGUNDOS },
  };
}

/**
 * Cada sondeo en primer plano (incluido el de volver a la app): si ya está,
 * se cancela y se navega; si está por vencer sin retro, se mueve +3 min.
 */
export function pasoAviso(
  aviso: AvisoAnalisis,
  evento: EventoAviso,
): { aviso: AvisoAnalisis; accion: AccionAviso; navegar: boolean } {
  const nada = { aviso, accion: { tipo: "nada" } as const, navegar: false };
  if (aviso.terminado) return nada;

  const terminado = { ...aviso, terminado: true };
  if (evento.tipo === "revisionHumana") return { aviso: terminado, accion: { tipo: "cancelar" }, navegar: false };
  if (evento.estado === "lista") return { aviso: terminado, accion: { tipo: "cancelar" }, navegar: true };

  if (evento.ahora < aviso.venceEn - MARGEN_REPROGRAMAR_MS) return nada;
  if (aviso.reprogramaciones >= MAX_REPROGRAMACIONES) {
    return { ...nada, aviso: { ...aviso, sigoConEllo: true } };
  }

  return {
    aviso: {
      terminado: false,
      venceEn: evento.ahora + AVISO_ANALISIS_SEGUNDOS * 1000,
      reprogramaciones: aviso.reprogramaciones + 1,
      sigoConEllo: true,
    },
    accion: { tipo: "programar", segundos: AVISO_ANALISIS_SEGUNDOS },
    navegar: false,
  };
}

export function textoAnalizando(opciones: { conFotos: boolean; esMensual: boolean }): string {
  const extras = [
    ...(opciones.conFotos ? ["tus fotos"] : []),
    ...(opciones.esMensual ? ["tu objetivo"] : []),
  ];

  let cruce = "tus números";
  if (extras.length === 1) cruce = `tus números y ${extras[0]}`;
  if (extras.length === 2) cruce = `tus números, ${extras[0]} y ${extras[1]}`;

  return `Estoy cruzando ${cruce}. Puedes salir de la app; te aviso cuando esté listo.`;
}

/** La línea de la tarjeta de Hoy, con el contador del servidor. */
export function lineaCheckin(proximo: ProximoMensual | null): string {
  if (proximo === null) return "semanal";
  if (proximo.semanas <= 0) return "este toca mensual: brazos, piernas y fotos";
  return `semanal · mensual en ${proximo.semanas} ${proximo.semanas === 1 ? "semana" : "semanas"}`;
}

export function flechaDelta(valor: number | null, unidad: "cm" | "kg"): string {
  if (valor === null) return "—";
  const flecha = valor < 0 ? "↓" : valor > 0 ? "↑" : "=";
  return `${flecha} ${Math.abs(valor)} ${unidad}`;
}

/** "Este mes", en una línea: cintura y peso contra el mes anterior. */
export function resumenEsteMes(deltas: BloqueMensual["deltas"]): string {
  const partes: string[] = [];
  if (deltas.cintura.vsMesAnterior !== null) {
    partes.push(`Cintura ${flechaDelta(deltas.cintura.vsMesAnterior, "cm")}`);
  }
  if (deltas.peso.vsMesAnterior !== null) {
    partes.push(`Peso ${flechaDelta(deltas.peso.vsMesAnterior, "kg")}`);
  }
  return partes.length > 0 ? partes.join(" · ") : "Primer mes: desde aquí se compara";
}

const BRECHAS = ["cerca", "media", "lejos"] as const;

/** "Tus fotos", en una línea: cuántas zonas cerca, a medio camino o lejos. */
export function resumenFotos(fotos: BloqueMensual["fotos"]): string {
  if (fotos === null) return "Sin lectura de fotos este mes";
  if (fotos.estado === "sin_referencia") return "Sin fotos de referencia";
  if (fotos.estado === "sin_fotos") return "Sin fotos tuyas para comparar";
  if (fotos.zonas.length === 0) return "La lectura todavía no está";

  return BRECHAS.map((brecha) => [brecha, fotos.zonas.filter((zona) => zona.brecha === brecha).length] as const)
    .filter(([, cuantas]) => cuantas > 0)
    .map(([brecha, cuantas]) => `${cuantas} ${brecha}`)
    .join(" · ");
}

/**
 * ¿Este check-in es el mensual (abrir brazos y piernas solos)?
 *
 * Manda el contador del servidor (`proximoMensual`, la misma regla de 28
 * días con la que decide el análisis): toca con `semanas === 0`, y también
 * cuando respondió sin dato — sin check-ins no hay contra qué contar.
 * `servidor: null` = no se pudo preguntar (sin señal): entonces, y solo
 * entonces, se cuenta localmente desde la última medida de brazos/piernas.
 * `diasDesdeUltimaLocal: null` = tampoco hay historial local; se deja
 * cerrado, como antes.
 */
export function tocaMensual(entrada: {
  servidor: { proximoMensual: ProximoMensual | null } | null;
  diasDesdeUltimaLocal: number | null;
}): boolean {
  if (entrada.servidor !== null) {
    const proximo = entrada.servidor.proximoMensual;
    return proximo === null || proximo.semanas <= 0;
  }
  return entrada.diasDesdeUltimaLocal !== null && entrada.diasDesdeUltimaLocal >= 28;
}
