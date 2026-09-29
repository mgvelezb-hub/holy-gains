import { describe, expect, it } from 'vitest';
import { equivalenciasDeAlimento, generateMenu, nombreDePlatillo } from '../src/menu.js';
import { distribute } from '../src/meals.js';
import { kcalForDeficit, macrosFor } from '../src/calc.js';
import { DEFAULT_CONFIG, pickDeficit } from '../src/config.js';
import { findFood } from '../src/foods.js';
import { PREPARACIONES } from '../src/preparaciones.js';
import type { Menu, MenuMeal, Profile } from '../src/types.js';

/**
 * R1 — licuados de Irma.
 *
 * Reporte: "solo me salen dos licuados (mango y verde)". Diagnostico sobre su
 * perfil (mujer 34, 160 cm, 62 kg, 5 comidas, 20 min, descremada, con whey):
 * de 5 licuados solo 2 llegaban a servirse, y sin whey declarado ninguno. La
 * causa: la proteina minima del licuado (un scoop entero = 25.5 g) mas la
 * taza de leche (8 g) no cabia en el tope de 110 % de la proteina de su
 * colacion (13-24 g); la leche se caia, la base pasaba a agua y el "yogur con
 * agua" tiraba el licuado. Los de fruta fija (fresa, platano) caian por 0.5 g.
 */

const IRMA: Profile = {
  sex: 'female',
  ageYears: 34,
  heightCm: 160,
  weightKg: 62,
  strengthDaysPerWeek: 6,
  cardioMinPerWeek: 120,
  work: 'activo',
  mealsPerDay: 5,
  trainingTime: 'manana',
  budget: 'medio',
  maxPrepMin: 20,
  tipoLeche: 'descremada',
  supplements: ['WHEY'],
};

const DIAS = [101, 102, 103, 104, 105, 106, 107];

function semana(profile: Profile): Menu[] {
  const kcal = kcalForDeficit(profile, pickDeficit('BASE', DEFAULT_CONFIG), DEFAULT_CONFIG);
  const macros = macrosFor('BASE', profile, kcal, DEFAULT_CONFIG);
  const slots = distribute(macros, profile, 'BASE');
  return DIAS.flatMap((seed) => generateMenu(slots, profile, DEFAULT_CONFIG, seed, { phase: 'BASE' }).menus);
}

const licuados = (menus: Menu[]): MenuMeal[] =>
  menus.flatMap((m) => m.meals).filter((meal) => meal.preparacion?.tipo === 'licuado');

describe('catalogo de licuados por plantilla', () => {
  const catalogo = PREPARACIONES.filter((p) => p.tipo === 'licuado');

  it('trae al menos 10 licuados', () => {
    expect(catalogo.length).toBeGreaterThanOrEqual(10);
  });

  it('ninguno fija la fruta: la declara como plantilla y su nombre la lleva', () => {
    for (const prep of catalogo) {
      const conFruta = prep.ingredientes.filter((i) => i.fruta);
      expect(conFruta, prep.id).toHaveLength(1);
      expect(conFruta[0]!.fruta!.rolePool, prep.id).toEqual(['fruta']);
      for (const id of conFruta[0]!.fruta!.preferidas ?? []) expect(findFood(id)?.role, `${prep.id} ${id}`).toBe('fruta');
      for (const ing of prep.ingredientes) {
        if (ing.foodId) expect(findFood(ing.foodId)!.role, `${prep.id} ${ing.foodId}`).not.toBe('fruta');
        for (const id of ing.opciones ?? []) expect(findFood(id)!.role, `${prep.id} ${id}`).not.toBe('fruta');
      }
      expect(prep.nombre, prep.id).toContain('{fruta}');
    }
  });

  it('el cacao en polvo y el jengibre existen en el catalogo', () => {
    expect(findFood('cacao_polvo')).toBeDefined();
    expect(findFood('jengibre')).toBeDefined();
  });

  it('nombreDePlatillo arma el nombre con la fruta', () => {
    expect(nombreDePlatillo('licuado_proteina_fruta_avena', 'frambuesa')).toBe('Licuado de frambuesa con avena');
    expect(nombreDePlatillo('licuado_verde', 'pina')).toBe('Licuado verde con piña');
  });
});

describe('Irma: la semana trae licuados variados', () => {
  const menus = semana(IRMA);
  const servidos = licuados(menus);

  it('en 7 dias salen al menos 4 licuados distintos', () => {
    const ids = new Set(servidos.map((m) => m.preparacion!.id));
    expect([...ids].length, [...ids].join(', ')).toBeGreaterThanOrEqual(4);
  });

  it('sin whey declarado tambien salen licuados', () => {
    const sinPolvo = licuados(semana({ ...IRMA, supplements: [] }));
    expect(new Set(sinPolvo.map((m) => m.preparacion!.id)).size).toBeGreaterThanOrEqual(3);
  });

  it('cada licuado se llama como la fruta que lleva', () => {
    for (const meal of servidos) {
      const fruta = meal.items.find((i) => i.preparacion && findFood(i.foodId)!.role === 'fruta');
      expect(fruta, meal.preparacion!.display).toBeDefined();
      expect(meal.preparacion!.nombre).toBe(nombreDePlatillo(meal.preparacion!.id, fruta!.foodId));
      expect(meal.preparacion!.nombre).not.toContain('{');
      for (const i of meal.items.filter((x) => x.preparacion)) expect(i.preparacion!.nombre).toBe(meal.preparacion!.nombre);
    }
  });

  it('el dia sigue cuadrando: kcal +-5 %', () => {
    for (const menu of menus) expect(Math.abs(menu.deviationPct.kcal)).toBeLessThanOrEqual(5);
  });
});

