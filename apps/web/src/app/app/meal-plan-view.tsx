"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Dieta vigente: Menú 1 / Menú 2, equivalencias por comida y lista de súper.
 *
 * Los datos llegan ya serializados desde el servidor — el motor no viaja al
 * navegador solo para pintar gramos.
 */

export interface MenuItemView {
  name: string;
  grams: number;
  free: boolean;
  /** "1 taza de arroz integral cocido (160 g)". `null` en menús viejos. */
  display?: string | null;
  why?: { closes: "proteina" | "carbo" | "grasa" | "fibra" } | null;
  /** El platillo al que pertenece (licuado, sopa); ausente si va suelto. */
  preparacionId?: string;
}

/** Lo que ese alimento viene a cerrar, dicho como lo diría el dueño. */
const CIERRA: Record<"proteina" | "carbo" | "grasa" | "fibra", string> = {
  proteina: "Cierra la proteína de esta comida",
  carbo: "Cierra el carbohidrato de esta comida",
  grasa: "Cierra la grasa de esta comida",
  fibra: "Aporta la fibra y el volumen de esta comida",
};

export interface MenuMealView {
  slot: string;
  label: string;
  timeHint: string;
  allowDenseCarb: boolean;
  items: MenuItemView[];
  /** El licuado o la sopa de la comida: sus ingredientes se pintan agrupados. */
  preparacion?: { id: string; nombre: string };
  equivalences: Array<{ forName: string; options: Array<{ name: string; grams: number }> }>;
}

export interface MenuView {
  menuNumber: number;
  meals: MenuMealView[];
}

export interface GroceryItemView {
  name: string;
  grams: number;
  unit: string;
  /** Los platillos para los que se compra ("Crema de calabacita"). */
  preparaciones?: string[];
}

function Item({ item }: { item: MenuItemView }): React.JSX.Element {
  return (
    <li className="flex justify-between gap-3">
      {/* La cantidad se lee en la unidad en que se sirve —"1 taza de
          arroz (160 g)"—; los gramos siguen ahí, ya no van primero. */}
      <span title={item.why ? CIERRA[item.why.closes] : undefined}>
        {item.display ?? item.name}
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {item.free ? "libre" : item.display ? "" : `${item.grams} g`}
      </span>
    </li>
  );
}

function Meal({ meal }: { meal: MenuMealView }): React.JSX.Element {
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold">{meal.label}</h3>
        <span className="text-xs text-muted-foreground">{meal.timeHint}</span>
      </div>

      <ul className="space-y-1 text-sm">
        {/* El platillo va primero, con su nombre y sus ingredientes debajo:
            "Licuado de fresa con avena" se prepara junto, no por renglón. */}
        {meal.preparacion ? (
          <li>
            <p className="font-medium">{meal.preparacion.nombre}</p>
            <ul className="mt-1 space-y-1 border-l pl-3">
              {meal.items
                .filter((item) => item.preparacionId === meal.preparacion?.id)
                .map((item) => (
                  <Item key={item.name} item={item} />
                ))}
            </ul>
          </li>
        ) : null}
        {meal.items
          .filter((item) => !meal.preparacion || item.preparacionId !== meal.preparacion.id)
          .map((item) => (
            <Item key={item.name} item={item} />
          ))}
      </ul>

      {meal.equivalences.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            ¿No tienes algo? Equivalencias
          </summary>
          <ul className="mt-2 space-y-1.5">
            {meal.equivalences.map((equivalence) => (
              <li key={equivalence.forName}>
                <span className="font-medium">{equivalence.forName}</span>{" "}
                <span className="text-muted-foreground">
                  ={" "}
                  {equivalence.options
                    .map((option) => `${option.name} ${option.grams} g`)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function MealPlanView({
  menus,
  groceries,
}: {
  menus: MenuView[];
  groceries: GroceryItemView[];
}): React.JSX.Element {
  const first = menus[0];
  if (!first) return <p className="text-sm text-muted-foreground">Todavía no hay menú.</p>;

  return (
    <Tabs defaultValue={String(first.menuNumber)} className="space-y-3">
      <TabsList className="grid w-full grid-cols-3">
        {menus.map((menu) => (
          <TabsTrigger key={menu.menuNumber} value={String(menu.menuNumber)}>
            Menú {menu.menuNumber}
          </TabsTrigger>
        ))}
        <TabsTrigger value="super">Súper</TabsTrigger>
      </TabsList>

      {menus.map((menu) => (
        <TabsContent key={menu.menuNumber} value={String(menu.menuNumber)} className="space-y-3">
          {menu.meals.map((meal) => (
            <Meal key={`${menu.menuNumber}-${meal.slot}`} meal={meal} />
          ))}
        </TabsContent>
      ))}

      <TabsContent value="super">
        <ul className="space-y-1 text-sm">
          {groceries.map((item) => (
            <li key={item.name} className="flex justify-between gap-3 border-b py-1">
              <span>
                {item.name}
                {item.preparaciones && item.preparaciones.length > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    · para {item.preparaciones.join(", ").toLowerCase()}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {item.grams} g {item.unit ? `· ${item.unit}` : ""}
              </span>
            </li>
          ))}
          {groceries.length === 0 ? (
            <li className="text-muted-foreground">Sin lista todavía.</li>
          ) : null}
        </ul>
      </TabsContent>
    </Tabs>
  );
}
