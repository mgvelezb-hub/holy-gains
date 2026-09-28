import { describe, expect, it } from "vitest";

import { alternativesFor, planSubstitution } from "@/lib/training/substitutes";
import type { ExerciseOption, PlannedExercise } from "@/lib/training/types";

/**
 * El cambio de ejercicio que se repetía (I2): cambiaron una máquina ocupada
 * por su alternativa y dos ejercicios después tocaba justo esa alternativa.
 */

function option(partial: Partial<ExerciseOption> & { name: string }): ExerciseOption {
  return {
    id: partial.id ?? `id-${partial.name}`,
    name: partial.name,
    muscleGroup: partial.muscleGroup ?? "PIERNA",
    poolRole: partial.poolRole ?? "cuadriceps_compuesto",
    videoUrl: partial.videoUrl === undefined ? `library/${partial.name}.mp4` : partial.videoUrl,
    isTracker: false,
    substitutes: partial.substitutes ?? [],
    level: "PRINCIPIANTE",
    equipment: "MAQUINA",
  };
}

const CATALOG: ExerciseOption[] = [
  option({ name: "Prensa de pierna", substitutes: ["Hack squat"] }),
  option({ name: "Hack squat", substitutes: ["Prensa de pierna"] }),
  option({ name: "Sentadilla en Smith" }),
  option({ name: "Sentadilla búlgara", poolRole: "unilateral" }),
  option({ name: "Extensión de pierna", poolRole: "cuadriceps_aislado" }),
];

function planned(name: string, extra: Partial<PlannedExercise> = {}): PlannedExercise {
  const entry = CATALOG.find((row) => row.name === name);
  return {
    exerciseId: entry?.id ?? null,
    name,
    muscleGroup: entry?.muscleGroup ?? "PIERNA",
    poolRole: entry?.poolRole ?? "cuadriceps_compuesto",
    scheme: "PIRAMIDAL",
    schemeLabel: "",
    restSeconds: 60,
    videoPath: null,
    tracker: false,
    note: null,
    sets: [{ reps: 10, weightKg: 80, warmup: false }],
    ...extra,
  };
}

describe("cambiar un ejercicio sin repetir", () => {
  it("las alternativas excluyen lo que ya está en la sesión aunque el nombre no calce", () => {
    // El plan guardó el hack con otro nombre ("Hack squat (máquina)") pero con
    // el id del catálogo: comparar solo nombres lo dejaba pasar.
    const session = [
      planned("Prensa de pierna"),
      planned("Extensión de pierna"),
      planned("Hack squat (máquina)", { exerciseId: "id-Hack squat" }),
    ];
    const names = alternativesFor(session[0]!, CATALOG, session).map((opcion) => opcion.name);
    expect(names).not.toContain("Hack squat");
    expect(names).toContain("Sentadilla en Smith");
  });

  it("si la alternativa ya estaba más abajo, ese se reemplaza por otro del mismo rol", () => {
    const session = [planned("Prensa de pierna"), planned("Extensión de pierna"), planned("Hack squat")];
    const hack = CATALOG.find((row) => row.name === "Hack squat")!;

    const { exercises, replaced } = planSubstitution(session, 0, hack, CATALOG);

    expect(exercises[0]!.name).toBe("Hack squat");
    // Ni hack (ya arriba) ni prensa (la máquina ocupada): el mismo rol que
    // queda es Smith, antes que la búlgara (otro rol).
    expect(exercises[2]!.name).toBe("Sentadilla en Smith");
    expect(exercises[2]!.poolRole).toBe("cuadriceps_compuesto");
    expect(replaced).toEqual([0, 2]);
    const names = exercises.map((exercise) => exercise.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("no toca lo de arriba ni lo que no se repite", () => {
    const session = [planned("Hack squat"), planned("Prensa de pierna"), planned("Extensión de pierna")];
    const smith = CATALOG.find((row) => row.name === "Sentadilla en Smith")!;

    const { exercises, replaced } = planSubstitution(session, 1, smith, CATALOG);
    expect(exercises.map((exercise) => exercise.name)).toEqual([
      "Hack squat",
      "Sentadilla en Smith",
      "Extensión de pierna",
    ]);
    expect(replaced).toEqual([1]);
  });

  it("sin con qué reemplazar, el de abajo se queda", () => {
    const tiny = [option({ name: "Prensa de pierna" }), option({ name: "Hack squat" })];
    const session = [planned("Prensa de pierna"), planned("Hack squat")];
    const { exercises, replaced } = planSubstitution(session, 0, tiny[1]!, tiny);
    expect(exercises.map((exercise) => exercise.name)).toEqual(["Hack squat", "Hack squat"]);
    expect(replaced).toEqual([0]);
  });
});
