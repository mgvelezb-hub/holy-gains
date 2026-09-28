/**
 * Tipos del generador de rutina semanal (Fase 4).
 *
 * Todo aquí es puro: no toca Prisma ni el reloj. `generateWeek` recibe la fecha
 * de inicio de semana como dato, de modo que la misma entrada siempre produce
 * la misma rutina y se puede probar sin base ni red.
 */

/** Grupos tal como viven en la tabla `exercises`. */
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

/** Tipo de sesión del split del coach. */
export type DayKind =
  | "PIERNA_CUADRICEPS"
  | "PIERNA_FEMORAL"
  | "PIERNA_GLUTEO"
  | "HOMBRO"
  | "PECHO_ESPALDA"
  | "BRAZO"
  | "HOMBRO_BRAZO"
  | "TORSO"
  /**
   * Los dos días del split empuje/jalón (`PPL_X2` e `INFERIOR_SUPERIOR_3_3`
   * en `split.ts`). No existían porque el split del coach parte la semana por
   * zona (pecho+espalda el mismo día); quien entrena empuje/jalón necesita
   * que pecho y tríceps caigan juntos y espalda con bíceps.
   */
  | "PECHO_TRICEP"
  | "ESPALDA_BICEP";

/** Esquemas sello del coach. Rotan por semana ISO. */
export type SchemeId =
  | "PIRAMIDAL"
  /**
   * Piramidal de PESO (15-12-10-8): las reps bajan y el peso sube serie a
   * serie. El `PIRAMIDAL` de siempre baja de 10 a 2 y es de fuerza; este vive
   * en el rango de músculo y es el que el coach prescribe de base.
   */
  | "PIRAMIDAL_PESO"
  | "FUERZA"
  | "METABOLICO"
  | "RANGO_MEDIO"
  | "VOLUMEN_9"
  | "REHAB";

/**
 * Estilo de esquema fijo elegido en preferencias. Igual que
 * `SCHEME_PREFERENCES` en `schemes.ts` (repetido aquí porque `types.ts` es
 * puro y no importa ese módulo, igual que `Discipline` o `Proposito`).
 */
export type SchemePreference =
  | "RECOMENDADO"
  | "FUERZA"
  | "HIPERTROFIA"
  | "METABOLICO"
  | "COACH";

/**
 * Cuánto volumen mete el generador en la sesión. Concepto propio del
 * entrenamiento — no una fase de dieta (`Phase` en `prisma/schema.prisma`
 * es del motor de nutrición y este módulo no lo conoce). `db.ts` es el único
 * lugar que traduce la fase de la atleta a este valor; ver el comentario ahí.
 */
export type VolumeBias = "normal" | "reducido";

export type Scheme = {
  id: SchemeId;
  /** Etiqueta que ve la atleta, con el vocabulario del coach. */
  label: string;
  /** Reps objetivo por serie, en orden. */
  reps: number[];
  /** Descanso entre series, en segundos. */
  restSeconds: number;
  /** El peso sube serie a serie (piramidal, metabólico, rango medio). */
  ramping: boolean;
};

/** Un ejercicio del catálogo, aplanado a lo que el generador necesita. */
export type ExerciseOption = {
  id: string;
  name: string;
  muscleGroup: string;
  poolRole: string;
  videoUrl: string | null;
  isTracker: boolean;
  substitutes: string[];
  /** `PRINCIPIANTE` | `INTERMEDIO` | `AVANZADO`. */
  level: string;
  /** `BARRA` | `MANCUERNA` | `MAQUINA` | `POLEA` | `PESO_CORPORAL`. */
  equipment: string;
  /**
   * Se hace un lado a la vez (remo con mancuerna, búlgara, curl concentrado).
   * No es columna de la base: sale del catálogo con `esUnilateral` en
   * `coach.ts` — ver ahí el porqué.
   */
  unilateral?: boolean;
};

