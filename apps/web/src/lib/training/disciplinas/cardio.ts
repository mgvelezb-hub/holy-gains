import {
  factorDeSemana,
  notaDeObjetivo,
  type BloqueSesion,
  type NivelDisciplina,
  type ObjetivoAtleta,
  type SesionDisciplina,
} from "@/lib/training/disciplinas/tipos";
import {
  nivelHiitDeSemana,
  protocoloDelCatalogo,
  textoVelocidad,
  type SemanaCardio,
  type UnidadVelocidad,
} from "@/lib/training/disciplinas/hiit-caminadora";
import {
  controlDe,
  necesitaBase,
  NOMBRE_MAQUINA,
  ritmoATexto,
  segundosDeRitmo,
  type ControlMaquina,
  type MaquinaConBase,
  type NivelBase,
} from "@/lib/training/disciplinas/maquinas-cardio";
import {
  conPulso,
  fcMaxima,
  INFO_MODALIDAD,
  notaDeMaquina,
  programaCardio,
  tituloPrograma,
  type ModalidadCardio,
  type ProgramaCardio,
} from "@/lib/training/disciplinas/modalidades-cardio";
import { duracionValida, ENFRIAMIENTO_MIN, type TramoCardio } from "@/lib/training/disciplinas/plantillas-hiit";
import type { EquipoCardio, NivelCardio, PreferenciasCardio, TipoCardio } from "@/lib/training/types";

/**
 * Cardio en máquina — el bloque de después de pesas (H2) o de día propio.
 *
 * `running.ts` prescribe correr como disciplina. Esto es la máquina del gym
 * al terminar la rutina, que es lo que Mau hace y con lo que siente que ya
 * entrenó.
 *
 * **P1: toda máquina, toda modalidad.** La sesión es un `ProgramaCardio`
 * minuto a minuto (`modalidades-cardio.ts`): HIIT por nivel 0–5, zona 2,
 * tempo, 4×4, piramidal o recuperación, con los controles de la máquina ya
 * calculados. La caminadora corre el protocolo real de Mau más largo que
 * quepa (25/15/10) y camina suave lo que sobre (20' = 15' + 5'); solo si
 * ninguno cabe va la plantilla, como el resto de máquinas.
 *
 * **La intensidad se ancla en un nivel base personal** por máquina (lo que
 * es "moderado" para esa persona en esa máquina). Si falta, la primera
 * sesión de la semana es de **calibración**: 5 min subiendo un paso por
 * minuto y la persona marca "aquí voy moderado"; eso se guarda en
 * `nivelBase`. Mientras tanto, el resto de sesiones usa una base estimada
 * por nivel declarado y lo dice.
 *
 * **Progresión del HIIT: +1 nivel por semana cumplida (≥ 80 %)**, la misma
 * regla de la caminadora (`nivelHiitDeSemana`), para toda máquina. La 4.ª
 * semana descarga: HIIT un nivel abajo; tempo, 4×4 y pirámide pasan a
 * recuperación.
 *
 * **HIIT o continuo.** Para pérdida de grasa rinden lo mismo (Keating 2017,
 * Wewege 2017); el HIIT en menos tiempo. Por eso sigue siendo el default.
 */

export const DEFAULTS_CARDIO = {
  equipo: "CAMINADORA",
  tipo: "HIIT",
  nivel: "BASICO",
  minutos: 20,
  unidadVelocidad: "kmh",
} as const satisfies PreferenciasCardio;

export const NOMBRE_EQUIPO: Record<EquipoCardio, string> = {
  CAMINADORA: "caminadora",
  ESCALERA: "escaladora",
  BICI: "bici",
  ELIPTICA: "elíptica",
  REMO: "remo",
  BICI_AIRE: "bici de aire",
  SKI_ERG: "SkiErg",
  LIBRE: "libre",
};

export const NOMBRE_TIPO: Record<TipoCardio | "CALIBRACION", string> = {
  HIIT: "HIIT",
  CONTINUO: "zona 2",
  ZONA2: "zona 2",
  TEMPO: "tempo",
  NORUEGO: "4×4",
  PIRAMIDAL: "piramidal",
  RECUPERACION: "recuperación",
  VARIADO: "variado",
  CALIBRACION: "calibración",
};

/** Del nivel genérico de disciplina al de cardio, cuando no se declaró uno propio. */
const DESDE_NIVEL_DISCIPLINA: Record<NivelDisciplina, NivelCardio> = {
  PRINCIPIANTE: "BASICO",
  INTERMEDIO: "MEDIO",
  AVANZADO: "AVANZADO",
};

