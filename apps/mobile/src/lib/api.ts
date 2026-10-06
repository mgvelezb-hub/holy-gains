import { supabase } from "@/lib/supabase";

/**
 * Cliente tipado de `/api/v1`. La fuente de verdad de cada contrato son los
 * routes en `apps/web/src/app/api/v1/**` — si un shape cambia allá, cambia
 * aquí el tipo correspondiente.
 */

const API_URL = process.env.EXPO_PUBLIC_API_URL;

if (!API_URL) {
  throw new Error("Falta EXPO_PUBLIC_API_URL. Revisa apps/mobile/.env");
}

// ---------------------------------------------------------------------------
// Tipos de los contratos de API
// ---------------------------------------------------------------------------

export type MeResponse = {
  user: { id: string; email: string; role: string };
  onboarded: boolean;
  profile: {
    displayName: string;
    sex: "FEMALE" | "MALE" | "OTHER";
    heightCm: number | null;
    currentPhase: string;
    goal: string;
    trainingDaysPerWeek: number;
    /** Día en que cierra su semana: 0 = domingo. `null` = sin elegir. */
    checkinWeekday: number | null;
    /** Hora local del recordatorio, 0-23. `null` = sin recordatorio. */
    checkinHour: number | null;
    /** Escalón de presupuesto de despensa. */
    budget: "BAJO" | "MEDIO" | "ALTO";
    /** Cuántas comidas al día arma el motor. */
    mealsPerDay: number;
    // Preferencias de la Fase 6. Van opcionales a propósito: la app se
    // actualiza en el teléfono y la API en Vercel, así que entre un deploy y
    // otro siempre hay un rato en que el servidor todavía no las manda. Una
    // pantalla de ajustes no puede caerse por eso.
    /** Tope de minutos de cocina por preparación. `null` = sin tope. */
    maxPrepMin?: number | null;
    /** Lo que sí le gusta comer: el motor lo prefiere al armar el menú. */
    favoriteFoods?: string[];
    /** Lo que no come: el motor lo saca del catálogo. */
    excludedFoods?: string[];
    /** Grupos que pidió no repetir en la semana. */
    avoidRepeatGroups?: MuscleGroup[];
    /** La disciplina que arma el esqueleto de la semana. */
    primaryDiscipline?: Discipline;
    /** Las demás disciplinas activas, con su carga semanal. */
    otherDisciplines?: DisciplineLoad[];
    /** Nivel en el agua. Respaldo del nivel por disciplina. */
    swimLevel?: SwimLevel;
    /** Nivel declarado por disciplina: `{ "BOX": "PRINCIPIANTE" }`. */
    disciplineLevels?: Partial<Record<Discipline, SwimLevel>>;
    /** Estilo de dieta elegido. */
    dietStyle?: DietStyle;
    /** Suplementos que tiene. El plan solo sugiere lo declarado. */
    supplements?: string[];
    /** Rango de edad declarado, si no dio fecha de nacimiento. */
    ageRange?: string | null;
    /** Momento del día en que entrena. */
    trainingTime?: "MANANA" | "MEDIODIA" | "TARDE" | "NOCHE";
    /** Horario por día para quien no entrena siempre a la misma hora. */
    trainingSchedule?: unknown;
    /** Cómo acomodó su Resumen. El catálogo de paneles vive en la app. */
    summaryLayout?: unknown;
    /** Referencia numérica del objetivo, si capturó una. */
    goalReference?: unknown;
    /** Ventana de alimentación del ayuno, en horas locales. */
    fastingStartHour?: number | null;
    fastingEndHour?: number | null;
    /**
     * Minutos disponibles por día, declarados (Fase 7): `{"LUN":60,...}`.
     * `null`/ausente = no declarado. Es lo que hace honesto el reparto de un
     * día combinado — sin esto el generador no sabe si un "SÁB" con dos
     * disciplinas de verdad tiene tiempo para las dos.
     */
    timePerDay?: Record<string, number> | null;
    /**
     * Si el planificador combina disciplinas compatibles el mismo día
     * (Fase 10). `undefined` = todavía no llega el deploy que lo manda;
     * la pantalla lo trata como el default de la base (`true`).
     */
    compactDays?: boolean;
    /**
     * Estilo de esquema fijo elegido en preferencias. `undefined` = todavía
     * no llega el deploy que lo manda; la pantalla lo trata como el default
     * de la base (`RECOMENDADO`).
     */
    schemePreference?: SchemePreference;
    /** El split fijado a mano, día por día. `null` = lo decide el motor. */
    customSplit?: CustomSplit | null;
    /** Cómo se hacen los unilaterales. Ver `UNILATERAL_MODES`. */
    unilateralMode?: UnilateralMode;
  } | null;
};

