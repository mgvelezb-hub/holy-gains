import type {
  Activity,
  ActivityPayload,
  DetalleCardio,
  DisciplineLoad,
  EquipoCardio,
  NivelCardio,
  PreferenciasCardio,
  TipoCardio,
  OtherSessionView,
  SessionView,
  UnidadVelocidad,
  WarmupStep,
} from "@/lib/api";
import { pasosDeProtocolo, protocoloDe, tituloProtocolo, unidadDe } from "@/lib/hiit";

/**
 * El cardio de después de pesas en la sesión en vivo (H2) — lógica pura.
 *
 * Al cerrar la última serie aparece su tarjeta; al empezarlo, el timer es el
 * MISMO del calentamiento dinámico (pasos con su hora de término), así que
 * aquí solo se traduce la prescripción a esos pasos. Al terminar se registra
 * como sesión de disciplina del día; si el reloj también la grabó, el
 * servidor las enlaza (`buscaGemela` en la web).
 */

const EQUIPO: Record<EquipoCardio, string> = {
  CAMINADORA: "caminadora",
  ESCALERA: "escalera",
  BICI: "bici",
  ELIPTICA: "elíptica",
  LIBRE: "libre",
};

function nivel(detalle: DetalleCardio, valor: number): string {
  return detalle.equipo === "LIBRE" ? "" : ` · nivel ${valor}`;
}

/** "Cardio · 20 min · caminadora HIIT nivel 8". */
export function tituloTarjetaCardio(detalle: DetalleCardio, minutos: number): string {
  // N1: la caminadora HIIT se dice por su protocolo, no por "nivel de máquina".
  const protocolo = protocoloDe(detalle);
  if (protocolo) {
    const caminata = protocolo.caminataMin > 0 ? ` + ${protocolo.caminataMin} min caminando` : "";
    return `Cardio · ${minutos} min · ${tituloProtocolo(protocolo)}${caminata}`;
  }
  const tipo = detalle.tipo === "HIIT" ? "HIIT" : "continuo";
  const como =
    detalle.equipo === "LIBRE" ? tipo : `${EQUIPO[detalle.equipo]} ${tipo} nivel ${detalle.nivelMaquina}`;
  return `Cardio · ${minutos} min · ${como}`;
}

/** Los pasos que corre el timer: calentamiento, el bloque principal, enfriamiento. */
export function pasosDeCardio(detalle: DetalleCardio, minutos: number, unidad?: UnidadVelocidad): WarmupStep[] {
  // N1: con protocolo, cada tramo es un paso ("10–12 km/h · Moderado Alto").
  const protocolo = protocoloDe(detalle);
  if (protocolo) return pasosDeProtocolo(protocolo, unidad ?? unidadDe(detalle));

  const suave = detalle.intervalos?.nivelSuave ?? Math.max(1, detalle.nivelMaquina - 2);
  const pasos: WarmupStep[] = [
    { nombre: `Calentamiento${nivel(detalle, suave)}`, segundos: detalle.calentamientoSeg },
  ];

  if (detalle.intervalos) {
    const { rondas, fuerteSeg, suaveSeg, nivelFuerte, nivelSuave } = detalle.intervalos;
    for (let ronda = 1; ronda <= rondas; ronda += 1) {
      pasos.push({ nombre: `Fuerte${nivel(detalle, nivelFuerte)} · ronda ${ronda} de ${rondas}`, segundos: fuerteSeg });
      pasos.push({ nombre: `Suave${nivel(detalle, nivelSuave)} · ronda ${ronda} de ${rondas}`, segundos: suaveSeg });
    }
  } else {
    const principal = Math.max(60, minutos * 60 - detalle.calentamientoSeg - detalle.enfriamientoSeg);
    pasos.push({ nombre: `Zona 2${nivel(detalle, detalle.nivelMaquina)}`, segundos: principal });
  }

  pasos.push({ nombre: "Enfriamiento", segundos: detalle.enfriamientoSeg });
  return pasos;
}

