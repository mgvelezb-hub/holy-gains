import { z } from "zod";

import { PROPOSITOS } from "@/lib/training/replan";
import {
  DISCIPLINES,
  EQUIPOS_CARDIO,
  NIVELES_CARDIO,
  TIPOS_CARDIO,
  type NivelesBaseCardio,
  type PreferenciasCardio,
} from "@/lib/training/types";

/**
 * La forma de UNA carga de disciplina tal como llega por la API — la misma
 * para `PATCH /me/entrenamiento` y `POST /training/replan`.
 *
 * Vive aparte porque cada ruta tenía su propio `z.object` y el de Ajustes no
 * traía `modo`: zod descarta en silencio las llaves que no declara, así que
 * "después de pesas" se guardaba como carga sin modo (= día propio) y el
 * cardio de Mau nunca se anexaba al gimnasio (H2). Un solo schema es lo que
 * evita que una ruta se vuelva a quedar atrás cuando la carga crezca.
 */
/** Rangos de captura: el nivel de consola de las máquinas comerciales llega a 20–25; 40 deja holgura. */
const NIVEL_MAQUINA = z.number().int().min(1).max(40);
const RITMO_500 = z.object({ ritmo500: z.string().regex(/^\d{1,2}:[0-5]\d$/) });
const WATTS = z.object({ watts: z.number().int().min(20).max(2000) });

export const nivelBaseSchema = z.object({
  ELIPTICA: NIVEL_MAQUINA.optional(),
  BICI: NIVEL_MAQUINA.optional(),
  ESCALERA: NIVEL_MAQUINA.optional(),
  REMO: RITMO_500.optional(),
  SKI_ERG: RITMO_500.optional(),
  BICI_AIRE: WATTS.optional(),
});

export const preferenciasCardioSchema = z.object({
  equipo: z.enum(EQUIPOS_CARDIO).optional(),
  tipo: z.enum(TIPOS_CARDIO).optional(),
  nivel: z.enum(NIVELES_CARDIO).optional(),
  minutos: z.number().int().min(10).max(60).optional(),
  unidadVelocidad: z.enum(["kmh", "mph"]).optional(),
  nivelBase: nivelBaseSchema.optional(),
});

export const cargaDisciplinaSchema = z.object({
  discipline: z.enum(DISCIPLINES),
  /** 0 = declarada pero sin carga: se registra, no planea. */
  sessionsPerWeek: z.number().int().min(0).max(7),
  /** Para qué sirve esta disciplina — lo que se pregunta al rearmar la rutina. */
  proposito: z.enum(PROPOSITOS).optional(),
  /** 1 a 3: cuánto quiere la persona que pese, dentro de su propósito. */
  importancia: z.number().int().min(1).max(3).optional(),
  /** Después de pesas (se anexa al gym) o día propio (paga presupuesto). */
  modo: z.enum(["DESPUES", "DIA_PROPIO"]).optional(),
  /** Solo CARDIO: máquina, tipo, nivel y minutos por sesión. */
  cardio: preferenciasCardioSchema.optional(),
});

/**
 * Las preferencias de cardio guardadas en el JSON libre de la base, campo por
 * campo: un valor que ya no existe se descarta él solo, no la carga entera.
 * `undefined` si no queda nada usable.
 */
export function parsePreferenciasCardio(raw: unknown): PreferenciasCardio | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const { equipo, tipo, nivel, minutos, unidadVelocidad, nivelBase } = raw as Record<string, unknown>;

  const prefs: PreferenciasCardio = {};
  if (typeof equipo === "string" && (EQUIPOS_CARDIO as readonly string[]).includes(equipo)) {
    prefs.equipo = equipo as PreferenciasCardio["equipo"];
  }
  if (typeof tipo === "string" && (TIPOS_CARDIO as readonly string[]).includes(tipo)) {
    prefs.tipo = tipo as PreferenciasCardio["tipo"];
  }
  if (typeof nivel === "string" && (NIVELES_CARDIO as readonly string[]).includes(nivel)) {
    prefs.nivel = nivel as PreferenciasCardio["nivel"];
  }
  if (typeof minutos === "number" && Number.isFinite(minutos)) {
    prefs.minutos = Math.max(10, Math.min(60, Math.round(minutos)));
  }
  if (unidadVelocidad === "kmh" || unidadVelocidad === "mph") prefs.unidadVelocidad = unidadVelocidad;
  const bases = parseNivelBase(nivelBase);
  if (bases) prefs.nivelBase = bases;
  return Object.keys(prefs).length > 0 ? prefs : undefined;
}

/** El nivel base por máquina, máquina por máquina: la que no valida se descarta sola. */
function parseNivelBase(raw: unknown): NivelesBaseCardio | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const bases: Record<string, unknown> = {};
  for (const [maquina, forma] of Object.entries(nivelBaseSchema.shape)) {
    const valor = (raw as Record<string, unknown>)[maquina];
    if (valor === undefined) continue;
    const leido = forma.safeParse(valor);
    if (leido.success && leido.data !== undefined) bases[maquina] = leido.data;
  }
  return Object.keys(bases).length > 0 ? (bases as NivelesBaseCardio) : undefined;
}
