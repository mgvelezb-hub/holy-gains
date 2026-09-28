import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card } from "@/components/Card";
import { Chip } from "@/components/Chip";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { Parrafo } from "@/components/Parrafo";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SectionLabel } from "@/components/SectionLabel";
import { Stepper } from "@/components/Stepper";
import { useSession } from "@/context/session";
import { useTheme } from "@/context/theme";
import {
  ApiError,
  ONBOARDING_BUDGETS,
  ONBOARDING_BUDGET_LABELS,
  ONBOARDING_CONDITIONS,
  ONBOARDING_CONDITION_LABELS,
  ONBOARDING_DAY_SLOTS,
  ONBOARDING_DAY_SLOT_LABELS,
  ONBOARDING_GOALS,
  ONBOARDING_GOAL_LABELS,
  ONBOARDING_SEXES,
  ONBOARDING_SEX_LABELS,
  ONBOARDING_TRAINING_TIMES,
  ONBOARDING_TRAINING_TIME_LABELS,
  ONBOARDING_WEEK_DAYS,
  ONBOARDING_WEEK_DAY_LABELS,
  ONBOARDING_WORK_SCHEDULES,
  ONBOARDING_WORK_LABELS,
  postOnboarding,
  type OnboardingBudget,
  type OnboardingCondition,
  type OnboardingDaySlot,
  type OnboardingGoal,
  type OnboardingPayload,
  type OnboardingSchedule,
  type OnboardingSex,
  type OnboardingTrainingTime,
  type OnboardingWeekDay,
  type OnboardingWorkSchedule,
} from "@/lib/api";
import { fonts, radius, spacing, type Palette, type as typeScale } from "@/lib/theme";

/**
 * Onboarding NATIVO — espejo de `/onboarding` en la web
 * (`apps/web/src/app/onboarding/onboarding-form.tsx`), para quien crea su
 * cuenta desde el teléfono y hoy se topa con "onboarding incompleto" (403)
 * sin forma de arreglarlo ahí mismo.
 *
 * Los campos son EXACTAMENTE los que pide `onboardingSchema`
 * (`apps/web/src/lib/validation/onboarding.ts`) — ver el docblock del
 * bloque "Onboarding" en `@/lib/api` para lo que a propósito NO se pregunta
 * aquí (rango de edad como alternativa a fecha de nacimiento, ciclo
 * menstrual, disciplina principal, suplementos): ninguno de esos vive en ese
 * schema, así que inventarlos aquí sería prometerle al servidor un contrato
 * que no tiene.
 *
 * 6 pasos cortos en vez de un formulario largo: en un formulario de una sola
 * pantalla, la persona ve TODO lo que falta de golpe y eso frena más que
 * cualquier campo individual. Un paso a la vez con una barra de progreso
 * dice "esto se acaba", que es justo lo que un formulario largo no dice.
 */

const TOTAL_STEPS = 6;
const STEP_TITLES = [
  "Quién eres",
  "Tu objetivo",
  "Cómo entrenas",
  "Cómo comes",
  "Salud y fotos",
  "Todo listo",
];

const SESSION_MINUTES_OPTIONS = [45, 60, 75, 90] as const;
const SESSION_MINUTES_LABELS: Record<(typeof SESSION_MINUTES_OPTIONS)[number], string> = {
  45: "45 min",
  60: "1 h",
  75: "1 h 15",
  90: "1 h 30",
};

function defaultSchedule(): OnboardingSchedule {
  const entries = ONBOARDING_WEEK_DAYS.map((day) => [day, day === "DOM" ? "DESCANSO" : "MANANA"]);
  return Object.fromEntries(entries) as OnboardingSchedule;
}

