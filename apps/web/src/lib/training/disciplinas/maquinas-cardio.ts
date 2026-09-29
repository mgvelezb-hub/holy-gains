import {
  CATALOGO_HIIT,
  ESFUERZOS_HIIT,
  NIVEL_MAXIMO_HIIT,
  type EsfuerzoHiit,
} from "@/lib/training/disciplinas/hiit-caminadora";
import type { EquipoCardio, NivelesBaseCardio } from "@/lib/training/types";

/**
 * Las máquinas de cardio y los controles que de verdad traen (P1) — puro.
 *
 * La caminadora se prescribe con los km/h que Mau probó. Las demás no tienen
 * tablas suyas, y un "nivel 6–8" genérico no significa lo mismo en dos
 * elípticas de marcas distintas. Por eso aquí cada esfuerzo de la escala de
 * la app (Fácil · Moderado · Moderado Alto · Fuerte · Máximo) es un **delta
 * sobre el nivel base personal**: la resistencia (o ritmo, o watts) con la
 * que esa persona va "moderado" en ESA máquina — puede hablar en frases
 * cortas, RPE ~5 en la escala 0–10 (prueba del habla, ACSM 2021, Guidelines
 * for Exercise Testing and Prescription 11.ª ed., cap. 5). La base se fija
 * una vez (calibración, `cardio.ts`) y los deltas la mueven.
 *
 * Los deltas son una **regla de la app**, no una cifra de un estudio: un paso
 * de la escala ≈ 2 niveles de resistencia (≈ 5 s/500 m en remo, ≈ 25 % de
 * potencia en bici de aire), que es lo que separa una categoría de RPE de la
 * siguiente en máquinas de 16–25 niveles. Lo que la hace segura es el ancla
 * personal: si "Fuerte" no se siente fuerte, se recalibra la base, no se
 * reescriben los deltas.
 */

/** Toda máquina de cardio (la caminadora incluida); `LIBRE` no es máquina. */
export type MaquinaCardio = Exclude<EquipoCardio, "LIBRE">;

export const MAQUINAS_CARDIO: readonly MaquinaCardio[] = [
  "CAMINADORA",
  "ELIPTICA",
  "REMO",
  "BICI",
  "BICI_AIRE",
  "ESCALERA",
  "SKI_ERG",
];

export const NOMBRE_MAQUINA: Record<EquipoCardio, string> = {
  CAMINADORA: "Caminadora",
  ELIPTICA: "Elíptica",
  REMO: "Remo",
  BICI: "Bici",
  BICI_AIRE: "Bici de aire",
  ESCALERA: "Escaladora",
  SKI_ERG: "SkiErg",
  LIBRE: "Libre",
};

/**
 * El nivel base de cada máquina — la intensidad con la que la persona va
 * "moderado". Resistencia (elíptica, bici, escaladora), ritmo /500 m (remo,
 * SkiErg) o watts (bici de aire). La caminadora no necesita: sus km/h salen
 * de los protocolos reales de Mau por nivel.
 */
export type NivelesBase = NivelesBaseCardio;
export type MaquinaConBase = keyof NivelesBase;
export type NivelBase = number | { ritmo500: string } | { watts: number };

export const MAQUINAS_CON_BASE: readonly MaquinaConBase[] = ["ELIPTICA", "BICI", "ESCALERA", "REMO", "SKI_ERG", "BICI_AIRE"];

export function necesitaBase(equipo: EquipoCardio): equipo is MaquinaConBase {
  return (MAQUINAS_CON_BASE as readonly string[]).includes(equipo);
}

/** Lo que se pone en la máquina en un tramo, ya calculado. */
export type ControlMaquina = {
  maquina: EquipoCardio;
  /** Nivel de resistencia (elíptica, bici, escaladora). */
  resistencia?: number;
  /** Cadencia objetivo `[mín, máx]`, en `unidadCadencia`. */
  cadencia?: [number, number];
  unidadCadencia?: "SPM" | "RPM";
  /** Ritmo objetivo por 500 m, en segundos (remo, SkiErg). */
  ritmo500Seg?: number;
  /** `true` = "este ritmo o más lento" (el Fácil del remo). */
  ritmoOMasLento?: boolean;
  /** Potencia `[mín, máx]` (bici de aire); en Máximo, el mínimo y "+". */
  watts?: [number, number];
  /** Solo caminadora: rango de velocidad. La inclinación no se usa (los protocolos de Mau van planos). */
  kmh?: [number, number];
  /** Solo bici: sentado o sprint de pie. */
  postura?: "sentado" | "de pie";
  /** "Resist. 10 · 140 SPM", "2:15/500 · 26 SPM", "Nivel 12 · 90 RPM", "10–12 km/h". */
  texto: string;
};

