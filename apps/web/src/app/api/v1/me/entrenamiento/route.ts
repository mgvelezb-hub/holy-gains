import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";

import { apiUser, unauthorized } from "@/lib/api/auth";
import { materializeMealPlans } from "@/lib/coachy/menu";
import { prisma } from "@/lib/prisma";
import { cargaDisciplinaSchema } from "@/lib/training/cargas-schema";
import { SCHEME_PREFERENCES } from "@/lib/training/schemes";
import { DAY_KIND_VALUES, WEEK_DAYS, normalizeCustomSplit } from "@/lib/training/split";
import { UNILATERAL_MODES } from "@/lib/training/types";
import { TRAINING_TIMES, bloqueDelMotor } from "@/lib/training/horario";
import { DISCIPLINES, MUSCLE_GROUPS, SWIM_LEVELS } from "@/lib/training/types";

/**
 * `PATCH /api/v1/me/entrenamiento` — las preferencias que cambian la rutina.
 *
 * Dos cosas, y las dos mandan de verdad sobre la semana que arma el generador:
 *
 * - **Grupos que no quieres repetir**: se entrenan una vez y los días que los
 *   repetían pasan a trabajar otra cosa. La semana no se encoge.
 * - **Disciplinas activas**: gastan del presupuesto semanal. Agregar natación
 *   dos veces no suma dos sesiones encima — se las quita al gimnasio.
 *
 * Cada disciplina también puede traer `proposito` e `importancia` — lo mismo
 * que se pregunta al rearmar la rutina (`/api/v1/training/replan`) — y el
 * perfil puede traer `timePerDay`, los minutos declarados por día. Guardarlos
 * aquí también es lo que evita preguntar dos veces lo mismo.
 *
 * `compactDays` (Fase 10) también vive aquí y no en el flujo de replanificar:
 * es una preferencia de "cómo armo tu semana", no una respuesta de "cuánto
 * tiempo tengo" — se ajusta un toque en Ajustes, no rehaciendo el
 * cuestionario completo.
 *
 * `schemePreference` fija (o no) el esquema de reps: `RECOMENDADO` (default)
 * deja que `schemeForWeek` siga rotando piramidal → fuerza → metabólico →
 * rango medio semana a semana — la rotación sigue siendo la recomendación
 * porque la periodización ondulante es igual o superior a la lineal para
 * fuerza (Rhea et al. 2002). Ver el docblock de `SCHEME_PREFERENCES` en
 * `schemes.ts` para el sustento de cada mapeo.
 *
 * Aplica desde la siguiente vez que se arme la rutina; la semana en curso ya
 * está publicada y moverla a medio martes solo confunde.
 */

export const dynamic = "force-dynamic";

