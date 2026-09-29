import { describe, expect, it } from "vitest";

import type { DetalleCardio } from "@/lib/api";
import { actividadDeCardio, notasDeCardio, pasosDeCardio, renglonDeCardio, tituloTarjetaCardio } from "@/lib/cardio";

/**
 * H2 — el bloque de cardio al cerrar la última serie: su tarjeta, los pasos
 * que corre el timer del calentamiento dinámico y lo que se registra.
 */

const HIIT: DetalleCardio = {
  equipo: "CAMINADORA",
  tipo: "HIIT",
  nivelMaquina: 8,
  etiqueta: "Cardio HIIT caminadora",
  intervalos: { rondas: 7, fuerteSeg: 60, suaveSeg: 60, nivelFuerte: 8, nivelSuave: 3 },
  calentamientoSeg: 180,
  enfriamientoSeg: 120,
};

describe("cardio después de pesas", () => {
  it("la tarjeta se lee 'Cardio · 20 min · caminadora HIIT nivel 8'", () => {
    expect(tituloTarjetaCardio(HIIT, 20)).toBe("Cardio · 20 min · caminadora HIIT nivel 8");
    expect(tituloTarjetaCardio({ ...HIIT, equipo: "LIBRE" }, 20)).toBe("Cardio · 20 min · HIIT");
  });

  it("HIIT: calentamiento, rondas fuerte/suave con su nivel, enfriamiento", () => {
    const pasos = pasosDeCardio(HIIT, 20);
    expect(pasos[0]).toEqual({ nombre: "Calentamiento · nivel 3", segundos: 180 });
    expect(pasos[1]).toEqual({ nombre: "Fuerte · nivel 8 · ronda 1 de 7", segundos: 60 });
    expect(pasos[2]).toEqual({ nombre: "Suave · nivel 3 · ronda 1 de 7", segundos: 60 });
    expect(pasos.at(-1)).toEqual({ nombre: "Enfriamiento", segundos: 120 });
    expect(pasos).toHaveLength(1 + 7 * 2 + 1);
  });

  it("continuo: un solo tramo de zona 2 con lo que queda del bloque", () => {
    const pasos = pasosDeCardio({ ...HIIT, tipo: "CONTINUO", intervalos: null, nivelMaquina: 7 }, 20);
    expect(pasos.map((paso) => paso.segundos)).toEqual([180, 20 * 60 - 180 - 120, 120]);
    expect(pasos[1]!.nombre).toBe("Zona 2 · nivel 7");
  });

  it("registra minutos reales, tipo y nivel como sesión de CARDIO del día", () => {
    const inicio = new Date("2026-09-28T19:30:00.000Z");
    const fin = new Date("2026-09-28T19:49:40.000Z");
    expect(actividadDeCardio(HIIT, "2026-09-28", inicio, fin)).toEqual({
      discipline: "CARDIO",
      source: "APP",
      externalId: null,
      startedAt: inicio.toISOString(),
      endedAt: fin.toISOString(),
      date: "2026-09-28",
      durationMin: 20,
      notes: notasDeCardio(HIIT),
    });
    expect(notasDeCardio(HIIT)).toBe("HIIT · caminadora · nivel 8");
  });
});

describe("renglón de Ajustes (H2)", () => {
  it("'Cardio · 5/semana · después de pesas · HIIT caminadora 20 min'", () => {
    expect(
      renglonDeCardio({
        discipline: "CARDIO",
        sessionsPerWeek: 5,
        modo: "DESPUES",
        cardio: { equipo: "CAMINADORA", tipo: "HIIT", minutos: 20 },
      }),
    ).toBe("Cardio · 5/semana · después de pesas · HIIT caminadora 20 min");
  });

  it("sin preferencias declaradas usa los defaults del motor", () => {
    expect(renglonDeCardio({ discipline: "CARDIO", sessionsPerWeek: 1, modo: "DESPUES" })).toBe(
      "Cardio · 1/semana · después de pesas · HIIT caminadora 20 min",
    );
  });
});

