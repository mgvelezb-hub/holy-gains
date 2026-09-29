import { DEFAULT_CONFIG, type EngineConfig } from './config.js';
import { clamp } from './calc.js';
import type { MacroTargets, MealSlot, MealSlotId, Phase, Profile } from './types.js';

/**
 * Los nombres de cada tiempo de comida.
 *
 * Van SIEMPRE con el nombre de la comida del dia primero y el papel de
 * entrenamiento entre parentesis: "Desayuno (pre-entreno)", no "Pre-entreno".
 * La razon: quien entrena en la mañana leia "Pre-entreno" a las 7:00 y tenia
 * que traducir mentalmente que ese era su desayuno; y quien entrena de noche,
 * al leer la misma palabra en otra plantilla, no sabia si eso reemplazaba su
 * desayuno o se sumaba. Nadie organiza su dia en pres y posts: lo organiza en
 * desayuno, comida y cena, y el papel de entrenamiento es una nota al margen.
 */
interface SlotTemplate {
  id: MealSlotId;
  label: string;
  timeHint: string;
  carbPct: number;
  proteinPct: number;
  fatPct: number;
  freeVegetables: boolean;
  /** % de carbo cuando la fase prohibe carbo denso en comida/cena. */
  carbPctAggressive: number;
}

const MORNING_4: SlotTemplate[] = [
  { id: 'PRE', label: 'Desayuno (pre-entreno)', timeHint: '07:00', carbPct: 32.5, proteinPct: 22.5, fatPct: 0, freeVegetables: false, carbPctAggressive: 45 },
  { id: 'POST', label: 'Almuerzo (post-entreno)', timeHint: '09:30', carbPct: 37.5, proteinPct: 25, fatPct: 0, freeVegetables: false, carbPctAggressive: 55 },
  { id: 'COMIDA', label: 'Comida', timeHint: '14:00', carbPct: 20, proteinPct: 25, fatPct: 50, freeVegetables: true, carbPctAggressive: 0 },
  { id: 'CENA', label: 'Cena', timeHint: '20:00', carbPct: 10, proteinPct: 27.5, fatPct: 50, freeVegetables: true, carbPctAggressive: 0 },
];

const MORNING_3: SlotTemplate[] = [
  { id: 'DESAYUNO', label: 'Desayuno (pre y post entreno)', timeHint: '08:00', carbPct: 70, proteinPct: 47.5, fatPct: 0, freeVegetables: false, carbPctAggressive: 100 },
  { id: 'COMIDA', label: 'Comida', timeHint: '14:00', carbPct: 20, proteinPct: 25, fatPct: 50, freeVegetables: true, carbPctAggressive: 0 },
  { id: 'CENA', label: 'Cena', timeHint: '20:00', carbPct: 10, proteinPct: 27.5, fatPct: 50, freeVegetables: true, carbPctAggressive: 0 },
];

const MORNING_5: SlotTemplate[] = [
  { id: 'PRE', label: 'Desayuno (pre-entreno)', timeHint: '07:00', carbPct: 30, proteinPct: 20, fatPct: 0, freeVegetables: false, carbPctAggressive: 45 },
  { id: 'POST', label: 'Almuerzo (post-entreno)', timeHint: '09:30', carbPct: 35, proteinPct: 22.5, fatPct: 0, freeVegetables: false, carbPctAggressive: 55 },
  { id: 'COMIDA', label: 'Comida', timeHint: '14:00', carbPct: 17.5, proteinPct: 22.5, fatPct: 45, freeVegetables: true, carbPctAggressive: 0 },
  { id: 'SNACK', label: 'Colacion', timeHint: '17:30', carbPct: 10, proteinPct: 12.5, fatPct: 10, freeVegetables: false, carbPctAggressive: 0 },
  { id: 'CENA', label: 'Cena', timeHint: '20:30', carbPct: 7.5, proteinPct: 22.5, fatPct: 45, freeVegetables: true, carbPctAggressive: 0 },
];

