import type { MenuItem, MenuMeal, TomaDelDia } from "@/lib/api";
import { tomasDeCadaComida } from "@/lib/tomas-comida";
import type { ItemMenuAviso } from "@/lib/recordatorio";

/**
 * La siguiente comida, completa — fuente ÚNICA para el widget del iPhone, el
 * reloj (app y complicación) y el "Prepárate". Lógica PURA, sin React ni red.
 *
 * Mau: "solo salen los primeros 3 ingredientes; falta otro ingrediente y el
 * suplemento de ashwagandha". Cada superficie cortaba por su cuenta (el
 * widget a 3, Hoy a 3 antes de mandarlo, el aviso a 4) y ninguna traía las
 * tomas amarradas a la comida. Aquí sale la lista entera, con el platillo
 * (licuado, sopa) como primer renglón y sus ingredientes debajo, y las tomas
 * aparte; cada superficie decide cuánto cabe y avisa "+N más", nunca corta
 * callada.
 */

/** Un renglón de la comida, ya listo para pintar. */
export type RenglonComida = {
  /** "3 tortillas de maíz", "Pavo — 120 g", "Café (libre)", o el nombre del platillo. */
  display: string;
  /** El nombre sin cantidad ("Pavo"): lo usa el "Prepárate". */
  nombre: string;
  /** Este renglón ES el platillo ("Licuado de fresa con avena"); lo que sigue con `enPlatillo` va dentro. */
  platillo?: true;
  /** Ingrediente del platillo de arriba: se pinta sangrado. */
  enPlatillo?: true;
};

export type TomaDeComida = { nombre: string; dosis: string };

export type SiguienteComida = {
  slot: string;
  nombre: string;
  /** "21:00" (o el texto que traiga el motor si no hay hora de hoy). */
  hora: string;
  items: RenglonComida[];
  tomas: TomaDeComida[];
};

/** Lo que hace falta del plan (`GET /nutrition` o `/nutricion/plan`); todo opcional por el API viejo. */
export type PlanParaSiguienteComida = {
  menus?: Array<{ menuNumber: number; meals: MenuMeal[] }>;
  menuDeHoy?: number;
  hoy?: { comidas: Array<{ slot: string; label: string; hora: string }> };
  tomas?: TomaDelDia[];
};

/** El renglón de un alimento como lo pinta el widget desde siempre. */
type ItemConExtras = MenuItem & { preparacionId?: string };
type ComidaConPlatillo = MenuMeal & { preparacion?: { id: string; nombre: string } };

