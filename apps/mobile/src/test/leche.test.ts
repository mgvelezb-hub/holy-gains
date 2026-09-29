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

import { BASES_DE_LICUADO, baseLicuadoDelPerfil, resumenLeche } from "@/lib/leche";

describe("base de licuados", () => {
  it("sin dato del servidor, leche", () => {
    expect(baseLicuadoDelPerfil(null)).toBe("leche");
    expect(baseLicuadoDelPerfil({ baseLicuado: "jugo" })).toBe("leche");
  });

  it("lee lo que manda /me", () => {
    expect(baseLicuadoDelPerfil({ baseLicuado: "agua" })).toBe("agua");
  });

  it("dos opciones: agua, o la leche elegida", () => {
    expect(BASES_DE_LICUADO.map((b) => b.clave)).toEqual(["agua", "leche"]);
    expect(BASES_DE_LICUADO.find((b) => b.clave === "leche")!.nombre).toBe("Leche (usa la leche elegida)");
  });

  it("el renglón de Ajustes lo dice cuando es agua", () => {
    expect(resumenLeche({ tipoLeche: "entera" })).toBe("leche entera");
    expect(resumenLeche({ tipoLeche: "entera", baseLicuado: "agua" })).toBe("leche entera · licuados con agua");
  });
});