/** Los grupos musculares del generador, en el orden en que se recorre el cuerpo. */
export const MUSCLE_GROUPS = [
  "PIERNA",
  "HOMBRO",
  "PECHO",
  "ESPALDA",
  "BICEP",
  "TRICEP",
  "ABDOMEN",
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

/**
 * Una disciplina activa y cuántas veces por semana se practica. `Discipline`
 * y sus etiquetas viven abajo, con el contrato de `/api/v1/activities`.
 */
export type DisciplineLoad = {
  discipline: Discipline;
  sessionsPerWeek: number;
  /**
   * Para qué se entrena (Fase 7). Opcional: los registros viejos no lo
   * traen y Ajustes deriva un valor a partir de las sesiones declaradas.
   */
  proposito?: "ENTRENAMIENTO" | "COMPLEMENTO" | "HOBBY";
  /** 1-3: cuánto pesa esta disciplina al repartir el tiempo. Opcional por lo mismo. */
  importancia?: number;
};

/** Una medida del mensual: contra el mensual anterior y contra el inicio. */
export type DeltaMensual = {
  actual: number | null;
  vsMesAnterior: number | null;
  vsInicio: number | null;
};

export const METRICAS_MENSUALES = [
  "cintura",
  "peso",
  "brazoIzq",
  "brazoDer",
  "piernaIzq",
  "piernaDer",
] as const;
export type MetricaMensual = (typeof METRICAS_MENSUALES)[number];

export type ZonaObjetivo = "cintura" | "cadera_gluteo" | "pierna" | "brazo" | "espalda";

export type LecturaZona = {
  zona: ZonaObjetivo;
  brecha: "cerca" | "media" | "lejos";
  tendencia: "acercándose" | "igual" | "alejándose";
  accion: string;
};

/** El bloque mensual que el servidor arma tras el check-in (`lib/coachy/mensual.ts`). */
export type BloqueMensual = {
  esMensual: boolean;
  previoMensualId: string | null;
  deltas: Record<MetricaMensual, DeltaMensual>;
  fotos: { estado: "listo" | "sin_referencia" | "sin_fotos" | "en_espera"; zonas: LecturaZona[] } | null;
  objetivo: { vaBien: string[]; ajustar: string[] };
};

/** "Va bien", "Hay que ajustar" y "Tu plan de aquí en adelante". */
export type RetroCheckIn = {
  va_bien: string[];
  ajustar: string[];
  plan: { macros: string; menu: string; rutina: string };
};

export type Decision = {
  id: string;
  checkInId: string;
  phase: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  checkInDate: string;
  publishedAt: string;
  texto: string | null;
  meta: string | null;
  preguntas: string[];
  alreadyAnswered: boolean;
  /** `null` en decisiones de antes del mensual del servidor. */
  mensual: BloqueMensual | null;
  retro: RetroCheckIn | null;
};

export type ProximoMensual = {
  /** Semanas que faltan, redondeando hacia arriba. `0` = ya toca. */
  semanas: number;
  fecha: string;
  ultimoMensual: string;
};

export type EstadoAnalisis = "analizando" | "lista";

export type DecisionResponse = {
  decision: Decision | null;
  /** En qué va el análisis de `checkInId` (el pedido con `desde`, o el último). */
  estado: EstadoAnalisis;
  checkInId: string | null;
  /** La decisión espera a su coach humano, no a la IA. */
  enRevisionHumana: boolean;
  proximoMensual: ProximoMensual | null;
};

export type CheckInDecisionSummary = {
  phase: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export type CheckInRow = {
  id: string;
  date: string;
  waistCm: number | null;
  weightKg: number | null;
  legLeftCm: number | null;
  legRightCm: number | null;
  armLeftCm: number | null;
  armRightCm: number | null;
  decision: CheckInDecisionSummary | null;
};

/** El punto cero declarado: desde dónde se compara todo. `null` = sin declarar. */
export type PuntoCero = { checkInId: string; date: string } | null;

export type CheckInsResponse = { checkIns: CheckInRow[]; puntoCero?: PuntoCero };

export type PuntoCeroResponse = { puntoCero: PuntoCero };

/** Cuál de los dos menús de la semana se va a cocinar. */
export const MENU_PREFERENCES = ["AMBOS", "MENU_1", "MENU_2"] as const;
export type MenuPreference = (typeof MENU_PREFERENCES)[number];

/** Un tiempo de comida con la hora que rige hoy. */
export type TiempoDeComida = {
  slot: string;
  label: string;
  /** "14:00" — la propia si la movió, la del motor si no. */
  hora: string;
  propia: boolean;
};

export type HorariosResponse = {
  horarios: Record<string, string>;
  tiempos: TiempoDeComida[];
  /** Se guardó, pero conviene saberlo (post-entreno lejos, día muy largo). */
  avisos?: string[];
};

/** `GET /api/v1/me/horarios-comida` — a qué hora come, con lo que rige hoy. */
export function getHorariosComida(): Promise<HorariosResponse> {
  return apiFetch<HorariosResponse>("/api/v1/me/horarios-comida");
}

/**
 * `PUT /api/v1/me/horarios-comida` — mover una o varias horas.
 *
 * Un slot en `null` vuelve a la hora que sugiere el motor. El servidor valida
 * el día completo (orden, separación mínima, ventana del día) y responde 422
 * con el motivo en palabras si algo no cabe.
 */
export function putHorariosComida(
  horarios: Record<string, string | null>,
): Promise<HorariosResponse> {
  return apiFetch<HorariosResponse>("/api/v1/me/horarios-comida", {
    method: "PUT",
    body: { horarios },
  });
}

/**
 * `PUT /api/v1/me/menu-preferido` — cocinar los dos menús o uno solo.
 *
 * Devuelve la lista de súper ya recalculada: un menú solo se come los 7 días
 * y no hay por qué comprar los ingredientes del otro.
 */
export function putMenuPreferido(
  menuPreference: MenuPreference,
): Promise<{ menuPreference: MenuPreference; groceries: GroceryItem[] }> {
  return apiFetch<{ menuPreference: MenuPreference; groceries: GroceryItem[] }>(
    "/api/v1/me/menu-preferido",
    { method: "PUT", body: { menuPreference } },
  );
}

/**
 * `POST /api/v1/training/cambiar-bloque` — "hoy no pude ir a squash, dame gym".
 *
 * Es una excepción de ESE día, no un cambio de plan. Si se cambia a pesas, el
 * servidor materializa la sesión de gimnasio completa y responde
 * `sesionCreada: true`.
 */
export function postCambiarBloque(
  date: string,
  discipline: Discipline,
): Promise<{ date: string; discipline: Discipline; sesionCreada: boolean }> {
  return apiFetch<{ date: string; discipline: Discipline; sesionCreada: boolean }>(
    "/api/v1/training/cambiar-bloque",
    { method: "POST", body: { date, discipline } },
  );
}

/**
 * `GET /api/v1/me/punto-cero` — desde qué check-in se está comparando.
 */
export function getPuntoCero(): Promise<PuntoCeroResponse> {
  return apiFetch<PuntoCeroResponse>("/api/v1/me/punto-cero");
}

/**
 * `PUT /api/v1/me/punto-cero` — declarar la referencia, o quitarla con `null`.
 *
 * Quitarlo NO pierde nada: el historial anterior sigue en el servidor y
 * vuelve a contar en cuanto se quita la marca.
 */
export function putPuntoCero(checkInId: string | null): Promise<PuntoCeroResponse> {
  return apiFetch<PuntoCeroResponse>("/api/v1/me/punto-cero", {
    method: "PUT",
    body: { checkInId },
  });
}

/** Los campos EXACTOS de `checkInSchema` (apps/web/src/lib/validation/checkin.ts). */
export const STRENGTH_TRENDS = ["SUBE", "IGUAL", "BAJA"] as const;
export const CYCLE_PHASES = ["FOLICULAR", "OVULACION", "LUTEA", "MENSTRUACION", "NA"] as const;
export const SYMPTOMS = [
  "calambres",
  "mareo",
  "dolor_espalda",
  "dolor_pie",
  "dolor_cabeza",
  "estrenimiento",
  "inflamacion_abdominal",
  "otro",
] as const;

export const SYMPTOM_LABELS: Record<(typeof SYMPTOMS)[number], string> = {
  calambres: "Calambres",
  mareo: "Mareo",
  dolor_espalda: "Dolor de espalda",
  dolor_pie: "Dolor de pie",
  dolor_cabeza: "Dolor de cabeza",
  estrenimiento: "Estreñimiento",
  inflamacion_abdominal: "Inflamación abdominal",
  otro: "Otro",
};

export type StrengthTrend = (typeof STRENGTH_TRENDS)[number];
export type CyclePhase = (typeof CYCLE_PHASES)[number];
export type Symptom = (typeof SYMPTOMS)[number];

export type CheckInPayload = {
  date: string; // yyyy-MM-dd
  /**
   * Van a subirse fotos después: el servidor no analiza al guardar y espera
   * a `postCheckinListo`, para que la lectura use las fotos de este check-in.
   */
  fotosPendientes?: boolean;
  waistCm: number;
  weightKg?: number | null;
  legLeftCm?: number | null;
  legRightCm?: number | null;
  armLeftCm?: number | null;
  armRightCm?: number | null;
  inflammation: number;
  energy: number;
  hunger: number;
  satiety: number;
  /**
   * Descanso 1-5. Opcional: la app ya no lo pregunta y el servidor lo deriva
   * de las noches que subió el reloj.
   */
  sleep?: number;
  strengthRpe?: number | null;
  strengthTrend?: StrengthTrend | null;
  dietCompliance: number;
  trainingCompliance: number;
  symptoms: Symptom[];
  otherSymptom?: string;
  cyclePhase?: CyclePhase | null;
  periodStarted: boolean;
  comment?: string;
};

export type CheckInCreatedResponse = { id: string; date: string };

// ---------------------------------------------------------------------------
// Fotos de progreso
// ---------------------------------------------------------------------------

/** Las tres vistas del check-in. Mismo enum que `PHOTO_VIEWS` en el servidor. */
export const PHOTO_VIEWS = ["FRENTE", "PERFIL", "ESPALDA"] as const;
export type PhotoView = (typeof PHOTO_VIEWS)[number];

export const PHOTO_VIEW_LABEL: Record<PhotoView, string> = {
  FRENTE: "Frente",
  PERFIL: "Perfil",
  ESPALDA: "Espalda",
};

/** Bucket privado de las fotos. La RLS filtra por primera carpeta = user id. */
export const PHOTO_BUCKET = "progress-photos";

/**
 * Ruta canónica de una foto de progreso — la MISMA que reconstruye el
 * servidor (`photoPath` en apps/web/src/lib/storage.ts). Si las dos fórmulas
 * se separan, la app sube a un lado y el servidor registra otro.
 */
export function progressPhotoPath(userId: string, checkInId: string, view: PhotoView): string {
  return `${userId}/${checkInId}/${view.toLowerCase()}.jpg`;
}

/** Confirma al servidor que la foto ya quedó en Storage y crea su fila. */
/**
 * `POST /api/v1/checkins/:id/listo` — las fotos ya subieron (o se intentó):
 * ahora sí que se analice. Idempotente en el servidor.
 */
export function postCheckinListo(checkInId: string): Promise<{ checkInId: string; accion: string }> {
  return apiFetch<{ checkInId: string; accion: string }>(`/api/v1/checkins/${checkInId}/listo`, {
    method: "POST",
  });
}

export function postCheckinPhoto(
  checkInId: string,
  view: PhotoView,
): Promise<{ id: string; view: PhotoView }> {
  return apiFetch<{ id: string; view: PhotoView }>(`/api/v1/checkins/${checkInId}/photos`, {
    method: "POST",
    body: { view },
  });
}

export type ProgressPhoto = {
  id: string;
  checkInId: string;
  /** yyyy-MM-dd del check-in al que pertenece. */
  date: string;
  view: PhotoView;
  /** URL firmada y temporal. `null` si la firma falló. */
  url: string | null;
};

/** `GET /api/v1/photos` — para la bóveda. Las URLs caducan. */
export function getPhotos(limit?: number): Promise<{ fotos: ProgressPhoto[] }> {
  const query = limit ? `?limit=${limit}` : "";
  return apiFetch<{ fotos: ProgressPhoto[] }>(`/api/v1/photos${query}`);
}

export type MenuItem = {
  name: string;
  grams: number;
  free: boolean;
  /** "3 tortillas de maíz" cuando el alimento se sirve por pieza. */
  portion: string | null;
};
export type MenuMeal = {
  slot: string;
  label: string;
  timeHint: string;
  allowDenseCarb: boolean;
  items: MenuItem[];
  equivalences: Array<{
    forName: string;
    options: Array<{
      name: string;
      grams: number;
      portion: string | null;
      /** Esta opción sola se sale del ±10%: sirve, pero no cuadra igual. */
      aproximada?: boolean;
      /** Ya está en casa (despensa o alimento propio). */
      enDespensa?: boolean;
      /** Su familia ya va en otra comida de hoy: aviso, se puede elegir. */
      enOtraComida?: boolean;
    }>;
    /**
     * `true` cuando ninguna opción del catálogo cupo dentro del ±10% de
     * macro del alimento original — el motor igual ofrece la más cercana en
     * vez de dejar al usuario sin cambio. Opcional: el API viejo no lo manda.
     */
    aproximada?: boolean;
    /** Equivalentes de su grupo SMAE que no van con esta comida, con el porqué. */
    noVan?: Array<{ name: string; grams: number; portion: string | null; motivo: string }>;
  }>;
};
export type Menu = { menuNumber: number; meals: MenuMeal[] };
export type GroceryItem = {
  name: string;
  grams: number;
  unit: string;
  /** "7 naranjas" cuando se compra por pieza; los gramos van al lado. */
  portion?: string | null;
  /** Ya lo tienes en casa: la lista lo marca en vez de mandarte a comprarlo. */
  enDespensa?: boolean;
};

export type NutritionDecisionSummary = {
  id: string;
  phase: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export type NutritionResponse = {
  decision: NutritionDecisionSummary | null;
  menus: Menu[];
  groceries: GroceryItem[];
  materialized: boolean;
  /** Cuál de los dos menús se está cocinando; la lista de súper lo sigue. */
  menuPreference?: MenuPreference;
  /** Las horas propias que ya pisan la sugerencia del motor. */
  horarios?: Record<string, string>;
};

export type TodayCard = {
  workoutId: string;
  muscleGroup: string;
  schemeLabel: string;
  exerciseCount: number;
  cardioMinutes: number | null;
  completed: boolean;
  /** Minutos a los que se recortó la sesión, o `null` si está completa. */
  trimmedMinutes: number | null;
};

export type TrainingTodayResponse = {
  today: TodayCard | null;
  /**
   * La sesión de otra disciplina de hoy (Fase 7). Opcional: una app instalada
   * antes de la fase habla con el mismo endpoint y no la recibe.
   */
  otherSession?: OtherSessionView | null;
};

/** Lo que regresa `POST /api/v1/training/trim`. */
export type TrimResponse = {
  sesion: {
    workoutId: string;
    date: string;
    muscleGroup: string;
    minutes: number;
    exercises: number;
    removed: number;
  };
};

/**
 * "Hoy tengo menos tiempo": vuelve a armar la sesión para los minutos que hay.
 *
 * `minutes: null` deshace el recorte y la deja como estaba. El servidor
 * rechaza con 409 una sesión que ya tiene series capturadas — recortarla
 * dejaría esas series apuntando a un plan que ya no existe.
 */
export function trimSession(
  workoutId: string,
  minutes: number | null,
  /** El día (`YYYY-MM-DD`): si el id en memoria ya no existe, el servidor resuelve por fecha (O1). */
  date?: string,
): Promise<TrimResponse> {
  return apiFetch<TrimResponse>("/api/v1/training/trim", {
    method: "POST",
    body: { workoutId, minutes, ...(date ? { date } : {}) },
  });
}

export type CheckInPoint = {
  id: string;
  date: string;
  waistCm: number | null;
  weightKg: number | null;
  legLeftCm: number | null;
  legRightCm: number | null;
  armLeftCm: number | null;
  armRightCm: number | null;
  inflammation: number;
  energy: number;
  dietCompliance: number;
  phase: string | null;
};

export type HistoryMeasurementsResponse = { points: CheckInPoint[] };

// ---------------------------------------------------------------------------
// Modo gimnasio (Fase N4) — contrato EXACTO de
// apps/web/src/lib/training/view.ts y apps/web/src/lib/validation/training.ts.
// Si esos shapes cambian allá, cambian aquí.
// ---------------------------------------------------------------------------

export type SchemeId =
  | "PIRAMIDAL"
  | "FUERZA"
  | "METABOLICO"
  | "RANGO_MEDIO"
  | "VOLUMEN_9"
  | "REHAB";

/** Una serie objetivo: reps y el peso sugerido. `weightKg: null` = campo vacío. */
export type TargetSet = {
  reps: number;
  weightKg: number | null;
  warmup: boolean;
  /** Tempo prescrito, en segundos: bajar, pausa, subir. Se lee "3-1-1". */
  tempo?: { ecc: number; pause: number; con: number };
  /** `fallo` = hasta que no salga otra; `dropset` = serie extra sin descanso. */
  intensity?: "normal" | "fallo" | "dropset";
  /** Solo en unilaterales: con qué lado va esta serie. */
  side?: "IZQ" | "DER" | "AMBOS";
};

/** A qué se puede cambiar un ejercicio si la máquina está ocupada. */
export type ExerciseAlternative = {
  exerciseId: string;
  name: string;
  declared: boolean;
  videoPath: string | null;
};

export type SessionExerciseView = {
  exerciseId: string | null;
  name: string;
  muscleGroup: string;
  poolRole: string;
  scheme: SchemeId;
  schemeLabel: string;
  restSeconds: number;
  videoPath: string | null;
  tracker: boolean;
  note: string | null;
  sets: TargetSet[];
  /** Minutos estimados del ejercicio (Fase 3). Ausente en planes viejos. */
  estimatedMin?: number;
  /** Se hace un lado a la vez: sus series traen `side`. */
  unilateral?: boolean;
  /** URL firmada del video. Caduca; sin red la pantalla se pinta igual. */
  videoUrl: string | null;
  lastWeightKg: number | null;
  bestWeightKg: number | null;
  record: PersonalRecord | null;
  alternatives: ExerciseAlternative[];
};

/** Un paso del calentamiento dinámico previo a la sesión. */
export type WarmupStep = { nombre: string; segundos: number };

/**
 * El calentamiento dinámico de la sesión: SIEMPRE antepone 2 min de elevar
 * el pulso, seguidos de los movimientos específicos del grupo del día. `null`
 * en sesiones materializadas antes de esta fase — la pantalla simplemente no
 * lo enseña.
 */
export type SessionWarmup = { pasos: WarmupStep[]; totalSeg: number };

export type SessionView = {
  workoutId: string;
  date: string;
  muscleGroup: string;
  scheme: SchemeId;
  schemeLabel: string;
  cardioMinutes: number | null;
  /**
   * Minutos estimados de la sesión, calentamiento incluido. `null` en
   * sesiones armadas antes de la Fase 3: la cabecera no enseña el dato.
   */
  estimatedMin?: number | null;
  completedAt: string | null;
  /** Minutos a los que se recortó la sesión, o `null` si está completa. */
  trimmedMinutes: number | null;
  cycleNote: string | null;
  /**
   * Días de periodo (estimados): los minutos de la versión ligera que se
   * ofrece si hay molestias. Ausente en servidores viejos.
   */
  cicloLigera?: { minutos: number } | null;
  readinessNote: string | null;
  warmup: SessionWarmup | null;
  exercises: SessionExerciseView[];
};

/** Un bloque de una sesión de disciplina: calentamiento, técnica, principal... */
export type BloqueSesion = {
  title: string;
  detail: string;
  /** La carga en la unidad de la disciplina. `null` si ese bloque no se mide. */
  carga: number | null;
  restSeconds: number | null;
  note: string;
};

/**
 * Una sesión prescrita de una disciplina que no es pesas.
 *
 * La unidad cambia por disciplina —metros, rondas, asaltos, minutos— porque
 * traducirlo todo a series y repeticiones fue lo que hizo que el registro de
 * pesas no supiera guardar una sesión de alberca.
 */
export type SesionDisciplina = {
  discipline: Discipline;
  nivel: SwimLevel;
  focus: string;
  unidad: string;
  cargaTotal: number;
  minutes: number;
  blocks: BloqueSesion[];
  deload: boolean;
  notes: string[];
  /** Solo el cardio en máquina (H2): lo que pinta la tarjeta y corre el timer. */
  cardio?: DetalleCardio;
};

export type EquipoCardio = "CAMINADORA" | "ESCALERA" | "BICI" | "ELIPTICA" | "LIBRE";
export type TipoCardio = "HIIT" | "CONTINUO";
export type NivelCardio = "BASICO" | "MEDIO" | "AVANZADO";

/** Igual que `DetalleCardio` en apps/web/src/lib/training/disciplinas/tipos.ts. */
export type DetalleCardio = {
  equipo: EquipoCardio;
  tipo: TipoCardio;
  nivelMaquina: number;
  /** "Cardio HIIT caminadora". */
  etiqueta: string;
  intervalos: {
    rondas: number;
    fuerteSeg: number;
    suaveSeg: number;
    nivelFuerte: number;
    nivelSuave: number;
  } | null;
  calentamientoSeg: number;
  enfriamientoSeg: number;
};

/** Preferencias de cardio dentro de `otherDisciplines` (sin columna propia). */
export type PreferenciasCardio = {
  equipo?: EquipoCardio;
  tipo?: TipoCardio;
  nivel?: NivelCardio;
  minutos?: number;
};

/**
 * Una sesión de otra disciplina dentro de la semana (Fase 7). `swim` solo
 * viene en natación: es la única disciplina que la app sabe prescribir.
 */
export type OtherSessionView = {
  date: string;
  weekday: string;
  discipline: Discipline;
  minutes: number;
  /** El plan, si esa disciplina ya se prescribe. `null` = solo reserva el día. */
  sesion: SesionDisciplina | null;
  note: string;
  sharesDayWithGym: boolean;
  /**
   * Posición dentro del día (Fase 7): un día puede tener DOS bloques —gym +
   * disciplina, o disciplina + disciplina— y `orden` dice cuál va primero.
   * `note` explica el porqué ("la alberca al final para soltar"). El
   * gimnasio no declara `orden`: ocupa la posición que la otra no usa.
   */
  orden: 1 | 2;
  /** Minutos que le quedaron al gym ese día al cederle tiempo a este bloque (H2). */
  gymMinutes?: number;
};

export const SWIM_LEVELS = ["PRINCIPIANTE", "INTERMEDIO", "AVANZADO"] as const;
export type SwimLevel = (typeof SWIM_LEVELS)[number];

export type WeekView = {
  weekStart: string;
  today: string;
  sessions: SessionView[];
  /**
   * Opcional a propósito: una semana cacheada en el teléfono antes de la Fase
   * 7 no la trae, y la pantalla tiene que pintarse igual.
   */
  otherSessions?: OtherSessionView[];
  /**
   * Avisos del split: lo que estorba y hay que decidir ("Hombro el martes y
   * pecho el miércoles: te va a doler. Cambiar"). Opcional: una semana
   * cacheada antes de la Fase 3 no los trae.
   */
  avisos?: string[];
  /**
   * La semana día por día en el formato común (I1): la misma línea en
   * Rutinas, Ajustes "Tu semana", el Resumen y Hoy. Opcional: una semana
   * cacheada antes no la trae y cada pantalla cae a su lectura de siempre.
   */
  plan?: DiaDelPlan[];
};

/**
 * Una serie capturada, lista para subir. Shape exacto de `workoutSetSchema`
 * en apps/web/src/lib/validation/training.ts.
 *
 * `clientId` sigue la convención de la web (apps/web/src/app/app/entrenamiento
 * /training-session.tsx): `${workoutId}:${exerciseIndex}:${setIndex}`. Es
 * contrato con el servidor — el borrado selectivo al sustituir ejercicio hace
 * `deleteMany` por prefijo `${workoutId}:${exerciseIndex}:`.
 */
export type WorkoutSetInput = {
  clientId: string;
  exerciseId: string | null;
  exerciseName: string;
  setIndex: number;
  targetReps: number;
  reps: number;
  weightKg: number | null;
  rpe: number | null;
  warmup: boolean;
  performedAt: string;
};

export type SubstitutionInput = { exerciseIndex: number; exerciseId: string };

/** Una sesión pendiente de subir. Shape exacto de `sessionSyncSchema`. */
export type SessionSyncInput = {
  workoutId: string;
  completedAt: string | null;
  notes: string | null;
  sets: WorkoutSetInput[];
  substitutions: SubstitutionInput[];
};

export type SyncSessionResult =
  | {
      workoutId: string;
      ok: true;
      prs: Array<{ exerciseName: string; weightKg: number; previousKg: number | null }>;
      volumeKg: number;
      cambios: unknown;
    }
  | { workoutId: string; ok: false; error: string };

export type SyncResponse = { resultados: SyncSessionResult[] };

export type TrainingHistoryRow = {
  workoutId: string;
  date: string;
  muscleGroup: string;
  volumeKg: number;
  sets: number;
  prs: Array<{ exerciseName: string; weightKg: number }>;
  completed: boolean;
};

export type PersonalRecord = {
  exerciseName: string;
  weightKg: number;
  reps: number;
  date: string;
  /**
   * El ejercicio del catálogo, para abrir su tendencia desde el récord.
   * `null`/ausente cuando la serie se capturó suelta o el catálogo cambió.
   */
  exerciseId?: string | null;
};

export type HistoryTrainingResponse = {
  sessions: TrainingHistoryRow[];
  records: PersonalRecord[];
};

export type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  createdAt: string;
};

export type NotificationsResponse = { notificaciones: Notification[] };
export type MarkNotificationsReadResponse = { marcadas: number };

// ---------------------------------------------------------------------------
// Fetch base
// ---------------------------------------------------------------------------

/** Error de API con el status HTTP y, si vino, el cuerpo de error del backend. */
export class ApiError extends Error {
  status: number;
  detalles?: Record<string, string>;

  constructor(message: string, status: number, detalles?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detalles = detalles;
  }
}

/**
 * `fetch` autenticado contra `/api/v1`: toma el access token de la sesión de
 * Supabase, agrega el Bearer, y si el backend responde 401 (sesión muerta)
 * cierra la sesión local para forzar el regreso a /login.
 */
/**
 * Exportado para los módulos de API por dominio (`api-golf.ts`,
 * `api-household.ts`): este archivo ya pasa de 1 400 líneas y cada dominio
 * nuevo lo engordaba más. Los dominios nuevos viven en su propio archivo y
 * comparten el transporte desde aquí.
 */
export async function apiFetch<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 401) {
    // Sesión muerta o inválida en el backend: no tiene caso conservarla local.
    await supabase.auth.signOut();
    throw new ApiError("Tu sesión expiró. Vuelve a iniciar sesión.", 401);
  }

  if (!response.ok) {
    let message = `Error del servidor (${response.status})`;
    let detalles: Record<string, string> | undefined;
    try {
      const body = (await response.json()) as { error?: string; detalles?: Record<string, string> };
      if (body.error) message = body.error;
      detalles = body.detalles;
    } catch {
      // El cuerpo no era JSON: nos quedamos con el mensaje genérico.
    }
    throw new ApiError(message, response.status, detalles);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export function getMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>("/api/v1/me");
}

/** `PATCH /api/v1/me/checkin` — cuándo cierra su semana esta persona. */
export function patchCheckinSchedule(
  weekday: number | null,
  hour: number | null,
): Promise<{ checkinWeekday: number | null; checkinHour: number | null }> {
  return apiFetch<{ checkinWeekday: number | null; checkinHour: number | null }>(
    "/api/v1/me/checkin",
    { method: "PATCH", body: { weekday, hour } },
  );
}

/**
 * `PATCH /api/v1/me/nutricion` — las preferencias que cambian el menú.
 *
 * Se manda solo lo que cambió: la pantalla guarda un ajuste a la vez y mandar
 * el resto pisaría con valores viejos lo que se acaba de tocar.
 */
export const DIET_STYLES = ["ESTANDAR", "AYUNO", "VEGETARIANA", "KETO"] as const;
export type DietStyle = (typeof DIET_STYLES)[number];

export type PreferenciasNutricion = {
  budget?: "BAJO" | "MEDIO" | "ALTO";
  maxPrepMin?: number | null;
  favoriteFoods?: string[];
  excludedFoods?: string[];
  dietStyle?: DietStyle;
  fastingStartHour?: number | null;
  fastingEndHour?: number | null;
  supplements?: Array<"WHEY" | "CREATINA" | "OMEGA3">;
};

export type PreferenciasNutricionResponse = {
  budget: "BAJO" | "MEDIO" | "ALTO";
  maxPrepMin: number | null;
  favoriteFoods: string[];
  excludedFoods: string[];
  dietStyle: DietStyle;
  fastingStartHour: number | null;
  fastingEndHour: number | null;
};

export function patchNutricion(
  cambios: PreferenciasNutricion,
): Promise<PreferenciasNutricionResponse> {
  return apiFetch<PreferenciasNutricionResponse>("/api/v1/me/nutricion", {
    method: "PATCH",
    body: cambios,
  });
}

/** `PATCH /api/v1/me/nutricion` — atajo del presupuesto, el ajuste más usado. */
export function patchPresupuesto(
  budget: "BAJO" | "MEDIO" | "ALTO",
): Promise<PreferenciasNutricionResponse> {
  return patchNutricion({ budget });
}

/**
 * `PATCH /api/v1/me/entrenamiento` — las preferencias que cambian la rutina:
 * los grupos que no se repiten y las disciplinas que gastan del presupuesto
 * semanal. Entra en la siguiente rutina, no en la que ya está publicada.
 */
export type PreferenciasEntrenamiento = {
  avoidRepeatGroups?: MuscleGroup[];
  primaryDiscipline?: Discipline;
  otherDisciplines?: DisciplineLoad[];
  swimLevel?: SwimLevel;
  /** Nivel por disciplina. Se manda entero: el servidor guarda el mapa. */
  disciplineLevels?: Partial<Record<Discipline, SwimLevel>>;
  /**
   * Minutos por día (Fase 7), 0-300, `null` = sin declarar ese día. Se manda
   * el mapa entero: el servidor lo guarda tal cual, igual que `disciplineLevels`.
   */
  timePerDay?: Record<string, number> | null;
  /** Combinar disciplinas compatibles el mismo día, o darle a cada una el suyo (Fase 10). */
  compactDays?: boolean;
  /**
   * Estilo de esquema fijo. `RECOMENDADO` (default) deja que el generador
   * siga rotando piramidal → fuerza → metabólico → rango medio cada semana
   * — la periodización ondulante, que la evidencia respalda igual o mejor
   * que una progresión lineal para fuerza (Rhea et al. 2002). Los otros tres
   * valores fijan un único esquema todas las semanas. Ver `SCHEME_PREFERENCES`
   * en `apps/web/src/lib/training/schemes.ts` para el sustento completo.
   */
  schemePreference?: SchemePreference;
  /**
   * El split día por día. Se manda el mapa entero, igual que
   * `disciplineLevels`: parcharlo día a día dejaría que dos ediciones
   * seguidas se pisen. `null` lo limpia y devuelve la decisión al motor.
   */
  customSplit?: CustomSplit | null;
  /** `SEGUIDO` (default) o `ALTERNADO`. Ver `UNILATERAL_MODES`. */
  unilateralMode?: UnilateralMode;
  /**
   * A qué hora entrena, parejo toda la semana. Cambia la ESTRUCTURA de las
   * comidas —quien entrena de noche desayuna bajo en carbohidratos— así que
   * al cambiarlo el servidor rearma el menú y responde `menuRearmado: true`.
   */
  trainingTime?: TrainingTime;
  /** Horario por día para quien no entrena siempre a la misma hora. `null` lo limpia. */
  trainingSchedule?: Partial<Record<string, TrainingTime | "DESCANSO">> | null;
};

/** Los cuatro horarios del perfil. */
export const TRAINING_TIMES = ["MANANA", "MEDIODIA", "TARDE", "NOCHE"] as const;
export type TrainingTime = (typeof TRAINING_TIMES)[number];

/**
 * Los cuatro estilos de esquema que puede elegir la atleta en preferencias.
 * `RECOMENDADO` va primero: es y sigue siendo el default (la rotación).
 */
export const SCHEME_PREFERENCES = [
  "RECOMENDADO",
  "FUERZA",
  "HIPERTROFIA",
  "METABOLICO",
  /** El método del coach completo: piramidal de peso / rango medio, tempo y fallo. */
  "COACH",
] as const;
export type SchemePreference = (typeof SCHEME_PREFERENCES)[number];

/**
 * Los tipos de día del split. Mismos valores que `DayKind` en
 * `apps/web/src/lib/training/types.ts`, repetidos aquí porque este cliente no
 * importa del motor.
 */
export const DAY_KINDS = [
  "PIERNA_CUADRICEPS",
  "PIERNA_FEMORAL",
  "PIERNA_GLUTEO",
  "HOMBRO",
  "PECHO_ESPALDA",
  "BRAZO",
  "HOMBRO_BRAZO",
  "TORSO",
  "PECHO_TRICEP",
  "ESPALDA_BICEP",
] as const;
export type DayKind = (typeof DAY_KINDS)[number];

/** El split por día de la semana. Lo que no aparece —o es `DESCANSO`— descansa. */
export type CustomSplit = Partial<Record<string, DayKind | "DESCANSO">>;

/** Cómo se hacen los ejercicios de un lado a la vez. */
export const UNILATERAL_MODES = ["SEGUIDO", "ALTERNADO"] as const;
export type UnilateralMode = (typeof UNILATERAL_MODES)[number];

export type PreferenciasEntrenamientoResponse = {
  avoidRepeatGroups: MuscleGroup[];
  primaryDiscipline: Discipline;
  otherDisciplines: DisciplineLoad[];
  swimLevel: SwimLevel;
  compactDays?: boolean;
  schemePreference?: SchemePreference;
  trainingTime?: TrainingTime;
  trainingSchedule?: Record<string, string> | null;
  /** true si el cambio de horario obligó a rearmar el menú de la semana. */
  menuRearmado?: boolean;
};

/**
 * `PATCH /api/v1/me/resumen` — el acomodo del tablero.
 *
 * Va al servidor y no solo al teléfono para que sobreviva a un cambio de
 * aparato: rehacer el tablero a mano es justo el trabajo que nadie repite.
 */
/**
 * `PATCH /api/v1/me/referencia` — las medidas de la referencia del objetivo.
 *
 * El servidor solo guarda; las metas se derivan en la app escalando por
 * proporción, que es donde viven los guardarraíles.
 */
/** Una comida del plan, confirmada o no. */
export type RegistroComida = { date: string; slot: string; taken: boolean };

export type ComidasResponse = {
  registros: RegistroComida[];
  /** Apego de los últimos 14 días, sobre lo contestado. `null` si no hay nada. */
  apego: number | null;
  contestadas: number;
};

export function getComidasLog(): Promise<ComidasResponse> {
  return apiFetch<ComidasResponse>("/api/v1/meals/log");
}

/**
 * Confirma (o desmiente) una comida del plan.
 *
 * Una comida sin responder NO cuenta como saltada: cuenta como no contestada,
 * y por eso el apego se calcula sobre lo que sí se respondió.
 */
export function postComidaLog(input: {
  date: string;
  slot: string;
  taken: boolean;
}): Promise<{ registro: RegistroComida }> {
  return apiFetch<{ registro: RegistroComida }>("/api/v1/meals/log", {
    method: "POST",
    body: input,
  });
}

/** Lo que devuelve `POST /api/v1/training/recalibrar`. */
export type RecalibrarResponse = {
  asignadas: Array<{ weekday: string; discipline: Discipline; minutos: number; esPrimaria: boolean }>;
  cargas: Array<{ discipline: Discipline; sessionsPerWeek: number }>;
  avisos: string[];
  /** Qué cambió respecto de lo que había. */
  cambios: Array<{ discipline: Discipline; antes: number; ahora: number }>;
};

/**
 * Mueve el peso entre disciplinas sobre la semana que ya existe.
 *
 * No pregunta horarios de nuevo: usa el tiempo que ya está declarado. Subir la
 * importancia de una disciplina no crea días — si no cabe, lo dice.
 */
export function postRecalibrar(
  pesos: Array<{ discipline: Discipline; proposito: string; importancia: number }>,
): Promise<RecalibrarResponse> {
  return apiFetch<RecalibrarResponse>("/api/v1/training/recalibrar", {
    method: "POST",
    body: { pesos },
  });
}

/** Lo que devuelve `POST /api/v1/nutricion/replan`. */
export type NutricionReplanResponse = {
  /** Qué implica cada respuesta, en el vocabulario de quien come. */
  lectura: string[];
  /** Cuándo entra el cambio. El menú de esta semana ya se compró. */
  cuando: string;
};

/**
 * Rearma el perfil de alimentación.
 *
 * No regenera el menú de la semana en curso: ese ya se compró, y rehacerlo a
 * media semana obliga a tirar comida.
 */
export function postNutricionReplan(input: {
  goal: string;
  mealsPerDay: number;
  budget: "BAJO" | "MEDIO" | "ALTO";
  dietStyle: DietStyle;
  maxPrepMin: number | null;
  supplements: Array<"WHEY" | "CREATINA" | "OMEGA3">;
  excludedFoods: string[];
  favoriteFoods: string[];
}): Promise<NutricionReplanResponse> {
  return apiFetch<NutricionReplanResponse>("/api/v1/nutricion/replan", {
    method: "POST",
    body: input,
  });
}

/** Lo que devuelve `POST /api/v1/training/replan`. */
export type ReplanResponse = {
  asignadas: Array<{
    weekday: string;
    discipline: Discipline;
    minutos: number;
    esPrimaria: boolean;
  }>;
  cargas: Array<{ discipline: Discipline; sessionsPerWeek: number }>;
  diasActivos: string[];
  /** Lo que no cupo, dicho con todas sus letras. */
  avisos: string[];
  sesionesDePesas: number;
};

/**
 * Rearma la semana desde cero con lo que la persona contestó.
 *
 * El servidor reparte y guarda; lo ya entrenado no se toca — solo se rehacen
 * los días de hoy en adelante que no tengan series capturadas.
 */
export function postReplan(input: {
  tiempo: Record<string, number>;
  primaria: Discipline;
  sesionesPrimaria: number;
  secundarias: Array<{ discipline: Discipline; proposito: string; importancia: number }>;
  ageRange?: string | null;
}): Promise<ReplanResponse> {
  return apiFetch<ReplanResponse>("/api/v1/training/replan", { method: "POST", body: input });
}

export function patchReferencia(referencia: unknown): Promise<{ referencia: unknown }> {
  return apiFetch<{ referencia: unknown }>("/api/v1/me/referencia", {
    method: "PATCH",
    body: { referencia },
  });
}

export function patchResumen(
  paneles: Array<{ id: string; tamano: string; vista: string }>,
): Promise<{ paneles: unknown }> {
  return apiFetch<{ paneles: unknown }>("/api/v1/me/resumen", {
    method: "PATCH",
    body: { paneles },
  });
}

export function patchEntrenamiento(
  cambios: PreferenciasEntrenamiento,
): Promise<PreferenciasEntrenamientoResponse> {
  return apiFetch<PreferenciasEntrenamientoResponse>("/api/v1/me/entrenamiento", {
    method: "PATCH",
    body: cambios,
  });
}

/** Un valor de un estudio, tal como lo imprimió el laboratorio. */
export type LabValue = {
  key: string;
  label: string;
  value: number;
  unit: string;
  refLow: number | null;
  refHigh: number | null;
};

export type LabResult = {
  id: string;
  kind: "INBODY" | "QUIMICA";
  takenOn: string;
  values: LabValue[];
  filePath: string | null;
  notes: string | null;
  /** Llaves fuera del rango del PROPIO laboratorio. No es un diagnóstico. */
  outsideRange: string[];
  /** Si un InBody se contradice a sí mismo, aquí se dice por qué. */
  coherence: { coherent: boolean; reason: string | null };
};

export type LabsResponse = { labs: LabResult[]; disclaimer: string };

export function getLabs(): Promise<LabsResponse> {
  return apiFetch<LabsResponse>("/api/v1/labs");
}

export function postLab(input: {
  kind: "INBODY" | "QUIMICA";
  takenOn: string;
  values: Array<Omit<LabValue, "unit" | "refLow" | "refHigh"> & Partial<LabValue>>;
  notes?: string | null;
}): Promise<{ lab: LabResult; disclaimer: string }> {
  return apiFetch<{ lab: LabResult; disclaimer: string }>("/api/v1/labs", {
    method: "POST",
    body: input,
  });
}

export type ConsultaResponse = {
  answer: string;
  category: "URGENCIA" | "CLINICO" | "TCA" | "FUERA_DE_ALCANCE" | "OK";
  blocked: boolean;
  disclaimer: string;
};

/**
 * Pregunta sobre el plan de alimentación. El servidor frena las preguntas
 * clínicas ANTES de redactar nada: el freno no es un texto en un prompt.
 */
export function preguntarNutricion(question: string): Promise<ConsultaResponse> {
  return apiFetch<ConsultaResponse>("/api/v1/nutricion/consulta", {
    method: "POST",
    body: { question },
  });
}

/**
 * La decisión vigente. Con `desde`, en qué va el análisis de ESE check-in:
 * `decision` llega `null` y `estado` en `"analizando"` hasta que esté lista.
 */
export function getDecision(desde?: string): Promise<DecisionResponse> {
  const query = desde ? `?desde=${encodeURIComponent(desde)}` : "";
  return apiFetch<DecisionResponse>(`/api/v1/decision${query}`);
}

export function getCheckins(limit?: number): Promise<CheckInsResponse> {
  const query = limit ? `?limit=${limit}` : "";
  return apiFetch<CheckInsResponse>(`/api/v1/checkins${query}`);
}

export function postCheckin(payload: CheckInPayload): Promise<CheckInCreatedResponse> {
  return apiFetch<CheckInCreatedResponse>("/api/v1/checkins", { method: "POST", body: payload });
}

export function getNutrition(): Promise<NutritionResponse> {
  return apiFetch<NutritionResponse>("/api/v1/nutrition");
}

/**
 * `POST /api/v1/nutricion/regenerar-menu` — rearma los menús vigentes AHORA
 * con las preferencias de hoy, en vez de esperar al siguiente check-in.
 *
 * Mismo shape de respuesta que `GET /api/v1/nutrition`: la pantalla puede
 * pintar el resultado directo, sin un segundo `getNutrition()`. 409 si no
 * hay todavía una decisión aprobada con la que regenerar.
 */
export function postRegenerarMenu(): Promise<NutritionResponse> {
  return apiFetch<NutritionResponse>("/api/v1/nutricion/regenerar-menu", { method: "POST" });
}

/** Lo que devuelve `POST /api/v1/nutricion/swap`. */
export type SwapResponse = {
  menu: Menu;
  /** El alimento elegido ya estaba en la comida: se sumó a su renglón (y si se topó). */
  aviso?: string;
};

/**
 * Elige una equivalencia y la deja guardada: el item cambia en el menú, y la
 * equivalencia de ese hueco queda apuntando de vuelta al alimento original
 * (intercambio reversible — el servidor lo garantiza, no la app).
 *
 * No toca la lista de súper: un cambio puntual no rehace la compra de la
 * semana. Para eso está `postRegenerarMenu`.
 */
export function postSwap(input: {
  menuNumber: number;
  slot: string;
  forName: string;
  toName: string;
}): Promise<SwapResponse> {
  return apiFetch<SwapResponse>("/api/v1/nutricion/swap", { method: "POST", body: input });
}

export function getTrainingToday(): Promise<TrainingTodayResponse> {
  return apiFetch<TrainingTodayResponse>("/api/v1/training/today");
}

/** `GET /api/v1/training/week` — la semana entera para el modo gimnasio offline. */
/** Un ejercicio del catálogo del gimnasio, con su ficha. */
export type EjercicioGym = {
  id: string;
  name: string;
  muscleGroup: string;
  poolRole: string;
  level: "PRINCIPIANTE" | "INTERMEDIO" | "AVANZADO";
  equipment: string;
  howTo: string | null;
  whyFor: string | null;
  watchOut: string | null;
  isTracker: boolean;
  substitutes: string[];
  videoPath: string | null;
  videoUrl: string | null;
  /** `CC-BY-SA 4.0` (wger.de) o `Dominio público` (free-exercise-db). Null si no hay video. */
  videoLicense: string | null;
  /** A quién acreditar cuando la licencia lo pide. Null en dominio público o sin video. */
  videoAuthor: string | null;
};

/**
 * `GET /api/v1/exercises` — el catálogo completo del gimnasio.
 *
 * Distinto de la semana: aquí están todos, no solo los que te tocaron. Es lo
 * que hace que la biblioteca sirva para aprender y no solo para el día.
 */
export function getCatalogoGym(): Promise<{ ejercicios: EjercicioGym[] }> {
  return apiFetch<{ ejercicios: EjercicioGym[] }>("/api/v1/exercises");
}

/**
 * `POST /api/v1/exercise-videos/sign` — URLs firmadas para rutas de Storage
 * que no vienen de la tabla `exercises` (el catálogo de las demás disciplinas
 * vive en código, no en la base). Mismo bucket privado, mismo TTL de una hora.
 */
export function signVideoPaths(paths: string[]): Promise<{ urls: Record<string, string> }> {
  return apiFetch<{ urls: Record<string, string> }>("/api/v1/exercise-videos/sign", {
    method: "POST",
    body: { paths },
  });
}

export function getTrainingWeek(date?: string): Promise<WeekView> {
  const query = date ? `?date=${date}` : "";
  return apiFetch<WeekView>(`/api/v1/training/week${query}`);
}

/** `POST /api/v1/training/sync` — vacía la cola local: hasta 20 sesiones de golpe. */
export function postTrainingSync(sessions: SessionSyncInput[]): Promise<SyncResponse> {
  return apiFetch<SyncResponse>("/api/v1/training/sync", { method: "POST", body: { sessions } });
}

export function getHistoryMeasurements(): Promise<HistoryMeasurementsResponse> {
  return apiFetch<HistoryMeasurementsResponse>("/api/v1/history/measurements");
}

export function getHistoryTraining(): Promise<HistoryTrainingResponse> {
  return apiFetch<HistoryTrainingResponse>("/api/v1/history/training");
}

export function getNotifications(): Promise<NotificationsResponse> {
  return apiFetch<NotificationsResponse>("/api/v1/notifications");
}

export function markNotificationsRead(ids: string[]): Promise<MarkNotificationsReadResponse> {
  return apiFetch<MarkNotificationsReadResponse>("/api/v1/notifications/read", {
    method: "POST",
    body: { ids },
  });
}

// ---------------------------------------------------------------------------
// Objetivo — "Rumbo a tu objetivo" (contrato EXACTO de
// apps/web/src/lib/coachy/goal.ts y apps/web/src/app/api/v1/goal/**).
// ---------------------------------------------------------------------------

export const GOAL_VIEWS = ["FRENTE", "PERFIL", "ESPALDA"] as const;
export type GoalView = (typeof GOAL_VIEWS)[number];

export const GOAL_VIEW_LABEL: Record<GoalView, string> = {
  FRENTE: "Frente",
  PERFIL: "Perfil",
  ESPALDA: "Espalda",
};

/** `goalPhotoPath` en apps/web/src/lib/coachy/goal.ts: la vista va en minúsculas
 * en el nombre del archivo, aunque el enum viaje en mayúsculas por la API. */
export function goalPhotoPath(userId: string, view: GoalView): string {
  return `${userId}/goal/${view.toLowerCase()}.jpg`;
}

/** El mismo `GoalStatus` de apps/web/src/lib/coachy/goal.ts — el texto de
 * "listo" ya llega renderizado en `lines`, no hay que armar frases aquí. */
/** Zonas del análisis de objetivo. Mismo enum que el servidor. */
export const GOAL_ZONES = ["cintura", "cadera_gluteo", "pierna", "brazo", "espalda"] as const;
export type GoalZone = (typeof GOAL_ZONES)[number];

export const GOAL_ZONE_LABEL: Record<GoalZone, string> = {
  cintura: "Cintura",
  cadera_gluteo: "Glúteo",
  pierna: "Pierna",
  brazo: "Brazo",
  espalda: "Espalda",
};

/** Qué tan lejos está esa zona de la referencia. */
export type GoalGap = "cerca" | "media" | "lejos";
/** Hacia dónde se movió respecto de la quincena anterior. */
export type GoalTrend = "acercándose" | "igual" | "alejándose";
/** Cuánto énfasis de entrenamiento implica la referencia en esa zona. */
export type GoalEmphasis = "alto" | "medio" | "bajo";

export type GoalZoneReading = {
  zona: GoalZone;
  brecha: GoalGap;
  tendencia: GoalTrend;
  accion: string;
};

export type GoalDirectionReading = { zona: GoalZone; enfasis: GoalEmphasis };

export type GoalStatus =
  | { state: "sin_referencia" }
  /**
   * Hay referencia pero todavía no fotos propias con qué comparar. `lines`
   * trae la lectura de la referencia sola: dónde poner el énfasis. Puede
   * llegar vacío si la visión está apagada.
   */
  | {
      state: "sin_fotos";
      references: number;
      lines: string[];
      /** Lo mismo que `lines`, estructurado, para graficar el énfasis. */
      emphasis: GoalDirectionReading[];
    }
  | { state: "en_espera"; references: number }
  | {
      state: "listo";
      references: number;
      lines: string[];
      /** Lo mismo que `lines`, estructurado, para dibujar la brecha por zona. */
      readings: GoalZoneReading[];
      analyzedAt: string;
    };

export type GoalReferenceUrl = { view: GoalView; url: string };

export type GoalResponse = { status: GoalStatus; references: GoalReferenceUrl[] };

export function getGoal(): Promise<GoalResponse> {
  return apiFetch<GoalResponse>("/api/v1/goal");
}

/** Confirma que la foto de `view` ya está en Storage (subida directa desde el
 * teléfono). 422 si Storage no la tiene todavía. */
export function postGoalReference(view: GoalView): Promise<{ view: GoalView; path: string }> {
  return apiFetch<{ view: GoalView; path: string }>("/api/v1/goal/references", {
    method: "POST",
    body: { view },
  });
}

export function deleteGoalReference(view: GoalView): Promise<{ view: GoalView; eliminada: boolean }> {
  return apiFetch<{ view: GoalView; eliminada: boolean }>(
    `/api/v1/goal/references?view=${view}`,
    { method: "DELETE" },
  );
}

// ---------------------------------------------------------------------------
// Salud del reloj (Fase N5) — contrato EXACTO de
// apps/web/src/lib/health/schema.ts (`healthDaySchema` / `healthIngestSchema`).
// Todo menos `date` es opcional y nullable: un campo ausente no borra el que
// ya estaba guardado en el servidor.
// ---------------------------------------------------------------------------

export type HealthDayPayload = {
  /** yyyy-MM-dd */
  date: string;
  steps?: number | null;
  activeKcal?: number | null;
  exerciseMin?: number | null;
  sleepMin?: number | null;
  restingHr?: number | null;
  /** Variabilidad cardiaca (SDNN, ms): el proxy de recuperación. */
  hrvMs?: number | null;
  /** VO₂ máx estimado por el reloj (mL/kg/min). */
  vo2max?: number | null;
  /** Respiraciones por minuto en reposo. */
  respiratoryRate?: number | null;
  /** Saturación de oxígeno (%). Se guarda y grafica; nunca se interpreta. */
  spo2?: number | null;
  /** Horas del día con al menos un minuto de pie (anillo azul de Apple). */
  standHours?: number | null;
};

export type HealthDaysResponse = { dias: HealthDayPayload[] };

export type PostHealthDaysResponse = { ok: true; guardados: number; fechas: string[] };

/** `GET /api/v1/health` — los últimos 7 días guardados, del más reciente al más viejo. */
export function getHealthDays(): Promise<HealthDaysResponse> {
  return apiFetch<HealthDaysResponse>("/api/v1/health");
}

/** `POST /api/v1/health` — un día o un lote (hasta 60, tope de `healthIngestSchema`). */
export function postHealthDays(days: HealthDayPayload[]): Promise<PostHealthDaysResponse> {
  return apiFetch<PostHealthDaysResponse>("/api/v1/health", { method: "POST", body: { days } });
}

// ---------------------------------------------------------------------------
// Actividades del reloj (Fase N6) — contrato EXACTO de `POST/GET
// /api/v1/activities`. Topes del validador (para descartar en el cliente
// ANTES de mandar, así un workout fuera de rango no tumba el lote entero):
// durationMin 1–1200, activeKcal 0–5000, avgHr/maxHr 30–240, distanceM
// 0–100000, notes ≤1000 caracteres. Máx 50 actividades por lote.
// ---------------------------------------------------------------------------

export const DISCIPLINES = [
  "PESAS",
  "FUNCIONAL",
  "CROSSFIT",
  "NATACION",
  "BOX",
  "SQUASH",
  "CARDIO",
  "GOLF",
  "OTRO",
] as const;
export type Discipline = (typeof DISCIPLINES)[number];

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  PESAS: "Pesas",
  FUNCIONAL: "Funcional",
  CROSSFIT: "Crossfit",
  NATACION: "Natación",
  BOX: "Box",
  SQUASH: "Squash",
  CARDIO: "Cardio",
  GOLF: "Golf",
  OTRO: "Otro",
};

