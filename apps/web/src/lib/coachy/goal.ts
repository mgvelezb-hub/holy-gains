import "server-only";

import type Anthropic from "@anthropic-ai/sdk";
import type { Prisma, Profile } from "@prisma/client";

import { VISION_MODEL, anthropicClient, hasAnthropicKey } from "@/lib/coachy/anthropic";
import { photoContentBlocks } from "@/lib/coachy/vision";
import { PHOTO_BUCKET, visionEnabled } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { signedPhotoUrls } from "@/lib/storage";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * "Rumbo a tu objetivo" — la comparación contra la referencia (Fase 6).
 *
 * ## La frontera, otra vez
 *
 * El análisis semanal (`vision.ts`) todavía deja escribir una `nota_breve`.
 * Aquí ni eso: **la herramienta no tiene un solo campo de texto libre**. El
 * modelo elige cuatro valores de cuatro listas cerradas por zona y nada más.
 * Todo lo que la atleta lee sale de `ACTION_TEXT` / `GAP_LABEL`, escrito por
 * nosotros. Un comentario estético no cabe en el esquema, y una cifra inventada
 * tampoco: no hay ningún campo numérico.
 *
 * ## Dónde viven las referencias
 *
 * En el mismo bucket privado `progress-photos`, bajo `{user_id}/goal/{vista}.jpg`.
 * **Sin tabla nueva**: las políticas de Storage ya atan la primera carpeta de la
 * ruta a `auth.uid()`, así que el prefijo `goal/` queda protegido por lo que ya
 * está instalado. Son tres objetos por atleta, reemplazables con `upsert`, y
 * `storage.list` ya devuelve existencia y `updated_at` — que es exactamente lo
 * que una tabla `goal_photos` guardaría. Una segunda fuente de verdad solo
 * podría desincronizarse del bucket.
 *
 * ## Cadencia
 *
 * Cada 2 semanas. Se pide bajo demanda al pintar `/app/historial`, con caché en
 * `conversations` como el resumen de avance: si la huella (referencias + fotos
 * de la última semana) no cambió, se reusa; y aunque cambie, no se vuelve a
 * pagar antes de 14 días.
 */

// ---------------------------------------------------------------------------
// Las referencias en el bucket
// ---------------------------------------------------------------------------

export const GOAL_VIEWS = ["FRENTE", "PERFIL", "ESPALDA"] as const;
export type GoalView = (typeof GOAL_VIEWS)[number];

export const GOAL_VIEW_LABEL: Record<GoalView, string> = {
  FRENTE: "Frente",
  PERFIL: "Perfil",
  ESPALDA: "Espalda",
};

/** Carpeta de las referencias dentro de la carpeta del usuario. */
export const GOAL_PREFIX = "goal";

/** Ruta canónica de una foto de referencia: `{user_id}/goal/{vista}.jpg`. */
export function goalPhotoPath(userId: string, view: GoalView): string {
  return `${userId}/${GOAL_PREFIX}/${view.toLowerCase()}.jpg`;
}

/** `frente.jpg` → `FRENTE`. Devuelve `null` para cualquier otro nombre. */
export function goalViewFromObjectName(name: string): GoalView | null {
  const base = name.split("/").pop()?.replace(/\.[^.]+$/, "").toUpperCase();
  return GOAL_VIEWS.find((view) => view === base) ?? null;
}

export interface GoalReference {
  view: GoalView;
  storagePath: string;
  /** Marca del objeto en el bucket: alimenta la huella del caché. */
  updatedAt: string;
}

/**
 * Las referencias que hoy existen en el bucket, en orden de vista.
 *
 * Si el listado falla, la página se dibuja vacía en lugar de romperse.
 */
