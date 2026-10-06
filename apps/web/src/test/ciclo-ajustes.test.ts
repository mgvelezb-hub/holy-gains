import { describe, expect, it } from "vitest";

import { KCAL_EXTRA_LUTEA, ajusteDelCiclo, minutosSesionLigera } from "@/lib/ciclo/ajustes";
import { estimateCyclePhase } from "@/lib/cycle";

const ajustes = { enabled: true, lastPeriodStart: "2026-10-01", avgLengthDays: 28 };

describe("qué cambia en cada fase (moderado, con aviso)", () => {
  it("periodo: ofrece la versión ligera y habla de hierro y agua, sin margen de kcal", () => {
    const ajuste = ajusteDelCiclo(estimateCyclePhase(ajustes, "2026-10-03"))!;
    expect(ajuste.fase).toBe("MENSTRUACION");
    expect(ajuste.linea).toBe("Día 3 · Menstruación (estimado)");
    expect(ajuste.entrenamiento.ofreceLigera).toBe(true);
    expect(ajuste.nutricion?.kcalExtra).toBe(0);
    expect(ajuste.nutricion?.texto).toContain("hierro");
  });

  it("lútea: margen de calorías, más agua, sin versión ligera", () => {
    const ajuste = ajusteDelCiclo(estimateCyclePhase(ajustes, "2026-10-22"))!;
    expect(ajuste.fase).toBe("LUTEA");
    expect(ajuste.entrenamiento.ofreceLigera).toBe(false);
    expect(ajuste.nutricion?.kcalExtra).toBe(KCAL_EXTRA_LUTEA);
    expect(ajuste.nutricion?.corto).toContain("agua");
  });

  it("folicular: no mueve la comida y dice que es buena ventana para progresar", () => {
    const ajuste = ajusteDelCiclo(estimateCyclePhase(ajustes, "2026-10-08"))!;
    expect(ajuste.fase).toBe("FOLICULAR");
    expect(ajuste.nutricion).toBeNull();
    expect(ajuste.entrenamiento.texto).toContain("progresar");
  });

  it("sin seguimiento o sin fecha no hay ajuste", () => {
    expect(ajusteDelCiclo(estimateCyclePhase({ ...ajustes, enabled: false }, "2026-10-03"))).toBeNull();
    expect(ajusteDelCiclo(estimateCyclePhase({ ...ajustes, lastPeriodStart: null }, "2026-10-03"))).toBeNull();
  });

  it("siempre lo dice como estimación", () => {
    expect(ajusteDelCiclo(estimateCyclePhase(ajustes, "2026-10-03"))!.nota).toContain("No es un diagnóstico");
  });

  it("la versión ligera es ~70 % de la sesión, en múltiplos de 5 y nunca menos de 15", () => {
    expect(minutosSesionLigera(60)).toBe(40);
    expect(minutosSesionLigera(75)).toBe(55);
    expect(minutosSesionLigera(15)).toBe(15);
  });
});
