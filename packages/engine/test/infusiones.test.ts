import { describe, expect, it } from 'vitest';
import { CATALOGO_SUPLEMENTOS, fichaDe, pautasDeSuplementos, tomasDeHoy } from '../src/suplementos.js';
import {
  fijaInfusiones,
  parseElecciones,
  sugerirSuplementos,
  type EntradaSugerencias,
} from '../src/sugerencias-suplementos.js';
import type { MacroTargets } from '../src/types.js';
import { CALIBRATION_PROFILE } from './helpers.js';

const HOY = '2026-09-28';

function dias(n: number, dia: (i: number) => Record<string, number>) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 8, 28 - (n - i)));
    return { date: d.toISOString().slice(0, 10), ...dia(i) };
  });
}

function entrada(over: Partial<EntradaSugerencias> = {}): EntradaSugerencias {
  return {
    hoy: HOY,
    fase: 'BASE',
    pesoKg: 80,
    diasFuerza: 3,
    cardioMinSemana: 0,
    entrenaTemprano: false,
    suplementos: [],
    checkIns: [{ date: '2026-09-21', energy: 4, hunger: 3 }],
    healthDays: [],
    labs: [],
    ...over,
  };
}

const infusiones = (r: ReturnType<typeof sugerirSuplementos>) =>
  r.sugerencias.filter((s) => s.categoria === 'INFUSION').map((s) => s.supplement);

describe('catalogo de infusiones', () => {
  const fichas = CATALOGO_SUPLEMENTOS.filter((f) => f.categoria === 'INFUSION');

  it('trae las doce que manda una nutriologa de rutina', () => {
    expect(fichas.map((f) => f.id).sort()).toEqual(
      ['CANELA', 'CURCUMA', 'DIENTE_DE_LEON', 'HIERBABUENA', 'JAMAICA', 'JENGIBRE', 'MANZANILLA', 'MATE', 'MENTA', 'TE_VERDE', 'TILA', 'VALERIANA'].sort(),
    );
  });

  it('cada una trae tazas, momento, preparacion en una linea, porque, evidencia con ano y frenos', () => {
    for (const f of fichas) {
      expect(f.dosis.unidad, f.id).toBe('taza');
      expect(f.preparacion, f.id).toMatch(/\d/);
      expect(f.preparacion!.length, f.id).toBeLessThan(110);
      expect(f.evidencia, f.id).toMatch(/(19|20)\d\d/);
      expect(f.frenos.length, f.id).toBeGreaterThan(0);
    }
  });

  it('los frenos pedidos: menta sin reflujo, valeriana con aviso y sin sedantes, cafeinados sin sueno corto, canela con tope', () => {
    expect(fichaDe('MENTA')!.frenos).toContain('reflujo');
    expect(fichaDe('VALERIANA')!.frenos).toContain('sedantes');
    expect(fichaDe('VALERIANA')!.aviso).toMatch(/sedantes/);
    expect(fichaDe('TE_VERDE')!.frenos).toContain('sueno_corto');
    expect(fichaDe('MATE')!.frenos).toContain('sueno_corto');
    expect(fichaDe('TE_VERDE')!.momento).toMatch(/14:00/);
    expect(fichaDe('CANELA')!.tope).toMatch(/1 cdita/);
    expect(fichaDe('DIENTE_DE_LEON')!.aviso).toMatch(/diur[eé]ticos/);
    expect(fichaDe('JAMAICA')!.aviso).toMatch(/presi[oó]n/);
    expect(fichaDe('JAMAICA')!.nombre).toMatch(/sin az[uú]car/);
  });
});

