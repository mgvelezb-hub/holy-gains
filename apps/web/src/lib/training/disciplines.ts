import {
  MINIMO_DIA_CON_CARDIO,
  avisoDeRiesgo,
  compatibilidad,
  intensidadDeCardio,
  ordenar,
  porqueDeCombo,
  repartirCardioDespues,
  repartirMinutos,
  type BloqueDia,
} from "@/lib/training/combinaciones";
import { MINUTOS_CARDIO_DESPUES } from "@/lib/training/replan";
import { DAY_GROUPS, NOMBRES_DE_DIA, WEEK_DAYS, type WeekDay } from "@/lib/training/split";
import {
  prescribirSesion,
  type NivelDisciplina,
  type ObjetivoAtleta,
  type SesionDisciplina,
} from "@/lib/training/disciplinas";
import type { DayKind, Discipline, DisciplineLoad, PreferenciasCardio } from "@/lib/training/types";

/**
 * Cómo conviven las disciplinas en una semana (Fase 7, ampliada en Fase 9 con
 * días de dos bloques).
 *
 * Es puro: recibe la semana de pesas ya decidida y reparte lo demás. El
 * reparto corre en cuatro fases, cada una resolviendo lo que la anterior dejó
 * sin resolver — nunca lo que la anterior ya resolvió:
 *
 * 1. **Días libres por score** (`scoreDay`): igual que siempre, cada
 *    disciplina busca el mejor día SIN gimnasio y sin otra secundaria ya
 *    puesta. La vecindad —el alto impacto lejos de la víspera de pierna, la
 *    natación bien el día después— se decide aquí.
 * 2. **Anexar como segundo bloque**: lo que no encontró día libre en la Fase 1
 *    intenta pegarse a un día YA ocupado (de gimnasio o de otra secundaria),
 *    usando `combinaciones.ts` para decidir si de verdad conviven, en qué
 *    orden y con cuántos minutos cada uno. Esto es lo que reemplaza al viejo
 *    "el día compartido pierde un accesorio": ahora la sesión de pesas se
 *    REDIMENSIONA a los minutos que le tocan de verdad, y una sesión que no
 *    era de gimnasio (squash + natación, por ejemplo) también puede combinar.
 * 3. **Liberar un día de descanso**: si después de las dos fases la semana
 *    quedó 7/7 ocupada —ni un día libre, ni de gimnasio ni de disciplina—, se
 *    intenta fusionar el mejor par de días de secundarias (nunca de gimnasio)
 *    para liberar uno. El descanso también es parte del modelo: una semana sin
 *    un solo hueco contradice la premisa de todo este planificador.
 * 4. **Compactar por gusto** (`compactos`, Fase 10): las tres fases de arriba
 *    combinan SOLO cuando algo no cabe suelto o la semana se llenó. Eso deja
 *    fuera el caso real que originó esta fase: gimnasio 1 vez + natación 2 +
 *    squash 2 en una semana de 7 días son 5 sesiones para 7 días —cada una
 *    cabe suelta, nada desborda— y aun así la persona QUIERE squash y natación
 *    el mismo día, porque prefiere concentrar el esfuerzo y quedarse con más
 *    días de descanso completo a repartir por repartir. Combinar por gusto y
 *    repartir por gusto no son "correcto" e "incorrecto": son dos preferencias,
 *    y esta fase es la que por fin le da voz a la primera. Con `compactos`
 *    encendido (`Profile.compactDays`, default `true`), fusiona greedy por
 *    `compatibilidad` — el par de mejor puntaje primero, y así hasta que no
 *    quede par compatible que quepa con el tiempo real del día
 *    (`repartirMinutos`) — entre cualquier par de días de un solo bloque:
 *    secundaria+secundaria, o secundaria+gimnasio (anexándola al día del gym y
 *    liberando el suyo). Nunca un tercer bloque. Las incompatibilidades duras
 *    de `combinaciones.ts` siguen mandando sin excepción: un día de pierna
 *    jamás recibe squash, esté `compactos` encendido o no.
 *
 * La regla que NO cambia: nunca se tira una sesión en silencio. Lo que de
 * plano no cupo —ni en su propio día, ni anexado a otro— se dice en
 * `avisos`. El viejo `break` que abandonaba TODA la cola en cuanto un día no
 * alcanzaba (no solo la disciplina que fallaba) es justo el bug que este
 * rediseño corrige: ahora cada disciplina se intenta por su cuenta.
 *
 * Lo que NO hace: inventar sesiones de disciplinas que no sabemos prescribir.
 * Las que tienen prescriptor traen su plan (`lib/training/disciplinas/`); el
 * resto reserva el día y dice para qué es.
 */

/** Disciplinas de alto impacto: pisan fuerte y compiten con la pierna. */
const HIGH_IMPACT: Discipline[] = ["BOX", "SQUASH", "CROSSFIT", "FUNCIONAL"];

/**
 * Minutos por defecto de una sesión secundaria, por disciplina.
 *
 * `GOLF` en 90: es el default para lo que este planificador semanal sabe
 * repartir, una sesión de práctica (range/juego corto/putting), no una ronda
 * de competencia — esa se registra aparte con `POST /api/v1/golf/ronda` y
 * dura lo que dure el campo, no lo que quepa en la semana de gimnasio.
 */
