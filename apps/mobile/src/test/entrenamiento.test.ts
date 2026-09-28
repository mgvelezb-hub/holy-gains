import { describe, expect, it } from "vitest";

import type { OtherSessionView } from "@/lib/api";
import { etiquetaDelDia, lineaDelDia, ordenarBloquesDelDia } from "@/lib/entrenamiento";

/**
 * Orden de los bloques de un día combinado (Fase 7).
 *
 * Lo que se cuida: que el gimnasio ocupe la posición que la otra disciplina
 * no usa, y que dos disciplinas sin gym se ordenen solo por `orden`. Un error
 * aquí no se ve en un día normal —solo en el que de verdad combina dos
 * compromisos— así que la prueba es la única red antes de que alguien lo note
 * en su teléfono.
 */

function otra(overrides: Partial<OtherSessionView> = {}): OtherSessionView {
  return {
    date: "2026-08-30",
    weekday: "SAB",
    discipline: "NATACION",
    minutes: 45,
    sesion: null,
    note: "",
    sharesDayWithGym: true,
    orden: 2,
    ...overrides,
  };
}

const GYM = { muscleGroup: "Pierna" };

describe("ordenarBloquesDelDia", () => {
  it("un día sin nada regresa vacío", () => {
    expect(ordenarBloquesDelDia(null, [])).toEqual([]);
  });

  it("solo gym: un bloque", () => {
    expect(ordenarBloquesDelDia(GYM, [])).toEqual([{ tipo: "gym", data: GYM }]);
  });

  it("solo una disciplina, sin gym: un bloque", () => {
    const s = otra({ discipline: "SQUASH" });
    expect(ordenarBloquesDelDia(null, [s])).toEqual([{ tipo: "otra", data: s }]);
  });

  it("gym + disciplina con orden 2: el gym va primero", () => {
    const s = otra({ discipline: "NATACION", orden: 2 });
    const bloques = ordenarBloquesDelDia(GYM, [s]);
    expect(bloques.map((b) => b.tipo)).toEqual(["gym", "otra"]);
  });

  it("gym + disciplina con orden 1 (ej. squash con piernas frescas): la otra va primero", () => {
    const s = otra({ discipline: "SQUASH", orden: 1 });
    const bloques = ordenarBloquesDelDia(GYM, [s]);
    expect(bloques.map((b) => b.tipo)).toEqual(["otra", "gym"]);
  });

  it("dos disciplinas sin gym: se ordenan por `orden`", () => {
    const primero = otra({ discipline: "SQUASH", orden: 1 });
    const segundo = otra({ discipline: "NATACION", orden: 2 });
    // Se pasan en el orden contrario a propósito: la función es la que ordena.
    const bloques = ordenarBloquesDelDia(null, [segundo, primero]);
    expect(bloques).toEqual([
      { tipo: "otra", data: primero },
      { tipo: "otra", data: segundo },
    ]);
  });

  it("orden ausente (dato viejo cacheado) se trata como 2, no rompe", () => {
    const s = { ...otra({ discipline: "SQUASH" }) } as OtherSessionView;
    // @ts-expect-error — simula un registro cacheado antes de esta fase.
    delete s.orden;
    const bloques = ordenarBloquesDelDia(GYM, [s]);
    expect(bloques.map((b) => b.tipo)).toEqual(["gym", "otra"]);
  });
});

describe("etiquetaDelDia", () => {
  it("un solo bloque: su propio nombre", () => {
    expect(etiquetaDelDia([{ tipo: "gym", data: GYM }])).toBe("Pierna");
  });

  it("dos bloques: unidos por flecha, en el orden dado", () => {
    const squash = otra({ discipline: "SQUASH" });
    const natacion = otra({ discipline: "NATACION" });
    expect(
      etiquetaDelDia([
        { tipo: "otra", data: squash },
        { tipo: "otra", data: natacion },
      ]),
    ).toBe("Squash → Natación");
  });

  it("gym + disciplina: el grupo muscular junto al nombre de la disciplina", () => {
    const natacion = otra({ discipline: "NATACION" });
    expect(
      etiquetaDelDia([
        { tipo: "gym", data: GYM },
        { tipo: "otra", data: natacion },
      ]),
    ).toBe("Pierna → Natación");
  });
});

describe("lineaDelDia: gym + cardio después (H2)", () => {
  const CARDIO = otra({
    discipline: "CARDIO",
    minutes: 20,
    gymMinutes: 70,
    sesion: {
      discipline: "CARDIO",
      nivel: "PRINCIPIANTE",
      focus: "HIIT",
      unidad: "min",
      cargaTotal: 19,
      minutes: 20,
      blocks: [],
      deload: false,
      notes: [],
      cardio: {
        equipo: "CAMINADORA",
        tipo: "HIIT",
        nivelMaquina: 8,
        etiqueta: "Cardio HIIT caminadora",
        intervalos: { rondas: 7, fuerteSeg: 60, suaveSeg: 60, nivelFuerte: 8, nivelSuave: 3 },
        calentamientoSeg: 180,
        enfriamientoSeg: 120,
      },
    },
  });

  it("se lee 'Gym · 70 min + Cardio HIIT caminadora · 20 min'", () => {
    expect(lineaDelDia(ordenarBloquesDelDia(GYM, [CARDIO]))).toBe(
      "Gym · 70 min + Cardio HIIT caminadora · 20 min",
    );
  });

  it("sin minutos de gym recortados, el gym va sin número", () => {
    expect(lineaDelDia(ordenarBloquesDelDia(GYM, [{ ...CARDIO, gymMinutes: undefined }]))).toBe(
      "Gym + Cardio HIIT caminadora · 20 min",
    );
  });

  it("fuera de gym + cardio, es la etiqueta de siempre", () => {
    expect(lineaDelDia(ordenarBloquesDelDia(GYM, [otra()]))).toBe(etiquetaDelDia(ordenarBloquesDelDia(GYM, [otra()])));
  });
});

describe("partesDelDia (I1)", () => {
  it("parte la línea del servidor en título y detalle", async () => {
    const { partesDelDia, diaDelPlan } = await import("@/lib/entrenamiento");
    expect(
      partesDelDia({
        gym: { muscleGroup: "Pierna · cuádriceps" },
        linea: "Pierna · cuádriceps · 6 ejercicios · + Cardio HIIT 20 min",
      }),
    ).toEqual({ titulo: "Pierna · cuádriceps", detalle: "6 ejercicios · + Cardio HIIT 20 min" });
    expect(partesDelDia({ gym: null, linea: "Natación 45 min" })).toEqual({ titulo: "Natación 45 min", detalle: "" });
    expect(diaDelPlan(undefined, "2026-09-28")).toBeNull();
    expect(diaDelPlan([{ date: "2026-09-28" }], "2026-09-28")).toEqual({ date: "2026-09-28" });
  });
});
