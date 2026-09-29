import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * K1 — la nutrición de Mau de punta a punta, contra la base local.
 *
 * Perfil clon: hombre de 38, 182 cm, 120 kg, en CUT, cuatro comidas, entrena
 * de mañana, presupuesto medio, leche descremada, despensa de ocho alimentos
 * (yogur griego incluido), un alimento propio, todas las preparaciones
 * prendidas, creatina + omega-3 + magnesio aceptado, horarios propios con el
 * sábado distinto, y una química con glucosa en 100 mg/dL y vitamina D en 24.
 *
 * Se recorre con los handlers reales —replantear, regenerar, Nutrición,
 * suplementos, horarios, check-in— y cada pieza se busca en cada superficie.
 * La regla que prueba: todo lo que se construyó por partes entra por el mismo
 * lugar (`planDeNutricion`) y se nota en todas las pantallas.
 *
 * Solo se mockea `apiUser` (valida el JWT contra Supabase por red).
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

const replanRoute = await import("@/app/api/v1/nutricion/replan/route");
const regenerarRoute = await import("@/app/api/v1/nutricion/regenerar-menu/route");
const nutritionRoute = await import("@/app/api/v1/nutrition/route");
const suplementosRoute = await import("@/app/api/v1/suplementos/route");
const horariosRoute = await import("@/app/api/v1/me/horarios-comida/route");
const { prisma } = await import("@/lib/prisma");
const { persistCheckIn } = await import("@/lib/checkin-write");
const { runCoachy } = await import("@/lib/coachy");
const { checkInSchema } = await import("@/lib/validation/checkin");
const { shiftISODate, toISODate } = await import("@/lib/format");
const { DEFAULT_CONFIG, FOODS } = await import("engine");

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

function peticion(userId: string, url: string, method: string, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", "x-test-user-id": userId },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function json<T>(respuesta: Response | Promise<Response>): Promise<T> {
  return (await (await respuesta).json()) as T;
}

type Item = { name: string; grams: number; display: string | null; foodId?: string };
type Comida = { slot: string; label: string; timeHint: string; items: Item[]; preparacion?: { nombre: string } };
type Menu = { menuNumber: number; meals: Comida[] };
type Compra = { name: string; enDespensa?: boolean };
type Toma = { supplement: string; slot: string | null; corto: string; cuando: string };
type Aviso = { id: string; texto: string };
type Nutrition = {
  decision: { id: string; phase: string; kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG?: number } | null;
  menus: Menu[];
  groceries: Compra[];
  horarios?: Record<string, string>;
  // Del plan canónico (K1). Hoy no existen: la tabla los marca "—".
  porque?: string;
  estilo?: { nombre: string };
  avisos?: Aviso[];
  tomas?: Toma[];
  horariosPorDia?: Record<string, Record<string, string>>;
  recordatorios?: Array<{ slot: string; cuerpo: string; horaPorDia: Record<string, string> }>;
  despensa?: { enCasa: number; total: number };
};
type Suplementos = { tomas: Toma[]; sugerencias: Array<{ supplement: string }>; freno: string | null };

/** El "Prepárate" tal como lo arma `apps/mobile/src/lib/recordatorio.ts` (`cuerpoPreparate`). */
function cuerpoPreparate(items: Item[], extras: string[]): string {
  const menu = items.slice(0, 4).map((item) => item.display ?? item.name).join(", ") || "Ya casi es hora de tu comida.";
  return extras.length === 0 ? menu : `${menu} + ${extras.join(" + ")}`;
}

const PANTRY = [
  "yogur_griego_0",
  "pechuga_pollo",
  "huevo_entero",
  "avena",
  "arroz_integral",
  "frijol_negro",
  "aguacate",
  "manzana",
];

const GI = new Map(FOODS.map((food) => [food.id, food.gi ?? null]));
const ID_POR_NOMBRE = new Map(FOODS.map((food) => [food.name, food.id]));

/** La vista del menú no trae el id del catálogo: se reconoce por nombre. */
function idDe(item: Item): string {
  return item.foodId ?? ID_POR_NOMBRE.get(item.name) ?? "";
}
const ROL = new Map(FOODS.map((food) => [food.id, food.role]));