const DEFAULT_MINUTES: Record<Discipline, number> = {
  PESAS: 60,
  FUNCIONAL: 45,
  CROSSFIT: 45,
  NATACION: 45,
  BOX: 60,
  SQUASH: 60,
  CARDIO: 30,
  GOLF: 90,
  OTRO: 45,
};

/** Nombres para los avisos de "no cupo". Vocabulario del dueño, no el enum. */
const NOMBRE_AVISO: Record<Discipline, string> = {
  PESAS: "Una sesión de gimnasio",
  FUNCIONAL: "Una sesión de funcional",
  CROSSFIT: "Una sesión de CrossFit",
  NATACION: "Una sesión de natación",
  BOX: "Una sesión de box",
  SQUASH: "Una sesión de squash",
  CARDIO: "Una sesión de cardio",
  GOLF: "Una sesión de golf",
  OTRO: "Una sesión de otra actividad",
};

export type OtherSession = {
  /** ISO `YYYY-MM-DD`. */
  date: string;
  weekday: WeekDay;
  discipline: Discipline;
  minutes: number;
  /**
   * El plan de la sesión, si la disciplina ya tiene prescriptor. `null` en las
   * que solo reservan el día: decirlo es más honesto que inventar un circuito
   * que nadie diseñó para esa disciplina.
   */
  sesion: SesionDisciplina | null;
  /** Por qué cayó en ese día (o, si es un combo, por qué va en ese orden). */
  note: string;
  /** Comparte día con una sesión de pesas: ese día de gimnasio se redimensiona. */
  sharesDayWithGym: boolean;
  /**
   * Posición dentro del día: `1` si es la única sesión de ese día, o la
   * primera de un combo; `2` si es el segundo bloque. Un día jamás lleva un
   * tercero — `combinaciones.ts` trabaja siempre en pares.
   */
  orden: 1 | 2;
  /**
   * Los minutos que le quedaron al gym ese día cuando cedió tiempo a este
   * bloque (H2: "Gym · 70 min + Cardio HIIT caminadora · 20 min"). Ausente si
   * el gym no se redimensionó.
   */
  gymMinutes?: number;
};

export type DisciplinePlan = {
  sessions: OtherSession[];
  /** Fechas de gimnasio que comparten día con una secundaria. */
  crowdedDates: string[];
  /**
   * Cuántos minutos le tocan al bloque de PESAS en cada fecha combinada, según
   * `repartirMinutos`. `generate.ts` la usa para recontar ejercicios por
   * minutos reales en vez del parche de "un accesorio menos".
   */
  gymMinutesPorFecha: Record<string, number>;
  /**
   * Lo que de verdad no cupo esta semana —ni en su día, ni anexado a otro, ni
   * liberando un descanso—, una entrada por sesión. Nunca vacío en silencio:
   * si algo se cae, se dice aquí.
   */
  avisos: string[];
};

/** Una colocación en construcción, antes de convertirse en `OtherSession`. */
type Colocacion = {
  weekday: WeekDay;
  discipline: Discipline;
  orden: 1 | 2;
  minutes: number;
  sharesDayWithGym: boolean;
  note: string;
};

function isLegDay(kind: DayKind): boolean {
  return DAY_GROUPS[kind].includes("PIERNA");
}

function dateOf(weekStart: Date, weekday: WeekDay): string {
  const copy = new Date(weekStart);
  copy.setDate(copy.getDate() + WEEK_DAYS.indexOf(weekday));
  copy.setHours(12, 0, 0, 0);
  return copy.toISOString().slice(0, 10);
}

/**
 * Qué tan bien le cae a una disciplina caer en cierto día LIBRE (Fase 1).
 *
 * Más alto es mejor. El orden importa más que los números: lo que se está
 * codificando es "primero los huecos, y dentro de los huecos el que menos
 * interfiere", no una métrica fisiológica.
 */
function scoreDay(
  discipline: Discipline,
  weekday: WeekDay,
  gym: Map<WeekDay, DayKind>,
): number {
  const index = WEEK_DAYS.indexOf(weekday);
  const previous = WEEK_DAYS[index - 1];
  const next = WEEK_DAYS[index + 1];

  const kindTomorrow = next ? gym.get(next) : undefined;
  const kindYesterday = previous ? gym.get(previous) : undefined;

  let score = 100;

  if (HIGH_IMPACT.includes(discipline)) {
    // Nada de alto impacto la víspera de pierna pesada.
    if (kindTomorrow && isLegDay(kindTomorrow)) score -= 60;
  }

  if (discipline === "NATACION") {
    // Bajo impacto y tren superior: cae bien el día después de pierna.
    if (kindYesterday && isLegDay(kindYesterday)) score += 20;
  }

  return score;
}

function noteFor(discipline: Discipline, weekday: WeekDay, gym: Map<WeekDay, DayKind>): string {
  const previous = WEEK_DAYS[WEEK_DAYS.indexOf(weekday) - 1];
  const kindYesterday = previous ? gym.get(previous) : undefined;

  if (discipline === "NATACION" && kindYesterday && isLegDay(kindYesterday)) {
    return "Va después de pierna: bajo impacto y tren superior, ayuda a soltar.";
  }
  if (discipline === "CROSSFIT") {
    return "Ocupa el lugar de un día de gimnasio, no se suma: un metcon con sentadilla es un día de pierna con otro nombre.";
  }
  if (HIGH_IMPACT.includes(discipline)) {
    return "Colocada lejos de la víspera de pierna, que es donde más estorba.";
  }
  return "Cae en un día libre de pesas.";
}

