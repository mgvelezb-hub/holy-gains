import { describe, expect, it } from "vitest";

import {
  avisoDeRiesgo,
  compatibilidad,
  ordenar,
  porqueDeCombo,
  repartirCardioDespues,
  repartirMinutos,
  type BloqueDia,
} from "@/lib/training/combinaciones";

/**
 * Cómo conviven dos bloques el mismo día (Fase 9).
 *
 * No se prueban los números finos de `compatibilidad` —el puntaje exacto no
 * es una promesa del modelo—, sino las cuatro preguntas que el módulo
 * responde: ¿nunca combinan?, ¿en qué orden?, ¿cuántos minutos le tocan a
 * cada uno?, y ¿el porqué se dice de verdad?
 */

const PIERNA: BloqueDia = { discipline: "PESAS", dayKind: "PIERNA_CUADRICEPS" };
const TORSO_GYM: BloqueDia = { discipline: "PESAS", dayKind: "PECHO_ESPALDA" };
const SQUASH: BloqueDia = { discipline: "SQUASH" };
const BOX: BloqueDia = { discipline: "BOX" };
const CROSSFIT: BloqueDia = { discipline: "CROSSFIT" };
const NATACION: BloqueDia = { discipline: "NATACION" };
const CARDIO: BloqueDia = { discipline: "CARDIO" };

describe("compatibilidad: las incompatibilidades duras", () => {
  it("pierna de gimnasio + alto impacto nunca combina, en ningún orden", () => {
    for (const alto of [SQUASH, BOX, CROSSFIT, { discipline: "FUNCIONAL" as const }]) {
      expect(compatibilidad(PIERNA, alto), alto.discipline).toBeNull();
      expect(compatibilidad(alto, PIERNA), alto.discipline).toBeNull();
    }
  });

  it("un día de gimnasio que NO es de pierna sí puede combinar con alto impacto", () => {
    // La regla dura es específica de pierna fatigada, no de "cualquier día de
    // gimnasio": squash con un día de torso no comparte el riesgo de
    // tobillo/rodilla que sí hay con sentadilla o peso muerto reciente.
    expect(compatibilidad(TORSO_GYM, SQUASH)).not.toBeNull();
  });

  it("squash + box nunca combina", () => {
    expect(compatibilidad(SQUASH, BOX)).toBeNull();
    expect(compatibilidad(BOX, SQUASH)).toBeNull();
  });

  it("CrossFit + cualquier día de gimnasio nunca combina", () => {
    expect(compatibilidad(CROSSFIT, PIERNA)).toBeNull();
    expect(compatibilidad(CROSSFIT, TORSO_GYM)).toBeNull();
    expect(compatibilidad(PIERNA, CROSSFIT)).toBeNull();
  });

  it("pierna + alto impacto explícita baja a compatibilidad mínima en vez de null", () => {
    for (const alto of [SQUASH, BOX]) {
      const score = compatibilidad(PIERNA, alto, { explicita: true });
      expect(score, alto.discipline).not.toBeNull();
      expect(score!).toBeLessThan(compatibilidad(TORSO_GYM, alto)!);
    }
  });

  it("sin explicita, pierna + alto impacto sigue null aunque se pase el objeto de opts", () => {
    expect(compatibilidad(PIERNA, SQUASH, { explicita: false })).toBeNull();
    expect(compatibilidad(PIERNA, SQUASH, {})).toBeNull();
  });

  it("una disciplina consigo misma nunca combina", () => {
    expect(compatibilidad(PIERNA, { discipline: "PESAS", dayKind: "BRAZO" })).toBeNull();
    expect(compatibilidad(SQUASH, SQUASH)).toBeNull();
    expect(compatibilidad(NATACION, NATACION)).toBeNull();
  });

  it("fuera de las reglas duras, sí hay un puntaje", () => {
    expect(compatibilidad(TORSO_GYM, NATACION)).not.toBeNull();
    expect(compatibilidad(SQUASH, NATACION)).not.toBeNull();
    expect(compatibilidad(TORSO_GYM, CARDIO)).not.toBeNull();
  });
});

