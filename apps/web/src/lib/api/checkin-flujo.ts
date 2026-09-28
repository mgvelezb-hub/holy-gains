/**
 * Cuándo corre Coachy tras guardar un check-in desde la app.
 *
 * La app sube las fotos DESPUÉS de crear el check-in (su ruta en Storage
 * lleva el id). Si Coachy corriera en el `after()` del POST, la lectura de
 * fotos —la del mensual contra la referencia incluida— usaría las de la vez
 * anterior. Por eso, cuando la app avisa `fotosPendientes: true`, el POST solo
 * guarda y es `POST /checkins/:id/listo` quien dispara el análisis, ya con
 * las fotos arriba. Sin fotos, nada cambia: corre al guardar.
 */

/** `true` = correr Coachy en el `after()` del POST. */
export function correrAlGuardar(raw: Record<string, unknown>): boolean {
  return raw.fotosPendientes !== true;
}

/**
 * `/listo` es idempotente: si el check-in ya tiene decisión (porque ya se
 * llamó, o porque corrió por otro camino) no se vuelve a analizar.
 */
export function accionListo(estado: { tieneDecision: boolean }): "correr" | "ya_corrio" {
  return estado.tieneDecision ? "ya_corrio" : "correr";
}
