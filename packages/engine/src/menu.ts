import { DEFAULT_CONFIG, type EngineConfig } from './config.js';
import { permitePolvos } from './suplementos.js';
import { roundTo } from './calc.js';
import { FOODS, catalogoCon, matchesAny, normalize } from './foods.js';
import { PREPARACIONES } from './preparaciones.js';
import type {
  Equivalence,
  Food,
  FoodRole,
  MacroTargets,
  MealSlot,
  Menu,
  MenuItem,
  MenuMeal,
  MenuItemWhy,
  MenuPlan,
  Phase,
  Preparacion,
  PreparacionRef,
  Profile,
  ServingUnit,
  ShoppingItem,
} from './types.js';

const DENSE_CARB_ROLES: FoodRole[] = ['carbo_pre', 'carbo_post', 'carbo_complejo'];

/** PRNG determinista (mulberry32): misma semilla, mismo menu. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gramos maximos razonables por alimento, para no proponer 400 g de aceite. */
export function maxGrams(food: Food): number {
  // La medida casera manda: el techo real es `maxUnits` piezas, tazas o
  // cucharadas de ese alimento. `maxG` se queda como techo absoluto para lo
  // que no la tiene (vegetales libres, suplementos).
  if (food.serving) return food.serving.maxUnits * food.serving.gramsPerUnit;
  if (food.maxG !== undefined) return food.maxG;
  if (food.role === 'suplemento') return 20;
  if (food.kcalPer100 >= 700) return 40;
  if (food.kcalPer100 >= 450) return 80;
  if (food.kcalPer100 >= 250) return 250;
  return 400;
}

/**
 * Porcion minima digna. No es un minimo tecnico: es la cantidad por debajo de
 * la cual el alimento deja de ser un ingrediente y pasa a ser una pizca —el
 * "pedacito de aguacate" de 12 g que nadie sirve—. Por debajo de esto el
 * alimento se cae de la comida en vez de aparecer en migajas.
 */
export function minGrams(food: Food): number {
  if (!food.serving) return 0;
  return food.serving.minUnits * food.serving.gramsPerUnit;
}

/**
 * Paso de redondeo por alimento. Con medida casera el paso es fraccion de la
 * unidad (media taza, media cucharadita, una pieza): asi el menu dice "1½
 * tazas" y no "173 g". Sin ella, los alimentos muy densos se redondean al
 * gramo, porque 5 g de aceite son 45 kcal y romperian el target.
 */
function roundingFor(food: Food, config: EngineConfig): number {
  if (food.serving) return (food.serving.step ?? 0.5) * food.serving.gramsPerUnit;
  return food.kcalPer100 >= config.denseFoodKcalPer100 ? 1 : config.menuGramRoundingG;
}

/** Redondea al paso del alimento y lo encaja en su rango de porcion. */
function quantize(grams: number, food: Food, config: EngineConfig, piso = minGrams(food)): number {
  const paso = roundingFor(food, config);
  const redondeado = roundTo(grams, paso);
  const max = maxGrams(food);
  // El piso se redondea HACIA ARRIBA al paso: media taza de mas es mejor que
  // quedarse por debajo de la proteina que la comida prometio.
  const minimo = Math.min(Math.ceil(piso / paso) * paso, max);
  return Math.min(Math.max(redondeado, minimo), max);
}

export interface MenuOptions {
  phase?: Phase;
  /** Menos ingredientes y mas repeticion (regla de adherencia). */
  simplify?: boolean;
  /** Dias por semana que se usa cada menu, para la lista de super. */
  daysPerMenu?: number;
  /**
   * Alimentos que la persona dio de alta porque el catalogo no los tiene (el
   * yogur de su marca, su proteina en polvo). Se mezclan con el catalogo y
   * compiten con las mismas reglas: aqui no hay trato especial.
   */
  extraFoods?: Food[];
}

interface EligibleOptions {
  /** Solo alimentos verdes de bajo carbohidrato (vegetales libres). */
  freeVegetable?: boolean;
  /** Slot peri-entreno: nada que haya que cocinar. */
  quickOnly?: boolean;
  /** Comida o cena: sin polvos ni suplementos. */
  noSupplements?: boolean;
  /** Lo que ya esta en el plato, para no servir combinaciones que no van. */
  acompanan?: Food[];
  /**
   * El slot es desayuno: sale lo que nadie desayuna (tilapia, bistec, atun) y
   * entra lo que solo se desayuna (la mantequilla sobre el pan).
   */
  desayuno?: boolean;
  /** Subtipos de carbohidrato admitidos por la plantilla del slot. */
  subtipos?: string[];
  /**
   * La proteina de la comida tiene que llegar a estos gramos dentro de su
   * porcion: la leche descremada aporta 10 g en una taza y media, y eso no
   * sostiene una comida.
   */
  minProteinG?: number;
  /**
   * No aflojar la plantilla aunque deje el rol vacio. Sirve para encadenar
   * intentos: primero se busca proteina de desayuno entre las magras y entre
   * las grasas, y solo si NINGUNA de las dos da, se desayuna lo que haya.
   */
  estricto?: boolean;
  /**
   * La comida ya trae su grasa anadida (la cucharadita de aceite de la
   * crema): la grasa que se elija tiene que ser otra cosa, no otro aceite.
   */
  sinGrasaAnadida?: boolean;
}

/** true si el alimento responde a ese termino de la tabla de afinidad. */
function esTermino(food: Food, termino: string): boolean {
  return food.id === termino || food.role === termino || food.tags.includes(termino);
}

/** true si esos dos alimentos no se sirven en la misma comida. */
export function incompatibles(a: Food, b: Food, config: EngineConfig): boolean {
  // El mismo alimento dos veces no es una combinacion, es un renglon repetido:
  // el platano vive en el catalogo dos veces —como fruta y como carbohidrato
  // post-entreno— y el almuerzo salia con "1 pieza de platano" dos veces.
  if (a.id !== b.id && normalize(a.name) === normalize(b.name)) return true;

  return config.afinidad.incompatibles.some(
    ([uno, otro]) =>
      (esTermino(a, uno) && esTermino(b, otro)) || (esTermino(a, otro) && esTermino(b, uno)),
  );
}

/** true si ese par se busca: frijol con tortilla, huevo con aguacate. */
function afines(a: Food, b: Food, config: EngineConfig): boolean {
  return config.afinidad.afines.some(
    ([uno, otro]) =>
      (esTermino(a, uno) && esTermino(b, otro)) || (esTermino(a, otro) && esTermino(b, uno)),
  );
}

/**
 * Minutos que ese alimento cuesta **el dia que te lo comes**.
 *
 * El arroz integral tarda 35 minutos, pero nadie cuece arroz para una comida:
 * se hace la olla el domingo y entre semana se calienta la porcion. Castigarlo
 * con sus 35 minutos saca del menu al carbohidrato base de media Mexico por un
 * tiempo que no ocurre ese dia.
 *
 * Por eso lo que se mide es el tiempo del dia: para lo que aguanta cocinarse
 * en lote y refrigerarse (`meal_prep`), eso es calentar y servir. La cuenta
 * completa sigue existiendo —vive en `prepMin` y es la que se usa para armar
 * el domingo—, solo deja de aplicarse al martes.
 */
const MINUTOS_CALENTAR = 6;

export function prepMinDelDia(food: Food): number {
  if (!food.tags.includes('meal_prep')) return food.prepMin;
  return Math.min(food.prepMin, MINUTOS_CALENTAR);
}

function eligible(
  pool: Food[],
  profile: Profile,
  config: EngineConfig,
  role: FoodRole,
  options: EligibleOptions = {},
): Food[] {
  const excluded = [...(profile.excludedFoods ?? []), ...(profile.allergies ?? [])];
  const pasa = (food: Food, conPlantilla: boolean): boolean => {
    if (food.role !== role) return false;
    if (options.freeVegetable && food.carbPer100 > config.freeVegetableMaxCarbPer100) return false;
    if (options.noSupplements && food.tags.includes('suplemento')) return false;
    // Un menú que pide 30 g de whey a quien no tiene whey es un menú que no se
    // puede seguir. Los polvos entran solo si la persona los declaró.
    if (food.tags.includes('suplemento') && !permitePolvos(profile)) return false;
    if (matchesAny(food, excluded)) return false;
    // Vegetariana es ovolactovegetariana: sale la carne, el pollo y el
    // pescado; el huevo y los lacteos se quedan. El catalogo trae la etiqueta
    // por alimento, así que aquí no se adivina por nombre.
    if (profile.diet === 'vegetariana' && food.tags.includes('no_vegetariano')) return false;
    // Escalera de precio: bajo = solo lo más barato, medio = hasta el
    // intermedio, alto = sin tope.
    const topeDeCosto = profile.budget === 'bajo' ? 1 : profile.budget === 'medio' ? 2 : 3;
    if (food.costRel > topeDeCosto) return false;
    if (conPlantilla) {
      if (options.sinGrasaAnadida && food.tags.includes('grasa_anadida')) return false;
      if (options.desayuno === true && food.tags.includes('no_desayuno')) return false;
      if (options.desayuno === false && food.tags.includes('solo_desayuno')) return false;
      if (
        options.subtipos !== undefined &&
        options.subtipos.length > 0 &&
        !options.subtipos.some((subtipo) => food.tags.includes(subtipo))
      ) {
        return false;
      }
      if (
        options.minProteinG !== undefined &&
        options.minProteinG > 0 &&
        (maxGrams(food) * food.proteinPer100) / 100 < options.minProteinG
      ) {
        return false;
      }
    }
    if (
      profile.conditions?.glucosaAlta &&
      DENSE_CARB_ROLES.includes(role) &&
      food.gi !== null &&
      food.gi > config.lowGiMax
    ) {
      return false;
    }
    return true;
  };

  // La plantilla del slot manda, pero no puede dejar un rol vacio: si en el
  // catalogo de esa persona no queda ninguna proteina de desayuno, es mejor
  // desayunar lo que haya que no desayunar.
  const conPlantilla = pool.filter((food) => pasa(food, true));
  const filtered =
    conPlantilla.length > 0 || options.estricto === true
      ? conPlantilla
      : pool.filter((food) => pasa(food, false));

  // El tope de tiempo de cocina es una preferencia, no una restricción dura:
  // si deja un rol sin con qué comer —el caso real es la proteína, que casi
  // siempre se cocina—, manda comer. Un menú sin proteína no es un menú que
  // respeta tu agenda, es un menú roto.
  const quickEnough =
    profile.maxPrepMin === undefined
      ? filtered
      : filtered.filter((f) => prepMinDelDia(f) <= (profile.maxPrepMin as number));
  const byPrep = quickEnough.length > 0 ? quickEnough : filtered;

  const conAfinidad =
    options.acompanan === undefined
      ? byPrep
      : byPrep.filter(
          (f) => !options.acompanan!.some((otro) => incompatibles(f, otro, config)),
        );
  // La afinidad es una preferencia fuerte, no un muro: si deja el rol vacio,
  // manda comer, igual que el tope de tiempo de cocina.
  const conCompania = conAfinidad.length > 0 ? conAfinidad : byPrep;

  if (options.quickOnly) {
    const quick = conCompania.filter((f) => f.tags.includes('rapido'));
    if (quick.length > 0) return quick;
  }
  return conCompania;
}

/**
 * Lo que la persona ya tiene comprado, de entre los candidatos.
 *
 * Se compara por id del catalogo y no por nombre —como si hace
 * `favoriteFoods`— porque la despensa se captura tocando alimentos de una
 * lista, no escribiendola: no hay nada que adivinar.
 */
function deLaDespensa(candidates: Food[], profile: Profile): Food[] {
  const despensa = profile.pantry;
  if (!despensa || despensa.length === 0) return [];
  const ids = new Set(despensa);
  return candidates.filter((f) => ids.has(f.id));
}