/**
 * Fase 2: intenta anexar `discipline` como segundo bloque a un día que ya
 * tiene UN ocupante (gimnasio o una secundaria de la Fase 1) y que todavía no
 * tiene dos. Entre todos los días donde cabe, se queda con el de mejor
 * `compatibilidad` — no con el primero que encuentra.
 *
 * `opts.soloGym` (Fase 11): cuando la disciplina viene en `modo: 'DESPUES'`,
 * solo se ofrece anexar a un día de GIMNASIO — eso es literalmente lo que
 * "después" significa, "después de pesas". Sin esto, una `DESPUES` podría
 * terminar pegada a otra secundaria, que no es lo que la persona pidió.
 *
 * `opts.explicita` (Fase 11): la persona ya eligió a propósito que esta
 * disciplina vaya después de pesas — se pasa a `compatibilidad` para que la
 * combinación pierna + alto impacto no se cierre en `null` como cuando el
 * motor decide solo, sino que baje a compatibilidad mínima y avise el
 * riesgo (`avisoDeRiesgo`) si termina siendo la elegida.
 *
 * Muta `colocaciones`, `dobles`, `gymMinutesPorFecha` y `avisos` cuando
 * encuentra dónde anexar. Devuelve `true` si lo logró.
 */
function intentarAnexar(
  discipline: Discipline,
  gymByDay: Map<WeekDay, DayKind>,
  colocaciones: Colocacion[],
  dobles: Set<WeekDay>,
  gymMinutesPorFecha: Record<string, number>,
  weekStart: Date,
  timePerDay: Partial<Record<WeekDay, number>> | null | undefined,
  avisos: string[],
  opts?: { soloGym?: boolean; explicita?: boolean },
): boolean {
  const nuevo: BloqueDia = { discipline };

  type Candidato = {
    weekday: WeekDay;
    esGym: boolean;
    ocupante: Colocacion | null;
    orden: [BloqueDia, BloqueDia];
    minutos: [number, number];
    score: number;
  };

  let mejor: Candidato | null = null;

  for (const weekday of WEEK_DAYS) {
    if (dobles.has(weekday)) continue; // ya tiene sus dos bloques

    const esGym = gymByDay.has(weekday);
    if (opts?.soloGym && !esGym) continue; // DESPUES solo se anexa a gimnasio
    const ocupante = esGym ? null : (colocaciones.find((c) => c.weekday === weekday) ?? null);
    if (!esGym && !ocupante) continue; // día completamente libre: no es de Fase 2

    const existente: BloqueDia = esGym
      ? { discipline: "PESAS", dayKind: gymByDay.get(weekday) }
      : { discipline: ocupante!.discipline };

    const score = compatibilidad(existente, nuevo, { explicita: opts?.explicita });
    if (score === null) continue;

    const orden = ordenar(existente, nuevo);
    // Con `timePerDay` declarado, el tiempo real de ese día manda: es lo que
    // de verdad limita si el combo cabe. Sin dato (perfil sin declarar, o
    // `disciplines.ts` llamado sin el hilo del perfil) se cae al viejo
    // supuesto: 60 del gym más el default de la secundaria, la misma cifra
    // imaginaria que antes se usaba siempre.
    const totalMinutos =
      timePerDay?.[weekday] !== undefined
        ? timePerDay[weekday]!
        : esGym
          ? DEFAULT_MINUTES.PESAS + DEFAULT_MINUTES[discipline]
          : ocupante!.minutes + DEFAULT_MINUTES[discipline];
    const reparto = repartirMinutos(totalMinutos, orden);
    if (!reparto) continue;

    if (!mejor || score > mejor.score) {
      mejor = { weekday, esGym, ocupante, orden, minutos: reparto.minutos, score };
    }
  }

  if (!mejor) return false;

  dobles.add(mejor.weekday);
  const [primero, segundo] = mejor.orden;
  const explicacion = porqueDeCombo(primero, segundo);
  const nuevoEsPrimero = primero.discipline === discipline;

  // Se eligió la combinación pierna + alto impacto porque la persona la pidió
  // a propósito (`opts.explicita`): `compatibilidad` ya la dejó pasar con
  // puntaje bajo en vez de `null`, y aquí se avisa el riesgo — combinar sin
  // decirlo sería tan malo como prohibirlo sin excepción.
  // `avisoDeRiesgo` solo es no-nulo en esos dos casos (explícita, o cardio
  // intenso con pierna — H2), así que preguntarle siempre no avisa de más.
  const aviso = avisoDeRiesgo(primero, segundo);
  if (aviso) avisos.push(aviso);
  const minutosNuevo = nuevoEsPrimero ? mejor.minutos[0] : mejor.minutos[1];
  const minutosExistente = nuevoEsPrimero ? mejor.minutos[1] : mejor.minutos[0];

  if (mejor.esGym) {
    gymMinutesPorFecha[dateOf(weekStart, mejor.weekday)] = minutosExistente;
  } else {
    mejor.ocupante!.minutes = minutosExistente;
    mejor.ocupante!.orden = nuevoEsPrimero ? 2 : 1;
    mejor.ocupante!.note = explicacion;
  }

  colocaciones.push({
    weekday: mejor.weekday,
    discipline,
    orden: nuevoEsPrimero ? 1 : 2,
    minutes: minutosNuevo,
    sharesDayWithGym: mejor.esGym,
    note: explicacion,
  });

  return true;
}

