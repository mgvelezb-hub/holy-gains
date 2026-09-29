import { describe, expect, it } from "vitest";

import type { DetalleCardio, DisciplineLoad } from "@/lib/api";
import type { ProgramaCardio, TramoCardio } from "@/lib/api-cardio";
import { notasDeCardio, pasosDeCardio, renglonDeCardio, tituloTarjetaCardio } from "@/lib/cardio";
import {
  conMaquinaYModalidad,
  conNivelBase,
  filasDePrograma,
  indiceTrasCalibracion,
  modalidadElegida,
  pasosDePrograma,
  renglonNivelBase,
  textoDelTramoCardio,
  textoParaRelojPrograma,
  valorDeCalibracion,
} from "@/lib/programa-cardio";

/**
 * P1 en el teléfono: la tabla, los pasos del corredor, la calibración y lo
 * que se guarda en las preferencias, a partir del `ProgramaCardio` de la web.
 */

function tramo(parcial: Partial<TramoCardio> & Pick<TramoCardio, "desdeMin" | "hastaMin" | "esfuerzo">): TramoCardio {
  return { fase: "trabajo", control: { maquina: "ELIPTICA", texto: "Resist. 8 · 130–140 SPM" }, ...parcial };
}

const BASE: Omit<ProgramaCardio, "tramos" | "titulo" | "maquina" | "modalidad"> = {
  nivel: 2,
  duracion: 20,
  fuente: "plantilla",
  porque: "",
  paraQuien: "",
  notaMaquina: null,
  base: 8,
  baseEstimada: false,
  calibracion: null,
  ajuste: null,
  fcMaxima: null,
};

const CAMINADORA: ProgramaCardio = {
  ...BASE,
  maquina: "CAMINADORA",
  modalidad: "HIIT",
  nivel: 0,
  fuente: "catalogo",
  titulo: "HIIT 15' + 5' caminata · Nivel 0 · Caminadora",
  protocoloMin: 15,
  caminataMin: 5,
  base: null,
  tramos: [
    tramo({ desdeMin: 0, hastaMin: 3, esfuerzo: "Fácil", fase: "calentamiento", control: { maquina: "CAMINADORA", kmh: [4, 5], texto: "4–5 km/h" } }),
    tramo({ desdeMin: 3, hastaMin: 15, esfuerzo: "Moderado Alto", control: { maquina: "CAMINADORA", kmh: [7, 9], texto: "7–9 km/h" } }),
    tramo({ desdeMin: 15, hastaMin: 20, esfuerzo: "Fácil", fase: "caminata", control: { maquina: "CAMINADORA", kmh: [5, 6], texto: "5–6 km/h · caminata suave" } }),
  ],
};

const REMO_CALIBRA: ProgramaCardio = {
  ...BASE,
  maquina: "REMO",
  modalidad: "CALIBRACION",
  nivel: null,
  titulo: "Calibración · 20' · Remo",
  base: null,
  baseEstimada: true,
  notaMaquina: "Damper 3–5.",
  calibracion: {
    maquina: "REMO",
    instruccion: "Sube un paso cada minuto.",
    pasos: [0, 1, 2, 3, 4].map((i) => ({
      desdeMin: i,
      hastaMin: i + 1,
      control: { maquina: "REMO", texto: `2:${50 - i * 5}/500` },
      valor: { ritmo500: `2:${50 - i * 5}` },
    })),
  },
  tramos: [
    ...[0, 1, 2, 3, 4].map((i) =>
      tramo({ desdeMin: i, hastaMin: i + 1, esfuerzo: "Moderado", fase: "calibracion", control: { maquina: "REMO", texto: `2:${50 - i * 5}/500` } }),
    ),
    tramo({ desdeMin: 5, hastaMin: 18, esfuerzo: "Moderado", fase: "continuo", control: { maquina: "REMO", texto: "El que marcaste" } }),
    tramo({ desdeMin: 18, hastaMin: 20, esfuerzo: "Fácil", fase: "enfriamiento", control: { maquina: "REMO", texto: "Un poco menos que el que marcaste" } }),
  ],
};

