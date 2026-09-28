import { describe, expect, it } from 'vitest';
import {
  parseElecciones,
  registraEleccion,
  sugerirSuplementos,
  type EntradaSugerencias,
} from '../src/sugerencias-suplementos.js';

const HOY = '2026-09-28';

/** Un dia de reloj de los ultimos 14. */
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

function ids(r: ReturnType<typeof sugerirSuplementos>) {
  return r.sugerencias.map((s) => s.supplement);
}

describe('sugerirSuplementos — sin senal no hay sugerencia', () => {
  it('perfil sin senales: cero sugerencias, ningun freno', () => {
    const r = sugerirSuplementos(entrada());
    expect(r.freno).toBeNull();
    expect(r.sugerencias).toEqual([]);
  });
});

describe('frenos clinicos', () => {
  it('embarazo bloquea todo con la linea del medico', () => {
    const r = sugerirSuplementos(entrada({ condiciones: ['embarazo'], diasFuerza: 5 }));
    expect(r.sugerencias).toEqual([]);
    expect(r.freno).toMatch(/consulta con tu m[eé]dico antes de agregar suplementos/i);
  });

  it('medicacion declarada bloquea todo', () => {
    const r = sugerirSuplementos(entrada({ condiciones: ['medicacion'], diasFuerza: 5 }));
    expect(r.sugerencias).toEqual([]);
    expect(r.freno).not.toBeNull();
  });

  it('un laboratorio fuera del rango del propio laboratorio bloquea todo', () => {
    const r = sugerirSuplementos(
      entrada({
        diasFuerza: 5,
        labs: [{ takenOn: '2026-08-01', key: 'creatinina', value: 1.8, refLow: 0.7, refHigh: 1.3 }],
      }),
    );
    expect(r.sugerencias).toEqual([]);
    expect(r.freno).not.toBeNull();
  });

  it('un laboratorio viejo (mas de un ano) ya no frena', () => {
    const r = sugerirSuplementos(
      entrada({
        diasFuerza: 5,
        labs: [{ takenOn: '2025-01-01', key: 'creatinina', value: 1.8, refLow: 0.7, refHigh: 1.3 }],
      }),
    );
    expect(r.freno).toBeNull();
    expect(ids(r)).toContain('CREATINA');
  });

  it('la condicion propia del suplemento lo quita a el, no a los demas', () => {
    const r = sugerirSuplementos(
      entrada({ condiciones: ['renal'], diasFuerza: 5, checkIns: [{ date: '2026-09-21', energy: 3, hunger: 3, symptoms: ['estrenimiento'] }] }),
    );
    expect(ids(r)).not.toContain('CREATINA');
    expect(ids(r)).toContain('FIBRA');
  });
});

describe('laboratorios', () => {
  it('vitamina D < 20 ng/mL: D3 a 4000 UI (el tope) con aviso medico', () => {
    const r = sugerirSuplementos(entrada({ labs: [{ takenOn: '2026-09-01', key: 'vitamina_d', value: 14 }] }));
    const d = r.sugerencias.find((s) => s.supplement === 'VITAMINA_D3')!;
    expect(d.dosis).toMatch(/4000 UI/);
    expect(d.aviso).toMatch(/m[eé]dico/);
    expect(d.motivo).toMatch(/14 ng\/mL/);
  });

  it('vitamina D entre 20 y 29: D3 a 2000 UI', () => {
    const r = sugerirSuplementos(entrada({ labs: [{ takenOn: '2026-09-01', key: 'vitamina_d_25oh', value: 24 }] }));
    expect(r.sugerencias.find((s) => s.supplement === 'VITAMINA_D3')!.dosis).toMatch(/2000 UI/);
  });

  it('vitamina D en 30 o mas: nada', () => {
    const r = sugerirSuplementos(entrada({ labs: [{ takenOn: '2026-09-01', key: 'vitamina_d', value: 34 }] }));
    expect(ids(r)).not.toContain('VITAMINA_D3');
  });

  it('ferritina baja: hierro SOLO con aviso medico y sin dosis propia', () => {
    const r = sugerirSuplementos(
      entrada({ labs: [{ takenOn: '2026-09-01', key: 'ferritina', value: 12, refLow: 20, refHigh: 300 }] }),
    );
    expect(r.freno).toBeNull();
    const h = r.sugerencias.find((s) => s.supplement === 'HIERRO')!;
    expect(h.aviso).toMatch(/consulta con tu m[eé]dico/i);
    expect(h.dosis).toMatch(/m[eé]dico/);
  });

  it('sin ferritina baja, el hierro no aparece ni con dieta vegetariana', () => {
    const r = sugerirSuplementos(entrada({ dieta: 'vegetariana' }));
    expect(ids(r)).not.toContain('HIERRO');
    expect(ids(r)).toEqual(expect.arrayContaining(['VITAMINA_B12', 'ZINC']));
  });

  it('B12 baja sugiere B12', () => {
    const r = sugerirSuplementos(entrada({ labs: [{ takenOn: '2026-09-01', key: 'vitamina_b12', value: 150 }] }));
    expect(ids(r)).toContain('VITAMINA_B12');
  });
});