/**
 * Tempo de la repetición, en segundos: excéntrica (bajar), pausa, concéntrica
 * (subir). Se escribe "3-1-1" y es como el coach prescribe el control: la
 * misma serie de 10 con 3-1-1 dura el triple que a tirones.
 */
export type Tempo = { ecc: number; pause: number; con: number };

/**
 * Cómo se lleva la serie. `normal` es el default y no se escribe.
 *
 * - `fallo`: se va hasta que no salga otra, con el número del plan como piso.
 * - `dropset`: serie extra pegada a la anterior, sin descanso, con ~20 %
 *   menos peso.
 */
export type SetIntensity = "normal" | "fallo" | "dropset";

/** Con qué lado se hace la serie, en los ejercicios unilaterales. */
export type SetSide = "IZQ" | "DER" | "AMBOS";

/** Una serie objetivo: reps y el peso que sugerimos, si hay con qué. */
export type TargetSet = {
  reps: number;
  /** kg sugeridos. `null` = campo vacío, la atleta escribe el suyo. */
  weightKg: number | null;
  /** Serie de calentamiento: no cuenta para progresión ni para volumen objetivo. */
  warmup: boolean;
  /** Tempo prescrito. Ausente = a ritmo propio (3 s por repetición para la cuenta de minutos). */
  tempo?: Tempo;
  /** Ausente = `normal`. Ver `SetIntensity`. */
  intensity?: SetIntensity;
  /** Solo en unilaterales. Ausente = el ejercicio no distingue lados. */
  side?: SetSide;
};

export type PlannedExercise = {
  exerciseId: string | null;
  name: string;
  muscleGroup: string;
  poolRole: string;
  scheme: SchemeId;
  schemeLabel: string;
  restSeconds: number;
  /** Ruta del video en Storage (o URL). `null` si el banco no lo tiene aún. */
  videoPath: string | null;
  /** Ejercicio trazador: se registra carga cada semana. */
  tracker: boolean;
  /** Nota del coach para este ejercicio (calentamiento, protocolo de lesión). */
  note: string | null;
  sets: TargetSet[];
  /**
   * Minutos que se lleva este ejercicio: ejecución + descansos + transición.
   * Ver `minutosDeEjercicio` en `duracion.ts`. Opcional porque los planes
   * materializados antes de esta fase no lo traen.
   */
  estimatedMin?: number;
  /** Se hace un lado a la vez: sus series vienen con `side`. */
  unilateral?: boolean;
};

/**
 * Un paso del calentamiento dinámico previo a la sesión. Ver el docblock de
 * `calentamientoPara` en `calentamiento.ts` para el sustento completo.
 */
export type WarmupStep = { nombre: string; segundos: number };

/**
 * El calentamiento dinámico de la sesión: SIEMPRE antepone 2 min de elevar
 * el pulso, seguidos de los movimientos específicos del grupo del día.
 * Vive ANTES del primer ejercicio — no debe confundirse con la serie de
 * aproximación (`buildWarmupSets` en `progression.ts`), que es la única
 * serie ligera que queda dentro del primer ejercicio.
 */
export type Warmup = { pasos: WarmupStep[]; totalSeg: number };

export type PlannedWorkout = {
  /** Fecha del día, ISO `YYYY-MM-DD`. */
  date: string;
  dayKind: DayKind;
  /** Etiqueta legible: "Pierna · cuádriceps". */
  muscleGroup: string;
  /** Esquema dominante de la sesión. */
  scheme: SchemeId;
  schemeLabel: string;
  /** Minutos de cardio sugeridos; `null` si toca suspenderlo. */
  cardioMinutes: number | null;
  /** Calentamiento dinámico previo, antes de tocar `exercises[0]`. */
  warmup: Warmup;
  exercises: PlannedExercise[];
  /**
   * Minutos estimados de la sesión completa, calentamiento incluido. Es el
   * número contra el que el generador recorta y el que la sesión en vivo
   * enseña ("≈ 58 min"). Opcional: los planes viejos no lo traen.
   */
  estimatedMin?: number;
};