export const ACTIVITY_SOURCES = ["APP", "HEALTHKIT"] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

export type ActivityPayload = {
  discipline: Discipline;
  source: ActivitySource;
  /**
   * uuid del workout en HealthKit — POST es idempotente por este campo.
   *
   * Va en `null` cuando la sesión se capturó a mano en la app: no hay nada
   * externo con qué des-duplicarla, y el servidor la trata como fila nueva
   * (ver `saveActivities` en apps/web/src/lib/activity/db.ts).
   */
  externalId: string | null;
  startedAt: string; // ISO
  endedAt: string; // ISO
  /** yyyy-MM-dd en zona LOCAL del teléfono, calculada a partir de `startedAt`. */
  date: string;
  durationMin: number;
  activeKcal?: number | null;
  avgHr?: number | null;
  maxHr?: number | null;
  distanceM?: number | null;
  notes?: string | null;
};

export type Activity = ActivityPayload & { id: string };

export type ActivitiesResponse = { actividades: Activity[] };
export type PostActivitiesResponse = { ok: true; guardadas: number };

/** `GET /api/v1/activities?limit=` — orden `startedAt` desc. */
export function getActivities(limit?: number): Promise<ActivitiesResponse> {
  const query = limit ? `?limit=${limit}` : "";
  return apiFetch<ActivitiesResponse>(`/api/v1/activities${query}`);
}