/**
 * N2 — el cardio como sesión propia: se empieza cuando sea, se pausa, se
 * retoma al volver de otra app y registra solo lo corrido.
 */
import {
  activoMsCorredor,
  alcanzarCorredor,
  cardioDeLaFecha,
  corredorGuardado,
  esCardioConPlan,
  finDelCorredor,
  hayPesasPendientes,
  iniciarCorredor,
  lunesDe,
  minutosDeCardioHechos,
  pausarCorredor,
  reanudarCorredor,
  restanteDelPasoSeg,
  saltarPasoCorredor,
  terminarCorredor,
} from "@/lib/cardio";
import type { OtherSessionView } from "@/lib/api";

describe("N2 · corredor de cardio", () => {
  const PASOS = [
    { nombre: "4–5 km/h · Fácil", segundos: 120 },
    { nombre: "6–7 km/h · Moderado", segundos: 60 },
    { nombre: "5–6 km/h · Caminata suave", segundos: 180 },
  ];
  const T0 = 1_000_000;

  it("arranca en el primer tramo con su hora de término", () => {
    const e = iniciarCorredor("2026-09-28", PASOS, T0);
    expect(e.paso).toBe(0);
    expect(e.hasta).toBe(T0 + 120_000);
    expect(restanteDelPasoSeg(e, T0 + 30_000)).toBe(90);
  });

  it("al volver tarde avanza por los tramos vencidos, cada uno desde donde terminó el anterior", () => {
    const e = iniciarCorredor("2026-09-28", PASOS, T0);
    const alDia = alcanzarCorredor(e, PASOS, T0 + 200_000);
    expect(alDia.paso).toBe(2);
    expect(alDia.hasta).toBe(T0 + 360_000);
    expect(alcanzarCorredor(alDia, PASOS, T0 + 200_000)).toBe(alDia);
  });

  it("tras el último tramo termina en la hora en que venció, no en la que se volvió a mirar", () => {
    const e = iniciarCorredor("2026-09-28", PASOS, T0);
    const fin = alcanzarCorredor(e, PASOS, T0 + 3_600_000);
    expect(fin.terminado).toBe(true);
    expect(finDelCorredor(fin, T0 + 3_600_000)).toBe(T0 + 360_000);
    expect(activoMsCorredor(fin, finDelCorredor(fin, T0 + 3_600_000))).toBe(360_000);
  });

  it("la pausa congela el tramo y no cuenta como corrido", () => {
    const e = iniciarCorredor("2026-09-28", PASOS, T0);
    const pausado = pausarCorredor(e, T0 + 30_000);
    expect(pausado.hasta).toBeNull();
    expect(restanteDelPasoSeg(pausado, T0 + 500_000)).toBe(90);
    expect(alcanzarCorredor(pausado, PASOS, T0 + 500_000)).toBe(pausado);
    const sigue = reanudarCorredor(pausado, T0 + 90_000);
    expect(sigue.hasta).toBe(T0 + 90_000 + 90_000);
    expect(activoMsCorredor(sigue, T0 + 100_000)).toBe(40_000);
  });

  it("'Terminar aquí' registra lo corrido hasta ese momento", () => {
    const e = iniciarCorredor("2026-09-28", PASOS, T0);
    const fin = terminarCorredor(e, T0 + 75_000);
    expect(fin.terminado).toBe(true);
    expect(activoMsCorredor(fin, finDelCorredor(fin, T0 + 999_000))).toBe(75_000);
  });

  it("saltar el último tramo termina", () => {
    let e = iniciarCorredor("2026-09-28", PASOS, T0);
    e = saltarPasoCorredor(e, PASOS, T0 + 10_000);
    expect(e.paso).toBe(1);
    expect(e.hasta).toBe(T0 + 10_000 + 60_000);
    e = saltarPasoCorredor(saltarPasoCorredor(e, PASOS, T0 + 20_000), PASOS, T0 + 30_000);
    expect(e.terminado).toBe(true);
  });

  it("el cursor guardado solo vale para esa fecha y ese plan", () => {
    const e = pausarCorredor(iniciarCorredor("2026-09-28", PASOS, T0), T0 + 5_000);
    const crudo = JSON.parse(JSON.stringify(e));
    expect(corredorGuardado(crudo, "2026-09-28", PASOS.length)).toEqual(e);
    expect(corredorGuardado(crudo, "2026-09-29", PASOS.length)).toBeNull();
    expect(corredorGuardado({ ...crudo, paso: 5 }, "2026-09-28", PASOS.length)).toBeNull();
    expect(corredorGuardado({ ...crudo, terminado: true }, "2026-09-28", PASOS.length)).toBeNull();
    expect(corredorGuardado("basura", "2026-09-28", PASOS.length)).toBeNull();
  });
});