function pick(
  candidates: Food[],
  profile: Profile,
  random: () => number,
  avoid: Set<string>,
  /** Alimentos que se llevan bien con lo que ya esta en el plato. */
  preferidos: Set<string> = new Set(),
): Food | undefined {
  if (candidates.length === 0) return undefined;
  // La despensa manda ANTES que la variedad: lo que ya esta comprado se
  // elige primero dentro de su rol, y el resto del catalogo solo entra
  // cuando la despensa no cubre ese rol. `candidates` ya paso plantilla,
  // afinidad, presupuesto y cotas, asi que priorizar aqui no puede romper
  // ninguna regla: solo ordena entre los que ya eran validos.
  const despensa = deLaDespensa(candidates, profile);
  const base = despensa.length > 0 ? despensa : candidates;
  const fresh = base.filter((f) => !avoid.has(f.id));
  const pool = fresh.length > 0 ? fresh : base;
  const weights = pool.map(
    (f) => (matchesAny(f, profile.favoriteFoods) ? 3 : 1) * (preferidos.has(f.id) ? 2 : 1),
  );
  const total = weights.reduce((a, b) => a + b, 0);
  let ticket = random() * total;
  for (let i = 0; i < pool.length; i += 1) {
    ticket -= weights[i] ?? 0;
    if (ticket <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

interface Slot {
  food: Food;
  grams: number;
  fixed: boolean;
  /** Rol con el que se eligio: lo necesita el refill y la explicabilidad. */
  role?: FoodRole;
  /**
   * Gramos que el solver pedia ANTES de encajarlos en la medida casera. Es lo
   * que delata a un alimento que no cabe en la comida: si pedia 12 g y su
   * porcion minima son 45, no es que sobre poco, es que no va.
   */
  raw?: number;
  /**
   * Proteina minima que este alimento tiene que aportar a la comida. Se guarda
   * en gramos de PROTEINA, no de alimento, para que siga valiendo si el
   * alimento se sustituye por otro.
   */
  minProteinG?: number;
  /** Cuantos alimentos admite la comida a la que pertenece (sin el vegetal). */
  maxEnComida?: number;
  /** El platillo al que pertenece (licuado, sopa): se sirve agrupado. */
  preparacion?: PreparacionRef;
  /**
   * Ingrediente que el platillo no puede perder: ni la poda ni el refuerzo lo
   * sacan. Si aun asi se cae, la comida deja de llamarse como el platillo.
   */
  requerido?: boolean;
  /** Cuantos ingredientes requeridos tenia el platillo al armarse. */
  requeridosDelPlatillo?: number;
  /** Los alimentos por los que se puede cambiar sin dejar de ser el platillo. */
  permitidos?: string[];
  /** Cotas de porcion propias del platillo (la taza exacta de leche). */
  cotas?: { minUnits?: number; maxUnits?: number };
}

/**
 * Porcion minima de ese alimento EN ESA COMIDA: su minimo digno, o el que haga
 * falta para que la comida llegue a su piso de proteina.
 */
function minDeSlot(slot: Slot): number {
  const base = minGrams(slot.food);
  if (!slot.minProteinG || slot.food.proteinPer100 <= 0) return base;
  const paraElPiso = (slot.minProteinG * 100) / slot.food.proteinPer100;
  return Math.min(Math.max(base, paraElPiso), maxGrams(slot.food));
}

function macrosOf(slot: Slot): { p: number; c: number; f: number; fib: number; kcal: number } {
  const k = slot.grams / 100;
  return {
    p: slot.food.proteinPer100 * k,
    c: slot.food.carbPer100 * k,
    f: slot.food.fatPer100 * k,
    fib: slot.food.fiberPer100 * k,
    kcal: slot.food.kcalPer100 * k,
  };
}

function sum(slots: Slot[], key: 'p' | 'c' | 'f'): number {
  return slots.reduce((acc, s) => acc + macrosOf(s)[key], 0);
}

/**
 * Resuelve gramos por Gauss-Seidel: cada alimento domina su propio macro
 * (proteina exacta, carbo ajusta, grasa cierra). Converge en pocas pasadas.
 */
function solveGrams(
  slots: Slot[],
  target: { p: number; c: number; f: number },
  config: EngineConfig,
): void {
  // Cada alimento cierra el macro de SU ROL, no el del primer macro denso que
  // tenga. La crema de cacahuate trae 20 g de carbohidrato por 100: elegida
  // por densidad terminaba de "fuente de carbohidrato" de una cena sin carbos
  // —el solver le pedia 0 g— y la grasa de esa cena se quedaba sin quien la
  // cerrara. El rol con el que se eligio es el dato que no miente.
  const esProteina = (s: Slot): boolean =>
    s.role ? s.role.startsWith('proteina') : s.food.proteinPer100 >= 8;
  const esCarbo = (s: Slot): boolean =>
    s.role ? DENSE_CARB_ROLES.includes(s.role) || s.role === 'fruta' : s.food.carbPer100 >= 10;
  const esGrasa = (s: Slot): boolean => (s.role ? s.role === 'grasa' : s.food.fatPer100 >= 10);

  // La proteina que el solver cierra es la que sostiene la comida (la que
  // lleva el piso), no la primera que aparezca: en la crema, la leche va
  // antes que la pechuga y no es la que manda.
  const proteinSlot =
    slots.find((s) => !s.fixed && esProteina(s) && s.minProteinG !== undefined) ??
    slots.find((s) => !s.fixed && esProteina(s));
  const carbSlot = slots.find((s) => !s.fixed && esCarbo(s) && s !== proteinSlot);
  const carbSlot2 = slots.find(
    (s) => !s.fixed && esCarbo(s) && s !== proteinSlot && s !== carbSlot,
  );
  const fatSlot = slots.find(
    (s) => !s.fixed && esGrasa(s) && s !== proteinSlot && s !== carbSlot && s !== carbSlot2,
  );

  if (carbSlot2) {
    // El primero se lleva lo que puede; el segundo cierra. Arrancarlo en su
    // tope invertia el reparto —el arroz se quedaba con las sobras del
    // segundo— y el segundo terminaba por debajo de su porcion minima, que es
    // justo lo que hace que se caiga de la comida y el slot vuelva a quedar
    // corto.
    carbSlot2.grams = Math.max(minGrams(carbSlot2.food), 0);
  }

  for (let iter = 0; iter < 24; iter += 1) {
    if (fatSlot) {
      const others = sum(slots.filter((s) => s !== fatSlot), 'f');
      fatSlot.grams = clampGrams(((target.f - others) * 100) / fatSlot.food.fatPer100, fatSlot.food);
    }
    if (carbSlot) {
      const others = sum(slots.filter((s) => s !== carbSlot), 'c');
      carbSlot.grams = clampGrams(((target.c - others) * 100) / carbSlot.food.carbPer100, carbSlot.food);
    }
    if (carbSlot2) {
      const others = sum(slots.filter((s) => s !== carbSlot2), 'c');
      carbSlot2.grams = clampGrams(
        ((target.c - others) * 100) / carbSlot2.food.carbPer100,
        carbSlot2.food,
      );
    }
    if (proteinSlot) {
      const others = sum(slots.filter((s) => s !== proteinSlot), 'p');
      proteinSlot.grams = clampGrams(
        ((target.p - others) * 100) / proteinSlot.food.proteinPer100,
        proteinSlot.food,
      );
    }
  }

  for (const slot of slots) {
    if (slot.fixed) continue;
    slot.raw = Math.max(0, slot.grams);
    slot.grams = quantize(slot.grams, slot.food, config, minDeSlot(slot));
  }

  // Pase de reparacion: ajusta el carbo y luego la grasa en pasos de `roundingG`.
  for (const slot of [carbSlot, carbSlot2, fatSlot, proteinSlot]) {
    if (!slot) continue;
    const step0 = roundingFor(slot.food, config);
    let best = error(slots, target);
    for (let step = 0; step < 12; step += 1) {
      const up = { ...slot, grams: slot.grams + step0 };
      const down = { ...slot, grams: Math.max(0, slot.grams - step0) };
      const errUp = error(slots.map((s) => (s === slot ? up : s)), target);
      const errDown = error(slots.map((s) => (s === slot ? down : s)), target);
      if (errUp < best && errUp <= errDown && up.grams <= maxGrams(slot.food)) {
        slot.grams = up.grams;
        best = errUp;
      } else if (errDown < best && down.grams >= minDeSlot(slot)) {
        slot.grams = down.grams;
        best = errDown;
      } else {
        break;
      }
    }
  }
}

function clampGrams(grams: number, food: Food): number {
  if (!Number.isFinite(grams)) return 0;
  return Math.min(Math.max(grams, 0), maxGrams(food));
}

/**
 * Error relativo (no absoluto): 6 g de grasa de mas pesan mucho mas que
 * 6 g de carbohidrato de mas, porque el target de grasa es cinco veces menor.
 */
function error(slots: Slot[], target: { p: number; c: number; f: number }): number {
  const rel = (got: number, want: number): number => (got - want) / Math.max(want, 8);
  const p = rel(sum(slots, 'p'), target.p);
  const c = rel(sum(slots, 'c'), target.c);
  const f = rel(sum(slots, 'f'), target.f);
  return p * p * 2 + c * c + f * f * 1.5;
}

/** Plural de la unidad casera, como se dice en la cocina. */
const UNIDADES: Record<ServingUnit, [string, string]> = {
  cdita: ['cdita', 'cditas'],
  cda: ['cda', 'cdas'],
  taza: ['taza', 'tazas'],
  media_taza: ['media taza', 'medias tazas'],
  pieza: ['pieza', 'piezas'],
  rebanada: ['rebanada', 'rebanadas'],
  scoop: ['scoop', 'scoops'],
  g: ['g', 'g'],
};

/** Fracciones como se sirven: "1½", no "1.5". */
function formatoUnidades(cantidad: number): string {
  const entero = Math.floor(cantidad + 1e-9);
  const resto = cantidad - entero;
  const fraccion = resto < 0.125 ? '' : resto < 0.375 ? '¼' : resto < 0.625 ? '½' : resto < 0.875 ? '¾' : '';
  const acarreo = resto >= 0.875 ? 1 : 0;
  const cabeza = entero + acarreo;
  if (fraccion === '') return String(cabeza);
  return cabeza === 0 ? fraccion : `${cabeza}${fraccion}`;
}

/** El macro que ese alimento viene a cerrar, en el vocabulario del dueno. */
function cierraQue(food: Food, role?: FoodRole): MenuItemWhy['closes'] {
  const efectivo = role ?? food.role;
  if (efectivo === 'vegetal_libre') return 'fibra';
  const macro = macroDominante(food, efectivo);
  if (macro === 'p') return 'proteina';
  if (macro === 'f') return 'grasa';
  return 'carbo';
}

/**
 * La porcion en el idioma de la cocina: "2 cditas de aceite de oliva (10 g)".
 *
 * Los gramos no desaparecen —siguen siendo la cifra exacta— pero dejan de ser
 * lo primero que hay que interpretar. Nadie pesa una cucharadita.
 */
function describirPorcion(
  food: Food,
  gramos: number,
  free: boolean,
  role: FoodRole | undefined,
): { display: string; why: MenuItemWhy } {
  const nombre = food.name.charAt(0).toLowerCase() + food.name.slice(1);
  const why: MenuItemWhy = {
    role: role ?? food.role,
    closes: cierraQue(food, role),
    units: gramos,
    unitLabel: 'g',
    ...(free ? { note: 'libre' } : {}),
  };

  const s = food.serving;
  if (!s || s.unit === 'g') {
    return { display: `${gramos} g de ${nombre}`, why };
  }

  const unidades = gramos / s.gramsPerUnit;
  const texto = formatoUnidades(unidades);
  // El plural sigue a la CANTIDAD, no a la fraccion: "½ pieza" y "1 pieza"
  // van en singular, "1½ tazas" en plural. Antes, cualquier cosa distinta de
  // uno pluralizaba y salia "½ piezas de manzana", que no lo dice nadie.
  const plural = unidades > 1 + 1e-9 ? 1 : 0;
  const etiqueta = UNIDADES[s.unit][plural]!;

  const nota = free
    ? 'libre'
    : unidades <= s.minUnits + 1e-9
      ? 'porcion minima'
      : unidades >= s.maxUnits - 1e-9
        ? 'tope de la porcion'
        : undefined;

  return {
    display: `${texto} ${etiqueta} de ${nombre} (${gramos} g)`,
    why: {
      ...why,
      units: Math.round(unidades * 100) / 100,
      unitLabel: etiqueta,
      ...(nota ? { note: nota } : {}),
    },
  };
}

function toItem(slot: Slot, free: boolean): MenuItem {
  const m = macrosOf(slot);
  const gramos = Math.round(slot.grams);
  const { display, why } = describirPorcion(slot.food, gramos, free, slot.role);
  return {
    foodId: slot.food.id,
    name: slot.food.name,
    grams: gramos,
    display,
    why,
    proteinG: round1(m.p),
    carbG: round1(m.c),
    fatG: round1(m.f),
    fiberG: round1(m.fib),
    kcal: Math.round(m.kcal),
    free,
    ...(slot.preparacion ? { preparacion: slot.preparacion } : {}),
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function primaryMacroOf(role: FoodRole): 'proteinPer100' | 'carbPer100' | 'fatPer100' {
  if (role === 'proteina_magra' || role === 'proteina_grasa') return 'proteinPer100';
  if (role === 'grasa') return 'fatPer100';
  return 'carbPer100';
}

function equivalencesFor(
  slot: Slot,
  pool: Food[],
  profile: Profile,
  config: EngineConfig,
): Equivalence | null {
  // Los suplementos no tienen equivalente honesto: la creatina es un compuesto,
  // no un alimento, y ofrecer "canela en vez de psyllium" seria fingir que son
  // intercambiables. Se quedan sin opciones a proposito.
  if (slot.food.role === 'suplemento') return null;

  // El ingrediente de un platillo solo se cambia por otro del mismo platillo:
  // la crema de calabacita no admite "cambia la calabacita por jicama".
  if (slot.permitidos !== undefined) {
    const permitidos = slot.permitidos;
    const base = equivalencesFor({ ...slot, permitidos: undefined }, pool, profile, config);
    if (!base) return null;
    const options = base.options.filter((o) => permitidos.includes(o.foodId));
    if (options.length === 0) return null;
    const { aproximada: _aproximada, ...resto } = base;
    return {
      ...resto,
      options,
      ...(options.some((o) => o.aproximada) ? { aproximada: true } : {}),
    };
  }

  // Los vegetales libres SI tienen equivalencias — y son las mas faciles de
  // dar: "libre" significa que la cantidad no esta contada, asi que cualquier
  // otro vegetal libre del catalogo (que pase exclusiones y dieta) sirve tal
  // cual, con los mismos gramos sugeridos. No hay macro que cuadrar.
  if (slot.food.role === 'vegetal_libre') {
    const opciones = eligible(pool, profile, config, 'vegetal_libre', { freeVegetable: true })
      .filter((f) => f.id !== slot.food.id)
      .sort((a, b) => {
        // Los favoritos del perfil primero; el resto alfabetico, para que la
        // lista sea estable entre generaciones.
        const favA = matchesAny(a, profile.favoriteFoods) ? 0 : 1;
        const favB = matchesAny(b, profile.favoriteFoods) ? 0 : 1;
        return favA - favB || a.name.localeCompare(b.name);
      })
      .slice(0, config.equivalencesPerItem)
      .map((f) => ({ foodId: f.id, name: f.name, grams: Math.round(slot.grams) }));

    if (opciones.length === 0) return null;
    return { forFoodId: slot.food.id, forName: slot.food.name, options: opciones };
  }

  const key = primaryMacroOf(slot.food.role);
  const base = slot.food[key];
  if (base <= 0 || slot.grams <= 0) return null;

  const objetivo = (slot.grams * base) / 100;

  /** Candidatos ya con gramos redondeados y su desviacion real, de menor a mayor. */
  const candidatos = eligible(pool, profile, config, slot.food.role)
    .filter((f) => f.id !== slot.food.id && f[key] > 0)
    .map((f) => {
      const paso = roundingFor(f, config);
      const ideal = quantize((slot.grams * base) / f[key], f, config);
      // Los gramos se topan al maximo del alimento en vez de descartarlo:
      // antes, una porcion grande (300 g de platano) se quedaba sin ninguna
      // equivalencia porque CUALQUIER sustituto pedia mas gramos de los que
      // se puede servir de el. Topado, el arroz o el camote siguen sirviendo
      // —cubren casi todo el carbohidrato— y la desviacion que queda se mide
      // abajo y decide si la equivalencia es exacta, aproximada o ninguna.
      const grams = Math.max(paso, ideal);
      // La desviacion se mide DESPUES de redondear y topar, que es como la va
      // a comer quien la siga: una porcion que se pasa del tope ya no es
      // equivalente, es otra comida.
      const real = (grams * f[key]) / 100;
      const desviacion = objetivo <= 0 ? 0 : Math.abs(real - objetivo) / objetivo;
      return { food: f, option: { foodId: f.id, name: f.name, grams }, desviacion };
    })
    .sort((a, b) => a.desviacion - b.desviacion);

  // El recorte va DESPUES de filtrar y ordenar por desviacion real: antes se
  // tomaban los mas parecidos en densidad y solo entonces se revisaba el
  // tope, asi que un alimento cuyos vecinos se pasaban se quedaba sin ninguna
  // opcion aunque el catalogo tuviera otras que si cumplian.
  // Se llena hasta `equivalencesPerItem` opciones: primero las exactas (dentro
  // del +-10 % que promete una equivalencia), y si no alcanzan para llenar la
  // lista se completan con las mas cercanas de las aproximadas. Antes bastaba
  // con que hubiera UNA exacta para descartar todas las demas, asi que un
  // alimento podia quedarse con una sola opcion aunque el catalogo tuviera
  // otras dos casi igual de buenas — y una sola opcion no es elegir.
  const exactas = candidatos.filter((c) => c.desviacion <= config.equivalenceMaxDeviation);
  const aproximadas = candidatos.filter(
    (c) =>
      c.desviacion > config.equivalenceMaxDeviation &&
      c.desviacion <= config.equivalenceFallbackDeviation,
  );

  const elegidas = [...exactas, ...aproximadas].slice(0, config.equivalencesPerItem);
  if (elegidas.length === 0) return null;

  return {
    forFoodId: slot.food.id,
    forName: slot.food.name,
    options: elegidas.map((c) =>
      c.desviacion > config.equivalenceMaxDeviation
        ? { ...c.option, aproximada: true }
        : c.option,
    ),
    // La equivalencia entera se marca aproximada cuando alguna de sus opciones
    // lo es: la app avisa una vez arriba en vez de repetirlo por renglon.
    ...(elegidas.some((c) => c.desviacion > config.equivalenceMaxDeviation)
      ? { aproximada: true }
      : {}),
  };
}

/**
 * Equivalencias de un alimento suelto, resolviendolo por NOMBRE.
 *
 * Existe para los menus que ya estan guardados: un menu generado antes de que
 * el motor supiera dar equivalencias de vegetales libres —o antes de que
 * llenara la lista hasta cinco opciones— se queda con esos huecos para
 * siempre, y la unica salida era regenerar el menu completo, que le borra a
 * la persona los cambios que ya habia elegido. Con esto el servidor puede
 * rellenar SOLO lo que falta, sin tocar lo demas.
 *
 * Se resuelve por nombre porque eso es lo unico que guarda el JSON de la
 * comida. Si el nombre no existe en el catalogo (un alimento renombrado, uno
 * capturado a mano), devuelve `null` en vez de adivinar.
 */
export function equivalenciasDeAlimento(
  nombre: string,
  gramos: number,
  profile: Profile,
  config: EngineConfig = DEFAULT_CONFIG,
  pool: Food[] = FOODS,
): Equivalence | null {
  const buscado = normalize(nombre);
  const food = pool.find((f) => normalize(f.name) === buscado || normalize(f.id) === buscado);
  if (food === undefined || gramos <= 0) return null;

  return equivalencesFor({ food, grams: gramos, fixed: false }, pool, profile, config);
}

/**
 * Deja solo los alimentos que pueden cubrir el macro del slot sin pasarse de
 * su tope de gramos, y con densidad suficiente para no ser un relleno.
 * Si ninguno califica, devuelve la lista original.
 */
function feasible(
  candidates: Food[],
  key: 'proteinPer100' | 'carbPer100' | 'fatPer100',
  targetG: number,
  minDensity: number,
): Food[] {
  const alcance = (f: Food): number => (maxGrams(f) * f[key]) / 100;
  const ok = candidates.filter((f) => f[key] >= minDensity && alcance(f) >= targetG * 0.9);
  if (ok.length > 0) return ok;

  // Cuando NINGUN alimento solo alcanza el macro del slot —el post-entreno de
  // 99 g de carbohidrato: ni la tortilla ni el arroz llegan— la eleccion deja
  // de ser libre. Antes se sorteaba entre todo el catalogo y podia caer el
  // platano, que cubre 27 g y deja el slot corto para siempre. Se sortea entre
  // los que mas cubren, y el segundo alimento cierra el resto.
  const densos = candidates.filter((f) => f[key] >= minDensity);
  const pool = densos.length > 0 ? densos : candidates;
  const mejor = Math.max(...pool.map(alcance));
  const cercanos = pool.filter((f) => alcance(f) >= mejor * 0.6);
  return cercanos.length > 0 ? cercanos : pool;
}

function slotCarbRole(slotId: MealSlot['id']): FoodRole {
  if (slotId === 'PRE') return 'carbo_pre';
  if (slotId === 'POST') return 'carbo_post';
  return 'carbo_complejo';
}

/**
 * La forma de cada comida del dia.
 *
 * Los macros dicen CUANTO, no QUE. Sin esta tabla el motor servia atun a las
 * siete de la mañana, mantequilla sobre el pescado y una cena de nopal con
 * arroz sin nada de proteina: todo cuadraba y nada se comia. Aqui vive la
 * forma del plato, por slot, no por alimento.
 */
interface Plantilla {
  /** Roles de los que puede salir el carbohidrato del plato. */
  carbRoles: FoodRole[];
  /** Subtipos admitidos. Vacio = el que sea de esos roles. */
  subtipos: string[];
  /** Cuantos alimentos caben, sin contar el vegetal libre. */
  maxAlimentos: number;
  /** Lleva fruta fija (el pre-entreno y el post). */
  fruta: boolean;
  /** Gramos de proteina que su fuente tiene que aportar. 0 = no exige. */
  proteinaMinG: number;
}

/** Hora "HH:MM" a hora entera; sirve para saber si un slot es de mañana. */
function horaDe(timeHint: string): number {
  return Number(timeHint.split(':')[0] ?? 12);
}

/**
 * Un PRE puede ser el desayuno (7:00, entreno en la mañana) o una colacion de
 * las cinco de la tarde. Lo que decide es la hora, no el id del slot.
 */
function esDesayuno(slot: MealSlot): boolean {
  if (slot.id === 'DESAYUNO') return true;
  return slot.id === 'PRE' && horaDe(slot.timeHint) <= 10;
}

function plantillaDe(slot: MealSlot, config: EngineConfig): Plantilla {
  const principal = config.maxFoodsPerMeal;
  const ligera = config.maxFoodsPerLightMeal;

  if (slot.id === 'DESAYUNO' || (slot.id === 'PRE' && esDesayuno(slot))) {
    // Fruta + proteina de desayuno + UN cereal de desayuno.
    return {
      // El camote del desayuno es tan de gimnasio como la avena, y en un
      // desayuno que carga 160 g de carbohidrato ningun cereal solo alcanza.
      carbRoles: ['carbo_pre', 'carbo_complejo', 'carbo_post'],
      subtipos: ['cereal_desayuno', 'tuberculo'],
      maxAlimentos: slot.id === 'DESAYUNO' ? principal : ligera,
      fruta: true,
      proteinaMinG: config.mealProteinMinG,
    };
  }
  if (slot.id === 'PRE') {
    // Colacion pre-entreno: carbohidrato rapido y fruta.
    return {
      carbRoles: ['carbo_pre', 'carbo_post'],
      subtipos: [],
      maxAlimentos: ligera,
      fruta: true,
      proteinaMinG: config.mealProteinMinG,
    };
  }
  if (slot.id === 'POST') {
    return {
      carbRoles: ['carbo_post'],
      subtipos: [],
      maxAlimentos: ligera,
      fruta: true,
      proteinaMinG: config.mealProteinMinG,
    };
  }
  if (slot.id === 'SNACK') {
    return {
      carbRoles: ['carbo_complejo'],
      subtipos: ['cereal_desayuno'],
      maxAlimentos: ligera,
      fruta: false,
      // La colacion pide menos que una comida, pero algo pide: sin piso salia
      // avena con aguacate, que es cereal con grasa y nada mas.
      proteinaMinG: config.snackProteinMinG,
    };
  }
  if (slot.id === 'CENA') {
    // La cena lleva carbohidrato LIGERO, si lleva: tortilla, tuberculo o
    // leguminosa. Nunca la taza de pasta de la comida.
    return {
      carbRoles: ['carbo_complejo', 'carbo_post'],
      subtipos: ['ligero'],
      maxAlimentos: principal,
      fruta: false,
      proteinaMinG: config.mealProteinMinG,
    };
  }
  return {
    carbRoles: ['carbo_complejo', 'carbo_post'],
    subtipos: ['cereal_comida', 'tuberculo', 'leguminosa'],
    maxAlimentos: principal,
    fruta: false,
    proteinaMinG: config.mealProteinMinG,
  };
}

interface Residual {
  p: number;
  c: number;
  f: number;
}

/**
 * Familias del platillo. No son roles del motor sino como se ve la comida en
 * el plato: una cena con aceite Y crema de cacahuate cuadra macros y aun asi
 * nadie la cocina.
 */
const FAMILIAS = ['grasa_anadida', 'leguminosa', 'cereal_cocido', 'fruto_seco'] as const;
type Familia = (typeof FAMILIAS)[number];

function topeDeFamilia(familia: Familia, config: EngineConfig): number {
  const c = config.composicion;
  if (familia === 'grasa_anadida') return c.grasaAnadidaMaxGPorComida;
  if (familia === 'leguminosa') return c.leguminosaMaxGPorComida;
  if (familia === 'cereal_cocido') return c.cerealCocidoMaxGPorComida;
  return c.frutoSecoMaxGPorComida;
}

function gramosDeFamilia(comida: Slot[], familia: Familia): number {
  return comida
    .filter((s) => s.food.tags.includes(familia))
    .reduce((acc, s) => acc + s.grams, 0);
}

/**
 * Garantiza la proteina de la comida.
 *
 * El piso vive en el slot que se eligio como proteina, pero el dia lo mueve
 * todo: sustituye alimentos, poda y reparte gramos. Esto es la ultima palabra
 * —se corre al final, cuando ya nadie va a mover nada— para que ninguna comida
 * principal termine siendo una guarnicion.
 */
function asegurarProteina(comida: Slot[], config: EngineConfig): void {
  const exigido = Math.max(0, ...comida.map((s) => s.minProteinG ?? 0));
  if (exigido <= 0) return;

  const aporte = (s: Slot): number => (s.grams * s.food.proteinPer100) / 100;
  if (comida.some((s) => aporte(s) >= exigido - 1e-6)) return;

  const candidatos = comida
    .filter((s) => !s.fixed && (s.role ?? s.food.role).startsWith('proteina'))
    .sort((a, b) => maxGrams(b.food) * b.food.proteinPer100 - maxGrams(a.food) * a.food.proteinPer100);
  const mejor = candidatos[0];
  if (!mejor) return;

  mejor.minProteinG = exigido;
  const piso = minDeSlot(mejor);
  mejor.grams = Math.round(quantize(Math.max(mejor.grams, piso), mejor.food, config, piso));
}

/**
 * Los alimentos que se cuentan como ingrediente: el vegetal libre no cuenta, y
 * un platillo cuenta como uno solo —el licuado es una cosa en la mesa, aunque
 * lleve cuatro alimentos—. Del platillo se queda su primer renglon como
 * representante.
 */
function ingredientesDe(comida: Slot[]): Slot[] {
  const vistos = new Set<string>();
  return comida.filter((s) => {
    if (s.preparacion) {
      if (vistos.has(s.preparacion.id)) return false;
      vistos.add(s.preparacion.id);
      return true;
    }
    return (s.role ?? s.food.role) !== 'vegetal_libre';
  });
}

/** Cuantos ingredientes admite esa comida segun su plantilla. */
function limiteDe(comida: Slot[], config: EngineConfig): number {
  return comida.find((s) => s.maxEnComida !== undefined)?.maxEnComida ?? config.maxFoodsPerMeal;
}

/** Los alimentos de la comida que son fuente de grasa, anadida o entera. */
function grasasDe(comida: Slot[]): Slot[] {
  return comida.filter((s) => (s.role ?? s.food.role) === 'grasa');
}

/** Los alimentos de la comida que son fuente de carbohidrato denso. */
function carbosDe(comida: Slot[]): Slot[] {
  return comida.filter((s) => DENSE_CARB_ROLES.includes(s.role ?? s.food.role));
}

/** true si la comida se pasa de algun tope de composicion. */
function violaComposicion(comida: Slot[], config: EngineConfig): boolean {
  const grasas = comida.filter((s) => s.food.tags.includes('grasa_anadida'));
  if (grasas.length > config.composicion.maxGrasasAnadidasPorComida) return true;
  if (grasasDe(comida).length > config.composicion.maxGrasasPorComida) return true;
  if (ingredientesDe(comida).length > limiteDe(comida, config)) return true;

  // Dos carbohidratos del mismo subtipo son el mismo plato dos veces: avena
  // con pan, frijol con haba, arroz con pasta.
  const nombres = comida.map((s) => normalize(s.food.name));
  if (new Set(nombres).size !== nombres.length) return true;

  const carbos = carbosDe(comida);
  if (carbos.length > config.composicion.maxCarbosPorComida) return true;
  for (const subtipo of config.composicion.subtiposDeCarbo) {
    if (carbos.filter((s) => s.food.tags.includes(subtipo)).length > 1) return true;
  }
  return FAMILIAS.some(
    (familia) => gramosDeFamilia(comida, familia) > topeDeFamilia(familia, config) + 1e-6,
  );
}

/**
 * Baja la comida a sus topes de composicion. Primero recorta gramos hasta la
 * porcion minima de los ultimos que entraron; si aun asi se pasa, los saca.
 * El primero de cada familia nunca se toca: es el que define el platillo.
 */
function aplicarComposicion(comida: Slot[], config: EngineConfig): void {
  // Repetidos de subtipo y carbohidratos de mas: se queda el primero, que es
  // el que definio el plato, y salen los que llegaron a acompañarlo.
  for (const subtipo of config.composicion.subtiposDeCarbo) {
    const delSubtipo = carbosDe(comida).filter((s) => s.food.tags.includes(subtipo));
    for (const repetido of delSubtipo.slice(1)) {
      comida.splice(comida.indexOf(repetido), 1);
    }
  }
  for (const sobrante of carbosDe(comida).slice(config.composicion.maxCarbosPorComida)) {
    comida.splice(comida.indexOf(sobrante), 1);
  }

  const anadidas = comida.filter((s) => s.food.tags.includes('grasa_anadida'));
  for (const sobrante of anadidas.slice(config.composicion.maxGrasasAnadidasPorComida)) {
    const donde = comida.indexOf(sobrante);
    if (donde >= 0) comida.splice(donde, 1);
  }
  for (const sobrante of grasasDe(comida).slice(config.composicion.maxGrasasPorComida)) {
    comida.splice(comida.indexOf(sobrante), 1);
  }

  // Lo que sobra del tope de ingredientes sale por el final —los ultimos que
  // entraron fueron refuerzos—, y nunca la proteina, que es la que sostiene
  // la comida.
  const limite = limiteDe(comida, config);
  for (let vuelta = 0; ingredientesDe(comida).length > limite && vuelta < 4; vuelta += 1) {
    const prescindibles = ingredientesDe(comida).filter(
      (s) => s.minProteinG === undefined && s.preparacion === undefined,
    );
    const ultimo = prescindibles[prescindibles.length - 1];
    if (!ultimo) break;
    comida.splice(comida.indexOf(ultimo), 1);
  }

  for (const familia of FAMILIAS) {
    const tope = topeDeFamilia(familia, config);
    for (let vuelta = 0; vuelta < 4; vuelta += 1) {
      const miembros = comida.filter((s) => s.food.tags.includes(familia));
      const total = miembros.reduce((acc, s) => acc + s.grams, 0);
      if (total <= tope + 1e-6 || miembros.length === 0) break;

      const ultimo = miembros[miembros.length - 1]!;
      const exceso = total - tope;
      // Se recorta a una porcion legal, no a "lo que sobra": media taza menos
      // sigue siendo media taza; 137 g de frijol no es nada.
      const recortado = quantize(ultimo.grams - exceso, ultimo.food, config);
      if (recortado <= ultimo.grams - exceso + 1e-6 && recortado < ultimo.grams) {
        ultimo.grams = recortado;
        continue;
      }
      if (miembros.length === 1) {
        ultimo.grams = Math.min(ultimo.grams, tope);
        break;
      }
      comida.splice(comida.indexOf(ultimo), 1);
    }
  }
}

/** Los que se llevan bien con lo que ya esta en el plato, para pesar el sorteo. */
function preferidosDe(candidatos: Food[], comida: Slot[], config: EngineConfig): Set<string> {
  return new Set(
    candidatos
      .filter((f) => comida.some((s) => afines(f, s.food, config)))
      .map((f) => f.id),
  );
}

/** Gramos de ese macro que aporta un gramo del alimento. */
function densidad(food: Food, macro: 'p' | 'c' | 'f'): number {
  const por100 =
    macro === 'p' ? food.proteinPer100 : macro === 'c' ? food.carbPer100 : food.fatPer100;
  return por100 / 100;
}

/** Macro que ese alimento viene a cerrar en la comida. */
function macroDominante(food: Food, role?: FoodRole): 'p' | 'c' | 'f' {
  const key = primaryMacroOf(role ?? food.role);
  if (key === 'proteinPer100') return 'p';
  if (key === 'fatPer100') return 'f';
  return 'c';
}

/**
 * Resuelve gramos y arregla lo que NO cabe en una porcion de verdad.
 *
 * El solver por si solo estira: si al slot le faltan 40 g de carbohidrato,
 * pide 400 g de arroz; si le sobran, deja 12 g de aguacate. Ninguna de las dos
 * es comida. Aqui se cierran las dos salidas:
 *
 * (a) lo que se queda por debajo de su porcion minima se cae de la comida y el
 *     resto se reparte —salvo que sea el unico que cubre ese macro, en cuyo
 *     caso se sirve en su minimo digno y el sobrante lo absorbe el dia;
 * (b) lo que se pasa de su tope no se estira: entra un SEGUNDO alimento del
 *     mismo rol y se vuelve a resolver.
 */
function ajustarPorciones(
  slots: Slot[],
  target: { p: number; c: number; f: number },
  profile: Profile,
  config: EngineConfig,
  pool: Food[],
  filters: EligibleOptions,
  random: () => number,
  avoid: Set<string>,
  plantilla: Plantilla,
): void {
  // Un macro se refuerza a lo mucho dos veces. Sin freno, cada pasada metia
  // otro alimento del mismo rol y la comida terminaba con tres leguminosas: la
  // suma de sus minimos se pasaba del target por mas de lo que faltaba. Lo que
  // falte despues lo cierra la reparacion del dia moviendo gramos.
  const reforzados: Record<'p' | 'c' | 'f', number> = { p: 0, c: 0, f: 0 };
  const MAX_REFUERZOS = 2;

  for (let intento = 0; intento < 4; intento += 1) {
    solveGrams(slots, target, config);
    const movibles = slots.filter((s) => !s.fixed);

    const flaco = movibles.find(
      (s) => (s.raw ?? s.grams) < minGrams(s.food) - roundingFor(s.food, config) / 2,
    );
    if (flaco) {
      const macro = macroDominante(flaco.food, flaco.role);
      const hayRelevo = movibles.some(
        (s) => s !== flaco && macroDominante(s.food, s.role) === macro,
      );
      // Sale si otro alimento cubre su macro, o si su porcion minima se pasa
      // de lo que la comida pide: en keto la avena entra por 6 g de
      // carbohidrato y su media taza trae 10, asi que la comida no la
      // necesita, la padece.
      const seExcede = minGrams(flaco.food) * densidad(flaco.food, macro) > target[macro] * 1.5;
      // La proteina de la comida no se cae aunque sobre: una comida sin
      // proteina no es una comida, es una guarnicion.
      const esLaProteina = flaco.minProteinG !== undefined;
      // Lo que el platillo requiere se sirve en su porcion minima: un licuado
      // de fresa con avena sin avena ya es otro licuado.
      if (!esLaProteina && !flaco.requerido && (hayRelevo || seExcede)) {
        slots.splice(slots.indexOf(flaco), 1);
        continue;
      }
    }

    // (b) el macro que se quedo corto porque su alimento ya toco su tope. No se
    // detecta con los gramos que pidio el solver (vienen ya recortados al
    // tope), sino con lo que falta en el plato: si al carbohidrato le faltan
    // 50 g y el arroz ya va en su taza y cuarto, lo que falta es OTRO
    // carbohidrato, no mas arroz.
    // Se atiende el macro MAS corto que ademas tenga a su alimento topado, no
    // el primero de la lista: si la proteina va corta 3 g pero nadie esta
    // topado, y al carbohidrato le faltan 60 g con el arroz en su taza y
    // cuarto, el que necesita un segundo alimento es el carbohidrato.
    const topadoDe = (macro: 'p' | 'c' | 'f'): Slot | undefined =>
      movibles.find(
        (s) =>
          s.role !== undefined &&
          macroDominante(s.food, s.role) === macro &&
          // `raw` es lo que el solver pidio antes de encajarlo en la medida
          // casera: si pidio el tope, el alimento ya dio todo lo que tenia,
          // aunque el pase de reparacion lo haya dejado por debajo.
          Math.max(s.grams, s.raw ?? 0) >= maxGrams(s.food) - 1e-6,
      );

    const cortos = (['p', 'c', 'f'] as const)
      .filter((macro) => {
        if (target[macro] <= 0 || reforzados[macro] >= MAX_REFUERZOS) return false;
        return target[macro] - sum(slots, macro) > Math.max(target[macro] * 0.12, 3);
      })
      .sort(
        (a, b) =>
          (target[b] - sum(slots, b)) / target[b] - (target[a] - sum(slots, a)) / target[a],
      );

    const faltante = cortos.find((macro) => topadoDe(macro) !== undefined);
    const topado = faltante ? topadoDe(faltante) : undefined;
    if (topado && topado.role && faltante && ingredientesDe(slots).length < limiteDe(slots, config)) {
      const yaEstan = new Set(slots.map((s) => s.food.id));
      const falta = target[faltante] - sum(slots, faltante);
      const clave = primaryMacroOf(topado.role);
      // El refuerzo tambien vive en la plantilla del slot: la cena no se
      // refuerza con pasta ni el desayuno con frijol. Y busca en TODOS los
      // roles de carbohidrato que la plantilla admite, no solo en el del
      // alimento topado: el desayuno se completa con avena (carbo_pre) aunque
      // el que se topo haya sido el camote (carbo_post).
      const esCarbo = DENSE_CARB_ROLES.includes(topado.role);
      const rolesDelRefuerzo = esCarbo ? plantilla.carbRoles : [topado.role];
      const opciones: EligibleOptions = {
        ...filters,
        ...(esCarbo ? { subtipos: plantilla.subtipos } : {}),
        acompanan: slots.map((s) => s.food),
      };
      const candidatos = rolesDelRefuerzo
        .flatMap((role) => eligible(pool, profile, config, role, opciones))
        .filter((f, i, todos) => todos.findIndex((o) => o.id === f.id) === i)
        // La afinidad es dura para el refuerzo: `eligible` la afloja si deja
        // el rol vacio, y asi entraba aguacate junto a la crema de cacahuate.
        .filter((f) => !slots.some((s) => incompatibles(f, s.food, config)))
        .filter(
        // El segundo alimento tiene que CABER en el hueco: si su porcion
        // minima ya se pasa de lo que falta, meterlo cambia un plato corto por
        // uno pasado, y eso no es arreglarlo.
        (f) => !yaEstan.has(f.id) && (minGrams(f) * f[clave]) / 100 <= falta * 1.2,
      );
      // Primero los que ademas ALCANZAN a cerrar el hueco: si uno solo puede,
      // se prefiere a dos a medias.
      // Un refuerzo que rompe el platillo no es refuerzo: la segunda grasa
      // anadida, la tercera taza de frijol.
      const caben = candidatos.filter(
        (f) => !violaComposicion([...slots, { food: f, grams: minGrams(f), fixed: false }], config),
      );
      const alcance = (f: Food): number => (maxGrams(f) * f[clave]) / 100;
      const cubren = caben.filter((f) => alcance(f) >= falta * 0.8);
      // Si ninguno alcanza a cerrar el hueco, se sortea entre los que mas
      // cubren: meter 5 g de ajonjoli cuando faltan 25 g de grasa gasta el
      // refuerzo sin arreglar la comida.
      const mejor = caben.length > 0 ? Math.max(...caben.map(alcance)) : 0;
      const finalistas =
        cubren.length > 0 ? cubren : caben.filter((f) => alcance(f) >= mejor * 0.6);
      const segundo = pick(
        finalistas,
        profile,
        random,
        avoid,
        preferidosDe(finalistas, slots, config),
      );
      if (segundo) {
        reforzados[faltante] += 1;
        slots.push({
          food: segundo,
          grams: minGrams(segundo) || 50,
          fixed: false,
          // El rol es el del alimento que entro, no el del que se topo: el
          // desayuno se refuerza con avena (carbo_pre) aunque el topado fuera
          // el camote (carbo_post), y de ese rol salen su explicacion y sus
          // equivalencias.
          role: segundo.role,
          maxEnComida: limiteDe(slots, config),
        });
        avoid.add(segundo.id);
        continue;
      }
    }

    return;
  }
}

// ---------------------------------------------------------------------------
// Preparaciones: licuados, sopas, cremas y caldos
// ---------------------------------------------------------------------------

/** Probabilidad de servir un licuado en un slot que lo admite. */
const PROBA_LICUADO = 0.35;
/** Probabilidad de servir sopa, crema o caldo en la comida o la cena. */
const PROBA_PLATO = 0.4;

/**
 * La misma comida con las cotas del platillo: el licuado lleva UNA taza de
 * leche, no "de media a taza y cuarto". Solo estrecha —nunca abre— la medida
 * casera del alimento, asi que la porcion sigue siendo una que se sirve.
 */
function acotar(food: Food, cotas?: { minUnits?: number; maxUnits?: number }): Food {
  if (!cotas || !food.serving) return food;
  const s = food.serving;
  const minUnits = Math.min(Math.max(cotas.minUnits ?? s.minUnits, s.minUnits), s.maxUnits);
  const maxUnits = Math.max(Math.min(cotas.maxUnits ?? s.maxUnits, s.maxUnits), minUnits);
  if (minUnits === s.minUnits && maxUnits === s.maxUnits) return food;
  return { ...food, serving: { ...s, minUnits, maxUnits } };
}

/** true si la persona acepta ese tipo de platillo. Sin preferencia, todos. */
function tipoAceptado(prep: Preparacion, profile: Profile): boolean {
  const pref = profile.preparaciones;
  if (!pref) return true;
  if (prep.tipo === 'licuado') return pref.licuados;
  if (prep.tipo === 'crema') return pref.cremas;
  return pref.sopas;
}

/**
 * Los platillos que caben en ese slot para esa persona, antes de ver si sus
 * ingredientes pasan: tipo aceptado, slot, estilo de dieta, tiempo de cocina
 * y presupuesto.
 */
function preparacionesPara(slot: MealSlot, profile: Profile): Preparacion[] {
  // Un PRE a las dos de la tarde es la comida del dia: ahi no va un licuado.
  const hora = horaDe(slot.timeHint);
  const preEsComida = slot.id === 'PRE' && hora > 10 && hora < 16;
  const topeDeCosto = profile.budget === 'bajo' ? 1 : profile.budget === 'medio' ? 2 : 3;
  return PREPARACIONES.filter((prep) => {
    if (!prep.slots.includes(slot.id)) return false;
    if (prep.tipo === 'licuado' && preEsComida) return false;
    if (!tipoAceptado(prep, profile)) return false;
    // Keto cambia la formula: solo entra lo que no depende de fruta ni cereal.
    if (profile.diet === 'keto' && !prep.tags.includes('keto_ok')) return false;
    if (prep.costRel > topeDeCosto) return false;
    const minutos = prep.tags.includes('meal_prep')
      ? Math.min(prep.prepMin, MINUTOS_CALENTAR)
      : prep.prepMin;
    if (profile.maxPrepMin !== undefined && minutos > profile.maxPrepMin) return false;
    return true;
  });
}

/** El platillo de la comida, si toca uno. */
interface PlatilloResuelto {
  slots: Slot[];
  cubre: { proteina: boolean; carbo: boolean; grasa: boolean; fruta: boolean; verdura: boolean };
}

/**
 * Arma un platillo con alimentos del catalogo, o nada.
 *
 * Cada ingrediente pasa las mismas reglas que un alimento suelto —exclusiones,
 * dieta, presupuesto, polvos, plantilla del slot, afinidad—. Si un ingrediente
 * requerido no pasa, el platillo no se sirve (no se sirve "licuado de fresa
 * sin fresa"); si es opcional, se omite. Los fijos entran con su porcion; los
 * demas los resuelve el solver como cualquier alimento.
 */
function resolverPreparacion(
  prep: Preparacion,
  slot: MealSlot,
  profile: Profile,
  config: EngineConfig,
  pool: Food[],
  filters: EligibleOptions,
  plantilla: Plantilla,
  vaCarbohidrato: boolean,
  random: () => number,
  avoid: Set<string>,
): PlatilloResuelto | undefined {
  const ref: PreparacionRef = { id: prep.id, nombre: prep.nombre, tipo: prep.tipo };
  const slots: Slot[] = [];
  const cubre = { proteina: false, carbo: false, grasa: false, fruta: false, verdura: false };

  const admisible = (food: Food): boolean => {
    const esCarbo = DENSE_CARB_ROLES.includes(food.role);
    const pasa =
      eligible([food], profile, config, food.role, {
        ...filters,
        quickOnly: false,
        estricto: true,
        ...(esCarbo ? { subtipos: plantilla.subtipos } : {}),
      }).length === 1;
    return pasa && !slots.some((s) => incompatibles(food, s.food, config));
  };

  // El platillo no puede pasarse de la proteina de la comida con solo sus
  // porciones minimas: una sopa con 100 g de pechuga y media taza de garbanzo
  // ya son 38 g, y en la comida de alguien que pide 26 no hay como bajarla.
  const topeDeProteina = slot.proteinG * 1.1;
  let proteinaMinima = 0;
  const proteinaQueAporta = (food: Food, fijo: boolean, gramos: number | undefined): number => {
    const base = gramosDeIngrediente(food, fijo, gramos, config);
    const esLaProteina = !fijo && food.role.startsWith('proteina') && !cubre.proteina;
    const conPiso =
      esLaProteina && food.proteinPer100 > 0
        ? Math.max(base, (plantilla.proteinaMinG * 100) / food.proteinPer100)
        : base;
    return (conPiso * food.proteinPer100) / 100;
  };

  for (const ing of prep.ingredientes) {
    const ids = ing.foodId ? [ing.foodId] : (ing.opciones ?? []);
    const esFijo = (f: Food): boolean =>
      ing.fijo === true || f.role === 'fruta' || f.role === 'vegetal_libre';
    const candidatos = ids
      .map((id) => pool.find((f) => f.id === id))
      .filter((f): f is Food => f !== undefined)
      .filter((f) => !ing.rolePool || ing.rolePool.includes(f.role))
      .filter(admisible)
      // Sin carbohidrato denso en el slot (keto, corte agresivo), ni fruta ni cereal.
      .filter((f) => vaCarbohidrato || !(DENSE_CARB_ROLES.includes(f.role) || f.role === 'fruta'))
      // La grasa que se resuelve necesita grasa en el slot: el pre-entreno no la lleva.
      .filter((f) => ing.fijo || f.role !== 'grasa' || slot.fatG > 0)
      // La proteina del platillo tiene que sostener la comida por si sola.
      .filter(
        (f) =>
          ing.fijo ||
          !f.role.startsWith('proteina') ||
          cubre.proteina ||
          (maxGrams(acotar(f, ing)) * f.proteinPer100) / 100 >= plantilla.proteinaMinG,
      )
      .filter(
        (f) =>
          slot.proteinG <= 0 ||
          proteinaMinima + proteinaQueAporta(acotar(f, ing), esFijo(f), ing.gramos) <= topeDeProteina,
      );

    const elegido = pick(candidatos, profile, random, avoid);
    if (!elegido) {
      if (ing.opcional) continue;
      return undefined;
    }

    const food = acotar(elegido, ing);
    const role = food.role;
    const fijo = esFijo(food);
    const grams = gramosDeIngrediente(food, fijo, ing.gramos, config);
    proteinaMinima += proteinaQueAporta(food, fijo, ing.gramos);

    const nuevo: Slot = {
      food,
      grams,
      fixed: fijo,
      role,
      preparacion: ref,
      requerido: ing.opcional !== true,
      permitidos: ids,
      ...(ing.minUnits !== undefined || ing.maxUnits !== undefined
        ? { cotas: { ...(ing.minUnits !== undefined ? { minUnits: ing.minUnits } : {}), ...(ing.maxUnits !== undefined ? { maxUnits: ing.maxUnits } : {}) } }
        : {}),
    };

    if (role.startsWith('proteina') && !fijo && !cubre.proteina) {
      cubre.proteina = true;
      if (plantilla.proteinaMinG > 0) nuevo.minProteinG = plantilla.proteinaMinG;
    }
    if (DENSE_CARB_ROLES.includes(role)) cubre.carbo = true;
    if (role === 'grasa' && !fijo) cubre.grasa = true;
    if (role === 'fruta') cubre.fruta = true;
    if (role === 'vegetal_libre') cubre.verdura = true;
    slots.push(nuevo);
  }

  // Un platillo de un solo alimento no es platillo, es ese alimento.
  if (slots.length < 2) return undefined;
  // Si el platillo no trae la proteina, la comida la agrega junto: la sopa de
  // lentejas mas su pechuga tambien tiene que caber.
  const reserva = cubre.proteina ? 0 : plantilla.proteinaMinG + 2;
  if (slot.proteinG > 0 && proteinaMinima + reserva > topeDeProteina) return undefined;
  const requeridos = slots.filter((s) => s.requerido).length;
  for (const s of slots) {
    s.requeridosDelPlatillo = requeridos;
    avoid.add(s.food.id);
  }
  return { slots, cubre };
}

/**
 * Decide si esta comida lleva platillo y cual. Usa su propio sorteo, aparte
 * del de los alimentos: apagar las preparaciones deja el menu exactamente
 * como era, y prenderlas no reordena el resto del sorteo.
 */
function elegirPlatillo(
  slot: MealSlot,
  profile: Profile,
  config: EngineConfig,
  pool: Food[],
  filters: EligibleOptions,
  plantilla: Plantilla,
  vaCarbohidrato: boolean,
  random: () => number,
  avoid: Set<string>,
  /** Grupos que ya salieron hoy: un licuado y una sopa al dia, a lo mucho. */
  usados: Set<'licuado' | 'plato'>,
): PlatilloResuelto | undefined {
  const tiro = random();
  const esSlotDeLicuado = ['PRE', 'DESAYUNO', 'SNACK', 'POST'].includes(slot.id);
  const grupo = esSlotDeLicuado ? 'licuado' : 'plato';
  const proba = esSlotDeLicuado ? PROBA_LICUADO : PROBA_PLATO;
  // Dos licuados el mismo dia ya no son variedad, son una dieta liquida.
  if (tiro >= proba || usados.has(grupo)) return undefined;

  const candidatas = preparacionesPara(slot, profile);
  // Orden sorteado y determinista: se prueba la primera, y si sus
  // ingredientes no pasan (despensa, presupuesto, dieta), la siguiente.
  const orden = candidatas
    .map((prep) => ({ prep, llave: random() }))
    .sort((a, b) => a.llave - b.llave)
    .map((c) => c.prep);
  for (const prep of orden) {
    const resuelto = resolverPreparacion(
      prep, slot, profile, config, pool, filters, plantilla, vaCarbohidrato, random, avoid,
    );
    if (resuelto) {
      usados.add(grupo);
      return resuelto;
    }
  }
  return undefined;
}

/**
 * Despues de la reparacion del dia: si al platillo le quitaron un ingrediente
 * que requeria, deja de llamarse asi. Los alimentos se quedan —siguen
 * cuadrando la comida—; lo que no se hace es mentir con el nombre.
 */
function verificarPlatillo(comida: Slot[]): void {
  const delPlatillo = comida.filter((s) => s.preparacion);
  if (delPlatillo.length === 0) return;
  const esperados = delPlatillo[0]!.requeridosDelPlatillo ?? 0;
  const presentes = delPlatillo.filter((s) => s.requerido && s.grams > 0).length;
  if (presentes >= esperados && delPlatillo.length >= 2) return;
  for (const s of delPlatillo) {
    delete s.preparacion;
    delete s.requerido;
    delete s.permitidos;
  }
}

/**
 * Porcion con la que entra un ingrediente. Lo fijo entra con la suya —la
 * taza de leche, la pieza de fruta, los gramos de verdura de la receta—; lo
 * demas arranca en su minimo y lo mueve el solver.
 */
function gramosDeIngrediente(
  food: Food,
  fijo: boolean,
  gramos: number | undefined,
  config: EngineConfig,
): number {
  if (!fijo) return minGrams(food) || 100;
  if (gramos !== undefined) return gramos;
  if (food.role === 'fruta') return quantize(food.servingG ?? 100, food, config);
  if (!food.serving) return food.servingG ?? 100;
  return quantize(minGrams(food), food, config);
}

/** Cantidad casera sin los gramos: "1 taza de leche descremada". */
function sinGramos(display: string): string {
  return display.replace(/\s*\(\d+ g\)$/, '');
}

/** "Licuado de fresa con avena — 1 taza de fresa · 40 g de avena". */
function platilloDe(items: MenuItem[]): MenuMeal['preparacion'] {
  const ingredientes = items.filter((i) => i.preparacion);
  const ref = ingredientes[0]?.preparacion;
  if (!ref) return undefined;
  const renglones = ingredientes.map((i) => sinGramos(i.display));
  // El licuado sin leche se licua con agua: se dice, para que nadie lo
  // prepare en seco o le ponga la leche que el dia no tenia.
  if (ref.tipo === 'licuado' && !ingredientes.some((i) => i.foodId === 'leche_descremada')) {
    renglones.push('agua al gusto');
  }
  return { ...ref, display: `${ref.nombre} — ${renglones.join(' · ')}` };
}

function buildMeal(
  slot: MealSlot,
  profile: Profile,
  config: EngineConfig,
  random: () => number,
  avoid: Set<string>,
  pool: Food[],
  options: MenuOptions,
  residual: Residual,
  /** Sorteo aparte para los platillos: no mueve el de los alimentos. */
  prepRandom: () => number = () => 1,
  platillosDelDia: Set<'licuado' | 'plato'> = new Set(),
): { meal: MenuMeal; slots: Slot[] } {
  const slots: Slot[] = [];
  const periWorkout = slot.id === 'PRE' || slot.id === 'POST';
  const plantilla = plantillaDe(slot, config);
  const filters: EligibleOptions = {
    quickOnly: periWorkout,
    noSupplements: !periWorkout,
    desayuno: esDesayuno(slot),
  };

  /**
   * Sortea un alimento de ese rol contando con lo que ya esta en el plato: se
   * descartan las combinaciones que no van (avena con arroz) y pesan doble las
   * que si (frijol con tortilla).
   */
  function elegir(
    role: FoodRole,
    key?: 'proteinPer100' | 'carbPer100' | 'fatPer100',
    targetG = 0,
    extra: EligibleOptions = {},
  ): Food | undefined {
    const base = eligible(pool, profile, config, role, {
      ...filters,
      ...extra,
      acompanan: slots.map((s) => s.food),
    });
    const conFeasible = key ? feasible(base, key, targetG, 10) : base;
    // El piso de proteina es duro: `feasible` puede aflojar por densidad y
    // colar la leche descremada, que aporta 10 g en taza y media.
    const piso = extra.minProteinG ?? 0;
    const conPiso =
      piso > 0
        ? conFeasible.filter((f) => (maxGrams(f) * f.proteinPer100) / 100 >= piso)
        : conFeasible;
    if (conPiso.length === 0 && extra.estricto === true) return undefined;
    const candidatos = conPiso.length > 0 ? conPiso : conFeasible;
    return pick(candidatos, profile, random, avoid, preferidosDe(candidatos, slots, config));
  }

  /**
   * Lo mismo, pero sobre varios roles a la vez: la cena admite tortilla
   * (carbo_post) y frijol (carbo_complejo), y la plantilla se declara por
   * subtipo, no por el rol con el que el catalogo los clasifico.
   */
  function elegirDeRoles(
    roles: FoodRole[],
    key: 'proteinPer100' | 'carbPer100' | 'fatPer100',
    targetG: number,
    subtipos: string[],
  ): Food | undefined {
    const base = roles.flatMap((role) =>
      eligible(pool, profile, config, role, {
        ...filters,
        subtipos,
        acompanan: slots.map((s) => s.food),
      }),
    );
    const unicos = base.filter((f, i) => base.findIndex((o) => o.id === f.id) === i);
    const candidatos = feasible(unicos, key, targetG, 10);
    return pick(candidatos, profile, random, avoid, preferidosDe(candidatos, slots, config));
  }

  /**
   * Carbohidrato minimo para que valga la pena poner un carbohidrato.
   *
   * Ningun cereal ni leguminosa baja de ~10 g de carbohidrato en su porcion
   * minima: media taza de arroz son 28. Meterlos en un slot que pide 3 g
   * —la comida de una keto— no cubre nada, se come el presupuesto del dia
   * entero y ademas se ve absurdo en el plato.
   */
  const CARBO_MINIMO_DEL_SLOT = 15;
  const vaCarbohidrato = slot.allowDenseCarb && slot.carbG >= CARBO_MINIMO_DEL_SLOT;

  // El platillo va primero: es el que define la comida, y lo que venga
  // despues —la proteina de la comida corrida junto a la sopa— lo acompaña.
  const platillo = elegirPlatillo(
    slot, profile, config, pool, filters, plantilla, vaCarbohidrato, prepRandom, avoid,
    platillosDelDia,
  );
  if (platillo) slots.push(...platillo.slots);
  const cubre = platillo?.cubre ?? {
    proteina: false,
    carbo: false,
    grasa: false,
    fruta: false,
    verdura: false,
  };

  // La crema y la sopa ya son la verdura del plato.
  if (slot.freeVegetables && config.freeVegetableGramsPerMeal > 0 && !cubre.verdura) {
    const veg = pick(
      eligible(pool, profile, config, 'vegetal_libre', { freeVegetable: true }),
      profile,
      random,
      avoid,
    );
    if (veg) {
      slots.push({
        food: veg,
        grams: config.freeVegetableGramsPerMeal,
        fixed: true,
        role: 'vegetal_libre',
      });
      avoid.add(veg.id);
    }
  }


  if (plantilla.fruta && vaCarbohidrato && !options.simplify && !cubre.fruta) {
    const fruit = elegir('fruta');
    if (fruit) {
      // La fruta del pre-entreno va fija, pero fija en una porcion de verdad:
      // una pieza o una taza, no los 100 g de relleno de antes.
      slots.push({
        food: fruit,
        grams: quantize(fruit.servingG ?? 100, fruit, config),
        fixed: true,
        role: 'fruta',
      });
      avoid.add(fruit.id);
    }
  }

  const wantsFat = slot.fatG > 0;
  // Cuando la comida pide tanta grasa como proteina —keto, sobre todo—, la
  // grasa tiene que venir tambien de la proteina: el salmon y el huevo la
  // traen adentro. Buscarla toda en aceites choca contra el tope de una
  // cucharada de grasa anadida por comida.
  const grasaProtagonista = slot.fatG >= slot.proteinG;
  const probaProteinaGrasa = grasaProtagonista ? 0.8 : 0.35;
  const proteinRole: FoodRole =
    wantsFat && random() < probaProteinaGrasa ? 'proteina_grasa' : 'proteina_magra';
  // Una comida principal lleva una fuente de proteina de VERDAD: la que no
  // llega a los 20 g dentro de su porcion no es la proteina del plato, es un
  // ingrediente. Sin este filtro salian cenas de nopal con arroz y linaza.
  const proteinaMinima = plantilla.proteinaMinG;
  const piso = { minProteinG: proteinaMinima };
  const otroRol: FoodRole = proteinRole === 'proteina_magra' ? 'proteina_grasa' : 'proteina_magra';
  const protein = cubre.proteina
    ? undefined
    : // Los dos roles de proteina CON la plantilla del slot antes de aflojarla:
    // si no hay proteina de desayuno magra, se busca entre las grasas —queso,
    // huevo— y solo entonces se desayuna lo que haya.
    elegir(proteinRole, 'proteinPer100', slot.proteinG, { ...piso, estricto: true }) ??
    elegir(otroRol, 'proteinPer100', slot.proteinG, { ...piso, estricto: true }) ??
    elegir(proteinRole, 'proteinPer100', slot.proteinG, piso) ??
    elegir('proteina_magra', 'proteinPer100', slot.proteinG, piso);
  if (protein) {
    slots.push({
      food: protein,
      grams: 100,
      fixed: false,
      role: protein.role,
      ...(proteinaMinima > 0 ? { minProteinG: proteinaMinima } : {}),
    });
    avoid.add(protein.id);
  }

  if (vaCarbohidrato && !cubre.carbo) {
    const carbRole = slotCarbRole(slot.id);
    const carbTarget = slot.carbG - (slot.id === 'PRE' ? 20 : 0);
    const carb =
      elegirDeRoles(plantilla.carbRoles, 'carbPer100', carbTarget, plantilla.subtipos) ??
      undefined;
    if (carb) {
      slots.push({
        food: carb,
        grams: 100,
        fixed: false,
        role: DENSE_CARB_ROLES.includes(carb.role) ? carb.role : carbRole,
      });
      avoid.add(carb.id);
    }
  }

  if (wantsFat && !cubre.grasa) {
    const yaTraeAnadida = slots.some((s) => s.food.tags.includes('grasa_anadida'));
    const fat = elegir('grasa', 'fatPer100', slot.fatG, yaTraeAnadida ? { sinGrasaAnadida: true } : {});
    if (fat) {
      slots.push({ food: fat, grams: minGrams(fat) || 15, fixed: false, role: 'grasa' });
      avoid.add(fat.id);
    }
  }

  // El residual arrastra lo que las comidas anteriores se pasaron o se quedaron
  // cortas (p. ej. la grasa que traen la avena o el pollo del pre-entreno).
  const cap = (targetG: number, carry: number): number =>
    Math.min(Math.max(0, targetG - carry), targetG * 1.8 + 5);
  const effective = {
    p: cap(slot.proteinG, residual.p),
    c: cap(slot.carbG, residual.c),
    f: cap(slot.fatG, residual.f),
  };
  for (const s of slots) s.maxEnComida = plantilla.maxAlimentos;
  ajustarPorciones(slots, effective, profile, config, pool, filters, random, avoid, plantilla);
  for (const s of slots) s.maxEnComida = plantilla.maxAlimentos;

  const kept = slots.filter((s) => s.grams > 0);
  const items = kept.map((s) => toItem(s, s.fixed && s.food.role === 'vegetal_libre'));

  const totals = items.reduce<MacroTargets>(
    (acc, item) => ({
      kcal: acc.kcal + item.kcal,
      proteinG: round1(acc.proteinG + item.proteinG),
      carbG: round1(acc.carbG + item.carbG),
      fatG: round1(acc.fatG + item.fatG),
      fiberG: round1(acc.fiberG + item.fiberG),
    }),
    { kcal: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 },
  );

  residual.p += totals.proteinG - slot.proteinG;
  residual.c += totals.carbG - slot.carbG;
  residual.f += totals.fatG - slot.fatG;

  return {
    meal: {
      slot: slot.id,
      label: slot.label,
      timeHint: slot.timeHint,
      items,
      equivalences: [],
      totals,
      target: {
        kcal: slot.kcal,
        proteinG: slot.proteinG,
        carbG: slot.carbG,
        fatG: slot.fatG,
        fiberG: 0,
      },
    },
    slots,
  };
}

/** Reconstruye items y totales de una comida a partir de sus gramos. */
function refreshMeal(meal: MenuMeal, slots: Slot[], pool: Food[], profile: Profile, config: EngineConfig): void {
  const kept = slots.filter((s) => s.grams > 0);
  meal.items = kept.map((s) => toItem(s, s.fixed && s.food.role === 'vegetal_libre'));
  const platillo = platilloDe(meal.items);
  if (platillo) meal.preparacion = platillo;
  else delete meal.preparacion;
  meal.equivalences = kept
    .map((s) => equivalencesFor(s, pool, profile, config))
    .filter((e): e is Equivalence => e !== null);
  meal.totals = meal.items.reduce<MacroTargets>(
    (acc, item) => ({
      kcal: acc.kcal + item.kcal,
      proteinG: round1(acc.proteinG + item.proteinG),
      carbG: round1(acc.carbG + item.carbG),
      fatG: round1(acc.fatG + item.fatG),
      fiberG: round1(acc.fiberG + item.fiberG),
    }),
    { kcal: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 },
  );
}

/**
 * Reparacion a nivel dia: ajusta gramos en pasos del redondeo del alimento
 * hasta que los macros del menu completo caen lo mas cerca posible del target.
 */
function repairDay(
  comidas: Slot[][],
  target: { p: number; c: number; f: number },
  config: EngineConfig,
  contexto?: {
    profile: Profile;
    pool: Food[];
    filtersPorComida: EligibleOptions[];
    plantillas: Plantilla[];
  },
): void {
  for (const comida of comidas) aplicarComposicion(comida, config);
  moverGramos(comidas, target, config);
  podarSobrantes(comidas, target);
  moverGramos(comidas, target, config);

  // Si el dia sigue fuera de tolerancia, ya no es cuestion de gramos: es que
  // un alimento no era el adecuado. Cambiarlo por otro de su mismo rol es el
  // ultimo recurso, y solo se usa aqui —si se usara siempre, todos los menus
  // convergerian al mismo alimento "optimo" y se acabaria la variedad que el
  // sorteo determinista existe para dar.
  if (contexto && fueraDeTolerancia(comidas.flat(), target)) {
    sustituirAlimentos(comidas, target, config, contexto);
    moverGramos(comidas, target, config);
  }

  for (const comida of comidas) {
    aplicarComposicion(comida, config);
    asegurarProteina(comida, config);
  }
}

function fueraDeTolerancia(all: Slot[], target: { p: number; c: number; f: number }): boolean {
  return (['p', 'c', 'f'] as const).some(
    (macro) => target[macro] > 0 && Math.abs(sum(all, macro) - target[macro]) / target[macro] > 0.02,
  );
}

/**
 * Cambia un alimento por otro de su mismo rol cuando eso acerca el dia al
 * target. El caso real: el refuerzo de carbohidrato metio una leguminosa, que
 * ademas trae 8 g de proteina, y el dia termino con proteina de mas que no se
 * puede quitar porque el pollo ya va en su porcion minima. Cambiar la lenteja
 * por arroz cierra el carbohidrato sin la proteina de pilon.
 */
function sustituirAlimentos(
  comidas: Slot[][],
  target: { p: number; c: number; f: number },
  config: EngineConfig,
  contexto: {
    profile: Profile;
    pool: Food[];
    filtersPorComida: EligibleOptions[];
    plantillas: Plantilla[];
  },
): void {
  const all = comidas.flat();
  for (let i = 0; i < comidas.length; i += 1) {
    const comida = comidas[i] ?? [];
    const filters = contexto.filtersPorComida[i] ?? {};
    for (const slot of comida) {
      if (!slot.role) continue;
      // El vegetal libre tambien se sustituye, aunque sus gramos esten fijos:
      // 200 g de germen de alfalfa traen 8 g de proteina y 200 de lechuga
      // traen 1.4. Con cuatro comidas al dia esa diferencia es la que sacaba
      // el dia de rango.
      const esVegetalLibre = (slot.role ?? slot.food.role) === 'vegetal_libre';
      if (slot.fixed && !esVegetalLibre) continue;
      // Fuera lo que ya esta en el DIA, no solo en el plato: buscando el mejor
      // macro, la sustitucion terminaba poniendo el mismo yogur griego en el
      // desayuno, la comida y la cena. Cuadraba perfecto y nadie come eso.
      const yaEstan = new Set(comidas.flat().map((s) => s.food.id));
      yaEstan.delete(slot.food.id);
      // La proteina magra y la grasa son la misma familia para sustituir: en
      // keto la diferencia entre la tilapia y el salmon es justo la grasa que
      // le falta al dia, y obligarse a quedarse en el mismo rol deja fuera la
      // unica sustitucion que sirve.
      const plantillaDelSlot = contexto.plantillas[i];
      // Los roles hermanos son los que la plantilla admite para ese lugar del
      // plato: la proteina magra y la grasa son intercambiables, y el
      // carbohidrato de una comida puede ser cereal (carbo_complejo) o
      // tuberculo (carbo_post) —sin esto, el garbanzo no podia volverse papa
      // y su proteina de pilon se quedaba en el dia.
      const rolesHermanos: FoodRole[] = slot.role.startsWith('proteina')
        ? ['proteina_magra', 'proteina_grasa']
        : DENSE_CARB_ROLES.includes(slot.role) && plantillaDelSlot
          ? plantillaDelSlot.carbRoles
          : [slot.role];
      const acompanan = comida.filter((s) => s !== slot).map((s) => s.food);
      // La sustitucion obedece la misma plantilla que la eleccion original:
      // sin esto, el dia "arreglaba" macros metiendo atun en el desayuno o
      // avena cocida en la comida.
      const plantilla = plantillaDelSlot;
      const deLaPlantilla: EligibleOptions = {
        ...filters,
        acompanan,
        estricto: true,
        ...(DENSE_CARB_ROLES.includes(slot.role) && plantilla
          ? { subtipos: plantilla.subtipos }
          : {}),
        ...(slot.minProteinG ? { minProteinG: slot.minProteinG } : {}),
      };
      const candidatos = rolesHermanos
        .flatMap((role) =>
          eligible(contexto.pool, contexto.profile, config, role, {
            ...deLaPlantilla,
            ...(esVegetalLibre ? { freeVegetable: true } : {}),
          }),
        )
        .filter((f) => !yaEstan.has(f.id))
        // El ingrediente de un platillo solo se cambia por otro del platillo:
        // el licuado no se arregla metiendole atun.
        .filter((f) => slot.permitidos === undefined || slot.permitidos.includes(f.id))
        // Con la medida propia del platillo, no la general del alimento.
        .map((f) => (slot.permitidos ? acotar(f, slot.cotas) : f));

      const original = { food: slot.food, grams: slot.grams };
      let mejorError = error(all, target);
      let mejor = original;

      for (const food of candidatos) {
        slot.food = food;
        const porciones = esVegetalLibre
          ? [slot.grams]
          : porcionesPosibles(food, config, minDeSlot({ ...slot, food }));
        for (const grams of porciones) {
          slot.grams = grams;
          if (violaComposicion(comida, config)) continue;
          const candidato = error(all, target);
          if (candidato < mejorError - 1e-9) {
            mejorError = candidato;
            mejor = { food, grams };
          }
        }
      }

      slot.food = mejor.food;
      slot.grams = mejor.grams;
      // El rol sigue al alimento: si la tilapia se cambio por salmon, ese slot
      // ya es proteina grasa, y de ahi salen su explicacion y sus
      // equivalencias.
      slot.role = mejor.food.role;
    }
  }
}

/** Todas las porciones legales de un alimento, de su minimo a su tope. */
function porcionesPosibles(food: Food, config: EngineConfig, piso = minGrams(food)): number[] {
  const paso = roundingFor(food, config);
  const max = maxGrams(food);
  const min = Math.min(Math.max(Math.ceil(piso / paso) * paso, paso), max);
  const salida: number[] = [];
  for (let grams = min; grams <= max + 1e-6; grams += paso) salida.push(grams);
  return salida.length > 0 ? salida : [max];
}

/**
 * Quita el alimento que sobra.
 *
 * Cuando el refuerzo de una comida se pasa —la segunda leguminosa que ya no
 * hacia falta—, moverle gramos no lo arregla: su porcion minima ya es mas de
 * lo que faltaba. La unica reparacion honesta es sacarlo, y solo se saca si
 * su macro se queda cubierto por otro alimento de la misma comida.
 */
function podarSobrantes(comidas: Slot[][], target: { p: number; c: number; f: number }): void {
  for (const comida of comidas) {
    for (const slot of [...comida]) {
      if (slot.fixed) continue;
      // La proteina que sostiene la comida no se poda: un refuerzo de proteina
      // le daba "relevo" y el dia se llevaba por delante justo al alimento que
      // llevaba el piso, dejando la comida en 17 g.
      if (slot.minProteinG !== undefined) continue;
      if (slot.requerido) continue;
      const macro = macroDominante(slot.food, slot.role);
      const hayRelevo = comida.some(
        (s) => s !== slot && !s.fixed && macroDominante(s.food, s.role) === macro,
      );
      if (!hayRelevo) continue;

      const antes = error(comidas.flat(), target);
      const donde = comida.indexOf(slot);
      comida.splice(donde, 1);

      // Quitarlo tiene que mejorar el dia SIN abrir un hueco en su propio
      // macro: el error pesa la proteina el doble, asi que sin este freno
      // sacaba la lenteja —que sobraba de proteina— y dejaba la comida 40 %
      // corta de carbohidrato, que es peor de lo que arreglaba.
      const despues = comidas.flat();
      const faltaSuMacro =
        target[macro] > 0 && (target[macro] - sum(despues, macro)) / target[macro] > 0.05;
      if (error(despues, target) >= antes || faltaSuMacro) comida.splice(donde, 0, slot);
    }
  }
}

function moverGramos(
  comidas: Slot[][],
  target: { p: number; c: number; f: number },
  config: EngineConfig,
): void {
  const all = comidas.flat();
  const movable = all
    .filter((s) => !s.fixed && s.grams > 0)
    .map((slot) => ({ slot, comida: comidas.find((c) => c.includes(slot)) ?? [] }));

  // Busqueda exhaustiva por alimento, no a pasitos: con medida casera cada
  // alimento tiene POCAS porciones legales (de media taza a taza y cuarto son
  // cuatro valores), asi que probarlas todas cuesta lo mismo que tantear y no
  // se queda atorada en el primer minimo local, que es lo que dejaba el dia
  // 5 % arriba de proteina con las claras servidas en su minimo.
  for (let pass = 0; pass < 12; pass += 1) {
    let improved = false;
    for (const { slot, comida } of movable) {
      let mejorGramos = slot.grams;
      let mejor = error(all, target);
      const original = slot.grams;
      for (const grams of porcionesPosibles(slot.food, config, minDeSlot(slot))) {
        slot.grams = grams;
        // Cerrar el macro pasandose de taza y media de arroz no cierra nada:
        // deja un plato que no se sirve asi.
        if (violaComposicion(comida, config)) continue;
        const candidato = error(all, target);
        if (candidato < mejor - 1e-9) {
          mejor = candidato;
          mejorGramos = grams;
        }
      }
      slot.grams = mejorGramos;
      if (mejorGramos !== original) improved = true;
    }
    if (!improved) break;
  }
}

function buildMenu(
  id: 1 | 2,
  slots: MealSlot[],
  profile: Profile,
  config: EngineConfig,
  seed: number,
  pool: Food[],
  options: MenuOptions,
  target: MacroTargets,
): Menu {
  const random = rng(seed);
  // Un sorteo aparte para los platillos, derivado de la misma semilla.
  const prepRandom = rng((Math.imul(seed, 0x9e3779b1) ^ 0x5bd1e995) >>> 0);
  const avoid = new Set<string>();
  const residual: Residual = { p: 0, c: 0, f: 0 };
  const platillosDelDia = new Set<'licuado' | 'plato'>();
  const built = slots.map((slot) =>
    buildMeal(slot, profile, config, random, avoid, pool, options, residual, prepRandom, platillosDelDia),
  );
  repairDay(
    built.map((b) => b.slots),
    { p: target.proteinG, c: target.carbG, f: target.fatG },
    config,
    {
      profile,
      pool,
      filtersPorComida: slots.map((slot) => ({
        quickOnly: slot.id === 'PRE' || slot.id === 'POST',
        noSupplements: !(slot.id === 'PRE' || slot.id === 'POST'),
        desayuno: esDesayuno(slot),
      })),
      plantillas: slots.map((slot) => plantillaDe(slot, config)),
    },
  );
  // Los gramos se cierran a entero ANTES de pintar: media cucharadita son 2.5
  // g y la pantalla no muestra decimales. Si el motor se queda con 7.5 y la
  // pantalla dice 8, las equivalencias se calculan contra una porcion que
  // nadie ve y salen desviadas de lo que promete la app.
  for (const b of built) {
    for (const s of b.slots) s.grams = Math.round(s.grams);
    verificarPlatillo(b.slots);
  }
  const meals = built.map((b) => b.meal);
  for (const b of built) refreshMeal(b.meal, b.slots, pool, profile, config);
  const totals = meals.reduce<MacroTargets>(
    (acc, meal) => ({
      kcal: acc.kcal + meal.totals.kcal,
      proteinG: round1(acc.proteinG + meal.totals.proteinG),
      carbG: round1(acc.carbG + meal.totals.carbG),
      fatG: round1(acc.fatG + meal.totals.fatG),
      fiberG: round1(acc.fiberG + meal.totals.fiberG),
    }),
    { kcal: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 },
  );
  const dev = (got: number, want: number): number =>
    want === 0 ? 0 : round1(((got - want) / want) * 100);
  return {
    id,
    label: `Menu ${id}`,
    meals,
    totals,
    deviationPct: {
      kcal: dev(totals.kcal, target.kcal),
      proteinG: dev(totals.proteinG, target.proteinG),
      carbG: dev(totals.carbG, target.carbG),
      fatG: dev(totals.fatG, target.fatG),
    },
  };
}

/**
 * La lista de super de los menus que se vayan a cocinar de verdad.
 *
 * `daysPerMenu` es cuantos dias se come CADA menu de los que se pasan: dos
 * menus repartidos en la semana son 3.5 dias cada uno, pero quien decide
 * cocinar uno solo lo come los 7. Por eso quien llama decide ambas cosas
 * —cuales menus y cuantos dias— en vez de que el motor asuma que siempre son
 * los dos: comprar para un menu que no se va a cocinar es tirar comida.
 */
export function listaDeSuper(
  menus: Menu[],
  diasPorMenu: number,
  pool: Food[] = FOODS,
  /** Ids de lo que ya esta en casa, para marcarlo en vez de mandarlo a comprar. */
  pantry: string[] = [],
): ShoppingItem[] {
  return shoppingList(menus, pool, diasPorMenu, pantry);
}

function shoppingList(
  menus: Menu[],
  pool: Food[],
  daysPerMenu: number,
  pantry: string[] = [],
): ShoppingItem[] {
  const enCasa = new Set(pantry);
  const acc = new Map<string, ShoppingItem>();
  for (const menu of menus) {
    for (const meal of menu.meals) {
      for (const item of meal.items) {
        // Un alimento intercambiado por una equivalencia puede venir SIN
        // `foodId` (los menus guardados antes de que el intercambio lo
        // conservara). Agrupar por `undefined` metia a todos esos alimentos
        // en la misma cubeta: la lista salia con seis renglones y sumas
        // imposibles —"Yogur 13 440 g"— porque el yogur cargaba tambien con
        // el pavo, el frijol y las tostadas. El nombre es la llave de
        // respaldo, que es justo lo que distingue un alimento de otro cuando
        // el id se perdio.
        const food =
          pool.find((f) => f.id === item.foodId) ??
          pool.find((f) => normalize(f.name) === normalize(item.name));

        // La llave sale del alimento resuelto, no del id que traiga el JSON:
        // asi el MISMO alimento con id (como lo genero el motor) y sin id
        // (como quedo tras un intercambio) cae en el mismo renglon en vez de
        // aparecer dos veces. Solo si no esta en el catalogo se usa su nombre.
        const clave = food?.id ?? normalize(item.name);

        const grams = item.grams * daysPerMenu;
        const existing = acc.get(clave);
        const platillo = item.preparacion?.nombre;
        if (existing) {
          existing.grams += grams;
          if (platillo && !(existing.preparaciones ?? []).includes(platillo)) {
            existing.preparaciones = [...(existing.preparaciones ?? []), platillo];
          }
        } else {
          acc.set(clave, {
            foodId: item.foodId ?? food?.id ?? clave,
            name: item.name,
            grams,
            // Los gramos acumulados son gramos: etiquetarlos con la unidad de
            // servicio del alimento imprimia "Naranja - 1260 pieza". Las
            // piezas las calcula quien pinta la lista, desde los gramos.
            unit: 'g',
            costRel: food?.costRel ?? 2,
            // Marcado, no escondido: sigue haciendo falta para cocinar, pero
            // la lista tiene que decir "ya lo tienes" en vez de mandar a
            // comprarlo otra vez.
            ...(food && enCasa.has(food.id) ? { enDespensa: true } : {}),
            ...(platillo ? { preparaciones: [platillo] } : {}),
          });
        }
      }
    }
  }
  return [...acc.values()]
    .map((i) => ({ ...i, grams: roundTo(i.grams, 5) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

/**
 * Genera los dos menus de la semana (mismos macros, alimentos distintos),
 * sus equivalencias y la lista de super.
 * `seed` es quincenal: mismo seed -> mismo menu; cambia cada 2 semanas.
 */
export function generateMenu(
  slots: MealSlot[],
  profile: Profile,
  config: EngineConfig = DEFAULT_CONFIG,
  seed = 1,
  options: MenuOptions = {},
  base: Food[] = FOODS,
): MenuPlan {
  // Los alimentos propios se mezclan UNA vez, aqui: de este punto para abajo
  // el motor no sabe cuales vinieron del catalogo y cuales dio de alta la
  // persona, que es justo lo que hace que compitan con las mismas reglas.
  const pool = catalogoCon(options.extraFoods, base);
  const target = slots.reduce<MacroTargets>(
    (acc, slot) => ({
      kcal: acc.kcal + slot.kcal,
      proteinG: acc.proteinG + slot.proteinG,
      carbG: acc.carbG + slot.carbG,
      fatG: acc.fatG + slot.fatG,
      fiberG: 0,
    }),
    { kcal: 0, proteinG: 0, carbG: 0, fatG: 0, fiberG: 0 },
  );

  // `menu_fijo`: un solo menu para los siete dias. No se genera el segundo y
  // el primero se copia tal cual, para que la app siga leyendo dos menus sin
  // enterarse; la lista de super compra ese unico menu los dias completos, no
  // la mitad de cada uno.
  const fijo = profile.diet === 'menu_fijo';
  const menu1 = buildMenu(1, slots, profile, config, seed, pool, options, target);
  if (fijo) menu1.label = 'Menu de la semana';
  const menu2 = fijo
    ? { ...menu1, id: 2 as const }
    : buildMenu(2, slots, profile, config, seed * 7919 + 13, pool, options, target);
  const daysPerMenu = options.daysPerMenu ?? 3.5;

  const notas: string[] = [
    'Los vegetales verdes son libres: puedes comer mas de los que indica el menu.',
    'Las equivalencias son intercambios del mismo rol; usa los gramos indicados.',
  ];
  if (options.phase === 'CUT_AGRESIVO') {
    notas.push('Comida y cena van sin carbohidrato denso.');
    notas.push('Protocolo de electrolitos: salar bien las comidas o agua mineral con sal y limon.');
  }
  if (profile.conditions?.glucosaAlta) {
    notas.push('Carbohidratos densos limitados a indice glucemico bajo.');
  }
  if (options.simplify) {
    notas.push('Menu simplificado: menos ingredientes y mas repeticion.');
  }
  if (fijo) {
    notas.push('Menu fijo: el mismo menu los siete dias. La lista de super ya viene por semana.');
  }

  return {
    seed,
    target,
    menus: [menu1, menu2],
    shoppingList: fijo
      ? shoppingList([menu1], pool, daysPerMenu * 2, profile.pantry)
      : shoppingList([menu1, menu2], pool, daysPerMenu, profile.pantry),
    notas,
  };
}

/** Solo para pruebas: piezas internas que no forman parte del API del motor. */
export const __testing = { describirPorcion };
