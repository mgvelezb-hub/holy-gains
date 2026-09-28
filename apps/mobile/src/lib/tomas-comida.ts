import type { TomaDelDia } from "@/lib/api";

/**
 * Las tomas de suplementos dentro de la planeación del día — lógica PURA.
 *
 * Mau agregó sus suplementos y no veía en su día cuándo tomar cada uno: las
 * tomas vivían solo en la línea de Hoy y en su hoja aparte, y ni el menú ni
 * "Mis comidas hoy" las pintaban. Aquí se reparten: las amarradas a una
 * comida van dentro de ella, como un renglón más ("+ Creatina 5 g"); las que
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

/** "+ Creatina 5 g": se lee como un ingrediente más de la comida. */
export function renglonToma(t: TomaDelDia): string {
  return `+ ${capital(t.corto)} ${t.dosis}`;
}

/** Lo que dice la tarjeta de una línea: "+ creatina", "+ 2 tomas", con ✓ si ya. */
export function sufijoTomas(tomas: readonly TomaDelDia[]): string {
  if (tomas.length === 0) return "";
  const listo = tomas.every((t) => t.hecho) ? " ✓" : "";
  if (tomas.length === 1) return `+ ${tomas[0]!.corto}${listo}`;
  return `+ ${tomas.length} tomas${listo}`;
}

/** La lista con esa toma marcada o desmarcada; no toca la original. */
export function alternaToma(tomas: readonly TomaDelDia[], supplement: string): TomaDelDia[] {
  return tomas.map((t) => (t.supplement === supplement ? { ...t, hecho: !t.hecho } : t));
}
