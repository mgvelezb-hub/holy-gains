/**
 * El estado del análisis de un check-in, como lo ve la app.
 *
 * `runCoachy` publica la decisión en cuanto el motor decide (si no espera a
 * un humano) y escribe la retro unos segundos después, tras menús, rutina y
 * redacción. "Lista" es cuando ya hay las dos cosas: publicada y con texto.
 *
 * Si el pipeline se cayó después de publicar, el texto nunca llega; pasados
 * `MINUTOS_SIN_TEXTO` se da por lista igual —con sus números, sin retro—
 * para que la pantalla no gire para siempre.
 */

export const MINUTOS_SIN_TEXTO = 15;

export type EstadoAnalisis = "analizando" | "lista";

export interface DecisionParaEstado {
  status: "PENDIENTE" | "APROBADA" | "CORREGIDA";
  publishedAt: Date | null;
  /** `replyJson` no es null. */
  tieneTexto: boolean;
}

export function estadoDelAnalisis(
  decision: DecisionParaEstado | null,
  ahora: Date,
): { estado: EstadoAnalisis; enRevisionHumana: boolean } {
  if (decision === null) return { estado: "analizando", enRevisionHumana: false };

  if (decision.publishedAt === null) {
    return { estado: "analizando", enRevisionHumana: decision.status === "PENDIENTE" };
  }

  const minutos = (ahora.getTime() - decision.publishedAt.getTime()) / 60_000;
  const lista = decision.tieneTexto || minutos > MINUTOS_SIN_TEXTO;
  return { estado: lista ? "lista" : "analizando", enRevisionHumana: false };
}
