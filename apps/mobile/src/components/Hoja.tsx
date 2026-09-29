import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useTheme } from "@/context/theme";
import { destinoHoja, inicioHoja } from "@/lib/hoja-animacion";
import { useReducirMovimiento } from "@/lib/reducir-movimiento";
import { fonts, radius, shadow, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * La hoja que flota encima de una pantalla — el ÚNICO contenedor de hojas y
 * diálogos de la app (N2).
 *
 * LOS DOS PROBLEMAS que corrige, y por qué viven aquí y no en cada pantalla:
 *
 * 1. **Transparencia.** Cada pantalla armaba su hoja a mano con `cardBg`, que
 *    en el tema oscuro es 5 % de blanco: la lista de atrás se leía a través
 *    de la hoja y las letras se encimaban. Aquí la hoja es `superficie`
 *    (opaca en los tres temas, AA cuidado en `contraste.test.ts`), con borde
 *    superior, sombra de elevación y un velo ≥ 0.75 detrás.
 * 2. **El scroll que no bajaba.** El patrón era `Pressable` (velo, cierra) →
 *    `Pressable` hoja con `onPress={() => {}}` (para que tocar la hoja no
 *    cerrara) → `ScrollView`. El `Pressable` de la hoja se queda con el toque
 *    al empezar y la hoja no tenía `flexShrink`: lo que pasaba del alto tope
 *    quedaba fuera, sin manera de llegar. Aquí el velo es un HERMANO de la
 *    hoja (un toque en la hoja nunca sube hasta él, no hace falta el
 *    `Pressable` vacío) y el `ScrollView` encoge dentro del alto tope, con el
 *    título y el `pie` fijos fuera del scroll.
 *
 * 3. **El parpadeo.** Con `animationType="fade"` toda la hoja (no solo el
 *    velo) iba de transparente a opaca y por ~300 ms su texto se encimaba con
 *    la pantalla de atrás, al abrir y al cerrar. Ahora el `Modal` no anima:
 *    el velo va en opacidad y la hoja se desliza desde abajo, opaca desde el
 *    primer cuadro (`lib/hoja-animacion.ts`). Al cerrar se queda montada
 *    hasta que termina de salir. "Reducir movimiento": aparece sin moverse.
 *
 * `variante="abajo"` (la de siempre) sube desde el borde inferior y respeta
 * el área segura; `"centro"` es un diálogo (teclado de peso, resumen, el
 * globito de `InfoTip`).
 */
export function Hoja({
  visible,
  onClose,
  titulo,
  children,
  pie,
  variante = "abajo",
  cerrarConVelo = true,
  contenidoStyle,
  hojaStyle,
}: {
  visible: boolean;
  onClose: () => void;
  titulo?: string;
  children: ReactNode;
  /** Fijo abajo, fuera del scroll: los botones que no se pueden perder. */
  pie?: ReactNode;
  variante?: "abajo" | "centro";
  /** `false` cuando cerrar sin querer pierde algo (el resumen de la sesión). */
  cerrarConVelo?: boolean;
  contenidoStyle?: StyleProp<ViewStyle>;
  hojaStyle?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const abajo = variante === "abajo";
  const { height: distancia } = useWindowDimensions();
  const reducirMovimiento = useReducirMovimiento();

  // Montada mientras se ve Y mientras termina de salir.
  const [montada, setMontada] = useState(visible);
  const inicio = inicioHoja({ reducirMovimiento, distancia });
  const opacidadVelo = useRef(new Animated.Value(inicio.velo)).current;
  const desplazamiento = useRef(new Animated.Value(inicio.desplazamiento)).current;

  if (visible && !montada) {
    // Cada apertura parte de fuera: la hoja nunca se asoma a medio camino.
    const desde = inicioHoja({ reducirMovimiento, distancia });
    opacidadVelo.setValue(desde.velo);
    desplazamiento.setValue(desde.desplazamiento);
    setMontada(true);
  }

  useEffect(() => {
    if (!montada) return;
    const destino = destinoHoja({ visible, reducirMovimiento, distancia });
    const curva = visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic);
    const animacion = Animated.parallel([
      Animated.timing(opacidadVelo, {
        toValue: destino.velo,
        duration: destino.duracionMs,
        easing: curva,
        useNativeDriver: true,
      }),
      Animated.timing(desplazamiento, {
        toValue: destino.desplazamiento,
        duration: destino.duracionMs,
        easing: curva,
        useNativeDriver: true,
      }),
    ]);
    animacion.start(({ finished }) => {
      if (finished && !visible) setMontada(false);
    });
    return () => animacion.stop();
  }, [visible, montada, reducirMovimiento, distancia, opacidadVelo, desplazamiento]);

  return (
    <Modal visible={montada} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.raiz, abajo ? styles.raizAbajo : styles.raizCentro]}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.velo, { opacity: opacidadVelo }]}
        />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={cerrarConVelo ? onClose : undefined}
          accessibilityRole="button"
          accessibilityLabel="Cerrar"
        />
        <Animated.View
          style={[
            styles.hoja,
            abajo ? [styles.hojaAbajo, { paddingBottom: spacing.lg + insets.bottom }] : styles.hojaCentro,
            hojaStyle,
            { transform: [{ translateY: desplazamiento }] },
          ]}
          accessibilityViewIsModal
        >
          {titulo ? (
            <Text style={styles.titulo} accessibilityRole="header">
              {titulo}
            </Text>
          ) : null}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.contenido, contenidoStyle]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            {children}
          </ScrollView>
          {pie ? <View style={styles.pie}>{pie}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    raiz: { flex: 1 },
    // Negro puro: la opacidad animada lo lleva hasta `VELO_OPACIDAD`.
    velo: { backgroundColor: "#000" },
    raizAbajo: { justifyContent: "flex-end" },
    raizCentro: { justifyContent: "center", alignItems: "center", padding: spacing.lg },
    hoja: {
      // Opaca: nada de lo de atrás se asoma entre las letras.
      backgroundColor: colors.superficie,
      borderColor: colors.cardBorder,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      gap: spacing.sm,
      ...shadow.hero,
    },
    hojaAbajo: {
      maxHeight: "88%",
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      borderTopWidth: 1,
      borderLeftWidth: 1,
      borderRightWidth: 1,
    },
    hojaCentro: {
      width: "100%",
      maxWidth: 420,
      maxHeight: "85%",
      borderRadius: radius.xl,
      borderWidth: 1,
      paddingBottom: spacing.lg,
    },
    titulo: { fontFamily: fonts.sansBold, ...typeScale.heading, color: colors.marfil },
    // `flexGrow: 0` + `flexShrink: 1`: mide lo que su contenido y, si no cabe
    // en el alto tope, encoge y desplaza en vez de empujar la hoja fuera.
    scroll: { flexGrow: 0, flexShrink: 1 },
    contenido: { gap: spacing.sm, paddingBottom: spacing.xs },
    pie: { gap: spacing.sm, paddingTop: spacing.xs },
  });
