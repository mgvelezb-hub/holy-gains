import { describe, expect, it } from "vitest";

import { aplicarDelReloj, paraElReloj } from "@/lib/reloj-sesion";
import {
  cerrarSerie,
  conRpe,
  estadoInicial,
  terminarEjercicio,
  type EjercicioVivo,
} from "@/lib/sesion-viva";

/**
 * I2b: el reloj recibe el descanso que de verdad toca (el de `descansoPara`,
 * no el fijo del plan) y sabe qué series se dejaron sin hacer.
 */

const AHORA = new Date("2026-09-28T18:00:00Z").getTime();
const WORKOUT = "w-1";

function sesion(): EjercicioVivo[] {
  const series = (n: number) =>
    Array.from({ length: n }, () => ({ objetivo: 10, hechas: null, pesoKg: 60, calentamiento: false }));
  return [
    { indice: 0, nombre: "Sentadilla", descansoSeg: 60, poolRole: "cuadriceps_compuesto", esquema: "PIRAMIDAL", series: series(3) },
    { indice: 1, nombre: "Curl", descansoSeg: 60, poolRole: "bicep_aislado", esquema: "METABOLICO", series: series(2) },
  ];
}

describe("el descanso que viaja al reloj", () => {
  it("antes de empezar: la base por reglas, no el fijo del plan", () => {
    const espejo = paraElReloj(WORKOUT, "Pierna", estadoInicial(sesion()));
    expect(espejo.ejercicios.map((e) => e.descansoSeg)).toEqual([150, 45]);
    expect(espejo.ejercicios.map((e) => e.omitidas)).toEqual([[], []]);
  });

  it("el de la serie recién cerrada, con su esfuerzo", () => {
    // 7 de 10: se quedó corta → +30 % (150 → 195).
    const { estado } = cerrarSerie(estadoInicial(sesion()), { reps: 7, pesoKg: 100 }, AHORA);
    expect(paraElReloj(WORKOUT, "Pierna", estado).ejercicios[0]!.descansoSeg).toBe(195);
  });

  it("marca las omitidas para que el reloj no las espere, y no las acepta de vuelta", () => {
    let estado = cerrarSerie(estadoInicial(sesion()), { reps: 10, pesoKg: 100 }, AHORA).estado;
    estado = terminarEjercicio(estado).estado;
    expect(paraElReloj(WORKOUT, "Pierna", estado).ejercicios[0]!.omitidas).toEqual([1, 2]);

    const { aplicadas } = aplicarDelReloj(
      estado,
      [
        {
          workoutId: WORKOUT,
          ejercicioIndice: 0,
          serieIndice: 1,
          reps: 10,
          pesoKg: null,
          cerradaEn: "2026-09-28T18:01:00.000Z",
          muestra: [],
          duracionSeg: 30,
        },
      ],
      WORKOUT,
    );
    expect(aplicadas).toHaveLength(0);
  });
});

describe("RPE opcional", () => {
  it("guarda el RPE en la serie y recalcula el descanso en curso", () => {
    const { estado } = cerrarSerie(estadoInicial(sesion()), { reps: 10, pesoKg: 100 }, AHORA);
    expect(estado.descansoHasta).toBe(AHORA + 150_000);

    const duro = conRpe(estado, 0, 0, 10, AHORA + 5_000);
    expect(duro.ejercicios[0]!.series[0]!.rpe).toBe(10);
    expect(duro.descansoHasta).toBe(AHORA + 195_000);

    const facil = conRpe(estado, 0, 0, 6, AHORA + 5_000);
    expect(facil.descansoHasta).toBe(AHORA + 120_000);
  });

  it("no mueve un descanso que la persona ya ajustó a mano, ni el de otra serie", () => {
    const { estado } = cerrarSerie(estadoInicial(sesion()), { reps: 10, pesoKg: 100 }, AHORA);
    const manual = { ...estado, descanso: { ...estado.descanso!, manual: true } };
    expect(conRpe(manual, 0, 0, 10).descansoHasta).toBe(estado.descansoHasta);
    expect(conRpe(estado, 1, 0, 10).descansoHasta).toBe(estado.descansoHasta);
  });

  it("fuera de 1–10 no se guarda", () => {
    const { estado } = cerrarSerie(estadoInicial(sesion()), { reps: 10, pesoKg: 100 }, AHORA);
    expect(conRpe(estado, 0, 0, 11)).toBe(estado);
  });
});