/**
 * H2 — el cardio `DESPUES`: 15–20 min al terminar el gym, cada día de pesas.
 *
 * No pasa por `intentarAnexar` porque ahí compite por el MEJOR día y se
 * reparte 60/40; aquí la persona ya dijo qué días (todos los de gimnasio, en
 * orden, hasta sus sesiones) y cuánto cardio. Lo que se ajusta es el gym: con
 * `timePerDay` declarado, la sesión de pesas baja a lo que queda
 * (`gymMinutesPorFecha` → el recorte por prioridad de `generate.ts`). Sin
 * dato de tiempo, el gym se queda como está y el cardio se suma.
 *
 * Nunca en silencio: el día que ni cediendo cabe (< 45 min) se dice con su
 * nombre y sus minutos.
 */
function anexarCardioDespues(
  sesiones: number,
  prefs: PreferenciasCardio | undefined,
  gymByDay: Map<WeekDay, DayKind>,
  colocaciones: Colocacion[],
  dobles: Set<WeekDay>,
  gymMinutesPorFecha: Record<string, number>,
  weekStart: Date,
  timePerDay: Partial<Record<WeekDay, number>> | null | undefined,
  avisos: string[],
): void {
  const pedidos = prefs?.minutos ?? MINUTOS_CARDIO_DESPUES;
  const diasGym = WEEK_DAYS.filter((day) => gymByDay.has(day));
  let colocadas = 0;

  for (const weekday of diasGym) {
    if (colocadas >= sesiones) break;
    if (dobles.has(weekday)) continue;

    const total = timePerDay?.[weekday];
    let minutosCardio = pedidos;
    if (total !== undefined) {
      const reparto = repartirCardioDespues(total, pedidos);
      if (!reparto) {
        avisos.push(
          `El cardio no cupo el ${NOMBRES_DE_DIA[weekday]}: ${total} min declarados (pide al menos ${MINIMO_DIA_CON_CARDIO}).`,
        );
        continue;
      }
      minutosCardio = reparto.cardio;
      gymMinutesPorFecha[dateOf(weekStart, weekday)] = reparto.gym;
    }

    const gym: BloqueDia = { discipline: "PESAS", dayKind: gymByDay.get(weekday) };
    const cardio: BloqueDia = {
      discipline: "CARDIO",
      minutos: minutosCardio,
      intensidad: intensidadDeCardio(prefs),
    };
    const aviso = avisoDeRiesgo(gym, cardio);
    if (aviso) avisos.push(aviso);

    dobles.add(weekday);
    colocaciones.push({
      weekday,
      discipline: "CARDIO",
      orden: 2,
      minutes: minutosCardio,
      sharesDayWithGym: true,
      note: porqueDeCombo(gym, cardio),
    });
    colocadas += 1;
  }

  if (colocadas < sesiones && diasGym.length < sesiones) {
    avisos.push(
      `Cardio después de pesas: pediste ${sesiones} y solo hay ${diasGym.length} ${diasGym.length === 1 ? "día" : "días"} de gimnasio.`,
    );
  }
}

/**
 * Fase 3: si la semana quedó sin un solo día libre, fusiona el mejor par de
 * días de secundarias (nunca de gimnasio) en uno solo, para que el otro quede
 * de descanso completo.
 *
 * "El mejor par" es el de mayor `compatibilidad` entre los días que hoy tienen
 * exactamente un ocupante y no son de gimnasio. El día que sobrevive es el más
 * temprano de la semana — no hay una regla fisiológica que decida cuál fecha
 * se queda, así que se elige la más predecible.
 */
function intentarLiberarDescanso(
  gymByDay: Map<WeekDay, DayKind>,
  colocaciones: Colocacion[],
  dobles: Set<WeekDay>,
): void {
  const ocupado = (day: WeekDay): boolean => gymByDay.has(day) || colocaciones.some((c) => c.weekday === day);
  if (WEEK_DAYS.some((day) => !ocupado(day))) return; // ya hay descanso: nada que liberar

  const fusionables = WEEK_DAYS.filter(
    (day) => !gymByDay.has(day) && !dobles.has(day) && colocaciones.some((c) => c.weekday === day),
  );

  type Fusion = {
    destino: WeekDay;
    origen: WeekDay;
    orden: [BloqueDia, BloqueDia];
    minutos: [number, number];
    score: number;
  };
  let mejor: Fusion | null = null;

  for (let i = 0; i < fusionables.length; i++) {
    for (let j = i + 1; j < fusionables.length; j++) {
      const destino = fusionables[i]!;
      const origen = fusionables[j]!;
      const colDestino = colocaciones.find((c) => c.weekday === destino)!;
      const colOrigen = colocaciones.find((c) => c.weekday === origen)!;
      const bloqueDestino: BloqueDia = { discipline: colDestino.discipline };
      const bloqueOrigen: BloqueDia = { discipline: colOrigen.discipline };

      const score = compatibilidad(bloqueDestino, bloqueOrigen);
      if (score === null) continue;

      const orden = ordenar(bloqueDestino, bloqueOrigen);
      const reparto = repartirMinutos(colDestino.minutes + colOrigen.minutes, orden);
      if (!reparto) continue;

      if (!mejor || score > mejor.score) {
        mejor = { destino, origen, orden, minutos: reparto.minutos, score };
      }
    }
  }

  if (!mejor) return; // no hay par que combine: la semana se queda 7/7

  const colDestino = colocaciones.find((c) => c.weekday === mejor!.destino)!;
  const colOrigen = colocaciones.find((c) => c.weekday === mejor!.origen)!;
  const [primero, segundo] = mejor.orden;
  const explicacion = porqueDeCombo(primero, segundo);
  const destinoEsPrimero = primero.discipline === colDestino.discipline;

  colDestino.orden = destinoEsPrimero ? 1 : 2;
  colDestino.minutes = destinoEsPrimero ? mejor.minutos[0] : mejor.minutos[1];
  colDestino.note = explicacion;

  // Se muda de fecha: el día de origen queda sin ninguna colocación, es decir,
  // libre de verdad.
  colOrigen.weekday = mejor.destino;
  colOrigen.orden = destinoEsPrimero ? 2 : 1;
  colOrigen.minutes = destinoEsPrimero ? mejor.minutos[1] : mejor.minutos[0];
  colOrigen.note = explicacion;
}