describe('check-in', () => {
  it('calambres: magnesio; con cardio tambien electrolitos', () => {
    const r = sugerirSuplementos(
      entrada({ cardioMinSemana: 150, checkIns: [{ date: '2026-09-21', energy: 3, hunger: 3, symptoms: ['calambres'] }] }),
    );
    expect(ids(r)).toEqual(expect.arrayContaining(['MAGNESIO', 'ELECTROLITOS']));
  });

  it('estrenimiento: fibra, y el que cambiaria pide agua', () => {
    const r = sugerirSuplementos(entrada({ checkIns: [{ date: '2026-09-21', energy: 3, hunger: 3, symptoms: ['estrenimiento'] }] }));
    const f = r.sugerencias.find((s) => s.supplement === 'FIBRA')!;
    expect(f.cambiaria).toMatch(/agua/);
  });

  it('dolor de cabeza en keto: electrolitos al frente', () => {
    const r = sugerirSuplementos(
      entrada({ dieta: 'keto', checkIns: [{ date: '2026-09-21', energy: 3, hunger: 3, symptoms: ['dolor_cabeza'] }] }),
    );
    expect(r.sugerencias[0]!.supplement).toBe('ELECTROLITOS');
  });

  it('hambre alta en CUT: fibra; con proteina alta y sin polvo, tambien proteina', () => {
    const r = sugerirSuplementos(
      entrada({ fase: 'CUT', proteinaObjetivoG: 200, checkIns: [{ date: '2026-09-21', energy: 3, hunger: 5 }] }),
    );
    expect(ids(r)).toEqual(expect.arrayContaining(['FIBRA', 'WHEY']));
  });

  it('hambre alta fuera de CUT no dispara nada', () => {
    const r = sugerirSuplementos(entrada({ fase: 'BASE', checkIns: [{ date: '2026-09-21', energy: 3, hunger: 5 }] }));
    expect(r.sugerencias).toEqual([]);
  });

  it('energia baja sin laboratorios deja la nota de pedir ferritina y vitamina D', () => {
    const r = sugerirSuplementos(entrada({ checkIns: [{ date: '2026-09-21', energy: 2, hunger: 3 }] }));
    expect(r.notas.join(' ')).toMatch(/ferritina/);
  });
});

describe('reloj', () => {
  it('sueno medio < 6.5 h: magnesio y melatonina baja, con nota de higiene de sueno', () => {
    const r = sugerirSuplementos(entrada({ healthDays: dias(10, () => ({ sleepMin: 360 })) }));
    expect(ids(r)).toEqual(expect.arrayContaining(['MAGNESIO', 'MELATONINA']));
    expect(r.sugerencias.find((s) => s.supplement === 'MELATONINA')!.dosis).toMatch(/0\.5 mg/);
    expect(r.notas.join(' ')).toMatch(/sue[nñ]o/i);
  });

  it('con menos de 5 noches no se concluye nada del reloj', () => {
    const r = sugerirSuplementos(entrada({ healthDays: dias(3, () => ({ sleepMin: 300 })) }));
    expect(ids(r)).not.toContain('MELATONINA');
  });

  it('HRV cae y FC en reposo sube: ashwagandha como opcion y nota de descarga', () => {
    const r = sugerirSuplementos(
      entrada({
        healthDays: dias(14, (i) => (i < 7 ? { hrvMs: 60, restingHr: 55 } : { hrvMs: 48, restingHr: 60 })),
      }),
    );
    expect(ids(r)).toContain('ASHWAGANDHA');
    expect(r.notas.join(' ')).toMatch(/descarga/);
  });

  it('pasos altos: electrolitos', () => {
    const r = sugerirSuplementos(entrada({ healthDays: dias(10, () => ({ steps: 18000 })) }));
    expect(ids(r)).toContain('ELECTROLITOS');
  });
});