/** Lo que queda en las notas de la sesión: tipo, máquina y nivel. */
export function notasDeCardio(detalle: DetalleCardio): string {
  const protocolo = protocoloDe(detalle);
  if (protocolo) return `${tituloProtocolo(protocolo)} · caminadora`;
  const tipo = detalle.tipo === "HIIT" ? "HIIT" : "Continuo";
  return detalle.equipo === "LIBRE"
    ? tipo
    : `${tipo} · ${EQUIPO[detalle.equipo]} · nivel ${detalle.nivelMaquina}`;
}

/** La sesión de CARDIO del día, con la hora real de inicio y fin. */
export function actividadDeCardio(
  detalle: DetalleCardio,
  fecha: string,
  inicio: Date,
  fin: Date,
  /** N2: con pausas, los minutos corridos de verdad (sin lo pausado). */
  activoMs?: number,
): ActivityPayload {
  const totalMs = activoMs ?? fin.getTime() - inicio.getTime();
  return {
    discipline: "CARDIO",
    source: "APP",
    externalId: null,
    startedAt: inicio.toISOString(),
    endedAt: fin.toISOString(),
    date: fecha,
    durationMin: Math.max(1, Math.round(totalMs / 60_000)),
    notes: notasDeCardio(detalle),
  };
}

/** Los defaults del motor (`DEFAULTS_CARDIO` en disciplinas/cardio.ts de la web). */
export const CARDIO_POR_DEFECTO: Required<PreferenciasCardio> = {
  equipo: "CAMINADORA",
  tipo: "HIIT",
  nivel: "BASICO",
  minutos: 20,
};

export const OPCIONES_EQUIPO: Array<{ valor: EquipoCardio; nombre: string }> = [
  { valor: "CAMINADORA", nombre: "Caminadora" },
  { valor: "ESCALERA", nombre: "Escalera" },
  { valor: "BICI", nombre: "Bici" },
  { valor: "ELIPTICA", nombre: "Elíptica" },
  { valor: "LIBRE", nombre: "Libre" },
];

export const OPCIONES_TIPO: Array<{ valor: TipoCardio; nombre: string }> = [
  { valor: "HIIT", nombre: "HIIT" },
  { valor: "CONTINUO", nombre: "Continuo" },
];

export const OPCIONES_NIVEL: Array<{ valor: NivelCardio; nombre: string }> = [
  { valor: "BASICO", nombre: "Básico" },
  { valor: "MEDIO", nombre: "Medio" },
  { valor: "AVANZADO", nombre: "Avanzado" },
];

/** "Cardio · 5/semana · después de pesas · HIIT caminadora 20 min". */
export function renglonDeCardio(
  carga: DisciplineLoad & { modo?: "DESPUES" | "DIA_PROPIO"; cardio?: PreferenciasCardio },
): string {
  const prefs = { ...CARDIO_POR_DEFECTO, ...carga.cardio };
  const tipo = prefs.tipo === "HIIT" ? "HIIT" : "continuo";
  const como = prefs.equipo === "LIBRE" ? tipo : `${tipo} ${EQUIPO[prefs.equipo]}`;
  const modo = carga.modo === "DESPUES" ? "después de pesas" : "día propio";
  return `Cardio · ${carga.sessionsPerWeek}/semana · ${modo} · ${como} ${prefs.minutos} min`;
}


/* ------------------------------------------------------------------------ */
/* N2 — el cardio como sesión propia: se puede empezar cuando sea.           */
/* ------------------------------------------------------------------------ */

/** ¿Esta sesión del día es un cardio que la app sabe correr tramo por tramo? */
export function esCardioConPlan(sesion: Pick<OtherSessionView, "discipline" | "sesion">): boolean {
  return sesion.discipline === "CARDIO" && Boolean(sesion.sesion?.cardio);
}

/** El cardio con plan de esa fecha en la semana, o `null`. */
export function cardioDeLaFecha(
  otras: readonly OtherSessionView[] | undefined,
  fecha: string,
): OtherSessionView | null {
  return otras?.find((otra) => otra.date === fecha && esCardioConPlan(otra)) ?? null;
}

