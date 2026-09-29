import { findFood } from '../../src/foods.js';
import { familiaDe } from '../../src/familias.js';
import type { Food, MenuMeal } from '../../src/types.js';

/**
 * Combinaciones reales de plato fuerte (R2-B). Una COMIDA o CENA sin platillo
 * de la lista tiene que ser una de estas: lo que una persona reconoce como
 * comida, no alimentos que suman macros.
 *
 * Las ocho de Jousfit ("Bye, bye celulitis", recetario pp. 9-31) son la
 * referencia de combinaciones reales; las estructuras generales son el plato
 * mexicano de todos los dias (SMAE: AOA + cereal + verdura + grasa).
 */

type Pieza = 'proteina' | 'carbo' | 'verdura' | 'grasa';

export interface Combinacion {
  nombre: string;
  fuente: string;
  /** Lo que tiene que traer; lo demas es opcional. */
  requiere: Pieza[];
  /** Si se da, la proteina tiene que ser de estas familias o ids. */
  proteinas?: string[];
  /** Si se da, el carbohidrato tiene que ser de estas familias o ids. */
  carbos?: string[];
}

const JF = 'Jousfit, Bye bye celulitis';

export const COMBINACIONES: Combinacion[] = [
  // Las ocho de Jousfit.
  { nombre: 'Carne asada + tortilla de nopal + verdura + aguacate', fuente: `${JF} p. 15`, requiere: ['proteina', 'carbo', 'verdura', 'grasa'], proteinas: ['res'], carbos: ['tortilla', 'nopal_asado_carb'] },
  { nombre: 'Pollo + arroz o tortilla + frijol + queso', fuente: `${JF} p. 29`, requiere: ['proteina', 'carbo'], proteinas: ['pollo', 'queso'], carbos: ['arroz', 'tortilla', 'frijol_negro'] },
  { nombre: 'Pollo horneado + papa + aceite', fuente: `${JF} p. 25`, requiere: ['proteina', 'carbo', 'grasa'], proteinas: ['pollo'], carbos: ['papa', 'camote'] },
  { nombre: 'Huevo + pan integral + aguacate', fuente: `${JF} p. 11`, requiere: ['proteina', 'carbo', 'grasa'], proteinas: ['huevo'], carbos: ['pan'] },
  { nombre: 'Frijol + totopo horneado + verdura + queso', fuente: `${JF} p. 30`, requiere: ['proteina', 'carbo', 'verdura'], proteinas: ['queso'], carbos: ['frijol_negro', 'tortilla'] },
  { nombre: 'Proteina en polvo + avena + frutos rojos', fuente: `${JF} p. 12`, requiere: ['proteina', 'carbo'], proteinas: ['proteina_polvo'], carbos: ['avena'] },
  { nombre: 'Proteina + platano/avena + grasa', fuente: `${JF} p. 13`, requiere: ['proteina', 'carbo', 'grasa'], proteinas: ['proteina_polvo', 'huevo'], carbos: ['avena', 'platano_post'] },
  { nombre: 'Yogur griego + proteina + manzana', fuente: `${JF} p. 24`, requiere: ['proteina'], proteinas: ['yogur', 'proteina_polvo'] },
  // El plato mexicano de todos los dias.
  { nombre: 'Proteina + cereal o tuberculo + verdura (+ grasa)', fuente: 'SMAE / cocina mexicana', requiere: ['proteina', 'carbo', 'verdura'] },
  { nombre: 'Proteina + leguminosa + tortilla (+ verdura)', fuente: 'Cocina mexicana', requiere: ['proteina', 'carbo'], carbos: ['tortilla', 'frijol_negro', 'lenteja', 'garbanzo', 'haba'] },
  // Sin carbohidrato denso (keto, corte agresivo): proteina + verdura + grasa.
  { nombre: 'Proteina + verdura + grasa', fuente: 'Keto / corte agresivo', requiere: ['proteina', 'verdura', 'grasa'] },
];

function piezaDe(food: Food): Pieza | undefined {
  if (food.role.startsWith('proteina')) return 'proteina';
  if (['carbo_pre', 'carbo_post', 'carbo_complejo'].includes(food.role)) return 'carbo';
  if (food.role === 'vegetal_libre') return 'verdura';
  if (food.role === 'grasa') return 'grasa';
  return undefined;
}

const encaja = (food: Food, lista?: string[]): boolean =>
  lista === undefined || lista.includes(food.id) || lista.includes(familiaDe(food) ?? '');

/** La combinacion que la comida forma, o `undefined` si no es ninguna. */
export function combinacionDe(meal: MenuMeal): Combinacion | undefined {
  const foods = meal.items.map((i) => findFood(i.foodId)!).filter((f) => f !== undefined);
  return COMBINACIONES.find((c) =>
    c.requiere.every((pieza) =>
      foods.some(
        (f) =>
          piezaDe(f) === pieza &&
          (pieza !== 'proteina' || encaja(f, c.proteinas)) &&
          (pieza !== 'carbo' || encaja(f, c.carbos)),
      ),
    ),
  );
}

/** Platillo de la lista (tacos, sopa, crema...) o combinacion permitida. */
export function esComidaReconocible(meal: MenuMeal): boolean {
  return meal.preparacion !== undefined || combinacionDe(meal) !== undefined;
}
