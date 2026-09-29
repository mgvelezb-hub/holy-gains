import { BOX } from "@/lib/training/disciplinas/box";
import { prescribirCardio } from "@/lib/training/disciplinas/cardio";
import { CROSSFIT } from "@/lib/training/disciplinas/crossfit";
import { FUNCIONAL } from "@/lib/training/disciplinas/funcional";
import { GOLF } from "@/lib/training/disciplinas/golf";
import { NATACION } from "@/lib/training/disciplinas/natacion";
import { RUNNING } from "@/lib/training/disciplinas/running";
import { SQUASH } from "@/lib/training/disciplinas/squash";
import type {
  NivelDisciplina,
  ObjetivoAtleta,
  Prescriptor,
  SesionDisciplina,
} from "@/lib/training/disciplinas/tipos";
import type { Discipline, PreferenciasCardio } from "@/lib/training/types";

/**
 * El registro de disciplinas que la app sabe prescribir.
 *
 * Cada una entró con su propia investigación —niveles, estructura de sesión,
 * progresión y sus riesgos—, que era justo la razón de hacerlas una por una en
 * vez de las siete de golpe. Lo que comparten es el molde (`tipos.ts`), y por
 * eso la app las pinta con la misma pantalla.
 *
 * `PESAS` no está aquí: tiene su propio generador con split, esquemas y
 * progresión de carga, que es de otro tamaño. `OTRO` tampoco — es la cubeta
 * para lo que se registra pero no se planea.
 */
const PRESCRIPTORES: Partial<Record<Discipline, Prescriptor>> = {
  NATACION,
  SQUASH,
  BOX,
  FUNCIONAL,
  CARDIO: RUNNING,
  CROSSFIT,
  GOLF,
};

/** Las disciplinas con prescripción, para la app y para el editor de ajustes. */
export const DISCIPLINAS_PRESCRIBIBLES = Object.values(PRESCRIPTORES) as Prescriptor[];

export function prescriptorDe(discipline: Discipline): Prescriptor | null {
  return PRESCRIPTORES[discipline] ?? null;
}

/**
 * La sesión de una disciplina, o `null` si esa disciplina todavía no se
 * prescribe.
 *
 * Devolver `null` en vez de inventar una sesión genérica es deliberado: la
 * tarjeta dice "el día está reservado y lo que entrenes se registra", que es
 * verdad, en lugar de dar un circuito que nadie diseñó para esa disciplina.
 */
export function prescribirSesion(input: {
  discipline: Discipline;
  nivel: NivelDisciplina;
  isoWeek: number;
  ordinal: number;
  minutes: number;
  objetivo: ObjetivoAtleta;
  /**
   * Solo CARDIO: con preferencias (aunque vengan vacías) se prescribe el
   * cardio en máquina de `cardio.ts` en vez de correr (`running.ts`). Es lo
   * que pasa con el cardio "después de pesas" (H2).
   */
  cardio?: PreferenciasCardio;
  /** Solo CARDIO: semanas anteriores planeadas vs registradas (nivel del HIIT de caminadora, N1). */
  historialCardio?: ReadonlyArray<{ isoWeek: number; planeadas: number; registradas: number }>;
}): SesionDisciplina | null {
  if (input.discipline === "CARDIO" && input.cardio) {
    return prescribirCardio({
      minutes: input.minutes,
      isoWeek: input.isoWeek,
      objetivo: input.objetivo,
      prefs: input.cardio,
      nivelDisciplina: input.nivel,
      ordinal: input.ordinal,
      ...(input.historialCardio ? { historial: input.historialCardio } : {}),
    });
  }

  const prescriptor = prescriptorDe(input.discipline);
  if (!prescriptor) return null;

  return prescriptor.sesion({
    nivel: input.nivel,
    isoWeek: input.isoWeek,
    ordinal: input.ordinal,
    minutes: input.minutes,
    objetivo: input.objetivo,
  });
}

export type { NivelDisciplina, ObjetivoAtleta, SesionDisciplina };
export { AVISO_DISCIPLINA, NIVELES } from "@/lib/training/disciplinas/tipos";
export type { BloqueSesion, DetalleCardio } from "@/lib/training/disciplinas/tipos";