/** Un día de un solo bloque, candidato a compactarse con otro (Fase 10). */
type CandidatoCompacto = { weekday: WeekDay; esGym: boolean; colocacion: Colocacion | null };

/**
 * Los días de UN solo bloque —gimnasio sin secundaria anexada, o una
 * secundaria sola— en orden de semana. Un día con dos bloques ya no tiene
 * dónde anexar un tercero; un día vacío no tiene con qué combinar. Se recorre
 * el estado real (`colocaciones`/`gymByDay`) en vez de un `Set` aparte porque
 * la Fase 3 puede haber dejado un día con dos `Colocacion` sin haber pasado
 * por `intentarAnexar` (que es el único que hoy usa `dobles`) — contar de
 * verdad es la única forma de no confundir "ya lleva dos" con "todavía uno".
 */
function candidatosCompactables(
  gymByDay: Map<WeekDay, DayKind>,
  colocaciones: Colocacion[],
): CandidatoCompacto[] {
  const candidatos: CandidatoCompacto[] = [];
  for (const weekday of WEEK_DAYS) {
    const enEseDia = colocaciones.filter((colocacion) => colocacion.weekday === weekday);
    const esGym = gymByDay.has(weekday);
    const totalBloques = (esGym ? 1 : 0) + enEseDia.length;
    if (totalBloques !== 1) continue; // libre del todo, o ya lleva sus dos bloques

    candidatos.push(esGym ? { weekday, esGym: true, colocacion: null } : { weekday, esGym: false, colocacion: enEseDia[0]! });
  }
  return candidatos;
}

/**
 * Fase 10: compacta por preferencia, no por desborde.
 *
 * A diferencia de la Fase 2 (que anexa lo que no cupo suelto) y la Fase 3
 * (que solo actúa si la semana quedó 7/7), esta corre siempre que `compactos`
 * esté encendido, exista o no un día libre de sobra — es la diferencia entre
 * "combino porque no cabe de otra forma" y "combino porque así lo quiero".
 *
 * Greedy: en cada vuelta, evalúa TODOS los pares de días de un solo bloque,
 * calcula su `compatibilidad` y se queda con el de mejor puntaje que además
 * quepa en `repartirMinutos` (con el tiempo real de `timePerDay`, o el
 * fallback de `DEFAULT_MINUTES` cuando no se ha declarado). Fusiona ese par,
 * vuelve a evaluar desde cero —el estado cambió, así que el mejor par
 * siguiente puede no ser el segundo mejor de la vuelta anterior— y repite
 * hasta que ningún par restante combine. Es el mismo orden de preferencia que
 * ya vive en `combinaciones.ts` (squash+natación puntúa 70, un día de
 * gimnasio de torso+natación puntúa 55): esta fase no inventa una regla
 * nueva, solo la deja actuar sin esperar a que algo desborde.
 *
 * El día de gimnasio, si participa, siempre sobrevive como destino: su fecha
 * ya la fijó el split y no se puede mover. Entre dos secundarias sobrevive la
 * más temprana de la semana, igual que en `intentarLiberarDescanso` — no hay
 * una regla fisiológica que decida cuál fecha se queda.
 */