describe("compatibilidad: el puntaje", () => {
  it("la natación puntúa mejor que otra combinación equivalente sin natación", () => {
    // Mismo bloque de gimnasio, un lado con natación (bajo impacto, "refresca")
    // y el otro con cardio (grupo compartido: pierna).
    const conNatacion = compatibilidad(TORSO_GYM, NATACION)!;
    // Pierna + cardio sin datos (30 min de siempre) cuenta como intenso: se
    // ofrece al último, con puntaje mínimo (H2).
    expect(compatibilidad(PIERNA, CARDIO)).toBe(10);
    // Comparación más justa: torso + cardio (sin bono de natación) vs torso + natación.
    const torsoConCardio = compatibilidad(TORSO_GYM, CARDIO)!;
    expect(conNatacion).toBeGreaterThan(torsoConCardio);
  });

  it("más grupos musculares en común, peor puntaje", () => {
    // PECHO_ESPALDA carga PECHO/ESPALDA; CrossFit fatiga ESPALDA (nivel 2) —
    // pero CrossFit+gimnasio es una regla dura (null), así que se compara con
    // box, que también carga ESPALDA a nivel 1 (no cuenta) y HOMBRO/ABDOMEN a
    // nivel 2 (no se traslapan con pecho+espalda). Se usa squash (PIERNA+ABDOMEN)
    // contra un día de pierna sin la regla dura activa no es posible, así que
    // se compara contra un bloque de pesas sintético sin dayKind (sin carga
    // fuerte) para aislar el efecto del traslape.
    const sinCargaFuerte: BloqueDia = { discipline: "PESAS" };
    const conCargaFuerte: BloqueDia = { discipline: "PESAS", dayKind: "HOMBRO" }; // carga HOMBRO y ABDOMEN

    const sinTraslape = compatibilidad(sinCargaFuerte, BOX)!; // box carga HOMBRO(2) y ABDOMEN(2)
    const conTraslape = compatibilidad(conCargaFuerte, BOX)!;

    expect(conTraslape).toBeLessThan(sinTraslape);
  });

  it("golf puntúa mejor con el día de torso que con el día de hombro y core", () => {
    const GOLF: BloqueDia = { discipline: "GOLF" };
    const HOMBRO_GYM: BloqueDia = { discipline: "PESAS", dayKind: "HOMBRO" }; // hombro + core, el patrón del swing

    const conTorso = compatibilidad(TORSO_GYM, GOLF)!;
    const conHombro = compatibilidad(HOMBRO_GYM, GOLF)!;

    expect(conTorso).toBeGreaterThan(conHombro);
  });

  it("golf + día de hombro no es una regla dura, solo un puntaje peor: sí se ofrece", () => {
    const GOLF: BloqueDia = { discipline: "GOLF" };
    const HOMBRO_GYM: BloqueDia = { discipline: "PESAS", dayKind: "HOMBRO" };
    expect(compatibilidad(HOMBRO_GYM, GOLF)).not.toBeNull();
  });
});

describe("ordenar", () => {
  it("natación siempre va al final", () => {
    expect(ordenar(NATACION, SQUASH)).toEqual([SQUASH, NATACION]);
    expect(ordenar(SQUASH, NATACION)).toEqual([SQUASH, NATACION]);
    expect(ordenar(NATACION, TORSO_GYM)).toEqual([TORSO_GYM, NATACION]);
  });

  it("squash y box van antes que pesas", () => {
    expect(ordenar(TORSO_GYM, SQUASH)).toEqual([SQUASH, TORSO_GYM]);
    expect(ordenar(BOX, TORSO_GYM)).toEqual([BOX, TORSO_GYM]);
  });

  it("pesas antes que cardio", () => {
    expect(ordenar(CARDIO, TORSO_GYM)).toEqual([TORSO_GYM, CARDIO]);
    expect(ordenar(TORSO_GYM, CARDIO)).toEqual([TORSO_GYM, CARDIO]);
  });
});