/** `POST /api/v1/activities` — hasta 50 por lote. Idempotente por `externalId`. */
export function postActivities(activities: ActivityPayload[]): Promise<PostActivitiesResponse> {
  return apiFetch<PostActivitiesResponse>("/api/v1/activities", { method: "POST", body: { activities } });
}

/** Lo que la pantalla de captura manual le pide a quien entrenó: qué, cuánto y cuándo. */
export type ManualActivityInput = {
  discipline: Discipline;
  durationMin: number;
  /** yyyy-MM-dd en zona local del teléfono. */
  date: string;
  notes?: string | null;
};

/**
 * Registra a mano una sesión que el reloj no vio (o que se hizo sin reloj).
 *
 * `startedAt` se ancla al mediodía del día elegido: la hora exacta no se
 * pregunta — pedirla por un dato que nadie consulta es fricción — y el
 * mediodía evita que la sesión se cruce de día en cualquier zona horaria.
 */
export function postManualActivity(input: ManualActivityInput): Promise<PostActivitiesResponse> {
  const startedAt = new Date(`${input.date}T12:00:00.000Z`);
  const endedAt = new Date(startedAt.getTime() + input.durationMin * 60_000);

  return postActivities([
    {
      discipline: input.discipline,
      source: "APP",
      externalId: null,
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      date: input.date,
      durationMin: input.durationMin,
      notes: input.notes?.trim() ? input.notes.trim() : null,
    },
  ]);
}

