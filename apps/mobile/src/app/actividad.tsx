import { useLocalSearchParams, useRouter } from "expo-router";
import { X } from "lucide-react-native";
import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { NumberStepper } from "@/components/NumberStepper";
import { Parrafo } from "@/components/Parrafo";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SectionLabel } from "@/components/SectionLabel";
import { useTheme } from "@/context/theme";
import {
  ApiError,
  DISCIPLINES,
  DISCIPLINE_LABELS,
  postManualActivity,
  type Discipline,
} from "@/lib/api";
import { iconoDe } from "@/lib/disciplinas";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";

/**
 * Registrar una sesión de otra disciplina.
 *
 * Existe porque el modo gimnasio solo sabe de pesas serie a serie, y el reloj
 * solo ve lo que se grabó como entrenamiento en Salud. Lo demás —la bici del
 * domingo, el box, la alberca, el squash— no existía en ninguna parte y por lo
 * tanto no contaba para nada. Esto es REGISTRO, no prescripción: la app no
 * genera rutina de natación ni de box, solo deja constancia de que la sesión
 * pasó, la enseña y la cuenta en la racha de entrenamiento.
 */

/** Duraciones que cubren casi todo, para no obligar a teclear. */
const QUICK_MINUTES = [30, 45, 60, 90];

/** yyyy-MM-dd de hoy, en hora local del teléfono. */
function todayISO(offsetDays = 0): string {
  const now = new Date();
  now.setDate(now.getDate() + offsetDays);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** "hoy" / "ayer" / "martes" — etiqueta corta para los últimos 7 días. */
function dayLabel(offsetDays: number): string {
  if (offsetDays === 0) return "Hoy";
  if (offsetDays === -1) return "Ayer";
  const date = new Date(`${todayISO(offsetDays)}T12:00:00.000Z`);
  const label = WEEKDAYS[date.getUTCDay()] ?? "";
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default function ActividadScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  /**
   * Se puede llegar aquí desde la sesión planeada de Rutinas, y entonces la
   * disciplina y los minutos vienen puestos. Es la mitad que faltaba del
   * modelo de la Fase 7: la app prescribía la sesión y luego te mandaba a
   * capturarla desde cero, que es el mismo pecado que le criticamos al
   * check-in — preguntar lo que ya sabe.
   */
  const params = useLocalSearchParams<{ discipline?: string; minutes?: string }>();
  const disciplinaSugerida = (DISCIPLINES as readonly string[]).includes(params.discipline ?? "")
    ? (params.discipline as Discipline)
    : "CARDIO";
  const minutosSugeridos = Number(params.minutes);

  const [discipline, setDiscipline] = useState<Discipline>(disciplinaSugerida);
  const [durationMin, setDurationMin] = useState(
    Number.isFinite(minutosSugeridos) && minutosSugeridos > 0 ? Math.round(minutosSugeridos) : 45,
  );
  const [dayOffset, setDayOffset] = useState(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await postManualActivity({
        discipline,
        durationMin,
        date: todayISO(dayOffset),
        notes: notes || null,
      });
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo guardar tu sesión");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>Registrar sesión</Text>
            <Parrafo style={styles.subtitle}>
              Lo que hiciste fuera del gym: bici, box, alberca, funcional.
            </Parrafo>
          </View>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.close}>
            <X size={24} color={colors.paloRosa} strokeWidth={2} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.block}>
            <SectionLabel>Disciplina</SectionLabel>
            <View style={styles.grid}>
              {DISCIPLINES.map((option) => {
                const Icon = iconoDe(option);
                const selected = option === discipline;
                return (
                  <Pressable
                    key={option}
                    onPress={() => setDiscipline(option)}
                    style={[styles.tile, selected && styles.tileSelected]}
                  >
                    <Icon
                      size={26}
                      color={selected ? colors.pergamino : colors.paloRosa}
                      strokeWidth={2}
                    />
                    <Text style={[styles.tileLabel, selected && styles.tileLabelSelected]}>
                      {DISCIPLINE_LABELS[option]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={styles.block}>
            <SectionLabel>Cuánto duró</SectionLabel>
            <View style={styles.quickRow}>
              {QUICK_MINUTES.map((minutes) => (
                <Pressable
                  key={minutes}
                  onPress={() => setDurationMin(minutes)}
                  style={[styles.quick, durationMin === minutes && styles.quickSelected]}
                >
                  <Text
                    style={[
                      styles.quickLabel,
                      durationMin === minutes && styles.quickLabelSelected,
                    ]}
                  >
                    {minutes} min
                  </Text>
                </Pressable>
              ))}
            </View>
            <NumberStepper
              label="Minutos"
              value={durationMin}
              onChange={setDurationMin}
              step={5}
              min={5}
              suffix=" min"
            />
          </View>

          <View style={styles.block}>
            <SectionLabel>Qué día</SectionLabel>
            <View style={styles.quickRow}>
              {[0, -1, -2, -3, -4, -5, -6].map((offset) => (
                <Pressable
                  key={offset}
                  onPress={() => setDayOffset(offset)}
                  style={[styles.quick, dayOffset === offset && styles.quickSelected]}
                >
                  <Text
                    style={[styles.quickLabel, dayOffset === offset && styles.quickLabelSelected]}
                  >
                    {dayLabel(offset)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.block}>
            <SectionLabel>Nota (opcional)</SectionLabel>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Cómo te sentiste, ruta, intensidad..."
              placeholderTextColor={withAlpha(colors.paloRosa, 0.6)}
              style={styles.input}
              multiline
              maxLength={1000}
            />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <PrimaryButton label="Guardar sesión" onPress={save} loading={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.obsidiana,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    fontFamily: fonts.sansBold,
    ...typeScale.title,
    color: colors.marfil,
  },
  subtitle: {
    fontFamily: fonts.sans,
    ...typeScale.bodySm,
    color: colors.paloRosa,
  },
  close: {
    padding: spacing.xs,
  },
  content: {
    padding: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.xxl,
  },
  block: {
    gap: spacing.md,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  tile: {
    width: "30%",
    flexGrow: 1,
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.cardBg,
  },
  tileSelected: {
    backgroundColor: colors.guinda,
    borderColor: colors.guindaLight,
  },
  tileLabel: {
    fontFamily: fonts.sansSemiBold,
    ...typeScale.bodySm,
    color: colors.marfil,
  },
  tileLabelSelected: {
    color: colors.pergamino,
  },
  quickRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  quick: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.cardBg,
  },
  quickSelected: {
    backgroundColor: colors.guinda,
    borderColor: colors.guindaLight,
  },
  quickLabel: {
    fontFamily: fonts.sansMedium,
    ...typeScale.bodySm,
    color: colors.marfil,
  },
  quickLabelSelected: {
    color: colors.pergamino,
  },
  input: {
    minHeight: 96,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.cardBg,
    padding: spacing.lg,
    fontFamily: fonts.sans,
    ...typeScale.body,
    color: colors.marfil,
    textAlignVertical: "top",
  },
  error: {
    fontFamily: fonts.sansMedium,
    ...typeScale.bodySm,
    color: colors.error,
  },
});
