import type {
  CustomSplit,
  DayKind,
  Discipline,
  DisciplineLoad,
  MuscleGroup,
  TrainingProfile,
} from "@/lib/training/types";

/**
 * El split del coach (metodología §3): pierna/glúteo 2-3×, hombro+trapecio 1×,
 * pecho+espalda 1×, bíceps+tríceps 1×. Cuando hay menos días se comprime hacia
 * arriba — nunca se pausa, se adapta.
 */
const SPLIT_BY_DAYS: Record<number, DayKind[]> = {
  0: [],
  1: ["PIERNA_CUADRICEPS"],
  2: ["PIERNA_CUADRICEPS", "TORSO"],
  3: ["PIERNA_CUADRICEPS", "TORSO", "PIERNA_FEMORAL"],
  4: ["PIERNA_CUADRICEPS", "PECHO_ESPALDA", "PIERNA_FEMORAL", "HOMBRO_BRAZO"],
  5: ["PIERNA_CUADRICEPS", "HOMBRO", "PECHO_ESPALDA", "PIERNA_FEMORAL", "BRAZO"],
  6: ["PIERNA_CUADRICEPS", "HOMBRO", "PECHO_ESPALDA", "PIERNA_FEMORAL", "BRAZO", "PIERNA_GLUTEO"],
  7: [
    "PIERNA_CUADRICEPS",
    "HOMBRO",
    "PECHO_ESPALDA",
    "PIERNA_FEMORAL",
    "BRAZO",
    "PIERNA_GLUTEO",
    "PECHO_ESPALDA",
  ],
};

export const DAY_LABELS: Record<DayKind, string> = {
  PECHO_TRICEP: "Pecho y tríceps",
  ESPALDA_BICEP: "Espalda y bíceps",
  PIERNA_CUADRICEPS: "Pierna · cuádriceps",
  PIERNA_FEMORAL: "Pierna · femoral y glúteo",
  PIERNA_GLUTEO: "Glúteo",
  HOMBRO: "Hombro y trapecio",
  PECHO_ESPALDA: "Pecho y espalda",
  BRAZO: "Bíceps y tríceps",
  HOMBRO_BRAZO: "Hombro y brazo",
  TORSO: "Torso completo",
};

/** Grupos que toca cada tipo de día. Sirve para el protocolo de lesión. */
export const DAY_GROUPS: Record<DayKind, MuscleGroup[]> = {
  PECHO_TRICEP: ["PECHO", "TRICEP"],
  ESPALDA_BICEP: ["ESPALDA", "BICEP"],
  PIERNA_CUADRICEPS: ["PIERNA"],
  PIERNA_FEMORAL: ["PIERNA"],
  PIERNA_GLUTEO: ["PIERNA"],
  HOMBRO: ["HOMBRO", "ABDOMEN"],
  PECHO_ESPALDA: ["PECHO", "ESPALDA"],
  BRAZO: ["BICEP", "TRICEP"],
  HOMBRO_BRAZO: ["HOMBRO", "BICEP", "TRICEP"],
  TORSO: ["PECHO", "ESPALDA", "HOMBRO"],
};

/** Días de la semana en el orden del calendario, empezando en lunes. */
export const WEEK_DAYS = ["LUN", "MAR", "MIE", "JUE", "VIE", "SAB", "DOM"] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];

/**
 * Lesión activa declarada en el perfil.
 *
 * `conditions` admite etiquetas libres: `lesion_activa` (sin zona) o
 * `lesion_<zona>` (`lesion_rodilla`, `lesion_hombro`, ...). Sin zona sabemos que
 * hay lesión pero no dónde: se suspende el impacto y no se toca el split.
 */
export type InjuryState = { active: boolean; zones: MuscleGroup[] };

const ZONE_ALIASES: Record<string, MuscleGroup> = {
  pierna: "PIERNA",
  rodilla: "PIERNA",
  tobillo: "PIERNA",
  cadera: "PIERNA",
  gluteo: "PIERNA",
  femoral: "PIERNA",
  hombro: "HOMBRO",
  manguito: "HOMBRO",
  pecho: "PECHO",
  espalda: "ESPALDA",
  lumbar: "ESPALDA",
  dorsal: "ESPALDA",
  codo: "BICEP",
  biceps: "BICEP",
  muneca: "TRICEP",
  triceps: "TRICEP",
  abdomen: "ABDOMEN",
};