// ---------------------------------------------------------------------------
// Onboarding (guardia de onboarding incompleto) — contrato EXACTO de
// `onboardingSchema` en apps/web/src/lib/validation/onboarding.ts. La app
// manda JSON con el shape de ENTRADA de ese schema (antes de sus
// `.transform`/`.default`), no el de FormData de la web: los tres campos de
// comida van como texto separado por comas —igual que el textarea web—, no
// como arreglos, porque `commaList` del lado del servidor es quien los
// convierte.
//
// Lo que la web sí conoce y este contrato NO pregunta, a propósito:
//   - `ageRange` como alternativa a `birthDate`: no existe en
//     `onboardingSchema` (solo se usa después, al replantear —ver
//     `app/replantear.tsx`— cuando falta la fecha de nacimiento). Pedirla
//     aquí inventaría un campo que `POST /api/v1/onboarding` no espera.
//   - El bloque de ciclo menstrual (`cycleTrackingEnabled`/...): tampoco
//     vive en `onboardingSchema`, es un opt-in aparte que `saveOnboarding`
//     (apps/web/src/lib/onboarding.ts) tolera ausente — se deja para cuando
//     la atleta lo prenda desde su check-in, no para bloquear el alta.
//   - `primaryDiscipline` y suplementos: tampoco están en `onboardingSchema`.
// ---------------------------------------------------------------------------

