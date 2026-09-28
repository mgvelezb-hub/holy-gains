import { describe, expect, it } from "vitest";

import {
  DIAS_MENSUAL,
  construyeBloqueMensual,
  clasificaMensuales,
  deltasMensuales,
  proximoMensual,
  traeMedidasMensuales,
  ultimoMensualAntesDe,
  valoraAvance,
  type MedidaCheckIn,
} from "@/lib/coachy/mensual";

/**
 * El mensual como concepto del servidor.
 *
 * Hasta ahora "mensual" solo existía en el teléfono (abrir brazos y piernas si
 * ya pasó un mes). Aquí se vuelve una regla pura: un check-in es mensual si
 * trae brazos/piernas o si pasaron 28 días desde el último mensual. Con eso el
 * servidor sabe cuándo forzar menú nuevo, fotos contra la referencia y el
 * contador que ve la persona en Hoy.
 */

function ci(id: string, fecha: string, medidas: Partial<MedidaCheckIn> = {}): MedidaCheckIn {
  return {
    id,
    fecha,
    cinturaCm: 90,
    pesoKg: 75,
    brazoIzqCm: null,
    brazoDerCm: null,
    piernaIzqCm: null,
    piernaDerCm: null,
    ...medidas,
  };
}

const conBrazos = { brazoIzqCm: 30, brazoDerCm: 30.5, piernaIzqCm: 55, piernaDerCm: 55.5 };

describe("traeMedidasMensuales", () => {
  it("basta una medida de brazo o pierna", () => {
    expect(traeMedidasMensuales(ci("a", "2026-08-02"))).toBe(false);
    expect(traeMedidasMensuales(ci("a", "2026-08-02", { piernaDerCm: 55 }))).toBe(true);
  });
});

describe("clasificaMensuales", () => {
  it("el primero es el ancla y solo es mensual si trae brazos/piernas", () => {
    const sin = clasificaMensuales([ci("a", "2026-08-02")]);
    expect(sin.get("a")).toBe(false);

    const con = clasificaMensuales([ci("a", "2026-08-02", conBrazos)]);
    expect(con.get("a")).toBe(true);
  });

  it("es mensual al cumplir 28 días desde el último mensual aunque no traiga brazos", () => {
    const serie = [
      ci("s0", "2026-08-02", conBrazos),
      ci("s1", "2026-08-09"),
      ci("s2", "2026-08-16"),
      ci("s3", "2026-08-23"),
      ci("s4", "2026-08-30"),
      ci("s5", "2026-09-06"),
    ];
    const mapa = clasificaMensuales(serie);
    expect([...mapa.values()]).toEqual([true, false, false, false, true, false]);
  });

  it("traer brazos antes de tiempo reinicia el contador", () => {
    const serie = [
      ci("s0", "2026-08-02"),
      ci("s1", "2026-08-16", conBrazos),
      ci("s2", "2026-09-06"),
      ci("s3", "2026-09-13"),
    ];
    const mapa = clasificaMensuales(serie);
    // s1 trae brazos → mensual; s2 va a 21 días de s1 → no; s3 a 28 → sí.
    expect([...mapa.values()]).toEqual([false, true, false, true]);
  });

  it("ordena la serie antes de clasificar", () => {
    const mapa = clasificaMensuales([ci("b", "2026-09-01"), ci("a", "2026-08-01", conBrazos)]);
    expect(mapa.get("a")).toBe(true);
    expect(mapa.get("b")).toBe(true);
  });
});

describe("ultimoMensualAntesDe", () => {
  it("devuelve el mensual previo, contando el ancla inicial", () => {
    const serie = [ci("s0", "2026-08-02"), ci("s1", "2026-08-09"), ci("s2", "2026-08-30")];
    expect(ultimoMensualAntesDe(serie, "s2")?.id).toBe("s0");
    expect(ultimoMensualAntesDe(serie, "s0")).toBeNull();
  });
});

describe("deltasMensuales", () => {
  it("compara contra el mensual anterior y contra el inicio, con un decimal", () => {
    const serie = [
      ci("s0", "2026-08-02", { cinturaCm: 92, pesoKg: 78, ...conBrazos }),
      ci("s1", "2026-08-09", { cinturaCm: 91.4 }),
      ci("s2", "2026-08-30", { cinturaCm: 90.1, pesoKg: 77.25, brazoIzqCm: 30.4, brazoDerCm: 30.5 }),
    ];
    const deltas = deltasMensuales(serie, "s2");

    expect(deltas.cintura).toEqual({ actual: 90.1, vsMesAnterior: -1.9, vsInicio: -1.9 });
    expect(deltas.peso.vsMesAnterior).toBe(-0.8);
    expect(deltas.brazoIzq).toEqual({ actual: 30.4, vsMesAnterior: 0.4, vsInicio: 0.4 });
    expect(deltas.brazoDer.vsMesAnterior).toBe(0);
    // No trajo piernas: sin dato no hay delta.
    expect(deltas.piernaIzq).toEqual({ actual: null, vsMesAnterior: null, vsInicio: null });
  });

  it("si el mensual anterior no midió brazos, usa la última medida antes de él", () => {
    const serie = [
      ci("s0", "2026-07-05", { brazoIzqCm: 29 }),
      ci("s1", "2026-08-02"),
      ci("s2", "2026-08-30", { brazoIzqCm: 30 }),
    ];
    const deltas = deltasMensuales(serie, "s2");
    expect(deltas.brazoIzq.vsMesAnterior).toBe(1);
    expect(deltas.brazoIzq.vsInicio).toBe(1);
  });
});

