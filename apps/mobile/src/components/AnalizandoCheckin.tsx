import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { useTheme } from "@/context/theme";
import { SONDEO_MS, pasoAviso, textoAnalizando, type AvisoAnalisis } from "@/lib/analisis-checkin";
import { getDecision, postCheckinListo } from "@/lib/api";
import { aplicarAccionAviso, estadoPermisoNotificaciones } from "@/lib/recordatorio";
import { fonts, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * "Analizando tu check-in…": lo que se ve entre enviar y tener la retro.
 *
 * El aviso local ya viene programado desde el envío (`alEnviar`): irse a
 * segundo plano o salir de aquí no programa nada, porque esa cadena async es
 * justo la que iOS corta al suspender la app. Con la app en primer plano se
 * pregunta al servidor cada 5 s (`GET /decision?desde=`); `pasoAviso` decide
 * si se cancela y se abre `/decision`, o si el aviso se mueve +3 min porque
 * la retro no llegó a tiempo ("sigo con ello").
 *
 * Sin APNs no hay push de verdad (ver `programarAvisoAnalisis`): el aviso es
 * local y a ciegas, y por eso existe la verificación en cada sondeo.
 */
export function AnalizandoCheckin({
  checkInId,
  aviso: avisoInicial,
  listoPendiente,
  conFotos,
  esMensual,
}: {
  checkInId: string;
  /** El aviso que se programó al enviar (`alEnviar`). */
  aviso: AvisoAnalisis;
  /**
   * El aviso de "fotos listas" no llegó al servidor (sin señal): se reintenta
   * en cada sondeo hasta que entre una vez. Solo entonces — reintentar a
   * ciegas dispararía un segundo análisis mientras el primero corre.
   */
  listoPendiente: boolean;
  conFotos: boolean;
  esMensual: boolean;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [enRevision, setEnRevision] = useState(false);
  const [sigoConEllo, setSigoConEllo] = useState(false);
  const [avisosApagados, setAvisosApagados] = useState(false);
  const aviso = useRef(avisoInicial);
  const faltaListo = useRef(listoPendiente);

  const revisar = useCallback(async () => {
    if (aviso.current.terminado) return;
    if (faltaListo.current) {
      faltaListo.current = await postCheckinListo(checkInId).then(
        () => false,
        () => true,
      );
    }
    try {
      const respuesta = await getDecision(checkInId);
      if (respuesta.enRevisionHumana) {
        // Espera a su coach humano: ni sondeo ni aviso — la IA no es quien
        // la va a publicar, y prometer "te aviso" sería mentir.
        const paso = pasoAviso(aviso.current, { tipo: "revisionHumana" });
        aviso.current = paso.aviso;
        setEnRevision(true);
        await aplicarAccionAviso(paso.accion);
        return;
      }

      const paso = pasoAviso(aviso.current, { tipo: "sondeo", estado: respuesta.estado, ahora: Date.now() });
      aviso.current = paso.aviso;
      setSigoConEllo(paso.aviso.sigoConEllo);
      await aplicarAccionAviso(paso.accion);
      if (paso.navegar) router.replace("/decision");
    } catch {
      // Sin señal se vuelve a intentar en el siguiente sondeo.
    }
  }, [checkInId, router]);

  useEffect(() => {
    // Sin permiso el "te aviso" es mentira: se dice, y se da la salida. Se
    // vuelve a mirar al regresar, por si lo activó en Ajustes.
    const mirar = () =>
      void estadoPermisoNotificaciones().then((permiso) => setAvisosApagados(permiso === "negado"));
    mirar();
    const sub = AppState.addEventListener("change", (estado) => {
      if (estado === "active") mirar();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    void revisar();

    let intervalo: ReturnType<typeof setInterval> | null =
      AppState.currentState === "active" ? setInterval(() => void revisar(), SONDEO_MS) : null;

    const sub = AppState.addEventListener("change", (estado) => {
      if (estado === "active") {
        void revisar();
        if (intervalo === null && !aviso.current.terminado) {
          intervalo = setInterval(() => void revisar(), SONDEO_MS);
        }
        return;
      }
      if (estado === "background") {
        if (intervalo !== null) clearInterval(intervalo);
        intervalo = null;
      }
    });

    return () => {
      if (intervalo !== null) clearInterval(intervalo);
      sub.remove();
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
      {sigoConEllo ? <Text style={styles.nota}>Tarda más de lo normal; sigo con ello.</Text> : null}
      {avisosApagados ? (
        <Pressable onPress={() => void Linking.openSettings()} hitSlop={10} accessibilityRole="link">
          <Text style={styles.enlace}>Tus avisos están apagados · Actívalos en Ajustes</Text>
        </Pressable>
      ) : null}
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
    enlace: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.bodySm,
      color: colors.champan,
      textAlign: "center",
    },
    nota: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.paloRosa,
      textAlign: "center",
    },
  });