export const ONBOARDING_SEXES = ["FEMALE", "MALE", "OTHER"] as const;
export type OnboardingSex = (typeof ONBOARDING_SEXES)[number];

export const ONBOARDING_SEX_LABELS: Record<OnboardingSex, string> = {
  FEMALE: "Mujer",
  MALE: "Hombre",
  OTHER: "Otro",
};

export const ONBOARDING_GOALS = [
  "RECOMPOSICION",
  "PERDIDA_GRASA",
  "GANANCIA_MUSCULO",
  "SALUD",
  "RENDIMIENTO",
] as const;
export type OnboardingGoal = (typeof ONBOARDING_GOALS)[number];

export const ONBOARDING_GOAL_LABELS: Record<OnboardingGoal, string> = {
  RECOMPOSICION: "Recomposición (bajar grasa y subir músculo)",
  PERDIDA_GRASA: "Bajar grasa",
  GANANCIA_MUSCULO: "Subir músculo",
  SALUD: "Salud y hábitos",
  RENDIMIENTO: "Rendimiento",
};

export const ONBOARDING_WORK_SCHEDULES = ["SEDENTARIO", "ACTIVO"] as const;
export type OnboardingWorkSchedule = (typeof ONBOARDING_WORK_SCHEDULES)[number];

export const ONBOARDING_WORK_LABELS: Record<OnboardingWorkSchedule, string> = {
  SEDENTARIO: "Sentada la mayor parte del día",
  ACTIVO: "De pie o moviéndome todo el día",
};

export const ONBOARDING_TRAINING_TIMES = ["MANANA", "MEDIODIA", "TARDE", "NOCHE"] as const;
export type OnboardingTrainingTime = (typeof ONBOARDING_TRAINING_TIMES)[number];

export const ONBOARDING_TRAINING_TIME_LABELS: Record<OnboardingTrainingTime, string> = {
  MANANA: "Mañana",
  MEDIODIA: "Mediodía",
  TARDE: "Tarde",
  NOCHE: "Noche",
};

export const ONBOARDING_WEEK_DAYS = ["LUN", "MAR", "MIE", "JUE", "VIE", "SAB", "DOM"] as const;
export type OnboardingWeekDay = (typeof ONBOARDING_WEEK_DAYS)[number];

export const ONBOARDING_WEEK_DAY_LABELS: Record<OnboardingWeekDay, string> = {
  LUN: "Lunes",
  MAR: "Martes",
  MIE: "Miércoles",
  JUE: "Jueves",
  VIE: "Viernes",
  SAB: "Sábado",
  DOM: "Domingo",
};

export const ONBOARDING_DAY_SLOTS = [...ONBOARDING_TRAINING_TIMES, "DESCANSO"] as const;
export type OnboardingDaySlot = (typeof ONBOARDING_DAY_SLOTS)[number];

export const ONBOARDING_DAY_SLOT_LABELS: Record<OnboardingDaySlot, string> = {
  ...ONBOARDING_TRAINING_TIME_LABELS,
  DESCANSO: "Descanso",
};

export const ONBOARDING_BUDGETS = ["BAJO", "MEDIO", "ALTO"] as const;
export type OnboardingBudget = (typeof ONBOARDING_BUDGETS)[number];

export const ONBOARDING_BUDGET_LABELS: Record<OnboardingBudget, string> = {
  BAJO: "Ajustado",
  MEDIO: "Normal",
  ALTO: "Holgado",
};

export const ONBOARDING_CONDITIONS = [
  "glucosa_alta",
  "lesion_activa",
  "hipotiroidismo",
  "sop",
  "hipertension",
  "colesterol_alto",
  "ciclo_tracking",
] as const;
export type OnboardingCondition = (typeof ONBOARDING_CONDITIONS)[number];

export const ONBOARDING_CONDITION_LABELS: Record<OnboardingCondition, string> = {
  glucosa_alta: "Glucosa alta",
  lesion_activa: "Lesión activa",
  hipotiroidismo: "Hipotiroidismo",
  sop: "SOP",
  hipertension: "Presión alta",
  colesterol_alto: "Colesterol alto",
  ciclo_tracking: "Quiero registrar mi ciclo",
};

/** Horario por día cuando varía; ver `trainingSchedule` en `OnboardingPayload`. */
export type OnboardingSchedule = Record<OnboardingWeekDay, OnboardingDaySlot>;

/** Payload EXACTO de `POST /api/v1/onboarding` — shape de ENTRADA de `onboardingSchema`. */
export type OnboardingPayload = {
  displayName: string;
  sex: OnboardingSex;
  /** ISO `yyyy-MM-dd`. */
  birthDate: string;
  heightCm: number;
  weightKg: number;
  leanMassKg?: number | null;
  liftingDays: number;
  cardioMinWk?: number;
  sessionMinutes?: number;
  work?: OnboardingWorkSchedule;
  trainingTime?: OnboardingTrainingTime;
  /** Horario por día si varía; `null`/ausente = mismo horario todos los días. */
  trainingSchedule?: OnboardingSchedule | null;
  mealsPerDay: number;
  budget?: OnboardingBudget;
  /** Separado por comas, igual que el textarea web — NO arreglo. */
  favoriteFoods?: string;
  excludedFoods?: string;
  allergies?: string;
  conditions?: OnboardingCondition[];
  goal: OnboardingGoal;
  photoConsent?: boolean;
};

/** Perfil mínimo que trae la respuesta, para arrancar sin un segundo round-trip a `getMe()`. */
export type OnboardingResponse = {
  onboarded: true;
  profile: {
    displayName: string;
    sex: OnboardingSex;
    heightCm: number | null;
    currentPhase: string;
    goal: string;
    trainingDaysPerWeek: number;
    mealsPerDay: number;
    budget: OnboardingBudget;
    trainingTime: OnboardingTrainingTime;
  };
};

/**
 * `POST /api/v1/onboarding` — completa el cuestionario inicial desde el
 * teléfono. `ApiError.status === 409` si el perfil ya estaba completo (no
 * reenviar dos veces); `422` con `ApiError.detalles` por campo si algo no
 * pasa `onboardingSchema`, con las mismas llaves y mensajes que la web.
 */
export function postOnboarding(payload: OnboardingPayload): Promise<OnboardingResponse> {
  return apiFetch<OnboardingResponse>("/api/v1/onboarding", { method: "POST", body: payload });
}

// ---------------------------------------------------------------------------
// Fase 2 — comidas: registro con hora real, horarios por día, aprendizaje
// ---------------------------------------------------------------------------

/** Por qué no se hizo la comida: los tres motivos que ofrece la hoja de "La salté". */
export const MOTIVOS_SALTO = ["sin_hambre", "sin_tiempo", "comi_otra_cosa"] as const;
export type MotivoSalto = (typeof MOTIVOS_SALTO)[number];

export const MOTIVO_SALTO_LABEL: Record<MotivoSalto, string> = {
  sin_hambre: "Sin hambre",
  sin_tiempo: "Sin tiempo",
  comi_otra_cosa: "Comí otra cosa",
};

/** Un registro de comida con la hora real, no solo el sí/no de siempre. */
export type RegistroComidaCompleto = RegistroComida & {
  plannedAt: string | null;
  takenAt: string | null;
  skipped: MotivoSalto | null;
};

/**
 * `GET /api/v1/meals/log?from&to` — como `getComidasLog`, pero con rango
 * propio y las horas reales de cada registro. Sin rango, el servidor sigue
 * usando su ventana por defecto (últimos 14 días).
 */
export function getComidasLogRango(rango?: { from?: string; to?: string }): Promise<{
  registros: RegistroComidaCompleto[];
  apego: number | null;
  contestadas: number;
}> {
  const query = new URLSearchParams();
  if (rango?.from) query.set("from", rango.from);
  if (rango?.to) query.set("to", rango.to);
  const qs = query.toString();
  return apiFetch(`/api/v1/meals/log${qs ? `?${qs}` : ""}`);
}

/**
 * Confirma una comida con hora real: la versión completa de `postComidaLog`
 * para el recordatorio en dos tiempos y la hoja "Mis comidas hoy". `taken`
 * sigue siendo obligatorio para no romper el apego que ya se calculaba antes
 * de que existiera `takenAt`.
 */
export function postComidaLogCompleto(input: {
  date: string;
  slot: string;
  taken: boolean;
  plannedAt?: string;
  takenAt?: string;
  skipped?: MotivoSalto;
}): Promise<{ registro: RegistroComidaCompleto }> {
  return apiFetch<{ registro: RegistroComidaCompleto }>("/api/v1/meals/log", {
    method: "POST",
    body: input,
  });
}

/** Una propuesta de mover un horario, del aprendizaje semanal. Nunca se aplica sola. */
export type PropuestaHorario = {
  slot: string;
  dia: "SEMANA" | "FIN";
  actual: string;
  propuesta: string;
  evidencia: number;
};

/** `GET /api/v1/meals/propuestas` — qué horarios convendría mover, con su evidencia. */
export function getPropuestasHorario(): Promise<{ propuestas: PropuestaHorario[] }> {
  return apiFetch<{ propuestas: PropuestaHorario[] }>("/api/v1/meals/propuestas");
}

/** `GET /api/v1/me/horarios-comida?dia=SAB` — el horario propio de un solo día. */
export function getHorariosComidaDia(dia: string): Promise<HorariosResponse> {
  return apiFetch<HorariosResponse>(`/api/v1/me/horarios-comida?dia=${encodeURIComponent(dia)}`);
}

/** `PUT /api/v1/me/horarios-comida` con `dia`: mueve horas de ese día nada más. */
export function putHorariosComidaDia(
  dia: string,
  horarios: Record<string, string | null>,
): Promise<HorariosResponse> {
  return apiFetch<HorariosResponse>("/api/v1/me/horarios-comida", {
    method: "PUT",
    body: { dia, horarios },
  });
}

/** El horario general más el resumen por día, tal como lo trae `GET` sin `?dia`. */
export type HorariosGeneralesResponse = HorariosResponse & {
  horariosPorDia?: Record<string, Record<string, string>>;
};

export function getHorariosComidaCompleto(): Promise<HorariosGeneralesResponse> {
  return apiFetch<HorariosGeneralesResponse>("/api/v1/me/horarios-comida");
}

// ---------------------------------------------------------------------------
// Historial: planeado contra real (Fase 3)
// ---------------------------------------------------------------------------

/** Una serie del historial, con lo que pedía el plan al lado. */
export type SerieComparada = {
  exerciseName: string;
  setIndex: number;
  targetReps: number;
  targetWeightKg: number | null;
  reps: number;
  weightKg: number | null;
  rpe: number | null;
  warmup: boolean;
  /** `IZQ` / `DER` en unilaterales. */
  side: string | null;
  /** `fallo` / `dropset` si el plan lo prescribió. */
  intensity: string | null;
};

