import { describe, expect, it } from "vitest";

import {
  CATALOGO_HIIT,
  duracionParaMinutos,
  kmhAMph,
  nivelHiitDeSemana,
  protocoloDelCatalogo,
  protocoloParaBloque,
  textoVelocidad,
} from "@/lib/training/disciplinas/hiit-caminadora";

/**
 * N1 — los protocolos HIIT de caminadora que Mau ya probó, por velocidad
 * real (km/h, o mph), y la regla que elige cuál le toca.
 */

describe("catálogo HIIT de caminadora", () => {
  it("trae los 14 protocolos transcritos: 25' y 15' × niveles 0–5, 10' solo 4–5", () => {
    const claves = CATALOGO_HIIT.map((p) => `${p.duracion}:${p.nivel}`).sort();
    expect(claves).toHaveLength(14);
    for (const nivel of [0, 1, 2, 3, 4, 5]) {
      expect(protocoloDelCatalogo(25, nivel)).not.toBeNull();
      expect(protocoloDelCatalogo(15, nivel)).not.toBeNull();
    }
    expect(protocoloDelCatalogo(10, 4)).not.toBeNull();
    expect(protocoloDelCatalogo(10, 5)).not.toBeNull();
    for (const nivel of [0, 1, 2, 3]) expect(protocoloDelCatalogo(10, nivel)).toBeNull();
  });

  it.each(CATALOGO_HIIT.map((p) => [`${p.duracion}' nivel ${p.nivel}`, p] as const))(
    "%s: tramos continuos de 0 a la duración, velocidades válidas",
    (_, protocolo) => {
      expect(protocolo.tramos[0]!.desdeMin).toBe(0);
      expect(protocolo.tramos.at(-1)!.hastaMin).toBe(protocolo.duracion);
      protocolo.tramos.forEach((tramo, i) => {
        expect(tramo.hastaMin).toBeGreaterThan(tramo.desdeMin);
        expect(tramo.kmh[1]).toBeGreaterThan(tramo.kmh[0]);
        if (i > 0) expect(tramo.desdeMin).toBe(protocolo.tramos[i - 1]!.hastaMin);
      });
    },
  );

  it.each(CATALOGO_HIIT.map((p) => [`${p.duracion}' nivel ${p.nivel}`, p] as const))(
    "%s: empieza y termina en Fácil",
    (_, protocolo) => {
      expect(protocolo.tramos[0]!.esfuerzo).toBe("Fácil");
      expect(protocolo.tramos.at(-1)!.esfuerzo).toBe("Fácil");
    },
  );
});

describe("qué protocolo cabe en el bloque", () => {
  it("la duración es la mayor de 10/15/25 que quepa", () => {
    expect(duracionParaMinutos(10)).toBe(10);
    expect(duracionParaMinutos(14)).toBe(10);
    expect(duracionParaMinutos(15)).toBe(15);
    expect(duracionParaMinutos(20)).toBe(15);
    expect(duracionParaMinutos(24)).toBe(15);
    expect(duracionParaMinutos(25)).toBe(25);
    expect(duracionParaMinutos(40)).toBe(25);
    expect(duracionParaMinutos(5)).toBe(10);
  });

  it("los 20 min de Mau: 15' del nivel + 5 min de caminata suave", () => {
    const bloque = protocoloParaBloque(20, 1);
    expect(bloque.duracion).toBe(15);
    expect(bloque.nivel).toBe(1);
    expect(bloque.recortado).toBe(false);
    expect(bloque.caminataMin).toBe(5);
    expect(bloque.tramos).toEqual(protocoloDelCatalogo(15, 1)!.tramos);
  });

  it("10' con nivel < 4: el 15' del mismo nivel recortado a 10, terminando en Fácil", () => {
    const bloque = protocoloParaBloque(12, 0);
    expect(bloque.duracion).toBe(10);
    expect(bloque.recortado).toBe(true);
    expect(bloque.caminataMin).toBe(2);
    expect(bloque.tramos.at(-1)).toMatchObject({ hastaMin: 10, esfuerzo: "Fácil" });
    bloque.tramos.forEach((tramo, i) => {
      if (i > 0) expect(tramo.desdeMin).toBe(bloque.tramos[i - 1]!.hastaMin);
    });
    // Lo que queda antes del último minuto es idéntico al 15'.
    const quince = protocoloDelCatalogo(15, 0)!.tramos.filter((t) => t.hastaMin <= 9);
    expect(bloque.tramos.slice(0, quince.length - 1)).toEqual(quince.slice(0, -1));
  });

  it("recortar nunca deja dos tramos Fácil seguidos: se funden", () => {
    for (const nivel of [0, 1, 2, 3]) {
      const { tramos } = protocoloParaBloque(10, nivel);
      tramos.forEach((tramo, i) => {
        if (i > 0) expect(tramo.esfuerzo === "Fácil" && tramos[i - 1]!.esfuerzo === "Fácil").toBe(false);
      });
    }
  });

  it("10' con nivel ≥ 4 usa el 10' real", () => {
    const bloque = protocoloParaBloque(10, 4);
    expect(bloque.recortado).toBe(false);
    expect(bloque.tramos).toEqual(protocoloDelCatalogo(10, 4)!.tramos);
  });
});

