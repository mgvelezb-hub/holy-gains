import "server-only";

import type { Profile } from "@prisma/client";
import type { Food } from "engine";

import { alimentosPropiosDe } from "@/lib/coachy/alimentos-propios-db";
import { toEngineProfile } from "@/lib/coachy/mapping";
import {
  conSenalesClinicas,
  senalesDeLabs,
  type SenalesClinicas,
} from "@/lib/coachy/plan-nutricion-reglas";
import type { EngineProfile } from "@/lib/engine-types";
import { fromISODate, isoFromDateColumn, shiftISODate, toISODate } from "@/lib/format";
import { prisma } from "@/lib/prisma";

/**
 * El perfil del motor, armado en UN lugar (K1).
 *
 * Antes cada camino llamaba `toEngineProfile` por su cuenta y le agregaba lo
 * que se acordaba: el check-in no leía los estudios, rearmar por despensa sí
 * traía los alimentos propios, el relleno de equivalencias no. Aquí entra
 * todo lo que decide QUÉ se come —preferencias, despensa, leche,
 * preparaciones y suplementos (ya en `toEngineProfile`), los alimentos
 * propios y lo que dicen los estudios— y todos los que arman menú o macros
 * lo piden aquí: `analyze` (la decisión), `syncMealPlans`,
 * `materializeMealPlans`, el relleno de equivalencias y `planDeNutricion`.
 */

const SIN_SENALES: SenalesClinicas = { glucosaAyuno: null, vitaminaD: null };

/** Glucosa y vitamina D de las químicas del último año. Si falla, sin señales. */
export async function senalesClinicasDe(userId: string, hoy: string = toISODate(new Date())): Promise<SenalesClinicas> {
  try {
    const labs = await prisma.labResult.findMany({
      where: { userId, kind: "QUIMICA", takenOn: { gte: fromISODate(shiftISODate(hoy, -365)), lte: fromISODate(hoy) } },
      select: { takenOn: true, valuesJson: true },
    });
    return senalesDeLabs(
      labs.map((lab) => ({ takenOn: isoFromDateColumn(lab.takenOn), valuesJson: lab.valuesJson })),
      hoy,
    );
  } catch (error) {
    console.error("[coachy] no se pudieron leer los estudios para el plan", error);
    return SIN_SENALES;
  }
}

export interface PerfilDelMotor {
  engineProfile: EngineProfile;
  extraFoods: Food[];
  senales: SenalesClinicas;
}

/**
 * `toEngineProfile` + estudios + alimentos propios. Lanza lo mismo que
 * `toEngineProfile` (`MissingProfileDataError`) si al perfil le falta estatura
 * o peso: sin eso no hay plan que armar.
 */
export async function perfilDelMotor(
  userId: string,
  profile: Profile,
  opciones: { latestWeightKg?: number | null; hoy?: string } = {},
): Promise<PerfilDelMotor> {
  const base = toEngineProfile(profile, opciones.latestWeightKg ?? null);
  const [senales, extraFoods] = await Promise.all([
    senalesClinicasDe(userId, opciones.hoy),
    alimentosPropiosDe(userId),
  ]);
  return { engineProfile: conSenalesClinicas(base, senales), extraFoods, senales };
}
