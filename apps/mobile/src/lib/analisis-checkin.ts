import type { BloqueMensual, EstadoAnalisis, ProximoMensual } from "@/lib/api";

/**
 * Lo que la app dice y decide mientras el servidor analiza un check-in, y
 * las líneas de la retro. Puro: la pantalla solo lo pinta.
 */

/** Cada cuánto se pregunta al servidor con la app en primer plano. */
export const SONDEO_MS = 5000;

/**
 * A cuánto se programa el aviso local si la persona sale de la app antes de
 * que el análisis esté. Sin APNs no hay push real: el teléfono no puede
 * preguntarle al servidor cuando la app está en segundo plano, así que el
 * aviso se programa a ciegas con un margen que casi siempre alcanza.
 */
export const AVISO_ANALISIS_SEGUNDOS = 180;

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

/** Qué hacer al volver al primer plano (o en cada sondeo). */
export function alVolver(estado: EstadoAnalisis): {
  cancelarAviso: boolean;
  navegar: boolean;
  seguirSondeando: boolean;
} {
  const lista = estado === "lista";
  return { cancelarAviso: lista, navegar: lista, seguirSondeando: !lista };
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