export type SessionDetail = {
  workoutId: string;
  date: string;
  muscleGroup: string;
  completedAt: string | null;
  estimatedMin: number | null;
  ejercicios: Array<{ name: string; series: SerieComparada[] }>;
};

/** Una semana de un ejercicio: el tope que se levantó y el volumen que se hizo. */
export type SemanaDeEjercicio = {
  weekStart: string;
  topWeightKg: number;
  volumeKg: number;
  sets: number;
};

export type ExerciseProgress = {
  exerciseId: string;
  name: string;
  semanas: SemanaDeEjercicio[];
  record: PersonalRecord | null;
};

/** `GET /api/v1/history/training/:workoutId` — el detalle de una sesión. */
export function getSessionDetail(workoutId: string): Promise<SessionDetail> {
  return apiFetch<SessionDetail>(`/api/v1/history/training/${workoutId}`);
}

/** `GET /api/v1/history/exercise/:exerciseId` — la tendencia de un ejercicio. */
export function getExerciseProgress(exerciseId: string): Promise<ExerciseProgress> {
  return apiFetch<ExerciseProgress>(`/api/v1/history/exercise/${exerciseId}`);
}

/**
 * `POST /api/v1/training/cambiar-bloque` — variante de día completo (Fase 11):
 * "hoy solo squash / natación, sin gym". Mismo endpoint que `postCambiarBloque`,
 * pero `discipline` va en arreglo de una o dos disciplinas — ese día no hay
 * gimnasio, se materializan solo esos bloques.
 */
export function postCambiarBloqueDia(
  date: string,
  disciplinas: Discipline[],
): Promise<{ date: string; discipline: Discipline[]; sesionCreada: boolean }> {
  return apiFetch<{ date: string; discipline: Discipline[]; sesionCreada: boolean }>(
    "/api/v1/training/cambiar-bloque",
    { method: "POST", body: { date, discipline: disciplinas } },
  );
}

/** Los cinco grupos con los que se filtra la despensa. */
export type GrupoDespensa = "proteina" | "carbo" | "grasa" | "fruta" | "verdura";

export type AlimentoDeCatalogo = {
  id: string;
  nombre: string;
  grupo: GrupoDespensa;
  /** Términos del motor (nombre, id, tags y sinónimos) para buscar tolerante. */
  busqueda?: string[];
  /** Alimento que dio de alta la persona: se puede editar y borrar. */
  tuyo?: boolean;
};

export type DespensaResponse = {
  /** Ids de lo que ya tiene en casa. */
  pantry: string[];
  /** El catálogo completo: la app no trae la base de alimentos. */
  catalogo: AlimentoDeCatalogo[];
  /** Lo del menú vigente, para marcar rápido lo que se acaba de comprar. */
  deTuLista: string[];
};

/** `GET /api/v1/profile/pantry` — la despensa, el catálogo y la última lista. */
export function getDespensa(): Promise<DespensaResponse> {
  return apiFetch<DespensaResponse>("/api/v1/profile/pantry");
}

/**
 * `PATCH /api/v1/profile/pantry` — guarda la despensa y rearma la semana.
 *
 * `rearmar` es el sí explícito: cuando ya hay comidas registradas esta semana
 * el menú está congelado y el servidor no lo toca sin permiso, porque
 * rehacerlo cambiaría días que ya se vivieron. Responde `congelado: true` para
 * que la pantalla pueda preguntar.
 */
export function patchDespensa(
  pantry: string[],
  rearmar = false,
): Promise<{ pantry: string[]; rearmado: boolean; congelado: boolean }> {
  return apiFetch<{ pantry: string[]; rearmado: boolean; congelado: boolean }>(
    `/api/v1/profile/pantry${rearmar ? "?rearmar=1" : ""}`,
    { method: "PATCH", body: { pantry } },
  );
}

/** Un ejercicio tal como lo propone Coachy para un tipo de día. */
export type EjercicioSugerido = {
  id: string;
  name: string;
  muscleGroup: string;
  poolRole: string;
};

/** Un tipo de día del split vigente, con la sugerencia y lo elegido a mano. */
export type DiaDeEjercicios = {
  dayKind: string;
  label: string;
  /** Una línea: objetivo, condición actual y zonas lejos de la referencia. */
  porque: string;
  /** `true` = este día sigue la sugerencia; `false` = lista propia. */
  sigueACoachy: boolean;
  elegidos: string[];
  sugeridos: EjercicioSugerido[];
};

/**
 * `GET /api/v1/training/ejercicios` — qué propone Coachy por tipo de día.
 *
 * Solo trae los tipos de día que el split vigente entrena: ofrecerle editar
 * un día que no existe en su semana es pedirle que decida sobre nada.
 */
export function getEjerciciosPorDia(): Promise<{ dias: DiaDeEjercicios[] }> {
  return apiFetch<{ dias: DiaDeEjercicios[] }>("/api/v1/training/ejercicios");
}

/**
 * `PATCH /api/v1/me/entrenamiento` — los ejercicios elegidos a mano.
 *
 * Se manda el mapa completo, igual que el split: parcharlo día por día
 * abriría la puerta a que dos ediciones seguidas se pisen. `null` devuelve
 * todos los días a la sugerencia de Coachy.
 */
export function patchEjerciciosManuales(
  manualExercises: Record<string, string[]> | null,
): Promise<unknown> {
  return apiFetch<unknown>("/api/v1/me/entrenamiento", {
    method: "PATCH",
    body: { manualExercises },
  });
}

/** Un bloque agregado a un día concreto, además de la disciplina base. */
export type BloqueAgregado = {
  discipline: Discipline;
  /** `ENTRENO`: Coachy prescribe la sesión. `LIBRE`: solo se registra el tiempo. */
  tipo: "ENTRENO" | "LIBRE";
  minutos: number;
};

export type BloquesDelDiaResponse = {
  date: string;
  bloques: BloqueAgregado[];
  /** La disciplina base: no se puede agregar como bloque, ya está en el plan. */
  base: Discipline;
  /** Qué se entrena en el gimnasio ese día, si ya hay sesión armada. */
  dayKind: string | null;
};

/** `GET /api/v1/training/bloque-dia` — lo que ya se agregó a ese día. */
export function getBloquesDelDia(date: string): Promise<BloquesDelDiaResponse> {
  return apiFetch<BloquesDelDiaResponse>(`/api/v1/training/bloque-dia?date=${date}`);
}

/**
 * `POST /api/v1/training/bloque-dia` — agregar un bloque con el tiempo que
 * sobra hoy.
 *
 * `aviso` viene lleno cuando la combinación tiene riesgo (pierna pesada y
 * squash el mismo día). Es un aviso: nunca impide agregar el bloque.
 */
export function postBloqueDia(input: {
  date: string;
  discipline: Discipline;
  tipo: "ENTRENO" | "LIBRE";
  minutos: number;
}): Promise<{ date: string; bloques: BloqueAgregado[]; aviso: string | null }> {
  return apiFetch<{ date: string; bloques: BloqueAgregado[]; aviso: string | null }>(
    "/api/v1/training/bloque-dia",
    { method: "POST", body: input },
  );
}

/** `DELETE /api/v1/training/bloque-dia` — quitar un bloque el mismo día. */
export function deleteBloqueDia(
  date: string,
  discipline: Discipline,
): Promise<{ date: string; bloques: BloqueAgregado[] }> {
  return apiFetch<{ date: string; bloques: BloqueAgregado[] }>("/api/v1/training/bloque-dia", {
    method: "DELETE",
    body: { date, discipline },
  });
}

/** Grupo con el que la pantalla habla de un alimento: nadie dice "carbo_post". */
export type GrupoAlimento = "proteina" | "carbo" | "grasa" | "fruta" | "verdura";

/** Unidad casera de una porción, la del SMAE traducida a la cocina. */
export type UnidadPorcion =
  | "cdita"
  | "cda"
  | "taza"
  | "media_taza"
  | "pieza"
  | "rebanada"
  | "scoop"
  | "g";

/** Lo que se captura de un alimento propio: la etiqueta y la porción de casa. */
export type AlimentoPropioInput = {
  name: string;
  role: string;
  proteinPer100: number;
  carbPer100: number;
  fatPer100: number;
  fiberPer100: number;
  servingUnit: UnidadPorcion;
  gramsPerUnit: number;
  minUnits: number;
  maxUnits: number;
  tags?: string[];
  /** "Guardar y marcar en mi alacena". */
  enDespensa?: boolean;
};

export type AlimentoPropio = Omit<AlimentoPropioInput, "enDespensa" | "tags"> & {
  id: string;
  /** El id con el que vive dentro del motor y de la despensa. */
  idMotor: string;
  grupo: GrupoAlimento;
  tags: string[];
};

/** `GET /api/v1/profile/alimentos` — los alimentos que diste de alta. */
export function getAlimentosPropios(): Promise<{ alimentos: AlimentoPropio[] }> {
  return apiFetch<{ alimentos: AlimentoPropio[] }>("/api/v1/profile/alimentos");
}

/** `POST /api/v1/profile/alimentos` — dar de alta uno nuevo. */
export function postAlimentoPropio(
  input: AlimentoPropioInput,
): Promise<{ alimento: AlimentoPropio }> {
  return apiFetch<{ alimento: AlimentoPropio }>("/api/v1/profile/alimentos", {
    method: "POST",
    body: input,
  });
}

/** `PATCH /api/v1/profile/alimentos` — corregir uno que ya existe. */
export function patchAlimentoPropio(
  id: string,
  input: AlimentoPropioInput,
): Promise<{ alimento: AlimentoPropio }> {
  return apiFetch<{ alimento: AlimentoPropio }>("/api/v1/profile/alimentos", {
    method: "PATCH",
    body: { id, ...input },
  });
}

