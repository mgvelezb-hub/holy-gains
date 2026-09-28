import {
  apiFetch,
  type DietStyle,
  type GroceryItem,
  type Menu,
  type MenuPreference,
  type SugerenciaSuplemento,
  type TomaDelDia,
} from "@/lib/api";

/**
 * Cliente del plan canónico de nutrición (K1) — contrato EXACTO de
 * `apps/web/src/lib/coachy/plan-nutricion.ts`.
 *
 * Separado de `api.ts` porque es un objeto propio: todo lo que la pestaña
 * Nutrición, la hoja del plan y los recordatorios necesitan, ya cruzado en el
 * servidor. Ninguna pantalla vuelve a calcular kcal, horarios por día, tomas
 * o "ya lo tienes" por su cuenta.
 */

export type AvisoPlan = {
  id: "freno" | "glucosa" | "vitamina_d" | "despensa";
  /** `freno` va arriba; `aviso` cambia el plan; `info` solo se dice. */
  nivel: "freno" | "aviso" | "info";
  /** Tarjeta de una línea: título y resumen; `texto` va en el InfoTip. */
  titulo: string;
  corto: string;
  texto: string;
  accion?: { etiqueta: string; ruta: string };
};

export type DespensaPlan = { total: number; enMenu: number; enCasa: number; sinUso: string[] };

export type RecordatorioPlan = {
  slot: string;
  label: string;
  menuNumber: number;
  items: Array<{ name: string; display?: string }>;
  extras: string[];
  cuerpo: string;
  horaPorDia: Record<string, string>;
};

export type PlanNutricion = {
  decision: {
    id: string;
    phase: string;
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number | null;
  } | null;
  porque: string | null;
  estilo: { valor: DietStyle | "MENU_FIJO"; nombre: string; detalle: string };
  preferencias: {
    comidas: number;
    presupuesto: "BAJO" | "MEDIO" | "ALTO";
    maxPrepMin: number | null;
    leche: string;
    preparaciones: { licuados: boolean; sopas: boolean; cremas: boolean };
  };
  menus: Menu[];
  menuPreference: MenuPreference;
  menuDeHoy: number;
  groceries: GroceryItem[];
  despensa: DespensaPlan;
  tomas: TomaDelDia[];
  tomasPausadas: number;
  resumenTomas: { hechas: number; total: number; linea: string };
  sugerencias: SugerenciaSuplemento[];
  freno: string | null;
  notasSuplementos: string[];
  horarios: Record<string, string>;
  horariosPorDia: Record<string, Record<string, string>>;
  hoy: {
    fecha: string;
    dia: string;
    comidas: Array<{ slot: string; label: string; hora: string; resumen: string; tomas: string[] }>;
  };
  recordatorios: RecordatorioPlan[];
  avisos: AvisoPlan[];
  materialized: boolean;
};

/** `GET /api/v1/nutricion/plan`. */
export function getPlanNutricion(): Promise<PlanNutricion> {
  return apiFetch<PlanNutricion>("/api/v1/nutricion/plan");
}

export type RespuestasReplanDieta = {
  goal: string;
  mealsPerDay: number;
  budget: "BAJO" | "MEDIO" | "ALTO";
  dietStyle: DietStyle;
  maxPrepMin: number | null;
  supplements: Array<"WHEY" | "CREATINA" | "OMEGA3">;
  excludedFoods: string[];
  favoriteFoods: string[];
};

export type VistaPreviaPlan = {
  fase: string;
  macros: { kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number | null };
  cambiaMacros: boolean;
  porque: string;
  estilo: { valor: string; nombre: string };
  diaMuestra: Array<{ slot: string; label: string; hora: string; items: string[] }>;
  despensa: DespensaPlan;
  tomas: Array<{ corto: string; cuando: string; slot: string | null }>;
  tomasPausadas: number;
  avisos: AvisoPlan[];
  cuando: string;
};

/**
 * `POST /api/v1/nutricion/replan?preview=1`: lo que saldría con estas
 * respuestas, sin guardar nada. Lo pide la pantalla en vivo.
 */
export function postReplanDietaPreview(
  input: RespuestasReplanDieta,
): Promise<{ lectura: string[]; previa: VistaPreviaPlan | null }> {
  return apiFetch<{ lectura: string[]; previa: VistaPreviaPlan | null }>("/api/v1/nutricion/replan?preview=1", {
    method: "POST",
    body: input,
  });
}
