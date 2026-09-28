import { describe, expect, it } from "vitest";
import { checkInSchema, coerceCheckInPayload } from "../checkin";

/** Lo que manda la app nativa: sin `sleep`, porque el reloj lo aporta. */
const payloadApp = {
  date: "2026-09-28",
  waistCm: 118.5,
  weightKg: 120.3,
  legLeftCm: null,
  legRightCm: null,
  armLeftCm: null,
  armRightCm: null,
  inflammation: 3,
  energy: 4,
  hunger: 2,
  satiety: 4,
  strengthRpe: null,
  dietCompliance: 80,
  trainingCompliance: 67,
  symptoms: [],
  periodStarted: false,
};

describe("checkInSchema", () => {
  it("acepta el check-in de la app aunque no traiga descanso", () => {
    // La app nativa dejó de preguntar el descanso; el servidor lo deriva del
    // reloj. `coerce` vuelve `null` lo que no viene, y null no es undefined.
    const parsed = checkInSchema.safeParse(coerceCheckInPayload(payloadApp));
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    if (parsed.success) expect(parsed.data.sleep ?? null).toBeNull();
  });

  it("sigue aceptando el descanso cuando la web lo manda", () => {
    const parsed = checkInSchema.safeParse(coerceCheckInPayload({ ...payloadApp, sleep: "4" }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.sleep).toBe(4);
  });

  it("rechaza un descanso fuera de 1-5", () => {
    const parsed = checkInSchema.safeParse(coerceCheckInPayload({ ...payloadApp, sleep: 7 }));
    expect(parsed.success).toBe(false);
  });
});
