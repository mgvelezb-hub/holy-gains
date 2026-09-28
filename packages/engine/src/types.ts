/**
 * Tipos publicos del motor. Todo el motor es puro: sin IO, sin DB, sin Next.
 * Unidades: kg, cm, gramos enteros, kcal, fechas ISO `YYYY-MM-DD`.
 */

export type Sex = 'female' | 'male';
export type WorkActivity = 'sedentario' | 'activo';
/**
 * Presupuesto de despensa, en tres escalones sobre `costRel` del catálogo:
 * `bajo` se queda con lo más barato (costRel 1), `medio` abre el intermedio
 * (≤2) y `alto` no filtra por precio. Los tres cubren todos los roles del
 * menú —proteína, carbohidrato, grasa, vegetal— así que ninguno deja al
 * generador sin con qué armar una comida.
 */
export type Budget = 'bajo' | 'medio' | 'alto';
export type TrainingTime = 'manana' | 'tarde';

export type Phase =
  | 'REINTRO'
  | 'BASE'
  | 'CUT'
  | 'CUT_AGRESIVO'
  | 'REFEED'
  | 'ESTABILIZACION'
  | 'MANTENIMIENTO';

export const PHASES: readonly Phase[] = [
  'REINTRO',
  'BASE',
  'CUT',
  'CUT_AGRESIVO',
  'REFEED',
  'ESTABILIZACION',
  'MANTENIMIENTO',
] as const;

/** Categoria de la decision semanal (la que mide el backtest). */
export type DecisionCategory =
  | 'HOLD'
  | 'MENU_REFRESH'
  | 'TIGHTEN'
  | 'CUT'
  | 'CUT_AGRESIVO'
  | 'REFEED'
  | 'CONTEXT_CHANGE';

export type CyclePhase = 'folicular' | 'ovulacion' | 'lutea' | 'menstruacion' | 'na';
export type StrengthTrend = 'sube' | 'igual' | 'baja';
export type PhotoTrend = 'mejora' | 'igual' | 'retroceso' | 'no_comparable';

/** Escala 1-5 usada en las sensaciones del check-in. */
export type Scale5 = 1 | 2 | 3 | 4 | 5;

/** Sintomas relevantes para las reglas de seguridad. Lista abierta. */
export type Symptom =
  | 'mareo'
  | 'calambres'
  | 'dolor_espalda'
  | 'dolor_pie'
  | 'dolor_tobillo'
  | 'enfermedad'
  | 'insomnio'
  | 'antojo_fuerte'
  | (string & {});

export interface ProfileConditions {
  glucosaAlta?: boolean;
  lesionActiva?: boolean;
  cicloMenstrualTracking?: boolean;
}

export interface Profile {
  sex: Sex;
  ageYears: number;
  heightCm: number;
  weightKg: number;
  /** InBody u otra medicion directa. Si falta se estima. */
  leanMassKg?: number;
  strengthDaysPerWeek: number;
  cardioMinPerWeek: number;
  work: WorkActivity;
  mealsPerDay: number;
  liquidMeals?: number;
  trainingTime: TrainingTime;
  budget: Budget;
  favoriteFoods?: string[];
  /**
   * Lo que la persona YA tiene comprado, por id del catalogo.
   *
   * No es una lista de deseos ni un favorito con otro nombre: es despensa que
   * ya se pago y que el menu anterior dejo sin uso cuando la rotacion
   * quincenal cambio de alimentos. Por eso pesa MAS que `favoriteFoods` —
   * dentro de su rol se elige primero— pero nunca por encima de las reglas:
   * si la despensa no cubre un rol, entra el resto del catalogo.
   */
  pantry?: string[];
  excludedFoods?: string[];
  allergies?: string[];
  conditions?: ProfileConditions;
  /** Minutos disponibles por sesion de cocina; el generador prefiere recetas mas rapidas si es bajo. */
  maxPrepMin?: number;
  /**
   * Estilo de dieta (Fase 8). `estandar` es el metodo del coach; los demas
   * cambian una cosa cada uno y nada mas:
   *
   * - `ayuno` mueve horarios, no macros: el motor reparte las mismas comidas
   *   dentro de la ventana declarada.
   * - `vegetariana` cambia el catalogo (ovolactovegetariana: huevo y lacteos
   *   se quedan), no la formula.
   * - `keto` si cambia la formula: el carbohidrato baja a un tope y las kcal
   *   que sobran se van a grasa.
   * - `menu_fijo` no cambia macros ni catalogo: cambia la VARIEDAD. Un solo
   *   menu para los siete dias, que es como prescribe cualquier coach de
   *   gimnasio en Mexico y como cocina quien prepara el domingo. La rotacion
   *   diaria del motor es ruido para esa persona.
   */
  diet?: DietStyle;
  /**
   * Suplementos que la persona TIENE. No es una lista de deseos ni de
   * recomendaciones: el plan solo sugiere lo que ya se puede tomar.
   */
  supplements?: Supplement[];
  /**
   * Ventana de alimentacion para `ayuno`: hora de inicio y de fin, 0-23.
   * Sin ella, el ayuno usa 12:00-20:00, que es el 16/8 mas comun.
   */
  fastingWindow?: { startHour: number; endHour: number };
  /**
   * Que platillos compuestos acepta el menu. Sin el campo, todos: la
   * preparacion es una forma de servir los mismos alimentos, no otra dieta.
   * Los caldos van con las sopas —para quien cocina son lo mismo—.
   */
  preparaciones?: PreferenciaPreparaciones;
  /**
   * La leche de la casa: la que va en licuados y cremas. Sin el campo,
   * descremada, que era la unica que el catalogo tenia. Cambia las kcal y la
   * grasa del platillo —el solver mueve lo demas para cuadrar el dia—, y las
   * otras leches no salen en ningun lado del menu.
   */
  tipoLeche?: TipoLeche;
}

