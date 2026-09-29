import type { DisciplineLoad, UnidadVelocidad, WarmupStep } from "@/lib/api";
import type {
  EquipoCardioP1,
  MaquinaCardio,
  MaquinaConBase,
  ModalidadCardio,
  NivelBase,
  NivelesBaseCardio,
  PreferenciasCardioP1,
  ProgramaCardio,
  TipoCardioP1,
  TramoCardio,
} from "@/lib/api-cardio";
import { textoVelocidad, type EsfuerzoDeFila } from "@/lib/hiit";

/**
 * El cardio de toda máquina y modalidad (P1) en el teléfono — lógica PURA.
 *
 * La web calcula el programa minuto a minuto con los controles de la
 * máquina ya puestos (`control.texto`); aquí solo se traduce a lo que se ve:
 * las filas de la tabla, los pasos del corredor, el renglón del nivel base y
 * lo que se guarda en las preferencias. Lo único que se recalcula en el
 * teléfono es km/h → mph de la caminadora, con la misma regla de la web.
 */

export const OPCIONES_MAQUINA: Array<{ valor: MaquinaCardio; nombre: string }> = [
  { valor: "CAMINADORA", nombre: "Caminadora" },
  { valor: "ELIPTICA", nombre: "Elíptica" },
  { valor: "REMO", nombre: "Remo" },
  { valor: "BICI", nombre: "Bici" },
  { valor: "BICI_AIRE", nombre: "Bici de aire" },
  { valor: "ESCALERA", nombre: "Escaladora" },
  { valor: "SKI_ERG", nombre: "SkiErg" },
];

export const NOMBRE_MAQUINA: Record<EquipoCardioP1, string> = {
  CAMINADORA: "Caminadora",
  ELIPTICA: "Elíptica",
  REMO: "Remo",
  BICI: "Bici",
  BICI_AIRE: "Bici de aire",
  ESCALERA: "Escaladora",
  SKI_ERG: "SkiErg",
  LIBRE: "Libre",
};

/** Igual que `INFO_MODALIDAD` de la web (`modalidades-cardio.ts`), más el variado de `cardio.ts`. */
export const INFO_MODALIDAD: Record<ModalidadCardio | "VARIADO", { nombre: string; porque: string; paraQuien: string }> = {
  HIIT: {
    nombre: "HIIT",
    porque: "Intervalos: bajan la misma grasa que el continuo en ~40 % menos tiempo (Keating 2017; Wewege 2017).",
    paraQuien: "Bajar grasa con poco tiempo y subir la condición.",
  },
  ZONA2: {
    nombre: "Zona 2",
    porque:
      "Continuo a ritmo de conversación (60–70 % FCmáx): construye base aeróbica y se recupera rápido; es el grueso del volumen de los atletas de resistencia (Seiler 2010).",
    paraQuien: "Condición base y bajar grasa sin sumar fatiga.",
  },
  TEMPO: {
    nombre: "Tempo",
    porque:
      "Bloques de 8–10 min cerca del umbral (Moderado Alto–Fuerte): suben el ritmo que aguantas antes de que el pulso se dispare (Seiler 2010).",
    paraQuien: "Condición y rendimiento, para quien ya domina la zona 2.",
  },
  NORUEGO: {
    nombre: "4×4",
    porque:
      "4 × 4 min al 85–95 % FCmáx con 3 min de recuperación activa: subió el VO₂máx más que el continuo o el umbral en 8 semanas (Helgerud 2007).",
    paraQuien: "Condición (VO₂máx) y rendimiento; pide al menos 35 min.",
  },
  PIRAMIDAL: {
    nombre: "Piramidal",
    porque: "1-2-3-2-1 min subiendo y bajando el esfuerzo, con recuperaciones iguales: toca todas las intensidades en una sesión.",
    paraQuien: "Condición, y quien ya se aburrió del HIIT de siempre.",
  },
  RECUPERACION: {
    nombre: "Recuperación",
    porque: "Fácil sostenido, por debajo del primer umbral: mueve la sangre sin sumar fatiga (zona 1, Seiler 2010).",
    paraQuien: "Semana de descarga y el día después de pierna pesada.",
  },
  VARIADO: {
    nombre: "Variado",
    porque:
      "Alterna modalidades en la semana según tu objetivo (bajar grasa: 2 HIIT + 1 zona 2 + 1 recuperación); la mayor parte suave y poco intenso, el reparto polarizado (Seiler 2010).",
    paraQuien: "Quien no quiere pensar cuál toca: la app la elige cada día.",
  },
};

