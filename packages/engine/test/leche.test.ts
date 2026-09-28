import { describe, expect, it } from 'vitest';
import { findFood } from '../src/foods.js';

const LECHES = ['leche_descremada', 'leche_entera', 'leche_deslactosada', 'leche_deslactosada_light'];

describe('catalogo de leches', () => {
  it('las cuatro leches existen con medida casera de taza y el tag leche', () => {
    for (const id of LECHES) {
      const food = findFood(id);
      expect(food, id).toBeDefined();
      expect(food!.serving, id).toMatchObject({ unit: 'taza', gramsPerUnit: 240, minUnits: 0.5, maxUnits: 1.25 });
      expect(food!.role, id).toBe('proteina_magra');
      expect(food!.tags, id).toEqual(expect.arrayContaining(['leche', 'rapido', 'vegetariano']));
    }
  });

  it('la grasa ordena las kcal: entera > deslactosada > light > descremada', () => {
    const kcal = (id: string): number => findFood(id)!.kcalPer100;
    expect(kcal('leche_entera')).toBeGreaterThan(kcal('leche_deslactosada_light'));
    expect(kcal('leche_deslactosada')).toBeGreaterThan(kcal('leche_deslactosada_light'));
    expect(kcal('leche_deslactosada_light')).toBeGreaterThan(kcal('leche_descremada'));
  });
});

// ---------------------------------------------------------------------------
// El motor sirve la leche que la persona eligio, y solo esa
// ---------------------------------------------------------------------------

import { generateMenu } from '../src/menu.js';
import { distribute } from '../src/meals.js';
import { kcalForDeficit, macrosFor } from '../src/calc.js';
import { DEFAULT_CONFIG, pickDeficit } from '../src/config.js';
import { lecheDe } from '../src/foods.js';
import type { Menu, Profile, TipoLeche } from '../src/types.js';

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

const TIPOS: TipoLeche[] = ['descremada', 'entera', 'deslactosada', 'deslactosada_light'];
const SEMANA = [101, 102, 103, 104, 105, 106, 107];
const ES_LECHE = new Set(LECHES);

function semanaCon(tipoLeche: TipoLeche): Menu[] {
  const profile: Profile = { ...MAU, tipoLeche };
  const kcal = kcalForDeficit(profile, pickDeficit('CUT', DEFAULT_CONFIG), DEFAULT_CONFIG);
  const macros = macrosFor('CUT', profile, kcal, DEFAULT_CONFIG);
  const slots = distribute(macros, profile, 'CUT');
  return SEMANA.flatMap((seed) => generateMenu(slots, profile, DEFAULT_CONFIG, seed, { phase: 'CUT' }).menus);
}

describe('la preferencia de leche', () => {
  it('sin preferencia es descremada, como siempre', () => {
    expect(lecheDe(MAU)).toBe('leche_descremada');
    expect(lecheDe({ ...MAU, tipoLeche: 'deslactosada_light' })).toBe('leche_deslactosada_light');
  });

  describe.each(TIPOS)('semana de Mau con leche %s', (tipo) => {
    const menus = semanaCon(tipo);
    const items = menus.flatMap((m) => m.meals.flatMap((meal) => meal.items));
    const elegida = `leche_${tipo}`;

    it('el dia cuadra a +-5 % de kcal', () => {
      for (const menu of menus) expect(Math.abs(menu.deviationPct.kcal), `menu ${menu.id}`).toBeLessThanOrEqual(5);
    });

    it('ninguna otra leche sale en la semana', () => {
      const leches = new Set(items.filter((i) => ES_LECHE.has(i.foodId)).map((i) => i.foodId));
      expect([...leches]).toEqual([elegida]);
    });

    it('el licuado o la crema se hace con la leche elegida', () => {
      const conLeche = items.filter((i) => i.preparacion && i.foodId === elegida);
      expect(conLeche.length).toBeGreaterThan(0);
      expect(conLeche[0]!.name.toLowerCase()).toContain('leche');
    });
  });

  it('la leche entera sube la grasa del platillo, no la del dia', () => {
    const grasaDeLeche = (tipo: TipoLeche): number =>
      semanaCon(tipo)
        .flatMap((m) => m.meals.flatMap((meal) => meal.items))
        .filter((i) => ES_LECHE.has(i.foodId))
        .reduce((acc, i) => acc + i.fatG, 0);
    expect(grasaDeLeche('entera')).toBeGreaterThan(grasaDeLeche('descremada'));
  });
});
