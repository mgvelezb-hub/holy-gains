import type { Prisma } from "@prisma/client";

/**
 * Aplanado del JSON del motor (`MealPlan.mealsJson` / `groceryListJson`) a lo
 * que pinta la pantalla de alimentación.
 *
 * Compartido entre el home (`src/app/app/page.tsx`) y `GET /api/v1/nutrition`
 * (app nativa): un solo lugar para que web y app nunca diverjan en cómo se
 * lee el JSON del motor. Funciones puras, sin Prisma ni `server-only`: no
 * hacen falta, solo transforman el `Json` que ya trajo el caller.
 */

/** Por qué está ese alimento en esa comida (motor F1). */
export interface MenuItemWhyView {
  closes: "proteina" | "carbo" | "grasa" | "fibra";
  units: number;
  unitLabel: string;
  note?: string;
}

export interface MenuItemView {
  /** Id del catálogo (o `custom:<id>` de un alimento propio); ausente en menús viejos. */
  foodId?: string;
  name: string;
  grams: number;
  free: boolean;
  /** "3 tortillas de maíz" cuando el alimento se sirve por pieza. */
  portion: string | null;
  /**
   * "1 taza de arroz integral cocido (160 g)", tal como lo arma el motor.
   * `null` en los menús guardados antes de que existiera: la pantalla cae a
   * `portion` y luego a los gramos, que es lo que esos menús siempre tuvieron.
   */
  display: string | null;
  why: MenuItemWhyView | null;
  /** El platillo al que pertenece (licuado, sopa); ausente si va suelto. */
  preparacionId?: string;
}

/** El platillo de una comida: "Licuado de fresa con avena". */
export interface PreparacionView {
  id: string;
  nombre: string;
  tipo: "licuado" | "sopa" | "crema" | "caldo" | "platillo";
}

const TIPOS_DE_PREPARACION = ["licuado", "sopa", "crema", "caldo", "platillo"] as const;

function toPreparacion(raw: unknown): PreparacionView | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const tipo = String(row.tipo ?? "");
  if (typeof row.id !== "string" || typeof row.nombre !== "string") return null;
  if (!TIPOS_DE_PREPARACION.includes(tipo as PreparacionView["tipo"])) return null;
  return { id: row.id, nombre: row.nombre, tipo: tipo as PreparacionView["tipo"] };
}

const MACROS_QUE_CIERRA = ["proteina", "carbo", "grasa", "fibra"] as const;

function toWhy(raw: unknown): MenuItemWhyView | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const closes = String(row.closes ?? "");
  if (!MACROS_QUE_CIERRA.includes(closes as MenuItemWhyView["closes"])) return null;
  return {
    closes: closes as MenuItemWhyView["closes"],
    units: Number(row.units ?? 0),
    unitLabel: String(row.unitLabel ?? "g"),
    ...(typeof row.note === "string" ? { note: row.note } : {}),
  };
}

export interface MenuMealView {
  slot: string;
  label: string;
  timeHint: string;
  allowDenseCarb: boolean;
  items: MenuItemView[];
  /** El licuado o la sopa de la comida; sus ingredientes traen `preparacionId`. */
  preparacion?: PreparacionView;
  equivalences: Array<{
    forName: string;
    options: Array<{
      name: string;
      grams: number;
      portion: string | null;
      /** true si esa opción sola se sale del ±10 %: sirve, pero no es igual. */
      aproximada?: boolean;
      /** Ya está en casa (despensa o alimento propio): la hoja la pone primero. */
      enDespensa?: boolean;
    }>;
    /** true si alguna de sus opciones es aproximada; la app lo advierte. */
    aproximada?: boolean;
    /**
     * Equivalentes de su grupo SMAE que no van con esta comida, con el porqué
     * ("no va con tu papa"). No se eligen; se dicen en gris.
     */
    noVan?: Array<{ name: string; grams: number; portion: string | null; motivo: string }>;
  }>;
}

export interface MenuView {
  menuNumber: number;
  meals: MenuMealView[];
}