const NIVEL_DISCIPLINA: Record<NivelCardio, NivelDisciplina> = {
  BASICO: "PRINCIPIANTE",
  MEDIO: "INTERMEDIO",
  AVANZADO: "AVANZADO",
};

export type CardioInput = {
  /** Minutos que tiene el bloque ese día. */
  minutes: number;
  isoWeek: number;
  objetivo: ObjetivoAtleta;
  prefs?: PreferenciasCardio;
  /** Respaldo si `prefs.nivel` no se declaró. */
  nivelDisciplina?: NivelDisciplina;
  /** Semanas anteriores de cardio: de ahí sube el nivel del HIIT. */
  historial?: readonly SemanaCardio[];
  /** Qué sesión de cardio es en la semana (1.ª, 2.ª…): rota el `VARIADO` y decide la calibración. */
  ordinal?: number;
  /** Con edad, cada tramo trae su zona de pulso. */
  edad?: number;
};

/* ------------------------------------------------------------------------ */
/* Variado y descarga                                                        */
/* ------------------------------------------------------------------------ */

/**
 * `VARIADO`: qué modalidad toca en cada sesión de la semana según el
 * objetivo, rotando por ordinal.
 *
 * - Bajar grasa: 2 HIIT + 1 zona 2 + 1 recuperación — el HIIT rinde lo
 *   mismo en menos tiempo (Keating 2017) y la zona 2 suma gasto sin fatiga.
 * - Recomposición: como bajar grasa, con la pirámide en lugar de un HIIT.
 * - Ganar músculo: cardio que no compita con la pierna — la interferencia
 *   crece con la frecuencia y la duración del cardio (Wilson 2012, J
 *   Strength Cond Res), así que manda la zona 2.
 * - Salud: mayoría zona 2 con un HIIT, el reparto polarizado (Seiler 2010).
 * - Rendimiento: 4×4, zona 2, tempo y pirámide.
 */
export const ROTACION_VARIADO: Record<ObjetivoAtleta, ModalidadCardio[]> = {
  PERDIDA_GRASA: ["HIIT", "ZONA2", "HIIT", "RECUPERACION"],
  RECOMPOSICION: ["HIIT", "ZONA2", "PIRAMIDAL", "RECUPERACION"],
  GANANCIA_MUSCULO: ["ZONA2", "HIIT", "RECUPERACION"],
  SALUD: ["ZONA2", "HIIT", "ZONA2", "RECUPERACION"],
  RENDIMIENTO: ["NORUEGO", "ZONA2", "TEMPO", "PIRAMIDAL"],
};

/** La modalidad pedida, con `CONTINUO` (nombre viejo) como zona 2 y `VARIADO` ya resuelto. */
export function modalidadDeSesion(tipo: TipoCardio, objetivo: ObjetivoAtleta, ordinal: number): ModalidadCardio {
  if (tipo === "CONTINUO") return "ZONA2";
  if (tipo !== "VARIADO") return tipo;
  const rotacion = ROTACION_VARIADO[objetivo];
  return rotacion[(Math.max(1, ordinal) - 1) % rotacion.length]!;
}

/** Semana de descarga: lo intenso que no es HIIT pasa a recuperación (el HIIT baja un nivel por su lado). */
export function modalidadEnDescarga(modalidad: ModalidadCardio): ModalidadCardio {
  return modalidad === "TEMPO" || modalidad === "NORUEGO" || modalidad === "PIRAMIDAL" ? "RECUPERACION" : modalidad;
}

/* ------------------------------------------------------------------------ */
/* Nivel base y calibración                                                  */
/* ------------------------------------------------------------------------ */

/**
 * La base con la que se arranca mientras la persona no calibra. Son
 * conjeturas de la app a partir del nivel declarado —de eso existe la
 * calibración—: resistencia 6/9/12 (el "básico 6–8, medio 9–12, avanzado
 * 13+" que usaba H2 como nivel de trabajo), remo 2:40/2:25/2:10 por 500 m y
 * bici de aire 80/110/150 W.
 */
export function baseEstimada(maquina: MaquinaConBase, nivel: NivelCardio): NivelBase {
  const i = nivel === "BASICO" ? 0 : nivel === "MEDIO" ? 1 : 2;
  switch (maquina) {
    case "ELIPTICA":
    case "BICI":
    case "ESCALERA":
      return [6, 9, 12][i]!;
    case "REMO":
    case "SKI_ERG":
      return { ritmo500: ["2:40", "2:25", "2:10"][i]! };
    case "BICI_AIRE":
      return { watts: [80, 110, 150][i]! };
  }
}

