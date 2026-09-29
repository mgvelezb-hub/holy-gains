import { describe, expect, it } from "vitest";

import { ESFUERZOS_HIIT } from "@/lib/training/disciplinas/hiit-caminadora";
import {
  fcMaxima,
  INFO_MODALIDAD,
  MODALIDADES_CARDIO,
  programaCardio,
  tramosDeModalidad,
} from "@/lib/training/disciplinas/modalidades-cardio";
import type { TramoPlantilla } from "@/lib/training/disciplinas/plantillas-hiit";

/**
 * P1 — las modalidades que no son HIIT (zona 2, tempo, 4×4 noruego,
 * piramidal, recuperación), para cualquier máquina y duración.
 */

const largo = (t: TramoPlantilla) => t.hastaMin - t.desdeMin;

describe("tramosDeModalidad", () => {
  for (const modalidad of MODALIDADES_CARDIO) {
    for (const duracion of [10, 15, 20, 25, 30, 35, 45, 60]) {
      it(`${modalidad} ${duracion}': continua, exacta, de Fácil a Fácil`, () => {
        const { tramos } = tramosDeModalidad(modalidad, duracion, 2);
        expect(tramos[0]!.desdeMin).toBe(0);
        expect(tramos.at(-1)!.hastaMin).toBe(duracion);
        tramos.forEach((tramo, i) => {
          expect(largo(tramo)).toBeGreaterThan(0);
          if (i > 0) expect(tramo.desdeMin).toBe(tramos[i - 1]!.hastaMin);
        });
        expect(tramos[0]!.esfuerzo).toBe("Fácil");
        expect(tramos.at(-1)!.esfuerzo).toBe("Fácil");
      });
    }
  }

  it("zona 2: un solo tramo Moderado entre calentamiento y enfriamiento", () => {
    const { tramos } = tramosDeModalidad("ZONA2", 30, 2);
    expect(tramos.map((t) => [t.esfuerzo, largo(t)])).toEqual([["Fácil", 3], ["Moderado", 25], ["Fácil", 2]]);
  });

  it("tempo: bloques de 8–10 min a Moderado Alto–Fuerte con 2–3 min Fácil entre ellos", () => {
    const { tramos } = tramosDeModalidad("TEMPO", 35, 2);
    // Un bloque = tramos seguidos de trabajo.
    const bloques: number[] = [];
    let actual = 0;
    for (const tramo of tramos) {
      if (tramo.fase === "trabajo") actual += largo(tramo);
      else if (actual > 0) {
        bloques.push(actual);
        actual = 0;
        if (tramo.fase === "recuperacion") {
          expect(tramo.esfuerzo).toBe("Fácil");
          expect(largo(tramo)).toBeGreaterThanOrEqual(2);
          expect(largo(tramo)).toBeLessThanOrEqual(3);
        }
      }
    }
    expect(bloques.length).toBeGreaterThanOrEqual(2);
    for (const bloque of bloques) {
      expect(bloque).toBeGreaterThanOrEqual(8);
      expect(bloque).toBeLessThanOrEqual(10);
    }
    expect(new Set(tramos.filter((t) => t.fase === "trabajo").map((t) => t.esfuerzo))).toEqual(new Set(["Moderado Alto", "Fuerte"]));
  });

  it("4×4 noruego: 4 × 4 min Fuerte con 3 min de recuperación activa (Helgerud 2007)", () => {
    const { tramos, modalidad, ajuste } = tramosDeModalidad("NORUEGO", 35, 2);
    expect(modalidad).toBe("NORUEGO");
    expect(ajuste).toBeNull();
    const trabajo = tramos.filter((t) => t.fase === "trabajo");
    expect(trabajo.map(largo)).toEqual([4, 4, 4, 4]);
    expect(trabajo.every((t) => t.esfuerzo === "Fuerte")).toBe(true);
    expect(tramos.filter((t) => t.fase === "recuperacion").map(largo)).toEqual([3, 3, 3]);
  });

  it("4×4 con menos de 35 min: va HIIT y lo dice", () => {
    const { modalidad, ajuste } = tramosDeModalidad("NORUEGO", 30, 2);
    expect(modalidad).toBe("HIIT");
    expect(ajuste).toMatch(/35 min/);
  });

  it("piramidal: 1-2-3-2-1 con esfuerzo que sube y baja", () => {
    const { tramos } = tramosDeModalidad("PIRAMIDAL", 25, 3);
    const trabajo = tramos.filter((t) => t.fase === "trabajo");
    expect(trabajo.map(largo)).toEqual([1, 2, 3, 2, 1]);
    const indices = trabajo.map((t) => ESFUERZOS_HIIT.indexOf(t.esfuerzo));
    expect(indices[0]).toBeLessThan(indices[1]!);
    expect(indices[1]).toBeLessThan(indices[2]!);
    expect(indices[2]).toBeGreaterThan(indices[3]!);
    expect(indices[3]).toBeGreaterThan(indices[4]!);
    // Recuperaciones iguales al trabajo que las precede.
    const recuperaciones = tramos.filter((t) => t.fase === "recuperacion").map(largo);
    expect(recuperaciones.slice(0, 4)).toEqual([1, 2, 3, 2]);
  });

  it("piramidal respeta el techo del nivel 0", () => {
    const { tramos } = tramosDeModalidad("PIRAMIDAL", 25, 0);
    expect(tramos.some((t) => t.esfuerzo === "Fuerte" || t.esfuerzo === "Máximo")).toBe(false);
  });

  it("recuperación: todo Fácil", () => {
    const { tramos } = tramosDeModalidad("RECUPERACION", 20, 4);
    expect(tramos).toEqual([{ desdeMin: 0, hastaMin: 20, esfuerzo: "Fácil", fase: "continuo" }]);
  });
});