export type GeneratedWeek = {
  /** Lunes de la semana, ISO `YYYY-MM-DD`. */
  weekStart: string;
  isoWeek: number;
  scheme: SchemeId;
  workouts: PlannedWorkout[];
  /**
   * Sesiones de las otras disciplinas activas, ya repartidas en la semana.
   * No se guardan como `Workout`: son sugerencias de día con su plan, y el
   * registro de lo que pase vive en `ActivitySession`.
   */
  otherSessions: OtherSessionPlan[];
};

/**
 * Una sesión de otra disciplina, tal como sale del planificador. El tipo
 * completo vive en `disciplines.ts`; aquí se declara estructural para que
 * `types.ts` siga sin importar nada.
 */
export type OtherSessionPlan = {
  date: string;
  weekday: string;
  discipline: Discipline;
  minutes: number;
  sesion: unknown | null;
  note: string;
  sharesDayWithGym: boolean;
  /** `1` si es la única sesión del día (o la primera de un combo); `2` si es el segundo bloque. */
  orden: 1 | 2;
};

/**
 * Disciplinas que el registro conoce. Igual que `Discipline` en el schema,
 * repetido aquí porque este módulo es puro y no importa Prisma.
 */
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

/**
 * Para qué sirve esta disciplina en la semana de la persona. Mismos valores
 * que `Proposito` en `replan.ts` (repetido aquí porque `types.ts` es puro y no
 * importa ese módulo, igual que `Discipline`): `ENTRENAMIENTO` pide sesiones
 * completas, `HOBBY` un hueco. Ver `PESO_POR_PROPOSITO` en `replan.ts`.
 */
export type Proposito = "ENTRENAMIENTO" | "COMPLEMENTO" | "HOBBY";

/**
 * Una disciplina secundaria y cuántas veces por semana se practica.
 *
 * `proposito` e `importancia` (1-3) son lo que la persona contestó al
 * replanificar — antes se preguntaban en la pantalla de rearmar rutina y se
 * tiraban, así que la pantalla de recalibrar tenía que adivinar la
 * importancia contando sesiones. Opcionales porque las cargas viejas (de
 * antes de esta fase) no los traen: `parseDisciplineLoads` las sigue
 * aceptando sin ellos.
 */
/**
 * Cómo convive esta disciplina con el gimnasio (Fase 11).
 *
 * `DESPUES`: se anexa como segundo bloque a los días de gimnasio — "squash
 * después de pesas", el caso real de Mau e Irma — y NO le quita días al
 * presupuesto de pesas (`liftingDaysWithinBudget` la ignora). `DIA_PROPIO`:
 * el comportamiento de siempre, un día propio que sí paga presupuesto.
 * Ausente = `DIA_PROPIO`: las cargas guardadas antes de esta fase no traen el
 * campo, y perderían su día si el default cambiara de comportamiento debajo
 * de ellas. La pantalla de Ajustes sí preselecciona `DESPUES` para una
 * disciplina nueva — es lo que casi siempre se quiere —, pero eso es un
 * default de formulario, no del parser.
 */
export type ModoDisciplina = "DESPUES" | "DIA_PROPIO";

export type DisciplineLoad = {
  discipline: Discipline;
  sessionsPerWeek: number;
  proposito?: Proposito;
  /** 1 a 3. Fuera de rango se descarta el campo, no la entrada entera. */
  importancia?: number;
  modo?: ModoDisciplina;
  /**
   * Solo CARDIO: cómo lo hace (máquina, HIIT o continuo, nivel, minutos). Vive
   * dentro del mismo JSON de `other_disciplines` — no hay columna nueva — y
   * `parseDisciplineLoads` lo tolera campo por campo.
   */
  cardio?: PreferenciasCardio;
};