export async function listGoalReferences(userId: string): Promise<GoalReference[]> {
  try {
    // Admin y no la sesión: a esta función también se llega desde /api/v1
    // (Bearer, sin cookies), donde el cliente de sesión lista como anónimo y
    // devuelve vacío. El prefijo SIEMPRE es el userId que ya autenticó el
    // caller, así que no se expone la carpeta de nadie más.
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.storage
      .from(PHOTO_BUCKET)
      .list(`${userId}/${GOAL_PREFIX}`, { limit: 20 });

    if (error || !data) return [];

    const found = new Map<GoalView, GoalReference>();
    for (const object of data) {
      const view = goalViewFromObjectName(object.name);
      if (!view) continue;
      found.set(view, {
        view,
        storagePath: `${userId}/${GOAL_PREFIX}/${object.name}`,
        updatedAt: object.updated_at ?? object.created_at ?? "",
      });
    }

    return GOAL_VIEWS.map((view) => found.get(view)).filter(
      (reference): reference is GoalReference => reference !== undefined,
    );
  } catch (error) {
    console.error("[coachy] no se pudieron listar las referencias del objetivo", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// El vocabulario cerrado
// ---------------------------------------------------------------------------

export const GOAL_ZONES = ["cintura", "cadera_gluteo", "pierna", "brazo", "espalda"] as const;
export type GoalZone = (typeof GOAL_ZONES)[number];

export const GOAL_GAPS = ["cerca", "media", "lejos"] as const;
export type GoalGap = (typeof GOAL_GAPS)[number];

export const GOAL_TRENDS = ["acercándose", "igual", "alejándose"] as const;
export type GoalTrend = (typeof GOAL_TRENDS)[number];

/**
 * Las únicas acciones que el modelo puede sugerir. No hay texto libre sobre el
 * cuerpo de nadie: elige una de estas y nosotros la traducimos.
 */
export const GOAL_ACTIONS = [
  "mas_volumen_gluteo",
  "mas_volumen_pierna",
  "mas_volumen_espalda",
  "mas_volumen_brazo",
  "priorizar_espalda",
  "mantener_deficit",
  "mas_proteina",
  "sostener_cintura",
  "seguir_igual",
] as const;
export type GoalAction = (typeof GOAL_ACTIONS)[number];

export const ZONE_LABEL: Record<GoalZone, string> = {
  cintura: "Cintura",
  cadera_gluteo: "Cadera y glúteo",
  pierna: "Pierna",
  brazo: "Brazo",
  espalda: "Espalda",
};

/** La brecha se dice como distancia al objetivo, nunca como juicio. */
export const GAP_LABEL: Record<GoalGap, string> = {
  cerca: "ya está cerca de la referencia",
  media: "va a medio camino de la referencia",
  lejos: "todavía está lejos de la referencia",
};

export const TREND_LABEL: Record<GoalTrend, string> = {
  "acercándose": "y se está acercando",
  igual: "y esta quincena se mantuvo igual",
  "alejándose": "y esta quincena se movió en sentido contrario",
};

/**
 * Lo que se le dice a la atleta. Todo sale de aquí: el modelo solo escoge la
 * llave. Sin cifras, sin diagnóstico, sin adjetivos sobre el cuerpo.
 */
export const ACTION_TEXT: Record<GoalAction, string> = {
  mas_volumen_gluteo: "Suma una serie de glúteo en cada día de pierna.",
  mas_volumen_pierna: "Súmale volumen a pierna en tu día pesado de la semana.",
  mas_volumen_espalda: "Súmale una serie de jalón o remo a tus días de espalda.",
  mas_volumen_brazo: "Cierra tus días de torso con una serie extra de brazo.",
  priorizar_espalda: "Abre la semana con espalda: es lo que más mueve la silueta desde atrás.",
  mantener_deficit:
    "Sostén el plan que ya traes sin apretarlo más: esta zona responde al tiempo, no al apuro.",
  mas_proteina: "Completa la proteína de tu menú todos los días, también los de descanso.",
  sostener_cintura:
    "Cuida sueño, agua y sal la semana de la foto: la cintura se mide mejor descansada.",
  seguir_igual: "Sigue igual: lo que estás haciendo en esta zona está funcionando.",
};

/** El marco de expectativas, en una línea, para la tarjeta del historial. */
export const GOAL_FRAMING_SHORT =
  "La referencia es dirección, no promesa: aquí se comparan proporciones y hábitos, no identidades.";

/** El marco completo. Es texto de producto, obligatorio en `/app/objetivo`. */
export const GOAL_FRAMING = [
  "La referencia es dirección, no promesa. Sirve para saber hacia dónde empujar, no para prometerte un resultado.",
  "Se comparan proporciones y hábitos, no identidades. Nunca vas a leer aquí qué tan parecida eres a alguien.",
  "Tu estructura ósea y tu distribución de grasa son tuyas y no se negocian. Dos cuerpos con el mismo entrenamiento y la misma comida llegan a siluetas distintas, y las dos están bien.",
] as const;

export const GOAL_EMPHASIS = ["alto", "medio", "bajo"] as const;
export type GoalEmphasis = (typeof GOAL_EMPHASIS)[number];

/**
 * Qué implica, en entrenamiento, la silueta que el atleta eligió como
 * dirección. Es lo único que se puede leer cuando todavía no hay fotos
 * propias con qué comparar.
 */
export interface GoalDirectionReading {
  zona: GoalZone;
  enfasis: GoalEmphasis;
}

/** El texto que ve el atleta. El modelo escoge la llave, no redacta. */
export const EMPHASIS_TEXT: Record<GoalZone, Record<GoalEmphasis, string>> = {
  cintura: {
    alto: "Cintura: la referencia es de cintura marcada, así que aquí manda el déficit sostenido y el descanso, no más abdominales.",
    medio: "Cintura: importa, pero no es lo que define esa silueta.",
    bajo: "Cintura: no es la palanca de este objetivo.",
  },
  cadera_gluteo: {
    alto: "Glúteo y cadera: es de las zonas que más definen esa silueta. Trabájalo dos veces por semana, no una.",
    medio: "Glúteo y cadera: sostén el trabajo que ya trae tu rutina.",
    bajo: "Glúteo y cadera: con lo que ya haces alcanza para este objetivo.",
  },
  pierna: {
    alto: "Pierna: la referencia carga volumen abajo. Tu día pesado de pierna es el que no se salta.",
    medio: "Pierna: mantén el volumen que ya traes.",
    bajo: "Pierna: no necesitas subirle para acercarte a esa silueta.",
  },
  brazo: {
    alto: "Brazo: la referencia trae brazo trabajado. Cierra tus días de torso con trabajo directo de bíceps y tríceps.",
    medio: "Brazo: el trabajo que ya cae en tus días de torso es suficiente.",
    bajo: "Brazo: no es lo que mueve esta silueta.",
  },
  espalda: {
    alto: "Espalda: es lo que más mueve esa silueta —la V sale de la espalda alta, no de la cintura—. Ábrele la semana.",
    medio: "Espalda: sostén jalón y remo como ya los traes.",
    bajo: "Espalda: con el volumen actual basta para este objetivo.",
  },
};

export function directionLines(readings: readonly GoalDirectionReading[]): string[] {
  const orden: Record<GoalEmphasis, number> = { alto: 0, medio: 1, bajo: 2 };
  return [...readings]
    .sort((a, b) => orden[a.enfasis] - orden[b.enfasis])
    .map((reading) => EMPHASIS_TEXT[reading.zona][reading.enfasis]);
}

export function parseDirectionReadings(value: unknown): GoalDirectionReading[] {
  if (!Array.isArray(value)) return [];

  const byZone = new Map<GoalZone, GoalDirectionReading>();
  for (const row of value) {
    if (row === null || typeof row !== "object") continue;
    const raw = row as Record<string, unknown>;
    const zona = matchEnum(GOAL_ZONES, raw.zona);
    const enfasis = matchEnum(GOAL_EMPHASIS, raw.enfasis);
    if (zona && enfasis && !byZone.has(zona)) byZone.set(zona, { zona, enfasis });
  }
  return GOAL_ZONES.map((zone) => byZone.get(zone)).filter(
    (reading): reading is GoalDirectionReading => reading !== undefined,
  );
}

export interface GoalZoneReading {
  zona: GoalZone;
  brecha: GoalGap;
  tendencia: GoalTrend;
  accion: GoalAction;
}

/** Una zona, ya en español neutro y accionable. */
export function readingToLine(reading: GoalZoneReading): string {
  return `${ZONE_LABEL[reading.zona]}: ${GAP_LABEL[reading.brecha]} ${TREND_LABEL[reading.tendencia]}. ${ACTION_TEXT[reading.accion]}`;
}

/** Las zonas que más se mueven primero; la que se alejó nunca se esconde. */
const TREND_ORDER: Record<GoalTrend, number> = { "alejándose": 0, igual: 1, "acercándose": 2 };

export function goalLines(readings: readonly GoalZoneReading[]): string[] {
  return [...readings]
    .sort((a, b) => TREND_ORDER[a.tendencia] - TREND_ORDER[b.tendencia])
    .map(readingToLine);
}

// ---------------------------------------------------------------------------
// El parseo de la herramienta
// ---------------------------------------------------------------------------

/** Sin acentos y en minúsculas: el modelo a veces escribe "acercandose". */
function fold(value: unknown): string {
  return typeof value === "string"
    ? value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase()
    : "";
}

function matchEnum<T extends string>(options: readonly T[], value: unknown): T | null {
  const folded = fold(value);
  return options.find((option) => fold(option) === folded) ?? null;
}

/** Convierte una fila cruda de la herramienta en una lectura, o la tira. */
export function parseGoalReading(value: unknown): GoalZoneReading | null {
  if (value === null || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;

  const zona = matchEnum(GOAL_ZONES, raw.zona);
  const brecha = matchEnum(GOAL_GAPS, raw.brecha);
  const tendencia = matchEnum(GOAL_TRENDS, raw.tendencia);
  const accion = matchEnum(GOAL_ACTIONS, raw.accion_sugerida);

  if (!zona || !brecha || !tendencia || !accion) return null;
  return { zona, brecha, tendencia, accion };
}

/** Las lecturas válidas, una por zona (la primera de cada zona manda). */
export function parseGoalReadings(value: unknown): GoalZoneReading[] {
  if (!Array.isArray(value)) return [];

  const byZone = new Map<GoalZone, GoalZoneReading>();
  for (const row of value) {
    const reading = parseGoalReading(row);
    if (reading && !byZone.has(reading.zona)) byZone.set(reading.zona, reading);
  }
  return GOAL_ZONES.map((zone) => byZone.get(zone)).filter(
    (reading): reading is GoalZoneReading => reading !== undefined,
  );
}

// ---------------------------------------------------------------------------
// La llamada
// ---------------------------------------------------------------------------

const GOAL_TOOL_NAME = "registrar_rumbo_objetivo";

const GOAL_TOOL: Anthropic.Tool = {
  name: GOAL_TOOL_NAME,
  description:
    "Registra, por zona, qué tan lejos está la silueta actual de la de referencia y qué acción de entrenamiento o de adherencia corresponde.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      zonas: {
        type: "array",
        description: "Una fila por zona comparable. Omite la zona que no se vea en ambas series.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            zona: { type: "string", enum: [...GOAL_ZONES] },
            brecha: { type: "string", enum: [...GOAL_GAPS] },
            tendencia: { type: "string", enum: [...GOAL_TRENDS] },
            accion_sugerida: { type: "string", enum: [...GOAL_ACTIONS] },
          },
          required: ["zona", "brecha", "tendencia", "accion_sugerida"],
        },
      },
    },
    required: ["zonas"],
  },
};

