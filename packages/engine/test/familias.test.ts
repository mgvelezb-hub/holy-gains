import { describe, expect, it } from 'vitest';
import { familiaDe } from '../src/familias.js';
import { findFood } from '../src/foods.js';
import type { Food } from '../src/types.js';

function comida(id: string): Food {
  const food = findFood(id);
  if (!food) throw new Error(`no existe ${id}`);
  return food;
}

describe('familia de la proteina principal y del cereal', () => {
  it('agrupa lo que en la mesa es lo mismo', () => {
    expect(familiaDe(comida('claras_huevo'))).toBe('huevo');
    expect(familiaDe(comida('huevo_entero'))).toBe('huevo');
    expect(familiaDe(comida('atun_agua'))).toBe('atun');
    expect(familiaDe(comida('atun_aceite'))).toBe('atun');
    expect(familiaDe(comida('pechuga_pollo'))).toBe('pollo');
    expect(familiaDe(comida('muslo_pollo'))).toBe('pollo');
    expect(familiaDe(comida('jamon_pavo'))).toBe('pavo');
    expect(familiaDe(comida('tilapia'))).toBe('pescado');
    expect(familiaDe(comida('salmon'))).toBe('pescado');
    expect(familiaDe(comida('queso_panela'))).toBe('queso');
    expect(familiaDe(comida('cottage'))).toBe('queso');
    expect(familiaDe(comida('whey_isolate'))).toBe('proteina_polvo');
    expect(familiaDe(comida('yogur_griego_0'))).toBe('yogur');
    expect(familiaDe(comida('res_magra'))).toBe('res');
    expect(familiaDe(comida('avena'))).toBe('avena');
    expect(familiaDe(comida('avena_cocida'))).toBe('avena');
    expect(familiaDe(comida('arroz_blanco'))).toBe('arroz');
    expect(familiaDe(comida('arroz_integral'))).toBe('arroz');
    expect(familiaDe(comida('pasta_integral'))).toBe('pasta');
    expect(familiaDe(comida('tortilla_maiz'))).toBe('tortilla');
    expect(familiaDe(comida('pan_integral'))).toBe('pan');
    expect(familiaDe(comida('pan_centeno'))).toBe('pan');
  });

  it('lo demas no tiene familia: la fruta, la grasa, la leguminosa y la leche se pueden repetir', () => {
    for (const id of ['fresa', 'aguacate', 'lenteja', 'leche_descremada', 'camote', 'brocoli']) {
      expect(familiaDe(comida(id)), id).toBeUndefined();
    }
  });

  it('el alimento propio cae en su familia por nombre', () => {
    const propio = { ...comida('yogur_griego_0'), id: 'propio_1', name: 'Yogurt griego Oikos' };
    expect(familiaDe(propio)).toBe('yogur');
    const pan = { ...comida('pan_integral'), id: 'propio_2', name: 'Pan Bimbo multigrano' };
    expect(familiaDe(pan)).toBe('pan');
  });
});
