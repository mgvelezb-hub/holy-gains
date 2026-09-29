import { Minus, Plus } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/context/theme";
import type { MaquinaConBase, NivelBase } from "@/lib/api-cardio";
import { moverNivelBase, textoNivelBase } from "@/lib/programa-cardio";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * El editor del nivel base de UNA máquina (Q1) — el mismo en Ajustes y en la
 * hoja del cardio ("Ya sé mi nivel"). − / + mueven un paso (+ es más
 * intenso: resistencia, ritmo 5 s más rápido, watts) y "Guardar" lo manda;
 * nada se guarda con cada toque para no disparar un PATCH por paso.
 */
export function EditorNivelBase({
  maquina,
  inicial,
  onGuardar,
  textoGuardar = "Guardar",
}: {
  maquina: MaquinaConBase;
  inicial: NivelBase;
  onGuardar: (valor: NivelBase) => void | Promise<void>;
  textoGuardar?: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [valor, setValor] = useState<NivelBase>(inicial);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    try {
      await onGuardar(valor);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <View style={styles.caja}>
      <View style={styles.fila}>
        <Pressable
          onPress={() => setValor(moverNivelBase(valor, -1))}
          style={styles.boton}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Menos intenso"
        >
          <Minus size={18} color={colors.marfil} strokeWidth={2} />
        </Pressable>
        <Text style={styles.valor} accessibilityLiveRegion="polite">
          {textoNivelBase(maquina, valor)}
        </Text>
        <Pressable
          onPress={() => setValor(moverNivelBase(valor, 1))}
          style={styles.boton}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Más intenso"
        >
          <Plus size={18} color={colors.marfil} strokeWidth={2} />
        </Pressable>
      </View>
      <Pressable
        onPress={() => void guardar()}
        disabled={guardando}
        style={[styles.guardar, guardando && styles.guardarOff]}
        accessibilityRole="button"
      >
        <Text style={styles.guardarTexto}>{guardando ? "Guardando…" : textoGuardar}</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    caja: { gap: spacing.sm, marginTop: spacing.sm },
    fila: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
    boton: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
    },
    valor: { flex: 1, textAlign: "center", fontFamily: fonts.sansBold, ...typeScale.heading, color: colors.marfil },
    guardar: {
      alignItems: "center",
      justifyContent: "center",
      minHeight: 44,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.guindaLight,
      backgroundColor: colors.guinda,
    },
    guardarOff: { opacity: 0.6 },
    guardarTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.pergamino },
  });
