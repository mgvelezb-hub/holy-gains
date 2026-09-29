import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * "Tu menú se actualizó con las reglas nuevas", una sola vez.
 *
 * El servidor rehace solo los menús armados con reglas viejas del motor y,
 * mientras sean esos, `planDeNutricion` trae `aviso`. Cuántas veces se vio
 * es cosa del teléfono: aquí se recuerda por decisión, así que se enseña la
 * primera vez que la pestaña Nutrición lo recibe y no vuelve a salir hasta
 * que otra decisión se rehaga.
 */

const LLAVE = "holygains.nutricion.avisosDeMenuVistos";
/** Basta con recordar los últimos: cada decisión nueva trae su propia llave. */
const MAXIMO = 20;

async function vistos(): Promise<string[]> {
  try {
    const crudo = await AsyncStorage.getItem(LLAVE);
    const leido: unknown = crudo ? JSON.parse(crudo) : [];
    return Array.isArray(leido) ? leido.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** El aviso a enseñar ahora, o `null` si no hay o ya se vio para esta decisión. */
export async function avisoDeMenuPorMostrar(plan: {
  decision: { id: string } | null;
  aviso?: string | null;
}): Promise<{ llave: string; texto: string } | null> {
  if (!plan.aviso || !plan.decision) return null;
  const llave = `${plan.decision.id}:${plan.aviso}`;
  return (await vistos()).includes(llave) ? null : { llave, texto: plan.aviso };
}

/** Recuerda que ya se enseñó. Si no se puede guardar, a lo más se repite. */
export async function marcaAvisoDeMenuVisto(llave: string): Promise<void> {
  try {
    const lista = (await vistos()).filter((v) => v !== llave);
    await AsyncStorage.setItem(LLAVE, JSON.stringify([...lista, llave].slice(-MAXIMO)));
  } catch {
    // Nada: el aviso volvería a salir, que es mejor que romper Nutrición.
  }
}