describe("valoraAvance", () => {
  it("cintura abajo con báscula quieta se lee como recomposición", () => {
    const { vaBien, ajustar } = valoraAvance({
      periodo: "mes",
      cinturaDelta: -1.2,
      pesoDelta: 0.1,
      brazosDelta: null,
      piernasDelta: null,
      fotos: [],
      cumplimientoDieta: 90,
      cumplimientoEntreno: 60,
      goal: "RECOMPOSICION",
    });
    expect(vaBien.join(" ")).toMatch(/cintura/i);
    expect(vaBien.join(" ")).toMatch(/recomposición/i);
    expect(ajustar.join(" ")).toMatch(/entreno/i);
  });

  it("las fotos que se alejan van a ajustar y las que se acercan a va bien", () => {
    const { vaBien, ajustar } = valoraAvance({
      periodo: "mes",
      cinturaDelta: 0,
      pesoDelta: 0,
      brazosDelta: null,
      piernasDelta: null,
      fotos: [
        { zona: "espalda", brecha: "media", tendencia: "acercándose", accion: "seguir_igual" },
        { zona: "pierna", brecha: "lejos", tendencia: "alejándose", accion: "mas_volumen_pierna" },
      ],
      cumplimientoDieta: 80,
      cumplimientoEntreno: 80,
      goal: "RECOMPOSICION",
    });
    expect(vaBien.some((linea) => linea.startsWith("Espalda"))).toBe(true);
    expect(ajustar.some((linea) => linea.startsWith("Pierna"))).toBe(true);
  });

  it("nunca deja las dos listas vacías ni pasa de cuatro renglones", () => {
    const vacio = valoraAvance({
      periodo: "semana",
      cinturaDelta: null,
      pesoDelta: null,
      brazosDelta: null,
      piernasDelta: null,
      fotos: [],
      cumplimientoDieta: 80,
      cumplimientoEntreno: 80,
      goal: "SALUD",
    });
    expect(vacio.vaBien.length + vacio.ajustar.length).toBeGreaterThan(0);

    const lleno = valoraAvance({
      periodo: "mes",
      cinturaDelta: -2,
      pesoDelta: 0,
      brazosDelta: 0.5,
      piernasDelta: 0.5,
      fotos: ["cintura", "espalda", "brazo", "pierna", "cadera_gluteo"].map((zona) => ({
        zona: zona as "cintura",
        brecha: "cerca" as const,
        tendencia: "acercándose" as const,
        accion: "seguir_igual" as const,
      })),
      cumplimientoDieta: 95,
      cumplimientoEntreno: 95,
      goal: "RECOMPOSICION",
    });
    expect(lleno.vaBien.length).toBeLessThanOrEqual(4);
  });
});

describe("construyeBloqueMensual", () => {
  it("un check-in semanal lleva el bloque apagado, sin deltas ni fotos", () => {
    const serie = [ci("s0", "2026-08-02"), ci("s1", "2026-08-09")];
    const bloque = construyeBloqueMensual({
      serie,
      checkInId: "s1",
      fotos: null,
      cumplimientoDieta: 80,
      cumplimientoEntreno: 80,
      goal: "RECOMPOSICION",
    });
    expect(bloque.esMensual).toBe(false);
    expect(bloque.previoMensualId).toBe("s0");
  });

  it("un mensual trae deltas, fotos y objetivo", () => {
    const serie = [ci("s0", "2026-08-02", { cinturaCm: 92 }), ci("s1", "2026-08-30", { cinturaCm: 90 })];
    const bloque = construyeBloqueMensual({
      serie,
      checkInId: "s1",
      fotos: {
        estado: "listo",
        zonas: [{ zona: "cintura", brecha: "media", tendencia: "acercándose", accion: "seguir_igual" }],
      },
      cumplimientoDieta: 90,
      cumplimientoEntreno: 90,
      goal: "PERDIDA_GRASA",
    });
    expect(bloque.esMensual).toBe(true);
    expect(bloque.previoMensualId).toBe("s0");
    expect(bloque.deltas.cintura.vsMesAnterior).toBe(-2);
    expect(bloque.fotos?.zonas).toHaveLength(1);
    expect(bloque.objetivo.vaBien.length).toBeGreaterThan(0);
  });
});

describe("proximoMensual", () => {
  it("cuenta las semanas que faltan desde el último mensual", () => {
    const serie = [ci("s0", "2026-09-06", conBrazos), ci("s1", "2026-09-13")];
    expect(proximoMensual(serie, "2026-09-14")).toEqual({
      semanas: 3,
      fecha: "2026-10-04",
      ultimoMensual: "2026-09-06",
    });
  });

  it("se queda en cero cuando ya toca, y se reinicia al registrar el mensual", () => {
    const antes = [ci("s0", "2026-08-02", conBrazos), ci("s1", "2026-08-23")];
    expect(proximoMensual(antes, "2026-09-10")?.semanas).toBe(0);

    const despues = [...antes, ci("s2", "2026-09-10")];
    expect(proximoMensual(despues, "2026-09-10")).toEqual({
      semanas: 4,
      fecha: "2026-10-08",
      ultimoMensual: "2026-09-10",
    });
  });

  it("sin check-ins no hay contador", () => {
    expect(proximoMensual([], "2026-09-10")).toBeNull();
  });

  it("la regla es la de 28 días", () => {
    expect(DIAS_MENSUAL).toBe(28);
  });
});