/** Máquina (o ninguna) en la que se hace el cardio. */
export const EQUIPOS_CARDIO = ["CAMINADORA", "ESCALERA", "BICI", "ELIPTICA", "LIBRE"] as const;
export type EquipoCardio = (typeof EQUIPOS_CARDIO)[number];

/** HIIT (intervalos) o continuo (zona 2). */
export const TIPOS_CARDIO = ["HIIT", "CONTINUO"] as const;
export type TipoCardio = (typeof TIPOS_CARDIO)[number];

/** Nivel de cardio: decide el nivel sugerido de la máquina, no la duración. */
export const NIVELES_CARDIO = ["BASICO", "MEDIO", "AVANZADO"] as const;
export type NivelCardio = (typeof NIVELES_CARDIO)[number];

/**
 * Preferencias de cardio. Todas opcionales: lo que falte cae a los defaults
 * de `disciplinas/cardio.ts` (caminadora, HIIT, básico, 20 min).
 */
export type PreferenciasCardio = {
  equipo?: EquipoCardio;
  tipo?: TipoCardio;
  nivel?: NivelCardio;
  /** Minutos por sesión, 10 a 60. */
  minutos?: number;
};

/** Nivel en el agua. Igual que `SwimLevel` en el schema. */
export const SWIM_LEVELS = ["PRINCIPIANTE", "INTERMEDIO", "AVANZADO"] as const;
export type SwimLevel = (typeof SWIM_LEVELS)[number];

/** Lo que el generador necesita saber de la atleta. */
export type TrainingProfile = {
  /**
   * Presupuesto semanal de sesiones de entrenamiento. Se llama `liftingDays`
   * por historia: cuando solo había pesas, las sesiones y los días de pesas
   * eran lo mismo. Con otras disciplinas activas ya no lo son — ver
   * `liftingDaysWithinBudget`.
   */
  liftingDays: number;
  /** `{LUN..DOM: MANANA|MEDIODIA|TARDE|NOCHE|DESCANSO}` o null. */
  trainingSchedule: Record<string, string> | null;
  /** Etiquetas libres del perfil: `lesion_activa`, `lesion_rodilla`, ... */
  conditions: string[];
  /** "reducido" recorta un ejercicio por sesión. Ver `VolumeBias`. */
  volumeBias: VolumeBias;
  /** Minutos por sesión. 45 ⇒ 4-5 ejercicios; 60+ ⇒ 6-8. */
  sessionMinutes: number;
  cardioMinWk: number;
  /**
   * Grupos que esta persona pidió no repetir en la semana. Se entrenan una
   * vez y las repeticiones se reemplazan por trabajo del resto del cuerpo.
   */
  avoidRepeatGroups: MuscleGroup[];
  /**
   * Ejercicios que ya cambió y por cuál: `{originalId: reemplazoId}`. El
   * generador deja de proponer el original mientras el reemplazo quepa en ese
   * hueco.
   */
  exerciseSwaps?: Record<string, string>;
  /** La disciplina que arma el esqueleto de la semana. */
  primaryDiscipline: Discipline;
  /** Las demás disciplinas activas, con su carga semanal. */
  otherDisciplines: DisciplineLoad[];
  /** Nivel declarado por disciplina. Lo que falte arranca en principiante. */
  disciplineLevels: Partial<Record<Discipline, SwimLevel>>;
  /** Nivel en el gimnasio: acota qué ejercicios puede elegir el generador. */
  gymLevel: SwimLevel;
  /** El objetivo del perfil: modula el volumen de las otras disciplinas. */
  goal: string;
  /**
   * Minutos disponibles por día, tal como la persona los declaró al
   * replanificar. `null` = no se ha declarado; el planificador usa sus
   * defaults (`DEFAULT_MINUTES` en `disciplines.ts`). Con dato real, un
   * combo se acepta o se rechaza contra el tiempo de verdad del día, no
   * contra 60 minutos imaginarios.
   */
  timePerDay: Partial<Record<WeekDay, number>> | null;
  /**
   * Si el planificador debe combinar disciplinas compatibles el mismo día
   * (`true`, el default en la base) o darle a cada una su propio día
   * (`false`). Ver el docblock de `compactDays` en `schema.prisma` para el
   * porqué del default.
   */
  compactDays: boolean;
  /**
   * Estilo de esquema fijo elegido en preferencias. `RECOMENDADO` (default)
   * deja que `schemeForWeek` siga rotando; los demás valores fijan un
   * esquema todas las semanas. Ver el docblock de `SCHEME_PREFERENCES` en
   * `schemes.ts` para el porqué de cada mapeo y el sustento de evidencia.
   */
  schemePreference: SchemePreference;
  /**
   * El split que la persona fijó a mano, día por día. `null`/ausente = el
   * motor lo elige por número de días, como siempre.
   *
   * Cuando existe MANDA: los días que no aparecen son descanso y el motor no
   * reordena nada — solo avisa (`avisos` de `buildSplit`) si dos días
   * seguidos se estorban. Reacomodarle la semana a quien la escribió con sus
   * manos es la forma más rápida de que deje de confiar en el plan.
   */
  customSplit?: CustomSplit | null;
  /**
   * Cómo se hacen los ejercicios de un lado a la vez: `SEGUIDO` (default)
   * todas las series del derecho y luego las del izquierdo; `ALTERNADO` va
   * cambiando de lado serie a serie.
   */
  unilateralMode?: UnilateralMode;
  /**
   * Los ejercicios que la persona eligió a mano, por tipo de día:
   * `{PECHO_TRICEP: ["id1", "id2"]}`. Ausente o vacío = sigue la sugerencia
   * de Coachy.
   *
   * Cuando hay lista, esos ejercicios van PRIMERO y en ese orden; la
   * sugerencia solo completa lo que falte de volumen. Lo que NO cambia: el
   * protocolo de lesión (un ejercicio con impacto no entra por estar en la
   * lista) ni el recorte por minutos — el tiempo del día sigue siendo el
   * tiempo del día.
   */
  manualExercises?: Partial<Record<DayKind, string[]>>;
};