export function parseInjuries(conditions: string[]): InjuryState {
  let active = false;
  const zones: MuscleGroup[] = [];

  for (const raw of conditions) {
    const tag = raw.trim().toLowerCase();
    if (!tag.startsWith("lesion")) continue;
    active = true;

    const suffix = tag.replace(/^lesion[_:-]?/, "");
    if (!suffix || suffix === "activa") continue;

    const zone = ZONE_ALIASES[suffix];
    if (zone && !zones.includes(zone)) zones.push(zone);
  }

  return { active, zones };
}

/** Kinds de reemplazo cuando hay que sacar días de la zona lesionada. */
const FALLBACK_ORDER: DayKind[] = ["PECHO_ESPALDA", "HOMBRO", "BRAZO", "TORSO"];

function touchesInjuredZone(kind: DayKind, zones: MuscleGroup[]): boolean {
  return DAY_GROUPS[kind].some((group) => zones.includes(group));
}

/**
 * Cuántas sesiones de la semana se van en otras disciplinas.
 *
 * Una disciplina declarada sin sesiones no gasta nada: está activa para el
 * registro, no para la planeación. Y una en `modo: 'DESPUES'` (Fase 11)
 * tampoco gasta: se anexa a un día de gimnasio que YA existe, no le pide uno
 * propio al presupuesto — es justo la diferencia con `DIA_PROPIO` (o sin
 * `modo`, que es lo mismo por compatibilidad hacia atrás).
 */
export function sessionsSpentOutsideGym(otherDisciplines: DisciplineLoad[]): number {
  return otherDisciplines.reduce(
    (total, load) =>
      load.modo === "DESPUES" ? total : total + Math.max(0, Math.trunc(load.sessionsPerWeek)),
    0,
  );
}

/**
 * Días de pesas que quedan después de pagar las otras disciplinas.
 *
 * La regla del modelo: **el presupuesto semanal no se estira**. Agregar
 * natación dos veces por semana no suma dos sesiones encima de las que ya
 * había — se las quita al gimnasio. Un cuerpo que recupera de cinco sesiones
 * no recupera de siete porque el calendario tenga huecos.
 *
 * El piso es 1 mientras las pesas sean la primaria: la disciplina que arma el
 * esqueleto nunca se queda sin semana. Si mañana la primaria es otra, este
 * piso desaparece y el gimnasio pasa a caer en los huecos.
 */
export function liftingDaysWithinBudget(
  profile: Pick<TrainingProfile, "liftingDays" | "primaryDiscipline" | "otherDisciplines">,
): number {
  const budget = Math.max(0, Math.min(7, Math.trunc(profile.liftingDays)));
  if (budget === 0) return 0;

  const spent = sessionsSpentOutsideGym(profile.otherDisciplines);
  const floor = profile.primaryDiscipline === "PESAS" ? 1 : 0;

  return Math.max(floor, budget - spent);
}

/**
 * Deja una sola aparición de los grupos que la persona pidió no repetir.
 *
 * Es la misma sustitución del protocolo de lesión, por otra razón: quien pide
 * no repetir pierna no quiere que el resto de la semana se encoja, quiere que
 * esos días entrenen otra cosa.
 */
function collapseRepeats(kinds: DayKind[], groups: MuscleGroup[]): DayKind[] {
  if (groups.length === 0) return kinds;

  const result: DayKind[] = [];
  const used = new Set<MuscleGroup>();

  /** Marca como vistos los grupos restringidos que toca este día. */
  function remember(kind: DayKind): void {
    for (const group of DAY_GROUPS[kind]) {
      if (groups.includes(group)) used.add(group);
    }
  }

  kinds.forEach((kind, position) => {
    const repeats = DAY_GROUPS[kind].some((group) => groups.includes(group) && used.has(group));

    if (!repeats) {
      remember(kind);
      result.push(kind);
      return;
    }

    const planned = new Set<DayKind>([...result, ...kinds.slice(position + 1)]);
    const usable = FALLBACK_ORDER.filter(
      (candidate) => !DAY_GROUPS[candidate].some((group) => used.has(group) && groups.includes(group)),
    );
    const replacement = usable.find((candidate) => !planned.has(candidate)) ?? usable[0];

    if (replacement) {
      remember(replacement);
      result.push(replacement);
    }
  });

  return result;
}