const EVENING_4: SlotTemplate[] = [
  { id: 'DESAYUNO', label: 'Desayuno (bajo carbo)', timeHint: '08:00', carbPct: 20, proteinPct: 25, fatPct: 50, freeVegetables: true, carbPctAggressive: 0 },
  { id: 'COMIDA', label: 'Comida', timeHint: '13:30', carbPct: 10, proteinPct: 27.5, fatPct: 50, freeVegetables: true, carbPctAggressive: 0 },
  { id: 'PRE', label: 'Colacion (pre-entreno)', timeHint: '17:00', carbPct: 32.5, proteinPct: 22.5, fatPct: 0, freeVegetables: false, carbPctAggressive: 45 },
  { id: 'POST', label: 'Cena (post-entreno)', timeHint: '20:30', carbPct: 37.5, proteinPct: 25, fatPct: 0, freeVegetables: false, carbPctAggressive: 55 },
];

// Tres comidas son desayuno, comida y cena. El entreno de la tarde queda como
// etiqueta, no como slot: la comida de las 14:00 que se llamaba PRE heredaba
// las reglas del pre-entreno (nada que cocinar, polvos) y no las de una
// comida principal, y la cena POST salia sin verdura.
const EVENING_3: SlotTemplate[] = [
  { id: 'DESAYUNO', label: 'Desayuno (bajo carbo)', timeHint: '08:30', carbPct: 20, proteinPct: 30, fatPct: 60, freeVegetables: true, carbPctAggressive: 0 },
  { id: 'COMIDA', label: 'Comida (pre-entreno)', timeHint: '14:00', carbPct: 42.5, proteinPct: 32.5, fatPct: 40, freeVegetables: true, carbPctAggressive: 45 },
  { id: 'CENA', label: 'Cena (post-entreno)', timeHint: '20:30', carbPct: 37.5, proteinPct: 37.5, fatPct: 0, freeVegetables: true, carbPctAggressive: 55 },
];

const EVENING_5: SlotTemplate[] = [
  { id: 'DESAYUNO', label: 'Desayuno (bajo carbo)', timeHint: '08:00', carbPct: 15, proteinPct: 22.5, fatPct: 45, freeVegetables: true, carbPctAggressive: 0 },
  { id: 'COMIDA', label: 'Comida', timeHint: '13:30', carbPct: 10, proteinPct: 22.5, fatPct: 45, freeVegetables: true, carbPctAggressive: 0 },
  { id: 'PRE', label: 'Colacion (pre-entreno)', timeHint: '17:00', carbPct: 30, proteinPct: 20, fatPct: 0, freeVegetables: false, carbPctAggressive: 45 },
  { id: 'POST', label: 'Cena (post-entreno)', timeHint: '20:30', carbPct: 35, proteinPct: 22.5, fatPct: 0, freeVegetables: false, carbPctAggressive: 55 },
  { id: 'SNACK', label: 'Colacion', timeHint: '22:00', carbPct: 10, proteinPct: 12.5, fatPct: 10, freeVegetables: false, carbPctAggressive: 0 },
];

/** Fases donde comida y cena van sin carbo denso (spec §3 y §5). */
export const NO_DENSE_CARB_PHASES: readonly Phase[] = ['CUT_AGRESIVO'];

function templateFor(profile: Profile): SlotTemplate[] {
  const meals = clamp(Math.round(profile.mealsPerDay || 4), 3, 5);
  if (profile.trainingTime === 'tarde') {
    if (meals === 3) return EVENING_3;
    if (meals === 5) return EVENING_5;
    return EVENING_4;
  }
  if (meals === 3) return MORNING_3;
  if (meals === 5) return MORNING_5;
  return MORNING_4;
}

