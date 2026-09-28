import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useMemo, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Parrafo } from "@/components/Parrafo";
import { useTheme } from "@/context/theme";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";

/**
 * Las piezas de las hojas de suplementos: la lista de una línea por
 * renglón, la hoja de zoom y el bloque de "campo: texto" de su interior.
 *
 * Densidad cero: la lista dice nombre y una línea; el porqué, la evidencia y
 * el tope viven en la hoja, que se abre por encima y se cierra con "Atrás".
 * Nada se despliega hacia abajo.
 */

export function Hoja({
  visible,
  titulo,
  onClose,
  children,
}: {
  visible: boolean;
  titulo: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.back}>
            <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
            <Text style={styles.backText}>Atrás</Text>
          </Pressable>
          <Text style={styles.title}>{titulo}</Text>
          {children}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

/** Un bloque de la hoja: etiqueta chica y su texto. Si no hay texto, no se pinta. */
export function Campo({ etiqueta, texto }: { etiqueta: string; texto: string | null | undefined }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!texto) return null;
  return (
    <View style={styles.campo}>
      <Text style={styles.etiqueta}>{etiqueta.toUpperCase()}</Text>
      <Parrafo style={styles.texto}>{texto}</Parrafo>
    </View>
  );
}

/** El aviso que no se puede omitir (hierro, valeriana, freno clínico). */
export function Aviso({ texto }: { texto: string | null | undefined }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!texto) return null;
  return (
    <View style={styles.aviso}>
      <Parrafo style={styles.avisoTexto}>{texto}</Parrafo>
    </View>
  );
}

export type Renglon = { id: string; titulo: string; detalle: string; marca?: ReactNode };

/** La lista de renglones de una línea que abren su hoja. */
export function ListaRenglones({
  renglones,
  onPress,
}: {
  renglones: Renglon[];
  onPress: (id: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (renglones.length === 0) return null;
  return (
    <View style={styles.lista}>
      {renglones.map((renglon, index) => (
        <Pressable
          key={renglon.id}
          onPress={() => onPress(renglon.id)}
          style={({ pressed }) => [styles.fila, index === 0 && styles.filaPrimera, pressed && styles.filaPresionada]}
        >
          {renglon.marca}
          <View style={styles.textos}>
            <Text style={styles.nombre} numberOfLines={1}>
              {renglon.titulo}
            </Text>
            <Text style={styles.detalle} numberOfLines={1}>
              {renglon.detalle}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.paloRosa} strokeWidth={2} />
        </Pressable>
      ))}
    </View>
  );
}

/** Botón secundario de la hoja (Ya lo tomo / No quiero / Quitar). */
export function BotonSecundario({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.secundario, disabled && styles.off]}>
      <Text style={styles.secundarioTexto}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.obsidiana },
    content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.md },
    back: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      paddingVertical: spacing.sm,
      alignSelf: "flex-start",
    },
    backText: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
    title: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil, marginBottom: spacing.xs },
    campo: { gap: 2 },
    etiqueta: { fontFamily: fonts.sansSemiBold, ...typeScale.label, letterSpacing: 1.2, color: colors.paloRosa },
    texto: { fontFamily: fonts.sans, ...typeScale.body, color: colors.marfil },
    aviso: {
      borderRadius: radius.lg,
      padding: spacing.md,
      backgroundColor: withAlpha(colors.champan, 0.14),
    },
    avisoTexto: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.marfil },
    lista: {
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
      overflow: "hidden",
    },
    fila: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.lg,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    filaPrimera: { borderTopWidth: 0 },
    filaPresionada: { backgroundColor: withAlpha(colors.paloRosa, 0.08) },
    textos: { flex: 1, gap: 1 },
    nombre: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.marfil },
    detalle: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
    secundario: {
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingVertical: spacing.md,
      alignItems: "center",
    },
    secundarioTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.marfil },
    off: { opacity: 0.5 },
  });