/**
 * ¿Quedan pesas sin cerrar ese día? El cardio va después cuando la fuerza es
 * el objetivo, pero se puede adelantar: esto solo decide si se dice.
 */
export function hayPesasPendientes(sesiones: readonly Pick<SessionView, "date" | "completedAt">[], fecha: string): boolean {
  return sesiones.some((sesion) => sesion.date === fecha && sesion.completedAt === null);
}

/** Minutos de cardio ya registrados ese día (reloj o app), o `null` si ninguno. */
export function minutosDeCardioHechos(
  actividades: readonly Pick<Activity, "discipline" | "date" | "durationMin">[],
  fecha: string,
): number | null {
  const delDia = actividades.filter((actividad) => actividad.discipline === "CARDIO" && actividad.date === fecha);
  if (delDia.length === 0) return null;
  return delDia.reduce((total, actividad) => total + actividad.durationMin, 0);
}

/**
 * El corredor del cardio: dónde vas, como HORAS absolutas y no contadores
 * (iOS congela los timers con la app en el fondo; el tiempo real sale de
 * comparar contra el reloj de pared). Es también lo que se guarda en el
 * teléfono para que salir y volver no lo reinicie.
 */
export type CorredorCardio = {
  fecha: string;
  paso: number;
  /** Hora de término del paso (epoch ms) mientras corre; `null` en pausa. */
  hasta: number | null;
  /** Lo que le quedaba al paso al pausar; `null` si corre. */
  restantePausaMs: number | null;
  /** Epoch ms del arranque. */
  inicio: number;
  /** Total pausado ya cerrado, en ms. */
  pausadoMs: number;
  /** Desde cuándo está en pausa, o `null`. */
  pausadoDesde: number | null;
  /** El paso en que ya se avisó el cambio de velocidad (una vez por tramo). */
  avisadoEn: number | null;
  terminado: boolean;
};

export function iniciarCorredor(fecha: string, pasos: readonly WarmupStep[], ahora: number): CorredorCardio {
  const primero = pasos[0];
  return {
    fecha,
    paso: 0,
    hasta: primero ? ahora + primero.segundos * 1000 : null,
    restantePausaMs: null,
    inicio: ahora,
    pausadoMs: 0,
    pausadoDesde: null,
    avisadoEn: null,
    terminado: !primero,
  };
}

export function pausarCorredor(estado: CorredorCardio, ahora: number): CorredorCardio {
  if (estado.terminado || estado.hasta === null) return estado;
  return {
    ...estado,
    hasta: null,
    restantePausaMs: Math.max(0, estado.hasta - ahora),
    pausadoDesde: ahora,
  };
}

export function reanudarCorredor(estado: CorredorCardio, ahora: number): CorredorCardio {
  if (estado.terminado || estado.hasta !== null || estado.restantePausaMs === null) return estado;
  return {
    ...estado,
    hasta: ahora + estado.restantePausaMs,
    restantePausaMs: null,
    pausadoMs: estado.pausadoMs + (estado.pausadoDesde === null ? 0 : ahora - estado.pausadoDesde),
    pausadoDesde: null,
  };
}

/** Va al paso siguiente ya (o termina si era el último), corriendo. */
export function saltarPasoCorredor(estado: CorredorCardio, pasos: readonly WarmupStep[], ahora: number): CorredorCardio {
  if (estado.terminado) return estado;
  const corriendo = reanudarCorredor(estado, ahora);
  const siguiente = pasos[corriendo.paso + 1];
  // Terminar deja la hora de fin en `pausadoDesde`: lo que pase después no cuenta.
  if (!siguiente) return { ...corriendo, hasta: null, pausadoDesde: ahora, terminado: true };
  return { ...corriendo, paso: corriendo.paso + 1, hasta: ahora + siguiente.segundos * 1000 };
}

/**
 * Pone el corredor al día con el reloj de pared: si al volver de otra app ya
 * pasaron uno o varios tramos, avanza por ellos (cada uno empieza donde
 * terminó el anterior, no "ahora") y, tras el último, termina.
 */
