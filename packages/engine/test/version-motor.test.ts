import { describe, expect, it } from 'vitest';
import { MENU_ENGINE_VERSION } from '../src/index.js';

describe('MENU_ENGINE_VERSION', () => {
  it('es un entero y ya cuenta licuados, SMAE y platillos (versión 3)', () => {
    expect(Number.isInteger(MENU_ENGINE_VERSION)).toBe(true);
    expect(MENU_ENGINE_VERSION).toBe(3);
  });
});
