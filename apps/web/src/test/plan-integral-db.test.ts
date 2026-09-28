import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * I1 — la semana de Mau de punta a punta, contra la base local.
 *
 * Reproduce el caso real del 29-sep: primaria Gimnasio, cinco días L–V con
 * 90 min, sábado y domingo en 0, cardio "lo entreno", y un split propio de
 * seis días (el preset 3 inferior / 3 superior, LUN–SÁB) que ya traía en el
 * perfil. Se recorre con los handlers reales —replantear, Ajustes, la semana
 * (Rutinas / Ajustes "Tu semana" / Resumen) y Hoy— y se compara lo que dice
 * cada superficie contra la semana materializada (`Workout`s).
 *
 * La regla que prueba: TODAS las superficies cuentan la misma semana. Un día
 * con 0 min nunca tiene gimnasio, cada día declarado con tiempo sí, el cardio
 * va pegado después de pesas y le quita sus minutos al gym (90 − 20 = 70), y
 * lo que dice el replanteo es lo que queda guardado.
 *
 * Solo se mockea `apiUser` (valida el JWT contra Supabase por red); lo demás
 * corre de verdad, igual que `onboarding-route-db.test.ts`.
 */
vi.mock("@/lib/api/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/auth")>("@/lib/api/auth");
  return {
    ...actual,
    apiUser: vi.fn(async (request: Request) => {
      const userId = request.headers.get("x-test-user-id");
      if (!userId) return null;
      const { prisma } = await import("@/lib/prisma");
      return prisma.user.findUnique({ where: { id: userId }, include: { profile: true } });
    }),
  };
});

const replanRoute = await import("@/app/api/v1/training/replan/route");
const weekRoute = await import("@/app/api/v1/training/week/route");
const todayRoute = await import("@/app/api/v1/training/today/route");
const ajustesRoute = await import("@/app/api/v1/me/entrenamiento/route");
const { prisma } = await import("@/lib/prisma");
const { presetSplit } = await import("@/lib/training/split");
const { mondayOf } = await import("@/lib/training/generate");
const { parseStoredPlan } = await import("@/lib/training/db");
const { isoFromDateColumn, shiftISODate, toISODate } = await import("@/lib/format");
const { trimSession } = await import("@/lib/training/trim");
const { rearmaRutina } = await import("@/lib/coachy/plan-tras-checkin");
const { planDeSemana } = await import("@/lib/training/plan");
const { ensureWeekMaterialized } = await import("@/lib/training/db");

async function databaseReachable(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  try {
    await prisma.$queryRaw`select 1`;
    return true;
  } catch {
    return false;
  }
}

const available = await databaseReachable();

// Recorre la app completa contra la base: con otros procesos en la máquina
// los 5 s de default no alcanzan.
vi.setConfig({ testTimeout: 60_000 });

const DIAS = ["LUN", "MAR", "MIE", "JUE", "VIE", "SAB", "DOM"] as const;
type Dia = (typeof DIAS)[number];

