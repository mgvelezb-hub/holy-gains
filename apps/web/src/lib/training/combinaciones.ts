import { gruposFatigados } from "@/lib/training/carga-muscular";
import { DAY_GROUPS } from "@/lib/training/split";
import type { DayKind, Discipline, MuscleGroup } from "@/lib/training/types";

/**
 * Cómo conviven DOS disciplinas EL MISMO DÍA (Fase 9).
 *
 * Hasta aquí, `disciplines.ts` sabía compartir un día con el gimnasio de una
 * sola forma: la sesión de pesas perdía un accesorio y ya. Eso resolvía el
 * caso fácil, pero dejaba dos huecos reales:
 *
 * 1. **La sesión no se redimensiona, se recorta a ciegas.** Perder "un
 *    accesorio" no es lo mismo que saber cuántos minutos quedan de verdad —
 *    treinta minutos de pesas piden una sesión de treinta minutos, no la de
 *    siempre menos una serie.
 * 2. **Solo existía la combinación con el gimnasio.** Squash y natación el
 *    mismo día, o dos disciplinas sin pesas de por medio, no tenían ninguna
 *    regla — así que cuando la semana se llenaba, la sesión que sobraba
 *    simplemente se perdía (ver el `break` que se quita en `disciplines.ts`).
 *
 * Este módulo es la respuesta a "¿pueden estos dos entrenamientos ir el mismo
 * día, y si sí, en qué orden y con cuántos minutos cada uno?". Es puro a
 * propósito: no sabe de perfiles, de horarios ni de la semana completa — eso
 * vive en `disciplines.ts` (que decide QUÉ días combinar) y en `replan.ts`
 * (que decide lo mismo para el rearmado desde cero). Aquí solo viven las
 * cuatro preguntas: ¿combinan?, ¿qué tanto interfieren?, ¿en qué orden?, y
 * ¿cuántos minutos le tocan a cada uno?
 */

/** Minutos de transición entre bloques: cambiar de cancha, alberca o sala cuesta tiempo real, no es un descuento simbólico. */
const MINUTOS_TRANSICION = 10;

/** Mínimo digno de un bloque de pesas: por debajo de esto no hay sesión que progrese. */
const MINIMO_PESAS = 30;

/** Mínimo digno de cualquier otro bloque: lo mismo que "hobby" en `replan.ts`, la cota de abajo de una sesión que vale la pena. */
const MINIMO_OTRO = 25;

/**
 * Disciplinas de alto impacto para efectos de convivencia con pierna.
 *
 * Es la misma lista de `HIGH_IMPACT` en `disciplines.ts`, repetida aquí a
 * propósito: ese módulo la usa para decidir EN QUÉ DÍA cae cada una respecto a
 * la semana completa (la víspera de pierna), y este módulo la usa para decidir
 * si dos disciplinas pueden convivir EL MISMO día. Son preguntas distintas —
 * importar una de la otra acoplaría dos módulos que deben poder cambiar cada
 * uno por su lado.
 */
const ALTO_IMPACTO: Discipline[] = ["BOX", "SQUASH", "CROSSFIT", "FUNCIONAL", "CARDIO"];

export type BloqueDia = {
  discipline: Discipline;
  /** Solo tiene sentido cuando `discipline === "PESAS"`: qué día del split es. */
  dayKind?: DayKind;
};

/** Los grupos musculares que este bloque carga fuerte (nivel 2). */
function gruposFuertes(bloque: BloqueDia): MuscleGroup[] {
  if (bloque.discipline === "PESAS") {
    // El gimnasio no tiene una "carga fuerte" propia: la hereda del día del
    // split, que es justo lo que `DAY_GROUPS` describe.
    return bloque.dayKind ? DAY_GROUPS[bloque.dayKind] : [];
  }
  return gruposFatigados(bloque.discipline);
}

function esDiaDePierna(bloque: BloqueDia): boolean {
  return bloque.discipline === "PESAS" && bloque.dayKind !== undefined && DAY_GROUPS[bloque.dayKind].includes("PIERNA");
}

function esSquashBox(a: BloqueDia, b: BloqueDia): boolean {
  return (
    (a.discipline === "SQUASH" && b.discipline === "BOX") || (a.discipline === "BOX" && b.discipline === "SQUASH")
  );
}

function esCrossfitConGym(a: BloqueDia, b: BloqueDia): boolean {
  return a.discipline === "CROSSFIT" && b.discipline === "PESAS";
}

