import { describe, expect, it } from 'vitest';
import { pautasDeSuplementos, resumenTomas, tomasDeHoy } from '../src/suplementos.js';
import type { MacroTargets, MealSlotId, Phase, Profile } from '../src/types.js';
import { CALIBRATION_PROFILE } from './helpers.js';

const MACROS = { kcal: 2200, proteinG: 180, carbG: 200, fatG: 70, fiberG: 30 } as unknown as MacroTargets;

function pautas(supplements: string[], over: Partial<Profile> = {}, phase: Phase = 'CUT') {
  return pautasDeSuplementos({
    profile: { ...CALIBRATION_PROFILE, ...over, supplements: supplements as Profile['supplements'] },
    macros: MACROS,
    phase,
  });
}

const DIA_MANANA: MealSlotId[] = ['PRE', 'POST', 'COMIDA', 'CENA'];

describe('pautasDeSuplementos — cada toma con dosis, momento, ancla y porque', () => {
  it('solo lo que toma, nada mas', () => {
    expect(pautas(['CREATINA']).map((p) => p.supplement)).toEqual(['CREATINA']);
    expect(pautas([])).toEqual([]);
  });

  it('cubre todo el catalogo, no solo los tres de antes', () => {
    const p = pautas(['MAGNESIO', 'VITAMINA_D3', 'MELATONINA']);
    expect(p.map((x) => x.supplement)).toEqual(['VITAMINA_D3', 'MAGNESIO', 'MELATONINA']);
    for (const x of p) {
      expect(x.dosis.length).toBeGreaterThan(1);
      expect(x.porque.length).toBeGreaterThan(10);
      expect(x.evidencia.length).toBeGreaterThan(10);
    }
  });

  it('anclas: creatina al desayuno, omega a la comida, magnesio y ashwagandha a la cena, melatonina a dormir', () => {
    const anclas = Object.fromEntries(
      pautas(['CREATINA', 'OMEGA3', 'MAGNESIO', 'ASHWAGANDHA', 'MELATONINA', 'CAFEINA', 'ELECTROLITOS']).map((p) => [p.supplement, p.ancla]),
    );
    expect(anclas).toEqual({
      CREATINA: 'DESAYUNO',
      OMEGA3: 'COMIDA',
      MAGNESIO: 'CENA',
      ASHWAGANDHA: 'CENA',
      MELATONINA: 'DORMIR',
      CAFEINA: 'PRE_ENTRENO',
      ELECTROLITOS: 'ENTRENO',
    });
  });

  it('la cafeina se dosifica por peso con tope de 400 mg', () => {
    expect(pautas(['CAFEINA'], { weightKg: 75 })[0]!.dosis).toMatch(/^230 mg/);
    expect(pautas(['CAFEINA'], { weightKg: 150 })[0]!.dosis).toMatch(/^400 mg/);
  });

  it('la proteina va despues de entrenar en corte; fuera de corte y con proteina baja, cuando no alcances', () => {
    expect(pautas(['WHEY'])[0]!.ancla).toBe('POST_ENTRENO');
    const suave = pautasDeSuplementos({
      profile: { ...CALIBRATION_PROFILE, supplements: ['WHEY'] },
      macros: { ...MACROS, proteinG: 120 },
      phase: 'MANTENIMIENTO',
    });
    expect(suave[0]!.ancla).toBe('LIBRE');
  });
});

describe('tomasDeHoy — la pauta amarrada a las comidas del dia', () => {
  const todas = pautas(['CREATINA', 'OMEGA3', 'MAGNESIO', 'MELATONINA', 'CAFEINA']);

  it('cada toma cae en su slot; las que no son comida no tienen slot', () => {
    const tomas = tomasDeHoy({ pautas: todas, slots: DIA_MANANA, logs: [] });
    const slot = Object.fromEntries(tomas.map((t) => [t.supplement, t.slot]));
    expect(slot).toEqual({ CREATINA: 'PRE', OMEGA3: 'COMIDA', MAGNESIO: 'CENA', MELATONINA: null, CAFEINA: 'PRE' });
  });

  it('van en el orden del dia y la melatonina al final', () => {
    const tomas = tomasDeHoy({ pautas: todas, slots: DIA_MANANA, logs: [] });
    expect(tomas[tomas.length - 1]!.supplement).toBe('MELATONINA');
    expect(tomas.findIndex((t) => t.supplement === 'OMEGA3')).toBeLessThan(
      tomas.findIndex((t) => t.supplement === 'MAGNESIO'),
    );
  });

  it('sin cena en el dia, lo de la cena cae en la ultima comida', () => {
    const tomas = tomasDeHoy({ pautas: pautas(['MAGNESIO']), slots: ['DESAYUNO', 'PRE', 'POST'], logs: [] });
    expect(tomas[0]!.slot).toBe('POST');
  });

  it('marca lo que ya se registro', () => {
    const tomas = tomasDeHoy({ pautas: todas, slots: DIA_MANANA, logs: [{ supplement: 'CREATINA', taken: true }] });
    expect(tomas.find((t) => t.supplement === 'CREATINA')!.hecho).toBe(true);
    expect(tomas.find((t) => t.supplement === 'OMEGA3')!.hecho).toBe(false);
  });

  it('la toma marcada trae a que hora se marco; la que no, nada', () => {
    const at = new Date('2026-09-29T20:05:00.000Z');
    const tomas = tomasDeHoy({
      pautas: todas,
      slots: DIA_MANANA,
      logs: [
        { supplement: 'CREATINA', taken: true, at },
        { supplement: 'OMEGA3', taken: false, at },
      ],
    });
    expect(tomas.find((t) => t.supplement === 'CREATINA')!.hechaA).toBe('2026-09-29T20:05:00.000Z');
    expect(tomas.find((t) => t.supplement === 'OMEGA3')!.hechaA).toBeUndefined();
  });
});

describe('resumenTomas — la linea de la tarjeta de Hoy', () => {
  const tomas = tomasDeHoy({
    pautas: pautas(['CREATINA', 'OMEGA3', 'MAGNESIO']),
    slots: DIA_MANANA,
    logs: [{ supplement: 'CREATINA', taken: true }],
  });

  it('"1 de 3 · siguiente: omega-3 con la comida"', () => {
    expect(resumenTomas(tomas).linea).toBe('1 de 3 · siguiente: omega-3 con la comida');
  });

  it('todo hecho y sin tomas', () => {
    const hechas = tomas.map((t) => ({ ...t, hecho: true }));
    expect(resumenTomas(hechas).linea).toBe('3 de 3 · listo por hoy');
    expect(resumenTomas([]).linea).toBe('Sin tomas');
  });
});