export const OPCIONES_MODALIDAD: Array<{ valor: Exclude<TipoCardioP1, "CONTINUO">; nombre: string }> = (
  ["HIIT", "ZONA2", "TEMPO", "NORUEGO", "PIRAMIDAL", "RECUPERACION", "VARIADO"] as const
).map((valor) => ({ valor, nombre: INFO_MODALIDAD[valor].nombre }));

/** `CONTINUO` es el nombre viejo de zona 2: en los chips se ve como zona 2. */
export function modalidadElegida(tipo: TipoCardioP1 | undefined): Exclude<TipoCardioP1, "CONTINUO"> {
  if (tipo === "CONTINUO") return "ZONA2";
  return tipo ?? "HIIT";
}

export const MAQUINAS_CON_BASE: readonly MaquinaConBase[] = ["ELIPTICA", "BICI", "ESCALERA", "REMO", "SKI_ERG", "BICI_AIRE"];

export function necesitaBase(maquina: EquipoCardioP1 | undefined): maquina is MaquinaConBase {
  return maquina !== undefined && (MAQUINAS_CON_BASE as readonly string[]).includes(maquina);
}

/* ------------------------------------------------------------------------ */
/* Nivel base                                                                */
/* ------------------------------------------------------------------------ */

/** "Resist. 8", "2:20/500 m", "120 W" — como se lee en la máquina. */
export function textoNivelBase(maquina: MaquinaConBase, valor: NivelBase): string {
  if (typeof valor === "number") return maquina === "ESCALERA" ? `Nivel ${valor}` : `Resist. ${valor}`;
  if ("ritmo500" in valor) return `${valor.ritmo500}/500 m`;
  return `${valor.watts} W`;
}

/** El renglón "Tu nivel base en esta máquina": su valor, o que se calibra; la caminadora no lo usa. */
export function renglonNivelBase(maquina: EquipoCardioP1, bases: NivelesBaseCardio | undefined): string {
  if (maquina === "CAMINADORA") return "No hace falta: va por los km/h de tus protocolos.";
  if (maquina === "LIBRE") return "Sin máquina: se mide por esfuerzo.";
  const valor = bases?.[maquina];
  return valor === undefined ? "Se calibra en la primera sesión." : textoNivelBase(maquina, valor);
}

/** `otherDisciplines` con el nivel base de `maquina` guardado en las preferencias de CARDIO. */
export function conNivelBase(otras: readonly DisciplineLoad[], maquina: MaquinaConBase, valor: NivelBase): DisciplineLoad[] {
  return conPreferencias(otras, (prefs) => ({ ...prefs, nivelBase: { ...prefs.nivelBase, [maquina]: valor } }));
}

/** "Usar siempre": la máquina y la modalidad de hoy pasan a ser la preferencia. */
export function conMaquinaYModalidad(
  otras: readonly DisciplineLoad[],
  equipo: EquipoCardioP1,
  tipo?: TipoCardioP1,
): DisciplineLoad[] {
  return conPreferencias(otras, (prefs) => ({ ...prefs, equipo, ...(tipo ? { tipo } : {}) }));
}

function conPreferencias(
  otras: readonly DisciplineLoad[],
  cambiar: (prefs: PreferenciasCardioP1) => PreferenciasCardioP1,
): DisciplineLoad[] {
  return otras.map((carga) => {
    if (carga.discipline !== "CARDIO") return carga;
    const actual = carga as DisciplineLoad & { cardio?: PreferenciasCardioP1 };
    return { ...actual, cardio: cambiar(actual.cardio ?? {}) } as DisciplineLoad;
  });
}

