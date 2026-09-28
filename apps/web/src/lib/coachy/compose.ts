import type Anthropic from "@anthropic-ai/sdk";

import { COMPOSE_MODEL, anthropicClient } from "@/lib/coachy/anthropic";
import type { ComposeInput, CoachyReply, FewShotExample, RetroCheckIn } from "@/lib/coachy/types";

/**
 * Redacción de la respuesta semanal de Holy Gains.
 *
 * La frontera es la regla más importante del archivo: **el motor decide los
 * números, esta función solo los cita**. El modelo no ve ningún campo donde
 * pueda escribir kcal o macros propios, y lo que redacta pasa por
 * `enforceEngineNumbers` antes de guardarse.
 */

const REPLY_TOOL_NAME = "responder_al_checkin";

/** Herramienta = contrato de salida. Sin campos numéricos, a propósito. */
const REPLY_TOOL: Anthropic.Tool = {
  name: REPLY_TOOL_NAME,
  description:
    "Entrega la respuesta semanal del coach al check-in, en el orden fijo de la metodología.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      celebracion: {
        type: "string",
        description:
          "Una o dos frases celebrando algo CONCRETO y verificable de esta semana (una medida, una foto, una carga, el cumplimiento). Nada genérico.",
      },
      preguntas: {
        type: "array",
        items: { type: "string" },
        description:
          "Las preguntas que se te dieron, con tus palabras. Ni una más, ni una menos. Máximo 3.",
      },
      comparacion: {
        type: "string",
        description:
          "Comparación contra la semana anterior y, si hay fotos, contra el día 1. Solo datos que aparecen en el contexto.",
      },
      decision_texto: {
        type: "string",
        description:
          "Qué pasa con la dieta esta semana, explicado en una o dos frases. Si citas kcal o gramos, deben ser EXACTAMENTE los del motor.",
      },
      meta: {
        type: "string",
        description: "Una meta corta y medible para los próximos 7 días.",
      },
      cierre: {
        type: "string",
        description: "Cierre corto con hype. Máximo una frase.",
      },
      va_bien: {
        type: "array",
        items: { type: "string" },
        description:
          "Qué va bien en el periodo (la semana, o el mes si es check-in mensual). De 1 a 4 renglones cortos, cada uno con un dato del contexto. Nada genérico.",
      },
      hay_que_ajustar: {
        type: "array",
        items: { type: "string" },
        description:
          "Qué hay que ajustar, dicho como algo que se ajusta y nunca como regaño. De 0 a 4 renglones cortos, solo con datos del contexto.",
      },
    },
    required: [
      "celebracion",
      "preguntas",
      "comparacion",
      "decision_texto",
      "meta",
      "cierre",
      "va_bien",
      "hay_que_ajustar",
    ],
  },
};

const SYSTEM_PROMPT = `Eres Holy Gains, el coach virtual de nutrición y entrenamiento de un atleta.
Contestas su check-in semanal. Escribes en español de México, en segunda persona, cálido y directo.

## Orden obligatorio de la respuesta
1. Celebras algo concreto y verificable de esta semana.
2. Preguntas (las que te den, máximo 3).
3. Comparas contra la semana anterior y, si hay análisis de fotos, contra el día 1.
4. Dices qué pasa con la dieta.
5. Cierras con una meta corta de 7 días y una frase de hype.

## Tono
- Hype corto y constante, sin exagerar: "vamos con todo", "eso carajo", "estás cañona".
- Frases cortas. Nada de párrafos largos ni de lenguaje clínico.
- Vocabulario del atleta, no del nutriólogo: "comida", "cintura", "cargas", "estar inflamada".
- Ante desánimo: normalizas, reencuadras y dejas la puerta abierta. Nunca regañas.
- Ante una pausa: sin culpa. "Si quieres continuar aquí estamos, si quieres pausar aquí estamos."

## Reglas duras (violarlas invalida la respuesta)
- NUNCA regañas, culpas ni presionas por un cumplimiento bajo.
- NUNCA interpretas estudios de laboratorio ni resultados médicos. Si aparecen, remites al médico.
- NUNCA diagnosticas ni nombras enfermedades. Ante un síntoma persistente: médico o fisio.
- NUNCA cambias kcal, macros, gramos ni fase. Esos números vienen del motor y se citan tal cual.
- NUNCA inventas medidas, fotos, cargas ni datos que no estén en el contexto.
- NUNCA propones protocolos nuevos ni suplementos.
- La cinta métrica manda sobre la báscula. Si el peso no se mueve y la cintura sí, eso es
  recomposición y así se explica.
- Te diriges al atleta por el nombre que aparece en el contexto. No inventas nombres.
- Firmas siempre como Holy Gains.`;