function intentarCompactar(
  gymByDay: Map<WeekDay, DayKind>,
  colocaciones: Colocacion[],
  gymMinutesPorFecha: Record<string, number>,
  weekStart: Date,
  timePerDay: Partial<Record<WeekDay, number>> | null | undefined,
  avisos: string[],
): void {
  for (;;) {
    const candidatos = candidatosCompactables(gymByDay, colocaciones);

    type Fusion = {
      destino: CandidatoCompacto;
      origen: CandidatoCompacto;
      orden: [BloqueDia, BloqueDia];
      minutos: [number, number];
      score: number;
    };
    let mejor: Fusion | null = null;

    for (let i = 0; i < candidatos.length; i++) {
      for (let j = i + 1; j < candidatos.length; j++) {
        const a = candidatos[i]!;
        const b = candidatos[j]!;
        if (a.esGym && b.esGym) continue; // dos días de gimnasio no combinan entre sí

        // El de gimnasio, si hay uno, siempre es el destino: su fecha no se
        // mueve. Entre dos secundarias, `a` ya es la más temprana —
        // `candidatosCompactables` recorre `WEEK_DAYS` en orden y `i < j`.
        const [destino, origen] = a.esGym ? [a, b] : b.esGym ? [b, a] : [a, b];

        const bloqueDestino: BloqueDia = destino.esGym
          ? { discipline: "PESAS", dayKind: gymByDay.get(destino.weekday) }
          : { discipline: destino.colocacion!.discipline };
        const bloqueOrigen: BloqueDia = { discipline: origen.colocacion!.discipline };

        const score = compatibilidad(bloqueDestino, bloqueOrigen);
        if (score === null) continue; // incompatibilidad dura: manda siempre, `compactos` o no

        const orden = ordenar(bloqueDestino, bloqueOrigen);
        const totalMinutos = destino.esGym
          ? (timePerDay?.[destino.weekday] ??
              DEFAULT_MINUTES.PESAS + DEFAULT_MINUTES[origen.colocacion!.discipline])
          : (timePerDay?.[destino.weekday] ??
              destino.colocacion!.minutes + origen.colocacion!.minutes);
        const reparto = repartirMinutos(totalMinutos, orden);
        if (!reparto) continue; // no caben los dos mínimos ni con el tiempo real del día

        if (!mejor || score > mejor.score) {
          mejor = { destino, origen, orden, minutos: reparto.minutos, score };
        }
      }
    }

    if (!mejor) return; // no queda par compatible que quepa: la compactación termina aquí

    const [primero] = mejor.orden;
    const explicacion = porqueDeCombo(mejor.orden[0], mejor.orden[1]);
    // Cardio intenso con pierna sí se compacta, pero diciéndolo (H2).
    const riesgo = avisoDeRiesgo(mejor.orden[0], mejor.orden[1]);
    if (riesgo) avisos.push(riesgo);
    const discDestino = mejor.destino.esGym ? "PESAS" : mejor.destino.colocacion!.discipline;
    const destinoEsPrimero = primero.discipline === discDestino;
    const minutosDestino = destinoEsPrimero ? mejor.minutos[0] : mejor.minutos[1];
    const minutosOrigen = destinoEsPrimero ? mejor.minutos[1] : mejor.minutos[0];

    if (mejor.destino.esGym) {
      gymMinutesPorFecha[dateOf(weekStart, mejor.destino.weekday)] = minutosDestino;
    } else {
      mejor.destino.colocacion!.orden = destinoEsPrimero ? 1 : 2;
      mejor.destino.colocacion!.minutes = minutosDestino;
      mejor.destino.colocacion!.note = explicacion;
    }

    // La secundaria de origen se muda a la fecha destino: su día original
    // queda sin colocación — libre de verdad, no solo "sin nada planeado".
    mejor.origen.colocacion!.weekday = mejor.destino.weekday;
    mejor.origen.colocacion!.orden = destinoEsPrimero ? 2 : 1;
    mejor.origen.colocacion!.minutes = minutosOrigen;
    mejor.origen.colocacion!.note = explicacion;
    mejor.origen.colocacion!.sharesDayWithGym = mejor.destino.esGym;
  }
}

/**
 * Reparte las sesiones de las disciplinas secundarias en la semana.
 *
 * `gymByDay` es la semana de pesas ya decidida: qué se entrena cada día. Sin
 * ella no se puede aplicar la vecindad, que es la regla que evita el clásico
 * "box el martes, pierna el miércoles" que arruina las dos sesiones.
 */