/**
 * Objetivos en los que el tren inferior es el motor del resultado.
 *
 * La metodología pide pierna/glúteo 2-3 veces por semana; cuando hay que
 * recortar, el objetivo decide si son tres o dos. Con músculo o
 * recomposición el glúteo y la pierna son lo que mueve la aguja, así que el
 * día que se cae es de torso. Con perder grasa, salud o rendimiento en otra
 * disciplina, el tren inferior ya se trabaja fuera del gimnasio (correr,
 * squash, box) y el día extra rinde más arriba.
 */
const OBJETIVOS_DE_PIERNA = ["GANANCIA_MUSCULO", "RECOMPOSICION"];

/** ¿Este tipo de día es de tren inferior? */
function esInferior(kind: DayKind): boolean {
  return DAY_GROUPS[kind].includes("PIERNA");
}

/**
 * Recorta un split escrito a mano para que quepa en los días que la persona
 * eligió entrenar.
 *
 * EL DEFECTO QUE ARREGLA: los presets de Ajustes (3 inferior / 3 superior,
 * PPL ×2) son mapas fijos de seis días. Quien elegía cinco días de pesas y
 * luego tocaba un preset veía seis en "Tu semana" — el número que contestó en
 * el perfil dejaba de significar nada. El split propio manda en QUÉ se
 * entrena cada día; el presupuesto manda en CUÁNTOS días hay. Son dos
 * preguntas distintas y antes una se comía a la otra.
 *
 * Qué se cae: un día de la mitad que va sobrada (inferior o superior); si
 * están empatadas, la que el objetivo no cuida. Y rota semana a semana, para
 * que no sea siempre el mismo día el que se pierde — con 3/3 a cinco días,
 * las tres piernas siguen entrenándose a lo largo del mes.
 */
export function ajustarSplitAlPresupuesto(
  kinds: DayKind[],
  days: WeekDay[],
  presupuesto: number,
  semana = 0,
  objetivo?: string,
): { kinds: DayKind[]; days: WeekDay[] } {
  const limite = Math.max(0, Math.trunc(presupuesto));
  if (kinds.length <= limite) return { kinds, days };

  const cuidarPierna = OBJETIVOS_DE_PIERNA.includes(objetivo ?? "");
  const rotacion = Math.max(0, Math.trunc(semana));
  let vivos = kinds.map((kind, index) => ({ kind, day: days[index] as WeekDay }));

  for (let vuelta = 0; vivos.length > limite; vuelta += 1) {
    const inferior = vivos.filter((entrada) => esInferior(entrada.kind));
    const superior = vivos.filter((entrada) => !esInferior(entrada.kind));

    let candidatos: typeof vivos;
    if (inferior.length === superior.length) candidatos = cuidarPierna ? superior : inferior;
    else candidatos = inferior.length > superior.length ? inferior : superior;
    if (candidatos.length === 0) candidatos = vivos;

    const fuera = candidatos[(rotacion + vuelta) % candidatos.length]!;
    vivos = vivos.filter((entrada) => entrada !== fuera);
  }

  return { kinds: vivos.map((e) => e.kind), days: vivos.map((e) => e.day) };
}

/**
 * Intercala inferior y superior después de recortar un split propio.
 *
 * El recorte quita un día de la mitad sobrada y deja el resto en su orden;
 * mapeado por orden a L–V eso podía dejar dos días de torso seguidos (I/S/S/I/S).
 * Aquí se alternan empezando por la mitad más grande —3 + 2 queda I/S/I/S/I—,
 * conservando el orden relativo dentro de cada mitad (cuádriceps antes que
 * femoral, como lo escribió ella).
 */
