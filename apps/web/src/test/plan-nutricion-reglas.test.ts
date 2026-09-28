import { describe, expect, it } from "vitest";

import {
  GLUCOSA_AYUNO_ALTA,
  avisosDelPlan,
  conSenalesClinicas,
  despensaDelPlan,
  horariosEfectivos,
  porqueDelPlan,
  recordatoriosDelPlan,
  senalesDeLabs,
  tomasDelPlan,
} from "@/lib/coachy/plan-nutricion-reglas";
import type { EngineProfile } from "@/lib/engine-types";

/**
 * K1 — las reglas puras del plan canónico de nutrición.
 *
 * Todo lo que "se nota" del plan —la glucosa que cambia el menú, la vitamina
 * D que trae la D3, el freno que pausa las tomas, el porqué en una línea, los
 * horarios del sábado— se decide aquí, sin base, para que cada superficie lo
 * lea del mismo lugar.
 */

const HOY = "2026-09-28";

function quimica(takenOn: string, valores: Array<{ key: string; value: number }>) {
  return { takenOn, valuesJson: valores.map((v) => ({ ...v, label: v.key, unit: "", refLow: null, refHigh: null })) };
}

describe("senalesDeLabs", () => {
  it("lee la glucosa en ayuno y la vitamina D más recientes del último año", () => {
    const senales = senalesDeLabs(
      [
        quimica("2026-03-01", [{ key: "glucosa", value: 92 }]),
        quimica("2026-09-16", [
          { key: "glucosa", value: 100 },
          { key: "vitamina_d", value: 24 },
        ]),
      ],
      HOY,
    );
    expect(senales.glucosaAyuno).toEqual({ valor: 100, fecha: "2026-09-16" });
    expect(senales.vitaminaD).toEqual({ valor: 24, fecha: "2026-09-16" });
  });

  it("ignora lo que tiene más de un año y lo que no se entiende", () => {
    const senales = senalesDeLabs(
      [quimica("2025-06-01", [{ key: "glucosa", value: 130 }]), { takenOn: HOY, valuesJson: "basura" }],
      HOY,
    );
    expect(senales.glucosaAyuno).toBeNull();
    expect(senales.vitaminaD).toBeNull();
  });
});

describe("conSenalesClinicas", () => {
  const perfil = { conditions: { glucosaAlta: false, lesionActiva: false } } as unknown as EngineProfile;

  it(`glucosa en ayuno ≥ ${GLUCOSA_AYUNO_ALTA} prende glucosa alta en el motor`, () => {
    const salida = conSenalesClinicas(perfil, { glucosaAyuno: { valor: 100, fecha: HOY }, vitaminaD: null });
    expect(salida.conditions?.glucosaAlta).toBe(true);
    expect(salida.conditions?.lesionActiva).toBe(false);
  });

  it("con glucosa normal no toca nada, y la etiqueta del perfil manda aunque no haya estudio", () => {
    expect(conSenalesClinicas(perfil, { glucosaAyuno: { valor: 95, fecha: HOY }, vitaminaD: null })).toBe(perfil);
    const conEtiqueta = { conditions: { glucosaAlta: true } } as unknown as EngineProfile;
    expect(conSenalesClinicas(conEtiqueta, { glucosaAyuno: null, vitaminaD: null }).conditions?.glucosaAlta).toBe(true);
  });
});

describe("porqueDelPlan", () => {
  it("en corte dice el déficit, el ritmo y la proteína en una línea", () => {
    const linea = porqueDelPlan({ phase: "CUT", kcal: 2500, gastoKcal: 3000, proteinG: 210 });
    expect(linea).toBe("Corte: −500 kcal para bajar ≈0.5 kg/semana; proteína alta (210 g) para conservar músculo.");
  });

  it("cada fase tiene su porqué y nunca dice un déficit negativo", () => {
    expect(porqueDelPlan({ phase: "BASE", kcal: 2585, gastoKcal: 2900, proteinG: 210 })).toMatch(/^Base: −300 kcal/);
    expect(porqueDelPlan({ phase: "MANTENIMIENTO", kcal: 3000, gastoKcal: 2980, proteinG: 200 })).toMatch(
      /^Mantenimiento: comes lo que gastas/,
    );
    expect(porqueDelPlan({ phase: "REFEED", kcal: 3100, gastoKcal: 3000, proteinG: 200 })).toMatch(/^Recarga/);
  });
});

describe("tomasDelPlan", () => {
  const tomas = [
    { supplement: "CREATINA", slot: "PRE", corto: "creatina", hecho: false },
    { supplement: "OMEGA3", slot: "COMIDA", corto: "omega-3", hecho: true },
  ] as never[];

  it("sin freno pasan tal cual", () => {
    expect(tomasDelPlan(tomas, null)).toEqual({ tomas, pausadas: 0 });
  });

  it("con freno clínico se pausan todas", () => {
    expect(tomasDelPlan(tomas, "Consulta con tu médico antes de agregar suplementos.")).toEqual({
      tomas: [],
      pausadas: 2,
    });
  });
});