export function planDisciplines(input: {
  weekStart: Date;
  otherDisciplines: DisciplineLoad[];
  gymByDay: Map<WeekDay, DayKind>;
  /** El nivel declarado de cada disciplina. Lo que falte arranca en principiante. */
  niveles: Partial<Record<Discipline, NivelDisciplina>>;
  /** El objetivo del perfil: modula el volumen, no la técnica. */
  objetivo: ObjetivoAtleta;
  isoWeek: number;
  /**
   * Minutos reales por día, tal como la persona los declaró al replanificar.
   * `null`/`undefined` = no se ha declarado; se cae al `DEFAULT_MINUTES` de
   * siempre. Con dato, decide si un combo cabe de verdad (Fase 2) en vez de
   * repartir 60 minutos imaginarios de gimnasio.
   */
  timePerDay?: Partial<Record<WeekDay, number>> | null;
  /**
   * Preferencia declarada en Ajustes (`Profile.compactDays`): combinar
   * disciplinas compatibles el mismo día por gusto, no solo cuando algo
   * desborda. `undefined`/`false` deja el comportamiento de siempre (Fases
   * 1-3 únicamente).
   */
  compactos?: boolean;
  /**
   * Semanas anteriores de cardio, planeadas vs registradas: de ahí sube el
   * nivel del HIIT de caminadora (N1). Ausente = arranca en el piso.
   */
  historialCardio?: ReadonlyArray<{ isoWeek: number; planeadas: number; registradas: number }>;
}): DisciplinePlan {
  const { weekStart, otherDisciplines, gymByDay, niveles, objetivo, isoWeek, timePerDay, compactos } = input;

  // Fase 11: `modo: 'DESPUES'` es una disciplina que ya se decidió que va
  // después de pesas — no compite por un día propio ni paga presupuesto
  // (`sessionsSpentOutsideGym` en `split.ts` la ignora). `DIA_PROPIO`, o sin
  // `modo` declarado (compatibilidad hacia atrás), sigue el reparto de
  // siempre: día libre primero, y solo si no cabe se anexa.
  const cargaDespues = otherDisciplines.filter((load) => load.modo === "DESPUES");
  const cargaDiaPropio = otherDisciplines.filter((load) => load.modo !== "DESPUES");

  // Las de alto impacto se colocan primero: son las que tienen restricciones
  // duras. Si se colocan al final, se quedan con los días que nadie quiso.
  const queue = cargaDiaPropio
    .flatMap((load) =>
      Array.from({ length: Math.max(0, Math.min(7, Math.trunc(load.sessionsPerWeek))) }, () => load.discipline),
    )
    .sort((a, b) => Number(HIGH_IMPACT.includes(b)) - Number(HIGH_IMPACT.includes(a)));

  const queueDespues = cargaDespues
    .flatMap((load) =>
      Array.from({ length: Math.max(0, Math.min(7, Math.trunc(load.sessionsPerWeek))) }, () => load.discipline),
    )
    .sort((a, b) => Number(HIGH_IMPACT.includes(b)) - Number(HIGH_IMPACT.includes(a)));

  const colocaciones: Colocacion[] = [];
  const dobles = new Set<WeekDay>();
  const gymMinutesPorFecha: Record<string, number> = {};
  const avisos: string[] = [];

  // FASE 1 — días completamente libres, por score. -------------------------
  const takenPhase1 = new Set<WeekDay>();
  const sinColocar: Discipline[] = [];

  for (const discipline of queue) {
    const candidates = WEEK_DAYS.filter((day) => !takenPhase1.has(day) && !gymByDay.has(day)).sort(
      (a, b) =>
        scoreDay(discipline, b, gymByDay) - scoreDay(discipline, a, gymByDay) ||
        WEEK_DAYS.indexOf(a) - WEEK_DAYS.indexOf(b),
    );

    const weekday = candidates[0];
    if (!weekday) {
      // Antes había un `break` aquí: en cuanto UNA disciplina no encontraba
      // día, se abandonaba TODA la cola, incluso lo que venía después y sí
      // hubiera cabido. Ahora cada una se intenta por su cuenta en la Fase 2.
      sinColocar.push(discipline);
      continue;
    }

    takenPhase1.add(weekday);
    colocaciones.push({
      weekday,
      discipline,
      orden: 1,
      minutes: DEFAULT_MINUTES[discipline],
      sharesDayWithGym: false,
      note: noteFor(discipline, weekday, gymByDay),
    });
  }

  // FASE 2 — anexar como segundo bloque a un día ya ocupado. ---------------
  // Primero las `DESPUES`: NUNCA pasaron por la Fase 1 (no compiten por un
  // día propio, van después de pesas por definición) y solo se ofrecen a
  // días de gimnasio (`soloGym`). `explicita` deja que, si de plano el único
  // gym de la semana es de pierna, la combinación con squash/box se acepte
  // con aviso en vez de cerrarse en seco — la persona ya lo pidió así.
  // El cardio `DESPUES` va antes que nada y por su propio camino (H2): no
  // busca el mejor día, va en cada día de gimnasio y el gym le cede minutos.
  for (const load of cargaDespues.filter((carga) => carga.discipline === "CARDIO")) {
    anexarCardioDespues(
      Math.max(0, Math.min(7, Math.trunc(load.sessionsPerWeek))),
      load.cardio,
      gymByDay,
      colocaciones,
      dobles,
      gymMinutesPorFecha,
      weekStart,
      timePerDay,
      avisos,
    );
  }

  const noColocadas: Discipline[] = [];
  for (const discipline of queueDespues.filter((disciplina) => disciplina !== "CARDIO")) {
    const anexada = intentarAnexar(
      discipline,
      gymByDay,
      colocaciones,
      dobles,
      gymMinutesPorFecha,
      weekStart,
      timePerDay,
      avisos,
      { soloGym: true, explicita: true },
    );
    if (!anexada) noColocadas.push(discipline);
  }

  // Después lo que la Fase 1 no pudo colocar en día libre: el motor decide
  // solo dónde anexarlo, así que las reglas duras siguen sin excepción.
  for (const discipline of sinColocar) {
    const anexada = intentarAnexar(
      discipline,
      gymByDay,
      colocaciones,
      dobles,
      gymMinutesPorFecha,
      weekStart,
      timePerDay,
      avisos,
    );
    if (!anexada) noColocadas.push(discipline);
  }

  for (const discipline of noColocadas) {
    avisos.push(
      `${NOMBRE_AVISO[discipline]} no cupo esta semana: no hay ningún día, libre o combinado, donde alcance el tiempo mínimo.`,
    );
  }

  // FASE 3 — si la semana quedó 7/7, liberar un descanso. -------------------
  intentarLiberarDescanso(gymByDay, colocaciones, dobles);

  // FASE 4 — compactar por gusto, esté o no la semana llena. ----------------
  if (compactos) {
    intentarCompactar(gymByDay, colocaciones, gymMinutesPorFecha, weekStart, timePerDay, avisos);
  }

  // Construcción final: el ordinal de cada disciplina sale de su orden
  // cronológico, no del orden en que se procesó la cola — con combos, ese
  // orden de proceso ya no coincide con la fecha final.
  // CARDIO con preferencias, o "después de pesas", se prescribe como cardio
  // en máquina (`disciplinas/cardio.ts`), no como correr (H2).
  const cargaCardio = otherDisciplines.find((load) => load.discipline === "CARDIO");
  const prefsCardio =
    cargaCardio?.cardio ?? (cargaCardio?.modo === "DESPUES" ? {} : undefined);

  const porDisciplina = new Map<Discipline, Colocacion[]>();
  for (const colocacion of colocaciones) {
    const lista = porDisciplina.get(colocacion.discipline) ?? [];
    lista.push(colocacion);
    porDisciplina.set(colocacion.discipline, lista);
  }

  const sessions: OtherSession[] = [];
  for (const [discipline, lista] of porDisciplina) {
    const enOrden = [...lista].sort((a, b) => WEEK_DAYS.indexOf(a.weekday) - WEEK_DAYS.indexOf(b.weekday));
    enOrden.forEach((colocacion, index) => {
      const ordinal = index + 1;
      const fecha = dateOf(weekStart, colocacion.weekday);
      const gymMinutes = colocacion.sharesDayWithGym ? gymMinutesPorFecha[fecha] : undefined;
      sessions.push({
        ...(gymMinutes !== undefined ? { gymMinutes } : {}),
        date: fecha,
        weekday: colocacion.weekday,
        discipline,
        minutes: colocacion.minutes,
        sesion: prescribirSesion({
          discipline,
          nivel: niveles[discipline] ?? "PRINCIPIANTE",
          isoWeek,
          ordinal,
          minutes: colocacion.minutes,
          objetivo,
          ...(discipline === "CARDIO" && prefsCardio ? { cardio: prefsCardio } : {}),
          ...(discipline === "CARDIO" && input.historialCardio ? { historialCardio: input.historialCardio } : {}),
        }),
        note: colocacion.note,
        sharesDayWithGym: colocacion.sharesDayWithGym,
        orden: colocacion.orden,
      });
    });
  }

  const ordered = sessions.sort((a, b) => a.date.localeCompare(b.date) || a.orden - b.orden);

  return {
    sessions: ordered,
    crowdedDates: ordered.filter((session) => session.sharesDayWithGym).map((session) => session.date),
    gymMinutesPorFecha,
    avisos,
  };
}

