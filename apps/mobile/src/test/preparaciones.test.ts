import { describe, expect, it } from "vitest";

import {
  PREPARACIONES_TODAS,
  TIPOS_DE_PREPARACION,
  agruparComida,
  preferenciaDelPerfil,
  resumenPreparaciones,
} from "@/lib/preparaciones";

describe("preferencia de preparaciones", () => {
  it("sin dato del servidor, todas prendidas", () => {
    expect(preferenciaDelPerfil(null)).toEqual(PREPARACIONES_TODAS);
    expect(preferenciaDelPerfil({})).toEqual(PREPARACIONES_TODAS);
  });

  it("lee lo que manda /me y descarta lo que no sea booleano", () => {
    expect(
      preferenciaDelPerfil({ preparaciones: { licuados: false, sopas: "no", cremas: true } }),
    ).toEqual({ licuados: false, sopas: true, cremas: true });
  });

  it("el renglón dice el estado en una línea", () => {
    expect(resumenPreparaciones(PREPARACIONES_TODAS)).toBe("Todas");
    expect(resumenPreparaciones({ licuados: false, sopas: false, cremas: false })).toBe("Ninguna");
    expect(resumenPreparaciones({ licuados: true, sopas: false, cremas: true })).toBe(
      "Licuados y cremas",
    );
    expect(resumenPreparaciones({ licuados: false, sopas: true, cremas: false })).toBe("Solo sopas");
  });

  it("los tres interruptores traen nombre y detalle", () => {
    expect(TIPOS_DE_PREPARACION.map((t) => t.clave)).toEqual(["licuados", "sopas", "cremas"]);
    for (const tipo of TIPOS_DE_PREPARACION) expect(tipo.detalle.length).toBeGreaterThan(10);
  });
});

describe("la comida agrupa el platillo", () => {
  const items = [
    { name: "Pechuga", preparacionId: undefined },
    { name: "Calabacita", preparacionId: "crema_calabacita" },
    { name: "Leche descremada", preparacionId: "crema_calabacita" },
    { name: "Arroz" },
  ];

  it("el platillo va primero con sus ingredientes; lo suelto después", () => {
    const grupo = agruparComida(items, { id: "crema_calabacita", nombre: "Crema de calabacita" });
    expect(grupo.platillo?.nombre).toBe("Crema de calabacita");
    expect(grupo.ingredientes.map((i) => i.name)).toEqual(["Calabacita", "Leche descremada"]);
    expect(grupo.sueltos.map((i) => i.name)).toEqual(["Pechuga", "Arroz"]);
  });

  it("sin platillo, todo suelto y en su orden", () => {
    const grupo = agruparComida(items, undefined);
    expect(grupo.platillo).toBeNull();
    expect(grupo.ingredientes).toEqual([]);
    expect(grupo.sueltos).toHaveLength(4);
  });
});
