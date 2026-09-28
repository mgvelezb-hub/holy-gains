import "server-only";

import { prisma } from "@/lib/prisma";
import { calentamientoPara } from "@/lib/training/calentamiento";
import { loadCatalog, parseStoredPlan, planGuardable, toTrainingProfile } from "@/lib/training/db";
import { firmaDelPlan } from "@/lib/training/semana";
import type { DayKind } from "@/lib/training/types";
import { isAllowedSubstitute, planSubstitution } from "@/lib/training/substitutes";

/**
 * Cambiar un ejercicio de una sesión ya materializada.
 *
 * Llega por la misma cola que las series (`POST /api/training/sync`), no por
 * una ruta aparte: en el gimnasio no hay señal, y un cambio que solo funciona
 * con red no sirve justo cuando se necesita. El teléfono aplica el cambio en su
 * copia local y encola la instrucción; aquí se materializa cuando vuelve la red.
 *
 * Dos propiedades sostienen eso:
 *
 * 1. **Es idempotente.** Si el plan ya tiene ese ejercicio en ese lugar, no se
 *    hace nada — la cola puede reenviar la misma instrucción veinte veces.
 * 2. **Se validan las dos cosas**: que la sesión sea de quien la manda y que el
 *    ejercicio elegido sea uno de los que la pantalla podía ofrecer. El
 *    teléfono manda un id; el servidor no le cree.
 *
 * Las series ya capturadas **del ejercicio que se va** se borran: su `client_id`
 * empieza con `{workout}:{índice}:` y esas cargas eran de otra máquina. Las del
 * resto de la sesión no se tocan.
 */

export type SubstitutionInput = { exerciseIndex: number; exerciseId: string };

export type SubstitutionResult = {
  exerciseIndex: number;
  ok: boolean;
  /** Nombre del ejercicio que quedó en ese lugar. */
  name: string | null;
  /** Por qué no se pudo, cuando no se pudo. */
  reason?: "sesión no encontrada" | "índice inválido" | "ejercicio inexistente" | "no equivalente";
};

