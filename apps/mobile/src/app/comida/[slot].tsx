import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Clock } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Hoja } from "@/components/Hoja";
import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { TomasDeLaComida, useTomasDeHoy } from "@/components/TomasDelDia";
import { useTheme } from "@/context/theme";
import {
  ApiError,
  getComidasLogRango,
  postComidaLogCompleto,
  MOTIVOS_SALTO,
  MOTIVO_SALTO_LABEL,
  type MotivoSalto,
  type MenuMeal,
  type RegistroComidaCompleto,
} from "@/lib/api";
import { getPlanNutricion } from "@/lib/api-nutricion";
import { comidaDeHoy } from "@/lib/comidas-hoy";
import { todayISO } from "@/lib/streak";
import { tomasDeComida } from "@/lib/tomas-comida";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";

/** Las horas que ofrece "Comí a las…": mismo rango que el selector de horarios. */
const HORAS: string[] = (() => {
  const salida: string[] = [];
  for (let minutos = 4 * 60; minutos <= 23 * 60 + 45; minutos += 15) {
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    salida.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return salida;
})();

/** "HH:MM" de un instante, en hora local. */
function horaLocal(fecha: Date): string {
  return `${String(fecha.getHours()).padStart(2, "0")}:${String(fecha.getMinutes()).padStart(2, "0")}`;
}

/**
 * Hoja de una comida — `/comida/[slot]`.
 *
 * A dónde llegan tanto el botón "Ver menú"/"Comí a otra hora"/"La salté" del
 * recordatorio en dos tiempos (`lib/recordatorio.ts`) como cada tarjeta de
 * "Mis comidas hoy" (`comida-hoy.tsx`). Editable el mismo día: tocar de
 * nuevo cualquiera de las tres opciones reescribe el registro, no lo duplica
 * (mismo upsert por fecha+slot de siempre).
 */
export default function ComidaSlotScreen() {
  const router = useRouter();
  const { slot } = useLocalSearchParams<{ slot: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [meal, setMeal] = useState<MenuMeal | null>(null);
  // La hora que rige hoy esa comida (horario por día), no la general del menú.
  const [hora, setHora] = useState<string | null>(null);
  const [registro, setRegistro] = useState<RegistroComidaCompleto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [eligiendoHora, setEligiendoHora] = useState(false);
  // Los suplementos de esta comida, como renglones del menú con su check.
  const { tomas, cargar: cargarTomas, alternar: alternarToma } = useTomasDeHoy();

  const load = useCallback(async () => {
    if (!slot) return;
    try {
      const hoy = todayISO();
      const [plan, comidas] = await Promise.all([getPlanNutricion(), getComidasLogRango({ from: hoy, to: hoy })]);
      // El menú que se come HOY y su hora de hoy, del plan canónico.
      const deHoy = comidaDeHoy(plan, slot);
      setMeal(deHoy.meal);
      setHora(deHoy.hora);
      setRegistro(comidas.registros.find((r) => r.date === hoy && r.slot === slot) ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cargar tu comida");
    }
  }, [slot]);

  useFocusEffect(
    useCallback(() => {
      void load();
      void cargarTomas();
    }, [load, cargarTomas]),
  );

  async function guardar(input: { taken: boolean; takenAt?: string; skipped?: MotivoSalto }) {
    if (!slot || guardando) return;
    setGuardando(true);
    setEligiendoHora(false);
    try {
      const { registro: nuevo } = await postComidaLogCompleto({
        date: todayISO(),
        slot,
        plannedAt: hora ?? meal?.timeHint,
        ...input,
      });
      setRegistro(nuevo);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  if (!meal && !error) return <LoadingState label="Cargando tu comida..." />;
  if (!meal && error) return <ErrorState message={error} onRetry={load} />;

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.backText}>Atrás</Text>
        </Pressable>

        {meal && (
          <>
            <Text style={styles.title}>
              {meal.label} · {hora ?? meal.timeHint}
            </Text>

            <Text style={styles.estado}>
              {registro === null
                ? "Sin registrar todavía"
                : registro.skipped
                  ? `La saltaste: ${MOTIVO_SALTO_LABEL[registro.skipped]}`
                  : registro.taken
                    ? `Confirmada${registro.takenAt ? ` a las ${horaLocal(new Date(registro.takenAt))}` : ""}`
                    : "Marcada como no hecha"}
            </Text>

            <View style={styles.acciones}>
              <Pressable
                style={[styles.boton, styles.botonPrimario]}
                disabled={guardando}
                onPress={() => guardar({ taken: true, takenAt: new Date().toISOString() })}
              >
                <Text style={styles.botonPrimarioTexto}>Ya comí</Text>
              </Pressable>

              <Pressable style={styles.boton} disabled={guardando} onPress={() => setEligiendoHora(true)}>
                <Clock size={14} color={colors.champan} strokeWidth={2} />
                <Text style={styles.botonTexto}>Comí a las…</Text>
              </Pressable>
            </View>

            <Text style={styles.subtitulo}>¿La saltaste? Di por qué</Text>
            <View style={styles.chips}>
              {MOTIVOS_SALTO.map((motivo) => (
                <Chip
                  key={motivo}
                  label={MOTIVO_SALTO_LABEL[motivo]}
                  selected={registro?.skipped === motivo}
                  onPress={() => guardar({ taken: false, skipped: motivo })}
                />
              ))}
            </View>

            {meal.items.length > 0 && (
              <Card>
                <Text style={styles.menuTitulo}>Tu menú</Text>
                {meal.items.map((item) => (
                  <Text key={item.name} style={styles.menuItem}>
                    · {item.name} {item.free ? "(libre)" : item.portion ? `— ${item.portion}` : `— ${item.grams} g`}
                  </Text>
                ))}
                <TomasDeLaComida
                  tomas={tomasDeComida(tomas, meal.slot)}
                  onToggle={(supplement) => void alternarToma(supplement)}
                  primeraDelDia={tomas[0]?.supplement}
                />
              </Card>
            )}

            {meal.items.length === 0 && <EmptyState message="Sin ingredientes cargados para esta comida." />}
          </>
        )}

        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <Hoja
        visible={eligiendoHora}
        onClose={() => setEligiendoHora(false)}
        titulo="¿A qué hora comiste?"
        contenidoStyle={styles.hojaLista}
      >
        {HORAS.map((hora) => (
          <Pressable
            key={hora}
            style={styles.hojaOpcion}
            onPress={() => {
              const [h, m] = hora.split(":").map(Number);
              const fecha = new Date();
              fecha.setHours(h!, m!, 0, 0);
              void guardar({ taken: true, takenAt: fecha.toISOString() });
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
    back: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: spacing.sm, alignSelf: "flex-start" },
    backText: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
    title: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    estado: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.pergaminoSoft },
    acciones: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
    boton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 44,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
    },
    botonPrimario: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
    botonTexto: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    botonPrimarioTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.bodySm, color: colors.pergamino },
    subtitulo: {
      fontFamily: fonts.sansMedium,
      ...typeScale.label,
      color: colors.champan,
      marginTop: spacing.md,
    },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    menuTitulo: { fontFamily: fonts.sansSemiBold, ...typeScale.bodySm, color: colors.paloRosa, marginBottom: 4 },
    menuItem: { fontFamily: fonts.sans, ...typeScale.body, color: colors.marfil },
    error: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.error, marginTop: spacing.sm },
    hojaLista: { gap: 0 },
    hojaOpcion: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md },
    hojaHora: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.marfil },
  });