/**
 * El día de HOMBRO del split (`DAY_GROUPS.HOMBRO = ["HOMBRO", "ABDOMEN"]`) es,
 * de todo el split, el que más se parece al patrón del swing: press y
 * rotación de hombro más trabajo de core. Es justo el que el golf debería
 * evitar el mismo día — no por riesgo de lesión (no es alto impacto, no hay
 * regla dura), sino porque llegar a una ronda con el hombro y el core ya
 * cargados de pesas pesadas resta calidad al swing. Se modela como penalización
 * de puntaje, no como `null`: es una preferencia de rendimiento, no una
 * incompatibilidad física como pierna+alto impacto.
 */
function esDiaDeHombroYCore(bloque: BloqueDia): boolean {
  return bloque.discipline === "PESAS" && bloque.dayKind === "HOMBRO";
}

/**
 * El día de TORSO (`DAY_GROUPS.TORSO = ["PECHO", "ESPALDA", "HOMBRO"]`) es
 * empuje y jalón horizontal, sin el énfasis de rotación de core del día de
 * HOMBRO — es el que mejor convive con el golf: complementa el tren superior
 * sin pisarle al swing.
 */
function esDiaDeTorso(bloque: BloqueDia): boolean {
  return bloque.discipline === "PESAS" && bloque.dayKind === "TORSO";
}

function esSquashOBox(bloque: BloqueDia): boolean {
  return bloque.discipline === "SQUASH" || bloque.discipline === "BOX";
}

function redondearA5(minutos: number): number {
  return Math.round(minutos / 5) * 5;
}

/**
 * Qué tan bien conviven dos bloques el mismo día.
 *
 * `null` significa "nunca": no es una nota baja, es una combinación que no se
 * ofrece. Todo lo demás es un puntaje —más alto es mejor— que sirve para
 * elegir, entre varios candidatos posibles, el que menos interfiere.
 *
 * Las reglas duras, con su porqué fisiológico:
 *
 * - **Pierna de gimnasio + alto impacto**: sentadilla o peso muerto dejan la
 *   pierna fatigada, y el footwork de squash/box o el impacto de un metcon
 *   sobre una pierna cansada es el patrón clásico de esguince de tobillo o
 *   dolor de rodilla. No se ofrece en ningún orden.
 * - **Squash + Box**: ambas de alto impacto y dominadas por el core — combinar
 *   dos sesiones que ya de por sí piden reservas de sistema nervioso central
 *   deja una de las dos sin calidad real.
 * - **CrossFit + cualquier día de gimnasio**: CrossFit ya es cuerpo completo;
 *   sumarle otro día de cuerpo completo (aunque sea de brazo) es entrenar dos
 *   veces lo mismo el mismo día, no complementar.
 * - **Misma disciplina consigo misma**: dos bloques de pesas, o dos de squash,
 *   no son una "combinación" — son la misma sesión partida en dos, y eso lo
 *   resuelve la duración de la sesión, no este módulo.
 *
 * Además de las reglas duras, hay un ajuste de puntaje específico de golf:
 * combina mejor con el día de TORSO del split (empuje/jalón, sin énfasis de
 * rotación) y peor con el día de HOMBRO (hombro + core, el patrón más
 * parecido al swing) — llegar a una ronda con eso ya cargado resta calidad al
 * swing, aunque no sea una incompatibilidad física que amerite bloquear la
 * combinación.
 *
 * `opts.explicita` (Fase 11): la regla de pierna + alto impacto es dura
 * cuando el MOTOR decide solo dónde cae cada disciplina — ahí sigue
 * prohibida sin excepción. Pero cuando la persona ya lo pidió a propósito
 * (`modo: 'DESPUES'` en una disciplina secundaria, o un override de bloque),
 * negarle la combinación no la protege de nada: ella ya sabe que quiere
 * squash después de pierna. Esos casos bajan a compatibilidad mínima en vez
 * de `null` — se ofrecen solo si de plano no hay nada mejor — y quien la
 * elige debe avisar el riesgo (`avisoDeRiesgo`).
 */