/**
 * Reconstruye el día completo de un override de bloque en arreglo (Fase 11):
 * `{ "2026-09-04": ["SQUASH", "NATACION"] }`, "hoy solo squash y natación,
 * sin gym". No pasa por `planDisciplines` —ese día no compite por huecos, ya
 * está decidido— pero sí reusa sus mismas piezas: `ordenar`/`repartirMinutos`
 * para el reparto de tiempo cuando son dos, y `prescribirSesion` para que
 * cada bloque traiga su plan como cualquier otro.
 *
 * Con una sola disciplina no hay nada que repartir: se lleva todo el tiempo
 * declarado (o el default si no hay dato).
 */
export function sesionesDeDiaOverride(input: {
  date: string;
  weekday: WeekDay;
  disciplinas: Discipline[];
  niveles: Partial<Record<Discipline, NivelDisciplina>>;
  objetivo: ObjetivoAtleta;
  isoWeek: number;
  /** Minutos reales de ese día, o `null` si no se declararon. */
  minutos?: number | null;
}): OtherSession[] {
  const { date, weekday, disciplinas, niveles, objetivo, isoWeek, minutos } = input;

  const sesionPara = (discipline: Discipline, mins: number): SesionDisciplina | null =>
    prescribirSesion({
      discipline,
      nivel: niveles[discipline] ?? "PRINCIPIANTE",
      isoWeek,
      ordinal: 1,
      minutes: mins,
      objetivo,
    });

  if (disciplinas.length === 1) {
    const discipline = disciplinas[0]!;
    const mins = minutos ?? DEFAULT_MINUTES[discipline];
    return [
      {
        date,
        weekday,
        discipline,
        minutes: mins,
        sesion: sesionPara(discipline, mins),
        note: "Cambiaste este día a mano: hoy es solo esto, sin gimnasio.",
        sharesDayWithGym: false,
        orden: 1,
      },
    ];
  }

  const [primero, segundo] = ordenar({ discipline: disciplinas[0]! }, { discipline: disciplinas[1]! });
  const total = minutos ?? DEFAULT_MINUTES[primero.discipline] + DEFAULT_MINUTES[segundo.discipline];
  // Si ni con los defaults caben los dos mínimos, se reparte a la mitad —
  // sigue siendo mejor decirle a la atleta un número real que no decir nada.
  const reparto = repartirMinutos(total, [primero, segundo]) ?? {
    minutos: [Math.round(total / 2), total - Math.round(total / 2)] as [number, number],
  };
  const explicacion = porqueDeCombo(primero, segundo);

  return [primero, segundo].map((bloque, index) => ({
    date,
    weekday,
    discipline: bloque.discipline,
    minutes: reparto.minutos[index]!,
    sesion: sesionPara(bloque.discipline, reparto.minutos[index]!),
    note: explicacion,
    sharesDayWithGym: false,
    orden: (index + 1) as 1 | 2,
  }));
}

export type { NivelDisciplina, SesionDisciplina };