export function intercalarMitades(kinds: DayKind[]): DayKind[] {
  const inferior = kinds.filter((kind) => esInferior(kind));
  const superior = kinds.filter((kind) => !esInferior(kind));
  if (inferior.length === 0 || superior.length === 0) return [...kinds];

  const primeraEsInferior =
    inferior.length === superior.length ? esInferior(kinds[0]!) : inferior.length > superior.length;
  const [a, b] = primeraEsInferior ? [inferior, superior] : [superior, inferior];

  const salida: DayKind[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i]) salida.push(a[i]!);
    if (b[i]) salida.push(b[i]!);
  }
  return salida;
}

/**
 * El split propio sobre los días de gimnasio de verdad (I1).
 *
 * El split propio dice QUÉ se entrena y en qué orden; los días declarados
 * dicen CUÁNDO. Si cabe tal cual —sus días son justo los de gimnasio— se
 * respeta como lo escribió. Si trae más días, se recorta (rotando, según el
 * objetivo) y se intercala. Y lo que queda se mapea por orden a los días con
 * tiempo: un día con 0 min nunca recibe gimnasio por venir en el preset.
 */
export function mapearSplitPropio(
  kinds: DayKind[],
  escritos: WeekDay[],
  dias: WeekDay[],
  semana = 0,
  objetivo?: string,
): { kinds: DayKind[]; days: WeekDay[] } {
  const cabe = ajustarSplitAlPresupuesto(kinds, escritos, dias.length, semana, objetivo);
  const recortado = cabe.kinds.length < kinds.length;
  const orden = recortado ? intercalarMitades(cabe.kinds) : cabe.kinds;

  // Menos días escritos que días de gimnasio: si todos los que escribió caen
  // en días con tiempo, son SUS días (lo demás, descanso — como siempre).
  if (!recortado && orden.length < dias.length && cabe.days.every((day) => dias.includes(day))) {
    return { kinds: orden, days: cabe.days };
  }

  return { kinds: orden, days: dias.slice(0, orden.length) };
}

/**
 * Los días que la persona declaró para entrenar (I1).
 *
 * Tres fuentes, que antes se leían por separado: el horario
 * (`trainingSchedule`), los minutos por día (`timePerDay`) y, sin ninguno de
 * los dos, los primeros `liftingDays` días. La regla nueva es la que faltaba:
 * **un día con 0 min declarados no es un día de entrenar**, diga lo que diga
 * el horario o el preset.
 */
export function diasDeclarados(
  profile: Pick<TrainingProfile, "liftingDays" | "trainingSchedule"> &
    Partial<Pick<TrainingProfile, "timePerDay">>,
): WeekDay[] {
  const tiempo = profile.timePerDay ?? null;
  const conTiempo = (day: WeekDay): boolean => tiempo?.[day] === undefined || tiempo[day]! > 0;

  const schedule = profile.trainingSchedule;
  if (schedule) {
    const scheduled = WEEK_DAYS.filter((day) => {
      const slot = schedule[day];
      return typeof slot === "string" && slot !== "DESCANSO";
    });
    if (scheduled.length > 0) return scheduled.filter(conTiempo);
  }

  if (tiempo && WEEK_DAYS.some((day) => (tiempo[day] ?? 0) > 0)) {
    return WEEK_DAYS.filter((day) => (tiempo[day] ?? 0) > 0);
  }

  const days = Math.max(0, Math.min(7, Math.trunc(profile.liftingDays)));
  return WEEK_DAYS.slice(0, days).filter(conTiempo);
}

/**
 * Los días de gimnasio de la semana: los declarados, hasta donde alcance el
 * presupuesto de pesas (`liftingDaysWithinBudget`).
 */
export function diasDeGimnasio(
  profile: Pick<TrainingProfile, "liftingDays" | "trainingSchedule" | "primaryDiscipline" | "otherDisciplines"> &
    Partial<Pick<TrainingProfile, "timePerDay">>,
): WeekDay[] {
  return diasDeclarados(profile).slice(0, liftingDaysWithinBudget(profile));
}