describe("nivel y progresión", () => {
  // Semana ISO 37 = posición 1 del ciclo; 40 = descarga.
  const cumplida = (isoWeek: number) => ({ isoWeek, planeadas: 5, registradas: 4 });
  const floja = (isoWeek: number) => ({ isoWeek, planeadas: 5, registradas: 3 });

  it("arranca en el piso del nivel: básico 0, medio 2, avanzado 4", () => {
    expect(nivelHiitDeSemana({ nivel: "BASICO", isoWeek: 37, historial: [] }).nivel).toBe(0);
    expect(nivelHiitDeSemana({ nivel: "MEDIO", isoWeek: 37, historial: [] }).nivel).toBe(2);
    expect(nivelHiitDeSemana({ nivel: "AVANZADO", isoWeek: 37, historial: [] }).nivel).toBe(4);
  });

  it("+1 por semana cumplida (≥ 80 %), nada por una floja", () => {
    expect(nivelHiitDeSemana({ nivel: "BASICO", isoWeek: 39, historial: [cumplida(37), cumplida(38)] }).nivel).toBe(2);
    expect(nivelHiitDeSemana({ nivel: "BASICO", isoWeek: 39, historial: [cumplida(37), floja(38)] }).nivel).toBe(1);
  });

  it("nunca más de +1 por semana, aunque la semana traiga sesiones de más", () => {
    const deMas = { isoWeek: 38, planeadas: 3, registradas: 9 };
    expect(nivelHiitDeSemana({ nivel: "BASICO", isoWeek: 39, historial: [deMas] }).nivel).toBe(1);
  });

  it("la 4.ª semana descarga un nivel (sin bajar de 0) y no cuenta como subida", () => {
    const descarga = nivelHiitDeSemana({ nivel: "BASICO", isoWeek: 40, historial: [cumplida(37), cumplida(38), cumplida(39)] });
    expect(descarga).toMatchObject({ nivel: 2, descarga: true });
    expect(nivelHiitDeSemana({ nivel: "BASICO", isoWeek: 40, historial: [] }).nivel).toBe(0);
    expect(
      nivelHiitDeSemana({ nivel: "BASICO", isoWeek: 41, historial: [cumplida(38), cumplida(39), cumplida(40)] }).nivel,
    ).toBe(2);
  });

  it("topa en 5", () => {
    const historial = [33, 34, 35, 37, 38, 39].map(cumplida);
    expect(nivelHiitDeSemana({ nivel: "AVANZADO", isoWeek: 41, historial }).nivel).toBe(5);
  });

  it("una semana sin cardio planeado no cuenta", () => {
    expect(nivelHiitDeSemana({ nivel: "BASICO", isoWeek: 39, historial: [{ isoWeek: 38, planeadas: 0, registradas: 0 }] }).nivel).toBe(0);
  });
});

describe("unidades", () => {
  it("1 km/h = 0.621371 mph, redondeo a 0.1", () => {
    expect(kmhAMph(4)).toBe(2.5);
    expect(kmhAMph(5)).toBe(3.1);
    expect(kmhAMph(10)).toBe(6.2);
    expect(kmhAMph(18)).toBe(11.2);
  });

  it("rangos por extremo, km/h por default", () => {
    expect(textoVelocidad([4, 5])).toBe("4–5 km/h");
    expect(textoVelocidad([4, 5], "mph")).toBe("2.5–3.1 mph");
    expect(textoVelocidad([10, 12], "kmh")).toBe("10–12 km/h");
  });
});