/* ------------------------------------------------------------------------ */
/* Tabla y corredor                                                          */
/* ------------------------------------------------------------------------ */

/** Lo que dice el tramo de la máquina: la caminadora en la unidad elegida; lo demás, como viene. */
export function textoControl(tramo: Pick<TramoCardio, "control" | "fase">, unidad: UnidadVelocidad): string {
  const { control } = tramo;
  // La caminata de relleno ya se nombra en la columna de esfuerzo.
  if (control.maquina === "CAMINADORA" && control.kmh) return textoVelocidad(control.kmh, unidad);
  return control.texto;
}

/** El esfuerzo que se enseña: la caminata de relleno se llama así, con el color de Fácil. */
export function esfuerzoDeTramo(tramo: Pick<TramoCardio, "esfuerzo" | "fase">): EsfuerzoDeFila {
  return tramo.fase === "caminata" ? "Caminata" : tramo.esfuerzo;
}

export function textoLpm(fcLpm: readonly [number, number] | undefined): string | null {
  return fcLpm ? `${fcLpm[0]}–${fcLpm[1]} lpm` : null;
}

export type FilaPrograma = {
  tiempo: string;
  control: string;
  esfuerzo: EsfuerzoDeFila;
  lpm: string | null;
  inferido: boolean;
};

/** Las filas de la tabla: Tiempo · Control · Esfuerzo (y lpm si la web los mandó). */
export function filasDePrograma(programa: ProgramaCardio, unidad: UnidadVelocidad): FilaPrograma[] {
  return programa.tramos.map((tramo) => ({
    tiempo: `${tramo.desdeMin}–${tramo.hastaMin} min`,
    control: textoControl(tramo, unidad),
    esfuerzo: esfuerzoDeTramo(tramo),
    lpm: textoLpm(tramo.fcLpm),
    inferido: tramo.inferido === true,
  }));
}

/** ¿El programa trae pulso por tramo? */
export function tienePulso(programa: ProgramaCardio): boolean {
  return programa.tramos.some((tramo) => tramo.fcLpm !== undefined);
}

/** El índice del primer tramo después de la calibración (la zona 2), o `null` si no es calibración. */
export function indiceTrasCalibracion(programa: ProgramaCardio): number | null {
  if (!programa.calibracion) return null;
  const indice = programa.tramos.findIndex((tramo) => tramo.fase !== "calibracion");
  return indice === -1 ? null : indice;
}

/** El valor de calibración del paso en curso (lo que se guarda al tocar "Aquí voy moderado"). */
export function valorDeCalibracion(programa: ProgramaCardio, paso: number): NivelBase | null {
  if (!programa.calibracion || programa.tramos[paso]?.fase !== "calibracion") return null;
  const tramo = programa.tramos[paso]!;
  return programa.calibracion.pasos.find((p) => p.desdeMin === tramo.desdeMin)?.valor ?? null;
}

/**
 * Lo que se pone en la máquina en un tramo. Tras calibrar, los tramos que
 * decían "El que marcaste" dicen el valor marcado.
 */
export function controlDelTramo(
  tramo: TramoCardio,
  unidad: UnidadVelocidad,
  marcado?: { maquina: MaquinaConBase; valor: NivelBase } | null,
): string {
  if (marcado && tramo.control.texto.includes("marcaste")) {
    const valor = textoNivelBase(marcado.maquina, marcado.valor);
    return tramo.fase === "enfriamiento" ? `Un poco menos que ${valor}` : valor;
  }
  return textoControl(tramo, unidad);
}

/** El esfuerzo como se lee: la caminata de relleno es "Caminata suave". */
export function nombreDeEsfuerzo(tramo: Pick<TramoCardio, "esfuerzo" | "fase">): string {
  const esfuerzo = esfuerzoDeTramo(tramo);
  return esfuerzo === "Caminata" ? "Caminata suave" : esfuerzo;
}