export const MINUTOS_CALIBRACION = 5;

/**
 * Los 5 pasos de la calibración, uno por minuto, alrededor de la base
 * estimada: resistencia −2…+2, ritmo +10…−10 s/500 m, watts −40…+40.
 */
export function pasosDeCalibracion(maquina: MaquinaConBase, nivel: NivelCardio): NivelBase[] {
  const centro = baseEstimada(maquina, nivel);
  return [-2, -1, 0, 1, 2].map((paso) => {
    if (typeof centro === "number") return Math.max(1, centro + paso);
    if ("ritmo500" in centro) return { ritmo500: ritmoATexto(segundosDeRitmo(centro.ritmo500)! - paso * 5) };
    return { watts: Math.max(20, centro.watts + paso * 20) };
  });
}

/**
 * La sesión de calibración: 5 min subiendo un paso por minuto (la persona
 * toca "Aquí voy moderado" cuando solo puede hablar en frases cortas: la
 * prueba del habla, ACSM 2021), el resto en zona 2 a lo que marcó y 2 min
 * de enfriamiento.
 */
export function programaCalibracion(input: {
  maquina: MaquinaConBase;
  duracion: number;
  nivel: NivelCardio;
  edad?: number;
}): ProgramaCardio {
  const duracion = Math.max(MINUTOS_CALIBRACION + ENFRIAMIENTO_MIN + 1, duracionValida(input.duracion));
  const valores = pasosDeCalibracion(input.maquina, input.nivel);
  const esfuerzos = ["Fácil", "Fácil", "Moderado", "Moderado", "Moderado Alto"] as const;
  const pasos = valores.map((valor, i) => ({
    desdeMin: i,
    hastaMin: i + 1,
    control: controlDe(input.maquina, "Moderado", { base: valor }),
    valor,
  }));
  const marcado = (texto: string): ControlMaquina => ({ maquina: input.maquina, texto });
  const tramos: TramoCardio[] = [
    ...pasos.map((paso, i) => ({
      desdeMin: paso.desdeMin,
      hastaMin: paso.hastaMin,
      esfuerzo: esfuerzos[i]!,
      fase: "calibracion" as const,
      control: paso.control,
    })),
    {
      desdeMin: MINUTOS_CALIBRACION,
      hastaMin: duracion - ENFRIAMIENTO_MIN,
      esfuerzo: "Moderado",
      fase: "continuo",
      control: marcado("El que marcaste"),
    },
    {
      desdeMin: duracion - ENFRIAMIENTO_MIN,
      hastaMin: duracion,
      esfuerzo: "Fácil",
      fase: "enfriamiento",
      control: marcado("Un poco menos que el que marcaste"),
    },
  ];
  const nombre = NOMBRE_MAQUINA[input.maquina];
  return {
    maquina: input.maquina,
    modalidad: "CALIBRACION",
    nivel: null,
    duracion,
    titulo: `Calibración · ${duracion}' · ${nombre}`,
    fuente: "plantilla",
    porque: "Una vez por máquina: fija tu nivel base, el \"moderado\" del que salen todos los esfuerzos (prueba del habla, ACSM 2021).",
    paraQuien: `La primera vez que la app te prescribe ${nombre.toLowerCase()}.`,
    tramos: conPulso(tramos, input.edad, "CALIBRACION"),
    notaMaquina: notaDeMaquina(input.maquina),
    base: null,
    baseEstimada: true,
    calibracion: {
      maquina: input.maquina,
      instruccion:
        "Sube un paso cada minuto. Cuando ya solo puedas hablar en frases cortas, toca «Aquí voy moderado»: ese es tu nivel base en esta máquina.",
      pasos,
    },
    ajuste: null,
    fcMaxima: input.edad !== undefined ? fcMaxima(input.edad) : null,
  };
}

/* ------------------------------------------------------------------------ */
/* Prescripción                                                              */
/* ------------------------------------------------------------------------ */

/** "Cardio HIIT caminadora", "Cardio zona 2 remo". */
export function etiquetaCardio(prefs?: { equipo?: EquipoCardio; tipo?: TipoCardio | "CALIBRACION" }): string {
  const equipo = prefs?.equipo ?? DEFAULTS_CARDIO.equipo;
  const tipo = NOMBRE_TIPO[prefs?.tipo ?? DEFAULTS_CARDIO.tipo];
  return equipo === "LIBRE" ? `Cardio ${tipo}` : `Cardio ${tipo} ${NOMBRE_EQUIPO[equipo]}`;
}

