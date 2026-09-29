import { describe, expect, it } from 'vitest';
import {
  cambiarPlatillo,
  equivalenciasDeAlimento,
  generateMenu,
  opcionesDePlatillo,
} from '../src/menu.js';
import { distribute } from '../src/meals.js';
import { kcalForDeficit, macrosFor } from '../src/calc.js';
import { DEFAULT_CONFIG, pickDeficit } from '../src/config.js';
import { findFood } from '../src/foods.js';
import { familiaDe } from '../src/familias.js';
import { PREPARACIONES } from '../src/preparaciones.js';
import type { Menu, MenuMeal, Profile } from '../src/types.js';

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

function menusDe(profile: Profile): Menu[] {
  const kcal = kcalForDeficit(profile, pickDeficit('CUT', DEFAULT_CONFIG), DEFAULT_CONFIG);
  const macros = macrosFor('CUT', profile, kcal, DEFAULT_CONFIG);
  const slots = distribute(macros, profile, 'CUT');
  // Dos semanas: con las reglas culinarias (J2) el caldo ya no cabe en una
  // comida de mucho carbohidrato, y hacen falta mas dias para ver sopas con
  // opciones.
  return Array.from({ length: 14 }, (_, i) => 101 + i).flatMap(
    (seed) => generateMenu(slots, profile, DEFAULT_CONFIG, seed, { phase: 'CUT' }).menus,
  );
}

const MENUS = menusDe(MAU);

function conPlatillo(tipos: string[]): Array<{ menu: Menu; meal: MenuMeal }> {
  return MENUS.flatMap((menu) =>
    menu.meals
      .filter((meal) => meal.preparacion && tipos.includes(meal.preparacion.tipo))
      .map((meal) => ({ menu, meal })),
  );
}

function otrasComidas(menu: Menu, meal: MenuMeal): string[] {
  return menu.meals.filter((m) => m !== meal).flatMap((m) => m.items.map((i) => i.foodId));
}

describe('cambiar el ingrediente de un platillo', () => {
  it('la lenteja de la sopa se cambia por otra leguminosa, nunca por arroz', () => {
    const eq = equivalenciasDeAlimento('Lenteja cocida', 180, MAU, DEFAULT_CONFIG, undefined, {
      preparacionId: 'sopa_lentejas',
    });
    expect(eq).not.toBeNull();
    for (const o of eq!.options) expect(findFood(o.foodId)!.tags, o.name).toContain('leguminosa');
  });

  it('la zanahoria de la sopa se cambia por otra verdura', () => {
    const eq = equivalenciasDeAlimento('Zanahoria', 40, MAU, DEFAULT_CONFIG, undefined, {
      preparacionId: 'sopa_lentejas',
    });
    expect(eq).not.toBeNull();
    for (const o of eq!.options) expect(findFood(o.foodId)!.role, o.name).toBe('vegetal_libre');
  });

  it('la verdura que da nombre a la crema no se cambia', () => {
    const eq = equivalenciasDeAlimento('Calabacita', 200, MAU, DEFAULT_CONFIG, undefined, {
      preparacionId: 'crema_calabacita',
    });
    expect(eq).toBeNull();
  });

  it('en el menu, ningun ingrediente de platillo ofrece algo fuera del platillo', () => {
    for (const { meal } of conPlatillo(['sopa', 'crema', 'caldo', 'licuado'])) {
      const prep = PREPARACIONES.find((p) => p.id === meal.preparacion!.id)!;
      const deLaReceta = new Set(prep.ingredientes.flatMap((i) => [i.foodId, ...(i.opciones ?? [])]));
      for (const item of meal.items.filter((i) => i.preparacion)) {
        const eq = meal.equivalences.find((e) => e.forFoodId === item.foodId);
        const food = findFood(item.foodId)!;
        for (const o of eq?.options ?? []) {
          const otro = findFood(o.foodId)!;
          const hermano =
            deLaReceta.has(o.foodId) ||
            (food.tags.includes('leguminosa') && otro.tags.includes('leguminosa')) ||
            (food.role === 'vegetal_libre' && otro.role === 'vegetal_libre');
          expect(hermano, `${item.name} -> ${o.name} en ${prep.id}`).toBe(true);
        }
      }
    }
  });

  it('las equivalencias no ofrecen la proteina ni el cereal de otra comida del dia', () => {
    for (const menu of MENUS) {
      for (const meal of menu.meals) {
        const fuera = new Set(
          otrasComidas(menu, meal)
            .map((id) => findFood(id))
            .map((f) => (f ? familiaDe(f) : undefined))
            .filter((f) => f !== undefined),
        );
        for (const eq of meal.equivalences) {
          const propia = familiaDe(findFood(eq.forFoodId)!);
          for (const o of eq.options) {
            const fam = familiaDe(findFood(o.foodId)!);
            if (fam === undefined || fam === propia) continue;
            expect(fuera.has(fam), `${eq.forName} -> ${o.name} (${fam}) en ${meal.slot}`).toBe(false);
          }
        }
      }
    }
  });
});

