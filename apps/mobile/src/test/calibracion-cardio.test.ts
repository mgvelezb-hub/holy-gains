import { describe, expect, it } from "vitest";

import type { ProgramaCardio, TramoCardio } from "@/lib/api-cardio";
import {
  baseSugerida,
  lineaDeCalibracion,
  modalidadDelChip,
  moverNivelBase,
  pasosDePrograma,
  programaConMarcado,
  renglonHojaCardio,
} from "@/lib/programa-cardio";

/**
 * Q1 — la calibración ya no sustituye la modalidad: el chip elegido se queda
 * marcado, la hoja lo dice en una línea, al marcar "Aquí voy moderado" lo que
 * sigue se recalcula y "Ya sé mi nivel" edita la base sin calibrar.
 */

function tramo(desdeMin: number, hastaMin: number, texto: string, parcial: Partial<TramoCardio> = {}): TramoCardio {
  return {
    desdeMin,
    hastaMin,
    esfuerzo: "Moderado",
    fase: "trabajo",
    control: { maquina: "ELIPTICA", texto },
    ...parcial,
  };
}

const RESTO_6 = [tramo(5, 8, "Resist. 6", { fase: "calentamiento", esfuerzo: "Fácil" }), tramo(8, 20, "Resist. 9")];
const RESTO_8 = [tramo(5, 8, "Resist. 8", { fase: "calentamiento", esfuerzo: "Fácil" }), tramo(8, 20, "Resist. 11")];

const ELIPTICA_CALIBRA: ProgramaCardio = {
  maquina: "ELIPTICA",
  modalidad: "HIIT",
  nivel: 0,
  duracion: 20,
  titulo: "Calibración + HIIT 20' · Elíptica",
  fuente: "plantilla",
  porque: "",
  paraQuien: "",
  notaMaquina: null,
  base: 6,
  baseEstimada: true,
  ajuste: null,
  fcMaxima: null,
  calibracion: {
    maquina: "ELIPTICA",
    instruccion: "Sube un paso cada minuto.",
    pasos: [4, 5, 6, 7, 8].map((valor, i) => ({
      desdeMin: i,
      hastaMin: i + 1,
      control: { maquina: "ELIPTICA", texto: `Resist. ${valor}` },
      valor,
      tramosSiMarcas: valor === 8 ? RESTO_8 : RESTO_6,
    })),
  },
  tramos: [
    ...[4, 5, 6, 7, 8].map((valor, i) => tramo(i, i + 1, `Resist. ${valor}`, { fase: "calibracion" })),
    ...RESTO_6,
  ],
};

const SIN_CALIBRAR: ProgramaCardio = { ...ELIPTICA_CALIBRA, calibracion: null, titulo: "HIIT 20' · Nivel 0 · Elíptica", tramos: RESTO_6 };

describe("el chip de la modalidad", () => {
  it("con calibración sigue marcada la modalidad del programa", () => {
    expect(modalidadDelChip(ELIPTICA_CALIBRA)).toBe("HIIT");
  });

  it("manda la elegida para hoy (zona 2 se llama así aunque se guarde CONTINUO)", () => {
    expect(modalidadDelChip(ELIPTICA_CALIBRA, "TEMPO")).toBe("TEMPO");
    expect(modalidadDelChip(ELIPTICA_CALIBRA, "CONTINUO")).toBe("ZONA2");
    // Variado no es chip de hoy: va la que resolvió el servidor.
    expect(modalidadDelChip(ELIPTICA_CALIBRA, "VARIADO")).toBe("HIIT");
  });

  it("un programa viejo en caché con CALIBRACION no marca un chip inventado", () => {
    expect(modalidadDelChip({ ...ELIPTICA_CALIBRA, modalidad: "CALIBRACION" })).toBeNull();
  });
});

