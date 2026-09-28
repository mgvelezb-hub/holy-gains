import catalogoData from '../data/suplementos.json';
import type { MacroTargets, MealSlotId, Phase, Profile } from './types.js';

/**
 * Los suplementos del dia — logica PURA.
 *
 * Separados del menu a proposito. El menu resuelve macros: cada alimento entra
 * porque aporta proteina, carbohidrato o grasa, y el solver reparte gramos
 * hasta cuadrar el objetivo. La creatina y el omega-3 no cuadran nada —una no
 * tiene calorias y el otro aporta una grasa que no mueve el reparto—, asi que
 * meterlos al solver los volveria variables de una ecuacion a la que no
 * pertenecen.
 *
 * Dos capas, y ninguna vende nada:
 *
 * - **Tomas**: lo que la persona declaro tomar o acepto. Cada una con dosis,
 *   momento anclado a una comida y porque (`pautasDeSuplementos`).
 * - **Sugerencias**: lo que el motor propone por una SENAL concreta de sus
 *   datos —un laboratorio, un sintoma del check-in, el sueno del reloj—, con
 *   motivo, evidencia y que cambiaria (`sugerencias-suplementos.ts`). La
 *   persona acepta, dice que ya lo toma o lo descarta; nada entra solo.
 *
 * El catalogo vive en `data/suplementos.json`: dosis dentro de los topes de
 * las guias (UL de NIH ODS donde existe), evidencia citada y los frenos que
 * bloquean cada uno.
 */

export const SUPPLEMENTS = [
  'WHEY',
  'CREATINA',
  'OMEGA3',
  'VITAMINA_D3',
  'MAGNESIO',
  'ASHWAGANDHA',
  'CAFEINA',
  'CAFEINA_L_TEANINA',
  'ELECTROLITOS',
  'FIBRA',
  'ZINC',
  'VITAMINA_B12',
  'HIERRO',
  'MULTIVITAMINICO',
  'MELATONINA',
  'PROBIOTICO',
] as const;
export type Supplement = (typeof SUPPLEMENTS)[number];

export type CategoriaSuplemento = 'SUPLEMENTO' | 'INFUSION';

/**
 * A que se amarra la toma en el dia.
 *
 * Las comidas son el reloj que la persona ya sigue: "con la cena" se cumple
 * mas que "a las 21:00". Las anclas que no son comida (entreno, dormir) no
 * tienen slot y se dicen con palabras.
 */
export type AnclaSuplemento =
  | 'DESAYUNO'
  | 'MEDIA_MANANA'
  | 'COMIDA'
  | 'CENA'
  | 'PRE_ENTRENO'
  | 'POST_ENTRENO'
  | 'ENTRENO'
  | 'DORMIR'
  | 'LIBRE';

/** Para que objetivo tiene sentido. Solo desempata sugerencias, nunca las crea. */
export type ObjetivoSuplemento =
  | 'bajar_grasa'
  | 'ganar_musculo'
  | 'rendimiento'
  | 'sueno'
  | 'animo'
  | 'salud'
  | 'digestion';

export interface FichaSuplemento {
  id: Supplement;
  categoria: CategoriaSuplemento;
  nombre: string;
  /** Como se dice en una linea de aviso: "+ omega-3". */
  corto: string;
  dosis: { min: number; max: number; default: number; unidad: string };
  /** La dosis por defecto, dicha para leerse. */
  dosisTexto: string;
  momento: string;
  ancla: AnclaSuplemento;
  /** `true` con comida, `false` lejos de ella, `null` da igual. */
  conComida: boolean | null;
  porque: string;
  /** Cita corta: guia, autor y ano. Sin ella no entra al catalogo. */
  evidencia: string;
  /** Tope diario (UL de NIH ODS o de la guia citada). */
  tope: string;
  /**
   * Condiciones que lo bloquean. Casi todas son etiquetas de
   * `Profile.conditions` (`renal`, `hipertension`, `embarazo`...); unas pocas
   * se calculan de los datos (`sueno_corto`, `entreno_tarde`).
   */
  frenos: string[];
  /** Senales que lo sugieren (ids de regla de `sugerirSuplementos`). */
  senales: string[];
  objetivos: ObjetivoSuplemento[];
  /** Solo infusiones: como se prepara, en una linea. */
  preparacion?: string;
}

export const CATALOGO_SUPLEMENTOS: FichaSuplemento[] = catalogoData as FichaSuplemento[];

const POR_ID = new Map<string, FichaSuplemento>(CATALOGO_SUPLEMENTOS.map((ficha) => [ficha.id, ficha]));

