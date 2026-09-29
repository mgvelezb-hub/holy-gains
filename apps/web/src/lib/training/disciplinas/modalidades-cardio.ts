import type { EsfuerzoHiit } from "@/lib/training/disciplinas/hiit-caminadora";
import { ESFUERZOS_HIIT } from "@/lib/training/disciplinas/hiit-caminadora";
import {
  DAMPER_REMO,
  NOMBRE_MAQUINA,
  type ControlMaquina,
  type MaquinaConBase,
  type NivelBase,
} from "@/lib/training/disciplinas/maquinas-cardio";
import {
  calentamientoDe,
  duracionValida,
  encadenar,
  ENFRIAMIENTO_MIN,
  hiitParaMaquina,
  nivelHiitValido,
  plantillaHiit,
  TECHO_HIIT,
  tramosConControles,
  type FaseTramo,
  type TramoCardio,
  type TramoPlantilla,
} from "@/lib/training/disciplinas/plantillas-hiit";
import type { EquipoCardio } from "@/lib/training/types";

/**
 * Las modalidades de cardio para cualquier máquina y duración (P1) — puro.
 *
 * HIIT es una de seis. Las demás existen porque no todo día pide subir el
 * pulso al máximo: la zona 2 construye base y se recupera rápido, el tempo
 * sube el umbral, el 4×4 noruego es lo que más mueve el VO₂máx, la pirámide
 * rompe la monotonía y la recuperación es para la semana de descarga o el
 * día después de pierna. Todas usan la misma escala de esfuerzo que el HIIT
 * y los mismos controles por máquina (`maquinas-cardio.ts`).
 */

export const MODALIDADES_CARDIO = ["HIIT", "ZONA2", "TEMPO", "NORUEGO", "PIRAMIDAL", "RECUPERACION"] as const;
export type ModalidadCardio = (typeof MODALIDADES_CARDIO)[number];

export type InfoModalidad = {
  nombre: string;
  /** Por qué existe, en una línea, con su fuente. */
  porque: string;
  /** A quién le conviene (objetivo). */
  paraQuien: string;
};

export const INFO_MODALIDAD: Record<ModalidadCardio, InfoModalidad> = {
  HIIT: {
    nombre: "HIIT",
    porque: "Intervalos: bajan la misma grasa que el continuo en ~40 % menos tiempo (Keating 2017; Wewege 2017).",
    paraQuien: "Bajar grasa con poco tiempo y subir la condición.",
  },
  ZONA2: {
    nombre: "Zona 2",
    porque: "Continuo a ritmo de conversación (60–70 % FCmáx): construye base aeróbica y se recupera rápido; es el grueso del volumen de los atletas de resistencia (Seiler 2010).",
    paraQuien: "Condición base y bajar grasa sin sumar fatiga.",
  },
  TEMPO: {
    nombre: "Tempo",
    porque: "Bloques de 8–10 min cerca del umbral (Moderado Alto–Fuerte): suben el ritmo que aguantas antes de que el pulso se dispare (zona de umbral, Seiler 2010).",
    paraQuien: "Condición y rendimiento, para quien ya domina la zona 2.",
  },
  NORUEGO: {
    nombre: "4×4",
    porque: "4 × 4 min al 85–95 % FCmáx con 3 min de recuperación activa: subió el VO₂máx más que el continuo o el umbral en 8 semanas (Helgerud 2007).",
    paraQuien: "Condición (VO₂máx) y rendimiento; pide al menos 35 min.",
  },
  PIRAMIDAL: {
    nombre: "Piramidal",
    porque: "1-2-3-2-1 min subiendo y bajando el esfuerzo, con recuperaciones iguales: toca todas las intensidades en una sesión (variante de intervalos; regla de la app).",
    paraQuien: "Condición, y quien ya se aburrió del HIIT de siempre.",
  },
  RECUPERACION: {
    nombre: "Recuperación",
    porque: "Fácil sostenido, por debajo del primer umbral: mueve la sangre sin sumar fatiga (zona 1, Seiler 2010).",
    paraQuien: "Semana de descarga y el día después de pierna pesada.",
  },
};

/* ------------------------------------------------------------------------ */
/* Pulso                                                                     */
/* ------------------------------------------------------------------------ */

/** FCmáx estimada: 208 − 0.7 × edad (Tanaka, Monahan y Seals 2001, JACC). */
export function fcMaxima(edad: number): number {
  return Math.round(208 - 0.7 * edad);
}

