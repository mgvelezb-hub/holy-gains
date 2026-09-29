import { useLocalSearchParams, useRouter } from "expo-router";
import { Check, ChevronLeft } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CorredorCardio, type ResultadoCardio } from "@/components/CorredorCardio";
import { Parrafo } from "@/components/Parrafo";
import { ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import { getTrainingWeek, type OtherSessionView } from "@/lib/api";
import { cardioDeLaFecha, lunesDe } from "@/lib/cardio";
import { leeCardioDelDia } from "@/lib/cardio-en-curso";
import { todayISO } from "@/lib/streak";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";
import { getCachedWeek } from "@/lib/training-db";

/**
 * El cardio en vivo por su cuenta (N2): el mismo `CorredorCardio` que corre
 * al cerrar las pesas, sin tener que pasar por ellas. `fecha` es el día del
 * plan (de dónde sale la tabla); lo corrido se registra HOY, que es cuando
 * de verdad se hizo.
 *
 * "Salir" no pierde nada: el cursor queda en el teléfono y volver a entrar
 * retoma el tramo donde iba (o el siguiente, si ya venció).
 */
export default function CardioEnVivoScreen() {
  const { fecha: fechaParam } = useLocalSearchParams<{ fecha?: string }>();
  const fecha = fechaParam ?? todayISO();
  const hoy = useMemo(() => todayISO(), []);
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [cardio, setCardio] = useState<OtherSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoCardio | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const semana = await getCachedWeek(lunesDe(fecha)).catch(() => null);
      const encontrado =
        cardioDeLaFecha(semana?.otherSessions, fecha) ??
        cardioDeLaFecha((await getTrainingWeek(fecha)).otherSessions, fecha);
      if (!encontrado) {
        setError("Ese cardio no está en el teléfono. Abre Rutinas una vez con señal.");
        return;
      }
      // P1b: si en la hoja se cambió la máquina o la modalidad de hoy, corre ESA tabla.
      const elegido = await leeCardioDelDia(fecha);
      setCardio(elegido ? { ...encontrado, minutes: elegido.minutes, sesion: elegido.sesion } : encontrado);
    } catch {
      setError("No se pudo abrir el cardio.");
    }
  }, [fecha]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (error) return <ErrorState message={error} onRetry={() => void cargar()} />;
  if (!cardio?.sesion?.cardio) return <LoadingState label="Preparando tu cardio..." />;

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.barra}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.salir} accessibilityRole="button">
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.salirTexto}>Salir</Text>
        </Pressable>
      </View>

      {resultado ? (
        <View style={styles.fin}>
          <Text style={styles.finTitulo}>{resultado.registrado ? "Cardio hecho" : "Cardio terminado"}</Text>
          <Parrafo style={styles.finTexto}>{resultado.mensaje}</Parrafo>
          <Pressable onPress={() => router.back()} style={styles.boton} accessibilityRole="button">
            <Check size={22} color={colors.pergamino} strokeWidth={2.5} />
            <Text style={styles.botonTexto}>Listo</Text>
          </Pressable>
        </View>
      ) : (
        <CorredorCardio
          detalle={cardio.sesion.cardio}
          minutos={cardio.minutes}
          fecha={hoy}
          onTerminado={setResultado}
          soltarReloj
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.obsidiana },
    barra: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    salir: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start", minHeight: 44 },
    salirTexto: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
    fin: { padding: spacing.lg, gap: spacing.lg },
    finTitulo: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    finTexto: { fontFamily: fonts.sans, ...typeScale.body, color: colors.paloRosa },
    boton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: colors.guinda,
      borderWidth: 1,
      borderColor: colors.guindaLight,
      borderRadius: radius.xxl,
      paddingVertical: spacing.xl,
    },
    botonTexto: { fontFamily: fonts.sansBold, ...typeScale.heading, color: colors.pergamino },
  });