/** La ficha de un id del catalogo; `undefined` si no existe. */
export function fichaDe(id: string): FichaSuplemento | undefined {
  return POR_ID.get(id);
}

/** `true` si el valor es un id del catalogo. Sirve para filtrar lo que llega de la DB. */
export function esSuplemento(valor: string): valor is Supplement {
  return POR_ID.has(valor);
}

export type PautaSuplemento = {
  supplement: Supplement;
  categoria: CategoriaSuplemento;
  /** Como se llama en la lista. */
  nombre: string;
  /** Como se dice en un aviso: "+ omega-3". */
  corto: string;
  /** Cuanto: "5 g", "1 medida (30 g)". */
  dosis: string;
  /** Cuando, dicho: "con la comida", "30 min antes de dormir". */
  momento: string;
  /** A que comida (o momento) se amarra. */
  ancla: AnclaSuplemento;
  /** Por que, en una linea. Sin esto es una instruccion sin razon. */
  porque: string;
  evidencia: string;
  tope: string;
};

/**
 * Fases donde la proteina en polvo tiene mas sentido.
 *
 * En corte agresivo la proteina objetivo es alta y las calorias bajas: llegar
 * con comida entera cuesta mas trabajo, y ahi el polvo resuelve. En fases de
 * mantenimiento no hace falta empujarlo.
 */
const FASES_CON_POLVO: readonly Phase[] = ['CUT', 'CUT_AGRESIVO', 'REFEED'];

/**
 * Cuanta proteina al dia hace pensar en polvo.
 *
 * Por encima de esto, llegar solo con comida entera implica cuatro o cinco
 * porciones grandes de carne al dia, que es donde la gente falla.
 */
const PROTEINA_ALTA_G = 150;

/** FDA: 400 mg/dia de cafeina en adultos sanos. ISSN: 3-6 mg/kg; se parte del piso. */
const CAFEINA_TOPE_MG = 400;
const CAFEINA_MG_KG = 3;

/** mg de cafeina para este peso: 3 mg/kg, redondeado a 10 mg y con tope. */
export function dosisCafeinaMg(pesoKg: number): number {
  return Math.min(Math.round((CAFEINA_MG_KG * pesoKg) / 10) * 10, CAFEINA_TOPE_MG);
}

/**
 * La pauta de lo que la persona toma: dosis, momento anclado a una comida y
 * porque. Solo lo declarado o aceptado — lo sugerido vive aparte hasta que la
 * persona dice que si.
 *
 * El orden es el del catalogo, que es estable: la lista no baila entre dias.
 */
export function pautasDeSuplementos(input: {
  profile: Profile;
  macros: MacroTargets;
  phase: Phase;
}): PautaSuplemento[] {
  const tiene = new Set<string>(input.profile.supplements ?? []);
  const pautas: PautaSuplemento[] = [];

  for (const ficha of CATALOGO_SUPLEMENTOS) {
    if (!tiene.has(ficha.id)) continue;

    const base: PautaSuplemento = {
      supplement: ficha.id,
      categoria: ficha.categoria,
      nombre: ficha.nombre,
      corto: ficha.corto,
      dosis: ficha.dosisTexto,
      momento: ficha.momento,
      ancla: ficha.ancla,
      porque: ficha.porque,
      evidencia: ficha.evidencia,
      tope: ficha.tope,
    };

    if (ficha.id === 'WHEY') {
      const proteinaAlta = input.macros.proteinG >= PROTEINA_ALTA_G;
      const faseExigente = FASES_CON_POLVO.includes(input.phase);
      const exigente = faseExigente || proteinaAlta;
      pautas.push({
        ...base,
        momento: exigente ? 'después de entrenar' : 'cuando no alcances con comida',
        ancla: exigente ? 'POST_ENTRENO' : 'LIBRE',
        porque: exigente
          ? `Tu objetivo de ${Math.round(input.macros.proteinG)} g de proteína cuesta llegar solo con comida entera.`
          : 'Es un recurso, no un requisito: con tu objetivo de hoy la comida entera alcanza.',
      });
      continue;
    }

    if (ficha.id === 'CAFEINA') {
      pautas.push({ ...base, dosis: `${dosisCafeinaMg(input.profile.weightKg)} mg (3 mg/kg)` });
      continue;
    }

    pautas.push(base);
  }

  return pautas;
}

// ---------------------------------------------------------------------------
// Tomas de hoy
// ---------------------------------------------------------------------------

