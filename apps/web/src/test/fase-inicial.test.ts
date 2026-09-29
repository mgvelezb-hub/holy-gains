import { describe, expect, it } from "vitest";

import { arranqueDelMotor } from "@/lib/coachy/fase-inicial";

describe("arranqueDelMotor — de qué fase parte el motor", () => {
  it("sin decisiones previas parte de la fase declarada en el perfil", () => {
    expect(arranqueDelMotor({ faseDeclarada: "CUT", decisionesPrevias: [] })).toEqual({ initialPhase: "CUT" });
    expect(arranqueDelMotor({ faseDeclarada: "REINTRO", decisionesPrevias: [] })).toEqual({
      initialPhase: "REINTRO",
    });
  });

  it("con historial manda lo ya decidido, no la fase declarada", () => {
    // Una decisión previa en BASE con el perfil diciendo CUT: el motor
    // repite el recorrido desde donde de verdad arrancó.
    expect(
      arranqueDelMotor({ faseDeclarada: "CUT", decisionesPrevias: [{ phase: "BASE" }] }),
    ).toEqual({ initialPhase: "BASE" });
  });

  it("con varias decisiones ancla el recorrido en la primera (no reescribe la historia)", () => {
    expect(
      arranqueDelMotor({
        faseDeclarada: "BASE",
        decisionesPrevias: [{ phase: "CUT" }, { phase: "CUT" }, { phase: "REFEED" }],
      }),
    ).toEqual({ initialPhase: "CUT" });
  });
});
