import type { PreferenciaPreparaciones } from "engine";

/**
 * Qué platillos compuestos acepta el menú (licuados, sopas, cremas).
 *
 * No hay columna para esto y el esquema no se toca sin migración, así que la
 * preferencia vive donde ya significa lo mismo: en lo que la persona excluye.
 * "No me des licuados" ES una exclusión, y así se lee en "Lo que sí y lo que
 * no". Las marcas van en plural —`licuados`, `sopas`, `cremas`— porque el
 * singular "crema" coincidiría con la crema de cacahuate al excluir alimentos.
 *
 * Funciones puras: el perfil las lee en `toEngineProfile` y la ruta de
 * Nutrición las escribe; nadie más necesita saber dónde se guarda.
 */

export const PREPARACIONES_TODAS: PreferenciaPreparaciones = {
  licuados: true,
  sopas: true,
  cremas: true,
};

/** Tres marcas: los platillos (tacos, tostadas) siguen a las sopas en el motor. */
type TipoConMarca = "licuados" | "sopas" | "cremas";

const MARCAS: Record<TipoConMarca, string> = {
  licuados: "licuados",
  sopas: "sopas",
  cremas: "cremas",
};

const TIPOS = Object.keys(MARCAS) as TipoConMarca[];

function normaliza(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function esMarca(texto: string): boolean {
  const limpio = normaliza(texto);
  return TIPOS.some((tipo) => MARCAS[tipo] === limpio);
}

/** La preferencia que dicen los excluidos. Sin marcas, todo prendido. */
export function preferenciaDePreparaciones(excluidos: string[]): PreferenciaPreparaciones {
  const limpios = new Set(excluidos.map(normaliza));
  return {
    licuados: !limpios.has(MARCAS.licuados),
    sopas: !limpios.has(MARCAS.sopas),
    cremas: !limpios.has(MARCAS.cremas),
  };
}

/** Los excluidos con la preferencia aplicada: agrega o quita solo las marcas. */
export function conPreferenciaDePreparaciones(
  excluidos: string[],
  preferencia: PreferenciaPreparaciones,
): string[] {
  const resto = excluidos.filter((texto) => !esMarca(texto));
  const apagadas = TIPOS.filter((tipo) => !preferencia[tipo]).map((tipo) => MARCAS[tipo]);
  return [...resto, ...apagadas];
}

/** Los excluidos que son alimentos: lo que el motor compara contra el catálogo. */
export function sinMarcasDePreparacion(excluidos: string[]): string[] {
  return excluidos.filter((texto) => !esMarca(texto));
}
