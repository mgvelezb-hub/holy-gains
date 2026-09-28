import foodsData from '../data/foods.json';
import type { Food, FoodRole, Profile } from './types.js';

export const FOODS: Food[] = foodsData as Food[];

export function foodsByRole(role: FoodRole, pool: Food[] = FOODS): Food[] {
  return pool.filter((f) => f.role === role);
}

export function findFood(id: string, pool: Food[] = FOODS): Food | undefined {
  return pool.find((f) => f.id === id);
}

/** El id del catalogo de la leche que la persona eligio; descremada si no dijo. */
export function lecheDe(profile: Pick<Profile, 'tipoLeche'>): string {
  return `leche_${profile.tipoLeche ?? 'descremada'}`;
}

/** true si el alimento es una de las leches del catalogo (tag `leche`). */
export function esLeche(food: Pick<Food, 'tags'>): boolean {
  return food.tags.includes('leche');
}

/** Normaliza para comparar nombres escritos por el usuario (sin acentos, minusculas). */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** true si el alimento coincide con alguno de los terminos (id, nombre o tag). */
export function matchesAny(food: Food, terms: string[] | undefined): boolean {
  if (!terms || terms.length === 0) return false;
  const haystack = [food.id, food.name, ...food.tags].map(normalize);
  return terms.some((term) => {
    const t = normalize(term);
    if (!t) return false;
    return haystack.some((h) => h === t || h.includes(t) || t.includes(h));
  });
}

/**
 * Palabras que nombran lo mismo. Existe porque alguien busco "Yogurt Griego"
 * en su despensa y no salio nada: el catalogo lo llama "Yogur griego natural
 * 0%" y la busqueda comparaba letra por letra. No es un diccionario del
 * espanol —es la lista corta de las formas en que de verdad se escribe la
 * comida en la cocina: la del bote, la del super y la del pais de origen.
 */
const SINONIMOS: readonly (readonly string[])[] = [
  ['yogur', 'yogurt', 'yoghurt'],
  ['jitomate', 'tomate'],
  ['pollo', 'pechuga'],
  ['atun', 'tuna'],
  ['frijol', 'poroto', 'judia'],
  ['huevo', 'clara', 'blanquillo'],
  ['platano', 'banana', 'banano'],
  ['camote', 'batata', 'boniato'],
  ['papa', 'patata'],
  ['aguacate', 'palta'],
  ['cacahuate', 'mani', 'cacahuete'],
  ['proteina', 'whey', 'scoop', 'suero'],
  ['betabel', 'remolacha'],
  ['elote', 'maiz', 'choclo'],
  ['chicharo', 'guisante', 'arveja'],
  ['durazno', 'melocoton'],
  ['fresa', 'frutilla'],
];

/** Cada palabra apunta a todo su grupo, para expandir en cualquier direccion. */
const GRUPO_DE_SINONIMOS = new Map<string, readonly string[]>();
for (const grupo of SINONIMOS) {
  for (const palabra of grupo) GRUPO_DE_SINONIMOS.set(palabra, grupo);
}

/**
 * Plural simple al singular. No conjuga nada: quita la `s` o el `es` finales
 * cuando queda una palabra que sigue siendo palabra ("huevos" -> "huevo",
 * "frijoles" -> "frijol") y no toca las cortas, para no convertir "res" en
 * "re".
 */
function singular(palabra: string): string {
  if (palabra.length > 4 && palabra.endsWith('es')) return palabra.slice(0, -2);
  if (palabra.length > 3 && palabra.endsWith('s')) return palabra.slice(0, -1);
  return palabra;
}

/** Normaliza y parte en palabras utiles: sin acentos, sin plurales, sin ruido. */
function palabrasDe(texto: string): string[] {
  return normalize(texto)
    .replace(/[^a-z0-9%\s_]/g, ' ')
    .split(/[\s_]+/)
    .filter((palabra) => palabra.length > 1)
    .map(singular);
}

/** Las palabras de una consulta, ya expandidas con sus sinonimos. */
function terminosDeConsulta(query: string): string[][] {
  return palabrasDe(query).map((palabra) => {
    const grupo = GRUPO_DE_SINONIMOS.get(palabra);
    return grupo ? [palabra, ...grupo] : [palabra];
  });
}

/**
 * Todo lo que puede escribir alguien para dar con este alimento: su nombre,
 * su id, sus tags y los sinonimos de cada uno. La API lo manda junto con el
 * catalogo para que la app filtre igual de tolerante sin llevarse la tabla.
 */
export function terminosDeBusqueda(food: Food): string[] {
  const base = [...palabrasDe(food.name), ...palabrasDe(food.id), ...food.tags.flatMap(palabrasDe)];
  const todos = new Set(base);
  for (const palabra of base) {
    for (const sinonimo of GRUPO_DE_SINONIMOS.get(palabra) ?? []) todos.add(sinonimo);
  }
  return [...todos];
}

/**
 * Busca en un catalogo perdonando como se escribe: acentos, mayusculas,
 * plurales y la palabra regional. Cada palabra de la consulta tiene que
 * aparecer en el alimento —"yogurt griego" no devuelve todos los yogures— y
 * el orden del catalogo se respeta tal cual llego.
 */
export function buscaAlimentos(query: string, catalogo: Food[] = FOODS): Food[] {
  const consulta = terminosDeConsulta(query);
  if (consulta.length === 0) return [...catalogo];

  return catalogo.filter((food) => {
    const terminos = terminosDeBusqueda(food);
    return consulta.every((alternativas) =>
      alternativas.some((termino) => terminos.some((t) => t.startsWith(termino))),
    );
  });
}

/**
 * El catalogo de una persona: el de siempre mas los alimentos que dio de alta
 * ella.
 *
 * Los propios se agregan al final y con las mismas reglas —rol, plantilla del
 * slot, cotas de porcion, afinidad, presupuesto—: no son una lista aparte que
 * el motor tenga que consultar, son alimentos. Si la planeacion no los pide,
 * no entran; si si, entran igual que los demas. Un id repetido no duplica el
 * renglon: gana el propio, que es el que la persona edito.
 */
export function catalogoCon(extras: Food[] | undefined, base: Food[] = FOODS): Food[] {
  if (!extras || extras.length === 0) return base;
  const propios = new Map<string, Food>();
  for (const food of extras) propios.set(food.id, food);
  return [...base.filter((f) => !propios.has(f.id)), ...propios.values()];
}
