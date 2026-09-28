import type { CheckIn, Profile } from "@prisma/client";
import { DEFAULT_CONFIG, SUPPLEMENTS, loadConfig } from "engine";

import { decimalToNumber } from "@/lib/format";
import {
  preferenciaDePreparaciones,
  sinMarcasDePreparacion,
} from "@/lib/coachy/preparaciones";
import { palAdjustment, type ActivityWindow, type PalAdjustment } from "@/lib/health/activity";
import type { DietStyle } from "@prisma/client";
import type {
  EngineCheckIn,
  EngineConfig,
  EngineCyclePhase,
  EngineDietStyle,
  EngineSupplement,
  EngineProfile,
  EngineStrengthTrend,
} from "@/lib/engine-types";
import type { PhotoChange } from "@/lib/coachy/types";

/**
 * Traducción entre las filas de Prisma y los tipos del motor.
 *
 * El motor no sabe nada de la base: usa unidades planas, enums en minúscula y
 * fechas ISO. Aquí es donde se hace ese salto, y donde quedan documentadas las
 * señales que el formulario todavía no captura.
 */

export class MissingProfileDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingProfileDataError";
  }
}

const TRENDS: Record<string, EngineStrengthTrend> = {
  SUBE: "sube",
  IGUAL: "igual",
  BAJA: "baja",
};

const CYCLE: Record<string, EngineCyclePhase> = {
  FOLICULAR: "folicular",
  OVULACION: "ovulacion",
  LUTEA: "lutea",
  MENSTRUACION: "menstruacion",
  NA: "na",
};

function clamp5(value: number): 1 | 2 | 3 | 4 | 5 {
  const rounded = Math.min(5, Math.max(1, Math.round(value)));
  return rounded as 1 | 2 | 3 | 4 | 5;
}

function yearsSince(date: Date | null): number | null {
  if (!date) return null;
  const ms = Date.now() - date.getTime();
  return Math.floor(ms / (365.25 * 24 * 60 * 60 * 1000));
}

/** Edad por defecto cuando no hay ni fecha de nacimiento ni rango. */
const DEFAULT_AGE_YEARS = 30;

/**
 * Punto medio de cada rango de edad.
 *
 * Es una aproximación, sí — pero es la que la persona declaró, y eso la hace
 * mejor que suponer 30 años para todo el mundo. El gasto basal de Mifflin-St
 * Jeor se mueve poco dentro de un rango de diez años; entre 25 y 55 sí se
 * mueve.
 */
const EDAD_POR_RANGO: Record<string, number> = {
  "18_24": 21,
  "25_34": 29,
  "35_44": 39,
  "45_54": 49,
  "55_64": 59,
  "65_MAS": 68,
};

/**
 * La despensa guardada, ya limpia: `Profile.pantry` es un `Json?` y puede
 * traer cualquier cosa —un objeto viejo, `null`, ids repetidos—. El motor
 * espera ids del catálogo, así que aquí se descarta lo que no lo sea en vez
 * de dejar que reviente al armar el menú.
 */
export function parsePantry(value: Profile["pantry"]): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return [...new Set(ids)];
}

function edadDeclarada(profile: Profile): number {
  const exacta = yearsSince(profile.birthDate);
  if (exacta !== null) return exacta;
  if (profile.ageRange && EDAD_POR_RANGO[profile.ageRange] !== undefined) {
    return EDAD_POR_RANGO[profile.ageRange]!;
  }
  return DEFAULT_AGE_YEARS;
}

/** El enum del schema, en el vocabulario del motor. */
const DIET_STYLE_TO_ENGINE: Record<DietStyle, EngineDietStyle> = {
  ESTANDAR: "estandar",
  AYUNO: "ayuno",
  VEGETARIANA: "vegetariana",
  KETO: "keto",
  // Un solo menú para los siete días: el motor lo genera una vez y lo repite,
  // y la lista de súper compra ese menú la semana completa.
  MENU_FIJO: "menu_fijo",
};