const schema = z
  .object({
    avoidRepeatGroups: z.array(z.enum(MUSCLE_GROUPS)).max(MUSCLE_GROUPS.length).optional(),
    primaryDiscipline: z.enum(DISCIPLINES).optional(),
    /** Nivel en el agua: ordena volumen y descansos de la sesión de natación. */
    swimLevel: z.enum(SWIM_LEVELS).optional(),
    /**
     * Nivel declarado por disciplina. Se manda el mapa entero: es lo que la
     * pantalla tiene en la mano, y parcharlo llave por llave abriría la puerta
     * a que dos ediciones seguidas se pisen.
     */
    // `partialRecord`, no `record`: en zod 4 un record con llave enum exige
    // TODAS las llaves, y este mapa trae solo las disciplinas que la persona
    // tiene. Con `record`, subir el nivel de pesas devolvía 422 porque
    // "faltaban" crossfit y funcional.
    disciplineLevels: z.partialRecord(z.enum(DISCIPLINES), z.enum(SWIM_LEVELS)).optional(),
    // El schema compartido trae `modo` y las preferencias de cardio: el
    // `z.object` que vivía aquí no los declaraba y zod los tiraba en
    // silencio (H2).
    otherDisciplines: z.array(cargaDisciplinaSchema).max(DISCIPLINES.length).optional(),
    /**
     * Minutos disponibles por día. `null` limpia lo declarado (vuelve a los
     * defaults); omitido deja lo que ya había. 0 = ese día no se entrena.
     */
    timePerDay: z.partialRecord(z.enum(WEEK_DAYS), z.number().int().min(0).max(300)).nullable().optional(),
    /**
     * Combinar disciplinas compatibles el mismo día (`true`) o darle a cada
     * una su propio día (`false`). Ver el docblock de `compactDays` en
     * `schema.prisma` para el porqué del default.
     */
    compactDays: z.boolean().optional(),
    /**
     * Estilo de esquema fijo, o `RECOMENDADO` para que la rotación siga
     * decidiendo. Ver el docblock de `SCHEME_PREFERENCES` en `schemes.ts`.
     */
    schemePreference: z.enum(SCHEME_PREFERENCES).optional(),
    /**
     * El split fijado a mano, día por día: `{"LUN": "PIERNA_CUADRICEPS",
     * "MAR": "DESCANSO"}`. `null` lo limpia y devuelve la decisión al motor.
     * Se manda el mapa entero, igual que `disciplineLevels`: parcharlo día
     * por día abriría la puerta a que dos ediciones seguidas se pisen.
     */
    customSplit: z
      .partialRecord(z.enum(WEEK_DAYS), z.enum([...DAY_KIND_VALUES, "DESCANSO"]))
      .nullable()
      .optional(),
    /**
     * Los ejercicios elegidos a mano por tipo de día: `{"PECHO_TRICEP":
     * ["id1", "id2"]}`. `null` vuelve entero a la sugerencia de Coachy; un
     * día con lista vacía vuelve a la sugerencia solo en ese día. Se manda el
     * mapa completo, igual que `customSplit`.
     */
    manualExercises: z
      .partialRecord(z.enum(DAY_KIND_VALUES), z.array(z.string().min(1)).max(12))
      .nullable()
      .optional(),
    /**
     * Cómo se hacen los unilaterales: `SEGUIDO` (todas las del derecho y
     * luego las del izquierdo) o `ALTERNADO`. Se guarda DENTRO de
     * `custom_split` porque no hay columna y el schema está congelado en esta
     * fase — ver `parseUnilateralMode` en `training/db.ts`.
     */
    unilateralMode: z.enum(UNILATERAL_MODES).optional(),
    /**
     * A qué hora entrena, parejo toda la semana.
     *
     * Cambia la ESTRUCTURA de las comidas, no solo una etiqueta: quien
     * entrena en la mañana desayuna antes de entrenar y come fuerte después;
     * quien entrena de noche desayuna bajo en carbohidratos y se los guarda
     * para la tarde. Por eso, al cambiarlo, el menú se vuelve a armar.
     */
    trainingTime: z.enum(TRAINING_TIMES).optional(),
    /**
     * Horario por día, para quien no entrena a la misma hora toda la semana:
     * `{ "LUN": "MANANA", "MAR": "NOCHE", "MIE": "DESCANSO" }`. `null` lo
     * limpia y vuelve a mandar el horario parejo.
     */
    trainingSchedule: z
      .partialRecord(z.enum(WEEK_DAYS), z.enum([...TRAINING_TIMES, "DESCANSO"]))
      .nullable()
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "no hay nada que guardar" })
  .refine(
    (value) =>
      value.otherDisciplines === undefined ||
      new Set(value.otherDisciplines.map((load) => load.discipline)).size ===
        value.otherDisciplines.length,
    { message: "una disciplina repetida contaría doble en el presupuesto" },
  );

