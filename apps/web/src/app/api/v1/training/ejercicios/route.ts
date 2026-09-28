import { NextResponse } from "next/server";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { emphasisFor } from "@/lib/training/emphasis";
import { loadCatalog, parseManualExercises, toTrainingProfile } from "@/lib/training/db";
import { mondayOf, sugerenciaDeEjercicios } from "@/lib/training/generate";
import { porqueDeLaSugerencia } from "@/lib/training/manual";
import { esqueletoDeSemana } from "@/lib/training/esqueleto";
import { DAY_LABELS } from "@/lib/training/split";
import type { DayKind } from "@/lib/training/types";

/**
 * `GET /api/v1/training/ejercicios` — la sugerencia de Coachy por tipo de día
 * del split vigente, con lo que la persona ya eligió a mano.
 *
 * Es lo que hace posible el renglón "Ejercicios: sugerencia de Coachy /
 * elegidos por mí" de Ajustes. Solo devuelve los tipos de día que ESTA semana
 * se entrenan: ofrecerle editar el día de glúteo a quien no lo tiene en su
 * split es pedirle que decida sobre algo que no existe.
 *
 * El catálogo completo para agregar ejercicios vive en `/api/v1/exercises`:
 * aquí no se repite, porque son dos cosas distintas —lo que Coachy propone y
 * todo lo que hay— y la app ya cachea la segunda.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  if (!user.profile) {
    return NextResponse.json({ error: "onboarding incompleto" }, { status: 403 });
  }

  const perfil = user.profile;
  const training = toTrainingProfile(perfil);
  const hoy = new Date();
  hoy.setHours(12, 0, 0, 0);

  // Los tipos de día de ESTA semana salen del mismo esqueleto que la semana
  // materializada (I1), no de otra copia de "horario → presupuesto → split".
  const split = esqueletoDeSemana(training, mondayOf(hoy));

  const [catalogo, zonasLejos] = await Promise.all([
    loadCatalog().catch(() => []),
    // Sin análisis del objetivo todavía, el porqué se queda con el objetivo y
    // la condición: es menos, no es falso.
    emphasisFor(user.id).catch(() => []),
  ]);

  const manuales = parseManualExercises(perfil.manualExercises);
  // Un tipo de día puede repetirse en la semana (dos veces pecho en PPL ×2);
  // la lista manual es por tipo de día, así que se enseña una sola vez.
  const kinds = [...new Set(split.kinds)] as DayKind[];

  return NextResponse.json({
    dias: kinds.map((kind) => {
      const sugeridos = sugerenciaDeEjercicios(training, kind, catalogo);
      const elegidos = manuales[kind] ?? [];

      return {
        dayKind: kind,
        label: DAY_LABELS[kind],
        porque: porqueDeLaSugerencia(kind, {
          goal: training.goal,
          conditions: training.conditions,
          volumeBias: training.volumeBias,
          zonasLejos,
        }),
        // `true` = este día sigue a Coachy. La app pinta "sugerencia de
        // Coachy" o "elegidos por mí" con esto, sin recontar la lista.
        sigueACoachy: elegidos.length === 0,
        elegidos,
        sugeridos: sugeridos.map((exercise) => ({
          id: exercise.id,
          name: exercise.name,
          muscleGroup: exercise.muscleGroup,
          poolRole: exercise.poolRole,
        })),
      };
    }),
  });
}
