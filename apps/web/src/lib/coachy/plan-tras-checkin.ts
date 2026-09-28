import "server-only";

import type { CheckIn, Profile } from "@prisma/client";

import { goalStatusFor, type GoalStatus } from "@/lib/coachy/goal";
import type { FotosMensuales, MedidaCheckIn } from "@/lib/coachy/mensual";
import { decimalToNumber, fromISODate, isoFromDateColumn, shiftISODate, toISODate } from "@/lib/format";
import { ensureWeekMaterialized } from "@/lib/training/db";
import { emphasisFor } from "@/lib/training/emphasis";
import { mondayOf } from "@/lib/training/generate";
import type { MuscleGroup } from "@/lib/training/types";

/**
 * Lo que se rehace después de un check-in, fuera del motor.
 *
 * El motor ya decidió los números; aquí se materializa "el plan de aquí en
 * adelante" que no depende de él: la lectura de fotos contra la referencia y
 * la rutina de lo que queda de esta semana y la siguiente.
 */

/** Un check-in de Prisma, en la forma plana que usa `mensual.ts`. */
export function aMedida(
  row: Pick<
    CheckIn,
    "id" | "date" | "waistCm" | "weightKg" | "armLeftCm" | "armRightCm" | "legLeftCm" | "legRightCm"
  >,
): MedidaCheckIn {
  return {
    id: row.id,
    fecha: isoFromDateColumn(row.date),
    cinturaCm: decimalToNumber(row.waistCm),
    pesoKg: decimalToNumber(row.weightKg),
    brazoIzqCm: decimalToNumber(row.armLeftCm),
    brazoDerCm: decimalToNumber(row.armRightCm),
    piernaIzqCm: decimalToNumber(row.legLeftCm),
    piernaDerCm: decimalToNumber(row.legRightCm),
  };
}

/** El estado de "Rumbo a tu objetivo" como lo guarda el bloque mensual. */
export function fotosDe(status: GoalStatus | null): FotosMensuales | null {
  if (status === null) return null;
  if (status.state === "listo") return { estado: "listo", zonas: status.readings };
  return { estado: status.state, zonas: [] };
}

/**
 * La lectura contra la referencia al cerrar el check-in.
 *
 * En el mensual se fuerza (sin esperar la quincena); en el semanal respeta su
 * cadencia de 14 días. Nunca lanza: sin referencia, sin visión o sin llave,
 * regresa el estado que lo dice, y un error de red regresa `null`.
 */
export async function lecturaDelObjetivo(
  userId: string,
  profile: Profile,
  esMensual: boolean,
): Promise<GoalStatus | null> {
  return goalStatusFor(userId, profile, new Date().toISOString(), { force: esMensual }).catch(
    (error: unknown) => {
      console.error("[coachy] no se pudo leer el objetivo tras el check-in", error);
      return null;
    },
  );
}

export interface RutinaRearmada {
  /** Sesiones de pesas que quedaron planeadas de hoy al domingo siguiente. */
  sesiones: number;
  /** Grupos con volumen extra por el objetivo (vacío si no hay lectura). */
  prioridad: MuscleGroup[];
}

/**
 * Rearma lo no entrenado de esta semana y arma la siguiente.
 *
 * Reusa `ensureWeekMaterialized` con `force`: lo mismo que hacen replan y
 * recalibrar, pero sin cambiar el perfil — lo que cambia es el historial
 * (la semana que se acaba de cerrar) y el énfasis del objetivo, que el
 * generador lee del caché que `lecturaDelObjetivo` acaba de refrescar.
 * Un día con series o completado no se toca.
 */
export async function rearmaRutina(userId: string, profile: Profile): Promise<RutinaRearmada> {
  const hoyISO = toISODate(new Date());
  const hoy = fromISODate(hoyISO);
  const lunesSiguiente = fromISODate(shiftISODate(toISODate(mondayOf(hoy)), 7));

  const estaSemana = await ensureWeekMaterialized(userId, profile, hoy, { force: true });
  const siguiente = await ensureWeekMaterialized(userId, profile, lunesSiguiente, { force: true });

  const pendientes = [...estaSemana, ...siguiente].filter(
    (workout) => isoFromDateColumn(workout.date) >= hoyISO && workout.completedAt === null,
  );

  return {
    sesiones: pendientes.length,
    prioridad: await emphasisFor(userId).catch(() => []),
  };
}