/** Renderiza los few-shot como material de referencia de tono. */
function renderExamples(examples: readonly FewShotExample[], athleteName: string): string {
  if (examples.length === 0) return "";

  const blocks = examples.map((example, index) => {
    const contexto = JSON.stringify(example.contexto, null, 0);
    const respuesta = example.respuesta.replaceAll("{{ATLETA}}", athleteName);
    return `### Ejemplo ${index + 1}\nContexto: ${contexto}\nRespuesta del coach: ${respuesta}`;
  });

  return [
    "",
    "## Ejemplos reales de cómo contesta este coach",
    "Son para calcar el TONO y el ritmo, no para copiar el contenido: los datos de la semana",
    "que tienes que contestar están en el mensaje del usuario, no aquí.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

/** El contexto de la semana que va en el turno del usuario. */
function renderContext(input: ComposeInput): string {
  const lines: string[] = [];

  lines.push(`Atleta: ${input.athleteName}`);
  lines.push(`Semana del check-in: ${input.weekLabel}`);
  lines.push("");
  lines.push("## Señales de la semana");
  lines.push(JSON.stringify(input.signals, null, 2));

  if (input.vision) {
    lines.push("");
    lines.push("## Análisis de fotos (por zona, solo cambio)");
    lines.push(
      JSON.stringify(
        { vs_semana_anterior: input.vision.vsPrevious, vs_dia_1: input.vision.vsBaseline },
        null,
        2,
      ),
    );
  } else {
    lines.push("");
    lines.push("## Análisis de fotos");
    lines.push("No hay. No inventes cambios visuales; compara solo con medidas y sensaciones.");
  }

  lines.push("");
  lines.push("## Decisión del motor — estos números son inamovibles");
  lines.push(`Fase: ${input.phase} (venía de ${input.previousPhase})`);
  lines.push(`Categoría: ${input.category}`);
  lines.push(
    `Objetivos diarios: ${input.targets.kcal} kcal · ${input.targets.proteinG} g de proteína · ` +
      `${input.targets.carbG} g de carbohidratos · ${input.targets.fatG} g de grasa · ` +
      `${input.targets.fiberG} g de fibra`,
  );
  lines.push(`Explicación del motor: ${input.engineExplanation}`);
  lines.push("Reglas disparadas:");
  for (const rule of input.rules) {
    lines.push(`- ${rule.id} ${rule.nombre}: ${rule.explicacion}`);
  }
  if (input.menuRefresh) lines.push("- Toca refrescar el menú: mismos macros, alimentos distintos.");
  if (input.electrolyteProtocol) {
    lines.push("- Protocolo de electrolitos activo: salar comidas, agua mineral con limón y sal.");
  }
  if (input.injuryTrainingProtocol) {
    lines.push("- Adaptar el entreno por lesión: no se pausa, se adapta.");
  }
  if (input.simplifyMenu) lines.push("- Simplificar el menú: menos ingredientes, más repetición.");

  if (input.mensual) {
    const { mensual } = input;
    lines.push("");
    if (mensual.esMensual) {
      lines.push("## Este es su check-in mensual");
      lines.push(
        "Compara el MES: contra el check-in mensual anterior y contra el inicio. Cambios en cm y kg:",
      );
      lines.push(JSON.stringify(mensual.deltas, null, 2));
      if (mensual.fotos && mensual.fotos.zonas.length > 0) {
        lines.push("Fotos contra su referencia, por zona (solo brecha y tendencia, nunca estética):");
        lines.push(JSON.stringify(mensual.fotos.zonas, null, 2));
      }
    } else {
      lines.push("## Retro de la semana");
    }
    lines.push("Material para va_bien y hay_que_ajustar (redáctalo con tus palabras, no inventes más):");
    for (const linea of mensual.objetivo.vaBien) lines.push(`- Va bien: ${linea}`);
    for (const linea of mensual.objetivo.ajustar) lines.push(`- Ajustar: ${linea}`);
  }

  if (input.plan) {
    lines.push("");
    lines.push("## Su plan de aquí en adelante (ya escrito; no lo repitas ni lo cambies)");
    lines.push(`- Macros: ${input.plan.macros}`);
    lines.push(`- Menú: ${input.plan.menu}`);
    lines.push(`- Rutina: ${input.plan.rutina}`);
  }

  lines.push("");
  lines.push("## Preguntas que tienes que hacer esta semana");
  for (const question of input.questions) {
    lines.push(`- (${question.signal}) ${question.text}`);
  }
  if (input.questions.length === 0) lines.push("- Ninguna. Deja `preguntas` vacío.");

  lines.push("");
  lines.push(
    `Contesta llamando a la herramienta ${REPLY_TOOL_NAME}. No escribas texto fuera de la herramienta.`,
  );

  return lines.join("\n");
}

/**
 * Los renglones de "va bien" / "ajustar" que redactó el modelo, sin los que
 * citan un número "grande" que no aparece en el contexto que se le dio.
 * Vacío si no mandó nada válido: quien llama cae a la versión determinista.
 */
function renglonesVerificados(value: unknown, contexto: string): string[] {
  if (!Array.isArray(value)) return [];
  const permitidos = new Set(integersIn(contexto));

  return value
    .filter((linea): linea is string => typeof linea === "string")
    .map((linea) => linea.trim())
    .filter(Boolean)
    .filter((linea) =>
      integersIn(linea).every((n) => n <= SAFE_NUMBER_CEILING || permitidos.has(n)),
    )
    .slice(0, 4);
}

function retroDe(raw: Record<string, unknown>, input: ComposeInput, contexto: string): RetroCheckIn | undefined {
  if (!input.plan) return undefined;

  const vaBien = renglonesVerificados(raw.va_bien, contexto);
  const ajustar = renglonesVerificados(raw.hay_que_ajustar, contexto);

  return {
    va_bien: vaBien.length > 0 ? vaBien : (input.mensual?.objetivo.vaBien ?? []),
    // "Ajustar" puede venir vacío a propósito; solo se rellena si el modelo no
    // contestó el campo o lo que mandó no pasó el filtro de números.
    ajustar:
      ajustar.length > 0 || (Array.isArray(raw.hay_que_ajustar) && raw.hay_que_ajustar.length === 0)
        ? ajustar
        : (input.mensual?.objetivo.ajustar ?? []),
    plan: input.plan,
  };
}

/** Enteros que aparecen en un texto. Ignora los que van pegados a letras. */
function integersIn(text: string): number[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)]
    .map((match) => Number(match[0].replace(",", ".")))
    .filter((value) => Number.isFinite(value));
}

