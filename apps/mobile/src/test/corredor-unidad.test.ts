import { describe, expect, it } from "vitest";

import type { DetalleCardio } from "@/lib/api";
import type { DetalleCardioP1, ProgramaCardio } from "@/lib/api-cardio";
import { pasosDeCardio, usaUnidadVelocidad } from "@/lib/cardio";
import { textoParaRelojPrograma } from "@/lib/programa-cardio";

/**
 * Q1 · km/h ↔ mph dentro del corredor: solo la caminadora lo ofrece, cambiar
 * de unidad cambia lo que se lee (actual, siguiente, reloj) y NUNCA las
 * duraciones — el timer en curso no se toca.
 */

const PROGRAMA: ProgramaCardio = {
  maquina: "CAMINADORA",
  modalidad: "HIIT",
  nivel: 0,
  duracion: 8,
  titulo: "HIIT 8' · Nivel 0 · Caminadora",
  fuente: "plantilla",
  porque: "",
  paraQuien: "",
  notaMaquina: null,
  base: null,
  baseEstimada: false,
  calibracion: null,
  ajuste: null,
  fcMaxima: null,
  tramos: [
    { desdeMin: 0, hastaMin: 3, esfuerzo: "Fácil", fase: "calentamiento", control: { maquina: "CAMINADORA", kmh: [5, 6], texto: "5–6 km/h" } },
    { desdeMin: 3, hastaMin: 8, esfuerzo: "Fuerte", fase: "trabajo", control: { maquina: "CAMINADORA", kmh: [10, 12], texto: "10–12 km/h" } },
  ],
};

function detalle(programa: ProgramaCardio | null, equipo: DetalleCardioP1["equipo"] = programa?.maquina ?? "CAMINADORA"): DetalleCardio {
  return {
    equipo,
    tipo: "HIIT",
    nivelMaquina: 0,
    etiqueta: "Cardio",
    intervalos: null,
    calentamientoSeg: 180,
    enfriamientoSeg: 0,
    ...(programa ? { programa } : {}),
  } as unknown as DetalleCardio;
}

describe("el chip km/h ↔ mph del corredor", () => {
  it("solo en caminadora", () => {
    expect(usaUnidadVelocidad(detalle(PROGRAMA))).toBe(true);
    expect(usaUnidadVelocidad(detalle({ ...PROGRAMA, maquina: "ELIPTICA" }))).toBe(false);
    expect(usaUnidadVelocidad(detalle(null, "CAMINADORA"))).toBe(true);
    expect(usaUnidadVelocidad(detalle(null, "BICI" as never))).toBe(false);
  });

  it("cambia los nombres de los tramos, no sus duraciones", () => {
    const enKmh = pasosDeCardio(detalle(PROGRAMA), 8, "kmh");
    const enMph = pasosDeCardio(detalle(PROGRAMA), 8, "mph");
    expect(enKmh.map((p) => p.segundos)).toEqual(enMph.map((p) => p.segundos));
    expect(enKmh[1]!.nombre).toMatch(/km\/h/);
    expect(enMph[1]!.nombre).toMatch(/mph/);
  });

  it("lo que va al reloj también sale en la unidad elegida", () => {
    const reloj = textoParaRelojPrograma({ programa: PROGRAMA, paso: 0, restanteSeg: 90, unidad: "mph" });
    expect(reloj.titulo).toMatch(/mph/);
    expect(reloj.cardio.tramo).toMatch(/mph/);
    expect(reloj.cardio.siguiente).toMatch(/mph/);
  });
});