export const TIPOS_LECHE = ['descremada', 'entera', 'deslactosada', 'deslactosada_light'] as const;
export type TipoLeche = (typeof TIPOS_LECHE)[number];

export interface PreferenciaPreparaciones {
  licuados: boolean;
  sopas: boolean;
  cremas: boolean;
}

import type { Supplement } from './suplementos.js';

export const DIET_STYLES = [
  'estandar',
  'ayuno',
  'vegetariana',
  'keto',
  'menu_fijo',
] as const;
export type DietStyle = (typeof DIET_STYLES)[number];

/** Cambio de contexto declarado por el atleta (no es un resultado corporal). */
export interface ContextChange {
  mealsPerDay?: number;
  minutesPerSession?: number;
  trainingChanged?: boolean;
}

export interface CheckIn {
  /** ISO `YYYY-MM-DD`. */
  date: string;
  weightKg?: number;
  waistCm?: number;
  legLeftCm?: number;
  legRightCm?: number;
  armLeftCm?: number;
  armRightCm?: number;
  photosTrend?: PhotoTrend;
  strengthRpe?: number;
  strengthTrend: StrengthTrend;
  inflammation: Scale5;
  energy: Scale5;
  hunger: Scale5;
  satiety?: Scale5;
  sleep?: Scale5;
  /** 0-100 */
  dietCompliancePct: number;
  /** 0-100 */
  trainingCompliancePct?: number;
  symptoms?: Symptom[];
  cyclePhase?: CyclePhase;
  /** Lesion que aparece esta semana (dispara protocolo de lesion). */
  newInjury?: boolean;
  /** Lesion que sigue activa pero ya conocida. */
  activeInjury?: boolean;
  /** Dias consecutivos sin entrenar. */
  daysWithoutTraining?: number;
  /** El atleta declara un cambio de contexto (menos tiempo, menos comidas, deja el cross...). */
  contextChange?: boolean | ContextChange;
  /** El atleta pide explicitamente apretar (deadline, evento). */
  aggressiveRequest?: boolean;
  /** Meta alcanzada -> mantenimiento. */
  goalReached?: boolean;
  /** Reinicio tras pausa larga -> REINTRO. */
  restart?: boolean;
}

export interface MacroTargets {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  fiberG: number;
}

export type MealSlotId = 'PRE' | 'POST' | 'DESAYUNO' | 'COMIDA' | 'CENA' | 'SNACK';

export interface MealSlot {
  id: MealSlotId;
  /** Etiqueta en espanol para la UI. */
  label: string;
  /** Sugerencia de hora `HH:MM`. */
  timeHint: string;
  proteinG: number;
  carbG: number;
  fatG: number;
  kcal: number;
  /** false = "0 carbos densos" (CUT_AGRESIVO en comida y cena). */
  allowDenseCarb: boolean;
  /** Vegetales verdes libres en este slot. */
  freeVegetables: boolean;
}

export interface RuleHit {
  id: string;
  nombre: string;
  /** Texto neutro en espanol. Nunca consejo medico. */
  explicacion: string;
  /** Categoria que impone la regla, si impone alguna. */
  category?: DecisionCategory;
  /** Fase destino que impone la regla, si impone alguna. */
  phase?: Phase;
}

export interface LeanMassEstimate {
  kg: number;
  estimated: boolean;
  bodyFatPct: number;
  method: 'inbody' | 'us_navy' | 'deurenberg_bmi';
}

