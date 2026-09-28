import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { esqueletoDeSemana } from "@/lib/training/esqueleto";
import { generateWeek } from "@/lib/training/generate";
import { replanificar } from "@/lib/training/replan";
import { armarPlanSemana, diasDelPlan, firmaDelPlan } from "@/lib/training/semana";
import { DAY_GROUPS, diasDeclarados, intercalarMitades, presetSplit } from "@/lib/training/split";
import { recortarPendiente } from "@/lib/training/trim";
import type { DayKind, ExerciseOption, PlannedExercise, TrainingProfile } from "@/lib/training/types";

/**
 * I1 — la semana canónica, en puro. El caso es el de Mau (29-sep): gimnasio
 * L–V a 90 min, sábado y domingo en 0, cardio después de pesas y el preset
 * 3/3 de seis días guardado como split propio.
 */

const CATALOG: ExerciseOption[] = (
  JSON.parse(readFileSync(join(process.cwd(), "prisma/exercises.json"), "utf8")) as Array<
    Omit<ExerciseOption, "id" | "videoUrl">
  >
).map((row) => ({ ...row, id: `ex-${row.name}`, videoUrl: null }));

const L_V = { LUN: 90, MAR: 90, MIE: 90, JUE: 90, VIE: 90, SAB: 0, DOM: 0 };

function mau(overrides: Partial<TrainingProfile> = {}): TrainingProfile {
  return {
    liftingDays: 6,
    trainingSchedule: { LUN: "MANANA", MAR: "MANANA", MIE: "MANANA", JUE: "MANANA", VIE: "MANANA", SAB: "MANANA", DOM: "DESCANSO" },
    conditions: [],
    volumeBias: "normal",
    sessionMinutes: 90,
    cardioMinWk: 0,
    avoidRepeatGroups: [],
    primaryDiscipline: "PESAS",
    otherDisciplines: [{ discipline: "CARDIO", sessionsPerWeek: 5, modo: "DESPUES" }],
    disciplineLevels: {},
    gymLevel: "INTERMEDIO",
    goal: "PERDIDA_GRASA",
    timePerDay: L_V,
    compactDays: true,
    schemePreference: "RECOMENDADO",
    customSplit: presetSplit("INFERIOR_SUPERIOR_3_3", 6),
    ...overrides,
  };
}

/** Lunes 2026-09-28 = semana ISO 40, la de las capturas. */
const LUNES = new Date("2026-09-28T12:00:00");

const inferior = (kind: DayKind): boolean => DAY_GROUPS[kind].includes("PIERNA");

describe("días declarados", () => {
  it("un día con 0 min no es de entrenar, diga lo que diga el horario", () => {
    expect(diasDeclarados(mau())).toEqual(["LUN", "MAR", "MIE", "JUE", "VIE"]);
  });

  it("sin horario, salen de los minutos; sin nada, de los primeros N", () => {
    expect(diasDeclarados(mau({ trainingSchedule: null, timePerDay: { MAR: 60, JUE: 60 } }))).toEqual(["MAR", "JUE"]);
    expect(diasDeclarados(mau({ trainingSchedule: null, timePerDay: null, liftingDays: 3 }))).toEqual([
      "LUN",
      "MAR",
      "MIE",
    ]);
  });
});

describe("el split propio se mapea por orden a los días declarados", () => {
  it("el preset 3/3 con cinco días L–V: cinco días de gimnasio, ninguno el sábado", () => {
    for (const semana of [0, 1, 2, 3]) {
      const lunes = new Date(LUNES);
      lunes.setDate(lunes.getDate() + semana * 7);
      const { days } = esqueletoDeSemana(mau(), lunes);
      expect(days).toEqual(["LUN", "MAR", "MIE", "JUE", "VIE"]);
    }
  });

  it("alterna inferior y superior; el objetivo decide qué mitad lleva tres", () => {
    const perder = esqueletoDeSemana(mau(), LUNES).kinds;
    expect(perder.map(inferior)).toEqual([false, true, false, true, false]);

    const musculo = esqueletoDeSemana(mau({ goal: "GANANCIA_MUSCULO" }), LUNES).kinds;
    expect(musculo.map(inferior)).toEqual([true, false, true, false, true]);
  });

  it("la mitad que pierde el día rota semana a semana", () => {
    const vistos = new Set<string>();
    for (const semana of [0, 1, 2]) {
      const lunes = new Date(LUNES);
      lunes.setDate(lunes.getDate() + semana * 7);
      vistos.add(esqueletoDeSemana(mau({ goal: "GANANCIA_MUSCULO" }), lunes).kinds.join(","));
    }
    expect(vistos.size).toBeGreaterThan(1);
  });

  it("un split escrito en menos días, todos con tiempo, se queda en sus días", () => {
    const { days } = esqueletoDeSemana(
      mau({ customSplit: { MAR: "PIERNA_CUADRICEPS", JUE: "TORSO", DOM: "DESCANSO" } }),
      LUNES,
    );
    expect(days).toEqual(["MAR", "JUE"]);
  });

  it("intercalar conserva el orden dentro de cada mitad", () => {
    expect(intercalarMitades(["PIERNA_CUADRICEPS", "PIERNA_FEMORAL", "PIERNA_GLUTEO", "PECHO_TRICEP", "ESPALDA_BICEP"])).toEqual([
      "PIERNA_CUADRICEPS",
      "PECHO_TRICEP",
      "PIERNA_FEMORAL",
      "ESPALDA_BICEP",
      "PIERNA_GLUTEO",
    ]);
  });
});