describe('entrenamiento', () => {
  it('4+ dias de fuerza: creatina', () => {
    expect(ids(sugerirSuplementos(entrada({ diasFuerza: 4 })))).toContain('CREATINA');
    expect(ids(sugerirSuplementos(entrada({ diasFuerza: 3 })))).not.toContain('CREATINA');
  });

  it('entreno matutino con buen sueno: cafeina a 3 mg/kg con tope 400 mg', () => {
    const r = sugerirSuplementos(entrada({ entrenaTemprano: true, pesoKg: 150 }));
    const c = r.sugerencias.find((s) => s.supplement === 'CAFEINA')!;
    expect(c.dosis).toMatch(/400 mg/);
    expect(c.momento).toMatch(/14:00/);
    const c80 = sugerirSuplementos(entrada({ entrenaTemprano: true, pesoKg: 80 })).sugerencias.find(
      (s) => s.supplement === 'CAFEINA',
    )!;
    expect(c80.dosis).toMatch(/240 mg/);
  });

  it('entreno matutino con sueno corto: sin cafeina', () => {
    const r = sugerirSuplementos(entrada({ entrenaTemprano: true, healthDays: dias(10, () => ({ sleepMin: 350 })) }));
    expect(ids(r)).not.toContain('CAFEINA');
  });

  it('cardio de mas de 45 min: electrolitos', () => {
    expect(ids(sugerirSuplementos(entrada({ sesionCardioMaxMin: 60 })))).toContain('ELECTROLITOS');
  });
});

describe('limite, orden y elecciones', () => {
  const muchas = (): Partial<EntradaSugerencias> => ({
    diasFuerza: 5,
    dieta: 'vegetariana',
    fase: 'CUT',
    checkIns: [{ date: '2026-09-21', energy: 2, hunger: 5, symptoms: ['calambres', 'estrenimiento'] }],
    healthDays: dias(10, () => ({ sleepMin: 340 })),
    labs: [{ takenOn: '2026-09-01', key: 'vitamina_d', value: 18 }],
  });

  it('nunca mas de 3, ordenadas por prioridad', () => {
    const r = sugerirSuplementos(entrada(muchas()));
    expect(r.sugerencias).toHaveLength(3);
    const p = r.sugerencias.map((s) => s.prioridad);
    expect([...p].sort((a, b) => b - a)).toEqual(p);
    expect(r.sugerencias[0]!.supplement).toBe('VITAMINA_D3');
  });

  it('lo que ya toma no se sugiere', () => {
    const r = sugerirSuplementos(entrada({ diasFuerza: 5, suplementos: ['CREATINA'] }));
    expect(ids(r)).not.toContain('CREATINA');
  });

  it('no_quiero hace menos de 90 dias: fuera; hace mas: vuelve', () => {
    const reciente = sugerirSuplementos(
      entrada({ diasFuerza: 5, elecciones: { CREATINA: { eleccion: 'no_quiero', fecha: '2026-08-01' } } }),
    );
    expect(ids(reciente)).not.toContain('CREATINA');
    const vieja = sugerirSuplementos(
      entrada({ diasFuerza: 5, elecciones: { CREATINA: { eleccion: 'no_quiero', fecha: '2026-05-01' } } }),
    );
    expect(ids(vieja)).toContain('CREATINA');
  });

  it('ya_lo_tomo cuenta como toma aunque no este en la lista', () => {
    const r = sugerirSuplementos(
      entrada({ diasFuerza: 5, elecciones: { CREATINA: { eleccion: 'ya_lo_tomo', fecha: HOY } } }),
    );
    expect(ids(r)).not.toContain('CREATINA');
  });

  it('cada sugerencia trae motivo, evidencia, dosis, momento y que cambiaria', () => {
    for (const s of sugerirSuplementos(entrada(muchas())).sugerencias) {
      expect(s.motivo.length, s.supplement).toBeGreaterThan(10);
      expect(s.evidencia.length, s.supplement).toBeGreaterThan(10);
      expect(s.dosis.length, s.supplement).toBeGreaterThan(1);
      expect(s.momento.length, s.supplement).toBeGreaterThan(3);
      expect(s.cambiaria.length, s.supplement).toBeGreaterThan(10);
    }
  });

  it('es determinista', () => {
    expect(sugerirSuplementos(entrada(muchas()))).toEqual(sugerirSuplementos(entrada(muchas())));
  });
});

describe('elecciones guardadas', () => {
  it('lee el formato viejo (string) y el nuevo (con fecha)', () => {
    const e = parseElecciones({ MAGNESIO: 'no_quiero', CREATINA: { eleccion: 'acepto', fecha: HOY }, BASURA: 'x' });
    expect(e.elecciones.MAGNESIO).toEqual({ eleccion: 'no_quiero', fecha: null });
    expect(e.elecciones.CREATINA).toEqual({ eleccion: 'acepto', fecha: HOY });
    expect(Object.keys(e.elecciones)).not.toContain('BASURA');
  });

  it('registraEleccion guarda con fecha sin tocar lo demas', () => {
    const json = registraEleccion({ CREATINA: 'acepto', _otra: 1 }, 'MAGNESIO', 'no_quiero', HOY);
    expect(json).toEqual({ CREATINA: 'acepto', _otra: 1, MAGNESIO: { eleccion: 'no_quiero', fecha: HOY } });
  });

  it('parseElecciones tolera basura', () => {
    expect(parseElecciones(null).elecciones).toEqual({});
    expect(parseElecciones([1, 2]).elecciones).toEqual({});
  });
});
