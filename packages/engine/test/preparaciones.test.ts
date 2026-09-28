import { describe, expect, it } from 'vitest';
import { FOODS, findFood } from '../src/foods.js';
import { PREPARACIONES } from '../src/preparaciones.js';
import type { MealSlotId } from '../src/types.js';

const LICUADO_SLOTS: MealSlotId[] = ['PRE', 'DESAYUNO', 'SNACK', 'POST'];
const PLATO_SLOTS: MealSlotId[] = ['COMIDA', 'CENA'];

describe('catalogo de preparaciones', () => {
  it('trae al menos 14 platillos y de los cuatro tipos', () => {
    expect(PREPARACIONES.length).toBeGreaterThanOrEqual(14);
    const tipos = new Set(PREPARACIONES.map((p) => p.tipo));
    expect([...tipos].sort()).toEqual(['caldo', 'crema', 'licuado', 'sopa']);
  });

  it('los ids son unicos', () => {
    const ids = PREPARACIONES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cada ingrediente sale del catalogo de alimentos', () => {
    for (const prep of PREPARACIONES) {
      expect(prep.ingredientes.length, prep.id).toBeGreaterThanOrEqual(2);
      for (const ing of prep.ingredientes) {
        const donde = `${prep.id}`;
        expect(
          ing.foodId !== undefined || ing.tag === 'leche' || (ing.rolePool?.length ?? 0) > 0,
          donde,
        ).toBe(true);
        if (ing.foodId) expect(findFood(ing.foodId), `${donde} ${ing.foodId}`).toBeDefined();
        for (const id of ing.opciones ?? []) {
          const food = findFood(id);
          expect(food, `${donde} ${id}`).toBeDefined();
          if (ing.rolePool) expect(ing.rolePool, `${donde} ${id}`).toContain(food!.role);
        }
        if (ing.rolePool && !ing.opciones) {
          // Un rol suelto sin lista abriria el licuado a la pechuga de pollo.
          throw new Error(`${donde}: rolePool sin opciones`);
        }
      }
    }
  });

  it('las cotas de porcion caben dentro de la medida casera del alimento', () => {
    for (const prep of PREPARACIONES) {
      for (const ing of prep.ingredientes) {
        const ids = ing.foodId
          ? [ing.foodId]
          : ing.tag === 'leche'
            ? FOODS.filter((f) => f.tags.includes('leche')).map((f) => f.id)
            : (ing.opciones ?? []);
        for (const id of ids) {
          const s = findFood(id)!.serving;
          if (!s) continue;
          if (ing.minUnits !== undefined) expect(ing.minUnits, `${prep.id} ${id}`).toBeGreaterThanOrEqual(s.minUnits);
          if (ing.maxUnits !== undefined) expect(ing.maxUnits, `${prep.id} ${id}`).toBeLessThanOrEqual(s.maxUnits);
        }
      }
    }
  });

  it('el licuado es de desayuno, colacion o post; la sopa, crema y caldo de comida o cena', () => {
    for (const prep of PREPARACIONES) {
      const permitidos = prep.tipo === 'licuado' ? LICUADO_SLOTS : PLATO_SLOTS;
      for (const slot of prep.slots) expect(permitidos, `${prep.id} ${slot}`).toContain(slot);
    }
  });

  it('las cremas no llevan crema lactea salvo que lo digan', () => {
    for (const prep of PREPARACIONES.filter((p) => p.tipo === 'crema')) {
      // La leche de la casa, la que la persona eligio: nunca una fija.
      expect(prep.ingredientes.some((i) => i.tag === 'leche'), prep.id).toBe(true);
      const ids = prep.ingredientes.flatMap((i) => (i.foodId ? [i.foodId] : (i.opciones ?? [])));
      expect(ids, prep.id).not.toContain('leche_descremada');
      expect(ids.some((id) => /^crema/i.test(findFood(id)!.name)), prep.id).toBe(false);
    }
  });

  it('el catalogo de alimentos no cambio de tamano por accidente', () => {
    expect(FOODS.length).toBeGreaterThanOrEqual(105);
  });
});

// ---------------------------------------------------------------------------
// El motor sirve preparaciones
// ---------------------------------------------------------------------------

import { generateMenu } from '../src/menu.js';
import { distribute } from '../src/meals.js';
import { kcalForDeficit, macrosFor } from '../src/calc.js';
import { DEFAULT_CONFIG, pickDeficit } from '../src/config.js';
import type { MenuMeal, MenuPlan, Phase, Profile } from '../src/types.js';

const MAU: Profile = {
  sex: 'male',
  ageYears: 38,
  heightCm: 182,
  weightKg: 120,
  strengthDaysPerWeek: 5,
  cardioMinPerWeek: 90,
  work: 'sedentario',
  mealsPerDay: 4,
  trainingTime: 'manana',
  budget: 'medio',
  favoriteFoods: ['pechuga de pollo', 'arroz', 'aguacate'],
};

const KETO: Profile = {
  sex: 'female',
  ageYears: 41,
  heightCm: 165,
  weightKg: 78,
  strengthDaysPerWeek: 3,
  cardioMinPerWeek: 90,
  work: 'sedentario',
  mealsPerDay: 4,
  trainingTime: 'tarde',
  budget: 'medio',
  diet: 'keto',
  supplements: ['WHEY'],
};