/** Ver `TrainingProfile.unilateralMode`. */
export const UNILATERAL_MODES = ["SEGUIDO", "ALTERNADO"] as const;
export type UnilateralMode = (typeof UNILATERAL_MODES)[number];

/**
 * Split declarado por día de la semana: `{"LUN": "PIERNA_CUADRICEPS", ...}`.
 * Lo que no aparece —o aparece como `DESCANSO`— es descanso.
 */
export type CustomSplit = Partial<Record<WeekDay, DayKind | "DESCANSO">>;

/**
 * Día de la semana, igual que `WeekDay` en `split.ts` (repetido aquí porque
 * `types.ts` es puro y no importa ese módulo).
 */
export type WeekDay = "LUN" | "MAR" | "MIE" | "JUE" | "VIE" | "SAB" | "DOM";

/** Una serie ya ejecutada, tal como la devuelve el historial. */
export type HistorySet = {
  exerciseId: string | null;
  exerciseName: string;
  setIndex: number;
  targetReps: number;
  reps: number;
  weightKg: number | null;
  rpe: number | null;
  warmup: boolean;
};

/** Una sesión pasada: lo que se planeó y lo que se ejecutó. */
export type HistoryWorkout = {
  /** ISO `YYYY-MM-DD`. */
  date: string;
  exerciseNames: string[];
  sets: HistorySet[];
};

export type GenerateWeekConfig = {
  /** Lunes de la semana a generar. El generador nunca lee el reloj. */
  weekStart: Date;
  catalog: ExerciseOption[];
  /**
   * Grupos con prioridad esta semana, del análisis contra la referencia del
   * objetivo. Cada día que los toque lleva un ejercicio extra — y nada más:
   * el énfasis no cambia el split, los días ni las cargas.
   */
  emphasis?: MuscleGroup[];
};
