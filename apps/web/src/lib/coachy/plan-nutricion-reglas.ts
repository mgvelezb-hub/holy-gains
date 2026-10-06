import type { TomaDelDia } from "engine";

import { DIAS_SEMANA, type DiaSemana } from "@/lib/coachy/horarios";
import type { GroceryItemView } from "@/lib/coachy/menu-view";
import type { EngineProfile } from "@/lib/engine-types";

/**
 * Las reglas puras del plan canónico de nutrición (K1).
 *
 * `planDeNutricion` junta filas; aquí se decide qué significan. Cada regla
 * vive una sola vez para que la pestaña, la hoja del plan, el menú, la lista,
 * los recordatorios y el replanteo digan lo mismo:
 *
 * - La glucosa en ayuno de un estudio prende "glucosa alta" en el motor (IG
 *   bajo y piso de fibra). Antes solo lo hacía la etiqueta del perfil, que
 *   nadie captura: el estudio se guardaba y el menú no se enteraba.
 * - El freno clínico pausa las tomas, no solo las sugerencias.
 * - El porqué del plan cabe en una línea y sale de la fase y los números.
 */

/**
 * 100 mg/dL en ayuno: el umbral de glucosa alterada en ayuno de la ADA. No es
 * un diagnóstico —eso es del médico—; es la señal con la que el menú se
 * cuida, igual que ya hacía la etiqueta `glucosa_alta`.
 */
export const GLUCOSA_AYUNO_ALTA = 100;

const LLAVES_GLUCOSA = ["glucosa"];
const LLAVES_VITAMINA_D = ["vitamina_d", "vit_d", "25oh", "25_oh", "calcidiol"];

export interface Lectura {
  valor: number;
  fecha: string;
}

export interface SenalesClinicas {
  glucosaAyuno: Lectura | null;
  vitaminaD: Lectura | null;
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000);
}

/** La lectura más reciente del último año de las llaves dadas. */
function ultima(labs: Array<{ takenOn: string; valuesJson: unknown }>, llaves: string[], hoy: string): Lectura | null {
  let mejor: Lectura | null = null;
  for (const lab of labs) {
    const edad = diasEntre(lab.takenOn, hoy);
    if (edad < 0 || edad > 365 || !Array.isArray(lab.valuesJson)) continue;
    for (const crudo of lab.valuesJson) {
      if (typeof crudo !== "object" || crudo === null) continue;
      const fila = crudo as Record<string, unknown>;
      if (typeof fila.key !== "string" || typeof fila.value !== "number") continue;
      const llave = fila.key.toLowerCase();
      if (!llaves.some((patron) => llave.includes(patron))) continue;
      if (!mejor || mejor.fecha < lab.takenOn) mejor = { valor: fila.value, fecha: lab.takenOn };
    }
  }
  return mejor;
}

/** Lo que los estudios del último año le dicen al plan. */
export function senalesDeLabs(
  labs: Array<{ takenOn: string; valuesJson: unknown }>,
  hoy: string,
): SenalesClinicas {
  return {
    glucosaAyuno: ultima(labs, LLAVES_GLUCOSA, hoy),
    vitaminaD: ultima(labs, LLAVES_VITAMINA_D, hoy),
  };
}

/**
 * El perfil del motor con lo que dicen los estudios. Si no cambia nada,
 * devuelve el mismo objeto: la etiqueta del perfil sigue mandando.
 */
export function conSenalesClinicas(perfil: EngineProfile, senales: SenalesClinicas): EngineProfile {
  const glucosaAlta = (senales.glucosaAyuno?.valor ?? 0) >= GLUCOSA_AYUNO_ALTA;
  if (!glucosaAlta || perfil.conditions?.glucosaAlta) return perfil;
  return { ...perfil, conditions: { ...perfil.conditions, glucosaAlta: true } };
}

/** 7 700 kcal por kilo de grasa: la conversión práctica de siempre. */
const KCAL_POR_KG = 7700;

function redondea50(valor: number): number {
  return Math.round(valor / 50) * 50;
}

/**
 * El porqué del plan en una línea: fase, cuánto por debajo (o encima) del
 * gasto, qué ritmo da eso y para qué es la proteína. Los números salen de la
 * decisión y del gasto del motor; el texto no promete otra cosa.
 */
