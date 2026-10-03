import { useFocusEffect, useRouter } from "expo-router";
import { Check, ChevronLeft, Circle } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import { ApiError, getSuplementos, postLogSuplemento, type SuplementosResponse } from "@/lib/api";
import { lineaToma } from "@/lib/suplementos";
import { AYUDA_TOMAS, alternaToma, renglonToma } from "@/lib/tomas-comida";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";

/**
 * Tomas de hoy: una línea por toma, en el orden del día, y un toque la marca
 * como tomada (con su hora); otro toque la desmarca.
 *
 * No hay nada más aquí a propósito: el porqué y la evidencia viven en
 * Ajustes → Suplementos. Esta hoja es para el momento de tomarla.
 */
export default function SuplementosHoyScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<SuplementosResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setData(await getSuplementos());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudieron cargar tus tomas");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void cargar();
    }, [cargar]),
  );

  async function alternar(supplement: string) {
    if (!data) return;
    const toma = data.tomas.find((t) => t.supplement === supplement);
    if (!toma) return;
    const anterior = data;
    const tomas = alternaToma(data.tomas, supplement);
    const hechas = tomas.filter((t) => t.hecho).length;
    setData({ ...data, tomas, resumen: { ...data.resumen, hechas } });
    try {
      await postLogSuplemento(data.hoy, supplement, !toma.hecho);
    } catch {
      // Sin red la marca se revierte: una toma marcada que no se guardó
      // mentiría en el conteo de mañana.
      setData(anterior);
    }
  }

  if (!data && !error) return <LoadingState label="Cargando tus tomas..." />;
  if (!data && error) return <ErrorState message={error} onRetry={() => void cargar()} />;
  if (!data) return null;

  const hechas = data.tomas.filter((t) => t.hecho).length;

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.backText}>Atrás</Text>
        </Pressable>
        <Text style={styles.title}>Tomas de hoy</Text>
        <Text style={styles.sub}>
          {hechas} de {data.tomas.length}
        </Text>

        {data.tomas.length === 0 ? (
          <EmptyState message="No tienes tomas. Agrégalas en Ajustes → Suplementos." />
        ) : (
          <View style={styles.lista}>
            {data.tomas.map((toma, index) => (
              <Pressable
                key={toma.supplement}
                onPress={() => void alternar(toma.supplement)}
                style={({ pressed }) => [styles.fila, index === 0 && styles.filaPrimera, pressed && styles.filaPresionada]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: toma.hecho }}
              >
                {toma.hecho ? (
                  <Check size={20} color={colors.exito} strokeWidth={2.5} />
                ) : (
                  <Circle size={20} color={colors.paloRosa} strokeWidth={2} />
                )}
                <View style={styles.textos}>
                  <Text style={[styles.nombre, toma.hecho && styles.hecho]} numberOfLines={1}>
                    {toma.nombre}
                  </Text>
                  {/* El check es "ya la tomé", no "la acepto": pendiente dice
                      qué hacer, marcada dice a qué hora, sin tachar. */}
                  <Text style={[styles.detalle, toma.hecho && styles.hecho]} numberOfLines={1}>
                    {toma.hecho ? renglonToma(toma) : `${lineaToma(toma)} · tócalo al tomarlo`}
                  </Text>
                </View>
                {index === 0 && (
                  <InfoTip titulo="Tus tomas">
                    <TextoInfo>{AYUDA_TOMAS}.</TextoInfo>
                  </InfoTip>
                )}
              </Pressable>
            ))}
          </View>
        )}
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
    sub: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
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
    hecho: { color: colors.exito },
    detalle: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
  });