/**
 * % de FCmáx por esfuerzo: bandas de 10 % del modelo de cinco zonas, con la
 * zona 2 al 60–70 % que usa la app. Caben en las categorías de ACSM 2021
 * (ligera < 64 %, moderada 64–76 %, vigorosa 77–95 %). El Máximo se topa en
 * 95 %: es el techo que usa el 4×4 de Helgerud 2007.
 */
export const ZONA_FC: Record<EsfuerzoHiit, [number, number]> = {
  Fácil: [0.5, 0.6],
  Moderado: [0.6, 0.7],
  "Moderado Alto": [0.7, 0.8],
  Fuerte: [0.8, 0.9],
  Máximo: [0.9, 0.95],
};

/** El trabajo del 4×4 va al 85–95 % (Helgerud 2007), no a la banda de Fuerte. */
const ZONA_FC_NORUEGO: [number, number] = [0.85, 0.95];

function zonaLpm(fcMax: number, porcentaje: readonly [number, number]): [number, number] {
  return [Math.round(fcMax * porcentaje[0]), Math.round(fcMax * porcentaje[1])];
}

/* ------------------------------------------------------------------------ */
/* Tramos por modalidad                                                      */
/* ------------------------------------------------------------------------ */

type Paso = [number, EsfuerzoHiit, FaseTramo];

export const MINIMO_NORUEGO = 35;
const CUERPO_NORUEGO = 4 * 4 + 3 * 3;

function minutosDe(pasos: readonly Paso[]): number {
  return pasos.reduce((suma, [m]) => suma + m, 0);
}

function topar(esfuerzo: EsfuerzoHiit, nivel: number): EsfuerzoHiit {
  const techo = ESFUERZOS_HIIT.indexOf(TECHO_HIIT[nivel]!);
  return ESFUERZOS_HIIT[Math.min(ESFUERZOS_HIIT.indexOf(esfuerzo), techo)]!;
}

function zona2(duracion: number): Paso[] {
  const calentamiento = duracion >= 20 ? 3 : 2;
  return [
    [calentamiento, "Fácil", "calentamiento"],
    [duracion - calentamiento - ENFRIAMIENTO_MIN, "Moderado", "continuo"],
    [ENFRIAMIENTO_MIN, "Fácil", "enfriamiento"],
  ];
}

/**
 * Bloques de 8–10 min con 2–3 min Fácil entre ellos: tantos como quepan; lo
 * que sobre se suma como Moderado antes del primero. Cada bloque va a
 * Moderado Alto y cierra 2 min en Fuerte.
 */
function tempo(duracion: number): Paso[] {
  const calentamiento = calentamientoDe(duracion);
  const disponible = duracion - minutosDe(calentamiento) - ENFRIAMIENTO_MIN;
  const bloque = (minutos: number): Paso[] =>
    minutos >= 8
      ? [[minutos - 2, "Moderado Alto", "trabajo"], [2, "Fuerte", "trabajo"]]
      : [[minutos, "Moderado Alto", "trabajo"]];
  if (disponible < 8) return [...calentamiento, ...bloque(disponible), [ENFRIAMIENTO_MIN, "Fácil", "enfriamiento"]];

  let bloques = 1;
  while ((bloques + 1) * 8 + bloques * 2 <= disponible) bloques += 1;
  const trabajo = Math.min(10, Math.floor((disponible - (bloques - 1) * 2) / bloques));
  let pausa = 2;
  let sobra = disponible - bloques * trabajo - (bloques - 1) * pausa;
  if (bloques > 1 && sobra >= bloques - 1) {
    pausa = 3;
    sobra -= bloques - 1;
  }
  const cuerpo: Paso[] = [];
  for (let i = 0; i < bloques; i += 1) {
    if (i > 0) cuerpo.push([pausa, "Fácil", "recuperacion"]);
    cuerpo.push(...bloque(trabajo));
  }
  return [...calentamiento, [sobra, "Moderado", "continuo"], ...cuerpo, [ENFRIAMIENTO_MIN, "Fácil", "enfriamiento"]];
}

/**
 * Helgerud 2007: calentamiento, 4 × 4 min al 85–95 % con 3 min activos
 * (~70 %, Moderado) entre ellos y enfriamiento. El calentamiento crece hasta
 * 10 min (el del estudio); lo que sobre después es zona 2.
 */
