import { describe, expect, it } from "vitest";

import type { DetalleCardio, DisciplineLoad, ProtocoloHiit } from "@/lib/api";
import { actividadDeCardio, notasDeCardio, pasosDeCardio, tituloTarjetaCardio } from "@/lib/cardio";
import {
  colorDeEsfuerzo,
  conUnidadVelocidad,
  debeAvisarCambio,
  filasDeProtocolo,
  kmhAMph,
  protocoloDe,
  textoDelTramo,
  textoParaReloj,
  textoVelocidad,
  tituloProtocolo,
  tramosDeSesion,
} from "@/lib/hiit";
import { paletteChampan, paletteDark, paletteLight } from "@/lib/theme";

/**
 * N1 — el HIIT de caminadora por velocidad real en el teléfono: la tabla del
 * protocolo, los pasos que corre el timer, el aviso antes de cada cambio de
 * velocidad y lo que va al reloj.
 */

const PROTOCOLO: ProtocoloHiit = {
  duracion: 15,
  nivel: 3,
  recortado: false,
  caminataMin: 5,
  tramos: [
    { desdeMin: 0, hastaMin: 1, kmh: [5, 6], esfuerzo: "Fácil" },
    { desdeMin: 1, hastaMin: 2, kmh: [7, 9], esfuerzo: "Moderado" },
    { desdeMin: 2, hastaMin: 4, kmh: [10, 12], esfuerzo: "Moderado Alto", inferido: true },
    { desdeMin: 4, hastaMin: 5, kmh: [13, 15], esfuerzo: "Máximo" },
    { desdeMin: 5, hastaMin: 15, kmh: [5, 6], esfuerzo: "Fácil" },
  ],
};

const DETALLE = {
  equipo: "CAMINADORA",
  tipo: "HIIT",
  nivelMaquina: 3,
  etiqueta: "Cardio HIIT caminadora",
  intervalos: null,
  calentamientoSeg: 60,
  enfriamientoSeg: 600,
  protocolo: PROTOCOLO,
  unidad: "kmh",
} as DetalleCardio;

describe("velocidad", () => {
  it("km/h → mph por extremo, a 0.1", () => {
    expect(kmhAMph(4)).toBe(2.5);
    expect(kmhAMph(5)).toBe(3.1);
    expect(textoVelocidad([4, 5], "mph")).toBe("2.5–3.1 mph");
    expect(textoVelocidad([10, 12], "kmh")).toBe("10–12 km/h");
  });
});

describe("vista del protocolo", () => {
  it("título 'HIIT 15' · Nivel 3'", () => {
    expect(tituloProtocolo(PROTOCOLO)).toBe("HIIT 15' · Nivel 3");
  });

  it("filas Tiempo · Velocidad · Esfuerzo, con la caminata al final y el '?' solo aquí", () => {
    const filas = filasDeProtocolo(PROTOCOLO, "kmh");
    expect(filas[0]).toEqual({ tiempo: "0–1 min", velocidad: "5–6 km/h", esfuerzo: "Fácil", inferido: false });
    expect(filas[2]).toMatchObject({ tiempo: "2–4 min", esfuerzo: "Moderado Alto", inferido: true });
    expect(filas.at(-1)).toEqual({ tiempo: "15–20 min", velocidad: "5–6 km/h", esfuerzo: "Caminata", inferido: false });
    expect(filasDeProtocolo(PROTOCOLO, "mph")[1]!.velocidad).toBe("4.3–5.6 mph");
  });

  it("colores por esfuerzo salen del tema", () => {
    expect(colorDeEsfuerzo("Fácil", paletteDark)).toBe(paletteDark.esfuerzoFacil);
    expect(colorDeEsfuerzo("Máximo", paletteLight)).toBe(paletteLight.esfuerzoMaximo);
    expect(colorDeEsfuerzo("Caminata", paletteChampan)).toBe(paletteChampan.esfuerzoFacil);
  });
});

