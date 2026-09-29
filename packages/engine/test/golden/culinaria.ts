import { generateMenu } from '../../src/menu.js';
import { distribute } from '../../src/meals.js';
import { kcalForDeficit, macrosFor } from '../../src/calc.js';
import { DEFAULT_CONFIG, pickDeficit } from '../../src/config.js';
import { findFood } from '../../src/foods.js';
import type { Food, Menu, MenuItem, MenuMeal, MenuPlan, Phase, Profile } from '../../src/types.js';

/**
 * Las reglas culinarias de la auditoria de 70 menus (J2), escritas como
 * conteos: cada regla devuelve sus violaciones en un plan. El golden exige
 * cero; `audit.py` del scratchpad cuenta lo mismo desde fuera.
 */

export interface CasoCulinario {
  nombre: string;
  phase: Phase;
  profile: Profile;
}

/** Los cinco perfiles de la auditoria, mas el de tres comidas con entreno de tarde. */
export const CASOS_CULINARIOS: CasoCulinario[] = [
  {
    nombre: 'Mau',
    phase: 'CUT',
    profile: { sex: 'male', ageYears: 38, heightCm: 182, weightKg: 120, strengthDaysPerWeek: 5, cardioMinPerWeek: 90, work: 'sedentario', mealsPerDay: 4, trainingTime: 'manana', budget: 'medio', tipoLeche: 'descremada' },
  },
  {
    nombre: 'Irma',
    phase: 'BASE',
    profile: { sex: 'female', ageYears: 34, heightCm: 160, weightKg: 62, strengthDaysPerWeek: 6, cardioMinPerWeek: 120, work: 'activo', mealsPerDay: 5, trainingTime: 'manana', budget: 'medio', maxPrepMin: 20 },
  },
  {
    nombre: 'Vegetariana',
    phase: 'BASE',
    profile: { sex: 'female', ageYears: 29, heightCm: 168, weightKg: 65, strengthDaysPerWeek: 4, cardioMinPerWeek: 120, work: 'sedentario', mealsPerDay: 5, trainingTime: 'tarde', budget: 'medio', diet: 'vegetariana' },
  },
  {
    nombre: 'Keto',
    phase: 'BASE',
    profile: { sex: 'female', ageYears: 41, heightCm: 165, weightKg: 78, strengthDaysPerWeek: 3, cardioMinPerWeek: 90, work: 'sedentario', mealsPerDay: 3, trainingTime: 'tarde', budget: 'medio', diet: 'keto' },
  },
  {
    nombre: 'Principiante',
    phase: 'REINTRO',
    profile: { sex: 'male', ageYears: 45, heightCm: 175, weightKg: 95, strengthDaysPerWeek: 3, cardioMinPerWeek: 60, work: 'sedentario', mealsPerDay: 3, trainingTime: 'tarde', budget: 'bajo' },
  },
  {
    nombre: 'Tres comidas, mañana',
    phase: 'CUT',
    profile: { sex: 'female', ageYears: 31, heightCm: 165, weightKg: 70, strengthDaysPerWeek: 4, cardioMinPerWeek: 90, work: 'sedentario', mealsPerDay: 3, trainingTime: 'manana', budget: 'medio' },
  },
];

export const DIAS_CULINARIOS = [1, 2, 3, 4, 5, 6, 7];

const planes = new Map<string, { plan: MenuPlan; kcal: number }>();

export function planDe(caso: CasoCulinario, dia: number): { plan: MenuPlan; kcal: number } {
  const llave = `${caso.nombre}:${dia}`;
  const guardado = planes.get(llave);
  if (guardado) return guardado;
  const kcal = kcalForDeficit(caso.profile, pickDeficit(caso.phase, DEFAULT_CONFIG), DEFAULT_CONFIG);
  const macros = macrosFor(caso.phase, caso.profile, kcal, DEFAULT_CONFIG);
  const slots = distribute(macros, caso.profile, caso.phase);
  const plan = generateMenu(slots, caso.profile, DEFAULT_CONFIG, 100 + dia, { phase: caso.phase });
  const salida = { plan, kcal: macros.kcal };
  planes.set(llave, salida);
  return salida;
}