/** `DELETE /api/v1/profile/alimentos?id=` — borrarlo, y sacarlo de la despensa. */
export function deleteAlimentoPropio(id: string): Promise<{ borrado: boolean }> {
  return apiFetch<{ borrado: boolean }>(`/api/v1/profile/alimentos?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/**
 * `PATCH /api/v1/me/nutricion` — qué platillos compuestos acepta el menú
 * (licuados, sopas y caldos, cremas). Entra en el siguiente menú que se arme.
 */
export function patchPreparaciones(preparaciones: {
  licuados: boolean;
  sopas: boolean;
  cremas: boolean;
}): Promise<PreferenciasNutricionResponse> {
  return apiFetch<PreferenciasNutricionResponse>("/api/v1/me/nutricion", {
    method: "PATCH",
    body: { preparaciones },
  });
}

// ---------------------------------------------------------------------------
// Suplementos e infusiones (H5)
// ---------------------------------------------------------------------------

export type CategoriaSuplemento = "SUPLEMENTO" | "INFUSION";
export type EleccionSuplemento = "acepto" | "no_quiero" | "ya_lo_tomo";

/** Una ficha del catálogo del motor (`packages/engine/data/suplementos.json`). */
export type FichaSuplemento = {
  id: string;
  categoria: CategoriaSuplemento;
  nombre: string;
  corto: string;
  dosis: { min: number; max: number; default: number; unidad: string };
  dosisTexto: string;
  momento: string;
  ancla: string;
  conComida: boolean | null;
  porque: string;
  evidencia: string;
  tope: string;
  frenos: string[];
  senales: string[];
  objetivos: string[];
  preparacion?: string;
  aviso?: string;
};

/** Una toma de hoy, amarrada a su comida (`slot`) o a un momento sin comida. */
export type TomaDelDia = {
  supplement: string;
  categoria: CategoriaSuplemento;
  nombre: string;
  corto: string;
  dosis: string;
  slot: string | null;
  cuando: string;
  hecho: boolean;
  /** ISO de cuándo se marcó hoy; ausente si no se ha tomado (o en servidores viejos). */
  hechaA?: string;
  /** El ancla de la ficha (`PRE_ENTRENO`, `DORMIR`…); ausente en servidores viejos. */
  ancla?: string;
  /** `"HH:MM"` sugerida para hoy, desde comidas y entreno; `null` si es libre. */
  horaSugerida?: string | null;
  /** "Sugerido ~18:00 · antes de entrenar". Sugerencia, nunca regla. */
  sugerencia?: string;
};

export type SugerenciaSuplemento = {
  supplement: string;
  categoria: CategoriaSuplemento;
  nombre: string;
  motivo: string;
  evidencia: string;
  dosis: string;
  momento: string;
  prioridad: number;
  cambiaria: string;
  regla: string;
  aviso?: string;
  preparacion?: string;
};

export type SuplementosResponse = {
  hoy: string;
  tomas: TomaDelDia[];
  resumen: { hechas: number; total: number; linea: string };
  sugerencias: SugerenciaSuplemento[];
  /** Freno clínico: si viene, no hay sugerencias y esta es la línea. */
  freno: string | null;
  notas: string[];
  elecciones: Record<string, { eleccion: EleccionSuplemento; fecha: string | null }>;
  quiereInfusiones: boolean;
  catalogo: FichaSuplemento[];
};

/** `GET /api/v1/suplementos` — tomas de hoy, sugerencias activas y catálogo. */
export function getSuplementos(): Promise<SuplementosResponse> {
  return apiFetch<SuplementosResponse>("/api/v1/suplementos");
}

type EleccionResponse = {
  supplements: string[];
  elecciones: SuplementosResponse["elecciones"];
  quiereInfusiones: boolean;
};

/**
 * `POST /api/v1/suplementos/eleccion` — Acepto / Ya lo tomo / No quiero.
 * "No quiero" también es el "quitar" de una toma: sale y no vuelve en 90 días.
 */
export function postEleccionSuplemento(
  supplement: string,
  eleccion: EleccionSuplemento,
): Promise<EleccionResponse> {
  return apiFetch<EleccionResponse>("/api/v1/suplementos/eleccion", {
    method: "POST",
    body: { supplement, eleccion },
  });
}

/** Prende o apaga las sugerencias de tés e infusiones. */
export function postInfusiones(quiere: boolean): Promise<EleccionResponse> {
  return apiFetch<EleccionResponse>("/api/v1/suplementos/eleccion", {
    method: "POST",
    body: { infusiones: quiere },
  });
}

/** `POST /api/v1/suplementos/log` — marcar (o desmarcar) una toma del día. */
export function postLogSuplemento(
  date: string,
  supplement: string,
  taken: boolean,
  /** ISO de cuándo se la tomó, si la persona eligió la hora; sin él, ahora. */
  takenAt?: string,
): Promise<{ registro: { date: string; supplement: string; taken: boolean; takenAt?: string } }> {
  return apiFetch("/api/v1/suplementos/log", {
    method: "POST",
    body: { date, supplement, taken, ...(takenAt ? { takenAt } : {}) },
  });
}

/** La decisión con las sugerencias de suplementos de su check-in. */
export type DecisionConSuplementos = Decision & {
  suplementos?: { freno: string | null; sugerencias: SugerenciaSuplemento[]; notas: string[] } | null;
};

/**
 * `PATCH /api/v1/me/leche` — la leche de licuados y cremas. Rearma la semana
 * de hoy en adelante; si ya hay comidas registradas responde `congelado` y
 * solo rearma con `rearmar` (el mismo sí explícito que la despensa).
 */
export function patchLeche(
  tipoLeche: "descremada" | "entera" | "deslactosada" | "deslactosada_light",
  rearmar = false,
): Promise<{ tipoLeche: string; rearmado: boolean; congelado: boolean }> {
  return apiFetch<{ tipoLeche: string; rearmado: boolean; congelado: boolean }>(
    `/api/v1/me/leche${rearmar ? "?rearmar=1" : ""}`,
    { method: "PATCH", body: { tipoLeche } },
  );
}

/**
 * `PATCH /api/v1/me/leche` con la base de licuados: agua o la leche elegida.
 * Mismo flujo que la leche: rearma la semana, o pregunta si ya empezó.
 */
export function patchBaseLicuado(
  baseLicuado: "leche" | "agua",
  rearmar = false,
): Promise<{ baseLicuado: string; rearmado: boolean; congelado: boolean }> {
  return apiFetch<{ baseLicuado: string; rearmado: boolean; congelado: boolean }>(
    `/api/v1/me/leche${rearmar ? "?rearmar=1" : ""}`,
    { method: "PATCH", body: { baseLicuado } },
  );
}

/** Cómo está montado un ejercicio: se carga por lado y cuánto pesa la barra (kg). */
export type MontajeDeEjercicio = { cargaPorLado: boolean; barraKg: number };

/**
 * `GET /api/v1/me/ejercicio-prefs` — los montajes guardados por ejercicio, y
 * lo que el descanso por pulso necesita: edad y última FC en reposo.
 */
export type EjercicioPrefsResponse = {
  prefs: Record<string, MontajeDeEjercicio>;
  edad: number | null;
  fcReposo: number | null;
};

export function getEjercicioPrefs(): Promise<EjercicioPrefsResponse> {
  return apiFetch<EjercicioPrefsResponse>("/api/v1/me/ejercicio-prefs");
}

/** `PATCH /api/v1/me/ejercicio-prefs` — recuerda el montaje de UN ejercicio. */
export function patchEjercicioPrefs(
  exerciseId: string,
  montaje: MontajeDeEjercicio,
): Promise<{ prefs: Record<string, MontajeDeEjercicio> }> {
  return apiFetch<{ prefs: Record<string, MontajeDeEjercicio> }>("/api/v1/me/ejercicio-prefs", {
    method: "PATCH",
    body: { exerciseId, ...montaje },
  });
}

// ---------------------------------------------------------------------------
// I1 — la semana canónica y el replanteo con vista previa
// ---------------------------------------------------------------------------

/** Un día de la semana canónica (`diasDelPlan` en la web). */
export type DiaDelPlan = {
  date: string;
  weekday: string;
  minutosDeclarados: number | null;
  gym: {
    dayKind: string;
    muscleGroup: string;
    ejercicios: number;
    minutos: number | null;
    recortada: number | null;
  } | null;
  bloques: Array<{ discipline: Discipline; etiqueta: string; minutes: number; orden: 1 | 2 }>;
  /** "Pierna · cuádriceps · 6 ejercicios · + Cardio HIIT 20 min", o "Descanso". */
  linea: string;
};

export type ModoDisciplina = "DESPUES" | "DIA_PROPIO";

/** Lo que se puede cambiar de una secundaria sin salir del replanteo. */
export type AccionReplan = {
  discipline: Discipline;
  modo: ModoDisciplina;
  alternativa: { modo: ModoDisciplina; texto: string };
};

export type ReplanSemanaResponse = ReplanResponse & {
  /** La semana que queda, día por día. */
  semana: DiaDelPlan[];
  acciones: AccionReplan[];
  /** `true` si fue vista previa: no se guardó nada. */
  preview?: boolean;
};

export type EntradaReplanSemana = {
  tiempo: Record<string, number>;
  primaria: Discipline;
  sesionesPrimaria: number;
  secundarias: Array<{
    discipline: Discipline;
    proposito: string;
    importancia: number;
    modo?: ModoDisciplina;
  }>;
  ageRange?: string | null;
};

/**
 * `POST /api/v1/training/replan` con la semana resultante. Con `preview` no
 * escribe nada: es lo que la pantalla pide en vivo mientras se contesta.
 */
export function postReplanSemana(
  input: EntradaReplanSemana,
  preview: boolean,
): Promise<ReplanSemanaResponse> {
  return apiFetch<ReplanSemanaResponse>(`/api/v1/training/replan${preview ? "?preview=1" : ""}`, {
    method: "POST",
    body: input,
  });
}

/** Un platillo por el que se puede cambiar el de una comida (sopa por sopa). */
export type OpcionPlatillo = {
  id: string;
  nombre: string;
  tipo: "licuado" | "sopa" | "crema" | "caldo" | "platillo";
  /** Los macros con que quedaría la comida completa. */
  totals: { kcal: number; proteinG: number; carbG: number; fatG: number; fiberG: number };
};

/** `GET /api/v1/meals/cambiar-preparacion` — las opciones del platillo de esa comida. */
export function getOpcionesPlatillo(
  menuNumber: number,
  slot: string,
): Promise<{ opciones: OpcionPlatillo[] }> {
  return apiFetch<{ opciones: OpcionPlatillo[] }>(
    `/api/v1/meals/cambiar-preparacion?menuNumber=${menuNumber}&slot=${encodeURIComponent(slot)}`,
  );
}

/**
 * `POST /api/v1/meals/cambiar-preparacion` — cambia el platillo entero: todos
 * sus ingredientes se reemplazan y lo que acompaña ajusta sus gramos.
 */
export function postCambiarPlatillo(input: {
  menuNumber: number;
  slot: string;
  preparacionId: string;
}): Promise<SwapResponse> {
  return apiFetch<SwapResponse>("/api/v1/meals/cambiar-preparacion", {
    method: "POST",
    body: input,
  });
}

/* ------------------------------------------------------------------------ */
/* N1 — HIIT de caminadora por velocidad real                                */
/* ------------------------------------------------------------------------ */

/** En qué unidad se leen las velocidades de la caminadora. Default km/h. */
export type UnidadVelocidad = "kmh" | "mph";

export type EsfuerzoHiit = "Fácil" | "Moderado" | "Moderado Alto" | "Fuerte" | "Máximo";

/** Igual que `TramoHiit` en apps/web/src/lib/training/disciplinas/hiit-caminadora.ts. */
export type TramoHiit = {
  desdeMin: number;
  hastaMin: number;
  /** Rango en km/h, `[mín, máx]`. */
  kmh: [number, number];
  esfuerzo: EsfuerzoHiit;
  /** No se veía en la captura de la que salió: la vista de detalle lo marca con "?". */
  inferido?: boolean;
};

/** Igual que `ProtocoloPrescrito` en la web: el protocolo ya adaptado al bloque. */
export type ProtocoloHiit = {
  duracion: 10 | 15 | 25;
  /** 0 a 5. */
  nivel: number;
  tramos: TramoHiit[];
  /** 10' armado desde el 15' del mismo nivel (no hay 10' por debajo del nivel 4). */
  recortado: boolean;
  /** Minutos de caminata suave 5–6 km/h tras el protocolo. */
  caminataMin: number;
};

/**
 * Lo que N1 le agrega a `DetalleCardio` (solo caminadora HIIT). Va aparte
 * porque `DetalleCardio` es de H2; `protocoloDe` en `lib/hiit.ts` lo lee.
 */
export type DetalleCardioConProtocolo = DetalleCardio & {
  protocolo?: ProtocoloHiit;
  unidad?: UnidadVelocidad;
};

/** `PreferenciasCardio` con la unidad de velocidad de N1. */
export type PreferenciasCardioN1 = PreferenciasCardio & { unidadVelocidad?: UnidadVelocidad };

// ---------------------------------------------------------------------------
// Ciclo menstrual (opt-in, estimación de calendario)
// ---------------------------------------------------------------------------

export type FaseCiclo = "MENSTRUACION" | "FOLICULAR" | "OVULACION" | "LUTEA";

/** Lo que cambia hoy por la fase estimada. Nunca diagnóstico. */
export type AjusteDelCiclo = {
  fase: FaseCiclo;
  etiqueta: string;
  dia: number;
  desactualizado: boolean;
  /** "Día 3 · Menstruación (estimado)". */
  linea: string;
  entrenamiento: { texto: string; ofreceLigera: boolean };
  nutricion: { kcalExtra: number; corto: string; texto: string } | null;
  nota: string;
};

export type CicloResponse = {
  /** Solo para quien se registró como mujer. */
  disponible: boolean;
  activo: boolean;
  /** `YYYY-MM-DD` del primer día del último periodo. */
  ultimoPeriodo: string | null;
  duracion: number;
  rango: { min: number; max: number };
  ajuste: AjusteDelCiclo | null;
  notaActivar: string;
  nota: string;
};

/** `GET /api/v1/ciclo`. */
export function getCiclo(): Promise<CicloResponse> {
  return apiFetch<CicloResponse>("/api/v1/ciclo");
}

/** `PUT /api/v1/ciclo` — prender/apagar, "empezó mi periodo" (fecha) y duración. */
export function putCiclo(cambio: {
  activo?: boolean;
  ultimoPeriodo?: string | null;
  duracion?: number;
}): Promise<CicloResponse> {
  return apiFetch<CicloResponse>("/api/v1/ciclo", { method: "PUT", body: cambio });
}