const GOAL_SYSTEM = `Comparas dos series de fotos de un atleta: las ACTUALES y una REFERENCIA que el
propio atleta eligió como dirección de su entrenamiento.

Tu única tarea es, por zona (cintura, cadera_gluteo, pierna, brazo, espalda), estimar:
- brecha: qué tan lejos está la PROPORCIÓN actual de la proporción de la referencia;
- tendencia: si respecto a las fotos de hace unas semanas se está acercando, igual o alejándose;
- accion_sugerida: qué palanca de entrenamiento o de adherencia corresponde, de la lista cerrada.

La referencia es dirección, no promesa. Comparas PROPORCIONES Y SILUETA, nunca identidades ni
parecidos. La estructura ósea y la distribución de grasa son individuales: si una zona no puede
acercarse más por estructura, la acción correcta es "seguir_igual" o "mantener_deficit", no exigir más.

PROHIBIDO ABSOLUTAMENTE:
- cualquier comentario sobre la apariencia, el atractivo, el peso o el cuerpo de la persona;
- comparar personas, decir a quién se parece o qué tan cerca está de "verse como" alguien;
- estimar porcentaje de grasa, peso, medidas, tallas o edad;
- describir rostros, ropa o entorno;
- cualquier consejo médico, de salud o de suplementación.

Si una zona no se ve en las dos series, simplemente no la reportes. Omitir es mejor que adivinar.
No escribas nada fuera de la herramienta.`;