// ---------------------------------------------------------------------------

const f = (i: Pick<MenuItem, 'foodId'>): Food => findFood(i.foodId)!;
const CARBOS = ['carbo_pre', 'carbo_post', 'carbo_complejo'];
export const LATAS = new Set(['atun_agua', 'atun_aceite', 'sardina_agua']);
const ATUN = new Set(['atun_agua', 'atun_aceite']);
const FECULAS = new Set(['arroz_blanco', 'arroz_integral', 'papa', 'camote', 'pasta_integral', 'elote']);
const TUBERCULOS = new Set(['papa', 'camote']);
const AVENA = new Set(['avena', 'avena_cocida']);
const CARNE_O_PESCADO = (food: Food): boolean =>
  food.role.startsWith('proteina') && food.tags.includes('no_vegetariano') && food.id !== 'jamon_pavo';
const VERDURA_KETO_DESAYUNO = new Set(['espinaca', 'nopal', 'champinon', 'calabacita']);

export function minutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
const esManana = (meal: MenuMeal): boolean => minutos(meal.timeHint) <= 11 * 60;
const esCena = (meal: MenuMeal): boolean => meal.slot === 'CENA' || /^cena/i.test(meal.label);
const sueltos = (meal: MenuMeal): MenuItem[] => meal.items.filter((i) => !i.preparacion);
const esLeguminosa = (food: Food): boolean => food.tags.includes('leguminosa');
/** Tazas de un renglon medido en tazas; `undefined` si no se mide asi. */
function tazas(i: MenuItem): number | undefined {
  const s = f(i).serving;
  return s && s.unit === 'taza' ? i.grams / s.gramsPerUnit : undefined;
}
function donde(caso: CasoCulinario, dia: number, menu: Menu, meal?: MenuMeal): string {
  const base = `${caso.nombre} d${dia} M${menu.id}`;
  return meal ? `${base} ${meal.slot} ${meal.timeHint}: ${meal.items.map((i) => i.name).join(' + ')}` : base;
}

export type Regla = (caso: CasoCulinario, dia: number, plan: MenuPlan) => string[];

function porComida(chequeo: (meal: MenuMeal, menu: Menu, caso: CasoCulinario) => boolean): Regla {
  return (caso, dia, plan) =>
    plan.menus.flatMap((menu) =>
      menu.meals.filter((meal) => chequeo(meal, menu, caso)).map((meal) => donde(caso, dia, menu, meal)),
    );
}

