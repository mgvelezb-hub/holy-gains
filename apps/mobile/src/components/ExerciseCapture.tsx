import { useVideoPlayer, VideoView } from "expo-video";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { NumberStepper } from "@/components/NumberStepper";
import { Parrafo } from "@/components/Parrafo";
import { RestTimer } from "@/components/RestTimer";
import { useTheme } from "@/context/theme";
import type { ExerciseAlternative, SessionExerciseView, WorkoutSetInput } from "@/lib/api";
import { fonts, radius, spacing, withAlpha, type Palette, type as typeScale } from "@/lib/theme";
import { clientIdFor } from "@/lib/training-client-id";
import { isVideoDownloaded, localVideoFile } from "@/lib/video-downloads";

const WEIGHT_STEP = 2.5;

/**
 * Peso con el que arranca el stepper de una serie.
 *
 * Replica EXACTO `suggestedWeight()` de
 * apps/web/src/app/app/entrenamiento/exercise-logger.tsx: si el plan ya trae
 * peso (el prellenado piramidal 65%→100% que hizo el servidor en
 * `prefillSets`, apps/web/src/lib/training/progression.ts), ese manda. El
 * calentamiento nunca hereda el peso de trabajo — sale al 40% del último
 * peso registrado, redondeado al disco de 2.5 kg. Sin historial, cero (la UI
 * lo lee como "peso ligero" / "sin sugerencia").
 */
function suggestedWeight(exercise: SessionExerciseView, set: SessionExerciseView["sets"][number]): number {
  if (set.weightKg !== null) return set.weightKg;
  if (set.warmup) {
    if (exercise.lastWeightKg === null) return 0;
    return Math.max(0, Math.round((exercise.lastWeightKg * 0.4) / WEIGHT_STEP) * WEIGHT_STEP);
  }
  return exercise.lastWeightKg ?? 0;
}

/** Las series de calentamiento no cuentan para la numeración de las efectivas. */
function warmupsBefore(exercise: SessionExerciseView, setIndex: number): number {
  return exercise.sets.slice(0, setIndex + 1).filter((set) => set.warmup).length;
}

