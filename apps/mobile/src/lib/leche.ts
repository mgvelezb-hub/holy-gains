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