function todosLosItems(menus: Menu[]): Item[] {
  return menus.flatMap((menu) => menu.meals.flatMap((meal) => meal.items));
}

/** Carbohidratos densos con IG por encima del tope de glucosa alta. */
function carbosAltoIG(menus: Menu[]): string[] {
  return todosLosItems(menus)
    .filter((item) => {
      const id = idDe(item);
      const rol = ROL.get(id);
      const gi = GI.get(id);
      return (rol === "carbo_pre" || rol === "carbo_post" || rol === "carbo_complejo") &&
        typeof gi === "number" && gi > DEFAULT_CONFIG.lowGiMax;
    })
    .map((item) => item.name);
}

type Fila = Record<string, string>;
const SUPERFICIES = [
  "Nutrición (tarjetas)",
  "/plan-nutricion",
  "/menu/1",
  "/menu/2",
  "Lista de súper",
  "Mis comidas hoy",
  "Tomas del día",
  "Recordatorios",
  "Decisión tras check-in",
] as const;

function imprime(titulo: string, tabla: Record<string, Fila>): void {
  const filas = Object.entries(tabla).map(
    ([pieza, fila]) => `| ${pieza} | ${SUPERFICIES.map((s) => fila[s] ?? "—").join(" | ")} |`,
  );
  console.log(
    [`\n### ${titulo}`, `| Pieza | ${SUPERFICIES.join(" | ")} |`, `|---|${SUPERFICIES.map(() => "---").join("|")}|`, ...filas].join("\n"),
  );
}

function checkIn(date: string, weightKg: number, waistCm: number) {
  return checkInSchema.parse({
    date,
    waistCm,
    weightKg,
    inflammation: 2,
    energy: 3,
    hunger: 3,
    satiety: 3,
    sleep: 3,
    strengthRpe: 8,
    strengthTrend: "IGUAL",
    dietCompliance: 90,
    trainingCompliance: 100,
    symptoms: [],
    comment: "",
  });
}