describe("minutos de pesas reales", () => {
  it("con cardio después, el gym se arma con 70 (90 − 20), no con 90", () => {
    const semana = generateWeek(mau(), [], { weekStart: LUNES, catalog: CATALOG });
    const sinCardio = generateWeek(mau({ otherDisciplines: [] }), [], { weekStart: LUNES, catalog: CATALOG });

    expect(semana.otherSessions.filter((s) => s.discipline === "CARDIO")).toHaveLength(5);
    for (const workout of semana.workouts) expect(workout.estimatedMin ?? 0).toBeLessThanOrEqual(70);
    const total = (w: typeof semana) => w.workouts.reduce((suma, x) => suma + x.exercises.length, 0);
    expect(total(semana)).toBeLessThan(total(sinCardio));
  });

  it("sin cardio, cada día usa SUS minutos declarados, no `sessionMinutes`", () => {
    const corto = generateWeek(mau({ otherDisciplines: [], sessionMinutes: 45 }), [], {
      weekStart: LUNES,
      catalog: CATALOG,
    });
    const largo = generateWeek(mau({ otherDisciplines: [], sessionMinutes: 90 }), [], {
      weekStart: LUNES,
      catalog: CATALOG,
    });
    expect(corto.workouts.map((w) => w.exercises.length)).toEqual(largo.workouts.map((w) => w.exercises.length));
  });

  it("'hoy tengo menos tiempo' gana sobre todo: 40 min dejan ≤ 4 ejercicios", () => {
    const semana = generateWeek(mau(), [], {
      weekStart: LUNES,
      catalog: CATALOG,
      minutosGymPorFecha: { "2026-09-28": 40 },
    });
    expect(semana.workouts[0]!.exercises.length).toBeLessThanOrEqual(4);
  });
});

describe("la línea del día, la misma en todas las pantallas", () => {
  it("gym + cardio: 'Pierna · cuádriceps · 6 ejercicios · + Cardio HIIT 20 min'", () => {
    const [lunes, martes] = diasDelPlan(
      "2026-09-28",
      [{ date: "2026-09-28", dayKind: "PIERNA_CUADRICEPS", muscleGroup: "Pierna · cuádriceps", ejercicios: 6, minutos: 60, recortada: null }],
      [
        {
          date: "2026-09-28",
          weekday: "LUN",
          discipline: "CARDIO",
          minutes: 20,
          sesion: { focus: "HIIT" } as never,
          note: "",
          sharesDayWithGym: true,
          orden: 2,
        },
      ],
      L_V,
    );
    expect(lunes!.linea).toBe("Pierna · cuádriceps · 6 ejercicios · + Cardio HIIT 20 min");
    expect(martes!.linea).toBe("Descanso");
  });

  it("armarPlanSemana: los días del plan son los de sus sesiones", () => {
    const plan = armarPlanSemana({
      training: mau(),
      cambios: {},
      bloquesDelDia: {},
      weekStart: LUNES,
      catalog: CATALOG,
      history: [],
    });
    expect(plan.dias.filter((dia) => dia.gym).map((dia) => dia.weekday)).toEqual(["LUN", "MAR", "MIE", "JUE", "VIE"]);
    expect(plan.dias.every((dia) => !dia.gym || dia.linea.includes("+ Cardio"))).toBe(true);
  });

  it("'hoy solo squash, sin gym' saca el gimnasio de ese día", () => {
    const plan = armarPlanSemana({
      training: mau(),
      cambios: { "2026-09-30": ["SQUASH"] },
      bloquesDelDia: {},
      weekStart: LUNES,
      catalog: CATALOG,
      history: [],
    });
    const miercoles = plan.dias.find((dia) => dia.weekday === "MIE")!;
    expect(miercoles.gym).toBeNull();
    expect(miercoles.bloques.map((b) => b.discipline)).toEqual(["SQUASH"]);
  });
});

