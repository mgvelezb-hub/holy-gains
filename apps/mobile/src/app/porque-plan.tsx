import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Parrafo } from "@/components/Parrafo";
import { useTheme } from "@/context/theme";
import { PORQUE_DEL_PLAN } from "@/lib/nutricion";
import { fonts, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * Por qué tu plan se ve así — las reglas del motor, dichas en español.
 *
 * Antes era una tarjeta desplegable dentro de Nutrición, compitiendo por
 * espacio con el menú de la semana —lo que se consulta todos los días—.
 * Esto se lee una vez, cuando alguien quiere entender su plan a fondo, así
 * que se movió a su propia página: Nutrición se queda con una tarjeta de una
 * línea que solo trae aquí.
 */
export default function PorqueDelPlanScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.backText}>Atrás</Text>
        </Pressable>

        <Text style={styles.title}>Por qué tu plan se ve así</Text>

        {PORQUE_DEL_PLAN.map((bloque) => (
          <View key={bloque.titulo} style={styles.bloque}>
            <Text style={styles.bloqueTitulo}>{bloque.titulo}</Text>
            <Parrafo style={styles.parrafo}>{bloque.texto}</Parrafo>
          </View>
        ))}

        <Parrafo style={styles.aviso}>
          Esto explica un plan generado por reglas; no es una indicación médica. Si tienes una
          condición que cambie tu alimentación, consúltalo con una especialista.
        </Parrafo>
      </ScrollView>
    </SafeAreaView>
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
    title: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    bloque: { gap: spacing.xs },
    bloqueTitulo: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.body,
      color: colors.champan,
    },
    parrafo: {
      fontFamily: fonts.sans,
      ...typeScale.body,
      color: colors.marfil,
    },
    aviso: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.paloRosaLight,
      marginTop: spacing.sm,
    },
  });
