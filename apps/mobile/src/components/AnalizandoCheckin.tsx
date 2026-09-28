import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { useTheme } from "@/context/theme";
import { AVISO_ANALISIS_SEGUNDOS, SONDEO_MS, alVolver, textoAnalizando } from "@/lib/analisis-checkin";
import { getDecision } from "@/lib/api";
import { cancelarAvisoAnalisis, pedirPermisoNotificaciones, programarAvisoAnalisis } from "@/lib/recordatorio";
import { fonts, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * "Analizando tu check-in…": lo que se ve entre enviar y tener la retro.
 *
 * Con la app en primer plano pregunta al servidor cada 5 s
 * (`GET /decision?desde=`) y en cuanto está, abre `/decision`. Si la persona
 * se va a otra app antes, se programa un aviso local a 3 min; al volver se
 * verifica: si ya está, se cancela el aviso y se navega; si no, se sigue
 * preguntando. Salir de esta pantalla sin que esté lista también deja el
 * aviso programado: la promesa es "te aviso", no "espera aquí".
 *
 * Sin APNs no hay push de verdad (ver `programarAvisoAnalisis`): el aviso es
 * local y a ciegas, y por eso existe la verificación al volver.
 */
export function AnalizandoCheckin({
  checkInId,
  conFotos,
  esMensual,
}: {
  checkInId: string;
  conFotos: boolean;
  esMensual: boolean;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [enRevision, setEnRevision] = useState(false);
  const terminado = useRef(false);

  const revisar = useCallback(async () => {
    if (terminado.current) return;
    try {
      const respuesta = await getDecision(checkInId);
      if (respuesta.enRevisionHumana) {
        // Espera a su coach humano: ni sondeo ni aviso — la IA no es quien
        // la va a publicar, y prometer "te aviso" sería mentir.
        terminado.current = true;
        setEnRevision(true);
        await cancelarAvisoAnalisis();
        return;
      }

      const paso = alVolver(respuesta.estado);
      if (paso.cancelarAviso) await cancelarAvisoAnalisis();
      if (paso.navegar) {
        terminado.current = true;
        router.replace("/decision");
      }
    } catch {
      // Sin señal se vuelve a intentar en el siguiente sondeo.
    }
  }, [checkInId, router]);

  useEffect(() => {
    // El permiso se pide aquí, en primer plano: al irse a segundo plano iOS
    // ya no puede mostrar el diálogo.
    void pedirPermisoNotificaciones();
    void revisar();

    let intervalo: ReturnType<typeof setInterval> | null =
      AppState.currentState === "active" ? setInterval(() => void revisar(), SONDEO_MS) : null;

    const sub = AppState.addEventListener("change", (estado) => {
      if (estado === "active") {
        void revisar();
        if (intervalo === null && !terminado.current) {
          intervalo = setInterval(() => void revisar(), SONDEO_MS);
        }
        return;
      }
      if (estado === "background") {
        if (intervalo !== null) clearInterval(intervalo);
        intervalo = null;
        if (!terminado.current) void programarAvisoAnalisis(AVISO_ANALISIS_SEGUNDOS);
      }
    });

    return () => {
      if (intervalo !== null) clearInterval(intervalo);
      sub.remove();
      if (!terminado.current) void programarAvisoAnalisis(AVISO_ANALISIS_SEGUNDOS);
    };
  }, [revisar]);

  if (enRevision) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Check-in recibido</Text>
        <Text style={styles.message}>
          Tu coach revisa tus números antes de publicar tu retroalimentación. La verás en Hoy en
          cuanto la apruebe.
        </Text>
        <PrimaryButton label="Volver a Hoy" onPress={() => router.replace("/")} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ActivityIndicator size="large" color={colors.champan} />
      <Text style={styles.title}>Analizando tu check-in…</Text>
      <Text style={styles.message}>{textoAnalizando({ conFotos, esMensual })}</Text>
      <PrimaryButton label="Volver a Hoy" onPress={() => router.replace("/")} />
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.obsidiana,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.xxl,
      gap: spacing.xl,
    },
    title: {
      fontFamily: fonts.display,
      ...typeScale.title,
      color: colors.champan,
      textAlign: "center",
    },
    message: {
      fontFamily: fonts.serifItalic,
      ...typeScale.subheading,
      color: colors.marfil,
      textAlign: "center",
      lineHeight: 24,
    },
  });