describe("firma de las preferencias", () => {
  it("no depende del orden de las llaves y sí de lo que cambia el plan", () => {
    const a = firmaDelPlan(mau());
    const b = firmaDelPlan(mau({ timePerDay: { DOM: 0, SAB: 0, VIE: 90, JUE: 90, MIE: 90, MAR: 90, LUN: 90 } }));
    expect(a).toBe(b);
    expect(firmaDelPlan(mau({ otherDisciplines: [{ discipline: "CARDIO", sessionsPerWeek: 5, modo: "DIA_PROPIO" }] }))).not.toBe(a);
  });
});

describe("replantear: el cardio 'lo entreno' no se pierde", () => {
  const entrada = {
    tiempo: { ...L_V },
    primaria: "PESAS" as const,
    sesionesPrimaria: 5,
    secundarias: [{ discipline: "CARDIO" as const, proposito: "ENTRENAMIENTO" as const, importancia: 2 }],
  };

  it("sin días libres, va después de pesas por default y lo dice en una línea", () => {
    const replan = replanificar(entrada);
    const cardio = replan.asignadas.filter((a) => a.discipline === "CARDIO");
    expect(cardio.map((a) => a.weekday)).toEqual(["LUN", "MAR", "MIE", "JUE", "VIE"]);
    expect(replan.asignadas.filter((a) => a.esPrimaria).every((a) => a.minutos === 70)).toBe(true);
    expect(replan.cargas.find((c) => c.discipline === "CARDIO")).toMatchObject({ modo: "DESPUES", sessionsPerWeek: 5 });
    expect(replan.presupuesto).toBe(5);
    expect(replan.avisos.some((aviso) => aviso.includes("Ajustes"))).toBe(false);
    expect(replan.avisos).toContain("El cardio va después de pesas: no quedó ningún día libre con tiempo.");
    expect(replan.acciones).toEqual([
      { discipline: "CARDIO", modo: "DESPUES", alternativa: { modo: "DIA_PROPIO", texto: "Darle su propio día" } },
    ]);
  });

  it("con día propio pedido a propósito, el aviso trae la acción ahí mismo", () => {
    const replan = replanificar({
      ...entrada,
      secundarias: [{ ...entrada.secundarias[0]!, modo: "DIA_PROPIO" }],
    });
    expect(replan.asignadas.some((a) => a.discipline === "CARDIO")).toBe(false);
    expect(replan.avisos).toContain("El cardio no cupo: no queda ningún día libre con tiempo.");
    expect(replan.acciones[0]!.alternativa).toEqual({ modo: "DESPUES", texto: "Pegar el cardio después de pesas" });
  });
});

describe("recortar solo lo pendiente", () => {
  const ejercicio = (name: string): PlannedExercise => ({
    exerciseId: name,
    name,
    muscleGroup: "PIERNA",
    poolRole: "x",
    scheme: "PIRAMIDAL",
    schemeLabel: "",
    restSeconds: 60,
    videoPath: null,
    tracker: false,
    note: null,
    sets: [
      { reps: 10, weightKg: null, warmup: false },
      { reps: 10, weightKg: null, warmup: false },
      { reps: 10, weightKg: null, warmup: false },
    ],
  });

  it("lo empezado se queda en su lugar y lo demás cabe en los minutos nuevos", () => {
    const anterior = ["A", "B", "C", "D", "E", "F"].map(ejercicio);
    const recortado = ["A", "C", "E"].map(ejercicio);
    const salida = recortarPendiente(anterior, recortado, 2, 40, 300);
    expect(salida.slice(0, 2).map((e) => e.name)).toEqual(["A", "B"]);
    expect(salida.map((e) => e.name)).not.toContain("F");
    expect(salida.length).toBeLessThanOrEqual(4);
  });

  it("sin nada empezado, es el plan recortado tal cual", () => {
    const recortado = ["A", "C"].map(ejercicio);
    expect(recortarPendiente(["A", "B", "C"].map(ejercicio), recortado, 0, 40, 300)).toBe(recortado);
  });
});
