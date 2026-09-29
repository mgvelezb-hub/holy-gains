import { describe, expect, it } from "vitest";

import { ESFUERZOS_HIIT, protocoloDelCatalogo, type EsfuerzoHiit } from "@/lib/training/disciplinas/hiit-caminadora";
import {
  COCIENTE_HIIT,
  hiitParaMaquina,
  plantillaHiit,
  TECHO_HIIT,
  tramosConControles,
  type TramoPlantilla,
} from "@/lib/training/disciplinas/plantillas-hiit";

/**
 * P1 — plantillas HIIT por nivel 0–5 para cualquier duración: calentamiento
 * progresivo, intervalos cuyo cociente y techo suben con el nivel, y 2 min
 * de enfriamiento Fácil.
 */

const DURACIONES = [10, 12, 15, 20, 25, 30, 45];
const NIVELES = [0, 1, 2, 3, 4, 5];
const indice = (esfuerzo: EsfuerzoHiit) => ESFUERZOS_HIIT.indexOf(esfuerzo);
const minutos = (tramos: TramoPlantilla[], fase: TramoPlantilla["fase"]) =>
  tramos.filter((t) => t.fase === fase).reduce((suma, t) => suma + t.hastaMin - t.desdeMin, 0);

describe("plantillaHiit", () => {
  for (const duracion of DURACIONES) {
    for (const nivel of NIVELES) {
      it(`${duracion}' nivel ${nivel}: continua, exacta, de Fácil a Fácil y bajo su techo`, () => {
        const tramos = plantillaHiit(duracion, nivel);
        expect(tramos[0]!.desdeMin).toBe(0);
        expect(tramos.at(-1)!.hastaMin).toBe(duracion);
        tramos.forEach((tramo, i) => {
          expect(tramo.hastaMin).toBeGreaterThan(tramo.desdeMin);
          if (i > 0) expect(tramo.desdeMin).toBe(tramos[i - 1]!.hastaMin);
          if (i > 0) expect(tramo.esfuerzo === tramos[i - 1]!.esfuerzo && tramo.fase === tramos[i - 1]!.fase).toBe(false);
          expect(indice(tramo.esfuerzo)).toBeLessThanOrEqual(indice(TECHO_HIIT[nivel]!));
        });
        expect(tramos[0]!.esfuerzo).toBe("Fácil");
        expect(tramos.at(-1)!.esfuerzo).toBe("Fácil");
        expect(tramos.at(-1)!.fase).toBe("enfriamiento");
        expect(tramos.at(-1)!.hastaMin - tramos.at(-1)!.desdeMin).toBeGreaterThanOrEqual(2);
        if (duracion >= 15) expect(tramos.some((t) => t.esfuerzo === TECHO_HIIT[nivel])).toBe(true);
      });
    }
  }

  it("calentamiento de 3 min desde 20', de 2 en menos; siempre sube de Fácil a Moderado", () => {
    expect(minutos(plantillaHiit(20, 2), "calentamiento")).toBe(3);
    expect(minutos(plantillaHiit(15, 2), "calentamiento")).toBe(2);
    expect(plantillaHiit(20, 2).filter((t) => t.fase === "calentamiento").map((t) => t.esfuerzo)).toEqual(["Fácil", "Moderado"]);
  });

  it("el cociente trabajo:recuperación sube con el nivel", () => {
    const cociente = (nivel: number) => minutos(plantillaHiit(30, nivel), "trabajo") / minutos(plantillaHiit(30, nivel), "recuperacion");
    expect(cociente(0)).toBeCloseTo(0.5, 0);
    expect(cociente(2)).toBeGreaterThan(cociente(0));
    expect(cociente(3)).toBeCloseTo(1, 0);
    expect(cociente(5)).toBeGreaterThanOrEqual(1.8);
    expect(COCIENTE_HIIT[5]).toBe("2:1");
  });

  it("nivel 0 no llega a Máximo; nivel 1 ya lo toca", () => {
    expect(plantillaHiit(20, 0).some((t) => t.esfuerzo === "Máximo")).toBe(false);
    expect(plantillaHiit(20, 1).some((t) => t.esfuerzo === "Máximo")).toBe(true);
  });

  it("nivel 4 sostiene el Fuerte 2 min", () => {
    expect(plantillaHiit(20, 4).some((t) => t.esfuerzo === "Fuerte" && t.hastaMin - t.desdeMin >= 2)).toBe(true);
  });

  it("redondea al minuto y no baja de 8", () => {
    expect(plantillaHiit(19.6, 1).at(-1)!.hastaMin).toBe(20);
    expect(plantillaHiit(5, 1).at(-1)!.hastaMin).toBe(8);
  });
});

describe("tramosConControles", () => {
  it("cada tramo trae el control de su máquina ya calculado", () => {
    const tramos = tramosConControles(plantillaHiit(20, 2), "ELIPTICA", { base: 8 });
    const fuerte = tramos.find((t) => t.esfuerzo === "Fuerte")!;
    expect(fuerte.control.resistencia).toBe(12);
    expect(fuerte.control.texto).toBe("Resist. 12 · 145–155 SPM");
  });
});

describe("hiitParaMaquina", () => {
  it("caminadora con protocolo real: el de Mau, tal cual", () => {
    const hiit = hiitParaMaquina("CAMINADORA", 15, 2, {});
    expect(hiit.fuente).toBe("catalogo");
    const real = protocoloDelCatalogo(15, 2)!;
    expect(hiit.tramos.map((t) => [t.desdeMin, t.hastaMin, t.esfuerzo])).toEqual(real.tramos.map((t) => [t.desdeMin, t.hastaMin, t.esfuerzo]));
    expect(hiit.tramos[0]!.control.kmh).toEqual(real.tramos[0]!.kmh);
  });

  it("caminadora sin protocolo (20', 30', 10' < nivel 4): plantilla con km/h del nivel", () => {
    for (const [duracion, nivel] of [[20, 2], [30, 1], [10, 0]] as const) {
      const hiit = hiitParaMaquina("CAMINADORA", duracion, nivel, {});
      expect(hiit.fuente).toBe("plantilla");
      expect(hiit.tramos.at(-1)!.hastaMin).toBe(duracion);
      expect(hiit.tramos.every((t) => t.control.kmh !== undefined)).toBe(true);
    }
  });

  it("las demás máquinas siempre van por plantilla", () => {
    expect(hiitParaMaquina("REMO", 15, 2, { base: { ritmo500: "2:20" } }).fuente).toBe("plantilla");
  });
});