export interface GoalAnalysisInput {
  profile: Profile;
  /** Las fotos más recientes del historial. */
  current: Array<{ storagePath: string; view: string }>;
  /** Las fotos de la quincena anterior, para la tendencia. Puede ir vacío. */
  earlier: Array<{ storagePath: string; view: string }>;
  references: GoalReference[];
}

export interface GoalAnalysis {
  readings: GoalZoneReading[];
  model: string;
  analyzedAt: string;
}

export interface AnalyzeGoalOptions {
  client?: Anthropic;
}

/**
 * Devuelve `null` cuando el análisis no aplica: visión apagada, sin
 * consentimiento, sin llave, sin referencia o sin fotos reales que comparar.
 */
export async function analyzeGoal(
  input: GoalAnalysisInput,
  options: AnalyzeGoalOptions = {},
): Promise<GoalAnalysis | null> {
  if (!visionEnabled()) return null;
  if (!input.profile.photoConsentAt) return null;
  if (options.client === undefined && !hasAnthropicKey()) return null;
  if (input.references.length === 0) return null;
  if (input.current.length === 0) return null;

  const content: Anthropic.ContentBlockParam[] = [
    {
      type: "text",
      text:
        "Compara las fotos ACTUALES contra la REFERENCIA, zona por zona. " +
        "Usa las fotos de HACE UNAS SEMANAS solo para decidir la tendencia. " +
        "Contesta llamando a la herramienta, sin texto fuera de ella.",
    },
    ...(await photoContentBlocks(input.current, "ACTUALES")),
    ...(await photoContentBlocks(input.earlier, "HACE UNAS SEMANAS")),
    ...(await photoContentBlocks(
      input.references.map((reference) => ({
        storagePath: reference.storagePath,
        view: reference.view,
      })),
      "REFERENCIA",
    )),
  ];

  try {
    const client = options.client ?? anthropicClient();
    const response = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 2000,
      thinking: { type: "disabled" },
      system: GOAL_SYSTEM,
      tools: [GOAL_TOOL],
      tool_choice: { type: "tool", name: GOAL_TOOL_NAME },
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") return null;

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === GOAL_TOOL_NAME,
    );
    if (!toolUse) return null;

    const raw = (
      typeof toolUse.input === "string" ? JSON.parse(toolUse.input) : toolUse.input
    ) as Record<string, unknown>;

    const readings = parseGoalReadings(raw.zonas);
    if (readings.length === 0) return null;

    return { readings, model: VISION_MODEL, analyzedAt: new Date().toISOString() };
  } catch (error) {
    console.error("[coachy] no se pudo analizar el rumbo al objetivo", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Lectura de la referencia sola
// ---------------------------------------------------------------------------

const DIRECTION_TOOL_NAME = "registrar_enfasis_objetivo";

const DIRECTION_TOOL: Anthropic.Tool = {
  name: DIRECTION_TOOL_NAME,
  description:
    "Registra, por zona, qué tanto énfasis de entrenamiento implica la silueta de referencia.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      zonas: {
        type: "array",
        description: "Una fila por zona visible en la referencia. Omite la que no se vea.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            zona: { type: "string", enum: [...GOAL_ZONES] },
            enfasis: { type: "string", enum: [...GOAL_EMPHASIS] },
          },
          required: ["zona", "enfasis"],
        },
      },
    },
    required: ["zonas"],
  },
};