export function toEngineProfile(profile: Profile, latestWeightKg?: number | null): EngineProfile {
  const heightCm = decimalToNumber(profile.heightCm);
  const weightKg = latestWeightKg ?? decimalToNumber(profile.weightKg);

  if (!heightCm) {
    throw new MissingProfileDataError("El perfil no tiene estatura; el motor no puede calcular.");
  }
  if (!weightKg) {
    throw new MissingProfileDataError(
      "No hay peso ni en el perfil ni en los check-ins; el motor no puede calcular.",
    );
  }

  const conditions = profile.conditions.map((condition) => condition.toLowerCase());

  return {
    // El motor solo modela `female` y `male` porque Mifflin-St Jeor solo tiene
    // esas dos constantes. `OTHER` toma la estimación más conservadora.
    sex: profile.sex === "MALE" ? "male" : "female",
    ageYears: edadDeclarada(profile),
    heightCm,
    weightKg,
    ...(decimalToNumber(profile.leanMassKg) !== null
      ? { leanMassKg: decimalToNumber(profile.leanMassKg) as number }
      : {}),
    strengthDaysPerWeek: profile.liftingDays,
    cardioMinPerWeek: profile.cardioMinWk,
    work: profile.work === "ACTIVO" ? "activo" : "sedentario",
    mealsPerDay: profile.mealsPerDay,
    // El motor distingue entreno de mañana y de tarde; mediodía cuenta como mañana.
    trainingTime:
      profile.trainingTime === "TARDE" || profile.trainingTime === "NOCHE" ? "tarde" : "manana",
    // Tres escalones de costo sobre `costRel` del catálogo: bajo se queda con
    // lo más barato, medio abre el intermedio y alto no filtra por precio.
    budget:
      profile.budget === "BAJO" ? "bajo" : profile.budget === "ALTO" ? "alto" : "medio",
    favoriteFoods: profile.favoriteFoods,
    // Lo que YA está comprado. Pesa más que los favoritos: dentro de su rol
    // se elige primero, para que la despensa de la semana pasada no quede sin
    // uso cuando el motor rota alimentos.
    pantry: parsePantry(profile.pantry),
    // Las marcas de preparación ("licuados") no son alimentos: salen de aquí
    // y entran como `preparaciones` abajo.
    excludedFoods: [...sinMarcasDePreparacion(profile.excludedFoods), ...profile.allergies],
    // Qué platillos compuestos acepta el menú. No hay columna: vive en los
    // excluidos, donde "no me des licuados" ya significa eso.
    preparaciones: preferenciaDePreparaciones(profile.excludedFoods),
    allergies: profile.allergies,
    // Tope de tiempo de cocina. El motor lo trata como preferencia: si deja un
    // rol sin candidatos, prefiere darte de comer a respetar el tope.
    ...(profile.maxPrepMin !== null ? { maxPrepMin: profile.maxPrepMin } : {}),
    // Estilo de dieta (Fase 8). El motor solo conoce minúsculas.
    diet: DIET_STYLE_TO_ENGINE[profile.dietStyle],
    // Lo que la persona TIENE. El motor no reparte polvos a quien no los
    // declaró, y las pautas solo cubren lo marcado.
    supplements: profile.supplements.filter((valor): valor is EngineSupplement =>
      (SUPPLEMENTS as readonly string[]).includes(valor),
    ),
    ...(profile.fastingStartHour !== null && profile.fastingEndHour !== null
      ? {
          fastingWindow: {
            startHour: profile.fastingStartHour,
            endHour: profile.fastingEndHour,
          },
        }
      : {}),
    conditions: {
      glucosaAlta: conditions.includes("glucosa_alta"),
      lesionActiva: conditions.includes("lesion_activa"),
      cicloMenstrualTracking: conditions.includes("ciclo_tracking"),
    },
  };
}

/**
 * Config del motor con el PAL corregido por los pasos del reloj (Fase 8).
 *
 * El perfil declara días de pesas, minutos de cardio y si el trabajo es
 * activo; con eso el motor arma el PAL. Lo que nadie declara —ni sabría— es el
 * resto del día: si camina al trabajo o no se para de la silla. Eso es lo que
 * traen los pasos, y por eso mueven **solo el término base** del PAL.
 *
 * La banda y la tabla de la fórmula viven en `lib/health/activity.ts`. Sin al
 * menos dos semanas de pasos esto devuelve `null` y el motor corre con sus
 * defaults, exactamente igual que antes de que existiera el reloj.
 */
export type EngineActivityConfig = { config: EngineConfig; adjustment: PalAdjustment };

export function engineConfigForActivity(
  window: ActivityWindow | null,
): EngineActivityConfig | null {
  const adjustment = palAdjustment(window, DEFAULT_CONFIG.pal.base);
  if (!adjustment) return null;

  // `loadConfig` valida: si el base ajustado saliera del rango del esquema
  // (1.0-1.5) esto lanzaría, y es mejor que publicar un TDEE inventado.
  return { config: loadConfig({ pal: { base: adjustment.base } }), adjustment };
}

/**
 * Un check-in de la base como lo ve el motor.
 *
 * Pendiente conocido: el formulario de la Fase 1 no captura `newInjury`,
 * `contextChange`, `aggressiveRequest`, `goalReached` ni `restart`. Mientras no
 * existan esos campos, la lesión activa se lee de las condiciones del perfil y
 * los días sin entrenar se derivan del cumplimiento de entreno.
 */
export function toEngineCheckIn(
  checkIn: CheckIn,
  options: { photosTrend?: PhotoChange | null; activeInjury?: boolean } = {},
): EngineCheckIn {
  const engineCheckIn: EngineCheckIn = {
    date: checkIn.date.toISOString().slice(0, 10),
    inflammation: clamp5(checkIn.inflammation),
    energy: clamp5(checkIn.energy),
    hunger: clamp5(checkIn.hunger),
    satiety: clamp5(checkIn.satiety),
    sleep: clamp5(checkIn.sleep),
    strengthTrend: TRENDS[checkIn.strengthTrend ?? "IGUAL"] ?? "igual",
    dietCompliancePct: checkIn.dietCompliance,
    trainingCompliancePct: checkIn.trainingCompliance,
    symptoms: checkIn.symptoms,
  };

  const numbers = {
    weightKg: decimalToNumber(checkIn.weightKg),
    waistCm: decimalToNumber(checkIn.waistCm),
    legLeftCm: decimalToNumber(checkIn.legLeftCm),
    legRightCm: decimalToNumber(checkIn.legRightCm),
    armLeftCm: decimalToNumber(checkIn.armLeftCm),
    armRightCm: decimalToNumber(checkIn.armRightCm),
  } as const;

  for (const [key, value] of Object.entries(numbers)) {
    if (value !== null) Object.assign(engineCheckIn, { [key]: value });
  }

  if (checkIn.strengthRpe !== null) engineCheckIn.strengthRpe = checkIn.strengthRpe;
  if (checkIn.cyclePhase) engineCheckIn.cyclePhase = CYCLE[checkIn.cyclePhase] ?? "na";
  if (options.photosTrend) engineCheckIn.photosTrend = options.photosTrend;
  if (options.activeInjury) engineCheckIn.activeInjury = true;

  // Cumplimiento de entreno en 0 = una semana entera sin entrenar. Es la única
  // señal de "días sin entrenar" que el formulario permite deducir hoy.
  if (checkIn.trainingCompliance === 0) engineCheckIn.daysWithoutTraining = 7;

  return engineCheckIn;
}
