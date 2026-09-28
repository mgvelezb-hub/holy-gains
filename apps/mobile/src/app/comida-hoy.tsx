import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { RenglonToma, useTomasDeHoy } from "@/components/TomasDelDia";
import { useTheme } from "@/context/theme";
import {
  ApiError,
  getComidasLogRango,
  MOTIVO_SALTO_LABEL,
  type RegistroComidaCompleto,
} from "@/lib/api";
import { getPlanNutricion, type PlanNutricion } from "@/lib/api-nutricion";
import { filasDeHoy } from "@/lib/comidas-hoy";
import { todayISO } from "@/lib/streak";
import { sufijoTomas, tomasDeComida, tomasSueltas } from "@/lib/tomas-comida";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";

/** "HH:MM" de un ISO completo, en hora local. */
function horaLocal(iso: string): string {
  const fecha = new Date(iso);
  return `${String(fecha.getHours()).padStart(2, "0")}:${String(fecha.getMinutes()).padStart(2, "0")}`;
}

/** "✓ 15:10" / "la saltaste: sin tiempo" / "pendiente", según lo que diga el registro de hoy. */
function estadoDe(registro: RegistroComidaCompleto | undefined): string {
  if (!registro) return "pendiente";
  if (registro.skipped) return `saltada: ${MOTIVO_SALTO_LABEL[registro.skipped]}`;
  if (registro.taken) return `✓${registro.takenAt ? ` ${horaLocal(registro.takenAt)}` : ""}`;
  return "no la hizo";
}

/**
 * "Mis comidas hoy": una tarjeta de una línea por comida del menú vigente.
 *
 * Tocar una tarjeta abre `/comida/[slot]` — ahí vive la edición (hora real,
 * motivo del salto, el menú de ese slot). Aquí solo se lee el estado, igual
 * que pide la LEY DE DISEÑO: nada se abre hacia abajo, cada zoom-in es su
 * propia hoja.
 */
export default function ComidaHoyScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // El plan canónico: `hoy.comidas` ya es el menú del día con la hora que
  // rige HOY (no la general del menú 1).
  const [nutrition, setNutrition] = useState<PlanNutricion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [registros, setRegistros] = useState<Record<string, RegistroComidaCompleto>>({});
  // Los suplementos del día: los de cada comida se anuncian en su tarjeta y
  // se marcan en su hoja; los que no van con comida salen aquí abajo.
  const { tomas, cargar: cargarTomas, alternar: alternarToma } = useTomasDeHoy();

  const load = useCallback(async () => {
    try {
      const hoy = todayISO();
      const [nutritionRes, comidasRes] = await Promise.all([
        getPlanNutricion(),
        getComidasLogRango({ from: hoy, to: hoy }).catch(() => null),
      ]);
      setNutrition(nutritionRes);
      if (comidasRes) {
        setRegistros(Object.fromEntries(comidasRes.registros.map((registro) => [registro.slot, registro])));
      }
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cargar tu comida de hoy");
    }
  }, []);

  // Al enfocar, no solo al montar: volver de `/comida/[slot]` con un
  // registro nuevo tiene que verse aquí sin jalar para refrescar.
  useFocusEffect(
    useCallback(() => {
      void load();
      void cargarTomas();
    }, [load, cargarTomas]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await Promise.all([load(), cargarTomas()]);
    setRefreshing(false);
  }

  if (!nutrition && !error) return <LoadingState label="Cargando tu comida..." />;
  if (!nutrition && error) return <ErrorState message={error} onRetry={load} />;
  if (!nutrition) return null;

  const filas = filasDeHoy(nutrition);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.paloRosa} />
        }
      >
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.backText}>Atrás</Text>
        </Pressable>

        <Text style={styles.title}>Tu comida de hoy</Text>

        {filas.length === 0 ? (
          <EmptyState message="Tu menú se sirve en cuanto tu coach publique tu decisión." />
        ) : (
          <View style={styles.lista}>
            {filas.map((meal) => (
              <Pressable
                key={meal.slot}
                style={styles.fila}
                onPress={() => router.push(`/comida/${meal.slot}` as never)}
              >
                <Text style={styles.filaTexto} numberOfLines={1}>
                  {meal.label} · {meal.hora} · {estadoDe(registros[meal.slot])}
                  {sufijoTomas(tomasDeComida(tomas, meal.slot))
                    ? ` · ${sufijoTomas(tomasDeComida(tomas, meal.slot))}`
                    : ""}
                </Text>
                <ChevronRight size={16} color={colors.paloRosa} strokeWidth={2} />
              </Pressable>
            ))}
          </View>
        )}

        {/* Lo que no va con una comida (dormir, antes de entrenar): su
            propio bloque, con su momento, y se marca aquí mismo. */}
        {tomasSueltas(tomas).length > 0 && (
          <View style={styles.sueltas}>
            <Text style={styles.sueltasTitulo}>Fuera de las comidas</Text>
            {tomasSueltas(tomas).map((toma) => (
              <RenglonToma
                key={toma.supplement}
                toma={toma}
                conCuando
                onToggle={(supplement) => void alternarToma(supplement)}
              />
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
    content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.sm },
    back: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      paddingVertical: spacing.sm,
      alignSelf: "flex-start",
    },
    backText: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
    title: {
      fontFamily: fonts.sansBold,
      ...typeScale.title,
      color: colors.marfil,
      marginBottom: spacing.sm,
    },
    lista: { gap: spacing.xs },
    fila: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: 44,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
    },
    filaTexto: { flex: 1, fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    sueltas: {
      marginTop: spacing.md,
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
    },
    sueltasTitulo: {
      fontFamily: fonts.sansMedium,
      ...typeScale.label,
      color: colors.champan,
      paddingTop: spacing.xs,
    },
  });