/**
 * Split de la semana según días disponibles, lesiones y lo que se pidió no
 * repetir.
 *
 * Protocolo de lesión (metodología §3): la zona afectada se entrena **una vez
 * por semana**, con reps altas y peso bajo. Los días extra de esa zona se
 * reemplazan por trabajo del resto del cuerpo, que sigue normal.
 *
 * Con `customSplit` manda lo que la persona escribió: los días son los que
 * ella listó (lo demás es descanso), NO se reordena por vecindad y lo que
 * estorbe sale en `avisos` para que Ajustes lo ofrezca como cambio. Sin él, el
 * motor arma el split por número de días y sí lo reordena — ahí el orden es
 * suyo, y dejar el hombro el día antes de pecho cuando se puede evitar es un
 * defecto del plan, no una decisión de nadie.
 */
export function buildSplit(
  profile: Pick<TrainingProfile, "liftingDays" | "conditions"> &
    Partial<Pick<TrainingProfile, "avoidRepeatGroups" | "customSplit">>,
  /**
   * Lo que hace falta para recortar un split propio que no cabe: la semana
   * ISO (para rotar cuál día se cae) y el objetivo (para decidir si sobra
   * pierna o torso). Ambos opcionales: sin ellos el recorte sigue siendo
   * determinista, solo deja de rotar.
   */
  opciones?: {
    semana?: number;
    objetivo?: string;
    /**
     * I1 — los días de gimnasio YA decididos (`diasDeGimnasio`). Con ellos, un
     * split propio se mapea POR ORDEN a estos días en vez de caer en los días
     * fijos del preset: el preset 3/3 es un mapa LUN–SÁB, y quien entrena
     * L–V acababa con gimnasio el sábado (0 min declarados) y sin el día que
     * se cayó. Sin `dias`, el comportamiento de siempre.
     */
    dias?: WeekDay[];
  },
): {
  kinds: DayKind[];
  /**
   * Los días del calendario que corresponden a `kinds`, cuando el split los
   * fija (`customSplit`). `null` = los decide `trainingDaysOf`, como siempre.
   */
  days: WeekDay[] | null;
  /** Índices (dentro de `kinds`) que van con protocolo de rehabilitación. */
  rehabIndexes: number[];
  injury: InjuryState;
  /** Lo que estorba y no se puede arreglar sin decidir. Ver `avisosDeVecindad`. */
  avisos: string[];
} {
  const custom = normalizeCustomSplit(profile.customSplit);
  const injury = parseInjuries(profile.conditions);

  let base: DayKind[];
  let days: WeekDay[] | null;

  if (custom) {
    // Escrito a mano: se respeta tal cual. Ni `collapseRepeats` ni la
    // vecindad lo tocan — solo avisan.
    const escritos = WEEK_DAYS.filter(
      (day) => custom[day] !== undefined && custom[day] !== "DESCANSO",
    );
    // El split propio dice QUÉ se entrena cada día; `liftingDays` dice
    // CUÁNTOS días hay. Si el preset trae más días de los que ella eligió, se
    // recorta aquí — no en la pantalla, que ni sabe del presupuesto.
    const cabe = ajustarSplitAlPresupuesto(
      escritos.map((day) => custom[day] as DayKind),
      escritos,
      Math.max(0, Math.min(7, Math.trunc(profile.liftingDays))),
      opciones?.semana ?? 0,
      opciones?.objetivo,
    );
    days = cabe.days;
    base = cabe.kinds;

    if (opciones?.dias) {
      const mapeado = mapearSplitPropio(
        escritos.map((day) => custom[day] as DayKind),
        escritos,
        opciones.dias,
        opciones.semana ?? 0,
        opciones.objetivo,
      );
      days = mapeado.days;
      base = mapeado.kinds;
    }
  } else if (opciones?.dias) {
    const avoidRepeat = profile.avoidRepeatGroups ?? [];
    base = reordenarPorVecindad(
      collapseRepeats([...(SPLIT_BY_DAYS[opciones.dias.length] ?? [])], avoidRepeat),
    );
    days = [...opciones.dias];
  } else {
    const count = Math.max(0, Math.min(7, Math.trunc(profile.liftingDays)));
    const avoidRepeat = profile.avoidRepeatGroups ?? [];
    base = reordenarPorVecindad(collapseRepeats([...(SPLIT_BY_DAYS[count] ?? [])], avoidRepeat));
    days = null;
  }

  const avisos = avisosDeVecindad(base, days);

  if (injury.zones.length === 0) {
    return { kinds: base, days, rehabIndexes: [], injury, avisos };
  }

  const kinds: DayKind[] = [];
  const rehabIndexes: number[] = [];
  const diasFinales: WeekDay[] = [];
  let injuredDaysUsed = 0;

  base.forEach((kind, position) => {
    const day = days?.[position];

    if (!touchesInjuredZone(kind, injury.zones)) {
      kinds.push(kind);
      if (day) diasFinales.push(day);
      return;
    }

    if (injuredDaysUsed === 0) {
      injuredDaysUsed += 1;
      rehabIndexes.push(kinds.length);
      kinds.push(kind);
      if (day) diasFinales.push(day);
      return;
    }

    // Ya hubo el único día de la zona: este se reemplaza por trabajo del resto
    // del cuerpo, buscando un tipo de día que no esté ya en la semana.
    const planned = new Set<DayKind>([...kinds, ...base.slice(position + 1)]);
    const usable = FALLBACK_ORDER.filter((candidate) => !touchesInjuredZone(candidate, injury.zones));
    const replacement = usable.find((candidate) => !planned.has(candidate)) ?? usable[0];

    if (replacement) {
      kinds.push(replacement);
      if (day) diasFinales.push(day);
    }
  });

  return { kinds, days: days === null ? null : diasFinales, rehabIndexes, injury, avisos };
}

