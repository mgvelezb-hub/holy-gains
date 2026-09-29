import { describe, expect, it } from "vitest";

import { ESFUERZOS_HIIT } from "@/lib/training/disciplinas/hiit-caminadora";
import {
  controlDe,
  DAMPER_REMO,
  MAQUINAS_CARDIO,
  REGLAS_ESFUERZO,
  ritmoATexto,
  segundosDeRitmo,
  velocidadesCaminadora,
} from "@/lib/training/disciplinas/maquinas-cardio";

/**
 * P1 — cada máquina con sus controles reales, y cada esfuerzo como delta
 * sobre el nivel base personal (el "moderado" que la persona calibró).
 */

describe("máquinas de cardio", () => {
  it("conoce caminadora, elíptica, remo, bici, bici de aire, escaladora y SkiErg", () => {
    expect([...MAQUINAS_CARDIO].sort()).toEqual(
      ["BICI", "BICI_AIRE", "CAMINADORA", "ELIPTICA", "ESCALERA", "REMO", "SKI_ERG"].sort(),
    );
  });

  it("cada máquina con base trae una regla por esfuerzo, con su fuente", () => {
    for (const [maquina, regla] of Object.entries(REGLAS_ESFUERZO)) {
      expect(regla.fuente.length, maquina).toBeGreaterThan(10);
      for (const esfuerzo of ESFUERZOS_HIIT) expect(regla.porEsfuerzo[esfuerzo], `${maquina} ${esfuerzo}`).toBeDefined();
    }
  });

  it("los deltas suben con el esfuerzo (más resistencia, más watts o ritmo más rápido)", () => {
    for (const [maquina, regla] of Object.entries(REGLAS_ESFUERZO)) {
      const deltas = ESFUERZOS_HIIT.map((esfuerzo) => regla.porEsfuerzo[esfuerzo].delta);
      const creciente = regla.control === "ritmo500" ? deltas.every((d, i) => i === 0 || d < deltas[i - 1]!) : deltas.every((d, i) => i === 0 || d > deltas[i - 1]!);
      expect(creciente, maquina).toBe(true);
      expect(regla.porEsfuerzo.Moderado.delta, maquina).toBe(regla.control === "watts" ? 1 : 0);
    }
  });
});

describe("controlDe", () => {
  it("elíptica: base ± delta y zancadas por minuto; Máximo a ≥ 150 SPM", () => {
    expect(controlDe("ELIPTICA", "Moderado", { base: 8 })).toMatchObject({ resistencia: 8, cadencia: [130, 140], texto: "Resist. 8 · 130–140 SPM" });
    expect(controlDe("ELIPTICA", "Fácil", { base: 8 }).resistencia).toBe(6);
    const maximo = controlDe("ELIPTICA", "Máximo", { base: 8 });
    expect(maximo.resistencia).toBe(14);
    expect(maximo.cadencia![0]).toBeGreaterThanOrEqual(150);
  });

  it("la resistencia nunca baja de 1", () => {
    expect(controlDe("ELIPTICA", "Fácil", { base: 1 }).resistencia).toBe(1);
  });

  it("remo: ritmo /500 m relativo al base y paladas por minuto", () => {
    const base = { ritmo500: "2:20" };
    expect(controlDe("REMO", "Moderado", { base }).texto).toBe("2:20/500 · 20–24 SPM");
    expect(controlDe("REMO", "Fácil", { base }).texto).toBe("2:40+/500 · 18–20 SPM");
    const maximo = controlDe("REMO", "Máximo", { base });
    expect(maximo.ritmo500Seg).toBe(125);
    expect(maximo.cadencia![0]).toBeGreaterThanOrEqual(30);
    expect(DAMPER_REMO.rango).toEqual([3, 5]);
    expect(DAMPER_REMO.nota).toMatch(/más damper no es más ejercicio/i);
  });

  it("bici: nivel y RPM; el Máximo es de pie a 100+ RPM", () => {
    expect(controlDe("BICI", "Moderado", { base: 10 }).texto).toBe("Nivel 10 · 80–90 RPM");
    const maximo = controlDe("BICI", "Máximo", { base: 10 });
    expect(maximo).toMatchObject({ resistencia: 15, postura: "de pie" });
    expect(maximo.cadencia![0]).toBeGreaterThanOrEqual(100);
    for (const esfuerzo of ESFUERZOS_HIIT) {
      const [min, max] = controlDe("BICI", esfuerzo, { base: 10 }).cadencia!;
      expect(min).toBeGreaterThanOrEqual(60);
      expect(max).toBeLessThanOrEqual(110);
    }
  });

  it("bici de aire: watts, sin resistencia", () => {
    const control = controlDe("BICI_AIRE", "Fuerte", { base: { watts: 120 } });
    expect(control.resistencia).toBeUndefined();
    expect(control.watts).toEqual([180, 180]);
    expect(control.texto).toBe("180 W");
    expect(controlDe("BICI_AIRE", "Máximo", { base: { watts: 120 } }).texto).toBe("240+ W");
  });

  it("escaladora: nivel sin cadencia", () => {
    expect(controlDe("ESCALERA", "Moderado Alto", { base: 7 }).texto).toBe("Nivel 9");
  });

  it("caminadora: km/h de los protocolos reales del mismo nivel", () => {
    expect(controlDe("CAMINADORA", "Máximo", { nivelHiit: 4 }).kmh).toEqual([16, 18]);
    expect(controlDe("CAMINADORA", "Fácil", { nivelHiit: 4 }).texto).toBe("5–6 km/h");
  });

  it("sin base, la máquina dice el esfuerzo y no inventa números", () => {
    const control = controlDe("ELIPTICA", "Fuerte", {});
    expect(control.resistencia).toBeUndefined();
    expect(control.texto).toBe("145–155 SPM");
  });

  it("libre no tiene controles", () => {
    expect(controlDe("LIBRE", "Fuerte", {}).texto).toBe("");
  });
});

describe("velocidadesCaminadora", () => {
  it("toma los rangos reales y rellena los esfuerzos que el nivel no usa, sin romper el orden", () => {
    const nivel1 = velocidadesCaminadora(1);
    expect(nivel1.Fácil).toEqual([5, 6]);
    expect(nivel1.Moderado).toEqual([7, 9]);
    expect(nivel1.Máximo).toEqual([10, 12]);
    for (let nivel = 0; nivel <= 5; nivel += 1) {
      const v = velocidadesCaminadora(nivel);
      const pisos = ESFUERZOS_HIIT.map((esfuerzo) => v[esfuerzo][0]);
      expect(pisos.every((piso, i) => i === 0 || piso >= pisos[i - 1]!), `nivel ${nivel}`).toBe(true);
      for (const esfuerzo of ESFUERZOS_HIIT) expect(v[esfuerzo][1]).toBeGreaterThan(v[esfuerzo][0]);
    }
    // Nivel 3 usa dos Moderados (7–9 y 10–12): el alto es el Moderado Alto.
    expect(velocidadesCaminadora(3)["Moderado Alto"]).toEqual([10, 12]);
  });
});

describe("ritmo /500 m", () => {
  it("ida y vuelta entre 'm:ss' y segundos", () => {
    expect(segundosDeRitmo("2:20")).toBe(140);
    expect(segundosDeRitmo("1:05")).toBe(65);
    expect(segundosDeRitmo("2:75")).toBeNull();
    expect(ritmoATexto(125)).toBe("2:05");
  });
});
