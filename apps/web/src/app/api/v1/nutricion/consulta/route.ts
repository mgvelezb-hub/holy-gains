import type Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { COMPOSE_MODEL, anthropicClient, hasAnthropicKey } from "@/lib/coachy/anthropic";
import { decisionVigente } from "@/lib/coachy/menu";
import { NUTRITION_DISCLAIMER, triageQuestion } from "@/lib/nutricion/triage";
import { prisma } from "@/lib/prisma";

/**
 * `POST /api/v1/nutricion/consulta` — la nutrióloga virtual (Fase 8).
 *
 * Responde dudas **sobre el plan que la app ya generó**: por qué esos
 * alimentos, cómo cambiar uno por otro, qué hacer si un día no comes en casa.
 * No arma planes nuevos ni mueve números: el motor sigue siendo el único que
 * decide, y aquí la IA solo explica lo que ya está decidido.
 *
 * El triage corre **antes** que el modelo, y es determinista: una pregunta con
 * bandera roja se frena en el servidor, sin llegar a la IA. Un freno escrito
 * como instrucción en el prompt es una sugerencia; escrito como `if`, es un
 * freno.
 */

export const dynamic = "force-dynamic";

/** Preguntas al día por persona. */
const DAILY_LIMIT = 20;

const schema = z.object({
  question: z.string().trim().min(3, "escribe tu pregunta").max(600),
});

const SYSTEM_PROMPT = `Eres la parte de Holy Gains que explica el plan de alimentación ya generado.

Reglas duras:
- Explicas lo que el motor decidió. NUNCA propones kcal, macros ni gramos distintos.
- Si la pregunta pide un plan nuevo, una dieta distinta o un número, dices que eso lo decide el motor en el siguiente check-in.
- No das indicaciones médicas ni interpretas estudios. Si la pregunta va para allá, dices que eso lo ve un médico.
- Hablas en el vocabulario de la app: "Ingredientes", no "COGS"; "Personal", no "nómina"; nada de jerga clínica.
- Español de México, tuteo, directo y corto. Máximo 120 palabras.
- Cierras con algo accionable hoy, no con una advertencia genérica.`;

export async function POST(request: Request): Promise<NextResponse> {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  if (!user.profile) {
    return NextResponse.json({ error: "onboarding incompleto" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "cuerpo inválido" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "pregunta inválida" }, { status: 422 });
  }

  // Tope diario por persona. Cada pregunta cuesta una llamada al modelo, y sin
  // tope una pantalla con un botón se convierte en una factura abierta. 20 al
  // día es muy por encima del uso real y muy por debajo de un bucle.
  const desdeMedianoche = new Date();
  desdeMedianoche.setHours(0, 0, 0, 0);
  const hoyCuenta = await prisma.conversation.count({
    where: { userId: user.id, role: "ATHLETE", date: { gte: desdeMedianoche } },
  });
  if (hoyCuenta >= DAILY_LIMIT) {
    return NextResponse.json(
      {
        error:
          "Ya son muchas preguntas por hoy. Mañana se reinicia — y si algo no te cuadra del plan, " +
          "eso se resuelve mejor en tu check-in.",
      },
      { status: 429 },
    );
  }

  const triage = triageQuestion(parsed.data.question);
  if (triage.blocked) {
    // `matched` no viaja: a la persona se le dice qué pasa, no qué palabra la
    // clasificó — eso solo serviría para aprender a rodear el filtro.
    return NextResponse.json({
      answer: triage.message,
      category: triage.category,
      blocked: true,
      disclaimer: NUTRITION_DISCLAIMER,
    });
  }

  if (!hasAnthropicKey()) {
    return NextResponse.json(
      { error: "la redacción no está disponible en este momento" },
      { status: 503 },
    );
  }

  // El contexto es el plan vigente, no la conversación: la respuesta tiene que
  // hablar de SUS números, no de nutrición en general.
  const decision = await decisionVigente(user.id);

  const contexto = decision
    ? `Plan vigente: fase ${decision.phase}, ${decision.kcal} kcal, ` +
      `${decision.proteinG} g de proteína, ${decision.carbsG} g de carbohidrato, ${decision.fatG} g de grasa. ` +
      `Estilo de dieta: ${user.profile.dietStyle}. Comidas al día: ${user.profile.mealsPerDay}.`
    : `Todavía no hay un plan publicado: la primera decisión sale del primer check-in. ` +
      `Estilo de dieta elegido: ${user.profile.dietStyle}.`;

  const client = anthropicClient();
  const response = await client.messages.create({
    model: COMPOSE_MODEL,
    max_tokens: 700,
    thinking: { type: "disabled" },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [
      { role: "user", content: `${contexto}\n\nPregunta de la atleta: ${parsed.data.question}` },
    ],
  });

  const answer = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!answer) {
    return NextResponse.json({ error: "no se pudo redactar la respuesta" }, { status: 502 });
  }

  // La conversación queda registrada: es el historial que la atleta puede
  // releer, y es lo que hace contable el tope diario.
  await prisma.conversation.createMany({
    data: [
      { userId: user.id, role: "ATHLETE", text: parsed.data.question },
      { userId: user.id, role: "COACHY", text: answer },
    ],
  });

  return NextResponse.json({
    answer,
    category: "OK",
    blocked: false,
    disclaimer: NUTRITION_DISCLAIMER,
  });
}