describe("tabla del programa", () => {
  it("caminadora: km/h ↔ mph y la caminata suave con su nombre", () => {
    const filas = filasDePrograma(CAMINADORA, "mph");
    expect(filas[0]).toMatchObject({ tiempo: "0–3 min", control: "2.5–3.1 mph", esfuerzo: "Fácil" });
    expect(filas.at(-1)).toMatchObject({ tiempo: "15–20 min", control: "3.1–3.7 mph", esfuerzo: "Caminata" });
  });

  it("otras máquinas: el control tal como lo calculó la web, y lpm si vienen", () => {
    const programa: ProgramaCardio = {
      ...BASE,
      maquina: "ELIPTICA",
      modalidad: "ZONA2",
      titulo: "Zona 2 · 20' · Elíptica",
      tramos: [tramo({ desdeMin: 0, hastaMin: 20, esfuerzo: "Moderado", fcLpm: [108, 126] })],
    };
    expect(filasDePrograma(programa, "mph")[0]).toMatchObject({ control: "Resist. 8 · 130–140 SPM", lpm: "108–126 lpm" });
  });
});

describe("pasos del corredor", () => {
  it("un paso por tramo con control y esfuerzo", () => {
    const pasos = pasosDePrograma(CAMINADORA, "kmh");
    expect(pasos.map((p) => p.segundos)).toEqual([180, 720, 300]);
    expect(pasos[1]!.nombre).toBe("7–9 km/h · Moderado Alto");
    expect(pasos[2]!.nombre).toBe("5–6 km/h · Caminata suave");
  });

  it("calibración: el valor del paso en curso y dónde sigue la zona 2", () => {
    expect(valorDeCalibracion(REMO_CALIBRA, 2)).toEqual({ ritmo500: "2:40" });
    expect(valorDeCalibracion(REMO_CALIBRA, 5)).toBeNull();
    expect(indiceTrasCalibracion(REMO_CALIBRA)).toBe(5);
    expect(indiceTrasCalibracion(CAMINADORA)).toBeNull();
  });

  it("tras marcar, la zona 2 dice el ritmo marcado", () => {
    const marcado = { maquina: "REMO" as const, valor: { ritmo500: "2:40" } };
    expect(textoDelTramoCardio(REMO_CALIBRA.tramos[5]!, "kmh", marcado)).toBe("2:40/500 m · Moderado");
    expect(textoDelTramoCardio(REMO_CALIBRA.tramos[6]!, "kmh", marcado)).toBe("Un poco menos que 2:40/500 m · Fácil");
    expect(textoDelTramoCardio(REMO_CALIBRA.tramos[5]!, "kmh")).toBe("El que marcaste · Moderado");
  });

  it("al reloj va el tramo en corto", () => {
    const reloj = textoParaRelojPrograma({ programa: CAMINADORA, paso: 1, restanteSeg: 75, unidad: "kmh" });
    expect(reloj.titulo).toBe("7–9 km/h · M. Alto · 1:15");
    expect(reloj.cardio.siguiente).toBe("5–6 km/h · Caminata suave");
  });
});

describe("el detalle con programa manda en la tarjeta y el registro", () => {
  const detalle = {
    equipo: "CAMINADORA",
    tipo: "HIIT",
    nivelMaquina: 0,
    etiqueta: "Cardio HIIT caminadora",
    intervalos: null,
    calentamientoSeg: 180,
    enfriamientoSeg: 120,
    programa: CAMINADORA,
  } as unknown as DetalleCardio;

  it("título, pasos y notas salen del programa", () => {
    expect(tituloTarjetaCardio(detalle, 20)).toBe("Cardio · 20 min · HIIT 15' + 5' caminata · Nivel 0 · Caminadora");
    expect(pasosDeCardio(detalle, 20)).toHaveLength(3);
    expect(notasDeCardio(detalle)).toBe(CAMINADORA.titulo);
  });
});