/** "12,5" o "12.5" → 12.5. Vacío o inválido → null. */
function parseDecimal(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntSafe(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : null;
}

/** A qué paso pertenece un campo que vino marcado en `ApiError.detalles`. */
function stepForField(key: string): number {
  const top = key.split(".")[0];
  if (["displayName", "sex", "birthDate", "heightCm", "weightKg", "leanMassKg"].includes(top ?? "")) return 0;
  if (top === "goal") return 1;
  if (
    ["liftingDays", "cardioMinWk", "sessionMinutes", "work", "trainingTime", "trainingSchedule"].includes(
      top ?? "",
    )
  ) {
    return 2;
  }
  if (["mealsPerDay", "budget", "favoriteFoods", "excludedFoods", "allergies"].includes(top ?? "")) return 3;
  if (["conditions", "photoConsent"].includes(top ?? "")) return 4;
  return 5;
}

export default function OnboardingScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { refreshOnboarded } = useSession();

  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Paso 1 — Quién eres
  const [displayName, setDisplayName] = useState("");
  const [sex, setSex] = useState<OnboardingSex>("FEMALE");
  const [birthDay, setBirthDay] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [leanMassKg, setLeanMassKg] = useState("");

  // Paso 2 — Objetivo
  const [goal, setGoal] = useState<OnboardingGoal>("RECOMPOSICION");

  // Paso 3 — Entrenamiento
  const [liftingDays, setLiftingDays] = useState("4");
  const [cardioMinWk, setCardioMinWk] = useState("0");
  const [sessionMinutes, setSessionMinutes] = useState<(typeof SESSION_MINUTES_OPTIONS)[number]>(60);
  const [trainingTime, setTrainingTime] = useState<OnboardingTrainingTime>("MANANA");
  const [scheduleVaries, setScheduleVaries] = useState(false);
  const [trainingSchedule, setTrainingSchedule] = useState<OnboardingSchedule>(defaultSchedule);
  const [work, setWork] = useState<OnboardingWorkSchedule>("SEDENTARIO");

  // Paso 4 — Alimentación
  const [mealsPerDay, setMealsPerDay] = useState("4");
  const [budget, setBudget] = useState<OnboardingBudget>("MEDIO");
  const [favoriteFoods, setFavoriteFoods] = useState("");
  const [excludedFoods, setExcludedFoods] = useState("");
  const [allergies, setAllergies] = useState("");

  // Paso 5 — Salud y fotos
  const [conditions, setConditions] = useState<Set<OnboardingCondition>>(new Set());
  const [photoConsent, setPhotoConsent] = useState(false);

  const birthDate =
    birthDay.trim() && birthMonth.trim() && birthYear.trim() && birthYear.trim().length === 4
      ? `${birthYear.trim()}-${birthMonth.trim().padStart(2, "0")}-${birthDay.trim().padStart(2, "0")}`
      : null;

  function toggleCondition(condition: OnboardingCondition) {
    setConditions((prev) => {
      const next = new Set(prev);
      if (next.has(condition)) next.delete(condition);
      else next.add(condition);
      return next;
    });
  }

  function setScheduleDay(day: OnboardingWeekDay, slot: OnboardingDaySlot) {
    setTrainingSchedule((prev) => ({ ...prev, [day]: slot }));
  }

  function stepValid(index: number): string | null {
    if (index === 0) {
      if (displayName.trim().length < 2) return "Escribe cómo te decimos (al menos 2 letras)";
      if (!birthDate) return "Completa tu fecha de nacimiento";
      if (parseDecimal(heightCm) === null) return "Escribe tu estatura";
      if (parseDecimal(weightKg) === null) return "Escribe tu peso";
      return null;
    }
    if (index === 2) {
      if (parseIntSafe(liftingDays) === null) return "Elige cuántos días entrenas pesas";
      return null;
    }
    if (index === 3) {
      if (parseIntSafe(mealsPerDay) === null) return "Elige cuántas comidas al día";
      return null;
    }
    return null;
  }

  function goNext() {
    const error = stepValid(step);
    if (error) {
      setStepError(error);
      return;
    }
    setStepError(null);
    setStep((current) => Math.min(TOTAL_STEPS - 1, current + 1));
  }

  function goBack() {
    setStepError(null);
    setStep((current) => Math.max(0, current - 1));
  }

  function buildPayload(): OnboardingPayload {
    return {
      displayName: displayName.trim(),
      sex,
      birthDate: birthDate ?? "",
      heightCm: parseDecimal(heightCm) ?? 0,
      weightKg: parseDecimal(weightKg) ?? 0,
      leanMassKg: parseDecimal(leanMassKg),
      liftingDays: parseIntSafe(liftingDays) ?? 0,
      cardioMinWk: parseIntSafe(cardioMinWk) ?? 0,
      sessionMinutes,
      work,
      trainingTime,
      trainingSchedule: scheduleVaries ? trainingSchedule : null,
      mealsPerDay: parseIntSafe(mealsPerDay) ?? 0,
      budget,
      favoriteFoods,
      excludedFoods,
      allergies,
      conditions: [...conditions],
      goal,
      photoConsent,
    };
  }

  async function handleSubmit() {
    setGeneralError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      await postOnboarding(buildPayload());
      // El guard de rutas en `_layout.tsx` lee `onboarded` de este mismo
      // contexto: sin refrescarlo aquí, se quedaría creyendo que falta el
      // perfil y regresaría a esta pantalla en cuanto (tabs) intente montar.
      await refreshOnboarded();
      router.replace("/");
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && error.detalles) {
        setFieldErrors(error.detalles);
        setGeneralError("Revisa los campos marcados.");
        const [firstKey] = Object.keys(error.detalles);
        if (firstKey) setStep(stepForField(firstKey));
      } else if (error instanceof ApiError && error.status === 409) {
        // Ya se había completado (por ejemplo, desde la web mientras tanto):
        // no es un error real, solo hay que entrar.
        await refreshOnboarded();
        router.replace("/");
      } else {
        setGeneralError(
          error instanceof ApiError ? error.message : "No se pudo guardar. Intenta de nuevo.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ProgressBar step={step} total={TOTAL_STEPS} />
        <Text style={styles.title}>{STEP_TITLES[step]}</Text>

        {step === 0 && (
          <Card>
            <SectionLabel>Con esto calculamos tu punto de partida</SectionLabel>
            <View style={styles.fieldGroup}>
              <View style={styles.field}>
                <Text style={styles.label}>¿Cómo te decimos?</Text>
                <TextInput
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="Tu nombre"
                  placeholderTextColor={colors.paloRosaLight}
                  style={styles.input}
                />
                <FieldError message={fieldErrors.displayName} colors={colors} />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Sexo biológico</Text>
                <ChipRow>
                  {ONBOARDING_SEXES.map((option) => (
                    <Chip
                      key={option}
                      label={ONBOARDING_SEX_LABELS[option]}
                      selected={sex === option}
                      onPress={() => setSex(option)}
                    />
                  ))}
                </ChipRow>
                <FieldError message={fieldErrors.sex} colors={colors} />
              </View>

              <View style={styles.field}>
                <View style={styles.labelRow}>
                  <Text style={styles.label}>Fecha de nacimiento</Text>
                  <InfoTip titulo="Fecha de nacimiento">
                    <TextoInfo>Solo cambia la fórmula de tu gasto calórico. Nada más se calcula con esto.</TextoInfo>
                  </InfoTip>
                </View>
                <View style={styles.dateRow}>
                  <DateBox placeholder="DD" value={birthDay} onChangeText={setBirthDay} maxLength={2} />
                  <DateBox placeholder="MM" value={birthMonth} onChangeText={setBirthMonth} maxLength={2} />
                  <DateBox placeholder="AAAA" value={birthYear} onChangeText={setBirthYear} maxLength={4} wide />
                </View>
                <FieldError message={fieldErrors.birthDate} colors={colors} />
              </View>

              <View style={styles.row}>
                <View style={styles.half}>
                  <Stepper
                    label="Estatura"
                    unit="cm"
                    required
                    value={heightCm}
                    onChangeText={setHeightCm}
                    error={fieldErrors.heightCm}
                  />
                </View>
                <View style={styles.half}>
                  <Stepper
                    label="Peso"
                    unit="kg"
                    required
                    value={weightKg}
                    onChangeText={setWeightKg}
                    error={fieldErrors.weightKg}
                  />
                </View>
              </View>

              <Stepper
                label="Masa magra (opcional)"
                unit="kg"
                placeholder="Si tienes un InBody reciente"
                value={leanMassKg}
                onChangeText={setLeanMassKg}
                error={fieldErrors.leanMassKg}
              />
            </View>
          </Card>
        )}

        {step === 1 && (
          <Card>
            <SectionLabel>Nada de esto es un diagnóstico — solo ajusta las reglas del plan</SectionLabel>
            <View style={styles.goalList}>
              {ONBOARDING_GOALS.map((option) => (
                <Pressable
                  key={option}
                  onPress={() => setGoal(option)}
                  style={[styles.goalOption, goal === option && styles.goalOptionSelected]}
                >
                  <Text style={[styles.goalOptionText, goal === option && styles.goalOptionTextSelected]}>
                    {ONBOARDING_GOAL_LABELS[option]}
                  </Text>
                </Pressable>
              ))}
            </View>
            <FieldError message={fieldErrors.goal} colors={colors} />
          </Card>
        )}

        {step === 2 && (
          <Card>
            <SectionLabel>Cómo entrenas</SectionLabel>
            <View style={styles.fieldGroup}>
              <View style={styles.row}>
                <View style={styles.half}>
                  <Stepper
                    label="Días de pesas"
                    keyboardType="number-pad"
                    value={liftingDays}
                    onChangeText={setLiftingDays}
                    error={fieldErrors.liftingDays}
                  />
                </View>
                <View style={styles.half}>
                  <Stepper
                    label="Cardio"
                    unit="min/sem"
                    keyboardType="number-pad"
                    value={cardioMinWk}
                    onChangeText={setCardioMinWk}
                    error={fieldErrors.cardioMinWk}
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>¿Cuánto tiempo tienes por sesión?</Text>
                <ChipRow>
                  {SESSION_MINUTES_OPTIONS.map((option) => (
                    <Chip
                      key={option}
                      label={SESSION_MINUTES_LABELS[option]}
                      selected={sessionMinutes === option}
                      onPress={() => setSessionMinutes(option)}
                    />
                  ))}
                </ChipRow>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>¿A qué hora entrenas normalmente?</Text>
                <ChipRow>
                  {ONBOARDING_TRAINING_TIMES.map((option) => (
                    <Chip
                      key={option}
                      label={ONBOARDING_TRAINING_TIME_LABELS[option]}
                      selected={trainingTime === option}
                      onPress={() => setTrainingTime(option)}
                    />
                  ))}
                </ChipRow>

                <Pressable
                  onPress={() => setScheduleVaries((value) => !value)}
                  style={styles.switchRow}
                  hitSlop={8}
                >
                  <Switch
                    value={scheduleVaries}
                    onValueChange={setScheduleVaries}
                    trackColor={{ true: colors.guinda, false: colors.cardBorder }}
                    thumbColor={colors.marfil}
                  />
                  <Text style={styles.switchLabel}>Varía según el día</Text>
                </Pressable>

                {scheduleVaries && (
                  <View style={styles.scheduleBox}>
                    {ONBOARDING_WEEK_DAYS.map((day) => (
                      <View key={day} style={styles.scheduleDay}>
                        <Text style={styles.scheduleDayLabel}>{ONBOARDING_WEEK_DAY_LABELS[day]}</Text>
                        <ChipRow>
                          {ONBOARDING_DAY_SLOTS.map((slot) => (
                            <Chip
                              key={slot}
                              label={ONBOARDING_DAY_SLOT_LABELS[slot]}
                              selected={trainingSchedule[day] === slot}
                              onPress={() => setScheduleDay(day, slot)}
                            />
                          ))}
                        </ChipRow>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Tu día fuera del gym</Text>
                <ChipRow>
                  {ONBOARDING_WORK_SCHEDULES.map((option) => (
                    <Chip
                      key={option}
                      label={ONBOARDING_WORK_LABELS[option]}
                      selected={work === option}
                      onPress={() => setWork(option)}
                    />
                  ))}
                </ChipRow>
              </View>
            </View>
          </Card>
        )}

        {step === 3 && (
          <Card>
            <SectionLabel>Cómo comes</SectionLabel>
            <View style={styles.fieldGroup}>
              <Stepper
                label="Comidas al día"
                keyboardType="number-pad"
                value={mealsPerDay}
                onChangeText={setMealsPerDay}
                error={fieldErrors.mealsPerDay}
              />

              <View style={styles.field}>
                <Text style={styles.label}>Presupuesto para el súper</Text>
                <ChipRow>
                  {ONBOARDING_BUDGETS.map((option) => (
                    <Chip
                      key={option}
                      label={ONBOARDING_BUDGET_LABELS[option]}
                      selected={budget === option}
                      onPress={() => setBudget(option)}
                    />
                  ))}
                </ChipRow>
              </View>

              <FreeTextField
                label="Lo que sí te gusta"
                placeholder="pollo, avena, camote, fresas — separa con comas"
                value={favoriteFoods}
                onChangeText={setFavoriteFoods}
                colors={colors}
              />
              <FreeTextField
                label="Lo que no comes"
                placeholder="hígado, brócoli — separa con comas"
                value={excludedFoods}
                onChangeText={setExcludedFoods}
                colors={colors}
              />
              <FreeTextField
                label="Alergias"
                placeholder="lactosa, nuez — separa con comas"
                value={allergies}
                onChangeText={setAllergies}
                colors={colors}
              />
            </View>
          </Card>
        )}

        {step === 4 && (
          <>
            <Card>
              <SectionLabel>¿Algo de esto aplica?</SectionLabel>
              <ChipRow>
                {ONBOARDING_CONDITIONS.map((condition) => (
                  <Chip
                    key={condition}
                    label={ONBOARDING_CONDITION_LABELS[condition]}
                    selected={conditions.has(condition)}
                    onPress={() => toggleCondition(condition)}
                  />
                ))}
              </ChipRow>
            </Card>

            <Card>
              <View style={styles.labelRow}>
                <SectionLabel>Fotos de progreso</SectionLabel>
                <InfoTip titulo="Fotos de progreso">
                  <TextoInfo>
                    Tus fotos se guardan cifradas y privadas. Solo tú y tu coach las ven. Puedes quitar
                    este permiso cuando quieras; sin él, las fotos nunca salen del almacenamiento
                    privado.
                  </TextoInfo>
                </InfoTip>
              </View>
              <Pressable
                onPress={() => setPhotoConsent((value) => !value)}
                style={styles.switchRow}
                hitSlop={8}
              >
                <Switch
                  value={photoConsent}
                  onValueChange={setPhotoConsent}
                  trackColor={{ true: colors.guinda, false: colors.cardBorder }}
                  thumbColor={colors.marfil}
                />
                <Parrafo style={styles.switchLabel}>
                  Autorizo analizar mis fotos con IA para comparar mis cambios semana a semana
                </Parrafo>
              </Pressable>
            </Card>
          </>
        )}

        {step === 5 && (
          <Card>
            <SectionLabel>Revisa antes de terminar</SectionLabel>
            <View style={styles.summaryList}>
              <SummaryRow label="Nombre" value={displayName || "—"} colors={colors} />
              <SummaryRow label="Fecha de nacimiento" value={birthDate ?? "—"} colors={colors} />
              <SummaryRow
                label="Estatura / peso"
                value={`${heightCm || "—"} cm · ${weightKg || "—"} kg`}
                colors={colors}
              />
              <SummaryRow label="Objetivo" value={ONBOARDING_GOAL_LABELS[goal]} colors={colors} />
              <SummaryRow
                label="Entrenamiento"
                value={`${liftingDays || "0"} días de pesas · ${ONBOARDING_TRAINING_TIME_LABELS[trainingTime]}`}
                colors={colors}
              />
              <SummaryRow label="Comidas al día" value={mealsPerDay || "—"} colors={colors} />
              <SummaryRow label="Presupuesto" value={ONBOARDING_BUDGET_LABELS[budget]} colors={colors} />
            </View>
          </Card>
        )}

        {stepError && <Text style={styles.generalError}>{stepError}</Text>}
        {generalError && <Text style={styles.generalError}>{generalError}</Text>}

        {step > 0 && (
          <Pressable onPress={goBack} hitSlop={8} style={styles.backRow}>
            <Text style={styles.backText}>← Atrás</Text>
          </Pressable>
        )}

        <PrimaryButton
          label={step === TOTAL_STEPS - 1 ? "Terminar" : "Siguiente"}
          onPress={step === TOTAL_STEPS - 1 ? handleSubmit : goNext}
          loading={submitting}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function ProgressBar({ step, total }: { step: number; total: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.progressWrap}>
      <View style={styles.progressRow}>
        {Array.from({ length: total }, (_, index) => (
          <View
            key={index}
            style={[styles.progressSegment, index <= step && styles.progressSegmentFilled]}
          />
        ))}
      </View>
      <Text style={styles.progressLabel}>
        Paso {step + 1} de {total}
      </Text>
    </View>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return <View style={styles.chipRow}>{children}</View>;
}

function DateBox({
  placeholder,
  value,
  onChangeText,
  maxLength,
  wide = false,
}: {
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  maxLength: number;
  wide?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <TextInput
      value={value}
      onChangeText={(text) => onChangeText(text.replace(/[^0-9]/g, ""))}
      placeholder={placeholder}
      placeholderTextColor={colors.paloRosaLight}
      keyboardType="number-pad"
      maxLength={maxLength}
      style={[styles.dateBox, wide && styles.dateBoxWide]}
    />
  );
}

function FreeTextField({
  label,
  placeholder,
  value,
  onChangeText,
  colors,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  colors: Palette;
}) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.paloRosaLight}
        multiline
        style={styles.textarea}
      />
    </View>
  );
}

function FieldError({ message, colors }: { message?: string; colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!message) return null;
  return <Text style={styles.fieldError}>{message}</Text>;
}

function SummaryRow({ label, value, colors }: { label: string; value: string; colors: Palette }) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.obsidiana },
    content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.huge },
    title: { fontFamily: fonts.display, ...typeScale.heading, color: colors.marfil },
    fieldGroup: { marginTop: spacing.md, gap: spacing.lg },
    field: { gap: spacing.xs },
    labelRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    label: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.label,
      letterSpacing: 1.5,
      color: colors.paloRosa,
    },
    input: {
      backgroundColor: colors.cardBg,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      fontFamily: fonts.sans,
      ...typeScale.body,
      color: colors.marfil,
    },
    textarea: {
      backgroundColor: colors.cardBg,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: radius.md,
      padding: spacing.md,
      minHeight: 56,
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.marfil,
      textAlignVertical: "top",
    },
    row: { flexDirection: "row", gap: spacing.md },
    half: { flex: 1 },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    dateRow: { flexDirection: "row", gap: spacing.sm },
    dateBox: {
      flex: 1,
      textAlign: "center",
      backgroundColor: colors.cardBg,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      fontFamily: fonts.sans,
      ...typeScale.heading,
      color: colors.marfil,
    },
    dateBoxWide: { flex: 1.6 },
    switchRow: {
      marginTop: spacing.sm,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    switchLabel: {
      flex: 1,
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.marfil,
    },
    scheduleBox: {
      marginTop: spacing.md,
      gap: spacing.md,
      padding: spacing.md,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    scheduleDay: { gap: spacing.xs },
    scheduleDayLabel: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.label,
      color: colors.marfil,
    },
    goalList: { marginTop: spacing.md, gap: spacing.sm },
    goalOption: {
      padding: spacing.md,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
    },
    goalOptionSelected: {
      borderColor: colors.guindaLight,
      backgroundColor: colors.guinda,
    },
    goalOptionText: {
      fontFamily: fonts.sansMedium,
      ...typeScale.body,
      color: colors.marfil,
    },
    goalOptionTextSelected: { color: colors.pergamino },
    fieldError: {
      fontFamily: fonts.sans,
      ...typeScale.label,
      color: colors.error,
    },
    generalError: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.error,
      textAlign: "center",
    },
    backRow: { alignSelf: "center", paddingVertical: spacing.sm },
    backText: {
      fontFamily: fonts.sansMedium,
      ...typeScale.body,
      color: colors.paloRosa,
    },
    progressWrap: { gap: spacing.xs },
    progressRow: { flexDirection: "row", gap: spacing.xs },
    progressSegment: {
      flex: 1,
      height: 4,
      borderRadius: radius.full,
      backgroundColor: colors.cardBorder,
    },
    progressSegmentFilled: { backgroundColor: colors.guindaLight },
    progressLabel: {
      fontFamily: fonts.sans,
      ...typeScale.label,
      color: colors.paloRosaLight,
    },
    summaryList: { marginTop: spacing.md, gap: spacing.md },
    summaryRow: { gap: 2 },
    summaryLabel: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.label,
      letterSpacing: 1.2,
      color: colors.paloRosa,
    },
    summaryValue: {
      fontFamily: fonts.sans,
      ...typeScale.body,
      color: colors.marfil,
    },
  });
