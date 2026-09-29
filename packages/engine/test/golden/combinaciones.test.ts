import { describe, expect, it } from 'vitest';
import { CASOS_CULINARIOS, DIAS_CULINARIOS, planDe } from './culinaria.js';
import { COMBINACIONES, esComidaReconocible } from './combinaciones.js';

/**
 * Auditoria R2-B: en COMIDA y CENA, cinco perfiles por siete dias, al menos
 * el 90 % de las comidas son un platillo de la lista (tacos, tostadas,
 * sopa...) o una combinacion real (proteina + tortilla o arroz + verdura +
 * grasa, y las ocho de Jousfit).
 */
describe('comida y cena reconocibles', () => {
  const casos = CASOS_CULINARIOS.slice(0, 5);

  it('las ocho combinaciones de Jousfit estan en la lista', () => {
    expect(COMBINACIONES.filter((c) => c.fuente.startsWith('Jousfit'))).toHaveLength(8);
  });

  it('>= 90 % de COMIDA/CENA son platillo o combinacion permitida', () => {
    const fuera: string[] = [];
    let total = 0;
    for (const caso of casos) {
      for (const dia of DIAS_CULINARIOS) {
        for (const menu of planDe(caso, dia).plan.menus) {
          for (const meal of menu.meals.filter((m) => m.slot === 'COMIDA' || m.slot === 'CENA')) {
            total += 1;
            if (!esComidaReconocible(meal)) fuera.push(`${caso.nombre} d${dia} ${meal.slot}: ${meal.items.map((i) => i.name).join(' + ')}`);
          }
        }
      }
    }
    expect(total).toBeGreaterThan(100);
    expect(1 - fuera.length / total, fuera.join('\n')).toBeGreaterThanOrEqual(0.9);
  }, 30_000);

  it('los platillos mexicanos si salen: Mau y el perfil de tres comidas los comen', () => {
    for (const caso of [CASOS_CULINARIOS[0]!, CASOS_CULINARIOS[5]!]) {
      const comidas = DIAS_CULINARIOS.flatMap((dia) =>
        planDe(caso, dia).plan.menus.flatMap((m) => m.meals.filter((meal) => meal.slot === 'COMIDA' || meal.slot === 'CENA')),
      );
      const conPlatillo = comidas.filter((m) => m.preparacion?.tipo === 'platillo');
      expect(conPlatillo.length / comidas.length, caso.nombre).toBeGreaterThanOrEqual(0.25);
    }
  });
});