function noruego(duracion: number): Paso[] {
  const enfriamiento = 3;
  const calentamiento = Math.min(10, duracion - CUERPO_NORUEGO - enfriamiento);
  const sobra = duracion - calentamiento - CUERPO_NORUEGO - enfriamiento;
  const cuerpo: Paso[] = [];
  for (let i = 0; i < 4; i += 1) {
    if (i > 0) cuerpo.push([3, "Moderado", "recuperacion"]);
    cuerpo.push([4, "Fuerte", "trabajo"]);
  }
  return [
    [3, "Fácil", "calentamiento"],
    [calentamiento - 3, "Moderado", "calentamiento"],
    ...cuerpo,
    [sobra, "Moderado", "continuo"],
    [enfriamiento, "Fácil", "enfriamiento"],
  ];
}

/** 1-2-3-2-1 (o 1-2-1 si no cabe), recuperación Fácil igual al trabajo; la última es el enfriamiento. */
function piramide(escalones: readonly number[], nivel: number): Paso[] {
  const esfuerzos: EsfuerzoHiit[] = ["Moderado Alto", "Fuerte", "Máximo"];
  const pasos: Paso[] = [];
  escalones.forEach((minutos, i) => {
    const cima = escalones.indexOf(Math.max(...escalones));
    const altura = i <= cima ? i : escalones.length - 1 - i;
    pasos.push([minutos, topar(esfuerzos[altura]!, nivel), "trabajo"]);
    if (i < escalones.length - 1) pasos.push([minutos, "Fácil", "recuperacion"]);
  });
  return pasos;
}

function piramidal(duracion: number, nivel: number): Paso[] | null {
  const calentamiento = calentamientoDe(duracion);
  const disponible = duracion - minutosDe(calentamiento) - ENFRIAMIENTO_MIN;
  const grande = piramide([1, 2, 3, 2, 1], nivel);
  const chica = piramide([1, 2, 1], nivel);
  let cuerpo: Paso[];
  if (disponible >= 2 * minutosDe(grande) + 2) cuerpo = [...grande, [2, "Fácil", "recuperacion"], ...grande];
  else if (disponible >= minutosDe(grande)) cuerpo = grande;
  else if (disponible >= minutosDe(chica)) cuerpo = chica;
  else return null;
  return [
    ...calentamiento,
    [disponible - minutosDe(cuerpo), "Moderado", "continuo"],
    ...cuerpo,
    [ENFRIAMIENTO_MIN, "Fácil", "enfriamiento"],
  ];
}

/**
 * Los tramos (sin máquina) de una modalidad. Si la modalidad no cabe en los
 * minutos (4×4 < 35 min, pirámide < 11), va HIIT y `ajuste` lo explica.
 */
export function tramosDeModalidad(
  modalidad: ModalidadCardio,
  duracion: number,
  nivelHiit: number,
): { modalidad: ModalidadCardio; tramos: TramoPlantilla[]; ajuste: string | null } {
  const total = duracionValida(duracion);
  const nivel = nivelHiitValido(nivelHiit);
  const hiit = (ajuste: string | null) => ({ modalidad: "HIIT" as const, tramos: plantillaHiit(total, nivel), ajuste });
  switch (modalidad) {
    case "HIIT":
      return hiit(null);
    case "ZONA2":
      return { modalidad, tramos: encadenar(zona2(total)), ajuste: null };
    case "TEMPO":
      return { modalidad, tramos: encadenar(tempo(total)), ajuste: null };
    case "NORUEGO":
      if (total < MINIMO_NORUEGO) return hiit(`El 4×4 pide al menos ${MINIMO_NORUEGO} min; con ${total} van intervalos cortos.`);
      return { modalidad, tramos: encadenar(noruego(total)), ajuste: null };
    case "PIRAMIDAL": {
      const pasos = piramidal(total, nivel);
      if (!pasos) return hiit(`La pirámide no cabe en ${total} min; hoy van intervalos cortos.`);
      return { modalidad, tramos: encadenar(pasos), ajuste: null };
    }
    case "RECUPERACION":
      return { modalidad, tramos: [{ desdeMin: 0, hastaMin: total, esfuerzo: "Fácil", fase: "continuo" }], ajuste: null };
  }
}

/* ------------------------------------------------------------------------ */
/* El programa que pinta la app                                              */
/* ------------------------------------------------------------------------ */

/** La calibración del nivel base: un paso por minuto, y qué se guarda si la persona marca ese. */
export type CalibracionCardio = {
  maquina: MaquinaConBase;
  instruccion: string;
  pasos: Array<{ desdeMin: number; hastaMin: number; control: ControlMaquina; valor: NivelBase }>;
};

