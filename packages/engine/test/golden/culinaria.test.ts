import { describe, expect, it } from 'vitest';
import { CASOS_CULINARIOS, DIAS_CULINARIOS, REGLAS, planDe } from './culinaria.js';

/**
 * Golden culinario (J2): las 15 reglas de la auditoria de 70 menus, contadas
 * sobre los cinco perfiles de la auditoria mas uno de tres comidas con
 * entreno de manana, siete dias y los dos menus. Cada regla debe quedar en
 * cero. Las excepciones documentadas viven en la regla, no aqui: el
 * peri-entreno keto no se guisa (r02) y el presupuesto bajo sube un escalon
 * antes de repetir (r03).
 */
describe.each(Object.entries(REGLAS))('%s', (_nombre, regla) => {
  it.each(CASOS_CULINARIOS.map((c) => [c.nombre, c] as const))('%s: cero violaciones', (_n, caso) => {
    const violaciones = DIAS_CULINARIOS.flatMap((dia) => regla(caso, dia, planDe(caso, dia).plan));
    expect(violaciones).toEqual([]);
  });
});
