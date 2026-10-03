import type { TomaDelDia } from "@/lib/api";

/**
 * Las tomas de suplementos del día — lógica PURA.
 *
 * Desde el 3-oct las tomas no viven en el menú (el menú es para verlo y
 * acomodarlo): se marcan en Hoy → Suplementos, con su hora sugerida, y se
 * recuerdan junto al "Prepárate" de la comida que toca mientras no se marquen.
 */

/**
 * El check es "ya lo tomé hoy" (escribe `SupplementLog`), no "acepto
 * tomarlo": eso se decide en Ajustes → Suplementos. Irma lo leía al revés
 * —marcar era aceptar, y lo tachado le hacía ruido—, así que el renglón dice
 * qué hacer y, marcado, a qué hora se tomó, sin tachar nada.
 */
export const AYUDA_TOMAS =
  "La hora es una sugerencia según tus comidas y tu entreno, no una regla. Toca cada suplemento cuando lo tomes, o el reloj para decir a qué hora fue; así sabemos si lo llevas diario";

/** "14:05", en la hora del teléfono. */
function horaCorta(iso: string): string | null {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;
  return `${String(fecha.getHours()).padStart(2, "0")}:${String(fecha.getMinutes()).padStart(2, "0")}`;
}

/** La toma ya marcada: "Tomada 14:05" (o "Tomada" si no se sabe la hora). */
export function lineaTomada(t: TomaDelDia): string {
  const hora = t.hechaA ? horaCorta(t.hechaA) : null;
  return hora ? `Tomada ${hora}` : "Tomada";
}

/** La lista con esa toma marcada (con la hora) o desmarcada; no toca la original. */
export function alternaToma(
  tomas: readonly TomaDelDia[],
  supplement: string,
  ahora: Date = new Date(),
): TomaDelDia[] {
  return tomas.map((t) => {
    if (t.supplement !== supplement) return t;
    if (t.hecho) {
      const { hechaA: _hora, ...resto } = t;
      return { ...resto, hecho: false };
    }
    return { ...t, hecho: true, hechaA: ahora.toISOString() };
  });
}

/** `"14:30"` → minutos desde medianoche; `null` si no es hora. */
function minutosDe(hora: string | null | undefined): number | null {
  if (!hora) return null;
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hora.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * Qué suplementos recordar con cada comida, como "+ creatina + omega-3" en
 * el "Prepárate" o en el widget. Recordatorio amable, no regla: la hora real
 * la marca la persona en Hoy → Suplementos.
 *
 * Cada toma "toca" en la primera comida cuya hora alcanza su hora sugerida
 * (la de después de la última comida —dormir— va con la última; la libre,
 * con la primera). Sin hora sugerida (servidor viejo) cuenta la comida a la
 * que se amarra, y si no tiene, no se recuerda.
 *
 * - `soloPendientes` (hoy): se recuerda toda toma sin marcar que ya tocó,
 *   también las atrasadas de comidas anteriores; en cuanto se marca, deja
 *   de salir en los avisos que siguen.
 * - Sin él (los demás días, sin saber qué se marcará): cada toma sale una
 *   sola vez, en la comida que le toca.
 */
export function tomasDeCadaComida(
  tomas: readonly TomaDelDia[],
  comidas: ReadonlyArray<{ slot: string; hora: string }>,
  opciones: { soloPendientes: boolean },
): Record<string, TomaDelDia[]> {
  const orden = comidas
    .map((comida) => ({ slot: comida.slot, minutos: minutosDe(comida.hora) }))
    .filter((comida): comida is { slot: string; minutos: number } => comida.minutos !== null)
    .sort((a, b) => a.minutos - b.minutos);
  const salida: Record<string, TomaDelDia[]> = Object.fromEntries(orden.map((comida) => [comida.slot, []]));
  if (orden.length === 0) return salida;

  for (const toma of tomas) {
    if (opciones.soloPendientes && toma.hecho) continue;
    let toca: number;
    if (toma.horaSugerida === null) {
      toca = 0;
    } else {
      const sugerida =
        minutosDe(toma.horaSugerida) ?? minutosDe(comidas.find((c) => c.slot === toma.slot)?.hora);
      if (sugerida === null) continue;
      toca = orden.findIndex((comida) => comida.minutos >= sugerida);
      if (toca === -1) toca = orden.length - 1;
    }
    const hasta = opciones.soloPendientes ? orden.length : toca + 1;
    for (let i = toca; i < hasta; i += 1) salida[orden[i]!.slot]!.push(toma);
  }
  return salida;
}

/** Lo mismo, dicho en corto para el aviso: `{ COMIDA: ["creatina", "omega-3"] }`. */
export function tomasPorComida(
  tomas: readonly TomaDelDia[],
  comidas: ReadonlyArray<{ slot: string; hora: string }>,
  opciones: { soloPendientes: boolean },
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(tomasDeCadaComida(tomas, comidas, opciones)).map(([slot, deLaComida]) => [
      slot,
      deLaComida.map((toma) => toma.corto),
    ]),
  );
}