export interface EnergyBase {
  bmr: number;
  pal: number;
  tdee: number;
  leanMass: LeanMassEstimate;
}

export interface Decision {
  date: string;
  category: DecisionCategory;
  phase: Phase;
  previousPhase: Phase;
  previousKcal: number;
  deficitPct: number;
  targets: MacroTargets;
  meals: MealSlot[];
  rulesFired: RuleHit[];
  explicacion: string;
  /** Semana marcada no concluyente (ciclo, sin datos): no cuenta para estancamiento. */
  inconclusiveWeek: boolean;
  /** Protocolo de electrolitos activo. */
  electrolyteProtocol: boolean;
  /** Simplificar menu (menos ingredientes, mas repeticion). */
  simplifyMenu: boolean;
  /** Adaptar el entreno por lesion. */
  injuryTrainingProtocol: boolean;
  weeksInPhase: number;
  /** Semanas consecutivas concluyentes sin progreso. */
  stallWeeks: number;
  /** Semilla quincenal para el generador de menus. */
  menuSeed: number;
  /** Toca refrescar el menu (mismos macros, alimentos distintos). */
  menuRefresh: boolean;
  base: EnergyBase;
}

export type FoodRole =
  | 'proteina_magra'
  | 'proteina_grasa'
  | 'carbo_pre'
  | 'carbo_post'
  | 'carbo_complejo'
  | 'grasa'
  | 'vegetal_libre'
  | 'fruta'
  | 'suplemento';

/**
 * Unidad casera en que se sirve un alimento. Es la referencia del SMAE
 * (Sistema Mexicano de Alimentos Equivalentes) traducida a lo que alguien
 * tiene en la cocina: cucharitas, tazas, piezas y rebanadas. `g` existe para
 * lo que de verdad se pesa (la pechuga, el pescado).
 */
export type ServingUnit =
  | 'cdita'
  | 'cda'
  | 'taza'
  | 'media_taza'
  | 'pieza'
  | 'rebanada'
  | 'scoop'
  | 'g';

/**
 * Porcion realista de un alimento: entre `minUnits` y `maxUnits` de su unidad
 * casera, en saltos de `step`.
 *
 * `minUnits` no es un minimo tecnico sino una **porcion minima digna**: nadie
 * sirve 12 g de aguacate ni media cucharadita de aceite. Si el solver no
 * alcanza ese minimo, el alimento se cae de la comida en vez de aparecer como
 * una pizca; si se pasa de `maxUnits`, entra un segundo alimento del mismo rol
 * en vez de estirar el primero a 400 g.
 */
export interface FoodServing {
  unit: ServingUnit;
  /** Gramos de UNA unidad. Para `unit: 'g'` siempre es 1. */
  gramsPerUnit: number;
  minUnits: number;
  maxUnits: number;
  /** Salto de redondeo en unidades. Default 0.5; pieza y scoop van a 1. */
  step?: number;
}

export interface Food {
  id: string;
  /** Nombre en espanol. */
  name: string;
  role: FoodRole;
  /** Macros por 100 g de alimento tal como se consume. */
  proteinPer100: number;
  carbPer100: number;
  fatPer100: number;
  fiberPer100: number;
  kcalPer100: number;
  /** Indice glucemico (glucosa=100). null si no aplica (proteinas, grasas). */
  gi: number | null;
  /** Costo relativo 1 (barato) - 3 (caro). */
  costRel: 1 | 2 | 3;
  /** Minutos de preparacion. */
  prepMin: number;
  tags: string[];
  /** Tope razonable de gramos en una comida (miel, aceites, polvos). */
  maxG?: number;
  /** Gramos por porcion habitual, para la lista de super. */
  servingG?: number;
  /** Unidad de compra para la lista de super. */
  unit?: string;
  /**
   * Medida casera y cotas de porcion. Es el freno real del generador: `maxG`
   * queda como techo absoluto, pero quien manda es `[minUnits, maxUnits]`.
   * Los vegetales libres y los suplementos no la necesitan (uno no se cuenta,
   * el otro se dosifica).
   */
  serving?: FoodServing;
}

/**
 * Por que esta ese alimento en esa comida. Determinista y sin texto libre: la
 * app arma la frase, el motor da los datos.
 */
export interface MenuItemWhy {
  role: FoodRole;
  /** Macro que ese alimento viene a cerrar en la comida. */
  closes: 'proteina' | 'carbo' | 'grasa' | 'fibra';
  /** Cuantas unidades caseras: 2 cditas, 1.5 tazas, 3 piezas. */
  units: number;
  /** La unidad ya en plural correcto: "cditas", "tazas", "piezas", "g". */
  unitLabel: string;
  /** Nota corta: "libre", "porcion minima", "tope de la porcion". */
  note?: string;
}