describe("repartirMinutos", () => {
  it("resta la transición y reparte 60/40 a favor del primero, en múltiplos de 5", () => {
    // 90 min totales - 10 transición = 80. 60% de 80 = 48 -> redondeado a 50.
    const reparto = repartirMinutos(90, [TORSO_GYM, NATACION]);
    expect(reparto).not.toBeNull();
    expect(reparto!.minutos[0] % 5).toBe(0);
    expect(reparto!.minutos[1] % 5).toBe(0);
    expect(reparto!.minutos[0] + reparto!.minutos[1]).toBe(80);
    expect(reparto!.minutos[0]).toBeGreaterThan(reparto!.minutos[1]);
  });

  it("respeta el mínimo de 30 para pesas y 25 para cualquier otro", () => {
    // 70 - 10 = 60 disponibles; mínimos 30 + 25 = 55 <= 60: cabe justo.
    const reparto = repartirMinutos(70, [TORSO_GYM, SQUASH]);
    expect(reparto).not.toBeNull();
    expect(reparto!.minutos[0]).toBeGreaterThanOrEqual(30);
    expect(reparto!.minutos[1]).toBeGreaterThanOrEqual(25);
  });

  it("si no caben ambos mínimos aunque compatibilicen, devuelve null", () => {
    // 50 - 10 = 40 disponibles; pesas(30) + squash(25) = 55 > 40: no cabe.
    expect(repartirMinutos(50, [TORSO_GYM, SQUASH])).toBeNull();
  });

  it("un combo imposible por tiempo es null incluso con buena compatibilidad", () => {
    // Natación + torso es compatible (puntaje alto), pero si el día es corto
    // de verdad no hay reparto que alcance.
    expect(compatibilidad(TORSO_GYM, NATACION)).not.toBeNull();
    expect(repartirMinutos(45, [TORSO_GYM, NATACION])).toBeNull();
  });
});

describe("porqueDeCombo", () => {
  it("nunca viene vacío", () => {
    const casos: Array<[BloqueDia, BloqueDia]> = [
      [TORSO_GYM, NATACION],
      [SQUASH, TORSO_GYM],
      [TORSO_GYM, CARDIO],
      [BOX, TORSO_GYM],
    ];
    for (const [primero, segundo] of casos) {
      const texto = porqueDeCombo(primero, segundo);
      expect(texto.length).toBeGreaterThan(0);
    }
  });

  it("cuando natación cierra, explica que es para soltar", () => {
    expect(porqueDeCombo(TORSO_GYM, NATACION)).toContain("soltar");
  });

  it("cuando squash o box abren, explica que es por piernas frescas", () => {
    expect(porqueDeCombo(SQUASH, TORSO_GYM)).toContain("frescas");
    expect(porqueDeCombo(BOX, TORSO_GYM)).toContain("frescas");
  });
});

describe("avisoDeRiesgo", () => {
  it("avisa cuando el par es pierna + alto impacto, en cualquier orden", () => {
    expect(avisoDeRiesgo(PIERNA, SQUASH)).toContain("riesgo de lesión");
    expect(avisoDeRiesgo(BOX, PIERNA)).toContain("riesgo de lesión");
  });

  it("no avisa fuera de ese par, aunque haya pierna o alto impacto por separado", () => {
    expect(avisoDeRiesgo(PIERNA, NATACION)).toBeNull();
    expect(avisoDeRiesgo(TORSO_GYM, SQUASH)).toBeNull();
    expect(avisoDeRiesgo(SQUASH, BOX)).toBeNull();
  });
});

describe("cardio ligero vs intenso con pierna (H2)", () => {
  const LIGERO: BloqueDia = { discipline: "CARDIO", minutos: 20, intensidad: "media" };
  const CORTO_SIN_DATOS: BloqueDia = { discipline: "CARDIO", minutos: 20 };
  const LARGO: BloqueDia = { discipline: "CARDIO", minutos: 45, intensidad: "baja" };
  const HIIT_AVANZADO: BloqueDia = { discipline: "CARDIO", minutos: 20, intensidad: "alta" };

  it("el cardio ligero (≤25 min o intensidad baja/media) combina con pierna sin aviso", () => {
    for (const ligero of [LIGERO, CORTO_SIN_DATOS]) {
      expect(compatibilidad(PIERNA, ligero)).toBeGreaterThan(10);
      expect(avisoDeRiesgo(PIERNA, ligero)).toBeNull();
    }
  });

  it("el cardio largo o intenso con pierna se ofrece al último y con aviso, nunca null", () => {
    for (const intenso of [LARGO, HIIT_AVANZADO, CARDIO]) {
      expect(compatibilidad(PIERNA, intenso)).toBe(10);
      expect(avisoDeRiesgo(PIERNA, intenso)).toContain("riesgo de lesión");
    }
  });
});

describe("repartirCardioDespues (H2)", () => {
  it("el gym cede: 90 min con 20 de cardio son 70 + 20, sin transición", () => {
    expect(repartirCardioDespues(90, 20)).toEqual({ gym: 70, cardio: 20 });
  });

  it("si el gym quedaría por debajo de 25, el cardio se encoge", () => {
    expect(repartirCardioDespues(45, 30)).toEqual({ gym: 25, cardio: 20 });
  });

  it("un día de menos de 45 min no aguanta los dos", () => {
    expect(repartirCardioDespues(40, 20)).toBeNull();
  });
});
