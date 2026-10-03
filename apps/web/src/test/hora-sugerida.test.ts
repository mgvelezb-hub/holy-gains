import type { TomaDelDia } from "engine";
import { describe, expect, it } from "vitest";

import { conHoraSugerida, momentoDeHoy, type ContextoHoraSugerida } from "@/lib/suplementos/hora-sugerida";

function toma(parcial: Partial<TomaDelDia>): TomaDelDia {
  return {
    supplement: "CREATINA",
    categoria: "SUPLEMENTO",
    nombre: "Creatina",
    corto: "creatina",
    dosis: "5 g",
    slot: null,
    ancla: "LIBRE",
    cuando: "cuando quieras",
    hecho: false,
    ...parcial,
  } as TomaDelDia;
}

const tarde: ContextoHoraSugerida = {
  horasComida: { DESAYUNO: "08:00", COMIDA: "14:30", PRE: "17:00", CENA: "21:00" },
  entreno: "TARDE",
  minutosSesion: 60,
};

describe("hora sugerida de cada toma", () => {
  it("la que va con una comida sugiere la hora de esa comida", () => {
    const [omega] = conHoraSugerida([toma({ slot: "COMIDA", ancla: "COMIDA", cuando: "con la comida" })], tarde);
    expect(omega!.horaSugerida).toBe("14:30");
    expect(omega!.sugerencia).toBe("Sugerido ~14:30 · con la comida");
  });

  it("antes de entrenar se ancla al pre-entreno del menú", () => {
    const [cafeina] = conHoraSugerida([toma({ ancla: "PRE_ENTRENO", cuando: "antes de entrenar" })], tarde);
    // Pre a las 17:00 → entreno 18:00 → media hora antes.
    expect(cafeina!.horaSugerida).toBe("17:30");
  });

  it("después de entrenar suma la sesión", () => {
    const [creatina] = conHoraSugerida([toma({ ancla: "POST_ENTRENO" })], tarde);
    expect(creatina!.horaSugerida).toBe("19:00");
  });

  it("sin pre-entreno en el menú usa la hora típica del momento declarado", () => {
    const contexto = { ...tarde, horasComida: { DESAYUNO: "08:00", CENA: "21:00" }, entreno: "MANANA" as const };
    const [creatina] = conHoraSugerida([toma({ ancla: "POST_ENTRENO" })], contexto);
    expect(creatina!.horaSugerida).toBe("08:00");
  });

  it("en día de descanso lo del entreno va con la comida fuerte", () => {
    const [creatina] = conHoraSugerida([toma({ ancla: "POST_ENTRENO" })], { ...tarde, entreno: "DESCANSO" });
    expect(creatina!.horaSugerida).toBe("14:30");
    expect(creatina!.sugerencia).toContain("hoy descansas");
  });

  it("dormir: dos horas después de la última comida, con tope", () => {
    const [melatonina] = conHoraSugerida([toma({ ancla: "DORMIR", cuando: "antes de dormir" })], tarde);
    expect(melatonina!.horaSugerida).toBe("23:00");
    const tardisima = { ...tarde, horasComida: { CENA: "22:30" } };
    expect(conHoraSugerida([toma({ ancla: "DORMIR" })], tardisima)[0]!.horaSugerida).toBe("23:30");
  });

  it("la libre no inventa hora", () => {
    const [libre] = conHoraSugerida([toma({ ancla: "LIBRE" })], tarde);
    expect(libre!.horaSugerida).toBeNull();
    expect(libre!.sugerencia).toBe("Cuando te acomode");
  });
});

describe("momento de entrenar de hoy", () => {
  it("manda el horario del día; si no hay, el general", () => {
    expect(momentoDeHoy({ SAB: "DESCANSO" }, "TARDE", "SAB")).toBe("DESCANSO");
    expect(momentoDeHoy({ SAB: "DESCANSO" }, "TARDE", "LUN")).toBe("TARDE");
    expect(momentoDeHoy(null, "NOCHE", "LUN")).toBe("NOCHE");
  });
});
