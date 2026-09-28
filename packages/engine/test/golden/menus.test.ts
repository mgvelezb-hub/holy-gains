import { describe, expect, it } from 'vitest';
import { generateMenu, incompatibles } from '../../src/menu.js';
import { distribute } from '../../src/meals.js';
import { kcalForDeficit, macrosFor } from '../../src/calc.js';
import { DEFAULT_CONFIG, pickDeficit } from '../../src/config.js';
import { FOODS, findFood } from '../../src/foods.js';
import { familiaDe } from '../../src/familias.js';
import type { Phase, Profile } from '../../src/types.js';

/**
 * Golden de realismo: cinco personas reales, siete dias cada una.
 *
 * NO congelan gramos. Un golden de gramos exactos se rompe con cualquier
 * mejora del solver y obliga a "actualizar el esperado" sin mirar si el menu
 * quedo mejor o peor, que es justo lo contrario de lo que un golden sirve.
 * Lo que congelan son las promesas: que cada porcion sea una porcion que
 * alguien se sirve, que el platillo tenga sentido, y que el dia cuadre.
 */

interface Caso {
  nombre: string;
  profile: Profile;
  phase: Phase;
}

const CASOS: Caso[] = [
  {
    // Mau: 120 kg, 1.82 m, cinco dias de pesas, quiere bajar grasa.
    nombre: 'Mau, 120 kg, 5 dias de pesas, bajando grasa',
    phase: 'CUT',
    profile: {
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
    },
  },
  {
    // Irma: 62 kg, entrena cuatro dias, come cinco veces y cocina poco.
    nombre: 'Irma, 62 kg, 4 dias de pesas',
    phase: 'BASE',
    profile: {
      sex: 'female',
      ageYears: 34,
      heightCm: 160,
      weightKg: 62,
      strengthDaysPerWeek: 4,
      cardioMinPerWeek: 120,
      work: 'activo',
      mealsPerDay: 4,
      trainingTime: 'manana',
      budget: 'medio',
      maxPrepMin: 20,
    },
  },
  {
    nombre: 'cinco comidas al dia',
    phase: 'BASE',
    profile: {
      sex: 'female',
      ageYears: 29,
      heightCm: 168,
      weightKg: 70,
      strengthDaysPerWeek: 5,
      cardioMinPerWeek: 150,
      work: 'sedentario',
      mealsPerDay: 5,
      trainingTime: 'tarde',
      budget: 'alto',
    },
  },
  {
    nombre: 'principiante sin gimnasio',
    phase: 'REINTRO',
    profile: {
      sex: 'male',
      ageYears: 45,
      heightCm: 175,
      weightKg: 95,
      strengthDaysPerWeek: 0,
      cardioMinPerWeek: 60,
      work: 'sedentario',
      mealsPerDay: 3,
      trainingTime: 'manana',
      budget: 'bajo',
    },
  },
  {
    nombre: 'keto',
    phase: 'BASE',
    profile: {
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
    },
  },
];

const DIAS = [1, 2, 3, 4, 5, 6, 7];

function diaDe(caso: Caso, dia: number) {
  const kcal = kcalForDeficit(caso.profile, pickDeficit(caso.phase, DEFAULT_CONFIG), DEFAULT_CONFIG);
  const macros = macrosFor(caso.phase, caso.profile, kcal, DEFAULT_CONFIG);
  const slots = distribute(macros, caso.profile, caso.phase);
  const plan = generateMenu(slots, caso.profile, DEFAULT_CONFIG, 100 + dia, { phase: caso.phase });
  // Los DOS menus del dia: son las dos variantes que la persona va a comer esa
  // semana, y las promesas valen para las dos.
  return { macros, menus: plan.menus };
}

/** Todas las comidas del dia, de los dos menus. */
function comidasDe(caso: Caso, dia: number) {
  return diaDe(caso, dia).menus.flatMap((menu) =>
    menu.meals.map((meal) => ({ ...meal, menuId: menu.id })),
  );
}