describe('la despensa manda en la fruta del licuado', () => {
  const deLaFruta = (servidos: MenuMeal[], id: string): MenuMeal[] =>
    servidos.filter((m) => m.items.some((i) => i.preparacion && i.foodId === id));

  it('con frutos rojos en casa, el licuado es de frutos rojos', () => {
    const servidos = licuados(semana({ ...IRMA, pantry: ['frutos_rojos'] }));
    expect(servidos.length).toBeGreaterThan(0);
    const conEsa = deLaFruta(servidos, 'frutos_rojos');
    expect(conEsa.length / servidos.length).toBeGreaterThanOrEqual(0.5);
    expect(conEsa[0]!.preparacion!.nombre).toMatch(/frutos rojos/);
  });

  it('con frambuesa en casa y presupuesto que la alcanza, el licuado es de frambuesa', () => {
    const servidos = licuados(semana({ ...IRMA, budget: 'alto', pantry: ['frambuesa'] }));
    const conEsa = deLaFruta(servidos, 'frambuesa');
    expect(conEsa.length / servidos.length).toBeGreaterThanOrEqual(0.5);
    expect(conEsa[0]!.preparacion!.nombre).toMatch(/frambuesa/);
  });
});

describe('cambiar la fruta dentro del licuado', () => {
  const menus = semana(IRMA);
  const menu = menus.find((m) => licuados([m]).length > 0)!;
  const meal = licuados([menu])[0]!;
  const fruta = meal.items.find((i) => i.preparacion && findFood(i.foodId)!.role === 'fruta')!;
  const otrasFrutas = menu.meals
    .filter((m) => m !== meal)
    .flatMap((m) => m.items)
    .filter((i) => findFood(i.foodId)!.role === 'fruta')
    .map((i) => i.foodId);

  it('la equivalencia de la fruta ofrece otras frutas, ninguna de otra comida del dia', () => {
    const eq = meal.equivalences.find((e) => e.forFoodId === fruta.foodId);
    expect(eq, meal.preparacion!.display).toBeDefined();
    expect(eq!.options.length).toBeGreaterThanOrEqual(2);
    for (const o of eq!.options) {
      expect(findFood(o.foodId)!.role).toBe('fruta');
      expect(otrasFrutas).not.toContain(o.foodId);
    }
  });

  it('el menu guardado tambien: por nombre, dentro del platillo y sin las frutas del dia', () => {
    const enElDia = menu.meals.filter((m) => m !== meal).flatMap((m) => m.items.map((i) => i.foodId));
    const eq = equivalenciasDeAlimento(fruta.name, fruta.grams, IRMA, DEFAULT_CONFIG, undefined, {
      enElDia,
      preparacionId: meal.preparacion!.id,
    });
    expect(eq).not.toBeNull();
    for (const o of eq!.options) {
      expect(findFood(o.foodId)!.role).toBe('fruta');
      expect(otrasFrutas).not.toContain(o.foodId);
      expect(nombreDePlatillo(meal.preparacion!.id, o.foodId)).toContain(findFood(o.foodId)!.nombreEnPlatillo ?? '');
    }
  });
});

describe('base de licuados: agua', () => {
  const conAgua: Profile = { ...IRMA, baseLicuado: 'agua' };
  const menus = semana(conAgua);
  const servidos = licuados(menus);

  it('el licuado lleva una taza de agua y ninguna leche, y lo dice', () => {
    expect(servidos.length).toBeGreaterThan(0);
    for (const meal of servidos) {
      const ids = meal.items.filter((i) => i.preparacion).map((i) => i.foodId);
      expect(ids, meal.preparacion!.display).toContain('agua');
      expect(ids.some((id) => id.startsWith('leche_')), meal.preparacion!.display).toBe(false);
      expect(meal.preparacion!.display).toContain('1 taza de agua');
    }
  });

  it('el dia cuadra: kcal +-5 %', () => {
    for (const menu of menus) expect(Math.abs(menu.deviationPct.kcal), `menu ${menu.id}`).toBeLessThanOrEqual(5);
  });

  it('sin polvo, el yogur puede ser la proteina del licuado con agua', () => {
    const sinPolvo = licuados(semana({ ...conAgua, supplements: [] }));
    expect(sinPolvo.length).toBeGreaterThan(0);
    for (const meal of sinPolvo) {
      expect(meal.items.some((i) => i.preparacion && i.foodId.startsWith('leche_'))).toBe(false);
    }
  });
});

describe('cambiar de licuado', () => {
  it('las opciones nombran la fruta, nunca la plantilla', async () => {
    const { opcionesDePlatillo } = await import('../src/menu.js');
    const menus = semana(IRMA);
    let vistas = 0;
    for (const menu of menus) {
      for (const meal of licuados([menu])) {
        const enElDia = menu.meals.filter((m) => m !== meal).flatMap((m) => m.items.map((i) => i.foodId));
        for (const o of opcionesDePlatillo({ meal, profile: IRMA, enElDia })) {
          vistas += 1;
          expect(o.nombre).not.toContain('{');
        }
      }
    }
    expect(vistas).toBeGreaterThan(0);
  });
});
