/**
 * ¿La decisión espera a un humano o sale publicada?
 *
 * `REQUIRE_APPROVAL` es un interruptor global, pero "tener coach humano" es
 * de cada perfil. No hay columna ni vínculo atleta↔coach en el schema, así
 * que se deriva de lo único que un humano deja en la base cuando revisa:
 * `Decision.approvedAt`, que solo escriben "Aprobar" y "Corregir" del admin
 * (la decisión que nace publicada sola lo deja en `null`).
 *
 * La regla: espera aprobación solo si el interruptor está prendido **y** un
 * humano revisó alguna decisión de este perfil en los últimos 42 días. Si
 * nadie la ha revisado —o dejó de hacerlo hace más de seis semanas— el perfil
 * lo guía la IA y su retro no puede quedarse esperando a nadie.
 *
 * Límite conocido: el importador de historial también escribe `approvedAt`
 * (con la hora del import), así que un perfil recién importado cuenta como
 * revisado durante esa ventana.
 */

export const DIAS_REVISION_HUMANA = 42;

export interface RevisionHumanaInput {
  /** `REQUIRE_APPROVAL` (global). */
  requireApproval: boolean;
  /** El `approvedAt` más reciente de las decisiones de este perfil. */
  ultimaRevisionHumana: Date | null;
  ahora: Date;
}

export function necesitaRevisionHumana(input: RevisionHumanaInput): boolean {
  if (!input.requireApproval) return false;
  if (input.ultimaRevisionHumana === null) return false;

  const dias = (input.ahora.getTime() - input.ultimaRevisionHumana.getTime()) / 86_400_000;
  return dias <= DIAS_REVISION_HUMANA;
}
