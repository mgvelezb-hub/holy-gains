import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Check, ChevronLeft, PlayCircle, RotateCcw } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { ProtocoloHiit } from "@/components/ProtocoloHiit";
import { ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import { getActivities, getTrainingWeek, type OtherSessionView, type UnidadVelocidad, type WeekView } from "@/lib/api";
import {
  cardioDeLaFecha,
  hayPesasPendientes,
  lunesDe,
  minutosDeCardioHechos,
  pasosDeCardio,
  tituloTarjetaCardio,
} from "@/lib/cardio";
import { leeCardioEnCurso, leeCardioHecho } from "@/lib/cardio-en-curso";
import { CAMINATA_SUAVE_KMH, protocoloDe, textoVelocidad, tituloProtocolo, unidadDe } from "@/lib/hiit";
import { todayISO } from "@/lib/streak";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";
import { getCachedWeek } from "@/lib/training-db";
import { guardarUnidadVelocidad } from "@/lib/unidad-velocidad";

/**
 * La hoja del cardio (N2) — su propia pantalla, porque cada zoom abre hoja
 * nueva: "HIIT 15' · Nivel 0", el chip km/h ↔ mph, la tabla COMPLETA con
 * scroll, la caminata suave si sobra bloque y "Empezar cardio" fijo abajo.
 *
 * Antes la tabla vivía en un Modal de Rutinas que cortaba lo que pasaba del
 * 85 % y el corredor solo existía al cerrar la última serie de pesas: no
 * había cómo empezar el cardio por su cuenta. Ahora se empieza SIEMPRE; si
 * ese día aún hay pesas, se dice en una línea (va después, pero adelante).
 */
export default function CardioScreen() {
  const { fecha: fechaParam } = useLocalSearchParams<{ fecha: string }>();
  const fecha = fechaParam ?? todayISO();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [cardio, setCardio] = useState<OtherSessionView | null>(null);
  const [pesasPendientes, setPesasPendientes] = useState(false);
  const [hechoMin, setHechoMin] = useState<number | null>(null);
  const [tramoEnCurso, setTramoEnCurso] = useState<number | null>(null);
  const [unidad, setUnidad] = useState<UnidadVelocidad>("kmh");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      let semana: WeekView | null = await getCachedWeek(lunesDe(fecha)).catch(() => null);
      let encontrado = cardioDeLaFecha(semana?.otherSessions, fecha);
      if (!encontrado) {
        semana = await getTrainingWeek(fecha);
        encontrado = cardioDeLaFecha(semana.otherSessions, fecha);
      }
      if (!encontrado || !encontrado.sesion?.cardio) {
        setError("Ese cardio no está en el teléfono. Abre Rutinas una vez con señal.");
        return;
      }
      const hoy = todayISO();
      const pasos = pasosDeCardio(encontrado.sesion.cardio, encontrado.minutes);
      const [local, actividades, enCurso] = await Promise.all([
        leeCardioHecho(fecha),
        getActivities(30).catch(() => null),
        leeCardioEnCurso(hoy, pasos.length),
      ]);
      const delServidor = actividades ? minutosDeCardioHechos(actividades.actividades, fecha) : null;

      setCardio(encontrado);
      setUnidad(unidadDe(encontrado.sesion.cardio));
      setPesasPendientes(hayPesasPendientes(semana?.sessions ?? [], fecha));
      setHechoMin(delServidor ?? local);
      setTramoEnCurso(enCurso ? enCurso.paso : null);
    } catch {
      setError("No se pudo abrir el cardio.");
    } finally {
      setCargando(false);
    }
  }, [fecha]);

  // Al volver del corredor, la hoja ya dice "Hecho".
  useFocusEffect(
    useCallback(() => {
      void cargar();
    }, [cargar]),
  );

  /** Cambia la unidad en pantalla de inmediato y la guarda en las preferencias de cardio. */
  function cambiarUnidad(siguiente: UnidadVelocidad) {
    setUnidad(siguiente);
    guardarUnidadVelocidad(siguiente).catch(() => {
      // Sin señal: se ve en la unidad elegida y la próxima vez se vuelve a intentar.
    });
  }

  function empezar() {
    router.push({ pathname: "/cardio-en-vivo", params: { fecha } } as never);
  }

  if (error) return <ErrorState message={error} onRetry={() => void cargar()} />;
  if (cargando || !cardio?.sesion?.cardio) return <LoadingState label="Abriendo tu cardio..." />;

  const detalle = cardio.sesion.cardio;
  const protocolo = protocoloDe(detalle);
  const titulo = protocolo ? tituloProtocolo(protocolo) : tituloTarjetaCardio(detalle, cardio.minutes);
  const pasos = pasosDeCardio(detalle, cardio.minutes, unidad);

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.barra}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.atras}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.atrasTexto}>Atrás</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.contenido}>
        <Text style={styles.eyebrow}>
          CARDIO · {cardio.minutes} MIN{fecha === todayISO() ? " · HOY" : ""}
        </Text>
        <Text style={styles.titulo} accessibilityRole="header">
          {titulo}
        </Text>

        {pesasPendientes && hechoMin === null && (
          <View style={styles.orden}>
            <Text style={styles.ordenTexto}>Va después de pesas; si hoy lo haces antes, adelante.</Text>
            <InfoTip titulo="Por qué después de pesas">
              <TextoInfo>
                Cuando la fuerza es el objetivo, las pesas van primero: llegas con las piernas y el
                sistema nervioso frescos a lo que más pide técnica y carga, y el cardio no te roba
                repeticiones. Hacerlo antes no rompe nada; solo espera un poco menos en las series
                pesadas de pierna.
              </TextoInfo>
            </InfoTip>
          </View>
        )}

        {cardio.note ? <Text style={styles.nota}>{cardio.note}</Text> : null}

        {protocolo ? (
          <>
            <ProtocoloHiit protocolo={protocolo} unidad={unidad} onUnidad={cambiarUnidad} />
            {protocolo.caminataMin > 0 && (
              <Text style={styles.nota}>
                Al final, {protocolo.caminataMin} min de caminata suave a {textoVelocidad(CAMINATA_SUAVE_KMH, unidad)}{" "}
                para completar el bloque.
              </Text>
            )}
          </>
        ) : (
          <View style={styles.pasos}>
            {pasos.map((paso, indice) => (
              <View key={`${indice}-${paso.nombre}`} style={styles.pasoFila}>
                <Text style={styles.pasoNombre}>{paso.nombre}</Text>
                <Text style={styles.pasoTiempo}>{Math.round(paso.segundos / 60)} min</Text>
              </View>
            ))}
          </View>
        )}

        {cardio.sesion.notes.map((nota) => (
          <Text key={nota} style={styles.nota}>
            {nota}
          </Text>
        ))}
      </ScrollView>

      {/* Fijo abajo: el botón no se va con el scroll de la tabla. */}
      <View style={styles.pie}>
        {hechoMin !== null ? (
          <>
            <View style={styles.hecho} accessibilityRole="text">
              <Check size={20} color={colors.champan} strokeWidth={2.5} />
              <Text style={styles.hechoTexto}>Hecho · {hechoMin} min</Text>
            </View>
            <Pressable onPress={empezar} style={styles.secundario} accessibilityRole="button">
              <RotateCcw size={16} color={colors.champan} strokeWidth={2} />
              <Text style={styles.secundarioTexto}>Repetir</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable onPress={empezar} style={styles.principal} accessibilityRole="button">
              <PlayCircle size={22} color={colors.pergamino} strokeWidth={2.5} />
              <Text style={styles.principalTexto}>
                {tramoEnCurso !== null ? `Seguir cardio · tramo ${tramoEnCurso + 1}` : "Empezar cardio"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/actividad",
                  params: { discipline: "CARDIO", minutes: `${cardio.minutes}` },
                } as never)
              }
              style={styles.secundario}
              accessibilityRole="button"
            >
              <Text style={styles.secundarioTexto}>Ya lo hice: registrarlo a mano</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.obsidiana },
    barra: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    atras: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start", minHeight: 44 },
    atrasTexto: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
    scroll: { flex: 1 },
    contenido: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
    eyebrow: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.label,
      letterSpacing: 1.2,
      color: colors.paloRosa,
    },
    titulo: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    orden: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: withAlpha(colors.champan, 0.35),
      backgroundColor: withAlpha(colors.champan, 0.08),
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    ordenTexto: { flex: 1, fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    nota: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
    pasos: { gap: spacing.xs },
    pasoFila: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: spacing.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.cardBg,
    },
    pasoNombre: { flex: 1, fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.marfil },
    pasoTiempo: { fontFamily: fonts.sansSemiBold, ...typeScale.bodySm, color: colors.champan },
    pie: {
      gap: spacing.xs,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
      backgroundColor: colors.obsidiana,
    },
    principal: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: colors.guinda,
      borderWidth: 1,
      borderColor: colors.guindaLight,
      borderRadius: radius.xxl,
      paddingVertical: spacing.lg,
    },
    principalTexto: { fontFamily: fonts.sansBold, ...typeScale.heading, color: colors.pergamino },
    hecho: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      borderRadius: radius.xxl,
      borderWidth: 1,
      borderColor: withAlpha(colors.champan, 0.45),
      paddingVertical: spacing.lg,
    },
    hechoTexto: { fontFamily: fonts.sansBold, ...typeScale.heading, color: colors.champan },
    secundario: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      minHeight: 44,
    },
    secundarioTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.champan },
  });