export interface GroceryItemView {
  name: string;
  grams: number;
  unit: string;
  /**
   * "7 naranjas", cuando el alimento se compra por pieza. La lista acumula
   * gramos —son gramos de verdad— pero nadie pide 1 260 g de naranja en el
   * súper: pide siete.
   */
  portion?: string | null;
  /** Ya está en casa: se marca en vez de mandar a comprarlo otra vez. */
  enDespensa?: boolean;
  /** Los platillos para los que se compra ("Crema de calabacita"). */
  preparaciones?: string[];
}

/** El JSON del motor, aplanado a lo que necesita la vista. */
import { porcionNatural } from "@/lib/coachy/porciones";

export function toMenuView(
  menuNumber: number,
  mealsJson: Prisma.JsonValue,
  /**
   * Horarios propios `{slot: "HH:MM"}`. Los tiempos que la persona movió
   * pisan la hora sugerida por el motor; los demás se quedan como estaban.
   */
  horarios: Record<string, string> = {},
): MenuView {
  const meals = Array.isArray(mealsJson) ? mealsJson : [];

  return {
    menuNumber,
    meals: meals.map((raw) => {
      const meal = raw as Record<string, unknown>;
      const items = Array.isArray(meal.items) ? meal.items : [];
      const equivalences = Array.isArray(meal.equivalences) ? meal.equivalences : [];

      const slot = String(meal.slot ?? "");
      const preparacion = toPreparacion(meal.preparacion);

      return {
        slot,
        label: String(meal.label ?? ""),
        timeHint: horarios[slot] ?? String(meal.timeHint ?? ""),
        allowDenseCarb: meal.allowDenseCarb !== false,
        items: items.map((item) => {
          const row = item as Record<string, unknown>;
          const name = String(row.name ?? "");
          const grams = Number(row.grams ?? 0);
          return {
            ...(typeof row.foodId === "string" ? { foodId: row.foodId } : {}),
            name,
            grams,
            free: row.free === true,
            // Lo que se compra por pieza se dice en piezas: nadie pesa una
            // tortilla, y "90 g" obliga a dividir para saber si son tres.
            portion: porcionNatural(name, grams),
            display: typeof row.display === "string" ? row.display : null,
            why: toWhy(row.why),
            ...(preparacion && toPreparacion(row.preparacion)?.id === preparacion.id
              ? { preparacionId: preparacion.id }
              : {}),
          };
        }),
        ...(preparacion ? { preparacion } : {}),
        equivalences: equivalences.map((equivalence) => {
          const row = equivalence as Record<string, unknown>;
          const options = Array.isArray(row.options) ? row.options : [];
          return {
            forName: String(row.forName ?? ""),
            options: options.map((option) => {
              const item = option as Record<string, unknown>;
              const nombre = String(item.name ?? "");
              const gramos = Number(item.grams ?? 0);
              return {
                name: nombre,
                grams: gramos,
                portion: porcionNatural(nombre, gramos),
                // Los menús guardados antes de que existiera la marca no la
                // traen: ausente se lee como exacta, que es lo que eran.
                ...(item.aproximada === true ? { aproximada: true } : {}),
                ...(item.enDespensa === true ? { enDespensa: true } : {}),
              };
            }),
            ...(row.aproximada === true ? { aproximada: true } : {}),
            ...(Array.isArray(row.noVan) && row.noVan.length > 0
              ? {
                  noVan: row.noVan.map((raw) => {
                    const fila = raw as Record<string, unknown>;
                    const nombre = String(fila.name ?? "");
                    const gramos = Number(fila.grams ?? 0);
                    return {
                      name: nombre,
                      grams: gramos,
                      portion: porcionNatural(nombre, gramos),
                      motivo: String(fila.motivo ?? ""),
                    };
                  }),
                }
              : {}),
          };
        }),
      } satisfies MenuMealView;
    }),
  };
}

export function toGroceries(json: Prisma.JsonValue): GroceryItemView[] {
  if (!Array.isArray(json)) return [];
  return json.map((raw) => {
    const item = raw as Record<string, unknown>;
    const name = String(item.name ?? "");
    const grams = Number(item.grams ?? 0);
    return {
      name,
      grams,
      unit: String(item.unit ?? ""),
      portion: porcionNatural(name, grams),
      ...(item.enDespensa === true ? { enDespensa: true } : {}),
      ...(Array.isArray(item.preparaciones) && item.preparaciones.length > 0
        ? { preparaciones: item.preparaciones.map(String) }
        : {}),
    };
  });
}
