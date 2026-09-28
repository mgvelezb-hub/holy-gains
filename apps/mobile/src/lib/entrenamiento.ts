/**
 * Los textos de las preferencias de entrenamiento — lógica PURA.
 *
 * Describen lo que el generador ya hace con cada preferencia. Si una
 * preferencia no cambia la planeación, no tiene por qué estar aquí: el ajuste
 * que solo se guarda es el que enseña a no confiar en los ajustes.
 */

import {
  DISCIPLINE_LABELS,
  type Discipline,
  type MuscleGroup,
  type OtherSessionView,
  type SwimLevel,
} from "@/lib/api";

/** El nombre de cada grupo en el vocabulario de la app. */
export const GRUPOS: Array<{ valor: MuscleGroup; nombre: string }> = [
  { valor: "PIERNA", nombre: "Pierna y glúteo" },
  { valor: "HOMBRO", nombre: "Hombro" },
  { valor: "PECHO", nombre: "Pecho" },
  { valor: "ESPALDA", nombre: "Espalda" },
  { valor: "BICEP", nombre: "Bíceps" },
  { valor: "TRICEP", nombre: "Tríceps" },
  { valor: "ABDOMEN", nombre: "Core y abdomen" },
];

/**
 * Las disciplinas que la app registra.
 *
 * `planeada` distingue lo que el generador sabe prescribir de lo que hoy solo
 * cuenta sesiones. Es la diferencia que la pantalla tiene que decir en voz
 * alta: agregar natación cambia cuántos días de gimnasio te tocan, pero
 * todavía no te arma la sesión de alberca.
 */
export const DISCIPLINAS: Array<{ valor: Discipline; nombre: string; planeada: boolean }> = [
  // El orden es el de la secuencia acordada: natación primero, porque es la
  // que menos interfiere con la fuerza.
  "PESAS",
  "NATACION",
  "FUNCIONAL",
  "CROSSFIT",
  "BOX",
  "SQUASH",
  "CARDIO",
  "GOLF",
  "OTRO",
].map((valor) => ({
  valor: valor as Discipline,
  nombre: DISCIPLINE_LABELS[valor as Discipline],
  // GOLF sí tiene su propia pantalla de registro (`app/golf.tsx`) con
  // agregados propios (score vs par, GIR%, balance de práctica), aunque el
  // generador semanal no le arme sesión — por eso cuenta como "planeada"
  // igual que PESAS, a diferencia de las demás secundarias que solo
  // reservan el día.
  planeada: valor === "PESAS" || valor === "GOLF",
}));

/** Topes de tiempo de cocina que se ofrecen, más "sin tope". */
/**
 * Cuánto tiempo hay para cocinar, en frases y no en minutos.
 *
 * "10 min" invita a una cuenta que no se sostiene: el arroz tarda 35 y aun así
 * cabe en una semana con prisa, porque se hace el domingo y entre semana se
 * calienta. Un número exacto obliga a decidir sobre el tiempo de la olla; una
 * frase describe la semana, que es lo que la persona sí sabe.
 *
 * Los minutos siguen existiendo por debajo —el motor filtra con ellos— y se
 * miden el día que se come, no el día que se cocina.
 */
export const TIEMPOS_COCINA: Array<{
  valor: number | null;
  nombre: string;
  detalle: string;
}> = [
  {
    valor: 10,
    nombre: "Poco tiempo",
    detalle: "Calentar y servir. Lo que tarda se cocina antes y se guarda en porciones.",
  },
  {
    valor: 20,
    nombre: "Algo de tiempo",
    detalle: "Alcanza para cocinar algo sencillo en el momento.",
  },
  {
    valor: null,
    nombre: "Sin restricción",
    detalle: "Cocinas cuando toca, sin pensar en el reloj.",
  },
];

/**
 * Cuántas sesiones de la semana se van en las otras disciplinas.
 *
 * Es la misma cuenta que hace el servidor (`sessionsSpentOutsideGym`), aquí
 * para poder enseñar el resultado antes de guardar: si el número no se ve, la
 * regla de "no se suma encima" parece un castigo en vez de un presupuesto.
 */