type ReglaPorEsfuerzo = {
  /** Resistencia: niveles sobre la base. Ritmo: segundos sobre la base. Watts: factor de la base. */
  delta: number;
  cadencia?: [number, number];
  postura?: "sentado" | "de pie";
};

export type ReglaMaquina = {
  control: "resistencia" | "ritmo500" | "watts";
  unidadCadencia?: "SPM" | "RPM";
  porEsfuerzo: Record<EsfuerzoHiit, ReglaPorEsfuerzo>;
  /** Por qué estos números: fuente o la regla que los deriva. */
  fuente: string;
};

/**
 * Deltas por máquina. Cada tabla dice de dónde salen sus rangos.
 */
export const REGLAS_ESFUERZO: Record<MaquinaConBase, ReglaMaquina> = {
  // Resistencia: la regla de la app (±2 niveles por categoría de RPE, +6 en
  // Máximo). Zancadas: 120–170 SPM es el rango que muestran las consolas de
  // elíptica comerciales; no hay tabla publicada por zonas, así que las
  // bandas de 10 SPM son regla de la app. El Máximo se pide a ≥ 150 para que
  // el pico venga de moverse más rápido y no solo de empujar más carga.
  ELIPTICA: {
    control: "resistencia",
    unidadCadencia: "SPM",
    porEsfuerzo: {
      Fácil: { delta: -2, cadencia: [120, 130] },
      Moderado: { delta: 0, cadencia: [130, 140] },
      "Moderado Alto": { delta: 2, cadencia: [140, 150] },
      Fuerte: { delta: 4, cadencia: [145, 155] },
      Máximo: { delta: 6, cadencia: [150, 170] },
    },
    fuente: "Regla de la app: ±2 niveles por categoría de RPE sobre la base anclada en la prueba del habla (ACSM 2021); SPM en bandas de 10 dentro del 120–170 de las consolas.",
  },
  // Frecuencia de palada por zona como la usan British Rowing y las guías
  // de Concept2 (UT2 18–20, UT1 20–24, AT 24–28, TR 28–32, AN 32+). El ritmo baja
  // ~5 s/500 m por categoría (regla de la app); Fácil es base +20 s "o más
  // lento": en zona 1 lo que importa es no pasar de ahí (Seiler 2010).
  REMO: {
    control: "ritmo500",
    unidadCadencia: "SPM",
    porEsfuerzo: {
      Fácil: { delta: 20, cadencia: [18, 20] },
      Moderado: { delta: 0, cadencia: [20, 24] },
      "Moderado Alto": { delta: -5, cadencia: [24, 26] },
      Fuerte: { delta: -10, cadencia: [26, 28] },
      Máximo: { delta: -15, cadencia: [30, 34] },
    },
    fuente: "Paladas por zona de las guías de Concept2 (UT2 18–20 … AN 32+); ritmo −5 s/500 m por categoría sobre la base (regla de la app).",
  },
  // Mismo volante que el remo: el ritmo se lee igual. La frecuencia de
  // brazada del SkiErg no tiene una tabla por zonas tan asentada, así que no
  // se prescribe: se deja libre y manda el ritmo.
  SKI_ERG: {
    control: "ritmo500",
    porEsfuerzo: {
      Fácil: { delta: 20 },
      Moderado: { delta: 0 },
      "Moderado Alto": { delta: -5 },
      Fuerte: { delta: -10 },
      Máximo: { delta: -15 },
    },
    fuente: "Mismo volante y mismo ritmo /500 m que el remo (Concept2); cadencia libre, sin tabla por zonas que la sustente.",
  },
  // Cadencias del programa Spinning® (Mad Dogg Athletics): llano 80–110
  // RPM, subida 60–80. Fuerte es "subida" (más carga, cadencia baja);
  // Máximo es el sprint de pie a 100+ RPM. Resistencia: regla de la app.
  BICI: {
    control: "resistencia",
    unidadCadencia: "RPM",
    porEsfuerzo: {
      Fácil: { delta: -2, cadencia: [80, 90], postura: "sentado" },
      Moderado: { delta: 0, cadencia: [80, 90], postura: "sentado" },
      "Moderado Alto": { delta: 2, cadencia: [85, 95], postura: "sentado" },
      Fuerte: { delta: 4, cadencia: [65, 80], postura: "sentado" },
      Máximo: { delta: 5, cadencia: [100, 110], postura: "de pie" },
    },
    fuente: "Cadencias del programa Spinning (llano 80–110, subida 60–80 RPM); resistencia ±2 niveles por categoría (regla de la app), Máximo +5 de pie.",
  },
  // Sin perilla: la resistencia del aire crece con la velocidad, así que la
  // intensidad es la potencia que se genera. Factores sobre la base (regla
  // de la app, ~25 % por categoría); el Máximo es un esprint y se pide "2×
  // o más": en un esprint corto la potencia pico supera con holgura la de un
  // esfuerzo sostenido (lo que mide la prueba de Wingate).
  BICI_AIRE: {
    control: "watts",
    porEsfuerzo: {
      Fácil: { delta: 0.7 },
      Moderado: { delta: 1 },
      "Moderado Alto": { delta: 1.25 },
      Fuerte: { delta: 1.5 },
      Máximo: { delta: 2 },
    },
    fuente: "Potencia como factor de la base (~25 % por categoría, regla de la app); Máximo = esprint a 2× o más.",
  },
  // En la escaladora el nivel ES el ritmo de escalones por minuto, así que
  // no se pide cadencia aparte. Regla de la app: ±2 niveles por categoría,
  // +5 en Máximo (la escaladora satura antes que la elíptica: no hay
  // impulso que ayude).
  ESCALERA: {
    control: "resistencia",
    porEsfuerzo: {
      Fácil: { delta: -2 },
      Moderado: { delta: 0 },
      "Moderado Alto": { delta: 2 },
      Fuerte: { delta: 3 },
      Máximo: { delta: 5 },
    },
    fuente: "El nivel de la escaladora es su ritmo de escalones; ±2 niveles por categoría de RPE (regla de la app), Máximo +5.",
  },
};

