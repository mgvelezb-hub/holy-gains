import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Parrafo } from "@/components/Parrafo";
import { useTheme } from "@/context/theme";
import { fonts, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * El porqué de una pantalla, guardado hasta que alguien lo pida.
 *
 * La app explica mucho —de dónde sale un número, qué cambia una preferencia,
 * por qué el tope de cocina no es una regla dura— y esos párrafos son buenos
 * la primera vez y estorbo la décima. Cerrado se ve una línea; abierto está el
 * texto completo.
 *
 * No es lo mismo que `ScoreCard`: ahí lo colapsado es el DATO y la tarjeta
 * cerrada ya contesta. Aquí lo colapsado es la EXPLICACIÓN, que por definición
 * no contesta nada — solo justifica lo que ya se ve arriba.
 */
export function Explicacion({
  titulo = "Cómo funciona",
  children,
  defaultOpen = false,
}: {
  titulo?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        hitSlop={8}
        style={styles.head}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        {open ? (
          <ChevronDown size={17} color={colors.paloRosa} strokeWidth={2} />
        ) : (
          <ChevronRight size={17} color={colors.paloRosa} strokeWidth={2} />
        )}
        <Text style={styles.titulo}>{titulo}</Text>
      </Pressable>

      {open && <View style={styles.cuerpo}>{children}</View>}
    </View>
  );
}

/** Un párrafo de explicación con el color y el tamaño correctos. */
export function TextoExplicativo({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <Parrafo style={styles.parrafo}>{children}</Parrafo>;
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: { marginTop: spacing.md, gap: spacing.sm },
    head: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingVertical: 2 },
    titulo: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.paloRosa },
    cuerpo: { gap: spacing.sm },
    // `paloRosa` y no `paloRosaLight`: el texto explicativo se lee, no se
    // decora, y en el tema claro el tono claro se quedaba corto de contraste.
    parrafo: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
  });
