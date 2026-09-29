import { BASES_LICUADO, TIPOS_LECHE, type BaseLicuado, type TipoLeche } from "engine";

/**
 * La leche de la casa: la que va en licuados y cremas.
 *
 * Sin columna —el esquema no se toca sin migración—, vive como las marcas de
 * preparaciones: en los excluidos, como `leche:<tipo>`. Elegir entera ES
 * excluir las otras tres, y el motor así lo aplica. Descremada es el valor de
 * siempre y no deja marca.
 *
 * La marca nunca debe llegar al motor ni a la pantalla de excluidos: el motor
 * compara por subcadena y "leche:entera" contiene "leche", así que sacaría
 * todas las leches.
 */

const PREFIJO = "leche:";

export const TIPO_LECHE_DEFAULT: TipoLeche = "descremada";

function limpia(texto: string): string {
  return texto.trim().toLowerCase();
}

function esMarcaDeLeche(texto: string): boolean {
  return limpia(texto).startsWith(PREFIJO);
}

export function esTipoLeche(valor: unknown): valor is TipoLeche {
  return typeof valor === "string" && (TIPOS_LECHE as readonly string[]).includes(valor);
}

/** La leche que dicen los excluidos. Sin marca (o con una que no existe), descremada. */
export function tipoLecheDe(excluidos: string[]): TipoLeche {
  for (const texto of excluidos) {
    if (!esMarcaDeLeche(texto)) continue;
    const tipo = limpia(texto).slice(PREFIJO.length);
    if (esTipoLeche(tipo)) return tipo;
  }
  return TIPO_LECHE_DEFAULT;
}

/** Los excluidos con esa leche: reemplaza la marca y deja lo demás igual (la base incluida). */
export function conTipoLeche(excluidos: string[], tipo: TipoLeche): string[] {
  const resto = excluidos.filter((texto) => !esMarcaDeLeche(texto));
  return tipo === TIPO_LECHE_DEFAULT ? resto : [...resto, `${PREFIJO}${tipo}`];
}

/**
 * Los excluidos que son alimentos (o marcas de preparación), sin las marcas
 * de la leche de licuados: ni `leche:<tipo>` ni `base:agua`. Las dos
 * contienen el nombre de un alimento ("base:agua" contiene "agua") y el motor
 * compara por subcadena.
 */
export function sinMarcaDeLeche(excluidos: string[]): string[] {
  return excluidos.filter((texto) => !esMarcaDeLeche(texto) && !esMarcaDeBase(texto));
}

// ---------------------------------------------------------------------------
// Base de licuados: con la leche elegida o con agua
// ---------------------------------------------------------------------------

/**
 * Con qué se licua. Vive igual que la leche: como marca `base:agua` en los
 * excluidos. Leche es el valor de siempre y no deja marca.
 */
const PREFIJO_BASE = "base:";

export const BASE_LICUADO_DEFAULT: BaseLicuado = "leche";

function esMarcaDeBase(texto: string): boolean {
  return limpia(texto).startsWith(PREFIJO_BASE);
}

export function esBaseLicuado(valor: unknown): valor is BaseLicuado {
  return typeof valor === "string" && (BASES_LICUADO as readonly string[]).includes(valor);
}

/** La base que dicen los excluidos. Sin marca (o con una rara), leche. */
export function baseLicuadoDe(excluidos: string[]): BaseLicuado {
  for (const texto of excluidos) {
    if (!esMarcaDeBase(texto)) continue;
    const base = limpia(texto).slice(PREFIJO_BASE.length);
    if (esBaseLicuado(base)) return base;
  }
  return BASE_LICUADO_DEFAULT;
}

/** Los excluidos con esa base: reemplaza la marca y deja lo demás igual (la leche incluida). */
export function conBaseLicuado(excluidos: string[], base: BaseLicuado): string[] {
  const resto = excluidos.filter((texto) => !esMarcaDeBase(texto));
  return base === BASE_LICUADO_DEFAULT ? resto : [...resto, `${PREFIJO_BASE}${base}`];
}
