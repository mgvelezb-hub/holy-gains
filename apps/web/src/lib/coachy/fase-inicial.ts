import type { DecideOptions } from "engine";

import type { Phase } from "@/lib/engine-types";

/**
 * De qué fase parte el motor al rehacer el historial del check-in.
 *
 * `analyze.ts` repite todas las semanas desde el punto cero con `decide()`.
 * Sin `initialPhase` el motor arranca en BASE, así que quien declaró CUT (el
 * onboarding o el admin lo guardan en `Profile.currentPhase`) salía en BASE
 * en su primera decisión.
 *
 * - Sin decisiones previas en la ventana: manda la fase declarada.
 * - Con decisiones previas: manda lo ya decidido. El recorrido se ancla en la
 *   fase de la PRIMERA decisión de la ventana, que es de donde de verdad
 *   arrancó; así la repetición llega a la última decisión guardada por el
 *   mismo camino y nadie ve su historia reescrita porque su perfil diga otra
 *   fase. Las decisiones de antes de este cambio nacieron desde BASE y su
 *   primera decisión dice BASE: se repiten igual que siempre.
 *
 * Pura: se prueba sin base.
 */
export function arranqueDelMotor(entrada: {
  faseDeclarada: Phase;
  /** Decisiones de la ventana anteriores a este check-in, de la más vieja a la más nueva. */
  decisionesPrevias: ReadonlyArray<{ phase: Phase }>;
}): DecideOptions {
  const primera = entrada.decisionesPrevias[0];
  return { initialPhase: primera ? primera.phase : entrada.faseDeclarada };
}
