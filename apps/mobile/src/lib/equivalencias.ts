import type { MenuMeal } from "@/lib/api";

/**
 * La hoja de "cambiar" un alimento — lógica PURA.
 *
 * El motor ofrece todo el grupo de equivalentes SMAE del alimento (la tortilla
 * de nopal por tortilla de maíz o tostada horneada). La hoja lo parte en tres:
 * lo que ya está en casa primero, luego los equivalentes, y al final, en gris
 * y sin poderse elegir, lo que no va con esta comida y por qué ("no va con tu
 * papa"). Esconderlo hacía creer que no existía.
 *
 * Lo que ya va en otra comida de hoy SÍ se elige: sale al final de su
 * sección con la nota "también en otra comida" (3-oct, Mau).
 */

export type EquivalenciaDelMenu = MenuMeal["equivalences"][number];
export type OpcionDeEquivalencia = EquivalenciaDelMenu["options"][number];

export interface SeccionesDeEquivalencia {
  enDespensa: OpcionDeEquivalencia[];
  equivalentes: OpcionDeEquivalencia[];
  noVan: Array<{ texto: string; motivo: string }>;
}

/** La nota de una opción que se puede elegir pero ya va en otra comida de hoy. */
export const NOTA_EN_OTRA_COMIDA = "también en otra comida";

/** "Tortilla de maíz · 3 piezas" o "Arroz (160 g)" si no hay porción natural. */
export function textoDeOpcion(opcion: { name: string; grams: number; portion: string | null }): string {
  return opcion.portion ?? `${opcion.name} (${opcion.grams} g)`;
}

/** Lo que ya va en otra comida, al final de su sección; lo demás en su orden. */
function alFinalLasRepetidas(opciones: OpcionDeEquivalencia[]): OpcionDeEquivalencia[] {
  return [...opciones.filter((o) => o.enOtraComida !== true), ...opciones.filter((o) => o.enOtraComida === true)];
}

export function seccionesDeEquivalencia(eq: EquivalenciaDelMenu): SeccionesDeEquivalencia {
  return {
    enDespensa: alFinalLasRepetidas(eq.options.filter((o) => o.enDespensa === true)),
    equivalentes: alFinalLasRepetidas(eq.options.filter((o) => o.enDespensa !== true)),
    noVan: (eq.noVan ?? []).map((o) => ({ texto: textoDeOpcion(o), motivo: o.motivo })),
  };
}