export async function applySubstitutions(
  userId: string,
  workoutId: string,
  substitutions: SubstitutionInput[],
): Promise<SubstitutionResult[]> {
  if (substitutions.length === 0) return [];

  // El filtro por `userId` es la defensa real: Prisma ignora RLS.
  const workout = await prisma.workout.findFirst({
    where: { id: workoutId, userId },
    select: { id: true, exercisesJson: true },
  });

  if (!workout) {
    return substitutions.map((substitution) => ({
      exerciseIndex: substitution.exerciseIndex,
      ok: false,
      name: null,
      reason: "sesión no encontrada" as const,
    }));
  }

  const catalog = await loadCatalog();
  const plan = parseStoredPlan(workout.exercisesJson);
  const results: SubstitutionResult[] = [];
  const replaced = new Set<number>();
  /** Los lugares que se reacomodaron solos para no repetir un ejercicio. */
  const reacomodados = new Set<number>();
  /** Los cambios que valen para el futuro, no solo para la sesión de hoy. */
  const recordados: Record<string, string> = {};

  for (const substitution of substitutions) {
    const current = plan.exercises[substitution.exerciseIndex];
    if (!current) {
      results.push({
        exerciseIndex: substitution.exerciseIndex,
        ok: false,
        name: null,
        reason: "índice inválido",
      });
      continue;
    }

    // Ya está puesto: la cola reenvió lo mismo. Nada que hacer, y sobre todo
    // nada que borrar — las series de hoy son del ejercicio nuevo.
    if (current.exerciseId === substitution.exerciseId) {
      results.push({ exerciseIndex: substitution.exerciseIndex, ok: true, name: current.name });
      continue;
    }

    const candidate = catalog.find((option) => option.id === substitution.exerciseId);
    if (!candidate) {
      results.push({
        exerciseIndex: substitution.exerciseIndex,
        ok: false,
        name: current.name,
        reason: "ejercicio inexistente",
      });
      continue;
    }

    if (!isAllowedSubstitute(current, candidate, catalog)) {
      results.push({
        exerciseIndex: substitution.exerciseIndex,
        ok: false,
        name: current.name,
        reason: "no equivalente",
      });
      continue;
    }

    // Si lo elegido ya estaba más abajo en la sesión, ese de abajo se cambia
    // por otro del mismo grupo: una sesión con el mismo ejercicio dos veces
    // es un error del cambio, no una elección.
    const cambio = planSubstitution(plan.exercises, substitution.exerciseIndex, candidate, catalog);
    plan.exercises = cambio.exercises;
    for (const index of cambio.replaced) {
      replaced.add(index);
      if (index !== substitution.exerciseIndex) reacomodados.add(index);
    }
    // Se recuerda para las próximas semanas: sin esto el generador volvía a
    // proponer el ejercicio que ya se rechazó, y había que cambiarlo cada
    // semana. Un cambio repetido es una preferencia, no una casualidad.
    //
    // Lo que se reacomodó para no repetir NO es preferencia: nadie rechazó
    // ese ejercicio, solo estaba de más. El teléfono manda ese reacomodo como
    // un cambio explícito (para que las dos copias coincidan) y no debe
    // quedar recordado.
    if (current.exerciseId && !reacomodados.has(substitution.exerciseIndex)) {
      recordados[current.exerciseId] = candidate.id;
    }
    results.push({ exerciseIndex: substitution.exerciseIndex, ok: true, name: candidate.name });
  }

  if (replaced.size === 0) return results;

  await recuerdaCambios(userId, recordados);

  // La firma con el cambio ya recordado: esta sesión es lo que el plan nuevo
  // pide, así que no se rearma (ni pierde el cambio) antes de la primera
  // serie. El objeto va completo —calentamiento incluido—: sin él la
  // siguiente reconciliación lo leía como plan viejo y lo rearmaba (I1).
  const perfil = await prisma.profile.findUnique({ where: { userId } });
  const firma = perfil ? firmaDelPlan(toTrainingProfile(perfil)) : (plan.firma ?? "");

  await prisma.workout.update({
    where: { id: workout.id },
    data: {
      exercisesJson: planGuardable(
        {
          ...plan,
          warmup: plan.warmup ?? calentamientoPara(plan.dayKind as DayKind),
        },
        firma,
      ),
    },
  });

  await prisma.workoutSet.deleteMany({
    where: {
      workoutId: workout.id,
      OR: [...replaced].map((index) => ({ clientId: { startsWith: `${workout.id}:${index}:` } })),
    },
  });

  return results;
}

/**
 * Guarda en el perfil los cambios de ejercicio para las próximas semanas.
 *
 * Un cambio ya aplicado sobre otro se colapsa: si A se cambió por B y luego B
 * por C, lo que se recuerda es que A y B llevan a C. Encadenar preferencias
 * viejas dejaría al generador proponiendo un ejercicio intermedio que la
 * persona ya descartó.
 *
 * Falla en silencio: la sesión de hoy YA quedó cambiada, y no recordar la
 * preferencia solo cuesta volver a cambiarla la semana que viene.
 */
async function recuerdaCambios(userId: string, nuevos: Record<string, string>): Promise<void> {
  if (Object.keys(nuevos).length === 0) return;

  try {
    const profile = await prisma.profile.findUnique({
      where: { userId },
      select: { exerciseSwaps: true },
    });

    const previos =
      typeof profile?.exerciseSwaps === "object" &&
      profile.exerciseSwaps !== null &&
      !Array.isArray(profile.exerciseSwaps)
        ? (profile.exerciseSwaps as Record<string, string>)
        : {};

    const mezcla: Record<string, string> = { ...previos, ...nuevos };

    // Colapsa las cadenas: lo que apuntaba a B, si B ahora apunta a C, apunta
    // a C.
    for (const [original, reemplazo] of Object.entries(mezcla)) {
      const destino = nuevos[reemplazo];
      if (destino !== undefined && destino !== original) mezcla[original] = destino;
    }

    await prisma.profile.update({
      where: { userId },
      data: { exerciseSwaps: mezcla },
    });
  } catch (error) {
    console.error("[training] no se pudo recordar el cambio de ejercicio", error);
  }
}