function peticion(userId: string, url: string, method: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user-id": userId },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Lo que cada superficie dice de un día: "Pierna · cuádriceps · 6 ej + Cardio 20". */
type Tabla = Record<string, Partial<Record<Dia, string>>>;

type Semana = {
  weekStart: string;
  today: string;
  sessions: Array<{ date: string; muscleGroup: string; exercises: unknown[]; estimatedMin: number | null }>;
  otherSessions: Array<{ date: string; discipline: string; minutes: number }>;
  plan?: Array<{
    date: string;
    weekday: Dia;
    gym: { muscleGroup: string; ejercicios: number; minutos: number } | null;
    bloques: Array<{ discipline: string; minutes: number }>;
  }>;
  avisos: string[];
};

function diaDe(weekStart: string, date: string): Dia {
  const index = DIAS.findIndex((_, i) => shiftISODate(weekStart, i) === date);
  return DIAS[index]!;
}

function linea(gym: { muscleGroup: string; n: number } | null, otras: Array<{ discipline: string; minutes: number }>): string {
  const partes = [
    ...(gym ? [`${gym.muscleGroup} · ${gym.n} ej`] : []),
    ...otras.map((otra) => `+ ${otra.discipline} ${otra.minutes}`),
  ];
  return partes.join(" ");
}

/** Las superficies tal como las pinta la app hoy, leídas de la semana. */
function superficiesDeSemana(semana: Semana, tabla: Tabla, sufijo: string): void {
  // Rutinas y Ajustes "Tu semana": gym + otros bloques del día.
  const rutinas: Partial<Record<Dia, string>> = {};
  for (let i = 0; i < 7; i += 1) {
    const date = shiftISODate(semana.weekStart, i);
    const gym = semana.sessions.find((s) => s.date === date);
    const otras = semana.otherSessions.filter((o) => o.date === date);
    const texto = linea(gym ? { muscleGroup: gym.muscleGroup, n: gym.exercises.length } : null, otras);
    if (texto) rutinas[DIAS[i]!] = texto;
  }
  tabla[`Rutinas / Ajustes${sufijo}`] = rutinas;

  // Resumen (panel "Esta semana"): lo que lee de la semana. Con `plan`
  // canónico, lo lee de ahí; sin él, solo `sessions` (sin cardio).
  const resumen: Partial<Record<Dia, string>> = {};
  if (semana.plan) {
    for (const dia of semana.plan) {
      const texto = linea(dia.gym ? { muscleGroup: dia.gym.muscleGroup, n: dia.gym.ejercicios } : null, dia.bloques);
      if (texto) resumen[dia.weekday] = texto;
    }
  } else {
    for (const sesion of semana.sessions) {
      resumen[diaDe(semana.weekStart, sesion.date)] = `${sesion.muscleGroup} · ${sesion.exercises.length} ej`;
    }
  }
  tabla[`Resumen${sufijo}`] = resumen;
}

function imprime(titulo: string, tabla: Tabla): void {
  const filas = Object.entries(tabla).map(
    ([superficie, dias]) =>
      `| ${superficie} | ${DIAS.map((dia) => dias[dia] ?? "—").join(" | ")} |`,
  );
  console.log(
    [`\n### ${titulo}`, `| Superficie | ${DIAS.join(" | ")} |`, `|---|${DIAS.map(() => "---").join("|")}|`, ...filas].join(
      "\n",
    ),
  );
}

describe.skipIf(!available)("I1 — una sola semana en toda la app (perfil clon de Mau)", () => {
  const userId = randomUUID();
  const hoy = new Date();
  hoy.setHours(12, 0, 0, 0);
  const lunes = toISODate(mondayOf(hoy));

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email: `test-i1-${userId}@coachy.invalid`, role: "ATHLETE" },
    });
    await prisma.profile.create({
      data: {
        userId,
        displayName: "Clon de Mau",
        sex: "MALE",
        birthDate: new Date("1988-03-10T12:00:00Z"),
        heightCm: "182.0",
        weightKg: "120.0",
        goal: "PERDIDA_GRASA",
        currentPhase: "CUT",
        liftingDays: 6,
        sessionMinutes: 90,
        mealsPerDay: 4,
        trainingTime: "MANANA",
        primaryDiscipline: "PESAS",
        // Lo que ya traía: el preset 3/3 guardado como split propio (LUN–SÁB).
        customSplit: presetSplit("INFERIOR_SUPERIOR_3_3", 6),
        onboardingCompletedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("replantear → Ajustes → Rutinas / Resumen / Hoy / Workouts cuentan la misma semana", async () => {
    const tabla: Tabla = {};

    // 1. "Empezar de cero": 5 días L–V a 90 min, S–D en 0, cardio "lo entreno".
    const respuestas = {
      tiempo: { LUN: 90, MAR: 90, MIE: 90, JUE: 90, VIE: 90, SAB: 0, DOM: 0 },
      primaria: "PESAS",
      sesionesPrimaria: 5,
      secundarias: [{ discipline: "CARDIO", proposito: "ENTRENAMIENTO", importancia: 2 }],
    };

    // La vista previa no escribe nada: el perfil sigue en 6 días.
    const previa = await replanRoute.POST(
      peticion(userId, "/api/v1/training/replan?preview=1", "POST", respuestas),
    );
    const cuerpoPrevia = (await previa.json()) as { semana?: Semana["plan"]; avisos: string[] };
    const sinTocar = await prisma.profile.findUniqueOrThrow({ where: { userId } });

    const replan = await replanRoute.POST(peticion(userId, "/api/v1/training/replan", "POST", respuestas));
    expect(replan.status).toBe(200);
    const cuerpo = (await replan.json()) as {
      asignadas: Array<{ weekday: Dia; discipline: string; minutos: number }>;
      avisos: string[];
      semana?: Semana["plan"];
    };

    const replanFila: Partial<Record<Dia, string>> = {};
    for (const dia of DIAS) {
      const del = cuerpo.asignadas.filter((a) => a.weekday === dia);
      if (del.length) replanFila[dia] = del.map((a) => `${a.discipline} ${a.minutos}`).join(" + ");
    }
    tabla["Replantear (asignadas)"] = replanFila;
    if (cuerpo.semana) {
      const fila: Partial<Record<Dia, string>> = {};
      for (const dia of cuerpo.semana) {
        const texto = linea(dia.gym ? { muscleGroup: dia.gym.muscleGroup, n: dia.gym.ejercicios } : null, dia.bloques);
        if (texto) fila[dia.weekday] = texto;
      }
      tabla["Replantear (semana)"] = fila;
    }

    // 2. Rutinas / Ajustes "Tu semana" / Resumen: `GET /training/week`.
    const semana = (await (await weekRoute.GET(peticion(userId, "/api/v1/training/week", "GET"))).json()) as Semana;
    superficiesDeSemana(semana, tabla, "");

    // 3. Hoy.
    const hoyResp = (await (await todayRoute.GET(peticion(userId, "/api/v1/training/today", "GET"))).json()) as {
      today: { muscleGroup: string; exerciseCount: number } | null;
      otherSession: { discipline: string; minutes: number } | null;
    };
    const diaHoy = diaDe(lunes, toISODate(hoy));
    tabla["Hoy"] = {
      [diaHoy]: linea(
        hoyResp.today ? { muscleGroup: hoyResp.today.muscleGroup, n: hoyResp.today.exerciseCount } : null,
        hoyResp.otherSession ? [hoyResp.otherSession] : [],
      ) || "Descanso",
    };

    // 4. La semana materializada, fila por fila.
    const workouts = await prisma.workout.findMany({ where: { userId }, orderBy: { date: "asc" } });
    const materializada: Partial<Record<Dia, string>> = {};
    for (const workout of workouts) {
      const date = isoFromDateColumn(workout.date);
      if (date < lunes || date > shiftISODate(lunes, 6)) continue;
      const plan = parseStoredPlan(workout.exercisesJson);
      materializada[diaDe(lunes, date)] = `${workout.muscleGroup} · ${plan.exercises.length} ej · ${plan.estimatedMin ?? "?"} min`;
    }
    tabla["Workouts (DB)"] = materializada;

    imprime("Superficie → días → contenido", tabla);
    console.log("avisos replan:", cuerpo.avisos, "\navisos semana:", semana.avisos);

    // --- Lo que tiene que ser verdad -------------------------------------
    const LV: Dia[] = ["LUN", "MAR", "MIE", "JUE", "VIE"];
    const fechasGym = semana.sessions.map((s) => diaDe(semana.weekStart, s.date));

    // La vista previa no escribió y dijo lo mismo que el guardado.
    expect(sinTocar.liftingDays).toBe(6);
    expect(cuerpoPrevia.semana?.map((d) => [d.weekday, d.gym?.muscleGroup ?? null])).toEqual(
      cuerpo.semana?.map((d) => [d.weekday, d.gym?.muscleGroup ?? null]),
    );

    // Un día con 0 min nunca tiene gym; cada día declarado con tiempo sí.
    expect(fechasGym).toEqual(LV);
    expect(Object.keys(materializada)).toEqual(LV);

    // El cardio "lo entreno" no se pierde: va después de pesas, L–V, sin
    // mandar a la persona a Ajustes.
    for (const dia of LV) {
      const fecha = shiftISODate(semana.weekStart, DIAS.indexOf(dia));
      expect(semana.otherSessions.some((o) => o.date === fecha && o.discipline === "CARDIO")).toBe(true);
    }
    expect(cuerpo.avisos.some((aviso) => aviso.includes("Ajustes"))).toBe(false);
    expect(cuerpo.asignadas.filter((a) => a.discipline === "CARDIO").map((a) => a.weekday)).toEqual(LV);

    // Los minutos de pesas son los reales (90 − 20 = 70): menos de 8 ejercicios.
    for (const sesion of semana.sessions) {
      expect(sesion.exercises.length).toBeLessThanOrEqual(7);
      expect(sesion.estimatedMin ?? 0).toBeLessThanOrEqual(75);
    }

    // Todas las superficies dicen lo mismo, día por día.
    expect(tabla["Resumen"]).toEqual(tabla["Rutinas / Ajustes"]);
    expect(tabla["Replantear (semana)"]).toEqual(tabla["Rutinas / Ajustes"]);
    expect(tabla["Hoy"]![diaHoy]).toBe(tabla["Rutinas / Ajustes"]![diaHoy] ?? "Descanso");

    // 5. Y si luego lo marca a mano en Ajustes, nada se queda atrás: la
    // semana materializada se rearma con el cardio descontado.
    const ajustes = await ajustesRoute.PATCH(
      peticion(userId, "/api/v1/me/entrenamiento", "PATCH", {
        otherDisciplines: [{ discipline: "CARDIO", sessionsPerWeek: 5, modo: "DESPUES", cardio: { minutos: 25 } }],
      }),
    );
    expect(ajustes.status).toBe(200);
    const despues = (await (await weekRoute.GET(peticion(userId, "/api/v1/training/week", "GET"))).json()) as Semana;
    const tablaDespues: Tabla = {};
    superficiesDeSemana(despues, tablaDespues, " (tras Ajustes)");
    imprime("Tras marcar cardio 25 min en Ajustes", tablaDespues);

    expect(despues.sessions.map((s) => diaDe(despues.weekStart, s.date))).toEqual(LV);
    for (const sesion of despues.sessions) {
      expect(sesion.estimatedMin ?? 0).toBeLessThanOrEqual(70);
    }
    expect(tablaDespues["Resumen (tras Ajustes)"]).toEqual(tablaDespues["Rutinas / Ajustes (tras Ajustes)"]);
  });
  it("'hoy tengo menos tiempo' recorta de verdad, y la semana lo sigue diciendo después", async () => {
    const perfil = await prisma.profile.findUniqueOrThrow({ where: { userId } });
    const semana = await ensureWeekMaterialized(userId, perfil, hoy);
    const deHoy = semana.find((w) => isoFromDateColumn(w.date) === toISODate(hoy))!;
    const antes = parseStoredPlan(deHoy.exercisesJson).exercises.length;
    expect(antes).toBeGreaterThanOrEqual(5);

    const recorte = await trimSession(userId, perfil, deHoy.id, 40);
    expect(recorte.exercises).toBeLessThanOrEqual(4);

    // Lo que abre la sesión en vivo: la semana vuelve a pedirse al servidor.
    // Antes el recorte se escribía sin calentamiento y esta llamada lo leía
    // como plan viejo y lo rearmaba completo — "no recortaba".
    const vista = (await (await weekRoute.GET(peticion(userId, "/api/v1/training/week", "GET"))).json()) as Omit<
      Semana,
      "sessions"
    > & {
      sessions: Array<Semana["sessions"][number] & { workoutId: string; trimmedMinutes: number | null }>;
    };
    const sesion = vista.sessions.find((s) => s.date === toISODate(hoy))!;
    expect(sesion.workoutId).toBe(deHoy.id);
    expect(sesion.trimmedMinutes).toBe(40);
    expect(sesion.exercises).toHaveLength(recorte.exercises);
    expect(vista.plan?.find((d) => d.date === toISODate(hoy))?.gym?.ejercicios).toBe(recorte.exercises);
  });

  it("con la serie de aproximación ya capturada, recorta solo lo pendiente (sin error)", async () => {
    const perfil = await prisma.profile.findUniqueOrThrow({ where: { userId } });
    const semana = await ensureWeekMaterialized(userId, perfil, hoy);
    const manana = semana.find((w) => isoFromDateColumn(w.date) === shiftISODate(toISODate(hoy), 1))!;
    const plan = parseStoredPlan(manana.exercisesJson);
    const primero = plan.exercises[0]!;

    await prisma.workoutSet.create({
      data: {
        workoutId: manana.id,
        clientId: `${manana.id}:0:0`,
        exerciseId: primero.exerciseId,
        exerciseName: primero.name,
        setIndex: 0,
        targetReps: 12,
        reps: 12,
        weightKg: "20",
        warmup: true,
        performedAt: new Date(),
      },
    });

    const recorte = await trimSession(userId, perfil, manana.id, 40);
    const guardado = parseStoredPlan(
      (await prisma.workout.findUniqueOrThrow({ where: { id: manana.id } })).exercisesJson,
    );
    expect(guardado.exercises[0]!.name).toBe(primero.name);
    expect(recorte.exercises).toBeLessThan(plan.exercises.length);
    expect(recorte.exercises).toBeLessThanOrEqual(4);
  });

  it("tras el check-in, la rutina sale de planDeSemana: fase, manuales y cardio entran por el mismo lugar", async () => {
    const viejo = await prisma.profile.findUniqueOrThrow({ where: { userId } });
    // Lo que el check-in y Ajustes pudieron mover: la fase (corte agresivo
    // recorta volumen) y un ejercicio elegido a mano para un tipo de día.
    const semana = await ensureWeekMaterialized(userId, viejo, hoy);
    const libre = semana.find((w) => isoFromDateColumn(w.date) > shiftISODate(toISODate(hoy), 1))!;
    const tipo = parseStoredPlan(libre.exercisesJson).dayKind;
    const catalogo = await prisma.exercise.findMany({ select: { id: true, name: true } });
    const elegido = catalogo.find((e) => !parseStoredPlan(libre.exercisesJson).exercises.some((x) => x.exerciseId === e.id))!;
    await prisma.profile.update({
      where: { userId },
      data: { currentPhase: "CUT_AGRESIVO", manualExercises: { [tipo]: [elegido.id] } },
    });

    // Se le pasa el perfil de ANTES, como hace el cierre del check-in.
    await rearmaRutina(userId, viejo);

    const plan = await planDeSemana(userId, hoy);
    const filas = await prisma.workout.findMany({ where: { userId }, orderBy: { date: "asc" } });
    const futuras = filas.filter(
      (w) => isoFromDateColumn(w.date) > shiftISODate(toISODate(hoy), 1) && isoFromDateColumn(w.date) <= shiftISODate(lunes, 6),
    );
    expect(futuras.length).toBeGreaterThan(0);
    for (const fila of futuras) {
      const dia = plan.dias.find((d) => d.date === isoFromDateColumn(fila.date))!;
      const guardado = parseStoredPlan(fila.exercisesJson);
      expect(dia.gym?.dayKind).toBe(guardado.dayKind);
      expect(dia.gym?.ejercicios).toBe(guardado.exercises.length);
      expect(dia.linea).toContain("+ Cardio");
      if (guardado.dayKind === tipo) expect(guardado.exercises[0]!.exerciseId).toBe(elegido.id);
    }
  });
  it("las alternativas de la semana excluyen por id lo que ya está en la sesión", async () => {
    const perfil = await prisma.profile.findUniqueOrThrow({ where: { userId } });
    const semana = await ensureWeekMaterialized(userId, perfil, hoy);
    // Mañana tiene una serie capturada: no se rearma y su plan guardado manda.
    const manana = semana.find((w) => isoFromDateColumn(w.date) === shiftISODate(toISODate(hoy), 1))!;

    const antes = (await (await weekRoute.GET(peticion(userId, "/api/v1/training/week", "GET"))).json()) as {
      sessions: Array<{ date: string; exercises: Array<{ name: string; alternatives: Array<{ exerciseId: string; name: string }> }> }>;
    };
    const sesion = antes.sessions.find((s) => s.date === isoFromDateColumn(manana.date))!;
    const conAlternativa = sesion.exercises.find((e) => e.alternatives.length > 0)!;
    const ocupada = conAlternativa.alternatives[0]!;

    // Esa alternativa ya está en la sesión, guardada con OTRO nombre que el
    // del catálogo (así quedan las filas viejas o renombradas).
    const guardado = parseStoredPlan(manana.exercisesJson);
    const copia = { ...guardado.exercises[guardado.exercises.length - 1]!, exerciseId: ocupada.exerciseId, name: "Nombre guardado distinto" };
    await prisma.workout.update({
      where: { id: manana.id },
      data: {
        exercisesJson: { ...(manana.exercisesJson as Record<string, unknown>), exercises: [...guardado.exercises, copia] } as never,
      },
    });

    const despues = (await (await weekRoute.GET(peticion(userId, "/api/v1/training/week", "GET"))).json()) as typeof antes;
    const misma = despues.sessions
      .find((s) => s.date === isoFromDateColumn(manana.date))!
      .exercises.find((e) => e.name === conAlternativa.name)!;
    expect(misma.alternatives.map((a) => a.exerciseId)).not.toContain(ocupada.exerciseId);
  });
});