export interface MenuItem {
  foodId: string;
  name: string;
  grams: number;
  proteinG: number;
  carbG: number;
  fatG: number;
  fiberG: number;
  kcal: number;
  free: boolean;
  /** "2 cditas de aceite de oliva (10 g)". Lo que se lee primero. */
  display: string;
  why: MenuItemWhy;
  /** Presente si el alimento es ingrediente de un platillo (licuado, sopa). */
  preparacion?: PreparacionRef;
}

export type TipoPreparacion = 'licuado' | 'sopa' | 'crema' | 'caldo';

/**
 * Un ingrediente de una preparacion. Sale del catalogo de alimentos: o es un
 * alimento concreto (`foodId`) o se elige de una lista corta (`opciones`, que
 * tienen que ser de alguno de los roles de `rolePool`). Nunca un rol suelto:
 * "cualquier proteina magra" meteria la pechuga en el licuado.
 */
export interface IngredientePreparacion {
  foodId?: string;
  /**
   * `leche`: la leche que la persona eligio (`Profile.tipoLeche`). No es una
   * lista de opciones: quien compra deslactosada no quiere que el licuado
   * salga con entera.
   */
  tag?: 'leche';
  rolePool?: FoodRole[];
  opciones?: string[];
  /** Cotas de porcion propias del platillo, dentro de la medida casera del alimento. */
  minUnits?: number;
  maxUnits?: number;
  /** Entra si o si con una porcion fija: la taza de leche del licuado. */
  fijo?: boolean;
  /** Gramos de la porcion fija, para lo que no tiene medida casera (verduras). */
  gramos?: number;
  /** Si el slot no lo admite (sin carbohidrato denso), se omite sin tirar el platillo. */
  opcional?: boolean;
}

/**
 * Un platillo compuesto de alimentos del catalogo: el licuado del desayuno,
 * la sopa de la comida. No es un alimento nuevo con macros propios —esos
 * mentirian en cuanto cambie la porcion—: es una forma de agrupar alimentos
 * que el motor resuelve con sus mismas reglas.
 */
export interface Preparacion {
  id: string;
  nombre: string;
  tipo: TipoPreparacion;
  slots: MealSlotId[];
  ingredientes: IngredientePreparacion[];
  /** Minutos de cocina el dia que se come. */
  prepMin: number;
  /** `vegetariano`, `keto_ok`, `ayuno_ok`, `meal_prep`... */
  tags: string[];
  costRel: 1 | 2 | 3;
}

/** La preparacion a la que pertenece un alimento del menu. */
export interface PreparacionRef {
  id: string;
  nombre: string;
  tipo: TipoPreparacion;
}

export interface Equivalence {
  forFoodId: string;
  forName: string;
  options: Array<{
    foodId: string;
    name: string;
    grams: number;
    /** true si esta opcion sola se sale del +-10 %: sirve, pero no es igual. */
    aproximada?: boolean;
  }>;
  /**
   * true cuando las opciones NO caben en el +-10% de macro que promete una
   * equivalencia normal: son lo mas cercano que existe en el catalogo
   * elegible de esa persona. Se marca para que la app lo diga en voz alta en
   * vez de fingir un intercambio exacto.
   */
  aproximada?: boolean;
}

export interface MenuMeal {
  slot: MealSlotId;
  label: string;
  timeHint: string;
  items: MenuItem[];
  equivalences: Equivalence[];
  totals: MacroTargets;
  target: MacroTargets;
  /**
   * El platillo de la comida, si lo lleva, con su renglon agrupado: "Licuado
   * de fresa con avena — 1 taza de fresa · 40 g de avena". Nunca hay dos.
   */
  preparacion?: PreparacionRef & { display: string };
}

export interface Menu {
  id: 1 | 2;
  label: string;
  meals: MenuMeal[];
  totals: MacroTargets;
  /** Desviacion porcentual vs target por macro. */
  deviationPct: { kcal: number; proteinG: number; carbG: number; fatG: number };
}

export interface ShoppingItem {
  foodId: string;
  name: string;
  grams: number;
  unit: string;
  costRel: 1 | 2 | 3;
  /**
   * Ya esta en casa: la lista lo sigue mostrando —hace falta para cocinar—
   * pero marcado, para que nadie lo vuelva a comprar.
   */
  enDespensa?: boolean;
  /** Los platillos para los que se compra ("Crema de calabacita"). */
  preparaciones?: string[];
}

export interface MenuPlan {
  seed: number;
  target: MacroTargets;
  menus: [Menu, Menu];
  shoppingList: ShoppingItem[];
  /** Notas operativas neutras (electrolitos, vegetales libres, fibra). */
  notas: string[];
}