/** Lo que se lee de un tramo en una línea: "Resist. 10 · 140 SPM · Moderado". */
export function textoDelTramoCardio(
  tramo: TramoCardio,
  unidad: UnidadVelocidad,
  marcado?: { maquina: MaquinaConBase; valor: NivelBase } | null,
): string {
  return `${controlDelTramo(tramo, unidad, marcado)} · ${nombreDeEsfuerzo(tramo)}`;
}

/** Los pasos que corre el timer: un paso por tramo. */
export function pasosDePrograma(
  programa: ProgramaCardio,
  unidad: UnidadVelocidad,
  marcado?: { maquina: MaquinaConBase; valor: NivelBase } | null,
): WarmupStep[] {
  return programa.tramos.map((tramo) => ({
    nombre: textoDelTramoCardio(tramo, unidad, marcado),
    segundos: (tramo.hastaMin - tramo.desdeMin) * 60,
  }));
}

const ABREVIADO: Record<EsfuerzoDeFila, string> = {
  Fácil: "Fácil",
  Moderado: "Moderado",
  "Moderado Alto": "M. Alto",
  Fuerte: "Fuerte",
  Máximo: "Máximo",
  Caminata: "Caminata",
};

function reloj(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Lo que va al reloj: el tramo en corto ("Resist. 10 · 140 SPM · M. Alto · 1:15"), igual que N1. */
export function textoParaRelojPrograma(input: {
  programa: ProgramaCardio;
  paso: number;
  restanteSeg: number;
  unidad: UnidadVelocidad;
}): {
  workoutId: string;
  titulo: string;
  ejercicios: [];
  cardio: { tramo: string; restanteSeg: number; siguiente: string | null };
} {
  const { tramos } = input.programa;
  const actual = tramos[input.paso] ?? tramos.at(-1)!;
  const siguiente = tramos[input.paso + 1];
  return {
    workoutId: "cardio",
    titulo: `${textoControl(actual, input.unidad)} · ${ABREVIADO[esfuerzoDeTramo(actual)]} · ${reloj(input.restanteSeg)}`,
    ejercicios: [],
    cardio: {
      tramo: textoDelTramoCardio(actual, input.unidad),
      restanteSeg: input.restanteSeg,
      siguiente: siguiente ? textoDelTramoCardio(siguiente, input.unidad) : null,
    },
  };
}

/* ------------------------------------------------------------------------ */
/* Calibración dentro de la modalidad elegida (Q1)                           */
/* ------------------------------------------------------------------------ */

type ModalidadDeChip = Exclude<TipoCardioP1, "CONTINUO" | "VARIADO">;

/**
 * El chip de modalidad que va marcado: la elegida para hoy si la hay (zona 2
 * aunque se guarde `CONTINUO`; `VARIADO` no es chip, va la que resolvió el
 * servidor), si no la del programa. Un programa viejo con `CALIBRACION` no
 * marca ninguno: no se inventa.
 */
export function modalidadDelChip(programa: ProgramaCardio, elegida?: TipoCardioP1): ModalidadDeChip | null {
  if (elegida && elegida !== "VARIADO") return modalidadElegida(elegida) as ModalidadDeChip;
  return programa.modalidad === "CALIBRACION" ? null : programa.modalidad;
}

function nombreDeModalidad(programa: ProgramaCardio, elegida?: TipoCardioP1): string | null {
  const modalidad = modalidadDelChip(programa, elegida);
  return modalidad ? INFO_MODALIDAD[modalidad].nombre : null;
}

/** "Primera vez en esta máquina: 5 min para calibrar y sigue tu HIIT", o `null` si no calibra. */
export function lineaDeCalibracion(programa: ProgramaCardio, elegida?: TipoCardioP1): string | null {
  if (!programa.calibracion) return null;
  const minutos = programa.tramos.filter((tramo) => tramo.fase === "calibracion").reduce((suma, t) => suma + t.hastaMin - t.desdeMin, 0);
  const nombre = nombreDeModalidad(programa, elegida);
  return `Primera vez en esta máquina: ${minutos} min para calibrar${nombre ? ` y sigue tu ${nombre}` : ""}`;
}

/** El renglón que abre la hoja: "Solo hoy · Elíptica · HIIT · calibra". */
export function renglonHojaCardio(input: { programa: ProgramaCardio; soloHoy: boolean; elegida?: TipoCardioP1 }): string {
  const { programa } = input;
  const partes = [
    input.soloHoy ? "Solo hoy" : "Máquina y modalidad",
    OPCIONES_MAQUINA.find((opcion) => opcion.valor === programa.maquina)?.nombre ?? NOMBRE_MAQUINA[programa.maquina],
    nombreDeModalidad(programa, input.elegida) ?? "Calibración",
  ];
  if (programa.calibracion) partes.push("calibra");
  return partes.join(" · ");
}

function mismaBase(a: NivelBase, b: NivelBase): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * "Aquí voy moderado": los tramos que siguen a la calibración pasan a los
 * calculados con el valor marcado (`tramosSiMarcas`, mismas duraciones: el
 * timer no se mueve). Sin calibración o de un servidor viejo, queda igual.
 */
export function programaConMarcado(programa: ProgramaCardio, valor: NivelBase): ProgramaCardio {
  const paso = programa.calibracion?.pasos.find((p) => mismaBase(p.valor, valor));
  if (!paso?.tramosSiMarcas) return programa;
  const calibracion = programa.tramos.filter((tramo) => tramo.fase === "calibracion");
  return { ...programa, tramos: [...calibracion, ...paso.tramosSiMarcas], base: valor, baseEstimada: false };
}

/** Una base razonable por máquina cuando no se sabe (la "básica" de la web). */
const BASE_POR_DEFECTO: Record<MaquinaConBase, NivelBase> = {
  ELIPTICA: 6,
  BICI: 6,
  ESCALERA: 6,
  REMO: { ritmo500: "2:40" },
  SKI_ERG: { ritmo500: "2:40" },
  BICI_AIRE: { watts: 80 },
};

function formaDe(valor: NivelBase): "numero" | "ritmo" | "watts" {
  if (typeof valor === "number") return "numero";
  return "ritmo500" in valor ? "ritmo" : "watts";
}

/** Dónde arranca el editor del nivel base: la base que usa el programa si es de esa máquina, o la de por defecto. */
export function baseSugerida(maquina: MaquinaConBase, conocida: NivelBase | null | undefined): NivelBase {
  const defecto = BASE_POR_DEFECTO[maquina];
  return conocida !== null && conocida !== undefined && formaDe(conocida) === formaDe(defecto) ? conocida : defecto;
}

const TOPE_RESISTENCIA: [number, number] = [1, 30];
const TOPE_RITMO_SEG: [number, number] = [90, 240];
const TOPE_WATTS: [number, number] = [20, 600];

function entre(valor: number, [min, max]: [number, number]): number {
  return Math.min(max, Math.max(min, valor));
}

function segundosDeRitmo(ritmo: string): number {
  const [min, seg] = ritmo.split(":").map(Number);
  return (min ?? 0) * 60 + (seg ?? 0);
}

function ritmoATexto(segundos: number): string {
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
}

/** Un paso del editor; `+1` es más intenso: resistencia +1, ritmo 5 s más rápido, watts +10. */
export function moverNivelBase(valor: NivelBase, sentido: 1 | -1): NivelBase {
  if (typeof valor === "number") return entre(valor + sentido, TOPE_RESISTENCIA);
  if ("ritmo500" in valor) {
    return { ritmo500: ritmoATexto(entre(segundosDeRitmo(valor.ritmo500) - sentido * 5, TOPE_RITMO_SEG)) };
  }
  return { watts: entre(valor.watts + sentido * 10, TOPE_WATTS) };
}
