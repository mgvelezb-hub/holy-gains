import { describe, expect, it } from 'vitest';
import { CATALOGO_SUPLEMENTOS, SUPPLEMENTS, esSuplemento, fichaDe } from '../src/suplementos.js';

/**
 * El catalogo es contrato: cada ficha trae dosis dentro de su rango, tope,
 * evidencia citada y momento. Un suplemento sin cita o con la dosis por
 * encima de su propio tope no entra.
 */
describe('catalogo de suplementos', () => {
  it('los ids del JSON son exactamente SUPPLEMENTS, sin repetidos', () => {
    const ids = CATALOGO_SUPLEMENTOS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...SUPPLEMENTS].sort());
  });

  it('trae los tres de siempre y los nuevos del hallazgo H5', () => {
    for (const id of [
      'WHEY', 'CREATINA', 'OMEGA3', 'VITAMINA_D3', 'MAGNESIO', 'ASHWAGANDHA', 'CAFEINA',
      'ELECTROLITOS', 'FIBRA', 'ZINC', 'VITAMINA_B12', 'HIERRO', 'MULTIVITAMINICO',
      'MELATONINA', 'PROBIOTICO', 'CAFEINA_L_TEANINA',
    ]) {
      expect(fichaDe(id), id).toBeDefined();
    }
  });

  it('cada ficha trae dosis coherente, momento, porque, evidencia con ano y tope', () => {
    for (const f of CATALOGO_SUPLEMENTOS) {
      expect(f.dosis.min, f.id).toBeLessThanOrEqual(f.dosis.default);
      expect(f.dosis.default, f.id).toBeLessThanOrEqual(f.dosis.max);
      expect(f.nombre.length, f.id).toBeGreaterThan(2);
      expect(f.corto.length, f.id).toBeGreaterThan(1);
      expect(f.momento.length, f.id).toBeGreaterThan(5);
      expect(f.porque.length, f.id).toBeGreaterThan(20);
      expect(f.evidencia, f.id).toMatch(/(19|20)\d\d/);
      expect(f.tope.length, f.id).toBeGreaterThan(5);
    }
  });

  it('las dosis maximas respetan el UL de NIH ODS donde existe', () => {
    expect(fichaDe('VITAMINA_D3')!.dosis.max).toBeLessThanOrEqual(4000);
    expect(fichaDe('MAGNESIO')!.dosis.max).toBeLessThanOrEqual(350);
    expect(fichaDe('ZINC')!.dosis.max).toBeLessThanOrEqual(40);
    expect(fichaDe('HIERRO')!.dosis.max).toBeLessThanOrEqual(45);
    expect(fichaDe('MELATONINA')!.dosis.max).toBeLessThanOrEqual(3);
    expect(fichaDe('MELATONINA')!.dosis.min).toBeGreaterThanOrEqual(0.5);
    expect(fichaDe('CAFEINA')!.dosis).toMatchObject({ min: 3, max: 6, unidad: 'mg/kg' });
  });

  it('el hierro no se da sin medico y la cafeina no con sueno corto', () => {
    expect(fichaDe('HIERRO')!.dosisTexto).toMatch(/m[eé]dico/);
    expect(fichaDe('HIERRO')!.senales).toEqual(['lab_ferritina']);
    expect(fichaDe('CAFEINA')!.frenos).toContain('sueno_corto');
    expect(fichaDe('CAFEINA')!.momento).toMatch(/14:00/);
  });

  it('esSuplemento filtra lo que no es del catalogo', () => {
    expect(esSuplemento('MAGNESIO')).toBe(true);
    expect(esSuplemento('CLEMBUTEROL')).toBe(false);
  });
});
