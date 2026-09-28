import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { Parrafo } from "@/components/Parrafo";
import { useTheme } from "@/context/theme";
import { ApiError, postRegenerarMenu } from "@/lib/api";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * "Regenerar mi menú ahora" — rearma los menús vigentes con las preferencias
 * de HOY, sin esperar al siguiente check-in.
 *
 * Antes, cambiar un alimento excluido/favorito, el presupuesto, la dieta o
 * los suplementos decía "entra en tu siguiente menú" y obligaba a esperar
 * una semana completa para verlo reflejado. La decisión de producto cambió:
 * regenerar a demanda es válido — el costo (la lista de súper cambia, lo ya
 * comprado puede sobrar) se dice de frente en la explicación de abajo, y por
 * eso es un botón que la persona toca, no algo automático.
 *
 * Los MACROS no se tocan: el servidor sigue las mismas kcal/proteína/carbo-
 * hidrato/grasa de la decisión vigente. Lo único que cambia es CON QUÉ
 * alimentos se cumplen esos números — eso lo explica el globito del ícono
 * "?", porque es la letra chica que hace que este botón no sorprenda a nadie.
 *
 * Superficie guinda con borde guindaLight, igual que el resto de los CTAs de
 * acento de la app (ver `.replantear` en ajustes/[seccion].tsx).
 */
export function RegenerarMenu({ onRegenerado }: { onRegenerado?: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [esError, setEsError] = useState(false);

  async function regenerar() {
    if (cargando) return;
    setCargando(true);
    setMensaje(null);
    setEsError(false);
    try {
      await postRegenerarMenu();
      setMensaje("Listo: tu menú de hoy ya tiene tus preferencias más recientes.");
      onRegenerado?.();
    } catch (error) {
      setEsError(true);
      setMensaje(
        error instanceof ApiError ? error.message : "No se pudo regenerar tu menú ahora.",
      );
    } finally {
      setCargando(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.headLabel}>Regenerar con tus preferencias de hoy</Text>
        <InfoTip titulo="Qué hace este botón">
          <TextoInfo>
            Rearma tus dos menús con tus preferencias de hoy —favoritos, exclusiones, presupuesto,
            dieta, suplementos y tiempo de cocina— sobre los mismos números de tu decisión: tus
            calorías, proteína, carbohidrato y grasa no cambian, solo con qué alimentos se cumplen.
          </TextoInfo>
          <TextoInfo>
            Tiene un costo: tu lista de súper cambia, y lo que ya compraste para esta semana puede
            sobrar. Por eso lo tocas tú, no pasa solo.
          </TextoInfo>
        </InfoTip>
      </View>

      <Pressable
        onPress={regenerar}
        disabled={cargando}
        style={[styles.boton, cargando && styles.botonOff]}
      >
        <Text style={styles.botonTexto}>
          {cargando ? "Regenerando..." : "Regenerar mi menú ahora"}
        </Text>
      </Pressable>

      {mensaje && <Parrafo style={[styles.mensaje, esError && styles.mensajeError]}>{mensaje}</Parrafo>}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: { marginTop: spacing.md, gap: spacing.sm },
    head: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    headLabel: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.paloRosa },
    boton: {
      marginTop: spacing.sm,
      paddingVertical: spacing.lg,
      borderRadius: radius.full,
      backgroundColor: colors.guinda,
      borderWidth: 1,
      borderColor: colors.guindaLight,
      alignItems: "center",
    },
    botonOff: { opacity: 0.5 },
    botonTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.pergamino },
    mensaje: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.champan,
      marginTop: spacing.xs,
    },
    mensajeError: { color: colors.error },
  });