/** Hora "HH:MM" a minutos desde medianoche. */
function toMinutes(time: string): number {
  const [hour, minute] = time.split(':').map((part) => Number(part));
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function toClock(minutes: number): string {
  const total = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Ventana de alimentacion por defecto: 16/8, que es la version mas comun. */
const DEFAULT_FASTING_WINDOW = { startHour: 12, endHour: 20 };

/**
 * Recoloca los horarios dentro de la ventana de ayuno.
 *
 * El ayuno intermitente **mueve horarios, no macros**: las mismas comidas, los
 * mismos gramos, comprimidos en la ventana. Se conserva el ORDEN y el reparto
 * relativo del dia original, de modo que la comida pre-entreno sigue antes que
 * la post y la cena sigue siendo la ultima.
 *
 * Lo que este modulo NO hace es opinar sobre si el entrenamiento cae fuera de
 * la ventana. Eso lo dice la app con los datos del perfil, porque es una
 * advertencia, no un ajuste.
 */
function withFastingWindow(template: SlotTemplate[], profile: Profile): SlotTemplate[] {
  if (profile.diet !== 'ayuno' || template.length === 0) return template;

  const window = profile.fastingWindow ?? DEFAULT_FASTING_WINDOW;
  const start = clamp(Math.round(window.startHour), 0, 23) * 60;
  const end = clamp(Math.round(window.endHour), 0, 23) * 60;
  // Una ventana invertida o de una hora no se corrige a la brava: se ignora y
  // el dia se queda como estaba, que es mejor que inventar horarios absurdos.
  if (end - start < 60) return template;

  const original = template.map((slot) => toMinutes(slot.timeHint));
  const first = Math.min(...original);
  const last = Math.max(...original);
  const span = last - first;

  return template.map((slot, index) => {
    const position = span > 0 ? (original[index]! - first) / span : index / Math.max(1, template.length - 1);
    return { ...slot, timeHint: toClock(start + position * (end - start)) };
  });
}

/** Reparte `total` entre pesos, en gramos enteros, sin perder ni inventar gramos. */
function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const floored = exact.map((v) => Math.floor(v));
  let residual = Math.round(total) - floored.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  let k = 0;
  while (residual > 0 && order.length > 0) {
    const entry = order[k % order.length];
    if (entry) floored[entry.i] = (floored[entry.i] ?? 0) + 1;
    residual -= 1;
    k += 1;
  }
  while (residual < 0) {
    const idx = floored.findIndex((v) => v > 0);
    if (idx < 0) break;
    floored[idx] = (floored[idx] ?? 0) - 1;
    residual += 1;
  }
  return floored;
}

/**
 * Distribuye los macros del dia entre las comidas (spec §5).
 * Soporta 3-5 comidas y entreno en la manana o en la tarde.
 * En CUT_AGRESIVO el carbo se concentra en pre/post y comida y cena van sin carbo denso.
 */
export function distribute(
  macros: MacroTargets,
  profile: Profile,
  phase: Phase = 'BASE',
  _config: EngineConfig = DEFAULT_CONFIG,
): MealSlot[] {
  const template = withFastingWindow(templateFor(profile), profile);
  const aggressive = NO_DENSE_CARB_PHASES.includes(phase);

  const carbWeights = template.map((t) => (aggressive ? t.carbPctAggressive : t.carbPct));
  const proteinWeights = template.map((t) => t.proteinPct);
  // En keto la grasa sigue a la proteina, no a la plantilla. Las plantillas
  // dejan el pre y el post SIN grasa a proposito —ahi va el carbohidrato del
  // entrenamiento—, pero en keto ese carbohidrato no existe: toda la grasa del
  // dia caia en dos comidas y ninguna cabia en un plato (55 g de grasa son mas
  // que la cucharada de aceite y los 30 g de nueces que un platillo aguanta).
  const fatWeights =
    profile.diet === 'keto' ? proteinWeights : template.map((t) => t.fatPct);

  const carbs = allocate(macros.carbG, carbWeights);
  const proteins = allocate(macros.proteinG, proteinWeights);
  const fats = allocate(macros.fatG, fatWeights);

  return template.map((t, i) => {
    const proteinG = proteins[i] ?? 0;
    const carbG = carbs[i] ?? 0;
    const fatG = fats[i] ?? 0;
    return {
      id: t.id,
      label: t.label,
      timeHint: t.timeHint,
      proteinG,
      carbG,
      fatG,
      kcal: proteinG * 4 + carbG * 4 + fatG * 9,
      allowDenseCarb: aggressive ? t.carbPctAggressive > 0 : t.carbPct > 0,
      freeVegetables: t.freeVegetables,
    };
  });
}