export interface TomaDelDia {
  supplement: Supplement;
  categoria: CategoriaSuplemento;
  nombre: string;
  corto: string;
  dosis: string;
  /** La comida a la que se amarra; `null` si el ancla no es comida (dormir, entreno). */
  slot: MealSlotId | null;
  /** Cuando, dicho: "con la comida". */
  cuando: string;
  hecho: boolean;
}

/**
 * A que comida del dia cae cada ancla.
 *
 * Los menus no siempre traen desayuno, comida y cena con esos nombres (quien
 * entrena de tarde tiene "Cena (post-entreno)" como `POST`), asi que cada
 * ancla tiene su respaldo: el desayuno es la primera comida, la cena la
 * ultima, la comida la de en medio.
 */
function slotDeAncla(ancla: AnclaSuplemento, slots: readonly MealSlotId[]): MealSlotId | null {
  if (slots.length === 0) return null;
  const tiene = (s: MealSlotId) => (slots.includes(s) ? s : null);
  switch (ancla) {
    case 'DESAYUNO':
      return tiene('DESAYUNO') ?? tiene('PRE') ?? slots[0]!;
    case 'COMIDA':
      return tiene('COMIDA') ?? slots[Math.floor(slots.length / 2)]!;
    case 'CENA':
      return tiene('CENA') ?? slots[slots.length - 1]!;
    case 'MEDIA_MANANA': {
      // La segunda comida, si va antes de la comida fuerte.
      const comida = slots.indexOf('COMIDA');
      const segunda = slots[1];
      if (segunda && segunda !== 'COMIDA' && segunda !== 'CENA' && (comida === -1 || comida > 1)) return segunda;
      return null;
    }
    case 'PRE_ENTRENO':
      return tiene('PRE');
    case 'POST_ENTRENO':
      return tiene('POST');
    default:
      return null;
  }
}

/** Orden en el dia: las comidas por su lugar, dormir al final. */
function ordenDe(ancla: AnclaSuplemento, slot: MealSlotId | null, slots: readonly MealSlotId[]): number {
  if (slot) return slots.indexOf(slot) * 10 + 1;
  switch (ancla) {
    case 'LIBRE':
      return 0;
    case 'PRE_ENTRENO':
      return 5;
    case 'ENTRENO':
      return 12;
    case 'POST_ENTRENO':
      return 14;
    case 'DORMIR':
      return 1000;
    default:
      return 500;
  }
}

/**
 * Las tomas del dia, amarradas a las comidas del menu y con lo ya registrado.
 *
 * `slots` va en el orden del dia (el del menu vigente). `logs` son los
 * `SupplementLog` de hoy.
 */
export function tomasDeHoy(input: {
  pautas: PautaSuplemento[];
  slots: readonly MealSlotId[];
  logs: Array<{ supplement: string; taken: boolean }>;
}): TomaDelDia[] {
  const hechas = new Set(input.logs.filter((l) => l.taken).map((l) => l.supplement));
  return input.pautas
    .map((p, i) => {
      const slot = slotDeAncla(p.ancla, input.slots);
      return {
        orden: ordenDe(p.ancla, slot, input.slots),
        i,
        toma: {
          supplement: p.supplement,
          categoria: p.categoria,
          nombre: p.nombre,
          corto: p.corto,
          dosis: p.dosis,
          slot,
          cuando: p.momento,
          hecho: hechas.has(p.supplement),
        } satisfies TomaDelDia,
      };
    })
    .sort((a, b) => a.orden - b.orden || a.i - b.i)
    .map((x) => x.toma);
}

/** La linea de la tarjeta de Hoy: "1 de 3 · siguiente: omega-3 con la comida". */
export function resumenTomas(tomas: TomaDelDia[]): {
  hechas: number;
  total: number;
  siguiente: TomaDelDia | null;
  linea: string;
} {
  const total = tomas.length;
  const hechas = tomas.filter((t) => t.hecho).length;
  const siguiente = tomas.find((t) => !t.hecho) ?? null;
  let linea = 'Sin tomas';
  if (total > 0 && !siguiente) linea = `${hechas} de ${total} · listo por hoy`;
  else if (siguiente) linea = `${hechas} de ${total} · siguiente: ${siguiente.corto} ${siguiente.cuando}`;
  return { hechas, total, siguiente, linea };
}

/**
 * ¿El menu puede usar polvos de proteina como alimento?
 *
 * Si la persona no tiene proteina en polvo, el solver no debe repartirle
 * gramos: un menu que pide 30 g de whey a quien no tiene whey es un menu que
 * no se puede seguir.
 */
export function permitePolvos(profile: Profile): boolean {
  return (profile.supplements ?? []).includes('WHEY');
}