describe.each(CASOS)('$nombre', (caso) => {
  it('ninguna porcion es una pizca ni un exceso', () => {
    for (const dia of DIAS) {
      for (const meal of comidasDe(caso, dia)) {
        for (const item of meal.items) {
          const food = findFood(item.foodId)!;
          if (!food.serving) continue;
          const min = food.serving.minUnits * food.serving.gramsPerUnit;
          const max = food.serving.maxUnits * food.serving.gramsPerUnit;
          const donde = `${item.name} dia ${dia} ${meal.slot}`;
          expect(item.grams, donde).toBeGreaterThanOrEqual(Math.floor(min));
          expect(item.grams, donde).toBeLessThanOrEqual(Math.ceil(max));
        }
      }
    }
  });

  it('ninguna comida rompe la composicion del platillo', () => {
    const { composicion } = DEFAULT_CONFIG;
    const familias = [
      ['grasa_anadida', composicion.grasaAnadidaMaxGPorComida],
      ['leguminosa', composicion.leguminosaMaxGPorComida],
      ['cereal_cocido', composicion.cerealCocidoMaxGPorComida],
      ['fruto_seco', composicion.frutoSecoMaxGPorComida],
    ] as const;

    for (const dia of DIAS) {
      for (const meal of comidasDe(caso, dia)) {
        const foods = meal.items.map((i) => findFood(i.foodId)!);
        const donde = `dia ${dia} menu ${meal.menuId} ${meal.slot}`;

        for (const [familia, tope] of familias) {
          const gramos = meal.items
            .filter((i) => findFood(i.foodId)!.tags.includes(familia))
            .reduce((acc, i) => acc + i.grams, 0);
          expect(gramos, `${familia} en ${donde}`).toBeLessThanOrEqual(tope);
        }
        expect(
          foods.filter((f) => f.tags.includes('grasa_anadida')).length,
          `grasas anadidas en ${donde}`,
        ).toBeLessThanOrEqual(composicion.maxGrasasAnadidasPorComida);

        for (const a of foods) {
          for (const b of foods) {
            if (a === b) continue;
            expect(incompatibles(a, b, DEFAULT_CONFIG), `${a.name} + ${b.name} en ${donde}`).toBe(
              false,
            );
          }
        }
      }
    }
  });

  // Cinco ingredientes en una comida principal, cuatro en el peri-entreno y la
  // colacion. El vegetal libre no cuenta: no se cocina, se sirve al lado. Y
  // un platillo cuenta como uno: el licuado es una cosa en la mesa.
  it('ninguna comida pasa de su tope de ingredientes', () => {
    for (const dia of DIAS) {
      for (const meal of comidasDe(caso, dia)) {
        const ligera = ['PRE', 'POST', 'SNACK'].includes(meal.slot);
        const tope = ligera ? DEFAULT_CONFIG.maxFoodsPerLightMeal : DEFAULT_CONFIG.maxFoodsPerMeal;
        // Un platillo (licuado, sopa) cuenta como uno: es una cosa en la mesa.
        const ingredientes = meal.items.filter(
          (i, n, todos) =>
            i.preparacion
              ? todos.findIndex((o) => o.preparacion?.id === i.preparacion!.id) === n
              : findFood(i.foodId)!.role !== 'vegetal_libre',
        );
        expect(
          ingredientes.length,
          `dia ${dia} menu ${meal.menuId} ${meal.slot}: ${ingredientes.map((i) => i.name).join(' + ')}`,
        ).toBeLessThanOrEqual(tope);
      }
    }
  });

  it('ningun alimento aparece dos veces en la misma comida', () => {
    for (const dia of DIAS) {
      for (const meal of comidasDe(caso, dia)) {
        const nombres = meal.items.map((i) => i.name);
        expect(
          new Set(nombres).size,
          `dia ${dia} menu ${meal.menuId} ${meal.slot}: ${nombres.join(' + ')}`,
        ).toBe(nombres.length);
      }
    }
  });

  // Menu 1 de Mau: yogur en el desayuno y otra vez en el licuado, avena en
  // los dos. La proteina principal y el cereal no se repiten en el dia; la
  // unica salida es la despensa corta, y esa queda declarada en el menu.
  it('ninguna proteina principal ni cereal se repite en el dia', () => {
    for (const dia of DIAS) {
      for (const menu of diaDe(caso, dia).menus) {
        const porFamilia = new Map<string, string[]>();
        for (const meal of menu.meals) {
          const familias = new Set(
            meal.items.map((i) => familiaDe(findFood(i.foodId)!)).filter((f) => f !== undefined),
          );
          for (const familia of familias) {
            porFamilia.set(familia, [...(porFamilia.get(familia) ?? []), meal.slot]);
          }
        }
        const declaradas = new Set((menu.repeticiones ?? []).map((r) => r.familia));
        for (const [familia, slots] of porFamilia) {
          if (slots.length < 2) continue;
          expect(declaradas.has(familia), `${familia} en ${slots.join(' y ')} dia ${dia} menu ${menu.id}`).toBe(true);
        }
        // La excepcion solo vale cuando de verdad no habia otra: el dia ya uso
        // TODAS las familias que el presupuesto de esa persona alcanza (el
        // principiante de presupuesto bajo tiene cuatro proteinas para tres
        // comidas, y el desayuno lleva dos).
        for (const { familia } of menu.repeticiones ?? []) {
          const tope = caso.profile.budget === 'bajo' ? 1 : caso.profile.budget === 'medio' ? 2 : 3;
          const esProteina = FOODS.some((f) => familiaDe(f) === familia && f.role.startsWith('proteina'));
          const alcanzables = new Set(
            FOODS.filter(
              (f) =>
                f.costRel <= tope &&
                (esProteina ? f.role.startsWith('proteina') : !f.role.startsWith('proteina')) &&
                !f.tags.includes('suplemento'),
            )
              .map((f) => familiaDe(f))
              .filter((f) => f !== undefined),
          );
          for (const alcanzable of alcanzables) {
            expect(porFamilia.has(alcanzable), `${familia} repetida sin usar ${alcanzable}, dia ${dia} menu ${menu.id}`).toBe(true);
          }
        }
      }
    }
  });

  it('toda comida principal trae una proteina de verdad', () => {
    for (const dia of DIAS) {
      for (const meal of comidasDe(caso, dia)) {
        if (meal.slot === 'SNACK') continue;
        const donde = `dia ${dia} menu ${meal.menuId} ${meal.slot}: ${meal.items.map((i) => i.name).join(' + ')}`;
        const fuentes = meal.items.filter((i) => findFood(i.foodId)!.role.startsWith('proteina'));
        expect(fuentes.length, donde).toBeGreaterThanOrEqual(1);
        expect(Math.max(...fuentes.map((i) => i.proteinG)), donde).toBeGreaterThanOrEqual(
          DEFAULT_CONFIG.mealProteinMinG,
        );
      }
    }
  });

  it('la colacion nunca es cereal con grasa a secas', () => {
    for (const dia of DIAS) {
      for (const meal of comidasDe(caso, dia).filter((m) => m.slot === 'SNACK')) {
        const roles = meal.items.map((i) => findFood(i.foodId)!.role);
        const donde = `dia ${dia}: ${meal.items.map((i) => i.name).join(' + ')}`;
        const hayProteina = roles.some((r) => r.startsWith('proteina'));
        const frutaConGrasa = roles.includes('fruta') && roles.includes('grasa');
        expect(hayProteina || frutaConGrasa, donde).toBe(true);
      }
    }
  });

  it('un solo carbohidrato de cada subtipo, y maximo dos por comida', () => {
    const { maxCarbosPorComida, subtiposDeCarbo } = DEFAULT_CONFIG.composicion;
    for (const dia of DIAS) {
      for (const meal of comidasDe(caso, dia)) {
        const carbos = meal.items.filter((i) =>
          ['carbo_pre', 'carbo_post', 'carbo_complejo'].includes(findFood(i.foodId)!.role),
        );
        const donde = `dia ${dia} menu ${meal.menuId} ${meal.slot}: ${carbos.map((c) => c.name).join(' + ')}`;
        expect(carbos.length, donde).toBeLessThanOrEqual(maxCarbosPorComida);
        for (const subtipo of subtiposDeCarbo) {
          expect(
            carbos.filter((i) => findFood(i.foodId)!.tags.includes(subtipo)).length,
            `${subtipo} en ${donde}`,
          ).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('nunca tres grasas, y las semillas cuentan como anadida', () => {
    const { maxGrasasPorComida, maxGrasasAnadidasPorComida } = DEFAULT_CONFIG.composicion;
    for (const dia of DIAS) {
      for (const meal of comidasDe(caso, dia)) {
        const grasas = meal.items.filter((i) => findFood(i.foodId)!.role === 'grasa');
        const donde = `dia ${dia} menu ${meal.menuId} ${meal.slot}: ${grasas.map((g) => g.name).join(' + ')}`;
        expect(grasas.length, donde).toBeLessThanOrEqual(maxGrasasPorComida);
        expect(
          grasas.filter((i) => findFood(i.foodId)!.tags.includes('grasa_anadida')).length,
          donde,
        ).toBeLessThanOrEqual(maxGrasasAnadidasPorComida);
      }
    }
  });

  it('cada comida lleva lo que a esa comida le toca', () => {
    for (const dia of DIAS) {
      for (const meal of comidasDe(caso, dia)) {
        const desayuno =
          meal.slot === 'DESAYUNO' ||
          (meal.slot === 'PRE' && Number(meal.timeHint.split(':')[0]) <= 10);
        for (const item of meal.items) {
          const food = findFood(item.foodId)!;
          const donde = `${food.name} en dia ${dia} menu ${meal.menuId} ${meal.slot} ${meal.timeHint}`;
          if (desayuno) expect(food.tags, donde).not.toContain('no_desayuno');
          else expect(food.tags, donde).not.toContain('solo_desayuno');
          if (meal.slot === 'CENA' && ['carbo_pre', 'carbo_post', 'carbo_complejo'].includes(food.role)) {
            expect(food.tags, donde).toContain('ligero');
          }
        }
      }
    }
  });

  it('el dia cuadra: kcal +-5 % y proteina +-5 g', () => {
    for (const dia of DIAS) {
      const { macros, menus } = diaDe(caso, dia);
      for (const menu of menus) {
        expect(Math.abs(menu.deviationPct.kcal), `kcal dia ${dia} menu ${menu.id}`).toBeLessThanOrEqual(5);
        expect(
          Math.abs(menu.totals.proteinG - macros.proteinG),
          `proteina dia ${dia} menu ${menu.id}`,
        ).toBeLessThanOrEqual(5);
      }
    }
  });

  it('cada alimento se puede leer sin traducir gramos', () => {
    for (const dia of DIAS) {
      for (const meal of comidasDe(caso, dia)) {
        for (const item of meal.items) {
          expect(item.display, `dia ${dia} ${item.name}`).toBeTruthy();
          expect(item.why.closes, `dia ${dia} ${item.name}`).toBeTruthy();
        }
      }
    }
  });
});

// Las preparaciones (licuados, sopas, cremas) eran una omision: el motor solo
// servia alimentos sueltos. La semana de Mau tiene que traer de las dos.
describe('la semana de Mau trae preparaciones', () => {
  const mau = CASOS[0]!;

  it('al menos un licuado y una sopa, crema o caldo en siete dias', () => {
    const tipos = DIAS.flatMap((dia) =>
      comidasDe(mau, dia).flatMap((meal) => (meal.preparacion ? [meal.preparacion.tipo] : [])),
    );
    expect(tipos).toContain('licuado');
    expect(tipos.some((t) => t === 'sopa' || t === 'crema' || t === 'caldo')).toBe(true);
  });

  it('con las preparaciones apagadas no sale ninguna', () => {
    const apagado: Caso = {
      ...mau,
      profile: { ...mau.profile, preparaciones: { licuados: false, sopas: false, cremas: false } },
    };
    for (const dia of DIAS) {
      for (const meal of comidasDe(apagado, dia)) {
        expect(meal.preparacion, `dia ${dia} ${meal.slot}`).toBeUndefined();
      }
    }
  });
});