describe('reglas de infusiones', () => {
  it('distension o estrenimiento: menta o jengibre', () => {
    const r = sugerirSuplementos(entrada({ checkIns: [{ date: '2026-09-21', energy: 3, hunger: 3, symptoms: ['inflamacion_abdominal'] }] }));
    expect(['MENTA', 'JENGIBRE']).toContain(infusiones(r)[0]);
  });

  it('con reflujo la menta no sale y entra el jengibre', () => {
    const r = sugerirSuplementos(
      entrada({ condiciones: ['reflujo'], checkIns: [{ date: '2026-09-21', energy: 3, hunger: 3, satiety: 1 }] }),
    );
    expect(infusiones(r)).toEqual(['JENGIBRE']);
  });

  it('hambre alta en CUT: te verde a media manana (o jamaica)', () => {
    const r = sugerirSuplementos(entrada({ fase: 'CUT', checkIns: [{ date: '2026-09-21', energy: 3, hunger: 5 }] }));
    expect(['TE_VERDE', 'JAMAICA']).toContain(infusiones(r)[0]);
  });

  it('energia baja sin sueno corto: te verde matutino', () => {
    const r = sugerirSuplementos(entrada({ checkIns: [{ date: '2026-09-21', energy: 2, hunger: 3 }] }));
    const t = r.sugerencias.find((s) => s.supplement === 'TE_VERDE')!;
    expect(t.motivo).toMatch(/cafe[ií]na/);
  });

  it('sueno < 6.5 h: manzanilla o tila de noche, nunca te verde', () => {
    const r = sugerirSuplementos(
      entrada({ healthDays: dias(10, () => ({ sleepMin: 350 })), checkIns: [{ date: '2026-09-21', energy: 2, hunger: 3 }] }),
    );
    expect(['MANZANILLA', 'TILA']).toContain(infusiones(r)[0]);
    expect(infusiones(r)).not.toContain('TE_VERDE');
  });

  it('keto o ayuno: una infusion sin calorias para la ventana de ayuno', () => {
    const r = sugerirSuplementos(entrada({ dieta: 'ayuno' }));
    expect(infusiones(r)).toEqual(['JAMAICA']);
    expect(r.sugerencias[0]!.motivo).toMatch(/ayuno/);
  });

  it('la jamaica viaja con su aviso de la presion', () => {
    const r = sugerirSuplementos(entrada({ dieta: 'ayuno' }));
    expect(r.sugerencias[0]!.aviso).toMatch(/presi[oó]n/);
  });

  it('con infusiones apagadas no sale ninguna', () => {
    const r = sugerirSuplementos(entrada({ dieta: 'ayuno', quiereInfusiones: false }));
    expect(infusiones(r)).toEqual([]);
  });

  it('el tope de 3 se respeta con infusiones: dos suplementos y una infusion cuando hay de las dos', () => {
    const r = sugerirSuplementos(
      entrada({
        diasFuerza: 5,
        fase: 'CUT',
        checkIns: [{ date: '2026-09-21', energy: 2, hunger: 5, symptoms: ['estrenimiento'] }],
        healthDays: dias(10, () => ({ sleepMin: 340 })),
      }),
    );
    expect(r.sugerencias).toHaveLength(3);
    expect(infusiones(r)).toHaveLength(1);
  });

  it('el freno clinico tambien apaga las infusiones', () => {
    const r = sugerirSuplementos(entrada({ dieta: 'ayuno', condiciones: ['embarazo'] }));
    expect(r.sugerencias).toEqual([]);
  });
});

describe('preferencia de infusiones y tomas', () => {
  it('_infusiones:false se lee y se escribe sin tocar las elecciones', () => {
    expect(parseElecciones({}).quiereInfusiones).toBe(true);
    const json = fijaInfusiones({ MAGNESIO: 'acepto' }, false);
    expect(json).toEqual({ MAGNESIO: 'acepto', _infusiones: false });
    const leido = parseElecciones(json);
    expect(leido.quiereInfusiones).toBe(false);
    expect(leido.elecciones.MAGNESIO?.eleccion).toBe('acepto');
    expect(fijaInfusiones(json, true)).toEqual({ MAGNESIO: 'acepto' });
  });

  it('la manzanilla cae en la cena y la menta en la comida, con su preparacion', () => {
    const pautas = pautasDeSuplementos({
      profile: { ...CALIBRATION_PROFILE, supplements: ['MANZANILLA', 'MENTA'] },
      macros: { kcal: 2000, proteinG: 150, carbG: 200, fatG: 60, fiberG: 30 } as unknown as MacroTargets,
      phase: 'BASE',
    });
    expect(pautas.every((p) => p.preparacion)).toBe(true);
    const tomas = tomasDeHoy({ pautas, slots: ['DESAYUNO', 'COMIDA', 'CENA'], logs: [] });
    expect(Object.fromEntries(tomas.map((t) => [t.supplement, t.slot]))).toEqual({ MENTA: 'COMIDA', MANZANILLA: 'CENA' });
    expect(tomas.find((t) => t.supplement === 'MANZANILLA')!.corto).toBe('té de manzanilla');
  });
});
