import type { GoalZone, GoalZoneReading } from "@/lib/coachy/goal";

/**
 * El check-in mensual, como concepto del servidor.
 *
 * Hasta aquí "mensual" solo vivía en el teléfono: la pantalla del check-in
 * abría brazos y piernas si ya había pasado un mes desde la última vez. El
 * servidor no sabía nada, así que no podía hacer lo que un mes sí amerita:
 * comparar contra el mes anterior, pedir la lectura de fotos contra la
 * referencia sin esperar su quincena, refrescar el menú y decirle a la
 * persona cuánto falta para el siguiente.
 *
 * ## La regla
 *
 * Un check-in es mensual cuando **trae brazos o piernas**, o cuando **pasaron
 * 28 días desde el último mensual**. El primero de la serie (el punto cero) es
 * el ancla: desde él se cuenta, aunque no sea mensual si no trajo medidas.
 * Registrar un mensual reinicia el contador — por eso el ancla se recalcula
 * recorriendo la serie y no se guarda en ninguna columna: con la misma serie
 * sale siempre la misma respuesta.
 *
 * Todo aquí es puro: fechas ISO y números. La lectura de la base y la
 * llamada de visión viven en `index.ts`.
 */

export const DIAS_MENSUAL = 28;

/** Lo que el mensual necesita de un check-in, ya sin `Decimal` ni `Date`. */
export interface MedidaCheckIn {
  id: string;
  /** `yyyy-MM-dd`. */
  fecha: string;
  cinturaCm: number | null;
  pesoKg: number | null;
  brazoIzqCm: number | null;
  brazoDerCm: number | null;
  piernaIzqCm: number | null;
  piernaDerCm: number | null;
}

export const METRICAS_MENSUALES = [
  "cintura",
  "peso",
  "brazoIzq",
  "brazoDer",
  "piernaIzq",
  "piernaDer",
] as const;
export type MetricaMensual = (typeof METRICAS_MENSUALES)[number];

const CAMPO: Record<MetricaMensual, keyof MedidaCheckIn> = {
  cintura: "cinturaCm",
  peso: "pesoKg",
  brazoIzq: "brazoIzqCm",
  brazoDer: "brazoDerCm",
  piernaIzq: "piernaIzqCm",
  piernaDer: "piernaDerCm",
};

export interface DeltaMensual {
  actual: number | null;
  vsMesAnterior: number | null;
  vsInicio: number | null;
}

export type DeltasMensuales = Record<MetricaMensual, DeltaMensual>;

export interface FotosMensuales {
  /** El estado de "Rumbo a tu objetivo" al momento del check-in. */
  estado: "listo" | "sin_referencia" | "sin_fotos" | "en_espera";
  zonas: GoalZoneReading[];
}

export interface ObjetivoDelMes {
  vaBien: string[];
  ajustar: string[];
}

/** El bloque que viaja en `Decision.replyJson.mensual`. */
export interface BloqueMensual {
  esMensual: boolean;
  previoMensualId: string | null;
  deltas: DeltasMensuales;
  /** `null` cuando no es mensual o no hubo cómo pedir la lectura. */
  fotos: FotosMensuales | null;
  objetivo: ObjetivoDelMes;
}

export interface ProximoMensual {
  /** Semanas completas que faltan, redondeando hacia arriba. `0` = ya toca. */
  semanas: number;
  /** `yyyy-MM-dd` en que se cumplen los 28 días. */
  fecha: string;
  /** Fecha del último mensual (o del ancla). */
  ultimoMensual: string;
}

// ---------------------------------------------------------------------------
// Fechas y números
// ---------------------------------------------------------------------------

const DIA_MS = 86_400_000;

