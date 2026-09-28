import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Parrafo } from "@/components/Parrafo";
import { useTheme } from "@/context/theme";
import { ApiError, preguntarNutricion, type ConsultaResponse } from "@/lib/api";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * Pregúntale a tu plan — su propia hoja.
 *
 * Antes vivía como tarjeta desplegable en Nutrición: el cuadro de texto y la
 * respuesta empujaban el resto del tablero hacia abajo. Se mueve tal cual —
 * misma llamada, mismo freno del servidor — a su propia hoja, siguiendo la
 * misma regla que ya sacó "Por qué tu plan se ve así" de la tarjeta.
 *
 * Explica lo que el motor ya decidió; no arma planes nuevos ni mueve números.
 * Las preguntas clínicas las frena el servidor **antes** de redactar nada: el
 * freno vive en un `if`, no en una instrucción del prompt que se pueda rodear
 * pidiendo lo mismo de otra manera.
 */
export default function PreguntaPlanScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [pregunta, setPregunta] = useState("");
  const [respuesta, setRespuesta] = useState<ConsultaResponse | null>(null);
  const [pensando, setPensando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar() {
    if (pregunta.trim().length < 3) return;
    setPensando(true);
    setError(null);
    try {
      setRespuesta(await preguntarNutricion(pregunta.trim()));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo responder ahora");
    } finally {
      setPensando(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.backText}>Atrás</Text>
        </Pressable>

        <Text style={styles.title}>Pregúntale a tu plan</Text>
        <Parrafo style={styles.subtitle}>
          Por qué esos alimentos, cómo cambiar uno, qué hacer si comes fuera.
        </Parrafo>

        <TextInput
          value={pregunta}
          onChangeText={setPregunta}
          placeholder="¿Puedo cambiar el pollo por atún?"
          placeholderTextColor={colors.paloRosaLight}
          multiline
          style={styles.consultaInput}
        />

        <Pressable
          onPress={enviar}
          disabled={pensando}
          style={[styles.consultaBoton, pensando && styles.consultaBotonOff]}
        >
          <Text style={styles.consultaBotonText}>{pensando ? "Pensando..." : "Preguntar"}</Text>
        </Pressable>

        {error && <Parrafo style={styles.consultaAviso}>{error}</Parrafo>}

        {respuesta && (
          <View style={styles.consultaRespuesta}>
            <Parrafo style={styles.consultaTexto}>{respuesta.answer}</Parrafo>
            <Parrafo style={styles.consultaAviso}>{respuesta.disclaimer}</Parrafo>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.obsidiana },
    content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.sm },
    back: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      paddingVertical: spacing.sm,
      alignSelf: "flex-start",
    },
    backText: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
    title: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    subtitle: { fontFamily: fonts.sans, ...typeScale.body, color: colors.paloRosa },
    consultaInput: {
      marginTop: spacing.md,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
      padding: spacing.md,
      minHeight: 64,
      fontFamily: fonts.sansMedium,
      ...typeScale.body,
      color: colors.marfil,
    },
    consultaBoton: {
      marginTop: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: 999,
      backgroundColor: colors.guinda,
      borderWidth: 1,
      borderColor: colors.guindaLight,
      alignItems: "center",
    },
    consultaBotonOff: { opacity: 0.5 },
    consultaBotonText: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.pergamino },
    consultaRespuesta: { marginTop: spacing.md, gap: spacing.sm },
    consultaTexto: { fontFamily: fonts.sans, ...typeScale.body, color: colors.marfil },
    consultaAviso: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.paloRosaLight,
      marginTop: spacing.sm,
    },
  });