describe("lo que dice la hoja", () => {
  it("la línea de la primera vez nombra la modalidad", () => {
    expect(lineaDeCalibracion(ELIPTICA_CALIBRA)).toBe("Primera vez en esta máquina: 5 min para calibrar y sigue tu HIIT");
    expect(lineaDeCalibracion(SIN_CALIBRAR)).toBeNull();
  });

  it("el renglón de la hoja: solo hoy, máquina, modalidad y si calibra", () => {
    expect(renglonHojaCardio({ programa: ELIPTICA_CALIBRA, soloHoy: true })).toBe("Solo hoy · Elíptica · HIIT · calibra");
    expect(renglonHojaCardio({ programa: SIN_CALIBRAR, soloHoy: false })).toBe("Máquina y modalidad · Elíptica · HIIT");
    expect(renglonHojaCardio({ programa: SIN_CALIBRAR, soloHoy: true, elegida: "ZONA2" })).toBe("Solo hoy · Elíptica · Zona 2");
  });
});

describe("Aquí voy moderado recalcula lo que sigue", () => {
  it("cambia los tramos tras la calibración por los del paso marcado, mismas duraciones", () => {
    const marcado = programaConMarcado(ELIPTICA_CALIBRA, 8);
    expect(marcado.tramos.slice(0, 5)).toEqual(ELIPTICA_CALIBRA.tramos.slice(0, 5));
    expect(marcado.tramos.slice(5).map((t) => t.control.texto)).toEqual(["Resist. 8", "Resist. 11"]);
    expect(marcado.base).toBe(8);
    expect(marcado.baseEstimada).toBe(false);
    expect(pasosDePrograma(marcado, "kmh").map((p) => p.segundos)).toEqual(
      pasosDePrograma(ELIPTICA_CALIBRA, "kmh").map((p) => p.segundos),
    );
  });

  it("sin tramosSiMarcas (servidor viejo) o sin calibración, queda igual", () => {
    expect(programaConMarcado(SIN_CALIBRAR, 8)).toBe(SIN_CALIBRAR);
    const viejo: ProgramaCardio = {
      ...ELIPTICA_CALIBRA,
      calibracion: { ...ELIPTICA_CALIBRA.calibracion!, pasos: ELIPTICA_CALIBRA.calibracion!.pasos.map(({ tramosSiMarcas: _, ...p }) => p) },
    };
    expect(programaConMarcado(viejo, 8)).toBe(viejo);
  });
});

describe("Ya sé mi nivel: el editor del nivel base", () => {
  it("arranca en la base que usa el programa o en una razonable por máquina", () => {
    expect(baseSugerida("ELIPTICA", 9)).toBe(9);
    expect(baseSugerida("ELIPTICA", null)).toBe(6);
    expect(baseSugerida("REMO", null)).toEqual({ ritmo500: "2:40" });
    expect(baseSugerida("BICI_AIRE", null)).toEqual({ watts: 80 });
    // Un valor que no es de esa máquina no se cuela.
    expect(baseSugerida("REMO", 9)).toEqual({ ritmo500: "2:40" });
  });

  it("+ es más intenso: resistencia +1, ritmo 5 s más rápido, watts +10, con topes", () => {
    expect(moverNivelBase(6, 1)).toBe(7);
    expect(moverNivelBase(1, -1)).toBe(1);
    expect(moverNivelBase(30, 1)).toBe(30);
    expect(moverNivelBase({ ritmo500: "2:40" }, 1)).toEqual({ ritmo500: "2:35" });
    expect(moverNivelBase({ ritmo500: "2:40" }, -1)).toEqual({ ritmo500: "2:45" });
    expect(moverNivelBase({ ritmo500: "1:30" }, 1)).toEqual({ ritmo500: "1:30" });
    expect(moverNivelBase({ watts: 80 }, 1)).toEqual({ watts: 90 });
    expect(moverNivelBase({ watts: 20 }, -1)).toEqual({ watts: 20 });
  });
});
