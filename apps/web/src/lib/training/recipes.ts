import type { DayKind, MuscleGroup, VolumeBias } from "@/lib/training/types";

/**
 * Recetas por tipo de día: qué huecos se llenan y en qué orden.
 *
 * El orden es el de la sesión (alternando empuje/jalón en pecho+espalda,
 * bíceps/tríceps en brazo, como en la biblioteca de rutinas). La `priority`
 * decide qué se cae primero cuando hay poco tiempo: 1 es intocable (los
 * básicos), 4 es lo primero que se recorta.
 */
export type Slot = {
  groups: MuscleGroup[];
  roles: string[];
  priority: 1 | 2 | 3 | 4;
};

const RECIPES: Record<DayKind, Slot[]> = {
  PIERNA_CUADRICEPS: [
    { groups: ["PIERNA"], roles: ["cuadriceps_aislado"], priority: 1 },
    { groups: ["PIERNA"], roles: ["cuadriceps_compuesto"], priority: 1 },
    { groups: ["PIERNA"], roles: ["gluteo"], priority: 1 },
    { groups: ["PIERNA"], roles: ["cuadriceps_compuesto"], priority: 2 },
    { groups: ["PIERNA"], roles: ["unilateral"], priority: 2 },
    { groups: ["PIERNA"], roles: ["femoral"], priority: 3 },
    { groups: ["PIERNA"], roles: ["abductor"], priority: 4 },
    { groups: ["PIERNA"], roles: ["pantorrilla"], priority: 4 },
  ],
  PIERNA_FEMORAL: [
    { groups: ["PIERNA"], roles: ["femoral"], priority: 1 },
    { groups: ["PIERNA"], roles: ["cadena_posterior"], priority: 1 },
    { groups: ["PIERNA"], roles: ["gluteo"], priority: 1 },
    { groups: ["PIERNA"], roles: ["aductor_gluteo", "aductor"], priority: 2 },
    { groups: ["PIERNA"], roles: ["gluteo"], priority: 2 },
    { groups: ["PIERNA"], roles: ["cuadriceps_compuesto"], priority: 3 },
    { groups: ["PIERNA"], roles: ["abductor"], priority: 4 },
    { groups: ["PIERNA"], roles: ["pantorrilla"], priority: 4 },
  ],
  PIERNA_GLUTEO: [
    { groups: ["PIERNA"], roles: ["gluteo"], priority: 1 },
    { groups: ["PIERNA"], roles: ["aductor_gluteo", "aductor"], priority: 1 },
    { groups: ["PIERNA"], roles: ["cadena_posterior"], priority: 1 },
    { groups: ["PIERNA"], roles: ["gluteo"], priority: 2 },
    { groups: ["PIERNA"], roles: ["unilateral"], priority: 2 },
    { groups: ["PIERNA"], roles: ["femoral"], priority: 3 },
    { groups: ["PIERNA"], roles: ["abductor"], priority: 3 },
    { groups: ["PIERNA"], roles: ["pantorrilla"], priority: 4 },
  ],
  HOMBRO: [
    { groups: ["HOMBRO"], roles: ["deltoide_lateral"], priority: 1 },
    { groups: ["HOMBRO"], roles: ["empuje_vertical"], priority: 1 },
    { groups: ["HOMBRO"], roles: ["deltoide_posterior"], priority: 1 },
    { groups: ["HOMBRO"], roles: ["empuje_vertical"], priority: 2 },
    { groups: ["HOMBRO"], roles: ["deltoide_frontal"], priority: 2 },
    { groups: ["HOMBRO"], roles: ["trapecio"], priority: 3 },
    { groups: ["HOMBRO"], roles: ["complejo"], priority: 4 },
    { groups: ["ABDOMEN"], roles: ["flexion_tronco", "antiextension", "flexion_cadera"], priority: 4 },
  ],
  PECHO_ESPALDA: [
    { groups: ["PECHO"], roles: ["calentamiento_empuje", "empuje_horizontal"], priority: 1 },
    { groups: ["ESPALDA"], roles: ["jalon_vertical"], priority: 1 },
    { groups: ["PECHO"], roles: ["empuje_horizontal", "empuje_inclinado"], priority: 1 },
    { groups: ["ESPALDA"], roles: ["jalon_horizontal"], priority: 1 },
    { groups: ["PECHO"], roles: ["apertura"], priority: 2 },
    { groups: ["ESPALDA"], roles: ["jalon_vertical", "dorsal_aislado"], priority: 2 },
    { groups: ["PECHO"], roles: ["apertura", "empuje_vertical"], priority: 3 },
    { groups: ["ESPALDA"], roles: ["jalon_horizontal", "dorsal_aislado"], priority: 4 },
  ],
  BRAZO: [
    { groups: ["BICEP"], roles: ["bicep_aislado"], priority: 1 },
    { groups: ["TRICEP"], roles: ["extension_polea"], priority: 1 },
    { groups: ["BICEP"], roles: ["bicep_compuesto"], priority: 1 },
    { groups: ["TRICEP"], roles: ["extension_libre"], priority: 1 },
    { groups: ["BICEP"], roles: ["braquial"], priority: 2 },
    { groups: ["TRICEP"], roles: ["extension_maquina", "empuje_cerrado"], priority: 2 },
    { groups: ["BICEP"], roles: ["bicep_aislado", "bicep_compuesto"], priority: 3 },
    { groups: ["TRICEP"], roles: ["extension_polea", "empuje_cerrado"], priority: 3 },
  ],
  HOMBRO_BRAZO: [
    { groups: ["HOMBRO"], roles: ["deltoide_lateral"], priority: 1 },
    { groups: ["HOMBRO"], roles: ["empuje_vertical"], priority: 1 },
    { groups: ["BICEP"], roles: ["bicep_compuesto", "bicep_aislado"], priority: 1 },
    { groups: ["TRICEP"], roles: ["extension_polea"], priority: 1 },
    { groups: ["HOMBRO"], roles: ["deltoide_posterior"], priority: 2 },
    { groups: ["BICEP"], roles: ["braquial"], priority: 2 },
    { groups: ["TRICEP"], roles: ["extension_libre", "empuje_cerrado"], priority: 3 },
    { groups: ["HOMBRO"], roles: ["trapecio"], priority: 4 },
  ],
  /**
   * Día de empuje: pecho manda y el tríceps va detrás, que es el orden en que
   * se fatigan. Los splits empuje/jalón (`PPL_X2`, `INFERIOR_SUPERIOR_3_3`)
   * son los únicos que lo usan; el split del coach sigue partiendo por zona.
   */
  PECHO_TRICEP: [
    { groups: ["PECHO"], roles: ["calentamiento_empuje", "empuje_horizontal"], priority: 1 },
    { groups: ["PECHO"], roles: ["empuje_inclinado", "empuje_horizontal"], priority: 1 },
    { groups: ["TRICEP"], roles: ["extension_polea"], priority: 1 },
    { groups: ["PECHO"], roles: ["apertura"], priority: 2 },
    { groups: ["TRICEP"], roles: ["extension_libre"], priority: 2 },
    { groups: ["HOMBRO"], roles: ["deltoide_lateral"], priority: 3 },
    { groups: ["TRICEP"], roles: ["extension_maquina", "empuje_cerrado"], priority: 3 },
    { groups: ["PECHO"], roles: ["apertura", "empuje_vertical"], priority: 4 },
  ],
  /** Día de jalón: espalda primero, bíceps después. Mismo criterio de fatiga. */
  ESPALDA_BICEP: [
    { groups: ["ESPALDA"], roles: ["jalon_vertical"], priority: 1 },
    { groups: ["ESPALDA"], roles: ["jalon_horizontal"], priority: 1 },
    { groups: ["BICEP"], roles: ["bicep_compuesto", "bicep_aislado"], priority: 1 },
    { groups: ["ESPALDA"], roles: ["jalon_vertical", "dorsal_aislado"], priority: 2 },
    { groups: ["BICEP"], roles: ["bicep_aislado"], priority: 2 },
    { groups: ["ESPALDA"], roles: ["jalon_horizontal", "dorsal_aislado"], priority: 3 },
    { groups: ["BICEP"], roles: ["braquial"], priority: 3 },
    { groups: ["HOMBRO"], roles: ["deltoide_posterior", "trapecio"], priority: 4 },
  ],
  TORSO: [
    { groups: ["PECHO"], roles: ["empuje_horizontal", "calentamiento_empuje"], priority: 1 },
    { groups: ["ESPALDA"], roles: ["jalon_vertical"], priority: 1 },
    { groups: ["HOMBRO"], roles: ["empuje_vertical"], priority: 1 },
    { groups: ["ESPALDA"], roles: ["jalon_horizontal"], priority: 1 },
    { groups: ["PECHO"], roles: ["apertura"], priority: 2 },
    { groups: ["HOMBRO"], roles: ["deltoide_lateral"], priority: 2 },
    { groups: ["BICEP"], roles: ["bicep_compuesto", "bicep_aislado"], priority: 3 },
    { groups: ["TRICEP"], roles: ["extension_polea"], priority: 3 },
  ],
};

export function recipeFor(kind: DayKind): Slot[] {
  return RECIPES[kind];
}

/**
 * Cuántos ejercicios caben.
 *
 * Menos de 45 min ⇒ 4 (el recorte del día); 45 min ⇒ 4-5 ejercicios
 * ("rápido y efectivo", formato desde 05/06/26);
 * 60+ ⇒ 6-8. Con `volumeBias: "reducido"` se recorta uno: menos volumen,
 * mismos básicos. Este módulo no sabe nada de fases de dieta — quien decide
 * cuándo toca "reducido" es `volumeBiasForPhase` en `db.ts`.
 */
export function exerciseCountFor(sessionMinutes: number, volumeBias: VolumeBias): number {
  // Menos de 45 min es "hoy tengo menos tiempo" (I1): 40 minutos no son una
  // sesión de 45 un poco apretada, son los básicos del día y nada más.
  const base =
    sessionMinutes < 45 ? 4 : sessionMinutes < 55 ? 5 : sessionMinutes < 75 ? 6 : sessionMinutes < 90 ? 7 : 8;
  return Math.max(4, volumeBias === "reducido" ? base - 1 : base);
}
