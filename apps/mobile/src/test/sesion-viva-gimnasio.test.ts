import { describe, expect, it } from "vitest";

import {
  ajustarDescanso,
  alternativasLibres,
  barraPorDefecto,
  cerrarSerie,
  conFrecuencia,
  descansoPara,
  estadoInicial,
  fcDeRecuperacion,
  ladoDesdeTotal,
  omitirSaltadas,
  pesoSugerido,
  preguntarMontaje,
  primeraPendiente,
  progreso,
  sustituirEnSesion,
  terminarEjercicio,
  tipoDeEjercicio,
  totalDesdeLado,
  type EjercicioVivo,
  type SerieViva,
} from "@/lib/sesion-viva";

/**
 * Lo que pidió la primera semana de sesiones reales (I2): el descanso que
 * sirve para algo, la carga por lado, terminar UN ejercicio y los cambios que
 * no repiten ejercicio.
 */

const AHORA = new Date("2026-09-28T18:00:00Z").getTime();

function serie(extra: Partial<SerieViva> = {}): SerieViva {
  return { objetivo: 10, hechas: null, pesoKg: 60, calentamiento: false, ...extra };
}

function ejercicio(extra: Partial<EjercicioVivo> = {}, n = 3): EjercicioVivo {
  return {
    indice: 0,
    nombre: "Press de banca",
    descansoSeg: 60,
    series: Array.from({ length: n }, () => serie()),
    ...extra,
  };
}

const alt = (exerciseId: string, name: string) => ({
  exerciseId,
  name,
  declared: false,
  videoPath: null,
});

describe("descanso por esfuerzo", () => {
  it("clasifica el ejercicio por su rol", () => {
    expect(tipoDeEjercicio("cuadriceps_compuesto")).toBe("compuesto");
    expect(tipoDeEjercicio("empuje_horizontal")).toBe("compuesto");
    expect(tipoDeEjercicio("bicep_aislado")).toBe("aislado");
    expect(tipoDeEjercicio("deltoide_lateral")).toBe("aislado");
    expect(tipoDeEjercicio("unilateral")).toBe("accesorio");
    expect(tipoDeEjercicio(undefined)).toBeNull();
  });

  it("la base sale del ejercicio y del esquema: fuerza > hipertrofia > metabólico", () => {
    const hecha = serie({ hechas: 10 });
    const compuesto = (esquema: string) =>
      descansoPara(hecha, ejercicio({ poolRole: "cuadriceps_compuesto", esquema })).segundos;
    expect(compuesto("FUERZA")).toBe(180);
    expect(compuesto("PIRAMIDAL")).toBe(150);
    expect(compuesto("METABOLICO")).toBe(120);

    expect(descansoPara(hecha, ejercicio({ poolRole: "unilateral", esquema: "PIRAMIDAL" })).segundos).toBe(75);
    expect(descansoPara(hecha, ejercicio({ poolRole: "bicep_aislado", esquema: "METABOLICO" })).segundos).toBe(45);
  });

  it("sin rol conocido se queda con el descanso del plan", () => {
    expect(descansoPara(serie({ hechas: 10 }), ejercicio({ descansoSeg: 90 })).segundos).toBe(90);
  });

  it("al fallo o RPE 9–10 descansa 30 % más; si sobró mucho, 20 % menos", () => {
    const ej = ejercicio({ poolRole: "unilateral", esquema: "FUERZA" }); // base 90
    expect(descansoPara(serie({ hechas: 10, intensidad: "fallo" }), ej).segundos).toBe(115);
    expect(descansoPara(serie({ hechas: 10, rpe: 9.5 }), ej).segundos).toBe(115);
    // Se quedó corto del objetivo: fue más duro de lo planeado.
    expect(descansoPara(serie({ hechas: 7 }), ej).segundos).toBe(115);
    expect(descansoPara(serie({ hechas: 14 }), ej).segundos).toBe(70);
    expect(descansoPara(serie({ hechas: 10, rpe: 6 }), ej).segundos).toBe(70);
  });

  it("la FC objetivo es la mayor entre reposo + 30 y 55 % de la FC máxima", () => {
    // 208 − 0.7·40 = 180; 55 % = 99. Reposo 60 + 30 = 90 → manda 99.
    expect(fcDeRecuperacion(60, 40)).toBe(99);
    expect(fcDeRecuperacion(75, 40)).toBe(105);
    expect(fcDeRecuperacion(null, 40)).toBe(99);
    expect(fcDeRecuperacion(62, null)).toBe(92);
    expect(fcDeRecuperacion(null, null)).toBeNull();
  });

  it("con FC el descanso termina al recuperarse, entre 70 % y 150 % de la base", () => {
    const ej = ejercicio({ poolRole: "cuadriceps_compuesto", esquema: "PIRAMIDAL" }); // 150
    const hecha = serie({ hechas: 10 });
    const perfil = { reposo: 60, edad: 40 }; // objetivo 99

    // Ya bajó, pero antes del piso: se espera al piso (105 s).
    const temprano = descansoPara(hecha, ej, { bpm: 95, transcurridoSeg: 60, ...perfil });
    expect(temprano).toMatchObject({ segundos: 105, recuperado: true, fcObjetivo: 99 });

    // Bajó a los 120 s: el descanso termina ahí, antes de la regla (150).
    expect(descansoPara(hecha, ej, { bpm: 98, transcurridoSeg: 120, ...perfil }).segundos).toBe(120);

    // No baja: se alarga más allá de la regla, pero nunca pasa del techo (225).
    const alto = descansoPara(hecha, ej, { bpm: 130, transcurridoSeg: 160, ...perfil });
    expect(alto.recuperado).toBe(false);
    expect(alto.segundos).toBeGreaterThan(160);
    expect(descansoPara(hecha, ej, { bpm: 130, transcurridoSeg: 400, ...perfil }).segundos).toBe(225);

    // Sin edad ni reposo no hay objetivo: solo reglas.
    expect(
      descansoPara(hecha, ej, { bpm: 130, transcurridoSeg: 30, reposo: null, edad: null }).segundos,
    ).toBe(150);
  });

  it("cerrar una serie usa el descanso por esfuerzo y la FC lo mueve", () => {
    const estado = estadoInicial([ejercicio({ poolRole: "cuadriceps_compuesto", esquema: "PIRAMIDAL" })]);
    const { estado: descansando } = cerrarSerie(estado, { reps: 10, pesoKg: 60 }, AHORA);
    expect(descansando.descansoHasta).toBe(AHORA + 150_000);

    const perfil = { reposo: 60, edad: 40 };
    const recuperada = conFrecuencia(descansando, 97, perfil, AHORA + 120_000);
    expect(recuperada.estado.descansoHasta).toBe(AHORA + 120_000);
    expect(recuperada.descanso?.fcObjetivo).toBe(99);

    // Si la persona movió el descanso a mano, la FC ya no se lo cambia.
    const manual = ajustarDescanso(descansando, 30, AHORA + 10_000);
    expect(conFrecuencia(manual, 97, perfil, AHORA + 120_000).estado.descansoHasta).toBe(
      manual.descansoHasta,
    );
  });
});