describe("preferencias (Ajustes y hoja)", () => {
  const otras = [
    { discipline: "PESAS", sessionsPerWeek: 5 },
    { discipline: "CARDIO", sessionsPerWeek: 5, cardio: { equipo: "CAMINADORA", nivelBase: { ELIPTICA: 8 } } },
  ] as unknown as DisciplineLoad[];

  it("guardar el nivel base no pisa las demás máquinas ni cargas", () => {
    const siguiente = conNivelBase(otras, "REMO", { ritmo500: "2:20" });
    expect(siguiente[0]).toBe(otras[0]);
    expect((siguiente[1] as unknown as { cardio: unknown }).cardio).toEqual({
      equipo: "CAMINADORA",
      nivelBase: { ELIPTICA: 8, REMO: { ritmo500: "2:20" } },
    });
  });

  it("'Usar siempre' guarda máquina y modalidad", () => {
    const siguiente = conMaquinaYModalidad(otras, "ELIPTICA", "ZONA2");
    expect((siguiente[1] as unknown as { cardio: { equipo: string; tipo: string } }).cardio).toMatchObject({ equipo: "ELIPTICA", tipo: "ZONA2" });
  });

  it("renglón del nivel base", () => {
    expect(renglonNivelBase("ELIPTICA", { ELIPTICA: 8 })).toBe("Resist. 8");
    expect(renglonNivelBase("REMO", { REMO: { ritmo500: "2:20" } })).toBe("2:20/500 m");
    expect(renglonNivelBase("BICI_AIRE", {})).toBe("Se calibra en la primera sesión.");
    expect(renglonNivelBase("CAMINADORA", undefined)).toMatch(/km\/h/);
  });

  it("CONTINUO se ve como zona 2 y el renglón nombra máquina y modalidad", () => {
    expect(modalidadElegida("CONTINUO")).toBe("ZONA2");
    expect(modalidadElegida(undefined)).toBe("HIIT");
    expect(
      renglonDeCardio({ discipline: "CARDIO", sessionsPerWeek: 3, modo: "DESPUES", cardio: { equipo: "REMO", tipo: "ZONA2", minutos: 30 } } as never),
    ).toBe("Cardio · 3/semana · después de pesas · Zona 2 remo 30 min");
  });
});

describe("Aquí voy moderado: el corredor salta a la zona 2", () => {
  it("irAPasoCorredor avanza corriendo y no retrocede", async () => {
    const { iniciarCorredor, irAPasoCorredor, pausarCorredor } = await import("@/lib/cardio");
    const pasos = pasosDePrograma(REMO_CALIBRA, "kmh");
    const inicio = iniciarCorredor("2026-09-28", pasos, 0);
    const salto = irAPasoCorredor({ ...inicio, paso: 2 }, pasos, 5, 150_000);
    expect(salto).toMatchObject({ paso: 5, hasta: 150_000 + 13 * 60_000, avisadoEn: null });
    expect(irAPasoCorredor(salto, pasos, 3, 160_000)).toBe(salto);
    const enPausa = pausarCorredor(inicio, 30_000);
    expect(irAPasoCorredor(enPausa, pasos, 5, 40_000)).toMatchObject({ paso: 5, pausadoMs: 10_000, hasta: 40_000 + 13 * 60_000 });
  });
});

describe("Usar siempre sin modalidad elegida", () => {
  it("solo cambia la máquina y deja la modalidad de la preferencia", () => {
    const otras = [{ discipline: "CARDIO", sessionsPerWeek: 5, cardio: { equipo: "CAMINADORA", tipo: "VARIADO" } }] as unknown as DisciplineLoad[];
    const siguiente = conMaquinaYModalidad(otras, "REMO");
    expect((siguiente[0] as unknown as { cardio: unknown }).cardio).toEqual({ equipo: "REMO", tipo: "VARIADO" });
  });
});