const DIRECTION_SYSTEM = `Ves una serie de fotos de REFERENCIA que un atleta eligió como dirección
de su entrenamiento. NO hay fotos del atleta: no estás comparando a nadie con nadie.

Tu única tarea es decir, por zona (cintura, cadera_gluteo, pierna, brazo, espalda), cuánto énfasis
de entrenamiento implica esa silueta: qué zonas la definen y cuáles no.

PROHIBIDO ABSOLUTAMENTE:
- cualquier comentario sobre la apariencia, el atractivo o el cuerpo de las personas de las fotos;
- identificar, nombrar o describir a quien aparece, su rostro, su ropa o el entorno;
- estimar porcentaje de grasa, peso, medidas, tallas o edad;
- prometer resultados o plazos;
- cualquier consejo médico, de salud o de suplementación.

Si una zona no se ve, no la reportes. Omitir es mejor que adivinar. No escribas nada fuera de la
herramienta.`;

export interface GoalDirectionAnalysis {
  readings: GoalDirectionReading[];
  model: string;
  analyzedAt: string;
}

/**
 * Lee la referencia por sí sola: qué implica esa silueta en términos de
 * entrenamiento.
 *
 * Existe porque el análisis normal necesita fotos del atleta para comparar, y
 * quien apenas subió su referencia se quedaba con una pantalla vacía y sin
 * nada que hacer. Esto no sustituye la comparación —no dice qué tan lejos
 * estás, porque sin fotos tuyas eso sería inventar— pero sí convierte la
 * referencia en algo accionable desde el primer día: dónde poner el énfasis.
 */
