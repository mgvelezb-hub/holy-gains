import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import { composeReply } from "@/lib/coachy/compose";
import { construyeBloqueMensual } from "@/lib/coachy/mensual";
import { lineasDelPlan, respuestaDeterminista } from "@/lib/coachy/retro";
import type { ComposeInput } from "@/lib/coachy/types";

/**
 * La retro en tres partes: "Va bien", "Hay que ajustar" y "Tu plan de aquí en
 * adelante". Con Claude o sin él, las tres salen; el plan lo escribimos
 * nosotros porque lleva los números del motor.
 */

const TARGETS = { kcal: 1700, proteinG: 130, fatG: 45, carbG: 210, fiberG: 30 };

const mensual = construyeBloqueMensual({
  serie: [
    {
      id: "a",
      fecha: "2026-08-02",
      cinturaCm: 90,
      pesoKg: 75,
      brazoIzqCm: 30,
      brazoDerCm: 30,
      piernaIzqCm: null,
      piernaDerCm: null,
    },
    {
      id: "b",
      fecha: "2026-08-30",
      cinturaCm: 88.8,
      pesoKg: 75.1,
      brazoIzqCm: null,
      brazoDerCm: null,
      piernaIzqCm: null,
      piernaDerCm: null,
    },
  ],
  checkInId: "b",
  fotos: null,
  cumplimientoDieta: 92,
  cumplimientoEntreno: 60,
  goal: "RECOMPOSICION",
});

const plan = lineasDelPlan({
  targets: TARGETS,
  previousKcal: 1800,
  menuNuevo: true,
  esMensual: true,
  rutina: { sesiones: 5, prioridad: ["PIERNA", "ESPALDA"] },
});

function input(overrides: Partial<ComposeInput> = {}): ComposeInput {
  return {
    athleteName: "Atleta",
    weekLabel: "30 de agosto de 2026",
    phase: "CUT",
    previousPhase: "BASE",
    targets: TARGETS,
    category: "CUT",
    rules: [],
    engineExplanation: "Cambio de fase.",
    signals: {
      fecha: "2026-08-30",
      cinturaCm: 88.8,
      cinturaDeltaCm: -0.4,
      cinturaDeltaDesdeInicioCm: -1.2,
      pesoKg: 75.1,
      pesoDeltaKg: 0.1,
      inflamacion: 2,
      energia: 4,
      hambre: 2,
      saciedad: 4,
      sueno: 4,
      fuerzaRpe: 8,
      fuerzaTendencia: "sube",
      cumplimientoDieta: 92,
      cumplimientoEntreno: 60,
      sintomas: [],
      faseCiclo: null,
      comentario: null,
      semanasEnFase: 4,
      semanasSinProgreso: 0,
      entrenamiento: { planeadas: 5, completadas: 3, recortadas: 0 },
    },
    vision: null,
    questions: [{ id: "q1", signal: "progreso", text: "¿Cómo sentiste la comida?" }],
    menuRefresh: true,
    electrolyteProtocol: false,
    injuryTrainingProtocol: false,
    simplifyMenu: false,
    mensual,
    plan,
    ...overrides,
  };
}

describe("lineasDelPlan", () => {
  it("una línea por pieza, con los números del motor y lo que cambió", () => {
    expect(plan.macros).toBe(
      "1700 kcal · 130 g de proteína · 210 g de carbohidratos · 45 g de grasa (antes 1800 kcal).",
    );
    expect(plan.menu).toMatch(/menú nuevo/i);
    expect(plan.rutina).toBe("Rutina rearmada: 5 sesiones de hoy al próximo domingo, con prioridad en pierna y espalda.");
  });

  it("sin cambios lo dice, y sin rutina rearmada no promete nada", () => {
    const quieto = lineasDelPlan({
      targets: TARGETS,
      previousKcal: 1700,
      menuNuevo: false,
      esMensual: false,
      rutina: null,
    });
    expect(quieto.macros).toContain("(sin cambio)");
    expect(quieto.menu).toMatch(/mismo menú/i);
    expect(quieto.rutina).toMatch(/Rutinas/);
  });
});

describe("respuestaDeterminista", () => {
  it("trae las tres partes sin Claude", () => {
    const reply = respuestaDeterminista(input());
    expect(reply.retro?.va_bien.length).toBeGreaterThan(0);
    expect(reply.retro?.ajustar.join(" ")).toMatch(/entreno/i);
    expect(reply.retro?.plan).toEqual(plan);
    expect(reply.mensual).toBeUndefined();
    expect(reply.decision_texto).toContain("1700");
    expect(reply.preguntas).toEqual(["¿Cómo sentiste la comida?"]);
    expect(reply.comparacion).toContain("88.8");
  });
});

function fakeClient(reply: unknown): { client: Anthropic; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue({
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id: "t", name: "responder_al_checkin", input: reply }],
  });
  return { client: { messages: { create } } as unknown as Anthropic, create };
}

const BASE_REPLY = {
  celebracion: "Bajaste cintura.",
  preguntas: [],
  comparacion: "Contra el mes pasado, menos cintura.",
  decision_texto: "Pasamos a 1700 kcal.",
  meta: "Siete días completos.",
  cierre: "Vamos.",
};

describe("composeReply con la retro", () => {
  it("le da a Claude el mensual y el plan, y respeta el plan escrito por nosotros", async () => {
    const { client, create } = fakeClient({
      ...BASE_REPLY,
      va_bien: ["La cintura bajó 1.2 cm en el mes."],
      hay_que_ajustar: ["El entreno quedó al 60 %: lo acomodamos."],
    });

    const reply = await composeReply(input(), { client });

    const contexto = String(create.mock.calls[0]?.[0].messages[0].content);
    expect(contexto).toContain("check-in mensual");
    expect(contexto).toContain(plan.rutina);
    expect(reply.retro?.va_bien).toEqual(["La cintura bajó 1.2 cm en el mes."]);
    expect(reply.retro?.ajustar).toEqual(["El entreno quedó al 60 %: lo acomodamos."]);
    expect(reply.retro?.plan).toEqual(plan);
  });

  it("tira los renglones con números que no están en el contexto", async () => {
    const { client } = fakeClient({
      ...BASE_REPLY,
      va_bien: ["Bajaste 4 kg de grasa y tu cuerpo está al 18 % (inventado 1450)."],
      hay_que_ajustar: [],
    });

    const reply = await composeReply(input(), { client });
    // El renglón inventado se va y entra la versión determinista.
    expect(reply.retro?.va_bien.join(" ")).not.toContain("1450");
    expect(reply.retro?.va_bien.length).toBeGreaterThan(0);
  });

  it("sin mensual ni plan, la respuesta queda como siempre", async () => {
    const { client } = fakeClient(BASE_REPLY);
    const reply = await composeReply(input({ mensual: undefined, plan: undefined }), { client });
    expect(reply.retro).toBeUndefined();
  });
});