describe("N2 · cuándo y si ya se hizo", () => {
  const CARDIO = { date: "2026-09-28", discipline: "CARDIO", sesion: { cardio: HIIT } } as unknown as OtherSessionView;
  const NATACION = { date: "2026-09-28", discipline: "NATACION", sesion: null } as unknown as OtherSessionView;

  it("reconoce el cardio con plan del día", () => {
    expect(esCardioConPlan(CARDIO)).toBe(true);
    expect(esCardioConPlan(NATACION)).toBe(false);
    expect(esCardioConPlan({ discipline: "CARDIO", sesion: null })).toBe(false);
    expect(cardioDeLaFecha([NATACION, CARDIO], "2026-09-28")).toBe(CARDIO);
    expect(cardioDeLaFecha([CARDIO], "2026-09-29")).toBeNull();
    expect(cardioDeLaFecha(undefined, "2026-09-28")).toBeNull();
  });

  it("dice 'va después de pesas' solo si ese día quedan pesas sin cerrar", () => {
    expect(hayPesasPendientes([{ date: "2026-09-28", completedAt: null }], "2026-09-28")).toBe(true);
    expect(hayPesasPendientes([{ date: "2026-09-28", completedAt: "2026-09-28T10:00:00Z" }], "2026-09-28")).toBe(false);
    expect(hayPesasPendientes([{ date: "2026-09-27", completedAt: null }], "2026-09-28")).toBe(false);
  });

  it("suma los minutos de cardio ya registrados ese día", () => {
    const actividades = [
      { discipline: "CARDIO" as const, date: "2026-09-28", durationMin: 15 },
      { discipline: "CARDIO" as const, date: "2026-09-28", durationMin: 5 },
      { discipline: "NATACION" as const, date: "2026-09-28", durationMin: 40 },
      { discipline: "CARDIO" as const, date: "2026-09-27", durationMin: 20 },
    ];
    expect(minutosDeCardioHechos(actividades, "2026-09-28")).toBe(20);
    expect(minutosDeCardioHechos(actividades, "2026-09-26")).toBeNull();
  });

  it("la llave de la semana es el lunes de esa fecha", () => {
    expect(lunesDe("2026-09-28")).toBe("2026-09-28");
    expect(lunesDe("2026-10-04")).toBe("2026-09-28");
    expect(lunesDe("2026-10-01")).toBe("2026-09-28");
  });

  it("registra la duración corrida, no la de reloj de pared, cuando hubo pausa", () => {
    const inicio = new Date("2026-09-28T10:00:00Z");
    const fin = new Date("2026-09-28T10:30:00Z");
    expect(actividadDeCardio(HIIT, "2026-09-28", inicio, fin, 15 * 60_000).durationMin).toBe(15);
    expect(actividadDeCardio(HIIT, "2026-09-28", inicio, fin).durationMin).toBe(30);
  });
});