export async function PATCH(request: Request): Promise<NextResponse> {
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
    return NextResponse.json(
      { error: "preferencias inválidas", detalles: parsed.error.issues.slice(0, 3) },
      { status: 422 },
    );
  }

  const {
    avoidRepeatGroups,
    primaryDiscipline,
    otherDisciplines,
    swimLevel,
    disciplineLevels,
    timePerDay,
    compactDays,
    schemePreference,
    customSplit,
    manualExercises,
    unilateralMode,
    trainingTime,
    trainingSchedule,
  } = parsed.data;

  // La primaria no puede estar además en la lista de secundarias: se cobraría
  // dos veces del mismo presupuesto.
  const primary = primaryDiscipline ?? user.profile.primaryDiscipline;
  const others = otherDisciplines?.filter((load) => load.discipline !== primary);

  // El split y el modo unilateral comparten columna: se escriben juntos o el
  // que llega solo pisaría al otro. `null` en `customSplit` limpia los días
  // pero conserva la preferencia de lados, que no es parte del split.
  const splitGuardado = construyeSplitGuardado(
    user.profile.customSplit,
    customSplit,
    unilateralMode,
  );

  const profile = await prisma.profile.update({
    where: { userId: user.id },
    data: {
      ...(avoidRepeatGroups !== undefined ? { avoidRepeatGroups } : {}),
      ...(primaryDiscipline !== undefined ? { primaryDiscipline } : {}),
      ...(others !== undefined ? { otherDisciplines: others } : {}),
      ...(swimLevel !== undefined ? { swimLevel } : {}),
      ...(disciplineLevels !== undefined ? { disciplineLevels } : {}),
      // `null` limpia la columna: Prisma exige `Prisma.JsonNull` explícito
      // para no confundirlo con "no tocar este campo".
      ...(timePerDay !== undefined ? { timePerDay: timePerDay ?? Prisma.JsonNull } : {}),
      ...(compactDays !== undefined ? { compactDays } : {}),
      ...(schemePreference !== undefined ? { schemePreference } : {}),
      ...(splitGuardado === undefined ? {} : { customSplit: splitGuardado }),
      // `null` limpia la columna y devuelve todos los días a la sugerencia de
      // Coachy; Prisma exige `JsonNull` para no leerlo como "no tocar".
      ...(manualExercises !== undefined
        ? { manualExercises: manualExercises ?? Prisma.JsonNull }
        : {}),
      ...(trainingTime !== undefined ? { trainingTime } : {}),
      ...(trainingSchedule !== undefined
        ? { trainingSchedule: trainingSchedule ?? Prisma.JsonNull }
        : {}),
    },
    select: {
      avoidRepeatGroups: true,
      primaryDiscipline: true,
      otherDisciplines: true,
      swimLevel: true,
      disciplineLevels: true,
      timePerDay: true,
      compactDays: true,
      schemePreference: true,
      customSplit: true,
      manualExercises: true,
      trainingTime: true,
      trainingSchedule: true,
    },
  });

  // Cambiar la hora de entrenar no es cambiar una etiqueta: mueve el reparto
  // de carbohidratos del día completo (quien entrena de noche desayuna bajo
  // en carbos y se los guarda para la tarde). Si el cambio cruza de mañana a
  // tarde —o al revés— el menú se rearma con la MISMA semilla, así que los
  // alimentos siguen siendo reconocibles y lo que cambia es la estructura.
  let menuRearmado = false;
  if (trainingTime !== undefined && bloqueDelMotor(trainingTime) !== bloqueDelMotor(user.profile.trainingTime)) {
    try {
      const decision = await prisma.decision.findFirst({
        where: { userId: user.id, status: { in: ["APROBADA", "CORREGIDA"] } },
        orderBy: { createdAt: "desc" },
        include: { checkIn: { select: { date: true } } },
      });

      if (decision) {
        const completo = await prisma.profile.findUniqueOrThrow({ where: { userId: user.id } });
        await materializeMealPlans(decision, completo, { overwrite: true });
        menuRearmado = true;
      }
    } catch (error) {
      // El horario SÍ se guardó; lo que falló es rearmar el menú. Se dice en
      // la respuesta en vez de fingir que todo salió bien: el menú viejo
      // sigue siendo comestible, solo que con la estructura anterior.
      console.error("[coachy] no se pudo rearmar el menú tras cambiar el horario", error);
    }
  }

  return NextResponse.json({ ...profile, menuRearmado });
}

/**
 * El JSON de `custom_split` que hay que guardar, o `undefined` si esta
 * petición no lo toca.
 *
 * Los días y el modo de los unilaterales viven en la MISMA columna (no hay
 * otra, y el schema está congelado en esta fase), así que escribir uno sin
 * leer el otro lo borraría. `Prisma.JsonNull` es la única forma de limpiar la
 * columna sin que Prisma lo confunda con "no tocar este campo".
 */
function construyeSplitGuardado(
  actual: unknown,
  dias: Record<string, string> | null | undefined,
  unilateral: string | undefined,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (dias === undefined && unilateral === undefined) return undefined;

  const modo =
    unilateral ?? (actual !== null && typeof actual === "object" && !Array.isArray(actual)
      ? ((actual as Record<string, unknown>)._unilateral as string | undefined)
      : undefined);

  const base = dias === undefined ? (normalizeCustomSplit(actual) ?? {}) : (dias ?? {});
  const guardado: Record<string, string> = { ...base };
  if (modo !== undefined) guardado._unilateral = modo;

  return Object.keys(guardado).length === 0 ? Prisma.JsonNull : guardado;
}
