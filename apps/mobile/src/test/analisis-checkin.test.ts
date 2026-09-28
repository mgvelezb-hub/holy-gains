import { describe, expect, it } from "vitest";

import {
  AVISO_ANALISIS_SEGUNDOS,
  SONDEO_MS,
  alVolver,
  flechaDelta,
  lineaCheckin,
  resumenEsteMes,
  resumenFotos,
  textoAnalizando,
  tocaMensual,
} from "@/lib/analisis-checkin";

describe("textoAnalizando", () => {
  it("dice honestamente qué se está cruzando", () => {
    expect(textoAnalizando({ conFotos: false, esMensual: false })).toBe(
      "Estoy cruzando tus números. Puedes salir de la app; te aviso cuando esté listo.",
    );
    expect(textoAnalizando({ conFotos: true, esMensual: true })).toBe(
      "Estoy cruzando tus números, tus fotos y tu objetivo. Puedes salir de la app; te aviso cuando esté listo.",
    );
    expect(textoAnalizando({ conFotos: true, esMensual: false })).toContain("tus números y tus fotos.");
    expect(textoAnalizando({ conFotos: false, esMensual: true })).toContain("tus números y tu objetivo.");
  });
});

describe("alVolver", () => {
  it("si ya está, cancela el aviso y navega", () => {
    expect(alVolver("lista")).toEqual({ cancelarAviso: true, navegar: true, seguirSondeando: false });
  });
  it("si no, sigue sondeando", () => {
    expect(alVolver("analizando")).toEqual({ cancelarAviso: false, navegar: false, seguirSondeando: true });
  });
  it("sondea cada 5 s y avisa a los 3 min", () => {
    expect(SONDEO_MS).toBe(5000);
    expect(AVISO_ANALISIS_SEGUNDOS).toBe(180);
  });
});

describe("lineaCheckin", () => {
  it("cuenta hacia el mensual con el contador del servidor", () => {
    expect(lineaCheckin({ semanas: 3, fecha: "2026-10-04", ultimoMensual: "2026-09-06" })).toBe(
      "semanal · mensual en 3 semanas",
    );
    expect(lineaCheckin({ semanas: 1, fecha: "2026-10-04", ultimoMensual: "2026-09-06" })).toBe(
      "semanal · mensual en 1 semana",
    );
    expect(lineaCheckin({ semanas: 0, fecha: "2026-10-04", ultimoMensual: "2026-09-06" })).toBe(
      "este toca mensual: brazos, piernas y fotos",
    );
    expect(lineaCheckin(null)).toBe("semanal");
  });
});

describe("flechaDelta", () => {
  it("flecha, valor absoluto y unidad", () => {
    expect(flechaDelta(-1.2, "cm")).toBe("↓ 1.2 cm");
    expect(flechaDelta(0.4, "kg")).toBe("↑ 0.4 kg");
    expect(flechaDelta(0, "cm")).toBe("= 0 cm");
    expect(flechaDelta(null, "cm")).toBe("—");
  });
});

describe("resumenEsteMes", () => {
  it("cintura y peso contra el mes anterior, en una línea", () => {
    const vacio = { actual: null, vsMesAnterior: null, vsInicio: null };
    expect(
      resumenEsteMes({
        cintura: { actual: 88.8, vsMesAnterior: -1.2, vsInicio: -3 },
        peso: { actual: 75, vsMesAnterior: 0.1, vsInicio: -2 },
        brazoIzq: vacio,
        brazoDer: vacio,
        piernaIzq: vacio,
        piernaDer: vacio,
      }),
    ).toBe("Cintura ↓ 1.2 cm · Peso ↑ 0.1 kg");
  });
});

describe("resumenFotos", () => {
  it("cuenta zonas por brecha, o dice por qué no hay", () => {
    expect(
      resumenFotos({
        estado: "listo",
        zonas: [
          { zona: "cintura", brecha: "cerca", tendencia: "igual", accion: "seguir_igual" },
          { zona: "pierna", brecha: "lejos", tendencia: "igual", accion: "seguir_igual" },
          { zona: "espalda", brecha: "cerca", tendencia: "igual", accion: "seguir_igual" },
        ],
      }),
    ).toBe("2 cerca · 1 lejos");
    expect(resumenFotos({ estado: "sin_referencia", zonas: [] })).toBe("Sin fotos de referencia");
    expect(resumenFotos(null)).toBe("Sin lectura de fotos este mes");
  });
});

describe("tocaMensual", () => {
  const proximo = (semanas: number) => ({ semanas, fecha: "2026-10-04", ultimoMensual: "2026-09-06" });

  it("manda el contador del servidor cuando respondió", () => {
    expect(tocaMensual({ servidor: { proximoMensual: proximo(0) }, diasDesdeUltimaLocal: 3 })).toBe(true);
    expect(tocaMensual({ servidor: { proximoMensual: proximo(2) }, diasDesdeUltimaLocal: 40 })).toBe(false);
  });

  it("si el servidor respondió sin dato, abre", () => {
    expect(tocaMensual({ servidor: { proximoMensual: null }, diasDesdeUltimaLocal: 3 })).toBe(true);
  });

  it("sin servidor (offline), cae al cálculo local de 28 días", () => {
    expect(tocaMensual({ servidor: null, diasDesdeUltimaLocal: 28 })).toBe(true);
    expect(tocaMensual({ servidor: null, diasDesdeUltimaLocal: 10 })).toBe(false);
    expect(tocaMensual({ servidor: null, diasDesdeUltimaLocal: null })).toBe(false);
  });
});
