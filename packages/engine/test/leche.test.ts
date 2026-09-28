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