/**
 * Cualquier número "grande" que el modelo escriba en la decisión tiene que ser
 * uno del motor. Si se inventa uno, se descarta su texto y se pone el del motor.
 *
 * Números pequeños (≤ 30) se dejan pasar: son centímetros, series, semanas,
 * litros de agua o porcentajes de la propia semana.
 */
const SAFE_NUMBER_CEILING = 30;

export function enforceEngineNumbers(reply: CoachyReply, input: ComposeInput): CoachyReply {
  const allowed = new Set<number>([
    input.targets.kcal,
    input.targets.proteinG,
    input.targets.fatG,
    input.targets.carbG,
    input.targets.fiberG,
  ]);

  const offenders = [reply.decision_texto, reply.meta]
    .flatMap(integersIn)
    .filter((value) => value > SAFE_NUMBER_CEILING && !allowed.has(value));

  if (offenders.length === 0) return reply;

  return {
    ...reply,
    decision_texto: fallbackDecisionText(input),
    meta: integersIn(reply.meta).some(
      (value) => value > SAFE_NUMBER_CEILING && !allowed.has(value),
    )
      ? "Esta semana la meta es cumplir el plan completo y mandar medidas y fotos el domingo."
      : reply.meta,
  };
}

/** Texto de decisión escrito por nosotros, con los números del motor. */
export function fallbackDecisionText(input: ComposeInput): string {
  const { kcal, proteinG, carbG, fatG } = input.targets;
  const numbers = `${kcal} kcal, ${proteinG} g de proteína, ${carbG} g de carbohidratos y ${fatG} g de grasa`;

  if (input.category === "HOLD") {
    return `Seguimos con la misma alimentación: ${numbers}. Que la constancia haga lo suyo.`;
  }
  if (input.category === "MENU_REFRESH") {
    return `Mismos números (${numbers}), pero te cambio los alimentos para que no te aburras.`;
  }
  if (input.category === "CONTEXT_CHANGE") {
    return `Los números no se mueven (${numbers}); lo que reacomodo es el formato para que te quede con tu tiempo.`;
  }
  return `Esta semana cambiamos a ${input.phase}: ${numbers}.`;
}