describe("sesión", () => {
  it("los pasos son los tramos del protocolo más la caminata; ninguno lleva '?'", () => {
    const pasos = pasosDeCardio(DETALLE, 20);
    expect(pasos[0]).toEqual({ nombre: "5–6 km/h · Fácil", segundos: 60 });
    expect(pasos[2]).toEqual({ nombre: "10–12 km/h · Moderado Alto", segundos: 120 });
    expect(pasos.at(-1)).toEqual({ nombre: "5–6 km/h · Caminata suave", segundos: 300 });
    expect(pasos.reduce((suma, paso) => suma + paso.segundos, 0)).toBe(20 * 60);
    expect(pasos.some((paso) => paso.nombre.includes("?"))).toBe(false);
    expect(pasosDeCardio(DETALLE, 20, "mph")[2]!.nombre).toBe("6.2–7.5 mph · Moderado Alto");
  });

  it("sin caminata cuando el bloque es justo el protocolo", () => {
    const tramos = tramosDeSesion({ ...PROTOCOLO, caminataMin: 0 });
    expect(tramos).toHaveLength(PROTOCOLO.tramos.length);
  });

  it("el tramo actual se lee grande y el siguiente en una línea", () => {
    expect(textoDelTramo(PROTOCOLO.tramos[2]!, "kmh")).toBe("10–12 km/h · Moderado Alto");
  });

  it("avisa 5 s antes de cada cambio de velocidad, una sola vez por tramo", () => {
    expect(debeAvisarCambio({ restanteSeg: 6, avisadoEn: null, paso: 1, hayCambio: true })).toBe(false);
    expect(debeAvisarCambio({ restanteSeg: 5, avisadoEn: null, paso: 1, hayCambio: true })).toBe(true);
    expect(debeAvisarCambio({ restanteSeg: 4, avisadoEn: 1, paso: 1, hayCambio: true })).toBe(false);
    expect(debeAvisarCambio({ restanteSeg: 5, avisadoEn: 1, paso: 2, hayCambio: true })).toBe(true);
    expect(debeAvisarCambio({ restanteSeg: 0, avisadoEn: null, paso: 1, hayCambio: true })).toBe(false);
    // El último paso no cambia a nada: no hay aviso.
    expect(debeAvisarCambio({ restanteSeg: 3, avisadoEn: null, paso: 5, hayCambio: false })).toBe(false);
  });

  it("al reloj va texto corto por el canal de sesión: sin ejercicios, el tramo en el título", () => {
    const mensaje = textoParaReloj({ protocolo: PROTOCOLO, paso: 2, restanteSeg: 75, unidad: "kmh" });
    expect(mensaje).toEqual({
      workoutId: "cardio",
      titulo: "10–12 km/h · M. Alto · 1:15",
      ejercicios: [],
      cardio: { tramo: "10–12 km/h · Moderado Alto", restanteSeg: 75, siguiente: "13–15 km/h · Máximo" },
    });
  });

  it("tarjeta y registro nombran el protocolo y su nivel", () => {
    expect(tituloTarjetaCardio(DETALLE, 20)).toBe("Cardio · 20 min · HIIT 15' · Nivel 3 + 5 min caminando");
    expect(notasDeCardio(DETALLE)).toBe("HIIT 15' · Nivel 3 · caminadora");
    const inicio = new Date("2026-09-28T19:30:00.000Z");
    const fin = new Date("2026-09-28T19:50:00.000Z");
    expect(actividadDeCardio(DETALLE, "2026-09-28", inicio, fin)).toMatchObject({
      discipline: "CARDIO",
      durationMin: 20,
      notes: "HIIT 15' · Nivel 3 · caminadora",
    });
  });

  it("protocoloDe: solo si el detalle lo trae", () => {
    expect(protocoloDe(DETALLE)).toBe(PROTOCOLO);
    expect(protocoloDe({ ...DETALLE, protocolo: undefined } as DetalleCardio)).toBeNull();
  });
});

describe("preferencia km/h ↔ mph", () => {
  it("se guarda dentro de las preferencias de CARDIO, sin tocar lo demás", () => {
    const otras = [
      { discipline: "CARDIO", sessionsPerWeek: 5, modo: "DESPUES", cardio: { equipo: "CAMINADORA", minutos: 20 } },
      { discipline: "NATACION", sessionsPerWeek: 1 },
    ] as DisciplineLoad[];
    const siguiente = conUnidadVelocidad(otras, "mph");
    expect(siguiente[0]).toEqual({
      discipline: "CARDIO",
      sessionsPerWeek: 5,
      modo: "DESPUES",
      cardio: { equipo: "CAMINADORA", minutos: 20, unidadVelocidad: "mph" },
    });
    expect(siguiente[1]).toBe(otras[1]);
    expect(conUnidadVelocidad([otras[1]!], "mph")).toEqual([otras[1]]);
  });
});