export function alcanzarCorredor(estado: CorredorCardio, pasos: readonly WarmupStep[], ahora: number): CorredorCardio {
  if (estado.terminado || estado.hasta === null) return estado;
  let actual = estado;
  while (actual.hasta !== null && ahora >= actual.hasta) {
    const siguiente = pasos[actual.paso + 1];
    // Terminó cuando venció el último tramo, no cuando se volvió a mirar.
    if (!siguiente) return { ...actual, hasta: null, pausadoDesde: actual.hasta, terminado: true };
    actual = { ...actual, paso: actual.paso + 1, hasta: actual.hasta + siguiente.segundos * 1000 };
  }
  return actual;
}

/** Segundos que le quedan al paso actual (corriendo o en pausa). */
export function restanteDelPasoSeg(estado: CorredorCardio, ahora: number): number {
  if (estado.terminado) return 0;
  const ms = estado.hasta !== null ? estado.hasta - ahora : (estado.restantePausaMs ?? 0);
  return Math.max(0, Math.ceil(ms / 1000));
}

/** Terminar aquí: se corta en `ahora` (lo que pase después no cuenta). */
export function terminarCorredor(estado: CorredorCardio, ahora: number): CorredorCardio {
  if (estado.terminado) return estado;
  const pausado = pausarCorredor(estado, ahora);
  return { ...pausado, hasta: null, pausadoDesde: pausado.pausadoDesde ?? ahora, terminado: true };
}

/** La hora en que terminó (o `ahora` si sigue). */
export function finDelCorredor(estado: CorredorCardio, ahora: number): number {
  return estado.terminado && estado.pausadoDesde !== null ? estado.pausadoDesde : ahora;
}

/** Lo corrido de verdad: de arranque a `ahora` menos lo pausado. */
export function activoMsCorredor(estado: CorredorCardio, ahora: number): number {
  const pausaAbierta = estado.pausadoDesde === null ? 0 : ahora - estado.pausadoDesde;
  return Math.max(0, ahora - estado.inicio - estado.pausadoMs - pausaAbierta);
}

/**
 * Lo guardado en el teléfono, SOLO si es un corredor sano de esa fecha y ese
 * número de pasos. Cualquier otra cosa (otro día, un plan que cambió, basura)
 * se ignora y el cardio arranca de cero.
 */
export function corredorGuardado(crudo: unknown, fecha: string, totalPasos: number): CorredorCardio | null {
  if (!crudo || typeof crudo !== "object") return null;
  const leido = crudo as Partial<CorredorCardio>;
  if (leido.fecha !== fecha || leido.terminado === true) return null;
  if (typeof leido.paso !== "number" || leido.paso < 0 || leido.paso >= totalPasos) return null;
  if (typeof leido.inicio !== "number") return null;
  const numeroO = (valor: unknown): number | null => (typeof valor === "number" ? valor : null);
  const hasta = numeroO(leido.hasta);
  const restantePausaMs = numeroO(leido.restantePausaMs);
  if (hasta === null && restantePausaMs === null) return null;
  return {
    fecha,
    paso: leido.paso,
    hasta,
    restantePausaMs: hasta === null ? restantePausaMs : null,
    inicio: leido.inicio,
    pausadoMs: numeroO(leido.pausadoMs) ?? 0,
    pausadoDesde: hasta === null ? numeroO(leido.pausadoDesde) : null,
    avisadoEn: numeroO(leido.avisadoEn),
    terminado: false,
  };
}

/** El lunes (`YYYY-MM-DD`) de la semana de `fecha`: la llave del cache de semana. */
export function lunesDe(fecha: string): string {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const fechaLocal = new Date(anio!, mes! - 1, dia!);
  const diaSemana = fechaLocal.getDay() || 7;
  fechaLocal.setDate(fechaLocal.getDate() - (diaSemana - 1));
  const m = String(fechaLocal.getMonth() + 1).padStart(2, "0");
  return `${fechaLocal.getFullYear()}-${m}-${String(fechaLocal.getDate()).padStart(2, "0")}`;
}
