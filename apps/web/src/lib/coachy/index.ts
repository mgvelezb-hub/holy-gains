import "server-only";

import { Prisma } from "@prisma/client";

import { runCheckinAnalysis } from "@/lib/coachy/analyze";
import { ComposeError, composeReply, replyToText } from "@/lib/coachy/compose";
import { MissingAnthropicKeyError, hasAnthropicKey } from "@/lib/coachy/anthropic";
import { loadFewShotExamples } from "@/lib/coachy/fewshot";
import { construyeBloqueMensual, clasificaMensuales, type BloqueMensual } from "@/lib/coachy/mensual";
import { syncMealPlans } from "@/lib/coachy/menu";
import { notify } from "@/lib/coachy/notifications";
import {
  aMedida,
  fotosDe,
  lecturaDelObjetivo,
  rearmaRutina,
  type RutinaRearmada,
} from "@/lib/coachy/plan-tras-checkin";
import { runEscalationCheck } from "@/lib/observatory/escalation";
import { pickQuestions, type QuestionContext } from "@/lib/coachy/questions";
import type { ComposeInput, CoachyReply } from "@/lib/coachy/types";
import { formatLongDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";

export { runCheckinAnalysis } from "@/lib/coachy/analyze";
export { composeReply, replyToText } from "@/lib/coachy/compose";
export { pickQuestions } from "@/lib/coachy/questions";
export { analyzePhotos } from "@/lib/coachy/vision";
export { syncMealPlans } from "@/lib/coachy/menu";

/**
 * Orquestador de Coachy.
 *
 * Se dispara al guardar un check-in, fuera de la respuesta al usuario: la atleta
 * no espera a que Claude redacte. Si algo falla, la `Decision` del motor ya
 * quedó guardada — que es lo importante — y el admin ve la cola igual, sin texto.
 *
 * Orden: motor y visión → preguntas → mensual y objetivo → menús → rutina →
 * redacción → aviso.
 *
 * "El plan de aquí en adelante" sale completo de aquí: los macros del motor,
 * el menú (forzado a cambiar en el mensual) y la rutina de lo que queda de la
 * semana y la siguiente, rearmada con el historial recién cerrado y la
 * lectura del objetivo recién pedida.
 */

export interface CoachyRunResult {
  decisionId: string;
  status: "ok" | "sin_redaccion";
  reason?: string;
  reply?: CoachyReply;
  mensual?: BloqueMensual;
  /** `null` si la rutina no se pudo rearmar (el check-in sigue adelante). */
  rutina?: RutinaRearmada | null;
}

function buildComposeInput(
  analysis: Awaited<ReturnType<typeof runCheckinAnalysis>>,
  questions: ReturnType<typeof pickQuestions>,
): ComposeInput {
  const { engineDecision } = analysis;

  return {
    athleteName: analysis.profile.displayName,
    weekLabel: formatLongDate(analysis.checkIn.date),
    phase: engineDecision.phase,
    previousPhase: engineDecision.previousPhase,
    targets: engineDecision.targets,
    category: engineDecision.category,
    rules: engineDecision.rulesFired.map((rule) => ({
      id: rule.id,
      nombre: rule.nombre,
      explicacion: rule.explicacion,
    })),
    engineExplanation: engineDecision.explicacion,
    signals: analysis.signals,
    vision: analysis.vision,
    questions,
    menuRefresh: engineDecision.menuRefresh,
    electrolyteProtocol: engineDecision.electrolyteProtocol,
    injuryTrainingProtocol: engineDecision.injuryTrainingProtocol,
    simplifyMenu: engineDecision.simplifyMenu,
  };
}

function questionContext(
  analysis: Awaited<ReturnType<typeof runCheckinAnalysis>>,
): QuestionContext {
  const { signals, engineDecision, vision } = analysis;

  const waistDown = (signals.cinturaDeltaCm ?? 0) <= -0.5;
  const weightFlat = signals.pesoDeltaKg !== null && Math.abs(signals.pesoDeltaKg) < 0.3;

  return {
    signals,
    category: engineDecision.category,
    inconclusiveWeek: engineDecision.inconclusiveWeek,
    recomposition: waistDown && weightFlat,
    photosDisagreeWithFeeling: vision?.trend === "mejora" && signals.inflamacion >= 3,
  };
}

export async function runCoachy(checkInId: string): Promise<CoachyRunResult> {
  const analysis = await runCheckinAnalysis(checkInId);
  const { user, profile, checkIn } = analysis;

  const questions = pickQuestions(questionContext(analysis), analysis.askedLastWeek);

  await prisma.decision.update({
    where: { id: analysis.decision.id },
    data: { questionIds: questions.map((question) => question.id) },
  });

  // El mensual y la lectura del objetivo van antes de menús y rutina: la
  // rutina lee su énfasis del caché que esta lectura refresca.
  const serie = analysis.history.map(aMedida);
  const esMensual = clasificaMensuales(serie).get(checkIn.id) ?? false;
  const objetivo = await lecturaDelObjetivo(user.id, profile, esMensual);
  const mensual = construyeBloqueMensual({
    serie,
    checkInId: checkIn.id,
    fotos: fotosDe(objetivo),
    cumplimientoDieta: checkIn.dietCompliance,
    cumplimientoEntreno: checkIn.trainingCompliance,
    goal: profile.goal,
  });

  await syncMealPlans(analysis.decision.id, profile, analysis.engineDecision, {
    phaseChanged: analysis.phaseChanged,
    menuSeedChanged: analysis.menuSeedChanged,
    latestWeightKg: analysis.latestWeightKg,
    forceRefresh: esMensual,
  });

  // La rutina se rearma en TODO check-in. Si falla, la decisión y el menú ya
  // quedaron: la semana se vuelve a armar sola al abrir Rutinas.
  const rutina = await rearmaRutina(user.id, profile).catch((error: unknown) => {
    console.error("[coachy] no se pudo rearmar la rutina tras el check-in", checkIn.id, error);
    return null;
  });

  // Escalamiento (Fase 3): avisa al admin, no bloquea. Va aquí y no al final
  // porque debe correr aunque la redacción se caiga — el aviso importa más que
  // el texto. `runEscalationCheck` nunca lanza.
  await runEscalationCheck(user.id);

  if (!hasAnthropicKey()) {
    return {
      decisionId: analysis.decision.id,
      status: "sin_redaccion",
      reason: new MissingAnthropicKeyError().message,
      mensual,
      rutina,
    };
  }

  const input = buildComposeInput(analysis, questions);

  let reply: CoachyReply;
  try {
    const examples = await loadFewShotExamples(user.id);
    reply = { ...(await composeReply(input, { examples })), mensual };
  } catch (error) {
    const reason =
      error instanceof ComposeError ? error.message : `No se pudo redactar: ${String(error)}`;
    return { decisionId: analysis.decision.id, status: "sin_redaccion", reason, mensual, rutina };
  }

  const decision = await prisma.decision.update({
    where: { id: analysis.decision.id },
    data: { replyJson: reply as unknown as Prisma.InputJsonValue },
  });

  await prisma.conversation.create({
    data: {
      userId: user.id,
      role: "COACHY",
      text: replyToText(reply),
      contextJson: {
        decisionId: decision.id,
        checkInId: checkIn.id,
        preguntas: questions.map((question) => ({ id: question.id, text: question.text })),
      } as unknown as Prisma.InputJsonValue,
    },
  });

  // Si no hace falta aprobación, la decisión nació publicada: avísale ya.
  if (decision.status === "APROBADA") {
    await publishNotification(user.id, user.email, reply);
  }

  return { decisionId: decision.id, status: "ok", reply, mensual, rutina };
}

/** Aviso de "ya tienes mensaje de Coachy". También lo usa la aprobación del admin. */
export async function publishNotification(
  userId: string,
  email: string | null,
  reply: CoachyReply,
): Promise<void> {
  await notify({
    userId,
    email,
    kind: "MENSAJE_COACHY",
    title: "Holy Gains ya revisó tu semana",
    body: `${reply.celebracion}\n\n${reply.meta}`,
    href: "/app",
  });
}

/**
 * Cola de reintento: check-ins sin decisión, o con decisión sin texto.
 * La consume `POST /api/coachy/run`.
 */
export async function pendingCheckIns(limit = 10): Promise<string[]> {
  const rows = await prisma.checkIn.findMany({
    where: { OR: [{ decision: null }, { decision: { replyJson: { equals: Prisma.DbNull } } }] },
    orderBy: { date: "desc" },
    take: limit,
    select: { id: true },
  });
  return rows.map((row) => row.id);
}