function capital(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function displayDe(item: MenuItem): string {
  if (item.free) return `${item.name} (libre)`;
  return item.portion ? item.portion : `${item.name} — ${item.grams} g`;
}

/**
 * `timeHint` es texto libre ("7:00 am", "19:30", "7 pm"). Minutos desde
 * medianoche, o `null` si no trae una hora reconocible.
 */
export function parseTimeHintMinutes(timeHint: string): number | null {
  const match = timeHint.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/i);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.replace(/[.\s]/g, "").toLowerCase();

  if (hours > 23 || minutes > 59) return null;

  if (meridiem === "pm" && hours < 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;

  return hours * 60 + minutes;
}

/** Los renglones de una comida: el platillo y sus ingredientes primero, luego lo suelto, cada cosa en su orden. */
export function renglonesDeComida(meal: MenuMeal): RenglonComida[] {
  const items = meal.items as ItemConExtras[];
  const platillo = (meal as ComidaConPlatillo).preparacion;
  const renglon = (item: ItemConExtras): RenglonComida => ({ display: displayDe(item), nombre: item.name });

  if (!platillo) return items.map(renglon);

  const dentro = items.filter((item) => item.preparacionId === platillo.id);
  const sueltos = items.filter((item) => item.preparacionId !== platillo.id);
  if (dentro.length === 0) return items.map(renglon);

  return [
    { display: platillo.nombre, nombre: platillo.nombre, platillo: true },
    ...dentro.map((item) => ({ ...renglon(item), enPlatillo: true as const })),
    ...sueltos.map(renglon),
  ];
}

/**
 * Lo que aún falta tomar al llegar a esa comida: "Ashwagandha" + "300 mg".
 * La misma regla que el "Prepárate" (`tomasDeCadaComida`): lo marcado ya no
 * se recuerda y lo atrasado sigue saliendo en la comida que viene.
 */
export function tomasDelSlot(plan: PlanParaSiguienteComida, slot: string): TomaDeComida[] {
  const comidas = plan.hoy?.comidas ?? [];
  const porComida = tomasDeCadaComida(plan.tomas ?? [], comidas, { soloPendientes: true });
  // Sin horas de hoy (API viejo), las amarradas a ese slot que falten.
  const deLaComida = comidas.length > 0
    ? (porComida[slot] ?? [])
    : (plan.tomas ?? []).filter((t) => t.slot === slot && !t.hecho);
  return deLaComida.map((t) => ({ nombre: capital(t.corto), dosis: t.dosis }));
}

function menuDeHoy(plan: PlanParaSiguienteComida): { meals: MenuMeal[] } | null {
  const menus = plan.menus ?? [];
  return menus.find((m) => m.menuNumber === plan.menuDeHoy) ?? menus[0] ?? null;
}

/** La comida de ese slot en el menú de hoy, completa. `null` si hoy no hay ese slot. */
export function comidaCompleta(plan: PlanParaSiguienteComida, slot: string): SiguienteComida | null {
  const meal = menuDeHoy(plan)?.meals.find((m) => m.slot === slot);
  if (!meal) return null;
  const deHoy = plan.hoy?.comidas.find((c) => c.slot === slot);
  return {
    slot,
    nombre: deHoy?.label ?? meal.label,
    hora: deHoy?.hora ?? meal.timeHint,
    items: renglonesDeComida(meal),
    tomas: tomasDelSlot(plan, slot),
  };
}

/**
 * Las comidas que faltan hoy, desde la siguiente, en orden de hora. Si ya
 * pasaron todas, la primera del día (la de mañana), sola. Si ninguna hora se
 * puede leer, el menú tal cual — nunca deja la superficie vacía por un texto
 * raro del motor.
 */
export function comidasPendientesDesde(plan: PlanParaSiguienteComida, ahora: Date = new Date()): SiguienteComida[] {
  const menu = menuDeHoy(plan);
  if (!menu) return [];

  const slots = plan.hoy?.comidas.length ? plan.hoy.comidas.map((c) => c.slot) : menu.meals.map((m) => m.slot);
  const comidas = slots.map((slot) => comidaCompleta(plan, slot)).filter((c): c is SiguienteComida => c !== null);
  if (comidas.length === 0) return [];

  const conHora = comidas
    .map((comida) => ({ comida, minutos: parseTimeHintMinutes(comida.hora) }))
    .filter((e): e is { comida: SiguienteComida; minutos: number } => e.minutos !== null)
    .sort((a, b) => a.minutos - b.minutos);
  if (conHora.length === 0) return comidas;

  const ahoraMin = ahora.getHours() * 60 + ahora.getMinutes();
  const faltan = conHora.filter((e) => e.minutos >= ahoraMin).map((e) => e.comida);
  return faltan.length > 0 ? faltan : [conHora[0]!.comida];
}

/** La siguiente comida completa, o `null` si el plan no trae menú. */
export function siguienteComida(plan: PlanParaSiguienteComida, ahora: Date = new Date()): SiguienteComida | null {
  return comidasPendientesDesde(plan, ahora)[0] ?? null;
}

/** Los renglones planos que se escriben en el widget y el resumen del reloj (el platillo ya va primero). */
export function renglonesPlanos(comida: SiguienteComida): string[] {
  return comida.items.map((item) => item.display);
}

/** "+ Ashwagandha 300 mg". */
export function renglonDeToma(toma: TomaDeComida): string {
  return `+ ${toma.nombre} ${toma.dosis}`.trim();
}

/**
 * Lo que cabe en `capacidad` renglones sin cortar callado: si la lista no
 * cabe, el último renglón visible se vuelve "+N más" con lo que quedó fuera.
 */
export function recortarConAviso(renglones: readonly string[], capacidad: number): string[] {
  if (renglones.length <= capacidad) return [...renglones];
  if (capacidad <= 0) return [`+${renglones.length} más`];
  const visibles = renglones.slice(0, capacidad - 1);
  return [...visibles, `+${renglones.length - visibles.length} más`];
}

/**
 * Los renglones del "Prepárate": nombres sin cantidades; el platillo con sus
 * ingredientes entre paréntesis ("Licuado de fresa (leche, fresa, avena)").
 */
export function itemsParaAviso(comida: SiguienteComida): ItemMenuAviso[] {
  const salida: ItemMenuAviso[] = [];
  for (let i = 0; i < comida.items.length; i++) {
    const item = comida.items[i]!;
    if (item.platillo) {
      const dentro: string[] = [];
      while (comida.items[i + 1]?.enPlatillo) dentro.push(comida.items[++i]!.nombre.toLowerCase());
      salida.push({ name: dentro.length ? `${item.nombre} (${dentro.join(", ")})` : item.nombre });
    } else {
      salida.push({ name: item.nombre });
    }
  }
  return salida;
}