describe('cambiar el platillo entero: sopa por sopa', () => {
  const sopas = conPlatillo(['sopa', 'crema', 'caldo']);
  const licuados = conPlatillo(['licuado']);

  it('la semana de Mau trae sopas y licuados para probar', () => {
    expect(sopas.length).toBeGreaterThan(0);
    expect(licuados.length).toBeGreaterThan(0);
  });

  it('una sopa solo se cambia por sopa, crema o caldo; un licuado por licuado', () => {
    for (const { menu, meal } of [...sopas, ...licuados]) {
      const opciones = opcionesDePlatillo({ meal, profile: MAU, enElDia: otrasComidas(menu, meal) });
      const grupo = meal.preparacion!.tipo === 'licuado' ? ['licuado'] : ['sopa', 'crema', 'caldo'];
      for (const o of opciones) {
        expect(grupo, `${meal.preparacion!.id} -> ${o.id}`).toContain(o.tipo);
        expect(o.id).not.toBe(meal.preparacion!.id);
      }
    }
  });

  it('al menos una sopa de la semana tiene otra sopa por la que cambiarse', () => {
    const conOpciones = sopas.filter(
      ({ menu, meal }) => opcionesDePlatillo({ meal, profile: MAU, enElDia: otrasComidas(menu, meal) }).length > 0,
    );
    expect(conOpciones.length).toBeGreaterThan(0);
  });

  it('al cambiarla, todos los ingredientes son del platillo nuevo y la comida conserva sus macros', () => {
    let probados = 0;
    for (const { menu, meal } of [...sopas, ...licuados]) {
      const enElDia = otrasComidas(menu, meal);
      for (const o of opcionesDePlatillo({ meal, profile: MAU, enElDia })) {
        const nueva = cambiarPlatillo({ meal, profile: MAU, enElDia, preparacionId: o.id });
        expect(nueva, o.id).not.toBeNull();
        probados += 1;
        expect(nueva!.preparacion?.id).toBe(o.id);
        const viejos = meal.items.filter((i) => i.preparacion).map((i) => i.foodId);
        const nuevos = nueva!.items.filter((i) => i.preparacion);
        expect(nuevos.every((i) => i.preparacion!.id === o.id)).toBe(true);
        // Ningun ingrediente del platillo viejo se queda colgado como suelto
        // salvo que el nuevo tambien lo lleve.
        const sueltos = nueva!.items.filter((i) => !i.preparacion).map((i) => i.foodId);
        for (const id of viejos) {
          if (nuevos.some((i) => i.foodId === id)) continue;
          const eraDeLado = meal.items.some((i) => !i.preparacion && i.foodId === id);
          if (!eraDeLado) expect(sueltos, `${id} de ${meal.preparacion!.id}`).not.toContain(id);
        }
        expect(Math.abs(nueva!.totals.proteinG - meal.totals.proteinG)).toBeLessThanOrEqual(5);
        expect(Math.abs(nueva!.totals.kcal - meal.totals.kcal)).toBeLessThanOrEqual(
          Math.max(meal.totals.kcal * 0.1, 30),
        );
        // Sin duplicados en la comida.
        const ids = nueva!.items.map((i) => i.foodId);
        expect(new Set(ids).size, ids.join(',')).toBe(ids.length);
      }
    }
    expect(probados).toBeGreaterThan(0);
  });

  it('un platillo que no es opcion no se aplica', () => {
    const { menu, meal } = sopas[0]!;
    expect(
      cambiarPlatillo({ meal, profile: MAU, enElDia: otrasComidas(menu, meal), preparacionId: 'licuado_verde' }),
    ).toBeNull();
  });
});