/**
 * El damper del remo: Concept2 recomienda 3–5 para casi todos. Más damper
 * se siente más pesado, pero es como remar con una marcha más dura: no es
 * más ejercicio y sí más carga en la espalda.
 */
export const DAMPER_REMO = {
  rango: [3, 5] as [number, number],
  nota: "Damper 3–5. Más damper no es más ejercicio: es una marcha más dura que carga la espalda (Concept2).",
};

/* ------------------------------------------------------------------------ */
/* Ritmo /500 m                                                              */
/* ------------------------------------------------------------------------ */

/** "2:20" → 140. `null` si no es un ritmo válido. */
export function segundosDeRitmo(texto: string): number | null {
  const partes = /^(\d{1,2}):([0-5]\d)$/.exec(texto.trim());
  if (!partes) return null;
  return Number(partes[1]) * 60 + Number(partes[2]);
}

/** 125 → "2:05". */
export function ritmoATexto(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------------ */
/* Caminadora                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Los km/h por esfuerzo de un nivel, sacados de los protocolos reales de Mau
 * de ese nivel (25' y 15'). Donde el nivel usa dos rangos de Moderado (nivel
 * 3+: 7–9 y 10–12), el bajo es Moderado y el alto Moderado Alto. Un
 * esfuerzo que el nivel no usa se rellena entre sus vecinos: del techo del
 * anterior al piso del siguiente (o a su techo, si se tocan).
 */
export function velocidadesCaminadora(nivel: number): Record<EsfuerzoHiit, [number, number]> {
  const n = Math.max(0, Math.min(NIVEL_MAXIMO_HIIT, Math.round(nivel)));
  const rangos = new Map<EsfuerzoHiit, Array<[number, number]>>();
  for (const protocolo of CATALOGO_HIIT.filter((p) => p.nivel === n)) {
    for (const tramo of protocolo.tramos) {
      const lista = rangos.get(tramo.esfuerzo) ?? [];
      if (!lista.some((r) => r[0] === tramo.kmh[0] && r[1] === tramo.kmh[1])) lista.push(tramo.kmh);
      rangos.set(tramo.esfuerzo, lista);
    }
  }
  const conocidos = new Map<EsfuerzoHiit, [number, number]>();
  for (const [esfuerzo, lista] of rangos) {
    const orden = [...lista].sort((a, b) => a[0] - b[0]);
    conocidos.set(esfuerzo, orden[0]!);
    if (esfuerzo === "Moderado" && orden.length > 1 && !rangos.has("Moderado Alto")) {
      conocidos.set("Moderado Alto", orden.at(-1)!);
    }
  }
  const salida = {} as Record<EsfuerzoHiit, [number, number]>;
  ESFUERZOS_HIIT.forEach((esfuerzo, i) => {
    const propio = conocidos.get(esfuerzo);
    if (propio) {
      salida[esfuerzo] = [...propio];
      return;
    }
    const antes = ESFUERZOS_HIIT.slice(0, i).reverse().map((e) => conocidos.get(e)).find(Boolean);
    const despues = ESFUERZOS_HIIT.slice(i + 1).map((e) => conocidos.get(e)).find(Boolean);
    const lo = antes?.[1] ?? despues![0];
    let hi = despues?.[0] ?? antes![1] + 1;
    if (hi <= lo) hi = despues?.[1] ?? lo + 1;
    salida[esfuerzo] = [lo, hi];
  });
  return salida;
}

/* ------------------------------------------------------------------------ */
/* El control de un tramo                                                    */
/* ------------------------------------------------------------------------ */

export type ContextoControl = {
  /** La base de esa máquina; sin ella solo se dicen cadencias. */
  base?: NivelBase;
  /** Solo caminadora: el nivel de HIIT (0–5) del que salen los km/h. */
  nivelHiit?: number;
};

function rango(par: readonly [number, number]): string {
  return par[0] === par[1] ? `${par[0]}` : `${par[0]}–${par[1]}`;
}

/** Qué se pone en `maquina` para ir a `esfuerzo`. */
export function controlDe(maquina: EquipoCardio, esfuerzo: EsfuerzoHiit, contexto: ContextoControl): ControlMaquina {
  if (maquina === "LIBRE") return { maquina, texto: "" };
  if (maquina === "CAMINADORA") {
    const kmh = velocidadesCaminadora(contexto.nivelHiit ?? 0)[esfuerzo];
    return { maquina, kmh, texto: `${rango(kmh)} km/h` };
  }

  const regla = REGLAS_ESFUERZO[maquina];
  const paso = regla.porEsfuerzo[esfuerzo];
  const control: ControlMaquina = { maquina, texto: "" };
  const partes: string[] = [];
  const base = contexto.base;

  if (regla.control === "resistencia" && typeof base === "number") {
    control.resistencia = Math.max(1, Math.round(base + paso.delta));
    partes.push(maquina === "ELIPTICA" ? `Resist. ${control.resistencia}` : `Nivel ${control.resistencia}`);
  }
  if (regla.control === "ritmo500" && base && typeof base === "object" && "ritmo500" in base) {
    const segundos = segundosDeRitmo(base.ritmo500);
    if (segundos !== null) {
      control.ritmo500Seg = segundos + paso.delta;
      if (esfuerzo === "Fácil") control.ritmoOMasLento = true;
      partes.push(`${ritmoATexto(control.ritmo500Seg)}${control.ritmoOMasLento ? "+" : ""}/500`);
    }
  }
  if (regla.control === "watts" && base && typeof base === "object" && "watts" in base) {
    const watts = Math.round(base.watts * paso.delta);
    control.watts = [watts, watts];
    partes.push(esfuerzo === "Máximo" ? `${watts}+ W` : `${watts} W`);
  }
  if (paso.cadencia) {
    control.cadencia = [...paso.cadencia];
    control.unidadCadencia = regla.unidadCadencia;
    partes.push(`${rango(paso.cadencia)} ${regla.unidadCadencia}`);
  }
  if (paso.postura) {
    control.postura = paso.postura;
    if (paso.postura === "de pie") partes.push("de pie");
  }
  control.texto = partes.join(" · ");
  return control;
}
