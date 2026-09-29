import type { TomaDelDia } from "@/lib/api";

/**
 * Las tomas de suplementos dentro de la planeación del día — lógica PURA.
 *
 * Mau agregó sus suplementos y no veía en su día cuándo tomar cada uno: las
 * tomas vivían solo en la línea de Hoy y en su hoja aparte, y ni el menú ni
 * "Mis comidas hoy" las pintaban. Aquí se reparten: las amarradas a una
 * comida van dentro de ella, como un renglón más ("Creatina 5 g"); las que
 * no van con comida (dormir, entrenar) salen aparte con su momento.
 */

/** Las tomas de esa comida, en el orden que ya trae el día. */
export function tomasDeComida(tomas: readonly TomaDelDia[], slot: string): TomaDelDia[] {
  return tomas.filter((t) => t.slot === slot);
}

/** Las que no van con una comida: la melatonina, la cafeína pre-entreno. */
export function tomasSueltas(tomas: readonly TomaDelDia[]): TomaDelDia[] {
  return tomas.filter((t) => t.slot === null);
}

function capital(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * El check es "ya lo tomé hoy" (escribe `SupplementLog`), no "acepto
 * tomarlo": eso se decide en Ajustes → Suplementos. Irma lo leía al revés
 * —marcar era aceptar, y lo tachado le hacía ruido—, así que el renglón dice
 * qué hacer y, marcado, a qué hora se tomó, sin tachar nada.
 */
export const AYUDA_TOMAS = "Marca cada suplemento cuando lo tomes; así sabemos si lo llevas diario";

export type EstadoToma = "pendiente" | "tomada";

export function estadoToma(t: TomaDelDia): EstadoToma {
  return t.hecho ? "tomada" : "pendiente";
}

/** "14:05", en la hora del teléfono. */
function horaCorta(iso: string): string | null {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;
  return `${String(fecha.getHours()).padStart(2, "0")}:${String(fecha.getMinutes()).padStart(2, "0")}`;
}

/** "Creatina 5 g · tócalo al tomarlo" o "Creatina 5 g · tomada 14:05". */
export function renglonToma(t: TomaDelDia): string {
  const nombre = `${capital(t.corto)} ${t.dosis}`;
  if (!t.hecho) return `${nombre} · tócalo al tomarlo`;
  const hora = t.hechaA ? horaCorta(t.hechaA) : null;
  return hora ? `${nombre} · tomada ${hora}` : `${nombre} · tomada`;
}

/** Lo que dice la tarjeta de una línea: "+ creatina", "+ 2 tomas", con ✓ si ya. */
export function sufijoTomas(tomas: readonly TomaDelDia[]): string {
  if (tomas.length === 0) return "";
  const listo = tomas.every((t) => t.hecho) ? " ✓" : "";
  if (tomas.length === 1) return `+ ${tomas[0]!.corto}${listo}`;
  return `+ ${tomas.length} tomas${listo}`;
}

/** La lista con esa toma marcada (con la hora) o desmarcada; no toca la original. */
export function alternaToma(
  tomas: readonly TomaDelDia[],
  supplement: string,
  ahora: Date = new Date(),
): TomaDelDia[] {
  return tomas.map((t) => {
    if (t.supplement !== supplement) return t;
    if (t.hecho) {
      const { hechaA: _hora, ...resto } = t;
      return { ...resto, hecho: false };
    }
    return { ...t, hecho: true, hechaA: ahora.toISOString() };
  });
}
