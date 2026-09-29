import { FOODS, normalize } from './foods.js';
import type { Food } from './types.js';

/**
 * Familia de la proteina principal y del cereal: lo que en la mesa "es lo
 * mismo" aunque el catalogo lo tenga en dos renglones.
 *
 * Nacio del menu 1 de Mau: yogur griego en el desayuno y otra vez en el
 * licuado del almuerzo, avena en los dos. Cada comida cuadraba y el dia se
 * leia como el mismo plato dos veces. Las claras y el huevo entero son huevo;
 * el arroz blanco y el integral son arroz. La fruta, la grasa, la leguminosa,
 * la leche y la verdura no tienen familia: repetirlas en el dia es normal.
 */
export type FamiliaPrincipal =
  | 'yogur'
  | 'huevo'
  | 'atun'
  | 'pollo'
  | 'pavo'
  | 'res'
  | 'pescado'
  | 'queso'
  | 'proteina_polvo'
  | 'avena'
  | 'arroz'
  | 'pasta'
  | 'tortilla'
  | 'pan';

/** El catalogo, por id: la fuente de verdad para lo que el motor ya conoce. */
const POR_ID: Record<string, FamiliaPrincipal> = {
  yogur_griego_0: 'yogur',
  claras_huevo: 'huevo',
  clara_liquida: 'huevo',
  huevo_entero: 'huevo',
  atun_agua: 'atun',
  atun_aceite: 'atun',
  pechuga_pollo: 'pollo',
  muslo_pollo: 'pollo',
  pechuga_pavo: 'pavo',
  jamon_pavo: 'pavo',
  res_magra: 'res',
  tilapia: 'pescado',
  bacalao: 'pescado',
  pescado_blanco: 'pescado',
  salmon: 'pescado',
  sardina_agua: 'pescado',
  cottage: 'queso',
  requeson: 'queso',
  queso_panela: 'queso',
  queso_fresco: 'queso',
  whey_isolate: 'proteina_polvo',
  proteina_vegetal: 'proteina_polvo',
  avena: 'avena',
  avena_cocida: 'avena',
  arroz_blanco: 'arroz',
  arroz_integral: 'arroz',
  pasta_integral: 'pasta',
  tortilla_maiz: 'tortilla',
  tostada_horneada: 'tortilla',
  tortilla_harina_integral: 'tortilla',
  pan_integral: 'pan',
  pan_centeno: 'pan',
};

const DEL_CATALOGO = new Set(FOODS.map((f) => f.id));

/**
 * Para los alimentos que dio de alta la persona: por nombre, en orden. El
 * polvo va antes que el yogur ("proteina de yogur en polvo" es polvo) y el
 * queso antes que el pan ("queso panela" no es pan).
 */
const POR_NOMBRE: ReadonlyArray<[RegExp, FamiliaPrincipal]> = [
  [/\b(whey|isolate|proteina (vegetal |de suero )?en polvo|proteina en polvo)\b/, 'proteina_polvo'],
  [/\byogh?urt?\b/, 'yogur'],
  [/\b(queso|cottage|requeson)\b/, 'queso'],
  [/\b(huevo|huevos|clara|claras)\b/, 'huevo'],
  [/\batun\b/, 'atun'],
  [/\bpollo\b/, 'pollo'],
  [/\bpavo\b/, 'pavo'],
  [/\b(res|bistec|arrachera|sirloin|carne molida)\b/, 'res'],
  [/\b(pescado|tilapia|salmon|bacalao|huachinango|robalo|sardina|mojarra)\b/, 'pescado'],
  [/\bavena\b/, 'avena'],
  [/\barroz\b/, 'arroz'],
  [/\b(pasta|espagueti|spaghetti|fideo|fideos|macarron|macarrones|penne)\b/, 'pasta'],
  [/\b(tortilla|tortillas|tostada|tostadas)\b/, 'tortilla'],
  [/\b(pan|bolillo|telera)\b/, 'pan'],
];

/** Solo la proteina principal y el cereal tienen familia; el resto, `undefined`. */
export function familiaDe(food: Pick<Food, 'id' | 'name' | 'role'>): FamiliaPrincipal | undefined {
  const porId = POR_ID[food.id];
  if (porId) return porId;
  if (DEL_CATALOGO.has(food.id)) return undefined;
  const esFuente =
    food.role.startsWith('proteina') ||
    food.role === 'carbo_pre' ||
    food.role === 'carbo_post' ||
    food.role === 'carbo_complejo';
  if (!esFuente) return undefined;
  const nombre = normalize(food.name);
  return POR_NOMBRE.find(([patron]) => patron.test(nombre))?.[1];
}
