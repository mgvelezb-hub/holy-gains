import {
  CYCLE_ESTIMATE_NOTE,
  CYCLE_PHASE_LABELS,
  type CycleEstimate,
  type CyclePhaseName,
} from "@/lib/cycle";

/**
 * Qué cambia en el día según la fase ESTIMADA del ciclo — lógica pura.
 *
 * Moderado y con aviso (decisión de Mau, 5-oct): nada se impone. En los días
 * del periodo la sesión ofrece una versión ligera si hay molestias; en la
 * lútea hay un margen de calorías, sobre todo de carbohidrato, y más agua;
 * en la folicular y la ovulación no cambia nada. La cinta de esas semanas ya
 * no cuenta como estancamiento (regla R1 del motor).
 *
 * Es aritmética de calendario sobre las fechas que ella escribe: nunca
 * diagnóstico ni anticoncepción. Pendiente de validar con Gisa, Mariana e Ian.
 */

/** Margen de la fase lútea: lo que la evidencia sostiene sin inventar (≈ 100–150 kcal). */
export const KCAL_EXTRA_LUTEA = 120;

/** La versión ligera recorta la sesión a este tanto de su duración. */
export const FRACCION_SESION_LIGERA = 0.7;

export interface AjusteDelCiclo {
  fase: CyclePhaseName;
  /** "Lútea", "Menstruación"… */
  etiqueta: string;
  /** Día del ciclo, 1-based. */
  dia: number;
  /** La fecha registrada ya tiene dos ciclos encima: pedirle que la actualice. */
  desactualizado: boolean;
  /** "Día 3 · Menstruación (estimado)". */
  linea: string;
  entrenamiento: {
    texto: string;
    /** En el periodo la sesión ofrece la versión ligera (opcional, nunca automática). */
    ofreceLigera: boolean;
  };
  /** `null` cuando la fase no mueve nada de la comida. */
  nutricion: { kcalExtra: number; corto: string; texto: string } | null;
  /** Siempre: esto es una estimación, no una medición. */
  nota: string;
}

const ENTRENAMIENTO: Record<CyclePhaseName, { texto: string; ofreceLigera: boolean }> = {
  MENSTRUACION: {
    texto:
      "Días de periodo (estimado): si tienes molestias, usa la versión ligera o baja 10–20 % el peso. Si te sientes bien, entrena normal.",
    ofreceLigera: true,
  },
  FOLICULAR: {
    texto: "Fase folicular (estimada): buena ventana para progresar en peso o repeticiones.",
    ofreceLigera: false,
  },
  OVULACION: {
    texto: "Ovulación (estimada): buena energía para entrenar; cuida la técnica en los saltos y cambios de dirección.",
    ofreceLigera: false,
  },
  LUTEA: {
    texto:
      "Fase lútea (estimada): el mismo peso puede sentirse más pesado y eso es normal. Mantener está bien; no fuerces récords.",
    ofreceLigera: false,
  },
};

function nutricionDe(fase: CyclePhaseName): AjusteDelCiclo["nutricion"] {
  if (fase === "LUTEA") {
    return {
      kcalExtra: KCAL_EXTRA_LUTEA,
      corto: `+${KCAL_EXTRA_LUTEA} kcal de margen · más agua`,
      texto:
        `Fase lútea (estimada): el cuerpo gasta un poco más y suele haber más hambre. ` +
        `Tienes un margen de ~${KCAL_EXTRA_LUTEA} kcal, mejor de carbohidrato (una fruta o una tortilla extra), ` +
        `y toma un vaso de agua más. La cinta de estas semanas no cuenta como estancamiento.`,
    };
  }
  if (fase === "MENSTRUACION") {
    return {
      kcalExtra: 0,
      corto: "Hierro y agua",
      texto:
        "Días de periodo (estimado): prioriza alimentos con hierro (frijol, lenteja, espinaca, carne roja magra) " +
        "con algo de vitamina C, y toma suficiente agua. El menú no cambia.",
    };
  }
  return null;
}

/** El ajuste del día a partir de la estimación; `null` si no hay estimación. */
export function ajusteDelCiclo(estimacion: CycleEstimate | null): AjusteDelCiclo | null {
  if (!estimacion) return null;
  const etiqueta = CYCLE_PHASE_LABELS[estimacion.phase];
  return {
    fase: estimacion.phase,
    etiqueta,
    dia: estimacion.dayOfCycle,
    desactualizado: estimacion.stale,
    linea: `Día ${estimacion.dayOfCycle} · ${etiqueta} (estimado)`,
    entrenamiento: ENTRENAMIENTO[estimacion.phase],
    nutricion: nutricionDe(estimacion.phase),
    nota: CYCLE_ESTIMATE_NOTE,
  };
}

/** Los minutos de la versión ligera de una sesión: 70 %, nunca menos de 15. */
export function minutosSesionLigera(minutosSesion: number): number {
  return Math.max(15, Math.round((minutosSesion * FRACCION_SESION_LIGERA) / 5) * 5);
}
