import { describe, expect, it } from "vitest";

import {
  AVISO_ANALISIS_SEGUNDOS,
  MARGEN_REPROGRAMAR_MS,
  MAX_REPROGRAMACIONES,
  SONDEO_MS,
  alEnviar,
  clasificarPermiso,
  pasoAviso,
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

describe("el aviso de la retro", () => {
  const T0 = 1_000_000;
  const TRES_MIN = AVISO_ANALISIS_SEGUNDOS * 1000;

  it("sondea cada 5 s y avisa a los 3 min, hasta 3 reprogramaciones", () => {
    expect(SONDEO_MS).toBe(5000);
    expect(AVISO_ANALISIS_SEGUNDOS).toBe(180);
    expect(MAX_REPROGRAMACIONES).toBe(3);
    // El margen tiene que cubrir al menos un sondeo: si no, el aviso viejo
    // se dispara antes de que el sondeo alcance a moverlo.
    expect(MARGEN_REPROGRAMAR_MS).toBeGreaterThan(SONDEO_MS);
  });

  it("se programa en cuanto se envía, no al irse a segundo plano", () => {
    const { aviso, accion } = alEnviar(T0);
    expect(accion).toEqual({ tipo: "programar", segundos: AVISO_ANALISIS_SEGUNDOS });
    expect(aviso).toEqual({ terminado: false, venceEn: T0 + TRES_MIN, reprogramaciones: 0, sigoConEllo: false });
  });

  it("si el sondeo la encuentra lista, cancela y navega", () => {
    const { aviso } = alEnviar(T0);
    const paso = pasoAviso(aviso, { tipo: "sondeo", estado: "lista", ahora: T0 + 60_000 });
    expect(paso.accion).toEqual({ tipo: "cancelar" });
    expect(paso.navegar).toBe(true);
    expect(paso.aviso.terminado).toBe(true);
  });

  it("antes de vencer, sin retro, no toca el aviso", () => {
    const { aviso } = alEnviar(T0);
    const paso = pasoAviso(aviso, { tipo: "sondeo", estado: "analizando", ahora: T0 + 60_000 });
    expect(paso.accion).toEqual({ tipo: "nada" });
    expect(paso.navegar).toBe(false);
    expect(paso.aviso).toEqual(aviso);
  });

  it("a punto de vencer en primer plano y sin retro: reprograma +3 min y dice 'sigo con ello'", () => {
    const { aviso } = alEnviar(T0);
    const ahora = T0 + TRES_MIN - MARGEN_REPROGRAMAR_MS;
    const paso = pasoAviso(aviso, { tipo: "sondeo", estado: "analizando", ahora });
    expect(paso.accion).toEqual({ tipo: "programar", segundos: AVISO_ANALISIS_SEGUNDOS });
    expect(paso.aviso).toEqual({
      terminado: false,
      venceEn: ahora + TRES_MIN,
      reprogramaciones: 1,
      sigoConEllo: true,
    });
  });

  it("al volver después de que el aviso ya sonó y sin retro, lo vuelve a poner", () => {
    const { aviso } = alEnviar(T0);
    const paso = pasoAviso(aviso, { tipo: "sondeo", estado: "analizando", ahora: T0 + 10 * 60_000 });
    expect(paso.accion.tipo).toBe("programar");
    expect(paso.aviso.reprogramaciones).toBe(1);
  });

  it("reprograma máximo 3 veces; después deja el último aviso en pie", () => {
    let { aviso } = alEnviar(T0);
    const programadas: number[] = [];
    for (let minuto = 1; minuto <= 30; minuto++) {
      const paso = pasoAviso(aviso, { tipo: "sondeo", estado: "analizando", ahora: T0 + minuto * 60_000 });
      if (paso.accion.tipo === "programar") programadas.push(minuto);
      expect(paso.accion.tipo).not.toBe("cancelar");
      aviso = paso.aviso;
    }
    expect(programadas).toEqual([3, 6, 9]);
    expect(aviso.reprogramaciones).toBe(MAX_REPROGRAMACIONES);
    expect(aviso.sigoConEllo).toBe(true);
  });

  it("en revisión humana cancela y no navega", () => {
    const { aviso } = alEnviar(T0);
    const paso = pasoAviso(aviso, { tipo: "revisionHumana" });
    expect(paso.accion).toEqual({ tipo: "cancelar" });
    expect(paso.navegar).toBe(false);
    expect(paso.aviso.terminado).toBe(true);
  });

  it("ya terminado, nada lo mueve", () => {
    const { aviso } = alEnviar(T0);
    const fin = pasoAviso(aviso, { tipo: "sondeo", estado: "lista", ahora: T0 }).aviso;
    const paso = pasoAviso(fin, { tipo: "sondeo", estado: "analizando", ahora: T0 + TRES_MIN });
    expect(paso.accion).toEqual({ tipo: "nada" });
    expect(paso.navegar).toBe(false);
    expect(paso.aviso).toEqual(fin);
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

describe("clasificarPermiso", () => {
  it("concedido si iOS lo dio (incluido el provisional)", () => {
    expect(clasificarPermiso({ granted: true, status: "granted" })).toBe("concedido");
  });
  it("sin preguntar: toca pedirlo con su renglón previo", () => {
    expect(clasificarPermiso({ granted: false, status: "undetermined" })).toBe("sin-preguntar");
  });
  it("negado: solo Ajustes del sistema lo reabre", () => {
    expect(clasificarPermiso({ granted: false, status: "denied" })).toBe("negado");
  });
  it("sin respuesta del sistema no se acusa de negado", () => {
    expect(clasificarPermiso(null)).toBe("sin-preguntar");
  });
});
