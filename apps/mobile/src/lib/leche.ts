/**
 * La leche de licuados y cremas — lógica PURA.
 *
 * Entera, deslactosada o light cambian calorías y grasa del platillo; el
 * motor mueve las demás porciones para que el día siga cuadrando. Aquí viven
 * las cuatro opciones de Ajustes y cómo se lee lo que manda `/me`.
 */

export type TipoLeche = "descremada" | "entera" | "deslactosada" | "deslactosada_light";

export const TIPO_LECHE_DEFAULT: TipoLeche = "descremada";

export const TIPOS_DE_LECHE: ReadonlyArray<{ clave: TipoLeche; nombre: string }> = [
  { clave: "descremada", nombre: "Descremada" },
  { clave: "entera", nombre: "Entera" },
  { clave: "deslactosada", nombre: "Deslactosada" },
  { clave: "deslactosada_light", nombre: "Deslactosada light" },
];

function esTipoLeche(valor: unknown): valor is TipoLeche {
  return TIPOS_DE_LECHE.some((tipo) => tipo.clave === valor);
}

/** Lo que manda `/me` en `profile.tipoLeche`; sin dato (o uno raro), descremada. */
export function tipoLecheDelPerfil(perfil: unknown): TipoLeche {
  if (typeof perfil !== "object" || perfil === null) return TIPO_LECHE_DEFAULT;
  const crudo = (perfil as { tipoLeche?: unknown }).tipoLeche;
  return esTipoLeche(crudo) ? crudo : TIPO_LECHE_DEFAULT;
}

/** "Deslactosada light". */
export function nombreDeLeche(tipo: TipoLeche): string {
  return TIPOS_DE_LECHE.find((t) => t.clave === tipo)?.nombre ?? "Descremada";
}

// ---------------------------------------------------------------------------
// Base de licuados
// ---------------------------------------------------------------------------

/**
 * Con qué se licua: la leche elegida arriba o agua. Con agua el licuado no
 * lleva los macros de la taza de leche; el plan los mueve a otra comida.
 */
export type BaseLicuado = "leche" | "agua";

export const BASE_LICUADO_DEFAULT: BaseLicuado = "leche";

export const BASES_DE_LICUADO: ReadonlyArray<{ clave: BaseLicuado; nombre: string }> = [
  { clave: "agua", nombre: "Agua" },
  { clave: "leche", nombre: "Leche (usa la leche elegida)" },
];

/** Lo que manda `/me` en `profile.baseLicuado`; sin dato (o uno raro), leche. */
export function baseLicuadoDelPerfil(perfil: unknown): BaseLicuado {
  if (typeof perfil !== "object" || perfil === null) return BASE_LICUADO_DEFAULT;
  const crudo = (perfil as { baseLicuado?: unknown }).baseLicuado;
  return crudo === "agua" || crudo === "leche" ? crudo : BASE_LICUADO_DEFAULT;
}

/** El resumen del renglón de Ajustes: "leche entera · licuados con agua". */
export function resumenLeche(perfil: unknown): string {
  const leche = `leche ${nombreDeLeche(tipoLecheDelPerfil(perfil)).toLowerCase()}`;
  return baseLicuadoDelPerfil(perfil) === "agua" ? `${leche} · licuados con agua` : leche;
}