describe("el peso de la siguiente serie", () => {
  it("usa lo que sugiere la progresión, corrido por lo que de verdad cargaste", () => {
    const ej = ejercicio({}, 3);
    ej.series = [
      serie({ hechas: 10, pesoKg: 65, pesoPlanKg: 60 }),
      serie({ pesoKg: 70, pesoPlanKg: 70 }),
      serie({ pesoKg: 80, pesoPlanKg: 80 }),
    ];
    expect(pesoSugerido(ej, 1)).toBe(75);
  });

  it("sin plan de peso, ajusta el de la serie anterior por las reps (pirámide subiendo)", () => {
    const ej = ejercicio({}, 2);
    ej.series = [serie({ objetivo: 10, hechas: 10, pesoKg: 60 }), serie({ objetivo: 6, pesoKg: null })];
    expect(pesoSugerido(ej, 1)).toBe(67.5);
  });

  it("sin serie anterior se queda con el plan", () => {
    const ej = ejercicio({}, 1);
    expect(pesoSugerido(ej, 0)).toBe(60);
  });

  it("el dropset sale del peso real de la anterior", () => {
    const ej = ejercicio({}, 2);
    ej.series = [
      serie({ hechas: 10, pesoKg: 50, pesoPlanKg: 45 }),
      serie({ intensidad: "dropset", pesoKg: 36 }),
    ];
    expect(pesoSugerido(ej, 1)).toBe(40);
  });
});

describe("carga por lado", () => {
  it("total = lado × 2 + barra, y de regreso", () => {
    expect(totalDesdeLado(20, 20)).toBe(60);
    expect(ladoDesdeTotal(60, 20)).toBe(20);
    expect(ladoDesdeTotal(10, 20)).toBe(0);
  });

  it("solo pregunta en barras y máquinas de discos", () => {
    expect(preguntarMontaje("Press de banca con barra")).toBe(true);
    expect(preguntarMontaje("Prensa de pierna")).toBe(true);
    expect(preguntarMontaje("Curl de bíceps con mancuerna")).toBe(false);
    expect(preguntarMontaje("Jalón al pecho en polea")).toBe(false);
  });

  it("la barra por defecto: olímpica 20 kg / 45 lb, carro de prensa 0", () => {
    expect(barraPorDefecto("Sentadilla con barra", "kg")).toBe(20);
    expect(barraPorDefecto("Sentadilla con barra", "lb")).toBeCloseTo(20.41, 2);
    expect(barraPorDefecto("Prensa de pierna", "kg")).toBe(0);
  });
});