function aMediodia(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T12:00:00.000Z`);
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((aMediodia(hasta) - aMediodia(desde)) / DIA_MS);
}

function sumaDias(iso: string, dias: number): string {
  return new Date(aMediodia(iso) + dias * DIA_MS).toISOString().slice(0, 10);
}

/** Un decimal, alejándose del cero en el .5, y sin `-0`. */
function redondea1(valor: number): number {
  return (Math.sign(valor) * Math.round(Math.abs(valor) * 10)) / 10 + 0;
}

function ordenada(serie: readonly MedidaCheckIn[]): MedidaCheckIn[] {
  return [...serie].sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// ---------------------------------------------------------------------------
// La regla
// ---------------------------------------------------------------------------

export function traeMedidasMensuales(checkIn: MedidaCheckIn): boolean {
  return (
    checkIn.brazoIzqCm !== null ||
    checkIn.brazoDerCm !== null ||
    checkIn.piernaIzqCm !== null ||
    checkIn.piernaDerCm !== null
  );
}

/**
 * `id → esMensual` para toda la serie, recorriéndola en orden.
 *
 * El primero es el ancla del contador y cuenta como mensual solo si trajo
 * medidas; los demás, por la regla de arriba.
 */
export function clasificaMensuales(serie: readonly MedidaCheckIn[]): Map<string, boolean> {
  const resultado = new Map<string, boolean>();
  let ancla: string | null = null;

  for (const checkIn of ordenada(serie)) {
    if (ancla === null) {
      resultado.set(checkIn.id, traeMedidasMensuales(checkIn));
      ancla = checkIn.fecha;
      continue;
    }

    const esMensual =
      traeMedidasMensuales(checkIn) || diasEntre(ancla, checkIn.fecha) >= DIAS_MENSUAL;
    resultado.set(checkIn.id, esMensual);
    if (esMensual) ancla = checkIn.fecha;
  }

  return resultado;
}

/** Los check-ins que reinician el contador: el ancla inicial y cada mensual. */
function anclas(serie: readonly MedidaCheckIn[]): MedidaCheckIn[] {
  const orden = ordenada(serie);
  const mapa = clasificaMensuales(orden);
  return orden.filter((checkIn, index) => index === 0 || mapa.get(checkIn.id) === true);
}

/** El mensual (o el ancla) inmediatamente anterior a `checkInId`. */
export function ultimoMensualAntesDe(
  serie: readonly MedidaCheckIn[],
  checkInId: string,
): MedidaCheckIn | null {
  const actual = serie.find((checkIn) => checkIn.id === checkInId);
  if (!actual) return null;

  const previas = anclas(serie).filter((checkIn) => checkIn.fecha < actual.fecha);
  return previas[previas.length - 1] ?? null;
}

// ---------------------------------------------------------------------------
// Deltas
// ---------------------------------------------------------------------------

function valorDe(checkIn: MedidaCheckIn, metrica: MetricaMensual): number | null {
  const valor = checkIn[CAMPO[metrica]];
  return typeof valor === "number" ? valor : null;
}

/**
 * Deltas de cada medida contra el mensual anterior y contra el inicio.
 *
 * Si el mensual anterior no midió esa zona (fue mensual por días, no por
 * medidas), se usa la última medida de esa zona hasta ese día: comparar contra
 * "nada" borraría justo el dato que el mes quería leer. El inicio es la
 * primera medida de esa zona en la serie.
 */
export function deltasMensuales(
  serie: readonly MedidaCheckIn[],
  checkInId: string,
): DeltasMensuales {
  const orden = ordenada(serie);
  const actual = orden.find((checkIn) => checkIn.id === checkInId) ?? null;
  const previo = actual ? ultimoMensualAntesDe(orden, checkInId) : null;

  const deltas = {} as DeltasMensuales;

  for (const metrica of METRICAS_MENSUALES) {
    const valorActual = actual ? valorDe(actual, metrica) : null;
    if (actual === null || valorActual === null) {
      deltas[metrica] = { actual: null, vsMesAnterior: null, vsInicio: null };
      continue;
    }

    const anteriores = orden.filter((checkIn) => checkIn.fecha < actual.fecha);
    const hastaPrevio = previo ? anteriores.filter((checkIn) => checkIn.fecha <= previo.fecha) : [];

    const delMesAnterior =
      [...hastaPrevio].reverse().map((checkIn) => valorDe(checkIn, metrica)).find((v) => v !== null) ??
      null;
    const delInicio = anteriores.map((checkIn) => valorDe(checkIn, metrica)).find((v) => v !== null) ?? null;

    deltas[metrica] = {
      actual: valorActual,
      vsMesAnterior: delMesAnterior === null ? null : redondea1(valorActual - delMesAnterior),
      vsInicio: delInicio === null ? null : redondea1(valorActual - delInicio),
    };
  }

  return deltas;
}

function promedio(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return redondea1((a + b) / 2);
}

// ---------------------------------------------------------------------------
// Qué va bien y qué hay que ajustar
// ---------------------------------------------------------------------------

/** Las zonas en español, sin tocar `goal.ts` (que no es puro). */
const ZONA: Record<GoalZone, string> = {
  cintura: "Cintura",
  cadera_gluteo: "Cadera y glúteo",
  pierna: "Pierna",
  brazo: "Brazo",
  espalda: "Espalda",
};

export interface ValoraAvanceInput {
  periodo: "semana" | "mes";
  cinturaDelta: number | null;
  pesoDelta: number | null;
  /** Promedio de los dos brazos contra el periodo anterior. */
  brazosDelta: number | null;
  piernasDelta: number | null;
  fotos: readonly GoalZoneReading[];
  cumplimientoDieta: number;
  cumplimientoEntreno: number;
  /** `Profile.goal`. */
  goal: string;
}

const MAX_RENGLONES = 4;
/** Menos de medio centímetro es ruido de cinta, no cambio. */
const UMBRAL_CM = 0.5;

function cm(valor: number): string {
  return `${Math.abs(valor).toLocaleString("es-MX", { maximumFractionDigits: 1 })} cm`;
}

/**
 * Lo que va bien y lo que hay que ajustar, escrito por nosotros.
 *
 * Es la versión determinista de la retro: la usa el texto sin Claude y la
 * recibe Claude como material. Sin juicios sobre el cuerpo — solo medidas,
 * tendencia de fotos por zona y cumplimiento — y sin regaños: lo que no va
 * bien se dice como algo que se ajusta.
 */
export function valoraAvance(input: ValoraAvanceInput): ObjetivoDelMes {
  const vaBien: string[] = [];
  const ajustar: string[] = [];
  const periodo = input.periodo === "mes" ? "el mes" : "la semana";
  const buscaBajar = input.goal === "PERDIDA_GRASA" || input.goal === "RECOMPOSICION";
  const buscaMusculo = input.goal === "GANANCIA_MUSCULO" || input.goal === "RECOMPOSICION";

  const cintura = input.cinturaDelta;
  if (cintura !== null && cintura <= -UMBRAL_CM) {
    vaBien.push(`Cintura: ${cm(cintura)} menos en ${periodo}.`);
    if (input.pesoDelta !== null && Math.abs(input.pesoDelta) < UMBRAL_CM) {
      vaBien.push("Bajó la cintura sin que se moviera la báscula: eso es recomposición.");
    }
  } else if (cintura !== null && cintura >= UMBRAL_CM) {
    ajustar.push(`Cintura: ${cm(cintura)} más en ${periodo}; revisamos porciones, sal y descanso.`);
  } else if (cintura !== null && buscaBajar && input.periodo === "mes") {
    ajustar.push("La cintura se quedó igual este mes: el plan se mueve para destrabarla.");
  }

  if (buscaMusculo) {
    if (input.brazosDelta !== null && input.brazosDelta >= 0.3) {
      vaBien.push(`Brazos: ${cm(input.brazosDelta)} más en ${periodo}.`);
    }
    if (input.piernasDelta !== null && input.piernasDelta >= 0.3) {
      vaBien.push(`Piernas: ${cm(input.piernasDelta)} más en ${periodo}.`);
    }
  }

  for (const lectura of input.fotos) {
    if (lectura.tendencia === "acercándose") {
      vaBien.push(`${ZONA[lectura.zona]} se está acercando a tu referencia.`);
    } else if (lectura.tendencia === "alejándose") {
      ajustar.push(`${ZONA[lectura.zona]} se movió en sentido contrario: la rutina le da prioridad.`);
    } else if (lectura.brecha === "lejos") {
      ajustar.push(`${ZONA[lectura.zona]} sigue lejos de tu referencia: la rutina le da prioridad.`);
    }
  }

  if (input.cumplimientoDieta >= 85) {
    vaBien.push(`Dieta al ${input.cumplimientoDieta} %: la constancia está.`);
  } else if (input.cumplimientoDieta < 70) {
    ajustar.push(`Dieta al ${input.cumplimientoDieta} %: buscamos el menú que sí te quede.`);
  }

  if (input.cumplimientoEntreno >= 85) {
    vaBien.push(`Entreno al ${input.cumplimientoEntreno} %.`);
  } else if (input.cumplimientoEntreno < 70) {
    ajustar.push(`Entreno al ${input.cumplimientoEntreno} %: acomodamos la semana a tu tiempo real.`);
  }

  if (vaBien.length === 0) vaBien.push(`Cerraste ${periodo} con tu check-in: eso ya es constancia.`);

  return { vaBien: vaBien.slice(0, MAX_RENGLONES), ajustar: ajustar.slice(0, MAX_RENGLONES) };
}

// ---------------------------------------------------------------------------
// El bloque
// ---------------------------------------------------------------------------

export interface BloqueMensualInput {
  serie: readonly MedidaCheckIn[];
  checkInId: string;
  fotos: FotosMensuales | null;
  cumplimientoDieta: number;
  cumplimientoEntreno: number;
  goal: string;
}

export function construyeBloqueMensual(input: BloqueMensualInput): BloqueMensual {
  const esMensual = clasificaMensuales(input.serie).get(input.checkInId) ?? false;
  const previo = ultimoMensualAntesDe(input.serie, input.checkInId);
  const deltas = deltasMensuales(input.serie, input.checkInId);
  const fotos = esMensual ? input.fotos : null;

  return {
    esMensual,
    previoMensualId: previo?.id ?? null,
    deltas,
    fotos,
    objetivo: valoraAvance({
      periodo: esMensual ? "mes" : "semana",
      cinturaDelta: deltas.cintura.vsMesAnterior,
      pesoDelta: deltas.peso.vsMesAnterior,
      brazosDelta: promedio(deltas.brazoIzq.vsMesAnterior, deltas.brazoDer.vsMesAnterior),
      piernasDelta: promedio(deltas.piernaIzq.vsMesAnterior, deltas.piernaDer.vsMesAnterior),
      fotos: fotos?.zonas ?? [],
      cumplimientoDieta: input.cumplimientoDieta,
      cumplimientoEntreno: input.cumplimientoEntreno,
      goal: input.goal,
    }),
  };
}

/**
 * Cuánto falta para el siguiente mensual, contado desde el último.
 *
 * Es el contador de Hoy: se reinicia solo cuando se registra el mensual
 * (sea por medidas o por días), nunca por abrir la app.
 */
export function proximoMensual(
  serie: readonly MedidaCheckIn[],
  hoyISO: string,
): ProximoMensual | null {
  const ultima = anclas(serie).at(-1);
  if (!ultima) return null;

  const fecha = sumaDias(ultima.fecha, DIAS_MENSUAL);
  const faltan = diasEntre(hoyISO, fecha);

  return {
    semanas: faltan <= 0 ? 0 : Math.ceil(faltan / 7),
    fecha,
    ultimoMensual: ultima.fecha,
  };
}
