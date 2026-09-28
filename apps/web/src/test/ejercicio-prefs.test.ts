import { describe, expect, it } from "vitest";

import {
  conMontaje,
  edadEnAnios,
  ejercicioPrefsSchema,
  leeMontajes,
} from "@/app/api/v1/me/ejercicio-prefs/prefs";

/** Cómo está montado cada ejercicio (carga por lado y barra), en `Profile.exercisePrefs`. */
describe("preferencias de montaje por ejercicio", () => {
  it("valida lo que manda el teléfono", () => {
    expect(ejercicioPrefsSchema.safeParse({ exerciseId: "press", cargaPorLado: true, barraKg: 20 }).success).toBe(true);
    expect(ejercicioPrefsSchema.safeParse({ exerciseId: "", cargaPorLado: true, barraKg: 20 }).success).toBe(false);
    expect(ejercicioPrefsSchema.safeParse({ exerciseId: "p", cargaPorLado: true, barraKg: -1 }).success).toBe(false);
    expect(ejercicioPrefsSchema.safeParse({ exerciseId: "p", cargaPorLado: "sí", barraKg: 0 }).success).toBe(false);
  });

  it("lee la columna tolerando basura", () => {
    expect(leeMontajes(null)).toEqual({});
    expect(leeMontajes([1, 2])).toEqual({});
    expect(
      leeMontajes({
        press: { cargaPorLado: true, barraKg: 20 },
        roto: { cargaPorLado: "x" },
        prensa: { cargaPorLado: true, barraKg: 0 },
      }),
    ).toEqual({ press: { cargaPorLado: true, barraKg: 20 }, prensa: { cargaPorLado: true, barraKg: 0 } });
  });

  it("guardar uno no borra los demás", () => {
    const antes = { press: { cargaPorLado: true, barraKg: 20 } };
    expect(conMontaje(antes, { exerciseId: "prensa", cargaPorLado: true, barraKg: 0 })).toEqual({
      press: { cargaPorLado: true, barraKg: 20 },
      prensa: { cargaPorLado: true, barraKg: 0 },
    });
    expect(conMontaje(antes, { exerciseId: "press", cargaPorLado: false, barraKg: 20 }).press).toEqual({
      cargaPorLado: false,
      barraKg: 20,
    });
  });

  it("la edad sale de la fecha de nacimiento o del punto medio del rango", () => {
    const hoy = new Date("2026-09-28T12:00:00Z");
    expect(edadEnAnios(new Date("1986-10-01"), null, hoy)).toBe(39);
    expect(edadEnAnios(null, "35_44", hoy)).toBe(40);
    expect(edadEnAnios(null, null, hoy)).toBeNull();
  });
});
