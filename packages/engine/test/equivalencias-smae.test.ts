import { describe, expect, it } from 'vitest';
import { equivalenciasDeAlimento } from '../src/menu.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { FOODS, findFood } from '../src/foods.js';
import type { Profile } from '../src/types.js';

/**
 * R2-A — equivalencias por grupo SMAE.
 *
 * Irma: en la cena sale tortilla de nopal y "cambiar" no ofrecia tortilla de
 * maiz ni tostada horneada, que cualquier nutriologa da por equivalentes; ni
 * arroz por tortilla. La equivalencia ahora ofrece todo el grupo de
 * equivalentes del SMAE del alimento, con la cantidad que conserva el
 * equivalente en medida casera.
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
};

const CENA = { id: 'CENA' as const, timeHint: '20:30' };
const COMIDA = { id: 'COMIDA' as const, timeHint: '14:00' };
const ids = (eq: { options: Array<{ foodId: string }> } | null): string[] => (eq?.options ?? []).map((o) => o.foodId);

describe('el catalogo trae su grupo SMAE', () => {
  it('todo alimento que se come (no suplementos ni agua) tiene grupo', () => {
    const sinGrupo = FOODS.filter(
      (f) => f.role !== 'suplemento' && !f.tags.includes('base_agua') && f.grupoSmae === undefined,
    ).map((f) => f.id);
    expect(sinGrupo).toEqual([]);
  });

  it('tortillas, tostada, arroz, pasta, pan, avena, papa, camote y elote son cereales sin grasa', () => {
    for (const id of ['tortilla_maiz', 'nopal_asado_carb', 'tostada_horneada', 'arroz_blanco', 'arroz_integral', 'pasta_integral', 'pan_integral', 'avena', 'papa', 'camote', 'elote']) {
      expect(findFood(id)!.grupoSmae, id).toBe('cereales_sin_grasa');
    }
  });
});

describe('equivalencias directas que faltaban', () => {
  it('la tortilla de nopal ofrece tortilla de maiz y tostada horneada', () => {
    const eq = equivalenciasDeAlimento('Tortilla de nopal', 30, IRMA, DEFAULT_CONFIG, undefined, { slot: CENA });
    expect(ids(eq)).toEqual(expect.arrayContaining(['tortilla_maiz', 'tostada_horneada']));
  });

  it('una taza de arroz son tres tortillas (SMAE)', () => {
    const eq = equivalenciasDeAlimento('Arroz blanco cocido', 160, IRMA, DEFAULT_CONFIG, undefined, { slot: COMIDA });
    const tortilla = eq!.options.find((o) => o.foodId === 'tortilla_maiz');
    expect(tortilla, ids(eq).join(',')).toBeDefined();
    expect(tortilla!.grams).toBe(90);
  });

  it('con tostadas en la despensa, la tostada sale primero y marcada', () => {
    const eq = equivalenciasDeAlimento('Tortilla de nopal', 30, { ...IRMA, pantry: ['tostada_horneada'] }, DEFAULT_CONFIG, undefined, { slot: CENA });
    expect(eq!.options[0]!.foodId).toBe('tostada_horneada');
    expect(eq!.options[0]!.enDespensa).toBe(true);
  });

  it('lo mexicano va antes que lo de fuera', () => {
    const eq = equivalenciasDeAlimento('Arroz blanco cocido', 160, IRMA, DEFAULT_CONFIG, undefined, { slot: COMIDA });
    const exactas = eq!.options.filter((o) => !o.aproximada && !o.enDespensa);
    const mexicano = exactas.map((o) => findFood(o.foodId)!.tags.includes('mexicano'));
    const primeroDeFuera = mexicano.indexOf(false);
    if (primeroDeFuera !== -1) expect(mexicano.slice(primeroDeFuera).every((m) => !m)).toBe(true);
  });
});

describe('lo que no va se dice, no se esconde', () => {
  it('con papa en la comida, el arroz no se ofrece: sale en gris con su motivo', () => {
    const eq = equivalenciasDeAlimento('Tortilla de maiz', 60, IRMA, DEFAULT_CONFIG, undefined, {
      slot: COMIDA,
      enLaComida: ['papa', 'pechuga_pollo'],
    });
    expect(ids(eq)).not.toContain('arroz_blanco');
    const arroz = eq!.noVan?.find((o) => o.foodId === 'arroz_blanco');
    expect(arroz, JSON.stringify(eq!.noVan)).toBeDefined();
    expect(arroz!.motivo).toBe('no va con tu papa');
  });

  it('el cereal que ya va en otra comida del dia se ofrece igual, marcado y al final', () => {
    // Era un aviso, no un bloqueo (3-oct, Mau): se puede elegir.
    const eq = equivalenciasDeAlimento('Tortilla de nopal', 30, IRMA, DEFAULT_CONFIG, undefined, {
      slot: CENA,
      enElDia: ['tortilla_maiz'],
    });
    const tostada = eq!.options.find((o) => o.foodId === 'tostada_horneada');
    expect(tostada?.enOtraComida).toBe(true);
    expect(eq!.noVan?.some((o) => o.foodId === 'tostada_horneada') ?? false).toBe(false);
    const marcas = eq!.options.map((o) => o.enOtraComida === true);
    expect(marcas.slice(marcas.indexOf(true)).every(Boolean)).toBe(true);
  });

  it('la dieta y lo excluido no salen ni en gris', () => {
    const vegetariana = equivalenciasDeAlimento('Queso panela', 80, { ...IRMA, diet: 'vegetariana' }, DEFAULT_CONFIG, undefined, { slot: COMIDA });
    const todos = [...ids(vegetariana), ...(vegetariana?.noVan ?? []).map((o) => o.foodId)];
    for (const id of todos) expect(findFood(id)!.tags, id).not.toContain('no_vegetariano');
    const sinTostada = equivalenciasDeAlimento('Tortilla de nopal', 30, { ...IRMA, excludedFoods: ['tostada'] }, DEFAULT_CONFIG, undefined, { slot: CENA });
    expect([...ids(sinTostada), ...(sinTostada?.noVan ?? []).map((o) => o.foodId)]).not.toContain('tostada_horneada');
  });

  it('en el desayuno, lo que no es de desayuno sale en gris', () => {
    const eq = equivalenciasDeAlimento('Huevo entero', 110, IRMA, DEFAULT_CONFIG, undefined, {
      slot: { id: 'DESAYUNO', timeHint: '08:00' },
    });
    for (const id of ids(eq)) expect(findFood(id)!.tags, id).not.toContain('no_desayuno');
  });
});
