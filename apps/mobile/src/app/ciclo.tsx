import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Hoja } from "@/components/Hoja";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { NumberStepper } from "@/components/NumberStepper";
import { Parrafo } from "@/components/Parrafo";
import { ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import { ApiError, getCiclo, putCiclo, type CicloResponse } from "@/lib/api";
import { diasRecientes, etiquetaDeDia } from "@/lib/ciclo";
import { todayISO } from "@/lib/streak";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";

/**
 * Tu ciclo — el seguimiento opcional del periodo.
 *
 * Un toque registra "hoy empezó mi periodo" (o elige el día, si fue antes).
 * Con eso la app estima la fase por calendario y la considera: en los días
 * del periodo la sesión ofrece una versión ligera si hay molestias; en la
 * lútea, Nutrición da un margen de calorías y más agua; y la cinta de esas
 * semanas no cuenta como estancamiento. Nada se impone.
 *
 * Es una estimación de calendario: nunca diagnóstico ni anticoncepción.
 */
export default function CicloScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<CicloResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [eligiendoDia, setEligiendoDia] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setData(await getCiclo());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cargar tu ciclo");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void cargar();
    }, [cargar]),
  );

  async function guardar(cambio: Parameters<typeof putCiclo>[0]) {
    if (guardando) return;
    setGuardando(true);
    try {
      setData(await putCiclo(cambio));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  if (!data && !error) return <LoadingState label="Cargando tu ciclo..." />;
  if (!data && error) return <ErrorState message={error} onRetry={() => void cargar()} />;
  if (!data) return null;

  const hoy = todayISO();

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.backText}>Atrás</Text>
        </Pressable>

        <View style={styles.tituloFila}>
          <Text style={styles.title}>Tu ciclo</Text>
          <InfoTip titulo="Cómo lo usa la app">
            <TextoInfo>
              En los días de tu periodo, la sesión te ofrece una versión ligera si tienes molestias. En la fase
              lútea, Nutrición te da un margen de ~120 kcal y más agua, y la cinta de esas semanas no cuenta como
              estancamiento. En la folicular y la ovulación no cambia nada. {data.nota}
            </TextoInfo>
          </InfoTip>
        </View>

        <View style={styles.tarjeta}>
          <View style={styles.fila}>
            <Text style={styles.filaTexto}>Seguir mi ciclo</Text>
            <Switch
              value={data.activo}
              disabled={guardando}
              onValueChange={(activo) => void guardar({ activo })}
              trackColor={{ true: colors.guinda, false: colors.cardBorder }}
            />
          </View>
          {!data.activo && <Parrafo style={styles.nota}>{data.notaActivar}</Parrafo>}
        </View>

        {data.ajuste && (
          <View style={styles.tarjeta}>
            <Text style={styles.fase}>{data.ajuste.linea}</Text>
            <Parrafo style={styles.nota}>{data.ajuste.entrenamiento.texto}</Parrafo>
            {data.ajuste.nutricion && <Parrafo style={styles.nota}>{data.ajuste.nutricion.texto}</Parrafo>}
            {data.ajuste.desactualizado && (
              <Parrafo style={styles.aviso}>
                Tu último periodo registrado ya tiene dos ciclos encima: actualízalo para que la estimación sirva.
              </Parrafo>
            )}
          </View>
        )}

        <Pressable
          onPress={() => void guardar({ ultimoPeriodo: hoy })}
          disabled={guardando}
          style={({ pressed }) => [styles.boton, (pressed || guardando) && styles.botonOff]}
          accessibilityRole="button"
        >
          <Text style={styles.botonTexto}>
            {data.ultimoPeriodo === hoy ? "Registrado: hoy empezó tu periodo" : "Hoy empezó mi periodo"}
          </Text>
        </Pressable>
        <Pressable onPress={() => setEligiendoDia(true)} hitSlop={8} style={styles.enlace}>
          <Text style={styles.enlaceTexto}>
            {data.ultimoPeriodo
              ? `Último: ${etiquetaDeDia(data.ultimoPeriodo, hoy)} · cambiar el día`
              : "Empezó otro día"}
          </Text>
        </Pressable>

        {data.activo && (
          <View style={styles.tarjeta}>
            <NumberStepper
              label="Duración típica del ciclo"
              value={data.duracion}
              min={data.rango.min}
              suffix="días"
              onChange={(duracion) => {
                if (duracion > data.rango.max) return;
                void guardar({ duracion });
              }}
            />
          </View>
        )}

        {error && <Parrafo style={styles.aviso}>{error}</Parrafo>}
      </ScrollView>

      <Hoja visible={eligiendoDia} onClose={() => setEligiendoDia(false)} titulo="¿Qué día empezó?">
        {diasRecientes(hoy, 21).map((dia) => (
          <Pressable
            key={dia}
            style={({ pressed }) => [styles.hojaOpcion, pressed && styles.hojaOpcionOn]}
            onPress={() => {
              setEligiendoDia(false);
              void guardar({ ultimoPeriodo: dia });
            }}
          >
            <Text style={styles.hojaTexto}>{etiquetaDeDia(dia, hoy)}</Text>
          </Pressable>
        ))}
      </Hoja>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.obsidiana },
    content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.md },
    back: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: spacing.sm, alignSelf: "flex-start" },
    backText: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
    tituloFila: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    title: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    tarjeta: {
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    fila: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
    filaTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.marfil },
    fase: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.champan },
    nota: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
    aviso: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.error },
    boton: {
      paddingVertical: spacing.md,
      borderRadius: 999,
      backgroundColor: colors.guinda,
      borderWidth: 1,
      borderColor: colors.guindaLight,
      alignItems: "center",
    },
    botonOff: { opacity: 0.6 },
    botonTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.pergamino },
    enlace: { alignSelf: "center", paddingVertical: spacing.xs },
    enlaceTexto: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.paloRosa },
    hojaOpcion: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md },
    hojaOpcionOn: { backgroundColor: withAlpha(colors.paloRosa, 0.08) },
    hojaTexto: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.marfil },
  });