export function ExerciseCapture({
  exercise,
  exerciseIndex,
  workoutId,
  savedSets,
  online,
  onMarkSet,
  onSubstitute,
  onBack,
  onNext,
  isLast,
}: {
  exercise: SessionExerciseView;
  exerciseIndex: number;
  workoutId: string;
  /** Series ya confirmadas de TODA la sesión — se filtra aquí por prefijo de clientId. */
  savedSets: WorkoutSetInput[];
  online: boolean;
  onMarkSet: (setIndex: number, values: { reps: number; weightKg: number | null } | null) => void;
  onSubstitute: (alternative: ExerciseAlternative) => void;
  onBack: () => void;
  onNext: () => void;
  isLast: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [swapOpen, setSwapOpen] = useState(false);
  const [videoOpen, setVideoOpen] = useState(false);
  // El archivo descargado manda sobre la URL firmada: sirve sin señal y no
  // caduca a media sesión.
  const videoUri = useMemo(() => {
    const path = exercise.videoPath;
    if (path && isVideoDownloaded(path)) return localVideoFile(path).uri;
    return exercise.videoUrl ?? null;
  }, [exercise.videoPath, exercise.videoUrl]);
  const [restStartedAt, setRestStartedAt] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, { reps: number; weightKg: number }>>(() => {
    const initial: Record<number, { reps: number; weightKg: number }> = {};
    exercise.sets.forEach((set, setIndex) => {
      const saved = savedSets.find((s) => s.clientId === clientIdFor(workoutId, exerciseIndex, setIndex));
      initial[setIndex] = {
        reps: saved?.reps ?? set.reps,
        weightKg: saved?.weightKg ?? suggestedWeight(exercise, set),
      };
    });
    return initial;
  });

  function savedFor(setIndex: number): WorkoutSetInput | undefined {
    return savedSets.find((s) => s.clientId === clientIdFor(workoutId, exerciseIndex, setIndex));
  }

  function setDraft(setIndex: number, patch: Partial<{ reps: number; weightKg: number }>) {
    setDrafts((current) => ({
      ...current,
      [setIndex]: { ...(current[setIndex] ?? { reps: 0, weightKg: 0 }), ...patch },
    }));
  }

  /** Marcar una serie es esto: dos taps en total contando abrir el ejercicio —
   * el peso y las reps ya llegan prellenados, así que confirmar es un tap en
   * el check. Los steppers solo entran si hay que ajustar. */
  function mark(setIndex: number) {
    const saved = savedFor(setIndex);
    if (saved) {
      onMarkSet(setIndex, null);
      return;
    }
    const draft = drafts[setIndex] ?? { reps: 0, weightKg: 0 };
    onMarkSet(setIndex, { reps: draft.reps, weightKg: draft.weightKg > 0 ? draft.weightKg : null });
    setRestStartedAt(Date.now());
  }

  const done = exercise.sets.filter((_, setIndex) => savedFor(setIndex)).length;
  const allDone = done === exercise.sets.length;

  // El calentamiento no puede romper un récord: solo cuentan las efectivas.
  const bestToday = exercise.sets.reduce((best, _, setIndex) => {
    const target = exercise.sets[setIndex];
    if (target?.warmup) return best;
    const saved = savedFor(setIndex);
    return Math.max(best, saved?.weightKg ?? 0);
  }, 0);
  const beatsRecord = bestToday > 0 && bestToday > (exercise.bestWeightKg ?? 0);

  return (
    <View style={styles.container}>
      <Pressable onPress={onBack} style={styles.backRow} hitSlop={8}>
        <Text style={styles.backText}>← Ejercicios</Text>
      </Pressable>

      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{exercise.name}</Text>
          {exercise.alternatives.length > 0 && (
            <Pressable onPress={() => setSwapOpen(true)} style={styles.swapButton} hitSlop={8}>
              <Text style={styles.swapButtonText}>Cambiar</Text>
            </Pressable>
          )}
        </View>
        <Text style={styles.subtitle}>{exercise.schemeLabel}</Text>
        {exercise.note && <Text style={styles.note}>{exercise.note}</Text>}
      </View>

      <SwapModal
        open={swapOpen}
        onClose={() => setSwapOpen(false)}
        exercise={exercise}
        online={online}
        captured={done}
        onPick={(alternative) => {
          setSwapOpen(false);
          onSubstitute(alternative);
        }}
      />

      <View style={styles.recordRow}>
        {exercise.record ? (
          <Text style={styles.recordText}>
            <Text style={styles.recordStrong}>
              PR: {exercise.record.weightKg} kg × {exercise.record.reps} reps
            </Text>
          </Text>
        ) : (
          <Text style={styles.recordEmpty}>Todavía no hay récord aquí. Lo de hoy es el primero.</Text>
        )}
      </View>

      {exercise.videoUrl || exercise.videoPath ? (
        <View style={styles.videoBlock}>
          <Pressable
            onPress={() => setVideoOpen((open) => !open)}
            style={styles.videoLink}
            disabled={!videoUri}
          >
            <Text style={styles.videoLinkText}>
              {videoUri
                ? videoOpen
                  ? "▾ Ocultar video"
                  : "▶ Ver video"
                : `▶ ${exercise.videoPath ?? "video"} (sin conexión)`}
            </Text>
          </Pressable>
          {videoOpen && videoUri ? <ExerciseVideo uri={videoUri} /> : null}
        </View>
      ) : (
        <View style={styles.videoMissing}>
          <Text style={styles.videoMissingText}>Este ejercicio todavía no tiene video.</Text>
        </View>
      )}

      {beatsRecord && (
        <View style={styles.prBanner}>
          <Text style={styles.prBannerText}>
            {exercise.record
              ? `¡PR! ${bestToday} kg contra los ${exercise.record.weightKg} kg de antes.`
              : `¡PR! ${bestToday} kg es tu primera marca aquí.`}
          </Text>
        </View>
      )}

      {restStartedAt !== null && (
        <RestTimer
          startedAt={restStartedAt}
          seconds={exercise.restSeconds}
          onDismiss={() => setRestStartedAt(null)}
        />
      )}

      <View style={styles.sets}>
        {exercise.sets.map((target, setIndex) => {
          const saved = savedFor(setIndex);
          const draft = drafts[setIndex] ?? { reps: target.reps, weightKg: 0 };
          const weightValue = saved ? (saved.weightKg ?? 0) : draft.weightKg;
          const repsValue = saved ? saved.reps : draft.reps;

          return (
            <Card key={setIndex} style={saved ? styles.setCardDone : undefined}>
              <View style={styles.setHeaderRow}>
                <Text style={styles.setLabel}>
                  {target.warmup
                    ? `Calentamiento · ${target.weightKg === null ? "peso ligero" : `${target.weightKg} kg`}`
                    : `Serie ${setIndex + 1 - warmupsBefore(exercise, setIndex)}`}
                </Text>
                <Text style={styles.setTarget}>objetivo {target.reps} reps</Text>
              </View>

              <View style={styles.setControls}>
                <NumberStepper
                  label="Peso"
                  value={weightValue}
                  step={WEIGHT_STEP}
                  min={0}
                  suffix=" kg"
                  onChange={(next) => setDraft(setIndex, { weightKg: next })}
                />
                <NumberStepper
                  label="Reps"
                  value={repsValue}
                  step={1}
                  min={0}
                  onChange={(next) => setDraft(setIndex, { reps: next })}
                />
                <Pressable
                  onPress={() => mark(setIndex)}
                  style={[styles.checkButton, saved && styles.checkButtonDone]}
                >
                  <Text style={[styles.checkButtonText, saved && styles.checkButtonTextDone]}>✓</Text>
                </Pressable>
              </View>
            </Card>
          );
        })}
      </View>

      <Pressable
        onPress={onNext}
        disabled={!allDone}
        style={[styles.nextButton, !allDone && styles.nextButtonDisabled]}
      >
        <Text style={styles.nextButtonText}>
          {allDone
            ? (isLast ? "TERMINAR SESIÓN" : "SIGUIENTE EJERCICIO")
            : `FALTAN ${exercise.sets.length - done} SERIES`}
        </Text>
      </Pressable>
    </View>
  );
}

function SwapModal({
  open,
  onClose,
  exercise,
  online,
  captured,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  exercise: SessionExerciseView;
  online: boolean;
  captured: number;
  onPick: (alternative: ExerciseAlternative) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>Cambiar ejercicio</Text>
          <Parrafo style={styles.modalSubtitle}>
            En lugar de {exercise.name}. Mismas series y esquema; el peso lo escribes tú, porque no
            es la misma máquina.
          </Parrafo>

          <ScrollView style={styles.modalList}>
            {exercise.alternatives.map((alternative) => (
              <Pressable
                key={alternative.exerciseId}
                onPress={() => onPick(alternative)}
                style={styles.modalOption}
              >
                <Text style={styles.modalOptionName}>{alternative.name}</Text>
                <Text style={styles.modalOptionMeta}>
                  {alternative.declared ? "Sustituto del mismo movimiento" : "Mismo grupo muscular"}
                  {!alternative.videoPath ? " · sin video" : ""}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {captured > 0 && (
            <Parrafo style={styles.modalWarning}>
              Ojo: {captured === 1 ? "la serie que ya marcaste se borra" : `las ${captured} series que ya marcaste se borran`}
              {" "}— eran de la otra máquina.
            </Parrafo>
          )}
          {!online && <Parrafo style={styles.modalWarning}>Sin conexión: el cambio queda en el teléfono y se sube solo.</Parrafo>}

          <Pressable onPress={onClose} style={styles.modalClose}>
            <Text style={styles.modalCloseText}>CANCELAR</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** Reproductor dentro de la app: el video nunca sale a Safari. */
function ExerciseVideo({ uri }: { uri: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const player = useVideoPlayer(uri, (instance) => {
    instance.play();
  });

  return <VideoView style={styles.videoView} player={player} nativeControls contentFit="contain" />;
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  container: { gap: spacing.md },
  backRow: { flexDirection: "row", alignItems: "center" },
  backText: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosaLight },
  header: { gap: spacing.xs },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
  title: { flex: 1, fontFamily: fonts.display, ...typeScale.heading, color: colors.marfil },
  subtitle: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosaLight },
  // `guindaLight` es relleno de acento, no color de texto: sobre el fondo
  // oscuro daba 2.27 y la nota del ejercicio no se leía.
  note: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
  swapButton: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  swapButtonText: { fontFamily: fonts.sansSemiBold, ...typeScale.label, letterSpacing: 1.5, color: colors.marfil },
  recordRow: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.cardBg,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  recordText: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.marfil },
  recordStrong: { fontFamily: fonts.sansSemiBold },
  recordEmpty: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosaLight },
  videoBlock: { gap: spacing.sm },
  videoView: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    backgroundColor: "#000",
  },
  videoLink: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  videoLinkText: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.champan },
  videoMissing: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  videoMissingText: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosaLight },
  prBanner: {
    borderWidth: 1,
    borderColor: colors.champan,
    backgroundColor: withAlpha(colors.champan, 0.12),
    borderRadius: radius.md,
    padding: spacing.md,
  },
  prBannerText: { fontFamily: fonts.sansSemiBold, ...typeScale.bodySm, color: colors.champan },
  sets: { gap: spacing.sm },
  setCardDone: { borderColor: colors.guindaLight, backgroundColor: withAlpha(colors.guindaLight, 0.12) },
  setHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  setLabel: { fontFamily: fonts.sansSemiBold, ...typeScale.bodySm, color: colors.marfil, flexShrink: 1 },
  setTarget: { fontFamily: fonts.sansSemiBold, ...typeScale.label, letterSpacing: 1.5, color: colors.paloRosa },
  setControls: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, marginTop: spacing.md },
  checkButton: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  checkButtonDone: { backgroundColor: colors.guinda, borderColor: colors.guinda },
  checkButtonText: { fontFamily: fonts.display, ...typeScale.heading, color: colors.marfil },
  // pergamino: rol "texto sobre fondo de acento" — solo aplica cuando el
  // check ya se marcó y el botón pinta su fondo con guinda.
  checkButtonTextDone: { color: colors.pergamino },
  nextButton: {
    backgroundColor: colors.guinda,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  nextButtonDisabled: { opacity: 0.5 },
  // pergamino: rol "texto sobre fondo de acento" (aquí guinda, siempre).
  nextButtonText: { fontFamily: fonts.sansSemiBold, ...typeScale.label, letterSpacing: 3, color: colors.pergamino },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalSheet: {
    backgroundColor: colors.obsidiana,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    gap: spacing.md,
    maxHeight: "80%",
  },
  modalTitle: { fontFamily: fonts.display, ...typeScale.heading, color: colors.marfil },
  modalSubtitle: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosaLight },
  modalList: { gap: spacing.sm },
  modalOption: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  modalOptionName: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.marfil },
  modalOptionMeta: { fontFamily: fonts.sans, ...typeScale.label, color: colors.paloRosaLight, marginTop: 2 },
  modalWarning: { fontFamily: fonts.sans, ...typeScale.label, color: colors.paloRosaLight },
  modalClose: { alignItems: "center", paddingVertical: spacing.md },
  modalCloseText: { fontFamily: fonts.sansSemiBold, ...typeScale.label, letterSpacing: 2, color: colors.paloRosa },
});