export const REGLAS: Record<string, Regla> = {
  // 1. Desayuno por hora: nada `no_desayuno` antes de las 11:00.
  r01_desayuno_por_hora: porComida(
    (meal) => esManana(meal) && meal.items.some((i) => f(i).tags.includes('no_desayuno')),
  ),

  // 2. Keto: base cocinable, una grasa suelta (el aceite es de coccion) y la
  // verdura del desayuno cocida.
  r02_keto_platillo: porComida((meal, _menu, caso) => {
    // El peri-entreno (PRE/POST) es rapido por definicion: no se guisa.
    if (caso.profile.diet !== 'keto' || meal.slot === 'PRE' || meal.slot === 'POST') return false;
    const proteinas = meal.items.filter((i) => f(i).role.startsWith('proteina'));
    const cocinable = proteinas.some((i) => !f(i).tags.includes('sin_cocinar'));
    // El aceite del sarten y la mantequilla del huevo son grasa de coccion.
    const grasas = sueltos(meal).filter(
      (i) => f(i).role === 'grasa' && !i.foodId.startsWith('aceite_') && i.foodId !== 'mantequilla',
    );
    const verduraMal =
      esManana(meal) &&
      meal.items.some((i) => f(i).role === 'vegetal_libre' && !VERDURA_KETO_DESAYUNO.has(i.foodId));
    return !cocinable || grasas.length > 1 || verduraMal;
  }),

  // 3. Latas: una comida al dia, 150 g, y el atun en un solo menu de la semana.
  r03_latas: (caso, dia, plan) => {
    const fuera: string[] = [];
    for (const menu of plan.menus) {
      const conLata = menu.meals.filter((m) => m.items.some((i) => LATAS.has(i.foodId)));
      if (conLata.length > 1) fuera.push(`${donde(caso, dia, menu)} latas en ${conLata.map((m) => m.slot).join(',')}`);
      for (const meal of menu.meals) {
        for (const i of meal.items) {
          if (LATAS.has(i.foodId) && i.grams > 150) fuera.push(`${donde(caso, dia, menu, meal)} ${i.grams} g`);
        }
      }
    }
    const menusConAtun = plan.menus.filter((m) => m.meals.some((ml) => ml.items.some((i) => ATUN.has(i.foodId))));
    const distintos = new Set(plan.menus.map((m) => m.id));
    if (distintos.size > 1 && menusConAtun.length > 1) fuera.push(`${caso.nombre} d${dia} atun en los dos menus (7 dias)`);
    return fuera;
  },

  // 4. Vegetariana: claras una vez al dia; la comida fuerte es leguminosa o
  // tofu con cereal, y trae al menos tres alimentos contados.
  r04_vegetariana: (caso, dia, plan) => {
    if (caso.profile.diet !== 'vegetariana') return [];
    const fuera: string[] = [];
    for (const menu of plan.menus) {
      const claras = menu.meals.filter((m) => m.items.some((i) => i.foodId === 'claras_huevo' || i.foodId === 'clara_liquida'));
      if (claras.length > 1) fuera.push(`${donde(caso, dia, menu)} claras en ${claras.map((m) => m.slot).join(',')}`);
      for (const meal of menu.meals.filter((m) => m.slot === 'COMIDA')) {
        const foods = meal.items.map(f);
        const base = foods.some((x) => esLeguminosa(x) || x.id === 'tofu_firme');
        const cereal = foods.some((x) => CARBOS.includes(x.role) && !esLeguminosa(x));
        const contados = meal.items.filter((i) => !i.free && f(i).role !== 'vegetal_libre');
        if (!base || !cereal || contados.length < 3) fuera.push(donde(caso, dia, menu, meal));
      }
    }
    return fuera;
  },

  // 5. Una fruta por comida (el platano cuenta), una fecula, y la leguminosa
  // no va con tuberculo.
  r05_feculas_y_fruta: porComida((meal) => {
    const frutas = meal.items.filter((i) => f(i).role === 'fruta' || i.foodId === 'platano_post');
    const feculas = meal.items.filter((i) => FECULAS.has(i.foodId));
    const legumbreConTuberculo =
      meal.items.some((i) => esLeguminosa(f(i)) && CARBOS.includes(f(i).role)) &&
      meal.items.some((i) => TUBERCULOS.has(i.foodId));
    return frutas.length > 1 || feculas.length > 1 || legumbreConTuberculo;
  }),

  // 6. La sopa no se duplica: sopa de leguminosa o pasta sin cereal al lado;
  // caldo o sopa de verdura con media porcion; una leguminosa al dia si hay
  // sopa de leguminosa; leguminosa <= 1 taza por comida.
  r06_sopa_no_duplica: (caso, dia, plan) => {
    const fuera: string[] = [];
    for (const menu of plan.menus) {
      const sopaDeLegumbre = menu.meals.some(
        (m) => m.preparacion && m.preparacion.tipo !== 'licuado' && m.items.some((i) => i.preparacion && esLeguminosa(f(i))),
      );
      const conLegumbre = menu.meals.filter((m) => m.items.some((i) => esLeguminosa(f(i)) && CARBOS.includes(f(i).role)));
      if (sopaDeLegumbre && conLegumbre.length > 1) fuera.push(`${donde(caso, dia, menu)} leguminosa en ${conLegumbre.map((m) => m.slot).join(',')}`);
      for (const meal of menu.meals) {
        for (const i of meal.items) {
          const t = tazas(i);
          if (esLeguminosa(f(i)) && t !== undefined && t > 1 + 1e-9) fuera.push(`${donde(caso, dia, menu, meal)} ${t} tazas`);
        }
        if (!meal.preparacion || meal.preparacion.tipo === 'licuado') continue;
        const delPlatillo = meal.items.filter((i) => i.preparacion);
        const cerealAlLado = sueltos(meal).filter((i) => CARBOS.includes(f(i).role));
        const pesada = delPlatillo.some((i) => esLeguminosa(f(i)) || i.foodId === 'pasta_integral');
        if (pesada && cerealAlLado.length > 0) fuera.push(`${donde(caso, dia, menu, meal)} (sopa pesada + cereal)`);
        if (!pesada) {
          for (const c of cerealAlLado) {
            const s = f(c).serving;
            const media = s ? Math.max(s.minUnits * s.gramsPerUnit, (s.maxUnits * s.gramsPerUnit) / 2) : 9999;
            if (c.grams > media + 1e-9) fuera.push(`${donde(caso, dia, menu, meal)} (${c.name} ${c.grams} g > media porcion)`);
          }
        }
      }
    }
    return fuera;
  },

  // 7. Cena ligera: leguminosa <= media taza y nunca con dos grasas.
  r07_cena_ligera: porComida((meal) => {
    if (!esCena(meal)) return false;
    const legumbre = meal.items.filter((i) => esLeguminosa(f(i)) && CARBOS.includes(f(i).role));
    if (legumbre.length === 0) return false;
    const grasas = meal.items.filter((i) => f(i).role === 'grasa');
    return legumbre.some((i) => (tazas(i) ?? 0) > 0.5 + 1e-9) || grasas.length > 1;
  }),

  // 8. El platillo que tarda mas que el tope de cocina no sale.
  r08_tiempo_de_preparacion: porComida((meal, _menu, caso) => {
    const tope = caso.profile.maxPrepMin;
    if (tope === undefined || !meal.preparacion) return false;
    const prep = PREP_MIN[meal.preparacion.id] ?? 0;
    return prep > tope;
  }),

  // 9. Avena en leche o con fruta, nunca con aceite ni aguacate; nada de
  // cereal denso despues de las 21:00.
  r09_avena_y_noche: porComida((meal) => {
    const tarde = minutos(meal.timeHint) >= 21 * 60;
    if (tarde && meal.items.some((i) => CARBOS.includes(f(i).role))) return true;
    if (!meal.items.some((i) => AVENA.has(i.foodId))) return false;
    const conGrasaMal = meal.items.some((i) => i.foodId.startsWith('aceite_') || i.foodId === 'aguacate');
    const conLecheOFruta = meal.items.some((i) => f(i).role === 'fruta' || f(i).tags.includes('leche'));
    return conGrasaMal || !conLecheOFruta;
  }),

  // 10. El cereal de desayuno va con lacteo, huevo o fruta: nunca con carne,
  // pescado ni verdura salada.
  r10_cereal_de_desayuno: porComida((meal) => {
    if (!meal.items.some((i) => f(i).tags.includes('cereal_desayuno'))) return false;
    return meal.items.some(
      (i) => CARNE_O_PESCADO(f(i)) || (f(i).role === 'vegetal_libre' && !i.preparacion),
    );
  }),

  // 11. Al lado del licuado solo pan, tortilla o fruta entera.
  r11_licuado_solo: porComida((meal) => {
    if (meal.preparacion?.tipo !== 'licuado') return false;
    return sueltos(meal).some((i) => {
      const food = f(i);
      if (food.role === 'fruta' || i.foodId === 'platano_post') return false;
      return !['pan_integral', 'pan_centeno', 'tortilla_maiz'].includes(i.foodId);
    });
  }),

  // 12. El pre-entreno trae a lo mucho 10 g de grasa.
  r12_pre_ligero: porComida((meal) => meal.slot === 'PRE' && meal.totals.fatG > 10 + 1e-9),

  // 13. Tres comidas son desayuno, comida y cena; el dia cuadra +-5 %.
  r13_tres_comidas: (caso, dia, plan) => {
    const fuera: string[] = [];
    const { kcal } = planDe(caso, dia);
    for (const menu of plan.menus) {
      if (menu.meals.length === 3 && menu.meals.map((m) => m.slot).join(',') !== 'DESAYUNO,COMIDA,CENA') {
        fuera.push(`${donde(caso, dia, menu)} ${menu.meals.map((m) => m.slot).join(',')}`);
      }
      if (Math.abs(menu.totals.kcal - kcal) / kcal > 0.05) fuera.push(`${donde(caso, dia, menu)} kcal ${menu.deviationPct.kcal}%`);
    }
    return fuera;
  },

  // 14. Avisos por dieta.
  r14_avisos_por_dieta: (caso, dia, plan) => {
    const notas = plan.notas.join(' ').toLowerCase();
    if (caso.profile.diet === 'keto' && !notas.includes('electrolitos')) return [`${caso.nombre} d${dia} keto sin electrolitos`];
    if (caso.profile.diet === 'vegetariana' && !(notas.includes('b12') && notas.includes('leguminosa'))) {
      return [`${caso.nombre} d${dia} vegetariana sin B12 ni leguminosa + cereal`];
    }
    return [];
  },

  // 15. Costo y cercania: lo de costo medio o alto <= 7 veces en la semana;
  // a lo mucho 3 alimentos de fuera (sin `mexicano` ni `favorito`).
  r15_costo_y_cercania: (caso, dia, plan) => {
    const diasPorMenu = new Set(plan.menus.map((m) => m.id)).size > 1 && plan.menus[0] !== plan.menus[1] ? 3.5 : 7;
    const menus = plan.menus[0]!.meals === plan.menus[1]!.meals ? [plan.menus[0]!] : plan.menus;
    const veces = new Map<string, number>();
    const fuera = new Set<string>();
    for (const menu of menus) {
      for (const meal of menu.meals) {
        for (const i of meal.items) {
          const food = f(i);
          if (food.costRel >= 2) veces.set(food.id, (veces.get(food.id) ?? 0) + diasPorMenu);
          if (!food.tags.includes('mexicano') && !food.tags.includes('favorito') && food.role !== 'vegetal_libre' && !food.tags.includes('leche') && !food.tags.includes('base_agua')) fuera.add(food.id);
        }
      }
    }
    const salida = [...veces.entries()].filter(([, n]) => n > 7).map(([id, n]) => `${caso.nombre} d${dia} ${id} ${n} veces`);
    if (fuera.size > 3) salida.push(`${caso.nombre} d${dia} de fuera: ${[...fuera].join(',')}`);
    return salida;
  },
};

import { PREPARACIONES } from '../../src/preparaciones.js';
const PREP_MIN: Record<string, number> = Object.fromEntries(PREPARACIONES.map((p) => [p.id, p.prepMin]));

/** Todas las violaciones de todos los casos, por regla. */
export function auditar(casos = CASOS_CULINARIOS, dias = DIAS_CULINARIOS): Record<string, Record<string, string[]>> {
  const salida: Record<string, Record<string, string[]>> = {};
  for (const [nombre, regla] of Object.entries(REGLAS)) {
    salida[nombre] = {};
    for (const caso of casos) {
      salida[nombre]![caso.nombre] = dias.flatMap((dia) => regla(caso, dia, planDe(caso, dia).plan));
    }
  }
  return salida;
}