export function sesionesFueraDelGimnasio(
  cargas: Array<{ sessionsPerWeek: number }>,
): number {
  return cargas.reduce((total, carga) => total + Math.max(0, carga.sessionsPerWeek), 0);
}

/** Días de gimnasio que quedan tras pagar las otras disciplinas. */
export function diasDeGimnasio(
  presupuesto: number,
  cargas: Array<{ sessionsPerWeek: number }>,
  primaria: Discipline,
): number {
  if (presupuesto <= 0) return 0;
  const piso = primaria === "PESAS" ? 1 : 0;
  return Math.max(piso, presupuesto - sesionesFueraDelGimnasio(cargas));
}

/** Lista escrita a mano ("pollo, avena") a arreglo normalizado. */
export function listaDeAlimentos(texto: string): string[] {
  return Array.from(
    new Set(
      texto
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ).slice(0, 30);
}

/**
 * Los niveles de natación con lo que cambia cada uno.
 *
 * Se declaran, no se infieren: el historial del reloj dice cuánto nadaste, no
 * si sabes nadar. Prescribir series fuertes a quien todavía no cruza la
 * alberca es la peor manera de estrenar una disciplina.
 */
export const NIVELES_NATACION: Array<{ valor: SwimLevel; nombre: string; detalle: string }> = [
  {
    valor: "PRINCIPIANTE",
    nombre: "Principiante",
    detalle: "Todavía no nadas de corrido. Técnica, tabla y descansos largos.",
  },
  {
    valor: "INTERMEDIO",
    nombre: "Intermedio",
    detalle: "Nadas 400-800 m sin parar. Series de resistencia y de velocidad.",
  },
  {
    valor: "AVANZADO",
    nombre: "Avanzado",
    detalle: "Más de 1500 m por sesión. Más volumen y menos descanso.",
  },
];

/**
 * Los niveles de cada disciplina, con qué significa cada uno.
 *
 * Es el espejo de lo que declara cada prescriptor en el servidor
 * (`apps/web/src/lib/training/disciplinas/`). Vive aquí para que Ajustes
 * pueda explicarlos sin pedir una llamada más, y se declara —no se infiere—:
 * el reloj sabe cuánto duró tu sesión, no si sabes caer de una caja.
 */
export const NIVELES_POR_DISCIPLINA: Partial<
  Record<Discipline, Array<{ valor: SwimLevel; nombre: string; detalle: string }>>
> = {
  PESAS: [
    {
      valor: "PRINCIPIANTE",
      nombre: "Principiante",
      detalle: "Menos de seis meses entrenando. Máquinas, mancuernas y patrones básicos.",
    },
    {
      valor: "INTERMEDIO",
      nombre: "Intermedio",
      detalle: "Dominas sentadilla, peso muerto y press. Entran las variantes con barra libre.",
    },
    {
      valor: "AVANZADO",
      nombre: "Avanzado",
      detalle: "Años entrenando y técnica sólida. Entran frontal, dominadas, fondos y trasnuca.",
    },
  ],
  NATACION: [
    { valor: "PRINCIPIANTE", nombre: "Principiante", detalle: "Todavía no nadas de corrido. Técnica, tabla y descansos largos." },
    { valor: "INTERMEDIO", nombre: "Intermedio", detalle: "Nadas 400-800 m sin parar. Series de resistencia y de velocidad." },
    { valor: "AVANZADO", nombre: "Avanzado", detalle: "Más de 1500 m por sesión. Más volumen y menos descanso." },
  ],
  SQUASH: [
    { valor: "PRINCIPIANTE", nombre: "Principiante", detalle: "Peloteas pero el punto se te va pronto. Desplazamiento y drive." },
    { valor: "INTERMEDIO", nombre: "Intermedio", detalle: "Juegas partidos completos. Patrones de dos y precisión." },
    { valor: "AVANZADO", nombre: "Avanzado", detalle: "Compites o juegas liga. Fantasmas y condicionados con presión." },
  ],
  BOX: [
    { valor: "PRINCIPIANTE", nombre: "Principiante", detalle: "Empiezas. Guardia, desplazamiento, jab y directo al saco." },
    { valor: "INTERMEDIO", nombre: "Intermedio", detalle: "Tienes combinaciones y aguantas asaltos. Sombra y saco técnico." },
    { valor: "AVANZADO", nombre: "Avanzado", detalle: "Entrenas seguido. Más asaltos y trabajo por intervalos." },
  ],
  FUNCIONAL: [
    { valor: "PRINCIPIANTE", nombre: "Principiante", detalle: "Empiezas con el equipo. Wall ball, trineo ligero y acarreos cortos." },
    { valor: "INTERMEDIO", nombre: "Intermedio", detalle: "Dominas las estaciones. Trineo, saco y SkiErg por tiempo." },
    { valor: "AVANZADO", nombre: "Avanzado", detalle: "Formato de carrera funcional: más rondas, menos descanso y carga alta." },
  ],
  CARDIO: [
    { valor: "PRINCIPIANTE", nombre: "Principiante", detalle: "Todavía no corres 10 min seguidos. Alternas correr y caminar." },
    { valor: "INTERMEDIO", nombre: "Intermedio", detalle: "Corres 30-40 min seguidos. Rodajes y series." },
    { valor: "AVANZADO", nombre: "Avanzado", detalle: "Corres varias veces por semana. Más volumen e intervalos." },
  ],
  CROSSFIT: [
    { valor: "PRINCIPIANTE", nombre: "Principiante", detalle: "Primeros meses. Peso corporal, progresiones y nada de olímpicos." },
    { valor: "INTERMEDIO", nombre: "Intermedio", detalle: "Escalas los WOD. Barra ligera y metcons completos." },
    { valor: "AVANZADO", nombre: "Avanzado", detalle: "WOD prescrito. Más rondas y más carga." },
  ],
  // GOLF no tiene prescriptor de sesión (no hay circuito que armar), así que
  // estos niveles no cambian ninguna prescripción — se declaran igual que
  // las demás para que Ajustes pueda mostrarlos, con los mismos tres
  // escalones genéricos que ya usa el resto.
  GOLF: [
    { valor: "PRINCIPIANTE", nombre: "Principiante", detalle: "Empiezas o juegas poco. Todavía no llevas la cuenta de tus estadísticas." },
    { valor: "INTERMEDIO", nombre: "Intermedio", detalle: "Juegas seguido y rompes 100 con cierta regularidad." },
    { valor: "AVANZADO", nombre: "Avanzado", detalle: "Compites o llevas hándicap bajo. Rompes 90 casi siempre." },
  ],
};

/**
 * Cuánta sesión hay hoy, en frases y no en minutos.
 *
 * Pedir minutos exactos suena preciso y no lo es: en un gimnasio real hay que
 * relevar en una banca, la máquina está ocupada, alguien te saluda. Nadie sabe
 * si le quedan 25 o 40 minutos, pero todo el mundo sabe si trae prisa.
 *
 * Los minutos siguen por debajo —el generador arma la sesión con ellos— y son
 * lo que cada frase significa. Lo que se elimina es la falsa precisión.
 */
export const RECORTES: Array<{ minutos: number; nombre: string; detalle: string }> = [
  { minutos: 20, nombre: "Poco tiempo", detalle: "Lo esencial: los compuestos y ya" },
  { minutos: 30, nombre: "Con prisa", detalle: "Casi todo, sin los accesorios" },
  { minutos: 45, nombre: "Casi completa", detalle: "Solo se suelta lo último" },
];

/** Cómo se llama el recorte guardado. `null` = la rutina como venía. */
export function nombreDelRecorte(minutos: number | null): string {
  if (minutos === null) return "Rutina completa";
  return RECORTES.find((opcion) => opcion.minutos === minutos)?.nombre ?? "Recortada";
}

// ---------------------------------------------------------------------------
// Días combinados (Fase 7) — orden de los bloques de un día con hasta dos
// compromisos: gym + disciplina, o disciplina + disciplina.
// ---------------------------------------------------------------------------

/** Un bloque del día, ya resuelto a su tipo: el de pesas o el de otra disciplina. */
export type BloqueDelDia<T> = { tipo: "gym"; data: T } | { tipo: "otra"; data: OtherSessionView };

/**
 * Ordena los bloques de un día combinado.
 *
 * El servidor declara `orden` SOLO en las sesiones de otra disciplina — el
 * gimnasio nunca compite consigo mismo por un lugar en el día. Cuando el día
 * combina gym + una disciplina, el gym ocupa la posición que la otra NO usa:
 * si la otra es `orden: 2` ("la alberca al final para soltar"), el gym va
 * primero; si es `orden: 1` ("squash primero, con piernas frescas"), el gym
 * va después. Con dos disciplinas y sin gym, se ordena solo por `orden`.
 *
 * `T` es genérico porque quien llama trae su propio tipo de sesión de
 * gimnasio (`SessionView` en el detalle del día, `TodayCard` en "Hoy").
 */
export function ordenarBloquesDelDia<T>(
  gym: T | null,
  otras: OtherSessionView[],
): Array<BloqueDelDia<T>> {
  if (!gym) {
    return [...otras]
      .sort((a, b) => (a.orden ?? 2) - (b.orden ?? 2))
      .map((data) => ({ tipo: "otra" as const, data }));
  }
  if (otras.length === 0) return [{ tipo: "gym", data: gym }];

  // El gym solo comparte el día con UNA otra disciplina: dos disciplinas más
  // gym en el mismo día no existe en el modelo actual.
  const otra = otras[0]!;
  const gymBloque: BloqueDelDia<T> = { tipo: "gym", data: gym };
  const otraBloque: BloqueDelDia<T> = { tipo: "otra", data: otra };
  return (otra.orden ?? 2) === 1 ? [otraBloque, gymBloque] : [gymBloque, otraBloque];
}

/** El nombre de un bloque: el grupo muscular si es gym, la disciplina si no. */
export function etiquetaBloque<T extends { muscleGroup: string }>(bloque: BloqueDelDia<T>): string {
  return bloque.tipo === "gym" ? bloque.data.muscleGroup : DISCIPLINE_LABELS[bloque.data.discipline];
}

/** "Squash → Natación" — los bloques del día, ya en su orden, unidos por flecha. */
export function etiquetaDelDia<T extends { muscleGroup: string }>(
  bloques: Array<BloqueDelDia<T>>,
): string {
  return bloques.map(etiquetaBloque).join(" → ");
}

/**
 * La línea de un día para "Mi semana" y el detalle del día.
 *
 * Gym + cardio después de pesas (H2) se lee con sus minutos, que es lo que
 * Mau quiere ver de un vistazo: "Gym · 70 min + Cardio HIIT caminadora · 20
 * min". Cualquier otro día es la etiqueta de siempre ("Squash → Natación").
 */
export function lineaDelDia<T extends { muscleGroup: string }>(bloques: Array<BloqueDelDia<T>>): string {
  const gym = bloques.find((bloque) => bloque.tipo === "gym");
  const cardio = bloques.find(
    (bloque): bloque is { tipo: "otra"; data: OtherSessionView } =>
      bloque.tipo === "otra" && bloque.data.discipline === "CARDIO" && bloque.data.sesion?.cardio !== undefined,
  );
  if (!gym || !cardio) return etiquetaDelDia(bloques);

  const gymTexto = cardio.data.gymMinutes !== undefined ? `Gym · ${cardio.data.gymMinutes} min` : "Gym";
  return `${gymTexto} + ${textoCardio(cardio.data)}`;
}

/** "Cardio HIIT caminadora · 20 min" — el bloque de cardio en una línea. */
export function textoCardio(otra: OtherSessionView): string {
  const etiqueta = otra.sesion?.cardio?.etiqueta ?? DISCIPLINE_LABELS[otra.discipline];
  return `${etiqueta} · ${otra.minutes} min`;
}