export function prescribirCardio(input: CardioInput): SesionDisciplina {
  const { isoWeek, objetivo } = input;
  const prefs = input.prefs ?? {};
  const equipo = prefs.equipo ?? DEFAULTS_CARDIO.equipo;
  const nivel =
    prefs.nivel ?? (input.nivelDisciplina ? DESDE_NIVEL_DISCIPLINA[input.nivelDisciplina] : DEFAULTS_CARDIO.nivel);
  const minutes = Math.max(10, Math.round(input.minutes));
  const ordinal = input.ordinal ?? 1;
  const unidad = prefs.unidadVelocidad ?? DEFAULTS_CARDIO.unidadVelocidad;

  const progreso = nivelHiitDeSemana({ nivel, isoWeek, historial: input.historial ?? [] });
  const { deload } = factorDeSemana(isoWeek);
  const pedida = modalidadDeSesion(prefs.tipo ?? DEFAULTS_CARDIO.tipo, objetivo, ordinal);
  const modalidad = progreso.descarga ? modalidadEnDescarga(pedida) : pedida;

  const guardada = necesitaBase(equipo) ? prefs.nivelBase?.[equipo] : undefined;
  const edad = input.edad !== undefined ? { edad: input.edad } : {};
  let programa: ProgramaCardio;
  if (necesitaBase(equipo) && guardada === undefined && ordinal === 1) {
    programa = programaCalibracion({ maquina: equipo, duracion: minutes, nivel, ...edad });
  } else {
    const base = guardada ?? (necesitaBase(equipo) ? baseEstimada(equipo, nivel) : undefined);
    programa = {
      ...programaCardio({
        maquina: equipo,
        modalidad,
        duracion: minutes,
        nivelHiit: progreso.nivel,
        ...(base !== undefined ? { base } : {}),
        ...edad,
      }),
      baseEstimada: necesitaBase(equipo) && guardada === undefined,
    };
  }

  const blocks = bloquesDe(programa, equipo === "CAMINADORA" ? unidad : undefined);
  const notes: string[] = [programa.porque];
  if (programa.modalidad === "HIIT") {
    notes.push(
      "Progresión: +1 nivel por cada semana en que registres al menos el 80 % de tus sesiones de cardio; la 4.ª semana baja un nivel para descargar.",
    );
  }
  if (programa.calibracion) notes.push(programa.calibracion.instruccion);
  if (programa.baseEstimada && !programa.calibracion) {
    notes.push(`Base estimada: la calibras en tu primera sesión de ${NOMBRE_EQUIPO[equipo]} de la semana.`);
  }
  if (programa.ajuste) notes.push(programa.ajuste);
  if (programa.notaMaquina) notes.push(programa.notaMaquina);
  if (progreso.descarga) {
    notes.push(
      pedida === modalidad
        ? "Semana de descarga: un nivel abajo, mismos minutos."
        : `Semana de descarga: hoy toca recuperación en vez de ${INFO_MODALIDAD[pedida].nombre}.`,
    );
  }
  const porObjetivo = notaDeObjetivo(objetivo);
  if (porObjetivo) notes.push(porObjetivo);

  const real =
    programa.fuente === "catalogo" ? protocoloDelCatalogo(programa.protocoloMin ?? programa.duracion, programa.nivel ?? 0) : null;
  const calentamientoMin = sumaMin(programa.tramos, ["calentamiento", "calibracion"]);
  const enfriamientoMin = sumaMin(programa.tramos, ["enfriamiento"]);
  const tipoResuelto = programa.modalidad === "CALIBRACION" ? "CALIBRACION" : programa.modalidad;

  return {
    discipline: "CARDIO",
    nivel: NIVEL_DISCIPLINA[nivel],
    focus: programa.modalidad === "CALIBRACION" ? "Calibración" : INFO_MODALIDAD[programa.modalidad].nombre,
    unidad: "min",
    cargaTotal: blocks.reduce((suma, bloque) => suma + (bloque.carga ?? 0), 0),
    minutes,
    blocks,
    deload: progreso.descarga || deload,
    notes,
    cardio: {
      equipo,
      tipo: programa.modalidad === "HIIT" ? "HIIT" : "CONTINUO",
      modalidad: programa.modalidad,
      nivelMaquina: programa.nivel ?? (typeof programa.base === "number" ? programa.base : 0),
      etiqueta: etiquetaCardio({ equipo, tipo: tipoResuelto }),
      intervalos: null,
      calentamientoSeg: calentamientoMin * 60,
      enfriamientoSeg: enfriamientoMin * 60,
      ...(real ? { protocolo: { ...real, recortado: false, caminataMin: programa.caminataMin ?? 0 } } : {}),
      ...(equipo === "CAMINADORA" ? { unidad } : {}),
      programa,
    },
  };
}