export function compatibilidad(
  a: BloqueDia,
  b: BloqueDia,
  opts?: { explicita?: boolean },
): number | null {
  if (a.discipline === b.discipline) return null;

  if (
    (esDiaDePierna(a) && ALTO_IMPACTO.includes(b.discipline)) ||
    (esDiaDePierna(b) && ALTO_IMPACTO.includes(a.discipline))
  ) {
    return opts?.explicita ? 10 : null;
  }

  if (esSquashBox(a, b)) return null;
  if (esCrossfitConGym(a, b) || esCrossfitConGym(b, a)) return null;

  // Base neutra: ninguna de las reglas duras aplicó, así que sí se puede.
  let score = 50;

  const fuertesA = gruposFuertes(a);
  const fuertesB = gruposFuertes(b);
  const traslape = fuertesA.filter((grupo) => fuertesB.includes(grupo));
  score -= 15 * traslape.length;

  // La natación es bajo impacto y funciona como recuperación activa — la
  // experiencia que reportan las atletas es literal: "la alberca post
  // refresca". Por eso combina mejor que cualquier otro par.
  if (a.discipline === "NATACION" || b.discipline === "NATACION") score += 20;

  // Golf: mejor con el torso genérico, peor con el día que ya carga hombro y
  // core como el swing (ver el docblock de `esDiaDeHombroYCore`).
  if (a.discipline === "GOLF" || b.discipline === "GOLF") {
    if (esDiaDeTorso(a) || esDiaDeTorso(b)) score += 15;
    if (esDiaDeHombroYCore(a) || esDiaDeHombroYCore(b)) score -= 25;
  }

  return score;
}

/**
 * En qué orden va cada bloque dentro del día.
 *
 * Tres reglas, en este orden de prioridad porque no son intercambiables:
 *
 * 1. **Natación siempre al final.** Es recuperación activa y su técnica es la
 *    que menos se degrada con fatiga acumulada — cerrar con alberca "suelta",
 *    abrir con alberca desperdicia la frescura en lo que menos la necesita.
 * 2. **Squash/Box antes que pesas.** La habilidad (footwork, timing) y el
 *    impacto necesitan piernas y sistema nervioso frescos; el trabajo de
 *    torso del gimnasio, en cambio, no se degrada por llegar con las piernas
 *    cansadas.
 * 3. **Pesas antes que cardio.** Si el objetivo incluye fuerza, la calidad del
 *    levantamiento manda — es el efecto de interferencia clásico: cardio
 *    antes de pesas resta capacidad neuromuscular justo donde más se nota.
 *
 * Fuera de estas tres, no hay una regla fisiológica declarada — se conserva el
 * orden de entrada, que es la opción más predecible y la que no inventa una
 * preferencia que nadie pidió.
 */
export function ordenar(a: BloqueDia, b: BloqueDia): [BloqueDia, BloqueDia] {
  if (a.discipline === "NATACION") return [b, a];
  if (b.discipline === "NATACION") return [a, b];

  if (esSquashOBox(a) && b.discipline === "PESAS") return [a, b];
  if (esSquashOBox(b) && a.discipline === "PESAS") return [b, a];

  if (a.discipline === "PESAS" && b.discipline === "CARDIO") return [a, b];
  if (b.discipline === "PESAS" && a.discipline === "CARDIO") return [b, a];

  return [a, b];
}

/**
 * Cuántos minutos le tocan a cada bloque, o `null` si de plano no caben.
 *
 * Se resta primero la transición (cambiarse, moverse de cancha o alberca es
 * tiempo real). Con lo que queda: pesas pide mínimo 30, cualquier otro
 * mínimo 25 — por debajo de eso la sesión deja de valer la pena, igual que en
 * `replan.ts`. Lo que sobra después de los mínimos se reparte 60/40 a favor
 * del primer bloque (el que definió `ordenar`), redondeado a múltiplos de 5
 * para que los números se vean como los que un coach escribiría a mano.
 */
export function repartirMinutos(
  total: number,
  bloques: [BloqueDia, BloqueDia],
): { minutos: [number, number] } | null {
  const disponible = total - MINUTOS_TRANSICION;
  const minimos: [number, number] = bloques.map((bloque) =>
    bloque.discipline === "PESAS" ? MINIMO_PESAS : MINIMO_OTRO,
  ) as [number, number];

  if (disponible < minimos[0] + minimos[1]) return null;

  const primeroSinTope = redondearA5(disponible * 0.6);
  // El tope inferior y superior garantizan que ambos bloques respeten su
  // mínimo aunque el redondeo a 5 se pase para un lado.
  const primero = Math.max(minimos[0], Math.min(primeroSinTope, disponible - minimos[1]));
  const segundo = disponible - primero;

  return { minutos: [primero, segundo] };
}