describe.skipIf(!available)("K1 — nutrición integral (perfil clon de Mau)", () => {
  const userId = randomUUID();
  const hoy = toISODate(new Date());
  let slots: string[] = [];

  beforeAll(async () => {
    delete process.env.ANTHROPIC_API_KEY;

    await prisma.user.create({
      data: { id: userId, email: `test-k1-${userId}@coachy.invalid`, role: "ATHLETE" },
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
        liftingDays: 5,
        sessionMinutes: 90,
        mealsPerDay: 4,
        trainingTime: "MANANA",
        budget: "MEDIO",
        dietStyle: "ESTANDAR",
        maxPrepMin: 20,
        // Leche descremada: el valor de siempre, sin marca. Preparaciones
        // todas prendidas: sin marcas `licuados`/`sopas`/`cremas`.
        excludedFoods: [],
        favoriteFoods: ["tortilla de nopal casera"],
        supplements: ["CREATINA", "OMEGA3", "MAGNESIO"],
        supplementChoices: { MAGNESIO: { eleccion: "acepto", fecha: shiftISODate(hoy, -10) } },
        allergies: [],
        conditions: [],
        pantry: PANTRY,
        onboardingCompletedAt: new Date(),
      },
    });
    await prisma.customFood.create({
      data: {
        userId,
        name: "Tortilla de nopal casera",
        role: "carbo_complejo",
        proteinPer100: "3.0",
        carbPer100: "14.0",
        fatPer100: "1.0",
        fiberPer100: "5.0",
        servingUnit: "pieza",
        gramsPerUnit: "30",
        minUnits: "1",
        maxUnits: "4",
        tags: [],
      },
    });
    await prisma.labResult.create({
      data: {
        userId,
        kind: "QUIMICA",
        takenOn: new Date(`${shiftISODate(hoy, -12)}T12:00:00Z`),
        valuesJson: [
          { key: "glucosa", label: "Glucosa en ayuno", value: 100, unit: "mg/dL", refLow: 70, refHigh: 100 },
          { key: "vitamina_d", label: "Vitamina D 25-OH", value: 24, unit: "ng/mL", refLow: 30, refHigh: 100 },
        ],
      },
    });

    // El punto de partida: un primer check-in con su decisión y sus menús,
    // como quien ya usa la app.
    const inicial = await persistCheckIn(userId, checkIn(shiftISODate(hoy, -7), 120, 118));
    await runCoachy(inicial.id);

    const nutricion = await json<Nutrition>(nutritionRoute.GET(peticion(userId, "/api/v1/nutrition", "GET")));
    slots = nutricion.menus[0]?.meals.map((meal) => meal.slot) ?? [];
  }, 60_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("replantear desde cero → cada pieza llega a cada superficie", async () => {
    expect(slots.length).toBe(4);
    const [primero] = slots as [string];

    // Horarios propios: general y un sábado distinto (con los candados reales).
    const general = await horariosRoute.PUT(
      peticion(userId, "/api/v1/me/horarios-comida", "PUT", { horarios: { [primero]: "06:30" } }),
    );
    expect(general.status).toBe(200);
    const sabado = await horariosRoute.PUT(
      peticion(userId, "/api/v1/me/horarios-comida", "PUT", { horarios: { [primero]: "08:00", [slots[1]!]: "10:30" }, dia: "SAB" }),
    );
    expect(sabado.status).toBe(200);

    // 1. Replantear desde cero y rearmar ya.
    const respuestas = {
      goal: "PERDIDA_GRASA",
      mealsPerDay: 4,
      budget: "MEDIO",
      dietStyle: "ESTANDAR",
      maxPrepMin: 20,
      supplements: ["CREATINA", "OMEGA3"],
      excludedFoods: [],
      favoriteFoods: ["tortilla de nopal casera"],
    };
    // Mientras contesta: la vista previa no escribe y dice lo que saldría.
    const antes = await prisma.profile.findUniqueOrThrow({ where: { userId } });
    const previa = await json<{
      previa: {
        macros: { kcal: number; carbsG: number; fiberG: number | null };
        porque: string;
        diaMuestra: Array<{ slot: string; hora: string; items: string[] }>;
        despensa: { enMenu: number; total: number };
        tomas: Array<{ corto: string }>;
        avisos: Aviso[];
      } | null;
    }>(replanRoute.POST(peticion(userId, "/api/v1/nutricion/replan?preview=1", "POST", respuestas)));
    const previaKeto = await json<{ previa: { macros: { carbsG: number }; estilo: { valor: string } } | null }>(
      replanRoute.POST(
        peticion(userId, "/api/v1/nutricion/replan?preview=1", "POST", { ...respuestas, dietStyle: "KETO" }),
      ),
    );
    const despuesDePrevia = await prisma.profile.findUniqueOrThrow({ where: { userId } });
    expect(despuesDePrevia.updatedAt).toEqual(antes.updatedAt);
    expect(despuesDePrevia.dietStyle).toBe("ESTANDAR");
    expect(previa.previa?.diaMuestra).toHaveLength(4);
    expect(previa.previa?.diaMuestra[0]?.hora).toBe("06:30");
    expect(previa.previa?.diaMuestra.every((c) => c.items.length > 0)).toBe(true);
    expect(previa.previa?.despensa.total).toBe(8);
    expect(previa.previa?.tomas.map((t) => t.corto).length).toBe(3);
    expect(previa.previa?.avisos.some((a) => a.id === "glucosa")).toBe(true);
    expect(previaKeto.previa?.estilo.valor).toBe("KETO");
    expect(previaKeto.previa?.macros.carbsG).toBeLessThanOrEqual(DEFAULT_CONFIG.ketoCarbMaxG);

    const replan = await replanRoute.POST(peticion(userId, "/api/v1/nutricion/replan", "POST", respuestas));
    expect(replan.status).toBe(200);
    const regenerar = await regenerarRoute.POST(peticion(userId, "/api/v1/nutricion/regenerar-menu", "POST"));
    expect(regenerar.status).toBe(200);
    const regenerado = await json<Nutrition>(regenerar);

    // 2. Lo que pintan las pantallas.
    const nutricion = await json<Nutrition>(nutritionRoute.GET(peticion(userId, "/api/v1/nutrition", "GET")));
    const suplementos = await json<Suplementos>(suplementosRoute.GET(peticion(userId, "/api/v1/suplementos", "GET")));
    const horarios = await json<{ horarios: Record<string, string>; horariosPorDia: Record<string, Record<string, string>> }>(
      horariosRoute.GET(peticion(userId, "/api/v1/me/horarios-comida", "GET")),
    );

    const menu1 = nutricion.menus.find((m) => m.menuNumber === 1)!;
    const menu2 = nutricion.menus.find((m) => m.menuNumber === 2)!;
    const items = todosLosItems(nutricion.menus);
    const tiene = (menu: Menu, pred: (item: Item) => boolean) => menu.meals.some((meal) => meal.items.some(pred));
    const tomas = nutricion.tomas ?? suplementos.tomas;

    // Los recordatorios: los arma la pestaña con el menú 1, los horarios por
    // día y las tomas, exactamente como `(tabs)/nutricion.tsx`.
    const recordatorios =
      nutricion.recordatorios ??
      menu1.meals.map((meal) => {
        const extras = suplementos.tomas.filter((t) => t.slot === meal.slot).map((t) => t.corto);
        return {
          slot: meal.slot,
          cuerpo: cuerpoPreparate(meal.items, extras),
          horaPorDia: Object.fromEntries(
            ["LUN", "MAR", "MIE", "JUE", "VIE", "SAB", "DOM"].map((dia) => [
              dia,
              horarios.horariosPorDia[dia]?.[meal.slot] ?? meal.timeHint,
            ]),
          ),
        };
      });

    // 3. Check-in simulado → decisión → menús de la decisión nueva.
    const semanal = await persistCheckIn(userId, checkIn(hoy, 119.2, 117));
    const corrida = await runCoachy(semanal.id);
    const decisionNueva = await prisma.decision.findUniqueOrThrow({ where: { checkInId: semanal.id } });
    const trasCheckin = await json<Nutrition>(nutritionRoute.GET(peticion(userId, "/api/v1/nutrition", "GET")));

    const si = (ok: boolean, detalle = "") => `${ok ? "sí" : "NO"}${detalle ? ` (${detalle})` : ""}`;
    const pantryEnMenu = (menu: Menu) =>
      PANTRY.filter((id) => menu.meals.some((meal) => meal.items.some((item) => idDe(item) === id))).length;
    const propio = (item: Item) => idDe(item) === "" || /nopal casera/i.test(item.name);
    const leches = items.filter((item) => idDe(item).startsWith("leche_")).map(idDe);
    const preparaciones = nutricion.menus.flatMap((m) => m.meals.map((meal) => meal.preparacion?.nombre).filter(Boolean));
    const altoIG = carbosAltoIG(nutricion.menus);
    const altoIGCheckin = carbosAltoIG(trasCheckin.menus);
    const fibraPiso = DEFAULT_CONFIG.fiberMinGHighGlucose;
    const d3 = suplementos.sugerencias.some((s) => s.supplement === "VITAMINA_D3");
    const recPrimero = recordatorios.find((r) => r.slot === primero);

    const tabla: Record<string, Fila> = {
      "Fase y macros": {
        "Nutrición (tarjetas)": nutricion.decision ? `${nutricion.decision.kcal} kcal · ${nutricion.decision.phase}` : "NO",
        "/plan-nutricion": nutricion.decision
          ? `P${nutricion.decision.proteinG} C${nutricion.decision.carbsG} G${nutricion.decision.fatG}`
          : "NO",
        "Decisión tras check-in": `${decisionNueva.kcal} kcal · ${decisionNueva.phase} · fibra ${decisionNueva.fiberG ?? "?"} g`,
      },
      "Porqué del plan (objetivo/fase)": {
        "Nutrición (tarjetas)": nutricion.porque ?? "NO",
        "/plan-nutricion": nutricion.porque ?? "NO (texto fijo)",
      },
      "Estilo de dieta": {
        "/plan-nutricion": nutricion.estilo?.nombre ?? "NO (siempre «Omnívora por equivalencias»)",
      },
      Despensa: {
        "/menu/1": `${pantryEnMenu(menu1)}/8`,
        "/menu/2": `${pantryEnMenu(menu2)}/8`,
        "Lista de súper": `${nutricion.groceries.filter((g) => g.enDespensa).length} «ya lo tienes»`,
        "Nutrición (tarjetas)": nutricion.despensa ? `${nutricion.despensa.enCasa} ya los tienes` : "NO",
      },
      "Yogur griego (despensa)": {
        "/menu/1": si(tiene(menu1, (i) => idDe(i) === "yogur_griego_0")),
        "/menu/2": si(tiene(menu2, (i) => idDe(i) === "yogur_griego_0")),
        "Lista de súper": si(nutricion.groceries.some((g) => /yogur/i.test(g.name) && g.enDespensa === true)),
      },
      "Alimento propio": {
        "/menu/1": si(tiene(menu1, propio)),
        "/menu/2": si(tiene(menu2, propio)),
        "Lista de súper": si(nutricion.groceries.some((g) => /nopal casera/i.test(g.name))),
      },
      "Preparaciones (todas)": {
        "/menu/1": preparaciones.length > 0 ? preparaciones.join(", ") : "ninguna",
      },
      "Leche descremada": {
        "/menu/1": leches.length === 0 ? "sin leche en el menú" : [...new Set(leches)].join(", "),
      },
      "Suplementos (creatina/omega/magnesio)": {
        "Tomas del día": tomas.map((t) => `${t.supplement}@${t.slot ?? "?"}`).join(", ") || "NO",
        "Nutrición (tarjetas)": nutricion.tomas ? `${nutricion.tomas.length} tomas` : "NO",
        Recordatorios: recordatorios.filter((r) => r.cuerpo.includes(" + ")).map((r) => r.slot).join(", ") || "NO",
      },
      "Horario general": {
        "/menu/1": `${primero} ${menu1.meals[0]?.timeHint}`,
        "Mis comidas hoy": `${primero} ${nutricion.menus[0]?.meals[0]?.timeHint}`,
        Recordatorios: `LUN ${recPrimero?.horaPorDia.LUN}`,
      },
      "Horario del sábado": {
        "/menu/1": nutricion.horariosPorDia ? `SAB ${nutricion.horariosPorDia.SAB?.[primero]}` : "NO (solo el general)",
        Recordatorios: `SAB ${recPrimero?.horaPorDia.SAB}`,
      },
      "Glucosa 100 → IG bajo y fibra": {
        "/menu/1": altoIG.length === 0 ? "sí, IG ≤ 55" : `NO: ${[...new Set(altoIG)].join(", ")}`,
        "/plan-nutricion": si((nutricion.decision?.fiberG ?? 0) >= fibraPiso, `fibra ${nutricion.decision?.fiberG ?? "?"} g`),
        "Decisión tras check-in":
          altoIGCheckin.length === 0 && (decisionNueva.fiberG ?? 0) >= fibraPiso
            ? "sí"
            : `NO: fibra ${decisionNueva.fiberG} g, IG alto ${[...new Set(altoIGCheckin)].join(", ") || "—"}`,
        "Nutrición (tarjetas)": nutricion.avisos?.find((a) => a.id === "glucosa")?.texto ?? "NO",
      },
      "Vitamina D 24 → D3": {
        "Tomas del día": si(d3, "sugerencia"),
        "Nutrición (tarjetas)": nutricion.avisos?.find((a) => a.id === "vitamina_d")?.texto ?? "NO",
      },
      "Check-in → decisión → menús": {
        "Decisión tras check-in": `${corrida.status} · menú ${trasCheckin.decision?.id === decisionNueva.id ? "de la nueva" : "VIEJO"}`,
      },
      "Vista previa del replanteo": {
        "/plan-nutricion": previa.previa
          ? `${previa.previa.macros.kcal} kcal · ${previa.previa.diaMuestra.length} comidas · despensa ${previa.previa.despensa.enMenu}/${previa.previa.despensa.total} · ${previa.previa.tomas.length} tomas`
          : "NO",
      },
      "Regenerar = lo que se ve": {
        "Lista de súper": si(
          JSON.stringify(regenerado.groceries.map((g) => g.name)) === JSON.stringify(nutricion.groceries.map((g) => g.name)),
        ),
      },
    };

    imprime("Pieza → superficie (tras replantear + regenerar, y tras el check-in)", tabla);

    // --- Lo que tiene que ser verdad -------------------------------------
    // Una sola verdad del plan: el porqué, el estilo, las tomas y los
    // horarios por día salen del mismo lugar que los menús.
    // El porqué dice la fase de la decisión. El motor parte de la fase que
    // declara el perfil (CUT) si no hay decisiones previas (`fase-inicial.ts`).
    const ETIQUETA: Record<string, RegExp> = { CUT: /^Corte:/, BASE: /^Base:/, CUT_AGRESIVO: /^Corte fuerte:/ };
    expect(nutricion.porque).toMatch(ETIQUETA[nutricion.decision!.phase] ?? /./);
    expect(nutricion.porque).toContain(`${nutricion.decision!.proteinG} g`);
    expect(nutricion.estilo?.nombre).toBeTruthy();
    expect(nutricion.horariosPorDia?.SAB?.[primero]).toBe("08:00");
    expect(recPrimero?.horaPorDia.SAB).toBe("08:00");
    expect(recPrimero?.horaPorDia.LUN).toBe("06:30");
    expect(menu1.meals[0]?.timeHint).toBe("06:30");

    // La despensa se nota: el yogur griego entra y la lista lo marca.
    expect(pantryEnMenu(menu1) + pantryEnMenu(menu2)).toBeGreaterThanOrEqual(4);
    expect(nutricion.groceries.filter((g) => g.enDespensa).length).toBeGreaterThanOrEqual(4);
    expect(nutricion.despensa?.enCasa).toBeGreaterThanOrEqual(4);

    // Leche descremada: nunca otra.
    expect(leches.every((id) => id === "leche_descremada")).toBe(true);

    // Suplementos: las tres tomas amarradas a comidas del menú, y en el aviso.
    for (const supl of ["CREATINA", "OMEGA3", "MAGNESIO"]) {
      const toma = tomas.find((t) => t.supplement === supl);
      expect(toma, supl).toBeDefined();
      expect(slots).toContain(toma!.slot);
    }
    expect(recordatorios.some((r) => r.cuerpo.includes(" + "))).toBe(true);

    // Glucosa en ayuno de 100: IG bajo y piso alto de fibra, en el menú de hoy
    // y en el que sale del check-in; y el aviso lo dice.
    expect(altoIG).toEqual([]);
    expect(altoIGCheckin).toEqual([]);
    expect(decisionNueva.fiberG ?? 0).toBeGreaterThanOrEqual(fibraPiso);
    expect(nutricion.avisos?.some((a) => a.id === "glucosa")).toBe(true);

    // Vitamina D baja: la D3 aparece sugerida y avisada.
    expect(d3).toBe(true);
    expect(nutricion.avisos?.some((a) => a.id === "vitamina_d")).toBe(true);

    // El check-in rearma: la pantalla ya lee los menús de la decisión nueva.
    expect(corrida.status).toBe("ok");
    expect(trasCheckin.decision?.id).toBe(decisionNueva.id);

    // Regenerar devuelve lo mismo que luego pinta la pantalla.
    expect(regenerado.groceries.map((g) => g.name)).toEqual(nutricion.groceries.map((g) => g.name));
  }, 120_000);

  it("freno clínico: aviso arriba y tomas en pausa en Nutrición, suplementos y recordatorios", async () => {
    await prisma.profile.update({ where: { userId }, data: { conditions: ["medicacion"] } });
    try {
      const nutricion = await json<Nutrition & { tomasPausadas: number }>(
        nutritionRoute.GET(peticion(userId, "/api/v1/nutrition", "GET")),
      );
      const suplementos = await json<Suplementos & { tomasPausadas: number }>(
        suplementosRoute.GET(peticion(userId, "/api/v1/suplementos", "GET")),
      );

      expect(nutricion.avisos?.[0]?.id).toBe("freno");
      expect(nutricion.avisos?.[0]?.texto).toContain("pausamos tus 3 tomas");
      expect(nutricion.tomas).toEqual([]);
      expect(suplementos.tomas).toEqual([]);
      expect(suplementos.tomasPausadas).toBe(3);
      expect(suplementos.sugerencias).toEqual([]);
      expect(nutricion.recordatorios?.every((r) => !r.cuerpo.includes(" + "))).toBe(true);
    } finally {
      await prisma.profile.update({ where: { userId }, data: { conditions: [] } });
    }
  }, 60_000);
});
