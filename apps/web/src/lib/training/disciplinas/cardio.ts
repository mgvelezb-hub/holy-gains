import {
  factorDeSemana,
  notaDeObjetivo,
  type BloqueSesion,
  type DetalleCardio,
  type NivelDisciplina,
  type ObjetivoAtleta,
  type SesionDisciplina,
} from "@/lib/training/disciplinas/tipos";
import type { EquipoCardio, NivelCardio, PreferenciasCardio, TipoCardio } from "@/lib/training/types";

/**
 * Cardio en máquina — el bloque de 15–20 min que va DESPUÉS de pesas (H2).
 *
 * `running.ts` prescribe correr como disciplina: rodajes, series, el tendón
 * que se adapta lento. Esto es otra cosa: la caminadora (o escalera, bici,
 * elíptica) al terminar la rutina, que es lo que Mau hace y con lo que siente
 * que ya entrenó. Por eso la carga se dice en el NIVEL de la máquina, que es
 * lo que la persona ve en la pantalla, y la duración la pone ella.
 *
 * **HIIT o continuo.** Para pérdida de grasa las dos rinden lo mismo: los
 * meta-análisis de Keating et al. 2017 (Obes Rev) y Wewege et al. 2017 (Obes
 * Rev) no encuentran diferencia en grasa perdida entre intervalos y trabajo
 * continuo moderado. La diferencia es el tiempo: el HIIT llega al mismo
 * resultado con ~40 % menos minutos, y por eso es el default de un bloque que
 * tiene que caber después del gym. El continuo (zona 2, "puedes hablar")
 * queda para quien prefiere no subir el pulso tras pierna pesada.
 *
 * **Progresión: +1 nivel cada semana, o +5 min si el día los tiene** — la
 * regla del coach de Becca. Tres semanas subiendo y la cuarta de descarga,
 * el mismo ciclo que el resto de disciplinas (`factorDeSemana`).
 */

export const DEFAULTS_CARDIO: Required<PreferenciasCardio> = {
  equipo: "CAMINADORA",
  tipo: "HIIT",
  nivel: "BASICO",
  minutos: 20,
};

/** Nivel de máquina de arranque por nivel de cardio: básico 6–8, medio 9–12, avanzado 13+. */
const NIVEL_BASE: Record<NivelCardio, number> = { BASICO: 6, MEDIO: 9, AVANZADO: 13 };

export const NOMBRE_EQUIPO: Record<EquipoCardio, string> = {
  CAMINADORA: "caminadora",
  ESCALERA: "escalera",
  BICI: "bici",
  ELIPTICA: "elíptica",
  LIBRE: "libre",
};

export const NOMBRE_TIPO: Record<TipoCardio, string> = { HIIT: "HIIT", CONTINUO: "continuo" };

/** Del nivel genérico de disciplina al de cardio, cuando no se declaró uno propio. */
const DESDE_NIVEL_DISCIPLINA: Record<NivelDisciplina, NivelCardio> = {
  PRINCIPIANTE: "BASICO",
  INTERMEDIO: "MEDIO",
  AVANZADO: "AVANZADO",
};

const NIVEL_DISCIPLINA: Record<NivelCardio, NivelDisciplina> = {
  BASICO: "PRINCIPIANTE",
  MEDIO: "INTERMEDIO",
  AVANZADO: "AVANZADO",
};

type IntervalosCardio = NonNullable<DetalleCardio["intervalos"]>;

export type CardioInput = {
  /** Minutos que tiene el bloque ese día (los que el gym le cedió). */
  minutes: number;
  isoWeek: number;
  objetivo: ObjetivoAtleta;
  prefs?: PreferenciasCardio;
  /** Respaldo si `prefs.nivel` no se declaró. */
  nivelDisciplina?: NivelDisciplina;
};

/** La etiqueta corta del bloque: "Cardio HIIT caminadora". */
export function etiquetaCardio(prefs?: PreferenciasCardio): string {
  const equipo = prefs?.equipo ?? DEFAULTS_CARDIO.equipo;
  const tipo = NOMBRE_TIPO[prefs?.tipo ?? DEFAULTS_CARDIO.tipo];
  return equipo === "LIBRE" ? `Cardio ${tipo}` : `Cardio ${tipo} ${NOMBRE_EQUIPO[equipo]}`;
}

