import { describe, expect, it } from "vitest";

import { paletteChampan, paletteDark, paletteLight, VELO_OPACIDAD, type Palette } from "@/lib/theme";

/**
 * Contraste de la paleta, medido con la fórmula de WCAG.
 *
 * Esto no reemplaza mirar la app: revisa los ROLES, que es donde los errores
 * se multiplican. Un color de texto que no contrasta con su fondo está mal en
 * las noventa pantallas que lo usan, y arreglarlo en el token las arregla
 * todas.
 *
 * Los mínimos son los de WCAG AA: 4.5 para texto normal y 3.0 para texto
 * grande (24 pt, o 18 pt en negrita). Se aplican los dos porque la app usa
 * los mismos roles en ambos tamaños.
 *
 * El script `scripts/audita-contraste.py` hace el recorrido inverso —revisa
 * cada estilo de cada pantalla— y es el que encuentra un rol usado donde no
 * debía. Esta prueba cuida que la paleta en sí no se degrade.
 */

function luminancia(hex: string): number {
  const canales = [1, 3, 5].map((inicio) => parseInt(hex.slice(inicio, inicio + 2), 16) / 255);
  const lineal = canales.map((valor) =>
    valor <= 0.03928 ? valor / 12.92 : ((valor + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * lineal[0]! + 0.7152 * lineal[1]! + 0.0722 * lineal[2]!;
}

function contraste(a: string, b: string): number {
  const [mayor, menor] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (mayor! + 0.05) / (menor! + 0.05);
}

const PALETAS: Array<[string, Palette]> = [
  ["Oscuro", paletteDark],
  ["Claro", paletteLight],
  ["Champán", paletteChampan],
];

/** Roles que cargan texto que hay que poder leer, sobre el fondo de pantalla. */
const TEXTO_SOBRE_FONDO = ["marfil", "paloRosa", "paloRosaLight", "champan", "error"] as const;

describe("contraste de la paleta", () => {
  for (const [nombre, paleta] of PALETAS) {
    it(`${nombre}: el texto se lee sobre el fondo de pantalla`, () => {
      for (const rol of TEXTO_SOBRE_FONDO) {
        const ratio = contraste(paleta[rol], paleta.obsidiana);
        expect(
          ratio,
          `${nombre} · ${rol} sobre el fondo da ${ratio.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${nombre}: el texto sobre acento se lee`, () => {
      // `pergamino` existe justamente para esto: el texto que va encima de
      // guinda o champán, que en los tres temas necesita ser el opuesto del
      // fondo de la pantalla y no el del texto normal.
      const sobreGuinda = contraste(paleta.pergamino, paleta.guinda);
      expect(sobreGuinda, `${nombre} · pergamino sobre guinda`).toBeGreaterThanOrEqual(4.5);
    });

    it(`${nombre}: el acento se distingue del fondo como elemento`, () => {
      // 3:1 es el mínimo de WCAG para elementos no textuales: bordes de campos,
      // barras de progreso, íconos.
      expect(contraste(paleta.champan, paleta.obsidiana), `${nombre} · champán`).toBeGreaterThanOrEqual(3);

      // Una superficie de acento se distingue por sí misma o por su borde. En
      // el tema oscuro el guinda de marca da 1.66 contra el fondo —el texto se
      // lee, la forma no— y lo que la vuelve visible como botón es el borde,
      // sin tocar el color de marca.
      const superficie = contraste(paleta.guinda, paleta.obsidiana);
      const borde = contraste(paleta.guindaLight, paleta.obsidiana);
      expect(
        Math.max(superficie, borde),
        `${nombre} · guinda ${superficie.toFixed(2)} / borde ${borde.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(3);
    });
  }
});

/**
 * N1 — el globito de `InfoTip` y la tabla del HIIT. El globito se pinta sobre
 * `superficie` (opaca: en oscuro la tarjeta era 5 % de blanco y las letras se
 * enciman con lo de atrás) y los colores de esfuerzo son texto sobre esa
 * misma superficie.
 */
describe("N1 · superficie opaca y colores de esfuerzo", () => {
  const ESFUERZOS = ["esfuerzoFacil", "esfuerzoModerado", "esfuerzoModeradoAlto", "esfuerzoFuerte", "esfuerzoMaximo"] as const;
  for (const [nombre, paleta] of PALETAS) {
    it(`${nombre}: la superficie es opaca y el texto del globito pasa AA`, () => {
      expect(paleta.superficie).toMatch(/^#[0-9A-F]{6}$/i);
      for (const rol of ["marfil", "champan"] as const) {
        expect(contraste(paleta[rol], paleta.superficie)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${nombre}: cada esfuerzo se lee sobre la superficie y se distingue del fondo`, () => {
      for (const rol of ESFUERZOS) {
        const ratio = contraste(paleta[rol], paleta.superficie);
        expect(ratio, `${nombre} · ${rol} da ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

/**
 * N2 — la hoja común (`components/Hoja.tsx`). Toda hoja y diálogo es
 * `superficie` (opaca) sobre un velo ≥ 0.75: con `cardBg` (5 % de blanco en
 * oscuro) y un velo de 0.6, la lista de atrás se leía a través de la hoja.
 * Cada rol de texto que carga una hoja tiene que pasar AA sobre ella.
 */
describe("N2 · hojas opacas", () => {
  const TEXTO_EN_HOJA = ["marfil", "paloRosa", "paloRosaLight", "champan", "error"] as const;

  it("el velo tapa lo de atrás (≥ 0.75)", () => {
    expect(VELO_OPACIDAD).toBeGreaterThanOrEqual(0.75);
    expect(VELO_OPACIDAD).toBeLessThanOrEqual(1);
  });

  for (const [nombre, paleta] of PALETAS) {
    it(`${nombre}: cada texto de una hoja pasa AA sobre la superficie`, () => {
      expect(paleta.superficie).toMatch(/^#[0-9A-F]{6}$/i);
      for (const rol of TEXTO_EN_HOJA) {
        const ratio = contraste(paleta[rol], paleta.superficie);
        expect(ratio, `${nombre} · ${rol} sobre la hoja da ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${nombre}: el botón principal de una hoja se lee`, () => {
      const ratio = contraste(paleta.pergamino, paleta.guinda);
      expect(ratio, `${nombre} · pergamino sobre guinda`).toBeGreaterThanOrEqual(4.5);
    });
  }
});
