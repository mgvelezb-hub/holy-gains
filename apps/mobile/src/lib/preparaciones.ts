/**
 * Licuados, sopas y cremas en el menú — lógica PURA.
 *
 * El motor puede servir un platillo compuesto (el licuado del desayuno, la
 * crema de la comida) armado con alimentos del catálogo. La persona decide
 * qué tipos acepta; aquí viven los textos de esos interruptores, el resumen
 * del renglón de Ajustes y cómo se agrupa una comida para pintarla.
 */

export type PreferenciaPreparaciones = {
  licuados: boolean;
  sopas: boolean;
  cremas: boolean;
};

export const PREPARACIONES_TODAS: PreferenciaPreparaciones = {
  licuados: true,
  sopas: true,
  cremas: true,
};

export const TIPOS_DE_PREPARACION: ReadonlyArray<{
  clave: keyof PreferenciaPreparaciones;
  nombre: string;
  detalle: string;
}> = [
  {
    clave: "licuados",
    nombre: "Licuados",
    detalle: "En desayuno, colación o después de entrenar: proteína, fruta y avena en un vaso.",
  },
  {
    clave: "sopas",
    nombre: "Sopas y caldos",
    detalle: "En la comida o la cena: lentejas, frijol de olla, caldo de pollo con verdura.",
  },
  {
    clave: "cremas",
    nombre: "Cremas",
    detalle: "De calabacita, espinaca, champiñón o elote, con leche descremada, sin crema.",
  },
];

/** Lo que manda `/me` en `profile.preparaciones`; sin dato, todo prendido. */
export function preferenciaDelPerfil(perfil: unknown): PreferenciaPreparaciones {
  if (typeof perfil !== "object" || perfil === null) return PREPARACIONES_TODAS;
  const crudo = (perfil as { preparaciones?: unknown }).preparaciones;
  if (typeof crudo !== "object" || crudo === null) return PREPARACIONES_TODAS;
  const valores = crudo as Record<string, unknown>;
  const lee = (clave: keyof PreferenciaPreparaciones): boolean =>
    typeof valores[clave] === "boolean" ? (valores[clave] as boolean) : true;
  return { licuados: lee("licuados"), sopas: lee("sopas"), cremas: lee("cremas") };
}

/** "Todas", "Ninguna", "Solo sopas", "Licuados y cremas". */
export function resumenPreparaciones(preferencia: PreferenciaPreparaciones): string {
  const nombres: Record<keyof PreferenciaPreparaciones, string> = {
    licuados: "licuados",
    sopas: "sopas",
    cremas: "cremas",
  };
  const prendidas = TIPOS_DE_PREPARACION.filter((tipo) => preferencia[tipo.clave]).map(
    (tipo) => nombres[tipo.clave],
  );
  if (prendidas.length === TIPOS_DE_PREPARACION.length) return "Todas";
  if (prendidas.length === 0) return "Ninguna";
  if (prendidas.length === 1) return `Solo ${prendidas[0]}`;
  const texto = prendidas.join(" y ");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Una comida lista para pintar: el platillo (si lo hay) con sus ingredientes,
 * y después lo que va suelto, cada cosa en su orden original.
 */
export function agruparComida<T extends { preparacionId?: string }>(
  items: T[],
  preparacion: { id: string; nombre: string } | undefined,
): { platillo: { id: string; nombre: string } | null; ingredientes: T[]; sueltos: T[] } {
  if (!preparacion) return { platillo: null, ingredientes: [], sueltos: items };
  return {
    platillo: preparacion,
    ingredientes: items.filter((item) => item.preparacionId === preparacion.id),
    sueltos: items.filter((item) => item.preparacionId !== preparacion.id),
  };
}
