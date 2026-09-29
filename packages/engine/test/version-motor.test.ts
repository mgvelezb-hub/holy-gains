import { describe, expect, it } from 'vitest';
import { MENU_ENGINE_VERSION } from '../src/index.js';

describe('MENU_ENGINE_VERSION', () => {
  it('es un entero y ya cuenta las 15 reglas culinarias (versión 2)', () => {
    expect(Number.isInteger(MENU_ENGINE_VERSION)).toBe(true);
    expect(MENU_ENGINE_VERSION).toBe(2);
  });
});
