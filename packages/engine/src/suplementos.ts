import catalogoData from '../data/suplementos.json';
import type { MacroTargets, Phase, Profile } from './types.js';

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
  /** Como se llama en la lista. */
  nombre: string;
  /** Cuanto: "5 g", "1 medida (30 g)". */
  dosis: string;
  /** Cuando: "cualquier hora", "con la comida", "despues de entrenar". */
  momento: string;
  /** Por que, en una linea. Sin esto es una instruccion sin razon. */
  porque: string;
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

export function pautasDeSuplementos(input: {
  profile: Profile;
  macros: MacroTargets;
  phase: Phase;
}): PautaSuplemento[] {
  const tiene = new Set(input.profile.supplements ?? []);
  const pautas: PautaSuplemento[] = [];

  if (tiene.has('CREATINA')) {
    pautas.push({
      supplement: 'CREATINA',
      nombre: 'Creatina monohidratada',
      dosis: '5 g',
      // La creatina se acumula en el musculo: lo que importa es tomarla todos
      // los dias, no la hora. Prescribir un horario exacto sugiere una
      // precision que el suplemento no tiene.
      momento: 'a cualquier hora, todos los dias',
      porque: 'Sostiene la fuerza en series largas. Funciona por acumulacion, no por el momento.',
    });
  }

  if (tiene.has('OMEGA3')) {
    pautas.push({
      supplement: 'OMEGA3',
      nombre: 'Omega-3 (aceite de pescado)',
      dosis: '1 a 2 capsulas',
      momento: 'con una comida que tenga grasa',
      porque: 'Se absorbe mejor con grasa. En ayunas se aprovecha menos y suele repetir.',
    });
  }

  if (tiene.has('WHEY')) {
    const proteinaAlta = input.macros.proteinG >= PROTEINA_ALTA_G;
    const faseExigente = FASES_CON_POLVO.includes(input.phase);

    pautas.push({
      supplement: 'WHEY',
      nombre: 'Proteina en polvo',
      dosis: '1 medida (30 g)',
      momento: faseExigente || proteinaAlta ? 'despues de entrenar' : 'cuando no alcances con comida',
      porque:
        faseExigente || proteinaAlta
          ? `Tu objetivo de ${Math.round(input.macros.proteinG)} g de proteina cuesta llegar solo con comida entera.`
          : 'Es un recurso, no un requisito: con tu objetivo de hoy la comida entera alcanza.',
    });
  }

  return pautas;
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