export function porqueDelPlan(entrada: {
  phase: string;
  kcal: number;
  gastoKcal: number;
  proteinG: number;
}): string {
  const deficit = redondea50(entrada.gastoKcal - entrada.kcal);
  const ritmo = Math.round(((Math.max(deficit, 0) * 7) / KCAL_POR_KG) * 10) / 10;
  const proteina = `${entrada.proteinG} g`;

  switch (entrada.phase) {
    case "CUT":
      return `Corte: −${deficit} kcal para bajar ≈${ritmo} kg/semana; proteína alta (${proteina}) para conservar músculo.`;
    case "CUT_AGRESIVO":
      return `Corte fuerte: −${deficit} kcal por pocas semanas, comida y cena sin carbohidrato denso; proteína alta (${proteina}) para conservar músculo.`;
    case "BASE":
      return `Base: −${deficit} kcal, un déficit suave para arrancar a ≈${ritmo} kg/semana sin pelear con el hambre; proteína de ${proteina}.`;
    case "REINTRO":
      return `Reintroducción: comes cerca de tu gasto para que el cuerpo retome el ritmo; proteína de ${proteina} desde el primer día.`;
    case "REFEED":
      return `Recarga: más carbohidrato unos días para recuperar energía y fuerza; la proteína se queda en ${proteina}.`;
    case "ESTABILIZACION":
      return `Estabilización: subes cerca de tu gasto para que el peso nuevo se asiente; proteína de ${proteina}.`;
    default:
      return `Mantenimiento: comes lo que gastas (≈${entrada.kcal} kcal); proteína de ${proteina} para sostener lo ganado.`;
  }
}

/** Con freno clínico nada se toma hasta que lo vea un médico: las tomas se pausan. */
export function tomasDelPlan(
  tomas: TomaDelDia[],
  freno: string | null,
): { tomas: TomaDelDia[]; pausadas: number } {
  return freno ? { tomas: [], pausadas: tomas.length } : { tomas, pausadas: 0 };
}

/**
 * La hora que rige cada comida cada día: la del día si la movió, la general si
 * no, la del motor si nunca tocó nada. Los siete días, siempre: quien lee no
 * tiene que cruzar tres fuentes.
 */
export function horariosEfectivos(
  comidas: Array<{ slot: string; timeHint: string }>,
  generales: Record<string, string>,
  porDia: Record<string, Record<string, string>>,
): Record<DiaSemana, Record<string, string>> {
  const salida = {} as Record<DiaSemana, Record<string, string>>;
  for (const dia of DIAS_SEMANA) {
    salida[dia] = Object.fromEntries(
      comidas.map((comida) => [comida.slot, porDia[dia]?.[comida.slot] ?? generales[comida.slot] ?? comida.timeHint]),
    );
  }
  return salida;
}

export interface DespensaDelPlan {
  /** Cuántos alimentos tiene en casa. */
  total: number;
  /** Cuántos de ellos entran en alguno de los menús. */
  enMenu: number;
  /** Cuántos marca la lista de súper como "ya lo tienes". */
  enCasa: number;
  /** Ids de la despensa que esta semana no usa. */
  sinUso: string[];
}

export function despensaDelPlan(
  pantry: string[],
  idsPorMenu: string[][],
  groceries: GroceryItemView[],
): DespensaDelPlan {
  const usados = new Set(idsPorMenu.flat());
  const enMenu = pantry.filter((id) => usados.has(id));
  return {
    total: pantry.length,
    enMenu: enMenu.length,
    enCasa: groceries.filter((item) => item.enDespensa === true).length,
    sinUso: pantry.filter((id) => !usados.has(id)),
  };
}

export interface AvisoDelPlan {
  id: "freno" | "glucosa" | "vitamina_d" | "despensa" | "ciclo";
  /** `freno` va arriba y en rojo; `aviso` cambia el plan; `info` solo se dice. */
  nivel: "freno" | "aviso" | "info";
  /** Para la tarjeta de una línea: título y resumen. */
  titulo: string;
  corto: string;
  /** La explicación completa (va en el InfoTip). */
  texto: string;
  accion?: { etiqueta: string; ruta: string };
}

/**
 * Lo que la persona tiene que ver del plan, en orden de importancia. Cada
 * aviso trae la acción que lo resuelve: un aviso sin salida es ruido.
 */