/**
 * Qué días del calendario toca entrenar.
 *
 * Con `trainingSchedule` manda el horario declarado: los días marcados como
 * DESCANSO no reciben sesión. Sin él se reparten los días de pesas de lunes en
 * adelante, dejando el domingo (el del check-in) libre.
 */
export function trainingDaysOf(
  profile: Pick<TrainingProfile, "liftingDays" | "trainingSchedule">,
): WeekDay[] {
  const schedule = profile.trainingSchedule;

  if (schedule) {
    const scheduled = WEEK_DAYS.filter((day) => {
      const slot = schedule[day];
      return typeof slot === "string" && slot !== "DESCANSO";
    });
    if (scheduled.length > 0) return scheduled;
  }

  const days = Math.max(0, Math.min(7, Math.trunc(profile.liftingDays)));
  return WEEK_DAYS.slice(0, days);
}

// ---------------------------------------------------------------------------
// Split propio: presets y regla de vecindad
// ---------------------------------------------------------------------------

/**
 * Los splits que se pueden elegir de una lista, sin armar la semana día por
 * día.
 *
 * EL PROBLEMA que resuelven: el split del motor es uno solo —el del coach,
 * repartido por número de días— y quien ya entrena a otro formato (empuje /
 * jalón / pierna, o inferior / superior) tenía que aceptar el ajeno o no usar
 * el generador. Un preset es el atajo; el editor por día es la salida
 * completa.
 */
export const SPLIT_PRESETS = [
  {
    id: "ACTUAL",
    nombre: "El de la app",
    descripcion: "El split del coach, repartido según tus días. Pierna 2-3 veces por semana.",
  },
  {
    id: "INFERIOR_SUPERIOR_3_3",
    nombre: "3 inferior / 3 superior",
    descripcion: "Alterna pierna y torso. Si entrenas menos de seis días, se ajusta a los tuyos.",
  },
  {
    id: "PPL_X2",
    nombre: "Pierna / empuje / jalón, dos vueltas",
    descripcion: "Pierna, pecho y tríceps, espalda y bíceps — y otra vuelta, hasta donde alcancen tus días.",
  },
] as const;

export type SplitPresetId = (typeof SPLIT_PRESETS)[number]["id"];

/** L/Mi/V inferior rotando cuádriceps → glúteo → femoral; M/J/S superior. */
const INFERIOR_SUPERIOR_3_3: CustomSplit = {
  LUN: "PIERNA_CUADRICEPS",
  MAR: "PECHO_TRICEP",
  MIE: "PIERNA_GLUTEO",
  JUE: "ESPALDA_BICEP",
  VIE: "PIERNA_FEMORAL",
  SAB: "HOMBRO_BRAZO",
  DOM: "DESCANSO",
};

