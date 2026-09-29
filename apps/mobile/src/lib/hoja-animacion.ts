import { VELO_OPACIDAD } from "@/lib/theme";

/**
 * Cómo se mueve `Hoja` (N2).
 *
 * Con `Modal animationType="fade"` TODA la hoja iba de transparente a opaca y,
 * por ~300 ms, su texto se encimaba con la pantalla de atrás. Aquí la hoja
 * nunca cambia de opacidad: el velo sí (0 → `VELO_OPACIDAD`) y la hoja se
 * desliza desde abajo, opaca desde el primer cuadro. El cierre es el camino
 * inverso. Con "Reducir movimiento" no hay deslizamiento y todo es inmediato.
 */
export const HOJA_ABRIR_MS = 260;
export const HOJA_CERRAR_MS = 200;

export type EstadoHoja = { velo: number; desplazamiento: number };

type Entrada = { reducirMovimiento: boolean; distancia: number };

/** Dónde queda todo antes de abrir: velo apagado y la hoja fuera, abajo. */
export function inicioHoja({ reducirMovimiento, distancia }: Entrada): EstadoHoja {
  return { velo: 0, desplazamiento: reducirMovimiento ? 0 : distancia };
}

/** Hacia dónde animar al abrir o cerrar, y en cuánto tiempo. */
export function destinoHoja({
  visible,
  reducirMovimiento,
  distancia,
}: Entrada & { visible: boolean }): EstadoHoja & { duracionMs: number } {
  if (visible) {
    return { velo: VELO_OPACIDAD, desplazamiento: 0, duracionMs: reducirMovimiento ? 0 : HOJA_ABRIR_MS };
  }
  return {
    velo: 0,
    desplazamiento: reducirMovimiento ? 0 : distancia,
    duracionMs: reducirMovimiento ? 0 : HOJA_CERRAR_MS,
  };
}
