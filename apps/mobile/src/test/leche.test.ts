import { describe, expect, it } from "vitest";

import { TIPOS_DE_LECHE, nombreDeLeche, tipoLecheDelPerfil } from "@/lib/leche";

describe("tipo de leche", () => {
  it("sin dato del servidor, descremada", () => {
    expect(tipoLecheDelPerfil(null)).toBe("descremada");
    expect(tipoLecheDelPerfil({})).toBe("descremada");
    expect(tipoLecheDelPerfil({ tipoLeche: "de almendra" })).toBe("descremada");
  });

  it("lee lo que manda /me", () => {
    expect(tipoLecheDelPerfil({ tipoLeche: "deslactosada_light" })).toBe("deslactosada_light");
  });

  it("cuatro opciones, cada una cabe en una línea", () => {
    expect(TIPOS_DE_LECHE.map((t) => t.clave)).toEqual([
      "descremada",
      "entera",
      "deslactosada",
      "deslactosada_light",
    ]);
    for (const tipo of TIPOS_DE_LECHE) expect(tipo.nombre.length).toBeLessThanOrEqual(26);
  });

  it("el nombre se lee como en el menú: 'leche deslactosada light'", () => {
    expect(nombreDeLeche("deslactosada_light")).toBe("Deslactosada light");
  });
});