/**
 * Una sesión de cardio lista para pintar y correr: la tabla minuto a minuto
 * con el control de la máquina, el esfuerzo y (si hay edad) la zona de pulso.
 */
export type ProgramaCardio = {
  maquina: EquipoCardio;
  modalidad: ModalidadCardio | "CALIBRACION";
  /** Nivel de HIIT 0–5; `null` fuera del HIIT. */
  nivel: number | null;
  duracion: number;
  /** "HIIT 20' · Nivel 2 · Elíptica", "Zona 2 · 30' · Remo". */
  titulo: string;
  /** `catalogo` = protocolo real de Mau (caminadora); `plantilla` = generado. */
  fuente: "catalogo" | "plantilla";
  porque: string;
  paraQuien: string;
  tramos: TramoCardio[];
  /** Nota fija de la máquina (el damper del remo). */
  notaMaquina: string | null;
  /** La base con la que se calcularon los controles. */
  base: NivelBase | null;
  /** `true` = base estimada: la persona aún no calibra esta máquina. */
  baseEstimada: boolean;
  /** Solo en la sesión de calibración. */
  calibracion: CalibracionCardio | null;
  /** Por qué la sesión no es la modalidad pedida ("el 4×4 pide 35 min"). */
  ajuste: string | null;
  fcMaxima: number | null;
};

export type ProgramaInput = {
  maquina: EquipoCardio;
  modalidad: ModalidadCardio;
  duracion: number;
  /** Nivel de HIIT 0–5 (también da los km/h de la caminadora). */
  nivelHiit: number;
  base?: NivelBase;
  /** Con edad, cada tramo trae su zona de pulso. */
  edad?: number;
};

export function tituloPrograma(modalidad: ModalidadCardio, duracion: number, maquina: EquipoCardio, nivel: number | null): string {
  const donde = maquina === "LIBRE" ? "" : ` · ${NOMBRE_MAQUINA[maquina]}`;
  if (modalidad === "HIIT") return `HIIT ${duracion}' · Nivel ${nivel ?? 0}${donde}`;
  return `${INFO_MODALIDAD[modalidad].nombre} · ${duracion}'${donde}`;
}

export function notaDeMaquina(maquina: EquipoCardio): string | null {
  return maquina === "REMO" || maquina === "SKI_ERG" ? DAMPER_REMO.nota : null;
}

/** Pone la zona de pulso a cada tramo. */
export function conPulso(tramos: TramoCardio[], edad: number | undefined, modalidad: ModalidadCardio | "CALIBRACION"): TramoCardio[] {
  if (edad === undefined) return tramos;
  const fcMax = fcMaxima(edad);
  return tramos.map((tramo) => ({
    ...tramo,
    fcLpm: zonaLpm(fcMax, modalidad === "NORUEGO" && tramo.fase === "trabajo" ? ZONA_FC_NORUEGO : ZONA_FC[tramo.esfuerzo]),
  }));
}

export function programaCardio(input: ProgramaInput): ProgramaCardio {
  const duracion = duracionValida(input.duracion);
  const nivelHiit = nivelHiitValido(input.nivelHiit);
  const contexto = { ...(input.base !== undefined ? { base: input.base } : {}), nivelHiit };
  const resuelto = tramosDeModalidad(input.modalidad, duracion, nivelHiit);
  const esHiit = resuelto.modalidad === "HIIT";
  const hiit = esHiit ? hiitParaMaquina(input.maquina, duracion, nivelHiit, contexto) : null;
  const tramos = hiit?.tramos ?? tramosConControles(resuelto.tramos, input.maquina, contexto);
  const info = INFO_MODALIDAD[resuelto.modalidad];
  return {
    maquina: input.maquina,
    modalidad: resuelto.modalidad,
    nivel: esHiit ? nivelHiit : null,
    duracion,
    titulo: tituloPrograma(resuelto.modalidad, duracion, input.maquina, esHiit ? nivelHiit : null),
    fuente: hiit?.fuente ?? "plantilla",
    porque: info.porque,
    paraQuien: info.paraQuien,
    tramos: conPulso(tramos, input.edad, resuelto.modalidad),
    notaMaquina: notaDeMaquina(input.maquina),
    base: input.base ?? null,
    baseEstimada: false,
    calibracion: null,
    ajuste: resuelto.ajuste,
    fcMaxima: input.edad !== undefined ? fcMaxima(input.edad) : null,
  };
}
