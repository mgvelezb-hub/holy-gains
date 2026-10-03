import { useFocusEffect, useRouter } from "expo-router";
import { Check, ChevronLeft, Circle, Clock } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Hoja } from "@/components/Hoja";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import { ApiError, getSuplementos, postLogSuplemento, type SuplementosResponse, type TomaDelDia } from "@/lib/api";
import { refrescarAvisosDeComida } from "@/lib/avisos-comida";
import { lineaToma } from "@/lib/suplementos";
import { AYUDA_TOMAS, alternaToma, lineaTomada } from "@/lib/tomas-comida";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";

/** Cada cuarto de hora de hoy, del más reciente al de las 4:00: "¿a qué hora te la tomaste?". */
function horasHastaAhora(ahora: Date): string[] {
  const salida: string[] = [];
  const tope = ahora.getHours() * 60 + ahora.getMinutes();
  for (let minutos = Math.floor(tope / 15) * 15; minutos >= 4 * 60; minutos -= 15) {
    salida.push(`${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`);
  }
  return salida;
}

/** Lo que dice el renglón sin marcar: la hora sugerida, o la pauta en servidores viejos. */
function detallePendiente(toma: TomaDelDia): string {
  return toma.sugerencia ?? lineaToma(toma);
}

/**
 * Suplementos de hoy: una línea por toma, en el orden del día, con su hora
 * sugerida (de los horarios de comida y de entreno; sugerencia, no regla).
 * Un toque la marca como tomada ahora y otro la desmarca; el reloj permite
 * decir a qué hora se tomó. Marcar reprograma los avisos de comida: lo ya
 * tomado deja de recordarse en el "Prepárate" que sigue.
 *
 * El porqué y la evidencia viven en Ajustes → Suplementos. Esta hoja es para
 * el momento de tomarla.
 */
export default function SuplementosHoyScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<SuplementosResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eligiendoHora, setEligiendoHora] = useState<TomaDelDia | null>(null);

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

  async function registrar(supplement: string, taken: boolean, takenAt?: Date) {
    if (!data) return;
    const anterior = data;
    const tomas = data.tomas.map((t) => {
      if (t.supplement !== supplement) return t;
      if (!taken) return alternaToma([t], supplement)[0]!;
      return { ...t, hecho: true, hechaA: (takenAt ?? new Date()).toISOString() };
    });
    const hechas = tomas.filter((t) => t.hecho).length;
    setData({ ...data, tomas, resumen: { ...data.resumen, hechas } });
    try {
      await postLogSuplemento(data.hoy, supplement, taken, takenAt?.toISOString());
      void refrescarAvisosDeComida(tomas);
    } catch {
      // Sin red la marca se revierte: una toma marcada que no se guardó
      // mentiría en el conteo de mañana.
      setData(anterior);
    }
  }

  function alternar(toma: TomaDelDia) {
    void registrar(toma.supplement, !toma.hecho);
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
        <Text style={styles.title}>Suplementos de hoy</Text>
        <Text style={styles.sub}>
          {hechas} de {data.tomas.length}
        </Text>

        {data.tomas.length === 0 ? (
          <EmptyState message="No tienes tomas. Agrégalas en Ajustes → Suplementos." />
        ) : (
          <View style={styles.lista}>
            {data.tomas.map((toma, index) => (
              <View
                key={toma.supplement}
                style={[styles.fila, index === 0 && styles.filaPrimera]}
              >
                <Pressable
                  onPress={() => alternar(toma)}
                  style={({ pressed }) => [styles.filaToque, pressed && styles.filaPresionada]}
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
                      {toma.nombre} · {toma.dosis}
                    </Text>
                    {/* El check es "ya la tomé", no "la acepto": pendiente dice
                        la hora sugerida, marcada dice a qué hora, sin tachar. */}
                    <Text style={[styles.detalle, toma.hecho && styles.hecho]} numberOfLines={1}>
                      {toma.hecho ? lineaTomada(toma) : detallePendiente(toma)}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => setEligiendoHora(toma)}
                  hitSlop={8}
                  style={styles.reloj}
                  accessibilityRole="button"
                  accessibilityLabel={`Elegir a qué hora tomaste ${toma.nombre}`}
                >
                  <Clock size={18} color={colors.paloRosa} strokeWidth={2} />
                </Pressable>
                {index === 0 && (
                  <InfoTip titulo="Tus suplementos">
                    <TextoInfo>{AYUDA_TOMAS}.</TextoInfo>
                  </InfoTip>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Hoja
        visible={eligiendoHora !== null}
        onClose={() => setEligiendoHora(null)}
        titulo={eligiendoHora ? `¿A qué hora tomaste ${eligiendoHora.corto}?` : undefined}
        contenidoStyle={styles.hojaLista}
      >
        {horasHastaAhora(new Date()).map((hora) => (
          <Pressable
            key={hora}
            style={({ pressed }) => [styles.hojaOpcion, pressed && styles.filaPresionada]}
            onPress={() => {
              const toma = eligiendoHora;
              setEligiendoHora(null);
              if (!toma) return;
              const [h, m] = hora.split(":").map(Number);
              const fecha = new Date();
              fecha.setHours(h!, m!, 0, 0);
              void registrar(toma.supplement, true, fecha);
            }}
          >
            <Text style={styles.hojaHora}>{hora}</Text>
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
      gap: spacing.sm,
      paddingRight: spacing.lg,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    filaToque: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingLeft: spacing.lg,
    },
    reloj: { minWidth: 36, minHeight: 36, alignItems: "center", justifyContent: "center" },
    hojaLista: { gap: 0 },
    hojaOpcion: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md },
    hojaHora: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.marfil },
    filaPrimera: { borderTopWidth: 0 },
    filaPresionada: { backgroundColor: withAlpha(colors.paloRosa, 0.08) },
    textos: { flex: 1, gap: 1 },
    nombre: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.marfil },
    hecho: { color: colors.exito },
    detalle: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
  });
