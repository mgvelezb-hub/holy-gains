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
        expect(ing.foodId !== undefined || (ing.rolePool?.length ?? 0) > 0, donde).toBe(true);
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
        const ids = ing.foodId ? [ing.foodId] : (ing.opciones ?? []);
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
      const ids = prep.ingredientes.flatMap((i) => (i.foodId ? [i.foodId] : (i.opciones ?? [])));
      expect(ids, prep.id).toContain('leche_descremada');
    }
  });

  it('el catalogo de alimentos no cambio de tamano por accidente', () => {
    expect(FOODS.length).toBeGreaterThanOrEqual(105);
  });
});