function sumaMin(tramos: readonly TramoCardio[], fases: ReadonlyArray<TramoCardio["fase"]>): number {
  return tramos.filter((t) => fases.includes(t.fase)).reduce((suma, t) => suma + t.hastaMin - t.desdeMin, 0);
}

/** Los bloques de la tarjeta: lo de antes, el cuerpo, el enfriamiento y la caminata que sobre. */
function bloquesDe(programa: ProgramaCardio, unidad?: UnidadVelocidad): BloqueSesion[] {
  const antes = programa.tramos.filter((t) => t.fase === "calentamiento" || t.fase === "calibracion");
  const despues = programa.tramos.filter((t) => t.fase === "enfriamiento");
  const caminata = programa.tramos.filter((t) => t.fase === "caminata");
  const cuerpo = programa.tramos.filter((t) => !antes.includes(t) && !despues.includes(t) && !caminata.includes(t));
  const min = (tramos: TramoCardio[]) => tramos.reduce((suma, t) => suma + t.hastaMin - t.desdeMin, 0);
  // En caminadora los km/h se dicen en la unidad de la persona.
  const control = (tramo: TramoCardio) =>
    unidad && tramo.control.kmh ? textoVelocidad(tramo.control.kmh, unidad) : tramo.control.texto;
  const como = (tramo: TramoCardio) => (control(tramo) ? ` · ${control(tramo)}` : "");
  const blocks: BloqueSesion[] = [];

  if (programa.calibracion) {
    blocks.push({
      title: "Calibración",
      detail: `${min(antes)} min · un paso más cada minuto`,
      carga: min(antes),
      restSeconds: null,
      note: "Toca «Aquí voy moderado» cuando ya solo puedas hablar en frases cortas.",
    });
  } else if (antes.length > 0) {
    blocks.push({
      title: "Calentamiento",
      detail: `${min(antes)} min${como(antes[0]!)}`,
      carga: min(antes),
      restSeconds: null,
      note: "Fácil: subir el pulso poco a poco. Llegas de pesas, no en frío.",
    });
  }

  if (cuerpo.length > 0) {
    const tope = cuerpo.reduce((max, t) => (ESFUERZO_ORDEN[t.esfuerzo] > ESFUERZO_ORDEN[max.esfuerzo] ? t : max), cuerpo[0]!);
    const titulo =
      programa.caminataMin && programa.protocoloMin && programa.modalidad !== "CALIBRACION"
        ? tituloPrograma(programa.modalidad, programa.protocoloMin, programa.maquina, programa.nivel)
        : programa.titulo;
    blocks.push({
      title: programa.calibracion ? "Zona 2" : titulo,
      detail:
        cuerpo.length === 1
          ? `${min(cuerpo)} min${como(cuerpo[0]!)} (${cuerpo[0]!.esfuerzo})`
          : `${cuerpo.length} tramos · hasta ${tope.esfuerzo}${control(tope) ? ` (${control(tope)})` : ""}`,
      carga: min(cuerpo),
      restSeconds: null,
      note:
        programa.modalidad === "RECUPERACION"
          ? "Fácil de principio a fin: si te cuesta hablar, baja."
          : "Cada tramo dice qué poner en la máquina y el esfuerzo. Si el Máximo no sale, quédate un paso abajo.",
    });
  }

  if (despues.length > 0) {
    blocks.push({
      title: "Enfriamiento",
      detail: `${min(despues)} min${como(despues[0]!)}`,
      carga: min(despues),
      restSeconds: null,
      note: "Nunca bajarse en seco después de intervalos.",
    });
  }

  if (caminata.length > 0) {
    const tramo = caminata[0]!;
    blocks.push({
      title: "Caminata suave",
      detail: `${min(caminata)} min · ${tramo.control.kmh ? textoVelocidad(tramo.control.kmh, unidad ?? "kmh") : tramo.control.texto}`,
      carga: min(caminata),
      restSeconds: null,
      note: "Lo que sobra del bloque, caminando: suma gasto sin sumar fatiga.",
    });
  }
  return blocks;
}

const ESFUERZO_ORDEN: Record<TramoCardio["esfuerzo"], number> = {
  Fácil: 0,
  Moderado: 1,
  "Moderado Alto": 2,
  Fuerte: 3,
  Máximo: 4,
};
