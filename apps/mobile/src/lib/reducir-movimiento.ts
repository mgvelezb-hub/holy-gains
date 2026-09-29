import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * "Reducir movimiento" del sistema, al vuelo: si la persona lo cambia con la
 * app abierta, lo siguiente que se anime ya lo respeta.
 */
export function useReducirMovimiento(): boolean {
  const [reducir, setReducir] = useState(false);

  useEffect(() => {
    let vivo = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((valor) => {
        if (vivo) setReducir(valor);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducir);
    return () => {
      vivo = false;
      sub.remove();
    };
  }, []);

  return reducir;
}