export function avisosDelPlan(entrada: {
  freno: string | null;
  tomasPausadas: number;
  senales: SenalesClinicas;
  glucosaAlta: boolean;
  fibraG: number | null;
  sugiereD3: boolean;
  despensa: DespensaDelPlan;
}): AvisoDelPlan[] {
  const avisos: AvisoDelPlan[] = [];

  if (entrada.freno) {
    const pausa =
      entrada.tomasPausadas > 0
        ? ` Mientras tanto pausamos tus ${entrada.tomasPausadas} ${entrada.tomasPausadas === 1 ? "toma" : "tomas"}.`
        : "";
    avisos.push({
      id: "freno",
      nivel: "freno",
      titulo: "Freno clínico",
      corto: entrada.tomasPausadas > 0 ? "Tomas en pausa · consulta a tu médico" : "Consulta a tu médico",
      texto: `${entrada.freno}${pausa}`,
      accion: { etiqueta: "Ver tus estudios", ruta: "/laboratorios" },
    });
  }

  const glucosa = entrada.senales.glucosaAyuno;
  if (entrada.glucosaAlta) {
    const origen = glucosa && glucosa.valor >= GLUCOSA_AYUNO_ALTA
      ? `Tu glucosa en ayuno salió en ${glucosa.valor} mg/dL`
      : "Marcaste glucosa alta";
    const fibra = entrada.fibraG !== null ? ` y fibra de ${entrada.fibraG} g` : " y más fibra";
    avisos.push({
      id: "glucosa",
      nivel: "aviso",
      titulo: glucosa && glucosa.valor >= GLUCOSA_AYUNO_ALTA ? `Glucosa ${glucosa.valor} mg/dL` : "Glucosa alta",
      corto: `IG bajo${entrada.fibraG !== null ? ` · fibra ${entrada.fibraG} g` : " · más fibra"}`,
      texto: `${origen}: el menú usa carbohidratos de índice glucémico bajo${fibra}.`,
    });
  }

  const vitaminaD = entrada.senales.vitaminaD;
  if (vitaminaD && vitaminaD.valor < 30) {
    avisos.push(
      entrada.sugiereD3
        ? {
            id: "vitamina_d",
            nivel: "aviso",
            titulo: `Vitamina D ${vitaminaD.valor} ng/mL`,
            corto: "Te sugerimos D3",
            texto: `Tu vitamina D salió en ${vitaminaD.valor} ng/mL: te sugerimos vitamina D3.`,
            accion: { etiqueta: "Decidir la D3", ruta: "/ajustes/suplementos?s=VITAMINA_D3" },
          }
        : {
            id: "vitamina_d",
            nivel: "info",
            titulo: `Vitamina D ${vitaminaD.valor} ng/mL`,
            corto: "Por debajo de 30",
            texto: `Tu vitamina D salió en ${vitaminaD.valor} ng/mL.`,
            accion: { etiqueta: "Ver tus suplementos", ruta: "/ajustes/suplementos" },
          },
    );
  }

  if (entrada.despensa.sinUso.length > 0) {
    const n = entrada.despensa.sinUso.length;
    avisos.push({
      id: "despensa",
      nivel: "info",
      titulo: "Despensa",
      corto: `${n} de ${entrada.despensa.total} sin usar esta semana`,
      texto: `${n} de tus ${entrada.despensa.total} alimentos de la despensa no ${n === 1 ? "entra" : "entran"} esta semana.`,
      accion: { etiqueta: "Revisar la despensa", ruta: "/ajustes/despensa" },
    });
  }

  return avisos;
}

export interface RecordatorioDelPlan {
  slot: string;
  label: string;
  menuNumber: number;
  items: Array<{ name: string; display?: string }>;
  /** Tomas amarradas a esta comida ("creatina"). */
  extras: string[];
  /** El cuerpo del "Prepárate": el menú y "+ creatina". */
  cuerpo: string;
  horaPorDia: Record<string, string>;
}

/** El cuerpo del "Prepárate": nombres sin gramos, máximo cuatro, y las tomas. */
export function cuerpoPreparate(items: Array<{ name: string; display?: string | null }>, extras: string[]): string {
  const menu = items.slice(0, 4).map((item) => item.display ?? item.name).join(", ") || "Ya casi es hora de tu comida.";
  return extras.length === 0 ? menu : `${menu} + ${extras.join(" + ")}`;
}

/**
 * Lo que el teléfono programa: por comida del menú de hoy, su "Prepárate" ya
 * escrito y la hora de cada día. La app no cruza horarios ni tomas por su
 * cuenta.
 */
export function recordatoriosDelPlan(
  menuNumber: number,
  comidas: Array<{ slot: string; label: string; timeHint: string; items: Array<{ name: string; display: string | null }> }>,
  tomas: TomaDelDia[],
  horarios: Record<DiaSemana, Record<string, string>>,
): RecordatorioDelPlan[] {
  return comidas.map((comida) => {
    const extras = tomas.filter((toma) => toma.slot === comida.slot).map((toma) => toma.corto);
    const items = comida.items.map((item) => ({ name: item.name, ...(item.display ? { display: item.display } : {}) }));
    return {
      slot: comida.slot,
      label: comida.label,
      menuNumber,
      items,
      extras,
      cuerpo: cuerpoPreparate(comida.items, extras),
      horaPorDia: Object.fromEntries(
        DIAS_SEMANA.map((dia) => [dia, horarios[dia]?.[comida.slot] ?? comida.timeHint]),
      ),
    };
  });
}