describe("terminar este ejercicio", () => {
  it("pasa al siguiente y deja las series restantes SIN registrar", () => {
    let estado = estadoInicial([ejercicio({}, 5), ejercicio({ nombre: "Aperturas" }, 3)]);
    for (let i = 0; i < 3; i += 1) estado = cerrarSerie(estado, { reps: 10, pesoKg: 60 }, AHORA).estado;

    const { estado: siguiente, siguiente: que } = terminarEjercicio(estado);
    expect(que).toBe("otro_ejercicio");
    expect(siguiente.ejercicioActual).toBe(1);
    expect(siguiente.serieActual).toBe(0);
    const restantes = siguiente.ejercicios[0]!.series.slice(3);
    expect(restantes.every((s) => s.hechas === null && s.omitida === true)).toBe(true);
    // Las omitidas no cuentan como pendientes ni como parte del total.
    expect(primeraPendiente(siguiente.ejercicios)).toEqual({ ejercicio: 1, serie: 0 });
    expect(progreso(siguiente)).toEqual({ hechas: 3, total: 6 });

    // Cerrar la siguiente no regresa al ejercicio terminado.
    const despues = cerrarSerie(siguiente, { reps: 10, pesoKg: 20 }, AHORA).estado;
    expect(despues.ejercicioActual).toBe(1);
    expect(despues.serieActual).toBe(1);
  });

  it("en el último ejercicio termina la sesión", () => {
    let estado = estadoInicial([ejercicio({}, 3)]);
    estado = cerrarSerie(estado, { reps: 10, pesoKg: 60 }, AHORA).estado;
    const { estado: fin, siguiente } = terminarEjercicio(estado);
    expect(siguiente).toBe("fin");
    expect(fin.terminada).toBe(true);
    expect(fin.descansoHasta).toBeNull();
  });

  it("al retomar, lo que quedó atrás del cursor se da por terminado", () => {
    const primero = ejercicio({}, 3);
    primero.series[0]!.hechas = 10;
    const base = { ...estadoInicial([primero, ejercicio({}, 2)]), ejercicioActual: 1, serieActual: 0 };
    const estado = omitirSaltadas(base);
    expect(estado.ejercicios[0]!.series[1]!.omitida).toBe(true);
    expect(primeraPendiente(estado.ejercicios)).toEqual({ ejercicio: 1, serie: 0 });
  });
});

describe("cambiar un ejercicio sin repetir", () => {
  function sesion() {
    return estadoInicial([
      ejercicio({
        nombre: "Prensa de pierna",
        exerciseId: "prensa",
        alternativas: [alt("hack", "Hack squat"), alt("smith", "Sentadilla en Smith"), alt("bulg", "Búlgara")],
      }),
      ejercicio({ nombre: "Extensión de pierna", exerciseId: "ext" }),
      ejercicio({
        nombre: "Hack squat",
        exerciseId: "hack",
        alternativas: [alt("prensa", "Prensa de pierna"), alt("smith", "Sentadilla en Smith"), alt("bulg", "Búlgara")],
      }),
    ]);
  }

  it("no ofrece lo que ya está en la sesión", () => {
    const libres = alternativasLibres(sesion(), 0).map((opcion) => opcion.exerciseId);
    expect(libres).toEqual(["smith", "bulg"]);
  });

  it("si la alternativa ya estaba más abajo, ese de abajo se reemplaza por otro del grupo", () => {
    const { estado, cambios } = sustituirEnSesion(sesion(), 0, alt("hack", "Hack squat"));
    expect(estado.ejercicios[0]!.nombre).toBe("Hack squat");
    // El de abajo no puede volver a ser prensa (se acaba de quitar pero
    // repetir el patrón tampoco) ni hack: toca Smith.
    expect(estado.ejercicios[2]!.nombre).toBe("Sentadilla en Smith");
    expect(estado.ejercicios[2]!.exerciseId).toBe("smith");
    expect(cambios.map((cambio) => [cambio.indice, cambio.alternativa.exerciseId])).toEqual([
      [0, "hack"],
      [2, "smith"],
    ]);
    const nombres = estado.ejercicios.map((e) => e.nombre);
    expect(new Set(nombres).size).toBe(nombres.length);
  });

  it("lo capturado del ejercicio que se va se borra", () => {
    let estado = sesion();
    estado = cerrarSerie(estado, { reps: 10, pesoKg: 100 }, AHORA).estado;
    const { estado: cambiado } = sustituirEnSesion(estado, 0, alt("smith", "Sentadilla en Smith"));
    expect(cambiado.ejercicios[0]!.series.every((s) => s.hechas === null && s.pesoKg === null)).toBe(true);
    expect(cambiado.serieActual).toBe(0);
    expect(cambiado.descansoHasta).toBeNull();
  });
});
