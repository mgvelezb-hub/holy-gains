import type { FichaSuplemento, SugerenciaSuplemento, TomaDelDia } from "@/lib/api";

/**
 * Las cuentas y líneas de la pantalla de suplementos. Puras: lo que decide
 * qué se sugiere vive en el motor del servidor; aquí solo se dice en una
 * línea.
 */

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

/** El renglón de Ajustes → Nutrición: "3 tomas · 2 sugerencias". */
export function resumenRenglon(tomas: number, sugerencias: number): string {
  if (tomas === 0 && sugerencias === 0) return "Nada por ahora";
  const partes: string[] = [];
  if (tomas > 0) partes.push(plural(tomas, "toma", "tomas"));
  if (sugerencias > 0) partes.push(plural(sugerencias, "sugerencia", "sugerencias"));
  return partes.join(" · ");
}

/**
 * El motivo en corto, para la línea de la lista: la primera frase sin el
 * número que la sigue. "Duermes poco: 6 h en promedio." → "Duermes poco".
 */
export function motivoCorto(motivo: string): string {
  const corte = motivo.search(/[:.(]/);
  const base = (corte > 0 ? motivo.slice(0, corte) : motivo).trim();
  return base.length > 48 ? `${base.slice(0, 47).trimEnd()}…` : base;
}

/** "Magnesio (glicinato) · Duermes poco". */
export function lineaSugerencia(s: SugerenciaSuplemento): string {
  return `${s.nombre} · ${motivoCorto(s.motivo)}`;
}

/** "200 mg · con la cena". */
export function lineaToma(t: TomaDelDia): string {
  return `${t.dosis} · ${t.cuando}`;
}

/**
 * Lo que se suma al aviso de cada comida: `{ COMIDA: ["omega-3"] }`.
 *
 * Por defecto solo lo que aún no se marcó (avisar de lo ya tomado es ruido);
 * los avisos semanales piden todo, porque se programan para todos los días.
 */
export function extrasPorSlot(
  tomas: TomaDelDia[],
  opciones: { soloPendientes?: boolean } = {},
): Record<string, string[]> {
  const soloPendientes = opciones.soloPendientes ?? true;
  const porSlot: Record<string, string[]> = {};
  for (const toma of tomas) {
    if (!toma.slot || (soloPendientes && toma.hecho)) continue;
    (porSlot[toma.slot] ??= []).push(toma.corto);
  }
  return porSlot;
}

function normaliza(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** El buscador de "agregar": por nombre o nombre corto, sin lo que ya toma. */
export function buscaEnCatalogo(
  catalogo: FichaSuplemento[],
  texto: string,
  yaToma: readonly string[],
): FichaSuplemento[] {
  const q = normaliza(texto);
  if (q.length < 2) return [];
  return catalogo
    .filter((f) => !yaToma.includes(f.id))
    .filter((f) => normaliza(f.nombre).includes(q) || normaliza(f.corto).includes(q))
    .slice(0, 8);
}