function isCompleteReply(value: unknown): value is CoachyReply {
  if (value === null || typeof value !== "object") return false;
  const reply = value as Record<string, unknown>;
  const strings = ["celebracion", "comparacion", "decision_texto", "meta", "cierre"];
  if (!strings.every((key) => typeof reply[key] === "string")) return false;
  return Array.isArray(reply.preguntas) && reply.preguntas.every((q) => typeof q === "string");
}

export class ComposeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposeError";
  }
}

export interface ComposeOptions {
  examples?: readonly FewShotExample[];
  /** Cliente inyectable. Si falta, se usa el singleton perezoso. */
  client?: Anthropic;
}

/** Redacta la respuesta de la semana. Lanza `ComposeError` si el modelo no coopera. */
export async function composeReply(
  input: ComposeInput,
  options: ComposeOptions = {},
): Promise<CoachyReply> {
  const client = options.client ?? anthropicClient();
  const examples = options.examples ?? [];
  const contexto = renderContext(input);

  const response = await client.messages.create({
    model: COMPOSE_MODEL,
    max_tokens: 4000,
    // Con `tool_choice` forzado no se usa razonamiento extendido: el formato de
    // salida ya está fijado por el esquema de la herramienta.
    thinking: { type: "disabled" },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT + renderExamples(examples, input.athleteName),
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [REPLY_TOOL],
    tool_choice: { type: "tool", name: REPLY_TOOL_NAME },
    messages: [{ role: "user", content: contexto }],
  });

  if (response.stop_reason === "refusal") {
    throw new ComposeError("El modelo declinó redactar la respuesta de esta semana.");
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock =>
      block.type === "tool_use" && block.name === REPLY_TOOL_NAME,
  );

  if (!toolUse) {
    throw new ComposeError("El modelo no devolvió la respuesta estructurada.");
  }

  const raw = typeof toolUse.input === "string" ? JSON.parse(toolUse.input) : toolUse.input;

  if (!isCompleteReply(raw)) {
    throw new ComposeError("La respuesta estructurada llegó incompleta.");
  }

  const reply: CoachyReply = {
    celebracion: raw.celebracion.trim(),
    preguntas: raw.preguntas.map((question) => question.trim()).filter(Boolean).slice(0, 3),
    comparacion: raw.comparacion.trim(),
    decision_texto: raw.decision_texto.trim(),
    meta: raw.meta.trim(),
    cierre: raw.cierre.trim(),
  };

  const retro = retroDe(raw as unknown as Record<string, unknown>, input, contexto);
  return { ...enforceEngineNumbers(reply, input), ...(retro ? { retro } : {}) };
}

/** La respuesta como texto corrido, en el orden de la metodología. Firma incluida. */
export function replyToText(reply: CoachyReply): string {
  const parts = [
    reply.celebracion,
    ...reply.preguntas,
    reply.comparacion,
    reply.decision_texto,
    reply.meta,
    reply.cierre,
    "— Holy Gains",
  ];
  return parts.map((part) => part.trim()).filter(Boolean).join("\n\n");
}