describe("INFO_MODALIDAD", () => {
  it("cada modalidad dice su porqué y a quién le conviene", () => {
    for (const modalidad of MODALIDADES_CARDIO) {
      expect(INFO_MODALIDAD[modalidad].porque.length).toBeGreaterThan(20);
      expect(INFO_MODALIDAD[modalidad].paraQuien.length).toBeGreaterThan(10);
    }
  });
});

describe("pulso", () => {
  it("FCmáx = 208 − 0.7 × edad (Tanaka 2001)", () => {
    expect(fcMaxima(40)).toBe(180);
  });

  it("con edad, cada tramo trae su zona en lpm; el 4×4 va al 85–95 %", () => {
    const zona2 = programaCardio({ maquina: "REMO", modalidad: "ZONA2", duracion: 30, nivelHiit: 2, base: { ritmo500: "2:20" }, edad: 40 });
    expect(zona2.tramos.find((t) => t.esfuerzo === "Moderado")!.fcLpm).toEqual([108, 126]);
    const noruego = programaCardio({ maquina: "BICI", modalidad: "NORUEGO", duracion: 40, nivelHiit: 2, base: 10, edad: 40 });
    expect(noruego.tramos.find((t) => t.fase === "trabajo")!.fcLpm).toEqual([153, 171]);
    const sinEdad = programaCardio({ maquina: "BICI", modalidad: "ZONA2", duracion: 30, nivelHiit: 2, base: 10 });
    expect(sinEdad.tramos.every((t) => t.fcLpm === undefined)).toBe(true);
  });
});

describe("programaCardio", () => {
  it("elíptica HIIT 20' nivel 2: título, controles y porqué", () => {
    const programa = programaCardio({ maquina: "ELIPTICA", modalidad: "HIIT", duracion: 20, nivelHiit: 2, base: 8 });
    expect(programa.titulo).toBe("HIIT 20' · Nivel 2 · Elíptica");
    expect(programa.fuente).toBe("plantilla");
    expect(programa.tramos.every((t) => t.control.resistencia !== undefined)).toBe(true);
    expect(programa.porque).toBe(INFO_MODALIDAD.HIIT.porque);
  });

  it("remo zona 2 30': título, ritmo y damper", () => {
    const programa = programaCardio({ maquina: "REMO", modalidad: "ZONA2", duracion: 30, nivelHiit: 1, base: { ritmo500: "2:20" } });
    expect(programa.titulo).toBe("Zona 2 · 30' · Remo");
    expect(programa.tramos[1]!.control.texto).toBe("2:20/500 · 20–24 SPM");
    expect(programa.notaMaquina).toMatch(/damper/i);
    expect(programa.nivel).toBeNull();
  });

  it("caminadora HIIT con protocolo real sale del catálogo", () => {
    expect(programaCardio({ maquina: "CAMINADORA", modalidad: "HIIT", duracion: 25, nivelHiit: 3 }).fuente).toBe("catalogo");
  });
});