describe("horariosEfectivos", () => {
  it("cada día y cada comida con su hora: el día manda, luego la general, luego el motor", () => {
    const porDia = horariosEfectivos(
      [
        { slot: "PRE", timeHint: "07:00" },
        { slot: "CENA", timeHint: "20:00" },
      ],
      { PRE: "06:30" },
      { SAB: { PRE: "08:00" } },
    );
    expect(porDia.LUN).toEqual({ PRE: "06:30", CENA: "20:00" });
    expect(porDia.SAB).toEqual({ PRE: "08:00", CENA: "20:00" });
    expect(Object.keys(porDia)).toEqual(["LUN", "MAR", "MIE", "JUE", "VIE", "SAB", "DOM"]);
  });
});

describe("despensaDelPlan", () => {
  it("cuenta lo de casa que entra en los menús y lo que la lista marca", () => {
    const despensa = despensaDelPlan(
      ["yogur_griego_0", "avena", "nuez"],
      [["yogur_griego_0", "avena"], ["avena"]],
      [{ name: "Yogur", enDespensa: true }, { name: "Avena", enDespensa: true }, { name: "Pollo" }] as never[],
    );
    expect(despensa).toEqual({ total: 3, enMenu: 2, enCasa: 2, sinUso: ["nuez"] });
  });
});

describe("avisosDelPlan", () => {
  it("freno arriba, luego glucosa y vitamina D con su acción", () => {
    const avisos = avisosDelPlan({
      freno: "Consulta con tu médico antes de agregar suplementos.",
      tomasPausadas: 2,
      senales: { glucosaAyuno: { valor: 100, fecha: HOY }, vitaminaD: { valor: 24, fecha: HOY } },
      glucosaAlta: true,
      fibraG: 35,
      sugiereD3: false,
      despensa: { total: 8, enMenu: 6, enCasa: 6, sinUso: ["nuez", "linaza"] },
    });
    expect(avisos.map((a) => a.id)).toEqual(["freno", "glucosa", "vitamina_d", "despensa"]);
    expect(avisos[0]!.nivel).toBe("freno");
    expect(avisos[0]!.texto).toContain("pausamos tus 2 tomas");
    expect(avisos[1]!.texto).toBe(
      "Tu glucosa en ayuno salió en 100 mg/dL: el menú usa carbohidratos de índice glucémico bajo y fibra de 35 g.",
    );
    expect(avisos[2]!.accion?.ruta).toBe("/ajustes/suplementos");
    expect(avisos.map((a) => a.corto)).toEqual([
      "Tomas en pausa · consulta a tu médico",
      "IG bajo · fibra 35 g",
      "Por debajo de 30",
      "2 de 8 sin usar esta semana",
    ]);
  });

  it("la vitamina D baja sin freno sugiere D3 y lleva a decidirla", () => {
    const [aviso] = avisosDelPlan({
      freno: null,
      tomasPausadas: 0,
      senales: { glucosaAyuno: null, vitaminaD: { valor: 24, fecha: HOY } },
      glucosaAlta: false,
      fibraG: 25,
      sugiereD3: true,
      despensa: { total: 0, enMenu: 0, enCasa: 0, sinUso: [] },
    });
    expect(aviso).toMatchObject({ id: "vitamina_d", accion: { etiqueta: "Decidir la D3", ruta: "/ajustes/suplementos?s=VITAMINA_D3" } });
    expect(aviso!.texto).toContain("24 ng/mL");
  });
});

describe("recordatoriosDelPlan", () => {
  it("el Prepárate lleva el menú de esa comida, sus tomas y la hora de cada día", () => {
    const [rec] = recordatoriosDelPlan(
      1,
      [
        {
          slot: "PRE",
          label: "Desayuno",
          timeHint: "06:30",
          items: [{ name: "Avena", display: "1/2 taza de avena" }, { name: "Yogur", display: null }],
        },
      ],
      [{ supplement: "CREATINA", slot: "PRE", corto: "creatina" }] as never[],
      horariosEfectivos([{ slot: "PRE", timeHint: "07:00" }], { PRE: "06:30" }, { SAB: { PRE: "08:00" } }),
    );
    expect(rec).toMatchObject({
      slot: "PRE",
      menuNumber: 1,
      extras: ["creatina"],
      cuerpo: "1/2 taza de avena, Yogur + creatina",
    });
    expect(rec!.horaPorDia.SAB).toBe("08:00");
    expect(rec!.horaPorDia.LUN).toBe("06:30");
  });
});