export async function analyzeGoalDirection(
  input: { profile: Profile; references: GoalReference[] },
  options: AnalyzeGoalOptions = {},
): Promise<GoalDirectionAnalysis | null> {
  if (!visionEnabled()) return null;
  if (!input.profile.photoConsentAt) return null;
  if (options.client === undefined && !hasAnthropicKey()) return null;
  if (input.references.length === 0) return null;

  const content: Anthropic.ContentBlockParam[] = [
    {
      type: "text",
      text:
        "Di, zona por zona, cuánto énfasis de entrenamiento implica esta silueta de referencia. " +
        "Contesta llamando a la herramienta, sin texto fuera de ella.",
    },
    ...(await photoContentBlocks(
      input.references.map((reference) => ({
        storagePath: reference.storagePath,
        view: reference.view,
      })),
      "REFERENCIA",
    )),
  ];

  try {
    const client = options.client ?? anthropicClient();
    const response = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 1000,
      thinking: { type: "disabled" },
      system: DIRECTION_SYSTEM,
      tools: [DIRECTION_TOOL],
      tool_choice: { type: "tool", name: DIRECTION_TOOL_NAME },
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") return null;

    const toolUse = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === DIRECTION_TOOL_NAME,
    );
    if (!toolUse) return null;

    const raw = (
      typeof toolUse.input === "string" ? JSON.parse(toolUse.input) : toolUse.input
    ) as Record<string, unknown>;

    const readings = parseDirectionReadings(raw.zonas);
    if (readings.length === 0) return null;

    return { readings, model: VISION_MODEL, analyzedAt: new Date().toISOString() };
  } catch (error) {
    console.error("[coachy] no se pudo leer la referencia del objetivo", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cadencia y caché
// ---------------------------------------------------------------------------

/** Marca del contexto que distingue estas filas del resto de la conversación. */
export const GOAL_KIND = "rumbo_objetivo";

/** El caché de la lectura de la referencia sola, que es otra pregunta. */
export const DIRECTION_KIND = "enfasis_objetivo";

const BIWEEKLY_DAYS = 14;

/** ¿Ya pasaron dos semanas desde el último análisis? Sin fecha, sí. */
export function isBiweeklyDue(lastAnalyzedAt: string | null, nowISO: string): boolean {
  if (!lastAnalyzedAt) return true;

  const last = Date.parse(lastAnalyzedAt);
  const now = Date.parse(nowISO);
  if (!Number.isFinite(last) || !Number.isFinite(now)) return true;

  return (now - last) / 86_400_000 >= BIWEEKLY_DAYS;
}

/**
 * Huella de las entradas del análisis. Mientras no cambie, el texto cacheado
 * sigue vigente y un render más no vuelve a pagar la API.
 */
export function goalFingerprint(
  references: readonly GoalReference[],
  current: readonly { storagePath: string }[],
): string {
  const refs = references.map((reference) => `${reference.view}@${reference.updatedAt}`);
  const photos = [...current].map((photo) => photo.storagePath).sort();
  return [refs.join(","), photos.join(",")].join("|");
}

interface CachedGoal {
  readings: GoalZoneReading[];
  fingerprint: string;
  analyzedAt: string;
}

function cachedGoal(contextJson: Prisma.JsonValue | null): CachedGoal | null {
  if (contextJson === null || typeof contextJson !== "object" || Array.isArray(contextJson)) {
    return null;
  }
  const context = contextJson as Record<string, unknown>;
  if (context.kind !== GOAL_KIND) return null;

  const readings = parseGoalReadings(context.readings);
  if (readings.length === 0) return null;

  return {
    readings,
    fingerprint: typeof context.fingerprint === "string" ? context.fingerprint : "",
    analyzedAt: typeof context.analyzedAt === "string" ? context.analyzedAt : "",
  };
}

/**
 * El estado que pinta la tarjeta del historial.
 *
 * - `sin_referencia`: todavía no subió fotos de meta — la tarjeta invita.
 * - `sin_fotos`: hay referencia pero el historial no tiene fotos que comparar.
 * - `en_espera`: hay de todo, pero el análisis no está disponible (visión
 *   apagada, sin consentimiento o sin llave) o la primera corrida no salió.
 * - `listo`: hay lectura por zona.
 */
export type GoalStatus =
  | { state: "sin_referencia" }
  /**
   * Hay referencia pero todavía no fotos propias con qué comparar. `lines`
   * trae la lectura de la referencia sola —dónde poner el énfasis—, que sí se
   * puede decir sin fotos del atleta.
   */
  | {
      state: "sin_fotos";
      references: number;
      lines: string[];
      /** Lo mismo que `lines`, estructurado: para graficar el énfasis por zona. */
      emphasis: GoalDirectionReading[];
    }
  | { state: "en_espera"; references: number }
  | {
      state: "listo";
      references: number;
      lines: string[];
      /**
       * Lo mismo que `lines`, estructurado: para dibujar la brecha por zona.
       * El texto sigue mandando en la lectura; esto solo lo grafica.
       */
      readings: GoalZoneReading[];
      analyzedAt: string;
    };

/** Las fotos del check-in con foto más reciente, y las del anterior. */
async function recentPhotoSeries(userId: string): Promise<{
  current: Array<{ storagePath: string; view: string }>;
  earlier: Array<{ storagePath: string; view: string }>;
}> {
  const checkIns = await prisma.checkIn
    .findMany({
      where: { userId, photos: { some: {} } },
      orderBy: { date: "desc" },
      take: 2,
      select: { photos: { select: { storagePath: true, view: true } } },
    })
    .catch(() => []);

  return {
    current: checkIns[0]?.photos ?? [],
    earlier: checkIns[1]?.photos ?? [],
  };
}

/**
 * "Rumbo a tu objetivo", cacheado por huella y limitado a una corrida cada dos
 * semanas.
 *
 * Se llama desde el render de `/app/historial`, así que nunca lanza: cualquier
 * problema degrada a un estado que la tarjeta sabe dibujar.
 */
export interface GoalStatusOptions {
  /**
   * Ignora la cadencia de 14 días: si la huella cambió, se paga la lectura
   * ya. La usa el check-in mensual — el mes es justo el momento de comparar
   * contra la referencia, no "cuando toque la quincena". Con la misma huella
   * se reusa lo guardado igual: mismas fotos, misma respuesta.
   */
  force?: boolean;
}

export async function goalStatusFor(
  userId: string,
  profile: Profile,
  nowISO: string = new Date().toISOString(),
  options: GoalStatusOptions = {},
): Promise<GoalStatus> {
  const references = await listGoalReferences(userId);
  if (references.length === 0) return { state: "sin_referencia" };

  const { current, earlier } = await recentPhotoSeries(userId);
  if (current.length === 0) {
    const emphasis = await directionFor(userId, profile, references);
    return {
      state: "sin_fotos",
      references: references.length,
      lines: directionLines(emphasis),
      emphasis,
    };
  }

  const fingerprint = goalFingerprint(references, current);

  const stored = await prisma.conversation
    .findMany({
      where: { userId, role: "COACHY" },
      orderBy: { date: "desc" },
      take: 20,
      select: { contextJson: true },
    })
    .catch(() => []);

  const cached = stored.map((row) => cachedGoal(row.contextJson)).find(Boolean) ?? null;

  // Nada cambió, o cambió pero no toca todavía (salvo `force`): se reusa lo guardado.
  const reusable =
    cached !== null &&
    (cached.fingerprint === fingerprint ||
      (!options.force && !isBiweeklyDue(cached.analyzedAt, nowISO)));
  if (cached && reusable) {
    return {
      state: "listo",
      references: references.length,
      lines: goalLines(cached.readings),
      readings: cached.readings,
      analyzedAt: cached.analyzedAt,
    };
  }

  const analysis = await analyzeGoal({ profile, current, earlier, references });
  if (!analysis) return { state: "en_espera", references: references.length };

  await prisma.conversation
    .create({
      data: {
        userId,
        role: "COACHY",
        text: goalLines(analysis.readings).join("\n\n"),
        contextJson: {
          kind: GOAL_KIND,
          fingerprint,
          readings: analysis.readings,
          analyzedAt: analysis.analyzedAt,
          model: analysis.model,
        } as unknown as Prisma.InputJsonValue,
      },
    })
    .catch((error) => {
      console.error("[coachy] no se pudo cachear el rumbo al objetivo", error);
      return null;
    });

  return {
    state: "listo",
    references: references.length,
    lines: goalLines(analysis.readings),
    readings: analysis.readings,
    analyzedAt: analysis.analyzedAt,
  };
}

/**
 * La lectura de la referencia sola, cacheada por huella de las referencias.
 *
 * Se recalcula solo cuando cambian las fotos de referencia: la dirección no se
 * mueve sola, y cada corrida cuesta una llamada de visión. Si el análisis no
 * aplica (visión apagada, sin consentimiento, sin llave) regresa vacío, y la
 * pantalla enseña su estado normal sin lectura.
 */
async function directionFor(
  userId: string,
  profile: Profile,
  references: GoalReference[],
): Promise<GoalDirectionReading[]> {
  const fingerprint = goalFingerprint(references, []);

  const stored = await prisma.conversation
    .findMany({
      where: { userId, role: "COACHY" },
      orderBy: { date: "desc" },
      take: 20,
      select: { contextJson: true },
    })
    .catch(() => []);

  for (const row of stored) {
    const raw = row.contextJson as Record<string, unknown> | null;
    if (!raw || raw.kind !== DIRECTION_KIND) continue;
    if (raw.fingerprint !== fingerprint) continue;
    return parseDirectionReadings(raw.readings);
  }

  const analysis = await analyzeGoalDirection({ profile, references });
  if (!analysis) return [];

  await prisma.conversation
    .create({
      data: {
        userId,
        role: "COACHY",
        text: directionLines(analysis.readings).join("\n\n"),
        contextJson: {
          kind: DIRECTION_KIND,
          fingerprint,
          readings: analysis.readings,
          analyzedAt: analysis.analyzedAt,
          model: analysis.model,
        } as unknown as Prisma.InputJsonValue,
      },
    })
    .catch((error) => {
      console.error("[coachy] no se pudo cachear el énfasis del objetivo", error);
      return null;
    });

  return analysis.readings;
}

/** Las referencias con URL firmada, listas para pintar en `/app/objetivo`. */
export async function goalReferenceUrls(
  userId: string,
): Promise<Array<GoalReference & { url: string }>> {
  const references = await listGoalReferences(userId);
  if (references.length === 0) return [];

  // asAdmin por la misma razón que el listado: sin cookies no hay quien firme.
  const signed = await signedPhotoUrls(
    references.map((reference) => reference.storagePath),
    { asAdmin: true },
  );

  return references
    .map((reference) => ({ ...reference, url: signed[reference.storagePath] ?? "" }))
    .filter((reference) => reference.url !== "");
}
