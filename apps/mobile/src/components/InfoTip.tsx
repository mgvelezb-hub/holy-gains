import { HelpCircle } from "lucide-react-native";
import { useMemo, useState, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { Parrafo } from "@/components/Parrafo";
import { useTheme } from "@/context/theme";
import { fonts, radius, shadow, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * El "porqué" de un dato, guardado en un globito que solo se abre si alguien
 * lo pide.
 *
 * EL PROBLEMA que resuelve: la app explicaba de más — un párrafo fijo junto a
 * cada número o cada cambio, diciendo de dónde salía o qué significaba,
 * aunque nadie lo hubiera pedido ("esto viene de tu reloj"). Amontonado, eso
 * hacía que la pantalla se viera menos limpia y menos ejecutiva. Con
 * `InfoTip` la explicación no desaparece, solo deja de ocupar espacio de
 * forma permanente: es un ícono de "?" que vive pegado al título al que
 * pertenece, y solo el que lo toca ve el texto.
 *
 * Distinto de `Explicacion`: `Explicacion` abre EN LÍNEA, empujando el resto
 * del contenido hacia abajo, y sigue sirviendo para explicaciones que valen
 * su propio bloque dentro de una tarjeta ya abierta. `InfoTip` no ocupa
 * ninguna fila propia ni siquiera cerrado — vive dentro del renglón del
 * título — y es para lo corto: una frase, un aviso, el porqué de un cambio.
 */
export function InfoTip({ titulo, children }: { titulo?: string; children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setAbierto(true)}
        hitSlop={14}
        accessibilityRole="button"
        accessibilityLabel={titulo ? `Más información: ${titulo}` : "Más información"}
      >
        <HelpCircle size={16} color={colors.pergaminoSoft} strokeWidth={2} />
      </Pressable>

      <Modal
        visible={abierto}
        transparent
        animationType="fade"
        onRequestClose={() => setAbierto(false)}
      >
        <Pressable style={styles.fondo} onPress={() => setAbierto(false)}>
          {/* Pressable interno con onPress vacío: absorbe el toque para que
              tocar el texto del globito no lo cierre igual que tocar afuera. */}
          <Pressable style={styles.globo} onPress={() => {}}>
            {titulo && <Text style={styles.titulo}>{titulo}</Text>}
            <View style={styles.cuerpo}>{children}</View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/** Un párrafo dentro del globito, con el color y tamaño correctos. */
export function TextoInfo({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <Parrafo style={styles.parrafo}>{children}</Parrafo>;
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    fondo: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.65)",
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.xl,
    },
    globo: {
      maxWidth: 340,
      width: "100%",
      backgroundColor: colors.cardBg,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: spacing.lg,
      gap: spacing.sm,
      ...shadow.card,
    },
    titulo: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.subheading,
      color: colors.champan,
    },
    cuerpo: { gap: spacing.sm },
    parrafo: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.marfil,
    },
  });