/** Pierna / empuje / jalón, dos vueltas. La segunda pierna cambia de énfasis. */
const PPL_X2: CustomSplit = {
  LUN: "PIERNA_CUADRICEPS",
  MAR: "PECHO_TRICEP",
  MIE: "ESPALDA_BICEP",
  JUE: "PIERNA_GLUTEO",
  VIE: "PECHO_TRICEP",
  SAB: "ESPALDA_BICEP",
  DOM: "DESCANSO",
};

/**
 * El preset ya resuelto a días de la semana, listo para guardarse como
 * `customSplit`.
 *
 * `ACTUAL` no es un mapa fijo: es lo que el motor arma hoy para ese número de
 * días, materializado en el calendario (de lunes en adelante, domingo libre —
 * la misma repartición que `trainingDaysOf` sin horario declarado). Guardarlo
 * como split propio es lo que permite editarlo día por día sin empezar de
 * cero.
 */
export function presetSplit(id: SplitPresetId, liftingDays: number): CustomSplit {
  if (id === "INFERIOR_SUPERIOR_3_3") return { ...INFERIOR_SUPERIOR_3_3 };
  if (id === "PPL_X2") return { ...PPL_X2 };

  const count = Math.max(0, Math.min(7, Math.trunc(liftingDays)));
  const kinds = reordenarPorVecindad([...(SPLIT_BY_DAYS[count] ?? [])]);

  const split: CustomSplit = {};
  WEEK_DAYS.forEach((day, index) => {
    split[day] = kinds[index] ?? "DESCANSO";
  });
  return split;
}

/**
 * Los `DayKind` válidos, para validar JSON crudo y para el `z.enum` de la API
 * sin repetir la lista. Sale de `DAY_GROUPS`, que es donde se declara cada
 * tipo de día: agregar uno ahí lo hace elegible aquí sin tocar nada más.
 */
export const DAY_KIND_VALUES = Object.keys(DAY_GROUPS) as [DayKind, ...DayKind[]];

/**
 * `custom_split` es JSON libre en la base: tolerante llave por llave, igual
 * que `other_disciplines` o `time_per_day`. Lo que no es un día conocido o un
 * `DayKind` conocido se ignora en vez de tumbar la semana; sin ningún día
 * entrenable devuelve `null`, que es exactamente "no hay split propio".
 */
export function normalizeCustomSplit(raw: unknown): CustomSplit | null {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) return null;

  const split: CustomSplit = {};
  let entrenables = 0;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(WEEK_DAYS as readonly string[]).includes(key)) continue;
    if (value === "DESCANSO") {
      split[key as WeekDay] = "DESCANSO";
      continue;
    }
    if (typeof value !== "string" || !(DAY_KIND_VALUES as readonly string[]).includes(value)) continue;
    split[key as WeekDay] = value as DayKind;
    entrenables += 1;
  }

  return entrenables > 0 ? split : null;
}

/**
 * Pares que no deben caer en días seguidos.
 *
 * El caso que lo originó es real y del propio hogar: el split de 6 días ponía
 * HOMBRO el día antes de PECHO_ESPALDA, y el hombro llegaba tan cansado al
 * press que la sesión de pecho no se pudo entrenar. El deltoide anterior y el
 * tríceps son sinergistas del empuje horizontal; agotarlos de víspera no es
 * intensidad, es perder el día siguiente.
 */
const PARES_PROHIBIDOS: Array<{ antes: DayKind[]; despues: DayKind[]; porque: string }> = [
  {
    antes: ["HOMBRO", "HOMBRO_BRAZO"],
    despues: ["PECHO_ESPALDA", "PECHO_TRICEP", "TORSO"],
    porque: "el hombro llega cansado al press",
  },
];

/** Días de pierna pesada: dejan las piernas sin nada para un deporte de piso. */
const PIERNA_PESADA: DayKind[] = ["PIERNA_CUADRICEPS", "PIERNA_FEMORAL"];