const SEMANA = [101, 102, 103, 104, 105, 106, 107];

function planDe(profile: Profile, seed: number, phase: Phase = 'CUT'): MenuPlan {
  const kcal = kcalForDeficit(profile, pickDeficit(phase, DEFAULT_CONFIG), DEFAULT_CONFIG);
  const macros = macrosFor(phase, profile, kcal, DEFAULT_CONFIG);
  return generateMenu(distribute(macros, profile, phase), profile, DEFAULT_CONFIG, seed, { phase });
}

function comidasDeLaSemana(profile: Profile, phase: Phase = 'CUT'): MenuMeal[] {
  return SEMANA.flatMap((seed) => planDe(profile, seed, phase).menus.flatMap((m) => m.meals));
}

const CON_PREPARACION = (meal: MenuMeal): boolean => meal.preparacion !== undefined;

describe('el menu sirve preparaciones cuando el perfil las admite', () => {
  const comidas = comidasDeLaSemana(MAU);

  it('la comida con preparacion la nombra y agrupa sus ingredientes en un renglon', () => {
    for (const meal of comidas.filter(CON_PREPARACION)) {
      const prep = meal.preparacion!;
      const ingredientes = meal.items.filter((i) => i.preparacion?.id === prep.id);
      expect(ingredientes.length, prep.id).toBeGreaterThanOrEqual(2);
      expect(prep.display.startsWith(`${prep.nombre} — `), prep.display).toBe(true);
      const renglones = prep.display.slice(prep.nombre.length + 3).split(' · ');
      expect(renglones.length).toBeGreaterThanOrEqual(ingredientes.length);
      // Sin gramos entre parentesis: el renglon se lee en medidas caseras.
      expect(prep.display).not.toMatch(/\(\d+ g\)/);
    }
  });

  it('nunca dos preparaciones en la misma comida, y los items concuerdan con la comida', () => {
    for (const meal of comidas) {
      const ids = new Set(meal.items.flatMap((i) => (i.preparacion ? [i.preparacion.id] : [])));
      expect(ids.size, meal.slot).toBeLessThanOrEqual(1);
      if (ids.size === 1) expect(meal.preparacion?.id).toBe([...ids][0]);
      else expect(meal.preparacion).toBeUndefined();
    }
  });

  it('el licuado nunca es la comida ni la cena; la sopa nunca el desayuno', () => {
    for (const meal of comidas.filter(CON_PREPARACION)) {
      if (meal.preparacion!.tipo === 'licuado') expect(['COMIDA', 'CENA']).not.toContain(meal.slot);
      else expect(['COMIDA', 'CENA']).toContain(meal.slot);
    }
  });

  it('la lista de super dice para que platillo se compra', () => {
    const plan = SEMANA.map((seed) => planDe(MAU, seed)).find((p) =>
      p.menus.some((m) => m.meals.some(CON_PREPARACION)),
    )!;
    const nombres = plan.menus.flatMap((m) => m.meals.flatMap((meal) => (meal.preparacion ? [meal.preparacion.nombre] : [])));
    const marcados = plan.shoppingList.flatMap((i) => i.preparaciones ?? []);
    for (const nombre of nombres) expect(marcados).toContain(nombre);
  });

  it('es determinista', () => {
    expect(planDe(MAU, 103)).toEqual(planDe(MAU, 103));
  });
});

describe('la preferencia del perfil manda', () => {
  it('con todo apagado no sale ninguna preparacion', () => {
    const comidas = comidasDeLaSemana({
      ...MAU,
      preparaciones: { licuados: false, sopas: false, cremas: false },
    });
    expect(comidas.filter(CON_PREPARACION)).toHaveLength(0);
    expect(comidas.flatMap((m) => m.items).filter((i) => i.preparacion)).toHaveLength(0);
  });

  it('apagar los licuados deja las sopas', () => {
    const tipos = comidasDeLaSemana({
      ...MAU,
      preparaciones: { licuados: false, sopas: true, cremas: true },
    })
      .filter(CON_PREPARACION)
      .map((m) => m.preparacion!.tipo);
    expect(tipos).not.toContain('licuado');
    expect(tipos.length).toBeGreaterThan(0);
  });

  it('keto no recibe licuados con fruta ni avena', () => {
    for (const meal of comidasDeLaSemana(KETO, 'BASE').filter(CON_PREPARACION)) {
      const roles = meal.items
        .filter((i) => i.preparacion)
        .map((i) => findFood(i.foodId)!.role);
      if (meal.preparacion!.tipo === 'licuado') {
        expect(roles, meal.preparacion!.id).not.toContain('fruta');
        expect(roles.some((r) => r.startsWith('carbo')), meal.preparacion!.id).toBe(false);
      }
    }
  });

  it('vegetariana no recibe caldo de pollo', () => {
    const comidas = comidasDeLaSemana({ ...MAU, diet: 'vegetariana' }, 'BASE');
    for (const item of comidas.flatMap((m) => m.items)) {
      expect(findFood(item.foodId)!.tags, item.name).not.toContain('no_vegetariano');
    }
  });
});
