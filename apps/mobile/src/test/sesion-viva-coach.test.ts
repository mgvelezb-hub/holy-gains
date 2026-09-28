import { describe, expect, it } from "vitest";

import {
  cerrarSerie,
  estadoInicial,
  etiquetaDeSerie,
  objetivoDeSerie,
  pesoDeDropset,
  textoDeTempo,
  type EjercicioVivo,
  type SerieViva,
} from "@/lib/sesion-viva";

const AHORA = new Date("2026-09-01T18:00:00Z").getTime();

function serie(extra: Partial<SerieViva> = {}): SerieViva {
  return { objetivo: 12, hechas: null, pesoKg: 40, calentamiento: false, ...extra };
}

function ejercicio(series: SerieViva[], extra: Partial<EjercicioVivo> = {}): EjercicioVivo {
  return { indice: 0, nombre: "Sentadilla búlgara", descansoSeg: 90, series, ...extra };
}

describe("cómo se lee una serie del coach", () => {
  it("el tempo se escribe 3-1-1", () => {
    expect(textoDeTempo({ ecc: 3, pause: 1, con: 1 })).toBe("3-1-1");
    expect(textoDeTempo(undefined)).toBeNull();
  });

  it("al fallo dice cuál es el piso, no un número suelto", () => {
    expect(objetivoDeSerie(serie())).toBe("12 reps");
    expect(objetivoDeSerie(serie({ intensidad: "fallo" }))).toBe("al fallo, mínimo 12");
    expect(objetivoDeSerie(serie({ intensidad: "dropset" }))).toBe("12 reps · sin descanso");
  });

  it("el dropset baja 20 % del peso de la serie anterior", () => {
    expect(pesoDeDropset(50)).toBe(40);
    expect(pesoDeDropset(null)).toBeNull();
  });
});

describe("unilaterales en la sesión", () => {
  it("la serie se nombra por lado y se cuenta dentro de su lado", () => {
    const uni = ejercicio(
      [
        serie({ lado: "DER" }),
        serie({ lado: "DER" }),
        serie({ lado: "DER" }),
        serie({ lado: "IZQ" }),
        serie({ lado: "IZQ" }),
        serie({ lado: "IZQ" }),
      ],
      { unilateral: true },
    );

    expect(etiquetaDeSerie(uni, 1)).toBe("Derecho · serie 2 de 3");
    expect(etiquetaDeSerie(uni, 4)).toBe("Izquierdo · serie 2 de 3");
  });

  it("sin lados se cuenta como siempre", () => {
    expect(etiquetaDeSerie(ejercicio([serie(), serie()]), 1)).toBe("Serie 2 de 2");
  });

  it("una serie de calentamiento se sigue diciendo", () => {
    expect(etiquetaDeSerie(ejercicio([serie({ calentamiento: true }), serie()]), 0)).toBe(
      "Serie 1 de 2 · calentamiento",
    );
  });
});

describe("el dropset no descansa", () => {
  it("cerrar la serie de antes de un dropset no arranca el reloj", () => {
    const estado = estadoInicial([
      ejercicio([serie(), serie({ intensidad: "dropset" })], { nombre: "Curl" }),
    ]);
    const { estado: siguiente } = cerrarSerie(estado, { reps: 12, pesoKg: 40 }, AHORA);

    expect(siguiente.descansoHasta).toBeNull();
    expect(siguiente.serieActual).toBe(1);
  });

  it("cerrar el dropset sí descansa: lo que no descansa es su entrada", () => {
    const estado = estadoInicial([
      ejercicio([serie({ hechas: 12 }), serie({ intensidad: "dropset" }), serie()], {
        nombre: "Curl",
      }),
    ]);
    const { estado: siguiente } = cerrarSerie(estado, { reps: 8, pesoKg: 32 }, AHORA);

    // Y descansa de más (I2): un dropset deja el músculo al fallo, así que
    // cuenta como serie dura y se lleva el +30 % (90 → 115 s).
    expect(siguiente.descansoHasta).toBe(AHORA + 115 * 1000);
  });
});
