import { useLocalSearchParams, useRouter } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Parrafo } from "@/components/Parrafo";
import { ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import type { SessionExerciseView, WeekView } from "@/lib/api";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";
import { getCachedWeek } from "@/lib/training-db";
import { isVideoDownloaded, localVideoFile } from "@/lib/video-downloads";

/**
 * "Ver técnica": el video del ejercicio que se está haciendo AHORA.
 *
 * EL PROBLEMA: en media sesión, con la duda de si la espalda va así, la única
 * forma de ver el video era salir a Biblioteca, buscar el ejercicio y volver —
 * y volver significaba reabrir la sesión. Aquí es un toque desde la serie en
 * curso y `router.back()` para regresar, con el cursor y el descanso intactos:
 * la sesión en vivo guarda dónde vas en cada movimiento (`guardaSesionEnCurso`)
 * y lo recupera al montar.
 *
 * Hoja propia y no un modal dentro de la sesión: nada se abre hacia abajo.
 *
 * El ejercicio se busca en la semana CACHEADA, igual que la sesión en vivo: en
 * el gimnasio del sótano no hay señal, y el video descargado se reproduce del
 * teléfono.
 */
export default function TecnicaScreen() {
  const { workoutId, indice } = useLocalSearchParams<{ workoutId: string; indice: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [ejercicio, setEjercicio] = useState<SessionExerciseView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const semana: WeekView | null = await getCachedWeek(mondayISO());
      const sesion = semana?.sessions.find((entrada) => entrada.workoutId === workoutId);
      const encontrado = sesion?.exercises[Number(indice)];
      if (!encontrado) {
        setError("Ese ejercicio no está en el teléfono.");
        return;
      }
      setEjercicio(encontrado);
    } catch {
      setError("No se pudo abrir el video.");
    }
  }, [workoutId, indice]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const descargado = ejercicio?.videoPath ? isVideoDownloaded(ejercicio.videoPath) : false;
  const uri = ejercicio?.videoPath
    ? descargado
      ? localVideoFile(ejercicio.videoPath).uri
      : ejercicio.videoUrl
    : null;

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.backText}>Volver a la serie</Text>
        </Pressable>

        {!ejercicio && !error && <LoadingState label="Buscando el video..." />}
        {!ejercicio && error && <ErrorState message={error} onRetry={() => void cargar()} />}

        {ejercicio && (
          <>
            <Text style={styles.title}>{ejercicio.name}</Text>
            {uri ? (
              <Reproductor uri={uri} />
            ) : (
              <Parrafo style={styles.sinVideo}>
                Este ejercicio todavía no tiene video. Está en la lista.
              </Parrafo>
            )}
            {ejercicio.note && <Parrafo style={styles.nota}>{ejercicio.note}</Parrafo>}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Reproductor({ uri }: { uri: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const player = useVideoPlayer(uri, (instance) => {
    // Arranca solo y en bucle: quien abre la técnica a media serie quiere
    // verla dos o tres veces sin tocar nada con las manos ocupadas.
    instance.loop = true;
    instance.play();
  });

  return <VideoView style={styles.video} player={player} nativeControls contentFit="contain" />;
}

/** Lunes de esta semana: la llave del cache, igual que en la sesión en vivo. */
function mondayISO(): string {
  const ahora = new Date();
  const dia = ahora.getDay() || 7;
  ahora.setDate(ahora.getDate() - (dia - 1));
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  return `${ahora.getFullYear()}-${mes}-${String(ahora.getDate()).padStart(2, "0")}`;
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.obsidiana },
    content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.huge },
    back: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      paddingVertical: spacing.sm,
      alignSelf: "flex-start",
    },
    backText: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
    title: { fontFamily: fonts.display, ...typeScale.heading, color: colors.marfil },
    video: { width: "100%", aspectRatio: 16 / 9, borderRadius: radius.md },
    sinVideo: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosaLight },
    nota: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.champan },
  });