export function prescribirCardio(input: CardioInput): SesionDisciplina {
  const { isoWeek, objetivo } = input;
  const equipo = input.prefs?.equipo ?? DEFAULTS_CARDIO.equipo;
  const tipo = input.prefs?.tipo ?? DEFAULTS_CARDIO.tipo;
  const nivel =
    input.prefs?.nivel ?? (input.nivelDisciplina ? DESDE_NIVEL_DISCIPLINA[input.nivelDisciplina] : DEFAULTS_CARDIO.nivel);
  const minutes = Math.max(10, Math.round(input.minutes));

  // Semanas 1-3 del ciclo suben un nivel cada una; la 4.ª descarga un nivel
  // por debajo del arranque.
  const { deload } = factorDeSemana(isoWeek);
  const paso = deload ? -1 : (isoWeek % 4) - 1;
  const base = NIVEL_BASE[nivel] + paso;

  const calentamiento = minutes >= 20 ? 3 : 2;
  const enfriamiento = 2;
  const principal = Math.max(4, minutes - calentamiento - enfriamiento);
  const suave = Math.max(1, base - 3);
  const libre = equipo === "LIBRE";
  const nivelTexto = (n: number) => (libre ? "" : ` · nivel ${n}`);

  let intervalos: IntervalosCardio | null = null;
  let bloquePrincipal: BloqueSesion;
  let nivelMaquina: number;

  if (tipo === "HIIT") {
    nivelMaquina = base + 2;
    intervalos = {
      rondas: Math.floor(principal / 2),
      fuerteSeg: 60,
      suaveSeg: 60,
      nivelFuerte: nivelMaquina,
      nivelSuave: suave,
    };
    bloquePrincipal = {
      title: "Intervalos",
      detail: `${intervalos.rondas} × 1 min fuerte${nivelTexto(nivelMaquina)} / 1 min suave${nivelTexto(suave)}`,
      carga: intervalos.rondas * 2,
      restSeconds: 60,
      note: "Fuerte es que te cueste hablar, no un esprint. Si la última ronda ya no sale, baja un nivel la semana que viene.",
    };
  } else {
    nivelMaquina = base + 1;
    bloquePrincipal = {
      title: "Zona 2",
      detail: `${principal} min continuos${nivelTexto(nivelMaquina)}`,
      carga: principal,
      restSeconds: null,
      note: "Ritmo de conversación: puedes decir una frase entera. Si no, baja un nivel.",
    };
  }

  const blocks: BloqueSesion[] = [
    {
      title: "Calentamiento",
      detail: `${calentamiento} min suave${nivelTexto(suave)}`,
      carga: calentamiento,
      restSeconds: null,
      note: "Subir el pulso poco a poco: llegas de pesas, no en frío, pero la máquina sí es nueva.",
    },
    bloquePrincipal,
    {
      title: "Enfriamiento",
      detail: `${enfriamiento} min muy suave${nivelTexto(Math.max(1, suave - 1))}`,
      carga: enfriamiento,
      restSeconds: null,
      note: "Nunca bajarse en seco después de intervalos.",
    },
  ];

  const notes = [
    "Progresión: +1 nivel cada semana. Si el día te da minutos de sobra, súmale 5 min en vez de subir nivel.",
    "HIIT y continuo queman grasa igual por sesión (Keating 2017, Wewege 2017); el HIIT lo logra en menos tiempo.",
  ];
  if (deload) notes.push("Semana de descarga: un nivel por debajo del arranque, mismos minutos.");
  const porObjetivo = notaDeObjetivo(objetivo);
  if (porObjetivo) notes.push(porObjetivo);

  return {
    discipline: "CARDIO",
    nivel: NIVEL_DISCIPLINA[nivel],
    focus: tipo === "HIIT" ? "HIIT" : "Zona 2",
    unidad: "min",
    cargaTotal: blocks.reduce((suma, bloque) => suma + (bloque.carga ?? 0), 0),
    minutes,
    blocks,
    deload,
    notes,
    cardio: {
      equipo,
      tipo,
      nivelMaquina,
      etiqueta: etiquetaCardio({ equipo, tipo }),
      intervalos,
      calentamientoSeg: calentamiento * 60,
      enfriamientoSeg: enfriamiento * 60,
    },
  };
}
