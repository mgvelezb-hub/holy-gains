import type { TomaDelDia } from "@/lib/api";
import { getPlanNutricion, type PlanNutricion } from "@/lib/api-nutricion";
import { programarComidas } from "@/lib/recordatorio";
import { comidaCompleta, itemsParaAviso } from "@/lib/siguiente-comida";

/**
 * Los avisos de comida a partir del plan: el "Prepárate" con su menú y los
 * suplementos que le tocan, y la hora de cada día (el sábado distinto). Los
 * renglones salen de la misma fuente que el widget y el reloj (el platillo
 * con sus ingredientes); si el slot no está en el menú de hoy, se quedan los
 * del servidor.
 *
 * `tomas` pisa las del plan: al marcar un suplemento, quien llama pasa la
 * lista ya marcada y el aviso de la siguiente comida deja de recordarlo.
 */
export function programarAvisosDelPlan(plan: PlanNutricion, tomas: readonly TomaDelDia[] = plan.tomas): Promise<boolean> {
  return programarComidas(
    plan.recordatorios.map((rec) => {
      const completa = comidaCompleta(plan, rec.slot);
      return {
        slot: rec.slot,
        label: rec.label,
        extras: rec.extras,
        menuNumber: rec.menuNumber,
        items: completa ? itemsParaAviso(completa) : rec.items,
        horaPorDia: rec.horaPorDia,
      };
    }),
    { hoy: plan.hoy.dia, tomas },
  );
}

/**
 * Vuelve a programar los avisos con el plan del servidor. Para después de
 * marcar un suplemento: nunca truena, un aviso viejo es mejor que una
 * pantalla que falla.
 */
export async function refrescarAvisosDeComida(tomas?: readonly TomaDelDia[]): Promise<void> {
  try {
    const plan = await getPlanNutricion();
    await programarAvisosDelPlan(plan, tomas ?? plan.tomas);
  } catch {
    // Sin red se quedan los avisos que ya había.
  }
}