/** Disciplinas que se juegan con las piernas: el día después de pierna pesada duelen. */
const DISCIPLINAS_DE_PIERNA: Discipline[] = ["SQUASH", "BOX"];

/**
 * ¿Estos dos días seguidos se estorban? Devuelve el porqué, o `null`.
 *
 * `disciplinasDespues` es opcional a propósito: la vecindad con squash o box
 * solo se puede juzgar si se sabe qué se juega ese día, y quien llama a esta
 * función desde el editor de Ajustes normalmente no lo sabe. Sin el dato, esa
 * regla simplemente no aplica — inventarla daría avisos falsos.
 */
export function chocaVecindad(
  antes: DayKind,
  despues: DayKind | null,
  disciplinasDespues?: Discipline[],
): string | null {
  if (despues !== null) {
    for (const par of PARES_PROHIBIDOS) {
      if (par.antes.includes(antes) && par.despues.includes(despues)) return par.porque;
    }
  }

  if (
    PIERNA_PESADA.includes(antes) &&
    (disciplinasDespues ?? []).some((disciplina) => DISCIPLINAS_DE_PIERNA.includes(disciplina))
  ) {
    return "la pierna llega cansada al juego";
  }

  return null;
}

/**
 * Reacomoda el split automático para que ningún par prohibido quede seguido.
 *
 * Mueve el día conflictivo hacia adelante —no lo cambia por otro— y solo
 * acepta el movimiento si no genera un choque nuevo. Si no hay acomodo
 * posible se deja como estaba: mejor un aviso honesto que una semana
 * barajada.
 */
export function reordenarPorVecindad(kinds: DayKind[]): DayKind[] {
  const orden = [...kinds];

  for (let i = 0; i + 1 < orden.length; i += 1) {
    if (chocaVecindad(orden[i]!, orden[i + 1]!) === null) continue;

    for (let j = i + 2; j < orden.length; j += 1) {
      const intento = [...orden];
      intento[i + 1] = orden[j]!;
      intento[j] = orden[i + 1]!;
      if (sinChoques(intento)) {
        orden.splice(0, orden.length, ...intento);
        break;
      }
    }
  }

  return orden;
}

function sinChoques(kinds: DayKind[]): boolean {
  return kinds.every((kind, index) => index === 0 || chocaVecindad(kinds[index - 1]!, kind) === null);
}

/**
 * Los avisos accionables del split: qué días se estorban y qué cambiar.
 *
 * Se escriben en el vocabulario del dueño ("Hombro el martes y pecho el
 * miércoles: te va a doler. Cambiar") porque la app los enseña tal cual en
 * Ajustes. Sin días del calendario —split automático— se nombran por tipo de
 * día, que es lo único que se sabe.
 */
export function avisosDeVecindad(
  kinds: DayKind[],
  days: WeekDay[] | null,
  disciplinasPorDia?: Partial<Record<WeekDay, Discipline[]>>,
): string[] {
  const avisos: string[] = [];

  kinds.forEach((kind, index) => {
    const siguiente = kinds[index + 1] ?? null;
    const dia = days?.[index];
    const diaSiguiente = days?.[index + 1];
    const porque = chocaVecindad(
      kind,
      siguiente,
      diaSiguiente ? disciplinasPorDia?.[diaSiguiente] : undefined,
    );
    if (porque === null) return;

    const primero = dia ? `${DAY_LABELS[kind]} el ${NOMBRES_DE_DIA[dia]}` : DAY_LABELS[kind];
    const segundo = siguiente === null ? "lo del día siguiente" : DAY_LABELS[siguiente].toLowerCase();
    const cuando = diaSiguiente ? `${segundo} el ${NOMBRES_DE_DIA[diaSiguiente]}` : `${segundo} al día siguiente`;

    avisos.push(`${primero} y ${cuando}: ${porque}. Cambiar`);
  });

  return avisos;
}

export const NOMBRES_DE_DIA: Record<WeekDay, string> = {
  LUN: "lunes",
  MAR: "martes",
  MIE: "miércoles",
  JUE: "jueves",
  VIE: "viernes",
  SAB: "sábado",
  DOM: "domingo",
};
