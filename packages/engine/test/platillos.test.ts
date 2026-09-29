import { describe, expect, it } from 'vitest';
import { generateMenu } from '../src/menu.js';
import { distribute } from '../src/meals.js';
import { kcalForDeficit, macrosFor } from '../src/calc.js';
import { DEFAULT_CONFIG, pickDeficit } from '../src/config.js';
import { findFood } from '../src/foods.js';
import { PREPARACIONES } from '../src/preparaciones.js';
import type { Profile } from '../src/types.js';

/** R2-B: platillos mexicanos de referencia (Jousfit y cocina mexicana). */
describe('catalogo de platillos mexicanos', () => {
  const mexicanos = PREPARACIONES.filter(
    (p) => p.fuente !== undefined && p.slots.some((s) => s === 'COMIDA' || s === 'CENA'),
  );

  it('trae al menos 15 platillos de comida o cena, cada uno con su fuente', () => {
    expect(mexicanos.length, mexicanos.map((p) => p.id).join(',')).toBeGreaterThanOrEqual(15);
  });

  it('marca cuales vienen de Jousfit (con pagina) y cuales de la cocina mexicana', () => {
    const jousfit = PREPARACIONES.filter((p) => p.fuente?.startsWith('Jousfit'));
    for (const p of jousfit) expect(p.fuente, p.id).toMatch(/p\. \d+/);
    expect(jousfit.map((p) => p.id)).toEqual(
      expect.arrayContaining(['tacos_carne_asada', 'burrito_pollo', 'nachos_saludables', 'pollo_papas_horno', 'avena_proteica_frutos_rojos', 'hotcakes_platano_avena', 'yogur_manzana_proteina']),
    );
    expect(mexicanos.filter((p) => p.fuente === 'Cocina mexicana').length).toBeGreaterThanOrEqual(10);
  });

  it('cada ingrediente sale del catalogo y el tiempo de cocina esta declarado', () => {
    for (const p of PREPARACIONES.filter((x) => x.fuente)) {
      expect(p.prepMin, p.id).toBeGreaterThan(0);
      for (const ing of p.ingredientes) {
        for (const id of [ing.foodId, ...(ing.opciones ?? []), ...(ing.fruta?.preferidas ?? [])]) {
          if (id !== undefined) expect(findFood(id), `${p.id} ${id}`).toBeDefined();
        }
      }
    }
  });

  it('las tostadas y los tacos no van en el desayuno (J2, regla 1)', () => {
    for (const p of PREPARACIONES.filter((x) => /^(tostadas|tacos)/.test(x.id))) {
      expect(p.slots, p.id).not.toContain('DESAYUNO');
    }
  });
});

describe('el menu arma platillos', () => {
  const MAU: Profile = {
    sex: 'male', ageYears: 38, heightCm: 182, weightKg: 120, strengthDaysPerWeek: 5,
    cardioMinPerWeek: 90, work: 'sedentario', mealsPerDay: 4, trainingTime: 'manana', budget: 'medio',
  };
  const semana = (profile: Profile) => {
    const kcal = kcalForDeficit(profile, pickDeficit('CUT', DEFAULT_CONFIG), DEFAULT_CONFIG);
    const macros = macrosFor('CUT', profile, kcal, DEFAULT_CONFIG);
    const slots = distribute(macros, profile, 'CUT');
    return [101, 102, 103, 104, 105, 106, 107].flatMap((seed) =>
      generateMenu(slots, profile, DEFAULT_CONFIG, seed, { phase: 'CUT' }).menus,
    );
  };

  it('con el platillo, el renglon agrupado dice como se sirve', () => {
    const platillos = semana(MAU).flatMap((m) => m.meals).filter((m) => m.preparacion?.tipo === 'platillo');
    expect(platillos.length).toBeGreaterThan(0);
    for (const meal of platillos) expect(meal.preparacion!.display.startsWith(`${meal.preparacion!.nombre} — `)).toBe(true);
  });

  it('el mismo platillo no se repite en el dia', () => {
    for (const menu of semana(MAU)) {
      const del = menu.meals.filter((m) => m.preparacion?.tipo === 'platillo');
      expect(new Set(del.map((m) => m.preparacion!.id)).size).toBe(del.length);
    }
  });

  it('apagar sopas apaga tambien los platillos (sin preferencia propia)', () => {
    const sin = semana({ ...MAU, preparaciones: { licuados: true, sopas: false, cremas: true } });
    expect(sin.flatMap((m) => m.meals).some((m) => m.preparacion?.tipo === 'platillo')).toBe(false);
  });
});