/** Día mínimo para gym + cardio después: por debajo, ni cediendo el gym caben los dos. */
export const MINIMO_DIA_CON_CARDIO = 45;

/** Lo que el gym conserva como mínimo cuando le cede minutos al cardio. */
const MINIMO_PESAS_CON_CARDIO = 25;

/** Lo más que se encoge el cardio para caber: menos que esto ya no es sesión. */
const MINIMO_CARDIO = 10;

/**
 * Minutos de gym y cardio cuando el cardio va DESPUÉS de pesas, o `null` si
 * el día es menor a `MINIMO_DIA_CON_CARDIO`.
 *
 * No es el 60/40 de `repartirMinutos`: aquí la persona declaró cuánto cardio
 * quiere (15–20 min de caminadora al terminar), y lo que se ajusta es el gym
 * — la sesión de pesas se recorta por prioridad a lo que queda
 * (`recortarPorPrioridad` en `generate.ts`, vía `gymMinutesPorFecha`). Sin
 * transición: la caminadora está en la misma sala, no hay cancha ni alberca
 * a la que moverse. Solo si ni así cabe el mínimo del gym, el cardio se
 * encoge (hasta `MINIMO_CARDIO`).
 */
export function repartirCardioDespues(
  total: number,
  minutosCardio: number,
): { gym: number; cardio: number } | null {
  if (total < MINIMO_DIA_CON_CARDIO) return null;
  const cardio = Math.max(MINIMO_CARDIO, Math.min(minutosCardio, total - MINIMO_PESAS_CON_CARDIO));
  return { gym: total - cardio, cardio };
}

const NOMBRES_DISCIPLINA: Record<Discipline, string> = {
  PESAS: "el gimnasio",
  FUNCIONAL: "funcional",
  CROSSFIT: "CrossFit",
  NATACION: "la alberca",
  BOX: "box",
  SQUASH: "squash",
  CARDIO: "el cardio",
  GOLF: "el golf",
  OTRO: "esa actividad",
};

/**
 * La frase que explica por qué el día quedó en ese orden.
 *
 * El usuario lo pidió explícito: la app no solo arma el combo, dice el
 * porqué — es la diferencia entre "confía en el algoritmo" y "esto tiene
 * sentido".
 */
export function porqueDeCombo(primero: BloqueDia, segundo: BloqueDia): string {
  if (segundo.discipline === "NATACION") {
    return `${capitaliza(NOMBRES_DISCIPLINA[primero.discipline])} primero, y cierras con la alberca para soltar: la natación es la que menos sufre por llegar con fatiga.`;
  }

  if (primero.discipline === "SQUASH" || primero.discipline === "BOX") {
    return `${capitaliza(NOMBRES_DISCIPLINA[primero.discipline])} primero, con las piernas frescas: la habilidad y el impacto no aguantan llegar cansado, y tu sesión de pesas de hoy sí aguanta llegar después.`;
  }

  if (primero.discipline === "PESAS" && segundo.discipline === "CARDIO") {
    return "Pesas primero: si la fuerza es el objetivo, la calidad del levantamiento manda y el cardio no pierde nada por ir después.";
  }

  return `Va ${NOMBRES_DISCIPLINA[primero.discipline].toLowerCase()} antes que ${NOMBRES_DISCIPLINA[segundo.discipline].toLowerCase()} para que ninguno de los dos se sienta a medias.`;
}

function capitaliza(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * El aviso de riesgo de una combinación pierna + alto impacto que solo existe
 * porque la persona la pidió explícita (`compatibilidad(..., { explicita:
 * true })`). `null` cuando el par no es ese caso — así quien llama no tiene
 * que repetir la condición para saber si debe mostrarlo.
 */
export function avisoDeRiesgo(a: BloqueDia, b: BloqueDia): string | null {
  const pierna = esDiaDePierna(a) ? a : esDiaDePierna(b) ? b : null;
  if (!pierna) return null;

  const otra = pierna === a ? b : a;
  if (!ALTO_IMPACTO.includes(otra.discipline)) return null;

  return `Pierna pesada y ${NOMBRES_DISCIPLINA[otra.discipline].toLowerCase()} el mismo día: baja el rendimiento y sube el riesgo de lesión.`;
}
