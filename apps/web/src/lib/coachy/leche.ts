import { TIPOS_LECHE, type TipoLeche } from "engine";

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

/** Los excluidos con esa leche: reemplaza la marca y deja lo demás igual. */
export function conTipoLeche(excluidos: string[], tipo: TipoLeche): string[] {
  const resto = sinMarcaDeLeche(excluidos);
  return tipo === TIPO_LECHE_DEFAULT ? resto : [...resto, `${PREFIJO}${tipo}`];
}

/** Los excluidos que son alimentos (o marcas de preparación), sin la de leche. */
export function sinMarcaDeLeche(excluidos: string[]): string[] {
  return excluidos.filter((texto) => !esMarcaDeLeche(texto));
}
