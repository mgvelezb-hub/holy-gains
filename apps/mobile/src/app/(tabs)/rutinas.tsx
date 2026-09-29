import NetInfo from "@react-native-community/netinfo";
import { useRouter } from "expo-router";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Chip } from "@/components/Chip";
import { CalendarRange, PlayCircle, Timer } from "lucide-react-native";
import { Collapsible } from "@/components/Collapsible";
import { EngraneAjustes } from "@/components/EngraneAjustes";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { Parrafo } from "@/components/Parrafo";
import { ProtocoloHiit } from "@/components/ProtocoloHiit";
import { ScoreCard } from "@/components/ScoreCard";
import { ExerciseCapture } from "@/components/ExerciseCapture";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import { useScrollTop } from "@/lib/scroll-top";
import {
  ApiError,
  DISCIPLINE_LABELS,
  getTrainingWeek,
  type ExerciseAlternative,
  type OtherSessionView,
  type SessionSyncInput,
  type SessionView,
  type UnidadVelocidad,
  type WeekView,
  type WorkoutSetInput,
  trimSession,
} from "@/lib/api";
import { iconoDe } from "@/lib/disciplinas";
import { protocoloDe, unidadDe } from "@/lib/hiit";
import { guardarUnidadVelocidad } from "@/lib/unidad-velocidad";
import {
  RECORTES,
  diaDelPlan,
  etiquetaDelDia,
  lineaDelDia,
  nombreDelRecorte,
  ordenarBloquesDelDia,
  partesDelDia,
  type BloqueDelDia,
} from "@/lib/entrenamiento";
import { fonts, radius, spacing, withAlpha, type Palette, type as typeScale } from "@/lib/theme";
import {
  getCachedWeek,
  getPendingSession,
  saveWeek,
  upsertPendingSession,
} from "@/lib/training-db";
import { exercisePrefix } from "@/lib/training-client-id";
import { refreshPendingCount, subscribePendingCount, syncAndNotify } from "@/lib/training-sync";

/**
 * Modo gimnasio (Fase N4) — offline-first.
 *
 * La semana ya tiene que estar en el teléfono antes de entrar al sótano: se
 * intenta traer fresca de red al abrir la pestaña y, si no hay señal, se cae
 * al cache de SQLite (`apps/mobile/src/lib/training-db.ts`). Cada serie que la
 * atleta marca se guarda ahí **primero**, local, y `training-sync.ts` la sube
 * sola cuando puede — la pantalla nunca espera al servidor para pintar lo que
 * ya se capturó.
 */

/** Fecha de hoy en el teléfono. Sin red la del servidor puede venir de ayer. */
function todayISO(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Lunes de esta semana, ISO. Misma cuenta que `currentMonday()` en
 * apps/web/src/app/app/entrenamiento/training-session.tsx: es la llave del
 * cache cuando no hay red para preguntarle al servidor cuál semana toca. */
function mondayISO(): string {
  const now = new Date();
  const day = now.getDay() || 7;
  now.setDate(now.getDate() - (day - 1));
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${String(now.getDate()).padStart(2, "0")}`;
}

/** Suma días a una fecha ISO (yyyy-mm-dd) sin salirse de horario local. */
function addDaysISO(dateISO: string, days: number): string {
  const [year, month, day] = dateISO.split("-").map(Number);
  const date = new Date(year!, month! - 1, day!);
  date.setDate(date.getDate() + days);
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${nextMonth}-${nextDay}`;
}

const WEEKDAY_ABBR_BY_DOW = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];
const WEEKDAY_LONG_BY_DOW = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTH_ABBR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function dayOfWeek(dateISO: string): number {
  const [year, month, day] = dateISO.split("-").map(Number);
  return new Date(year!, month! - 1, day!).getDay();
}

/** "LUN", "MAR"… — para las filas de "Tu semana". */
function weekdayAbbr(dateISO: string): string {
  return WEEKDAY_ABBR_BY_DOW[dayOfWeek(dateISO)]!;
}

/** "lunes", "martes"… — para el aviso de "estás viendo otro día". */
function weekdayLong(dateISO: string): string {
  return WEEKDAY_LONG_BY_DOW[dayOfWeek(dateISO)]!;
}

/** "25 AGO" — fecha corta para acompañar el día abreviado. */
function shortDateLabel(dateISO: string): string {
  const [, month, day] = dateISO.split("-").map(Number);
  return `${day} ${MONTH_ABBR[month! - 1]!.toUpperCase()}`;
}

function emptySessionInput(workoutId: string): SessionSyncInput {
  return { workoutId, completedAt: null, notes: null, sets: [], substitutions: [] };
}

function upsertByClientId(sets: WorkoutSetInput[], next: WorkoutSetInput): WorkoutSetInput[] {
  const filtered = sets.filter((set) => set.clientId !== next.clientId);
  return [...filtered, next];
}

function upsertSubstitution(
  substitutions: SessionSyncInput["substitutions"],
  exerciseIndex: number,
  exerciseId: string,
): SessionSyncInput["substitutions"] {
  return [...substitutions.filter((s) => s.exerciseIndex !== exerciseIndex), { exerciseIndex, exerciseId }];
}

/**
 * Cambia un ejercicio dentro de la semana que ya está en la mano.
 *
 * Espejo de `weekWithSubstitute()` en training-session.tsx: se aplica primero
 * en el teléfono, con las series de ese lugar vacías (la carga de la prensa
 * no es la del hack squat) y sin historial propio, porque el que había era
 * del ejercicio que se fue.
 */
function weekWithSubstitute(
  week: WeekView,
  workoutId: string,
  exerciseIndex: number,
  alternative: ExerciseAlternative,
): WeekView {
  return {
    ...week,
    sessions: week.sessions.map((session) => {
      if (session.workoutId !== workoutId) return session;
      return {
        ...session,
        exercises: session.exercises.map((exercise, index) => {
          if (index !== exerciseIndex) return exercise;
          return {
            ...exercise,
            exerciseId: alternative.exerciseId,
            name: alternative.name,
            videoPath: alternative.videoPath,
            // Sin backend de firma disponible offline: la descarga/firma de
            // video de un sustituto queda fuera de esta fase.
            videoUrl: null,
            lastWeightKg: null,
            bestWeightKg: null,
            record: null,
            sets: exercise.sets.map((set) => ({ ...set, weightKg: null })),
            alternatives: exercise.alternatives.filter(
              (option) => option.exerciseId !== alternative.exerciseId,
            ),
          };
        }),
      };
    }),
  };
}

export default function GymScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Tocar esta pestaña estando en ella regresa el scroll hasta arriba.
  const scrollRef = useScrollTop();

  const [week, setWeek] = useState<WeekView | null>(null);
  const [today, setToday] = useState(todayISO());
  const [phase, setPhase] = useState<"loading" | "onboarding" | "empty" | "ready">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [draft, setDraft] = useState<SessionSyncInput | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  /** Día que se está mirando abajo de "Tu semana". Arranca en hoy; tocar otra
   * fila de la semana la mueve, pero solo la sesión de HOY admite captura. */
  const [selectedDate, setSelectedDate] = useState(today);

  const session = useMemo<SessionView | null>(
    () => week?.sessions.find((entry) => entry.date === today) ?? null,
    [week, today],
  );

  const viewedSession = useMemo<SessionView | null>(
    () => week?.sessions.find((entry) => entry.date === selectedDate) ?? null,
    [week, selectedDate],
  );
  const isViewingToday = selectedDate === today;

  // Cada vez que "hoy" se refresca de verdad (carga inicial, reintento tras
  // reconexión) la vista vuelve a hoy — así no se queda "atorada" en el día
  // que se estaba mirando en una sesión anterior de la pantalla.
  useEffect(() => {
    setSelectedDate(today);
  }, [today]);

  // "Hoy tengo menos tiempo": minutos elegidos y la llamada en vuelo.
  const [trimming, setTrimming] = useState(false);
  const [trimError, setTrimError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    setLoadError(null);
    try {
      const fresh = await getTrainingWeek();
      setWeek(fresh);
      setToday(fresh.today);
      await saveWeek(fresh.weekStart, fresh);
      setPhase("ready");
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setPhase("onboarding");
        return;
      }
      const cached = await getCachedWeek(mondayISO());
      if (cached) {
        setWeek(cached);
        setToday(todayISO());
        setPhase("ready");
      } else {
        setLoadError(
          error instanceof ApiError ? error.message : "Sin conexión y sin rutina guardada todavía",
        );
        setPhase("empty");
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Indicador de red propio de esta pantalla (el badge de "sin conexión"); el
  // trigger real de la cola vive en training-sync.ts y corre aparte.
  useEffect(() => {
    NetInfo.fetch().then((state) => {
      setOnline(Boolean(state.isConnected) && state.isInternetReachable !== false);
    });
    const unsubscribe = NetInfo.addEventListener((state) => {
      setOnline(Boolean(state.isConnected) && state.isInternetReachable !== false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribePendingCount(setPendingCount);
    void refreshPendingCount();
    return unsubscribe;
  }, []);

  // La sesión de hoy trae su propio borrador pendiente, si ya se capturó algo.
  useEffect(() => {
    if (!session) {
      setDraft(null);
      return;
    }
    void (async () => {
      const pending = await getPendingSession(session.workoutId);
      setDraft(pending?.payload ?? emptySessionInput(session.workoutId));
    })();
  }, [session?.workoutId]);

  const persist = useCallback(async (next: SessionSyncInput) => {
    setDraft(next);
    // Local primero, siempre: la escritura en SQLite nunca espera a la red.
    await upsertPendingSession(next.workoutId, next);
    await refreshPendingCount();
    void syncAndNotify();
  }, []);

  const handleMarkSet = useCallback(
    (exerciseIndex: number, setIndex: number, values: { reps: number; weightKg: number | null } | null) => {
      if (!session || !draft) return;
      const exercise = session.exercises[exerciseIndex];
      const target = exercise?.sets[setIndex];
      if (!exercise || !target) return;

      const id = `${session.workoutId}:${exerciseIndex}:${setIndex}`;
      const nextSets =
        values === null
          ? draft.sets.filter((set) => set.clientId !== id)
          : upsertByClientId(draft.sets, {
              clientId: id,
              exerciseId: exercise.exerciseId,
              exerciseName: exercise.name,
              setIndex,
              targetReps: target.reps,
              reps: values.reps,
              weightKg: values.weightKg,
              rpe: null,
              warmup: target.warmup,
              performedAt: new Date().toISOString(),
            });

      void persist({ ...draft, sets: nextSets });
    },
    [session, draft, persist],
  );

  const handleSubstitute = useCallback(
    (exerciseIndex: number, alternative: ExerciseAlternative) => {
      if (!week || !session || !draft) return;

      const nextWeek = weekWithSubstitute(week, session.workoutId, exerciseIndex, alternative);
      setWeek(nextWeek);
      void saveWeek(nextWeek.weekStart, nextWeek);

      // Lo capturado en ese lugar era de la otra máquina: se va con ella.
      const prefix = exercisePrefix(session.workoutId, exerciseIndex);
      const nextSets = draft.sets.filter((set) => !set.clientId.startsWith(prefix));
      const nextSubstitutions = upsertSubstitution(draft.substitutions, exerciseIndex, alternative.exerciseId);

      void persist({ ...draft, sets: nextSets, substitutions: nextSubstitutions });
    },
    [week, session, draft, persist],
  );

  const totals = useMemo(() => {
    if (!session || !draft) return { volume: 0, sets: 0, prs: [] as string[] };
    let volume = 0;
    let sets = 0;
    const prs: string[] = [];

    session.exercises.forEach((exercise, exerciseIndex) => {
      let bestToday = 0;
      exercise.sets.forEach((target, setIndex) => {
        const id = `${session.workoutId}:${exerciseIndex}:${setIndex}`;
        const entry = draft.sets.find((set) => set.clientId === id);
        if (!entry || target.warmup) return;
        sets += 1;
        volume += (entry.weightKg ?? 0) * entry.reps;
        if ((entry.weightKg ?? 0) > bestToday) bestToday = entry.weightKg ?? 0;
      });
      if (bestToday > 0 && bestToday > (exercise.bestWeightKg ?? 0)) prs.push(exercise.name);
    });

    return { volume: Math.round(volume), sets, prs };
  }, [session, draft]);

  async function completeSession() {
    if (!draft) return;
    await persist({ ...draft, completedAt: new Date().toISOString() });
    setSummaryOpen(false);
    setOpenIndex(null);
  }

  if (phase === "loading") return <LoadingState label="Cargando tu semana..." />;

  if (phase === "onboarding") {
    return (
      <View style={styles.center}>
        <EmptyState message="Tu coach todavía está preparando tu plan de entrenamiento." />
      </View>
    );
  }

  if (phase === "empty") {
    return <ErrorState message={loadError ?? "No se pudo cargar tu rutina"} onRetry={load} />;
  }

  const exercisesDone = session
    ? session.exercises.filter((exercise, exerciseIndex) =>
        exercise.sets.every((_, setIndex) =>
          draft?.sets.some((set) => set.clientId === `${session.workoutId}:${exerciseIndex}:${setIndex}`),
        ),
      ).length
    : 0;

  /**
   * Recorta (o restaura) la sesión de hoy y recarga la semana.
   *
   * Se recarga en vez de parchar el estado local porque el plan nuevo trae
   * ejercicios, esquemas y pesos sugeridos distintos: reconstruirlo aquí sería
   * duplicar en el cliente lo que el generador ya decidió.
   */
  async function recortarSesion(minutes: number | null) {
    if (!session || trimming) return;
    setTrimming(true);
    setTrimError(null);
    try {
      await trimSession(session.workoutId, minutes);
      await load();
    } catch (error) {
      setTrimError(
        error instanceof ApiError ? error.message : "No se pudo ajustar tu sesión",
      );
    } finally {
      setTrimming(false);
    }
  }

  // Las sesiones de otra disciplina del día que se está mirando. Un día puede
  // traer hasta dos (Fase 7): gym + una, o dos sin gym. `ordenarBloquesDelDia`
  // decide en qué posición va cada una respecto del gimnasio.
  const otrasSeleccionadas = week?.otherSessions?.filter((entry) => entry.date === selectedDate) ?? [];
  const bloquesSeleccionados = ordenarBloquesDelDia(viewedSession, otrasSeleccionadas);
  const diaCombinado = bloquesSeleccionados.length === 2;

  // El bloque de gimnasio es siempre el mismo trozo de UI (botón "empezar" +
  // recorte + lista/captura); lo que cambia es DÓNDE cae respecto del bloque
  // de la otra disciplina, y eso ya lo resolvió `ordenarBloquesDelDia`.
  const bloqueNodos = bloquesSeleccionados.map((bloque, index) => {
    if (bloque.tipo === "otra") {
      return (
        <OtraDisciplina
          key={`otra-${bloque.data.discipline}-${index}`}
          session={bloque.data}
          isToday={isViewingToday}
        />
      );
    }

    return (
      <Fragment key="gym">
        {isViewingToday && session && session.completedAt === null && (
          <Pressable
            onPress={() => router.push({ pathname: "/en-vivo", params: { workoutId: session.workoutId } })}
            style={styles.enVivo}
          >
            <PlayCircle size={22} color={colors.pergamino} strokeWidth={2} />
            <View style={{ flex: 1 }}>
              <Text style={styles.enVivoTitulo}>Empezar la sesión</Text>
              <Text style={styles.enVivoDetalle}>
                Serie por serie, con el descanso corriendo solo
              </Text>
            </View>
          </Pressable>
        )}

        {isViewingToday && session && session.completedAt === null && (
          <TiempoDeHoy
            session={session}
            working={trimming}
            error={trimError}
            onTrim={recortarSesion}
          />
        )}

        {openIndex === null || !draft || !session ? (
          <>
            <View style={styles.header}>
              <Text style={styles.title}>{viewedSession!.muscleGroup}</Text>
              <Text style={styles.meta}>
                {viewedSession!.schemeLabel} · {viewedSession!.exercises.length} ejercicios
                {viewedSession!.cardioMinutes ? ` · ${viewedSession!.cardioMinutes} min de cardio al final` : ""}
              </Text>
              {viewedSession!.cycleNote && <Text style={styles.note}>{viewedSession!.cycleNote}</Text>}
              {viewedSession!.readinessNote && <Parrafo style={styles.note}>🌙 {viewedSession!.readinessNote}</Parrafo>}
            </View>

            {!isViewingToday && (
              <View style={styles.viewingNotice}>
                <Parrafo style={styles.viewingNoticeText}>
                  Estás viendo el {weekdayLong(selectedDate)}; la captura solo se habilita en la sesión de hoy.
                </Parrafo>
              </View>
            )}

            <View style={styles.list}>
              {viewedSession!.exercises.map((exercise, exIndex) => {
                const done = isViewingToday
                  ? exercise.sets.filter((_, setIndex) =>
                      draft?.sets.some(
                        (set) => set.clientId === `${viewedSession!.workoutId}:${exIndex}:${setIndex}`,
                      ),
                    ).length
                  : 0;
                const complete = isViewingToday && done === exercise.sets.length;

                return (
                  <Pressable
                    key={`${exercise.name}-${exIndex}`}
                    onPress={() => {
                      if (isViewingToday) setOpenIndex(exIndex);
                    }}
                    disabled={!isViewingToday}
                    style={[styles.exerciseRow, !isViewingToday && styles.exerciseRowDisabled]}
                  >
                    <View style={[styles.exerciseDot, complete && styles.exerciseDotDone]}>
                      <Text style={[styles.exerciseDotText, complete && styles.exerciseDotTextDone]}>
                        {complete ? "✓" : "○"}
                      </Text>
                    </View>
                    <View style={styles.exerciseInfo}>
                      <Text style={styles.exerciseName}>{exercise.name}</Text>
                      <Text style={styles.exerciseMeta}>
                        {exercise.schemeLabel}
                        {isViewingToday ? ` · ${done}/${exercise.sets.length} series` : ` · ${exercise.sets.length} series`}
                      </Text>
                    </View>
                    {isViewingToday && <Text style={styles.chevron}>›</Text>}
                  </Pressable>
                );
              })}
            </View>

            {isViewingToday && (
              <Pressable
                onPress={() => setSummaryOpen(true)}
                disabled={totals.sets === 0}
                style={[styles.finishButton, totals.sets === 0 && styles.finishButtonDisabled]}
              >
                <Text style={styles.finishButtonText}>
                  TERMINAR SESIÓN ({exercisesDone}/{viewedSession!.exercises.length})
                </Text>
              </Pressable>
            )}
          </>
        ) : (
          <ExerciseCapture
            key={`${openIndex}:${session.exercises[openIndex]?.name ?? ""}`}
            exercise={session.exercises[openIndex]!}
            exerciseIndex={openIndex}
            workoutId={session.workoutId}
            savedSets={draft.sets}
            online={online}
            onMarkSet={(setIndex, values) => handleMarkSet(openIndex, setIndex, values)}
            onSubstitute={(alternative) => handleSubstitute(openIndex, alternative)}
            onBack={() => setOpenIndex(null)}
            onNext={() => {
              if (openIndex + 1 < session.exercises.length) setOpenIndex(openIndex + 1);
              else {
                setOpenIndex(null);
                setSummaryOpen(true);
              }
            }}
            isLast={openIndex + 1 === session.exercises.length}
          />
        )}
      </Fragment>
    );
  });

  return (
    <ScrollView ref={scrollRef} style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.screenHeader}>
        <EngraneAjustes seccion="entrenamiento" />
      </View>

      <ConnectionBadge online={online} pendingCount={pendingCount} onRetry={() => void syncAndNotify()} />

      {week && (
        <WeekOverview
          week={week}
          today={today}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
      )}

      {diaCombinado && <OrdenDelDia bloques={bloquesSeleccionados} />}

      {bloqueNodos}

      {/* Descanso de verdad: sin gym y sin ninguna otra disciplina ese día.
          Con dos bloques la tarjeta de arriba y las de cada uno ya cuentan
          toda la historia, así que este mensaje genérico no hace falta. */}
      {!viewedSession && bloquesSeleccionados.length < 2 && (
        <RestDay week={week} selectedDate={selectedDate} isToday={isViewingToday} />
      )}

      {session && (
        <SummaryModal
          open={summaryOpen}
          onClose={() => setSummaryOpen(false)}
          muscleGroup={session.muscleGroup}
          totals={totals}
          online={online}
          onConfirm={() => void completeSession()}
        />
      )}
    </ScrollView>
  );
}

function ConnectionBadge({
  online,
  pendingCount,
  onRetry,
}: {
  online: boolean;
  pendingCount: number;
  onRetry: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (online && pendingCount === 0) return null;

  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>
        {online
          ? `${pendingCount} ${pendingCount === 1 ? "sesión pendiente" : "sesiones pendientes"} de subir`
          : "Sin conexión — trabajando de local"}
      </Text>
      {online && (
        <Pressable onPress={onRetry} hitSlop={8}>
          <Text style={styles.badgeRetry}>Reintentar</Text>
        </Pressable>
      )}
    </View>
  );
}

/**
 * "Tu semana": lunes→domingo de un vistazo, para que la atleta entienda la
 * combinación de grupos musculares que salió de su onboarding antes de
 * meterse al detalle del día. Va arriba de la sesión — es el mapa; lo de
 * abajo es el terreno. Tocar una fila con sesión cambia `selectedDate`, y
 * la lista de ejercicios de abajo se redibuja para ese día.
 */
/**
 * "Hoy tengo menos tiempo".
 *
 * La sesión se vuelve a armar para los minutos que de verdad hay: se queda lo
 * compuesto y se suelta el accesorio, que es el orden que cualquiera seguiría
 * con prisa. La sesión queda marcada como recortada, no como incompleta —
 * cerrar bien 25 minutos es un día entrenado.
 */
function TiempoDeHoy({
  session,
  working,
  error,
  onTrim,
}: {
  session: SessionView;
  working: boolean;
  error: string | null;
  onTrim: (minutes: number | null) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [abierto, setAbierto] = useState(false);
  const recortada = session.trimmedMinutes !== null;

  return (
    <>
      <ScoreCard
        icon={Timer}
        tint={colors.champan}
        title={recortada ? "Sesión recortada" : "¿Cuánto tiempo tienes?"}
        summary={
          recortada
            ? `${nombreDelRecorte(session.trimmedMinutes)} · ${session.exercises.length} ejercicios`
            : `${session.exercises.length} ejercicios · si hoy no te da el tiempo, se reacomoda`
        }
        status={recortada ? { label: "Recortada", tone: "warn" } : null}
        infoTip={
          <InfoTip titulo="Cómo recorta la sesión">
            <TextoInfo>
              Se queda lo compuesto y se suelta el accesorio. Queda marcada como recortada, no como
              incompleta: cerrar bien una sesión corta es un día entrenado.
            </TextoInfo>
          </InfoTip>
        }
        onPress={() => setAbierto(true)}
      />

      <Modal visible={abierto} transparent animationType="fade" onRequestClose={() => setAbierto(false)}>
        <Pressable style={styles.fondo} onPress={() => setAbierto(false)}>
          <Pressable style={styles.hoja} onPress={() => {}}>
            <Text style={styles.hojaTitulo}>¿Cuánto tiempo tienes?</Text>

            <View style={styles.trimLista}>
              {RECORTES.map((opcion) => {
                const activo = session.trimmedMinutes === opcion.minutos;
                return (
                  <Pressable
                    key={opcion.nombre}
                    disabled={working}
                    onPress={() => {
                      onTrim(opcion.minutos);
                      setAbierto(false);
                    }}
                    style={[
                      styles.trimOpcion,
                      activo && styles.trimOpcionOn,
                      working && styles.trimChipDisabled,
                    ]}
                  >
                    <Text style={[styles.trimOpcionNombre, activo && styles.trimOpcionNombreOn]}>
                      {opcion.nombre}
                    </Text>
                    <Text style={styles.trimOpcionDetalle}>{opcion.detalle}</Text>
                  </Pressable>
                );
              })}

              {recortada && (
                <Pressable
                  disabled={working}
                  onPress={() => {
                    onTrim(null);
                    setAbierto(false);
                  }}
                  style={[styles.trimOpcion, working && styles.trimChipDisabled]}
                >
                  <Text style={styles.trimOpcionNombre}>Rutina completa</Text>
                  <Text style={styles.trimOpcionDetalle}>Como venía en tu plan</Text>
                </Pressable>
              )}
            </View>

            {error && <Text style={styles.trimError}>{error}</Text>}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/**
 * La sesión de otra disciplina del día.
 *
 * Cerrada ya contesta —qué disciplina, cuánto y por qué cayó ahí— y abierta
 * trae el plan bloque por bloque cuando la app sabe prescribirlo. Hoy solo la
 * natación: para las demás se reserva el día y se dice para qué es, en vez de
 * inventar una sesión que nadie validó.
 */
function OtraDisciplina({
  session,
  isToday,
}: {
  session: OtherSessionView;
  isToday: boolean;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [abierto, setAbierto] = useState(false);
  const nombre = DISCIPLINE_LABELS[session.discipline];
  const Icono = iconoDe(session.discipline);
  const protocolo = protocoloDe(session.sesion?.cardio);
  const [unidad, setUnidad] = useState<UnidadVelocidad>(() => unidadDe(session.sesion?.cardio));

  /** Cambia la unidad en pantalla de inmediato y la guarda en las preferencias de cardio. */
  function cambiarUnidad(siguiente: UnidadVelocidad) {
    setUnidad(siguiente);
    guardarUnidadVelocidad(siguiente).catch(() => {
      // Sin señal: se ve en la unidad elegida y la próxima vez se vuelve a intentar.
    });
  }

  return (
    <>
      <ScoreCard
        icon={Icono}
        tint={colors.paloRosa}
        title={isToday ? `Hoy también: ${nombre.toLowerCase()}` : nombre}
        summary={
          session.sesion
            ? `${session.sesion.cargaTotal} ${session.sesion.unidad} · ${session.sesion.focus} · ${session.minutes} min`
            : `${session.minutes} min · la app registra la sesión, no la prescribe`
        }
        status={session.sesion?.deload ? { label: "Descarga", tone: "warn" } : null}
        infoTip={
          session.sesion ? undefined : (
            <InfoTip titulo="Por qué no hay plan todavía">
              <TextoInfo>
                Todavía no armamos la sesión de {nombre.toLowerCase()}: el día está reservado y lo
                que entrenes se registra desde el reloj o a mano. La prescripción por disciplina va
                llegando una a una.
              </TextoInfo>
            </InfoTip>
          )
        }
        onPress={() => setAbierto(true)}
      />

      <Modal visible={abierto} transparent animationType="fade" onRequestClose={() => setAbierto(false)}>
        <Pressable style={styles.fondo} onPress={() => setAbierto(false)}>
          <Pressable style={styles.hoja} onPress={() => {}}>
            <ScrollView contentContainerStyle={styles.hojaScroll}>
              <Text style={styles.hojaTitulo}>{nombre}</Text>
              <Text style={styles.swimNote}>{session.note}</Text>

              {protocolo ? (
                // N1: la caminadora HIIT se lee como la tabla de Mau, por
                // velocidad real; el chip km/h ↔ mph guarda la preferencia.
                <View style={styles.swimBlocks}>
                  <ProtocoloHiit protocolo={protocolo} unidad={unidad} onUnidad={cambiarUnidad} />
                  {session.sesion!.notes.map((note) => (
                    <Text key={note} style={styles.swimNote}>
                      {note}
                    </Text>
                  ))}
                </View>
              ) : session.sesion ? (
                <View style={styles.swimBlocks}>
                  {session.sesion.blocks.map((block) => (
                    <View key={block.title} style={styles.swimBlock}>
                      <View style={styles.swimBlockHead}>
                        <Text style={styles.swimBlockTitle}>{block.title}</Text>
                        {block.carga !== null && (
                          <Text style={styles.swimBlockMeters}>
                            {block.carga} {session.sesion!.unidad}
                          </Text>
                        )}
                      </View>
                      <Text style={styles.swimBlockDetail}>
                        {block.detail}
                        {block.restSeconds !== null ? ` · ${block.restSeconds} s de descanso` : " · continuo"}
                      </Text>
                      <Text style={styles.swimBlockNote}>{block.note}</Text>
                    </View>
                  ))}

                  {session.sesion.notes.map((note) => (
                    <Text key={note} style={styles.swimNote}>
                      {note}
                    </Text>
                  ))}
                </View>
              ) : null}

              {/* Dos maneras de cerrar el ciclo, y el orden importa: entrenarla
                  con el cronómetro es lo que da duración real y pulso por
                  tramo; registrarla a mano es para cuando ya pasó. */}
              {isToday && (
                <Pressable
                  onPress={() => {
                    setAbierto(false);
                    router.push({
                      pathname: "/sesion-libre",
                      // La disciplina va en el param: un día puede tener DOS
                      // sesiones con la misma fecha, y sin ella "empezar"
                      // siempre abriría la primera.
                      params: { fecha: session.date, discipline: session.discipline },
                    });
                  }}
                  style={styles.enVivoOtra}
                >
                  <PlayCircle size={20} color={colors.pergamino} strokeWidth={2} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.enVivoTitulo}>Empezar la sesión</Text>
                    <Text style={styles.enVivoDetalle}>
                      Con cronómetro, tramo por tramo y el pulso de tu reloj
                    </Text>
                  </View>
                </Pressable>
              )}

              <Pressable
                onPress={() => {
                  setAbierto(false);
                  router.push({
                    pathname: "/actividad",
                    params: { discipline: session.discipline, minutes: `${session.minutes}` },
                  });
                }}
                style={styles.registrarOtra}
              >
                <Text style={styles.registrarOtraTexto}>
                  {isToday ? "Ya la hice: registrarla a mano" : "Registrar esta sesión"}
                </Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function WeekOverview({
  week,
  today,
  selectedDate,
  onSelectDate,
}: {
  week: WeekView;
  today: string;
  selectedDate: string;
  onSelectDate: (date: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDaysISO(week.weekStart, index)),
    [week.weekStart],
  );

  const hechas = week.sessions.filter((entry) => entry.completedAt !== null).length;
  const hoy = week.sessions.find((entry) => entry.date === today) ?? null;
  const otras = week.otherSessions ?? [];
  const hoyOtra = otras.find((entry) => entry.date === today) ?? null;
  const resumen = [
    `${week.sessions.length} ${week.sessions.length === 1 ? "día" : "días"} de pesas`,
    ...(otras.length > 0 ? [`${otras.length} de otras disciplinas`] : []),
    `${hechas} ${hechas === 1 ? "hecho" : "hechos"}`,
    hoy
      ? `hoy: ${hoy.muscleGroup.toLowerCase()}`
      : hoyOtra
        ? `hoy: ${DISCIPLINE_LABELS[hoyOtra.discipline].toLowerCase()}`
        : "hoy: descanso",
  ].join(" · ");

  const status =
    hechas === week.sessions.length && week.sessions.length > 0
      ? { label: "Completa", tone: "ok" as const }
      : hechas > 0
        ? { label: "En curso", tone: "warn" as const }
        : null;

  return (
    <View style={styles.weekCard}>
      <View style={styles.weekHead}>
        <View style={[styles.weekIconRing, { backgroundColor: withAlpha(colors.paloRosa, 0.18) }]}>
          <CalendarRange size={22} color={colors.paloRosa} strokeWidth={2} />
        </View>
        <View style={styles.weekHeadText}>
          <Text style={styles.weekTitle}>Planeación semanal</Text>
          <Text style={styles.weekSummary}>{resumen}</Text>
        </View>
        {status && <Chip label={status.label} tone={status.tone === "ok" ? "champan" : "default"} selected />}
      </View>

      <View style={styles.weekList}>
        {days.map((date) => {
          const daySession = week.sessions.find((entry) => entry.date === date) ?? null;
          const dayOthers = week.otherSessions?.filter((entry) => entry.date === date) ?? [];
          const bloques = ordenarBloquesDelDia(daySession, dayOthers);
          // I1: la línea del día sale de la semana canónica del servidor —la
          // misma que el Resumen y Ajustes— con el "+ Cardio" incluido.
          const delPlan = diaDelPlan(week.plan, date);
          const isToday = date === today;
          const isSelected = date === selectedDate;
          const done = daySession?.completedAt != null;

          return (
            <Pressable
              key={date}
              onPress={() => onSelectDate(date)}
              style={[
                styles.weekRow,
                isSelected && !isToday && styles.weekRowSelected,
                isToday && styles.weekRowToday,
              ]}
            >
              <View style={styles.weekDateCol}>
                <Text style={styles.weekDayAbbr}>{weekdayAbbr(date)}</Text>
                <Text style={styles.weekDateShort}>{shortDateLabel(date)}</Text>
              </View>

              <View style={styles.weekInfo}>
                {bloques.length === 0 ? (
                  <Text style={styles.weekRest}>Descanso</Text>
                ) : delPlan?.gym ? (
                  <>
                    <Text style={styles.weekMuscle}>{partesDelDia(delPlan).titulo}</Text>
                    <Text style={styles.weekMeta}>
                      {partesDelDia(delPlan).detalle}
                      {daySession?.trimmedMinutes
                        ? ` · ${nombreDelRecorte(daySession.trimmedMinutes).toLowerCase()}`
                        : ""}
                    </Text>
                  </>
                ) : bloques.length === 2 ? (
                  // Dos bloques: el título es el orden completo del día
                  // ("Squash → Natación"), y el detalle de cada uno va junto,
                  // en el mismo orden.
                  <>
                    <Text style={styles.weekMuscle}>{lineaDelDia(bloques)}</Text>
                    <Text style={styles.weekMeta}>
                      {bloques.map((bloque) => detalleDeBloque(bloque)).join(" · ")}
                    </Text>
                  </>
                ) : bloques[0]!.tipo === "gym" ? (
                  <>
                    <Text style={styles.weekMuscle}>{daySession!.muscleGroup}</Text>
                    <Text style={styles.weekMeta}>
                      {daySession!.exercises.length} ejercicios · {daySession!.schemeLabel}
                      {daySession!.cardioMinutes ? ` · ${daySession!.cardioMinutes} min cardio` : ""}
                      {daySession!.trimmedMinutes
                        ? ` · ${nombreDelRecorte(daySession!.trimmedMinutes).toLowerCase()}`
                        : ""}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.weekMuscle}>{DISCIPLINE_LABELS[bloques[0]!.data.discipline]}</Text>
                    <Text style={styles.weekMeta}>{detalleDeBloque(bloques[0]!)}</Text>
                  </>
                )}
              </View>

              <View style={styles.weekStatus}>
                {done && <Chip label="Hecho" tone="champan" selected />}
                {isToday && <Chip label="Hoy" selected />}
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** El detalle corto de un bloque, para la fila de "Tu semana". */
function detalleDeBloque(bloque: BloqueDelDia<SessionView>): string {
  if (bloque.tipo === "gym") {
    const sesion = bloque.data;
    return `${sesion.exercises.length} ejercicios${
      sesion.cardioMinutes ? ` · ${sesion.cardioMinutes} min cardio` : ""
    }`;
  }
  const otra = bloque.data;
  return otra.sesion
    ? `${otra.sesion.cargaTotal} ${otra.sesion.unidad} · ${otra.sesion.focus.toLowerCase()}`
    : `${otra.minutes} min`;
}

/**
 * El orden del día completo, cuando hoy hay dos bloques.
 *
 * El PORQUÉ ya lo escribió el servidor en `note` de cada sesión de otra
 * disciplina ("la alberca al final para soltar", "squash primero con piernas
 * frescas"); esta tarjeta solo lo sube arriba, antes de que haya que abrir
 * nada para saber en qué orden va el día.
 */
function OrdenDelDia({ bloques }: { bloques: Array<BloqueDelDia<SessionView>> }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const notas = Array.from(
    new Set(
      bloques
        .filter((bloque): bloque is Extract<(typeof bloques)[number], { tipo: "otra" }> => bloque.tipo === "otra")
        .map((bloque) => bloque.data.note)
        .filter((nota) => nota.length > 0),
    ),
  );

  return (
    <View style={styles.ordenDelDia}>
      <Text style={styles.ordenDelDiaTitulo}>Hoy en este orden: {lineaDelDia(bloques)}</Text>
      {notas.map((nota) => (
        <Parrafo key={nota} style={styles.ordenDelDiaNota}>
          {nota}
        </Parrafo>
      ))}
    </View>
  );
}

function RestDay({
  week,
  selectedDate,
  isToday,
}: {
  week: WeekView | null;
  selectedDate: string;
  isToday: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const next = week?.sessions.find((entry) => entry.date > selectedDate) ?? null;
  // Un día con alberca no es un día de descanso: decirlo así sería mentirle a
  // quien ya tiene la sesión arriba en la pantalla.
  const otra = week?.otherSessions?.find((entry) => entry.date === selectedDate) ?? null;

  return (
    <View style={styles.restDay}>
      <Text style={styles.title}>
        {otra
          ? isToday
            ? "Hoy no toca gimnasio"
            : `Sin gimnasio el ${weekdayLong(selectedDate)}`
          : isToday
            ? "Hoy toca descanso"
            : `Descanso el ${weekdayLong(selectedDate)}`}
      </Text>
      <Parrafo style={styles.restMessage}>
        {otra
          ? `Tu sesión de ${DISCIPLINE_LABELS[otra.discipline].toLowerCase()} está arriba. Las pesas vuelven el siguiente día que toque.`
          : "El descanso es parte del plan: el músculo se construye fuera del gimnasio."}
      </Parrafo>

      {next && (
        <View style={styles.nextCard}>
          <Text style={styles.nextLabel}>Lo que sigue</Text>
          <Text style={styles.nextGroup}>{next.muscleGroup}</Text>
          <View style={styles.nextChips}>
            {next.exercises.slice(0, 6).map((exercise) => (
              <View key={exercise.name} style={styles.nextChip}>
                <Text style={styles.nextChipText}>{exercise.name}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function SummaryModal({
  open,
  onClose,
  muscleGroup,
  totals,
  online,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  muscleGroup: string;
  totals: { volume: number; sets: number; prs: string[] };
  online: boolean;
  onConfirm: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={open} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>Sesión terminada</Text>
          <Text style={styles.modalSubtitle}>{muscleGroup}</Text>

          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Volumen</Text>
              <Text style={styles.statValue}>{totals.volume.toLocaleString("es-MX")} kg</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Series</Text>
              <Text style={styles.statValue}>{totals.sets}</Text>
            </View>
          </View>

          {totals.prs.length > 0 && (
            <View style={styles.prSummary}>
              <Text style={styles.prSummaryTitle}>
                {totals.prs.length === 1 ? "¡Récord personal!" : "¡Récords personales!"}
              </Text>
              <Text style={styles.prSummaryText}>{totals.prs.join(" · ")}</Text>
            </View>
          )}

          {!online && (
            <Parrafo style={styles.modalSubtitle}>
              Sin conexión: quedó guardado en el teléfono y se sube solo cuando vuelva la red.
            </Parrafo>
          )}

          <Pressable onPress={onConfirm} style={styles.confirmButton}>
            <Text style={styles.confirmButtonText}>GUARDAR</Text>
          </Pressable>
          <Pressable onPress={onClose} style={styles.modalClose}>
            <Text style={styles.modalCloseText}>SEGUIR CAPTURANDO</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  // Sin título propio -la semana ya se presenta sola en WeekOverview-, solo
  // el engrane alineado a la derecha.
  screenHeader: { flexDirection: "row", justifyContent: "flex-end" },
  enVivo: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.guinda,
    borderRadius: radius.xxl,
    padding: spacing.lg,
  },
  enVivoTitulo: { fontFamily: fonts.sansBold, ...typeScale.heading, color: colors.pergamino },
  enVivoDetalle: { fontFamily: fonts.sans, ...typeScale.bodySm, color: withAlpha(colors.pergamino, 0.85) },
  trimLista: { gap: spacing.sm, marginTop: spacing.md },
  trimOpcion: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: 2,
  },
  trimOpcionOn: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
  trimOpcionNombre: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.marfil },
  trimOpcionNombreOn: { color: colors.pergamino },
  trimOpcionDetalle: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
  enVivoOtra: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.md,
    backgroundColor: colors.guinda,
    borderWidth: 1,
    borderColor: colors.guindaLight,
    borderRadius: radius.xxl,
    padding: spacing.lg,
  },
  registrarOtra: {
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    alignItems: "center",
  },
  registrarOtraTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.champan },
  swimBlocks: { gap: spacing.md, marginTop: spacing.md },
  swimBlock: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: withAlpha(colors.paloRosa, 0.06),
    padding: spacing.md,
    gap: 2,
  },
  swimBlockHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  swimBlockTitle: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.marfil },
  swimBlockMeters: { fontFamily: fonts.sansSemiBold, ...typeScale.bodySm, color: colors.champan },
  swimBlockDetail: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
  swimBlockNote: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
  swimNote: {
    fontFamily: fonts.sans,
    ...typeScale.bodySm,
    color: colors.paloRosaLight,
    marginTop: spacing.sm,
  },
  screen: { flex: 1, backgroundColor: colors.obsidiana },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.huge },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xxl },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.cardBg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  badgeText: { flex: 1, fontFamily: fonts.sans, ...typeScale.label, color: colors.paloRosaLight },
  badgeRetry: { fontFamily: fonts.sansSemiBold, ...typeScale.label, letterSpacing: 1.5, color: colors.champan },
  trimRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  trimChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.cardBg,
  },
  trimChipSelected: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
  trimChipDisabled: { opacity: 0.5 },
  trimChipText: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
  trimChipTextSelected: { color: colors.pergamino },
  trimError: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.error },
  fondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" },
  hoja: {
    maxHeight: "85%",
    backgroundColor: colors.cardBg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
  },
  hojaScroll: { gap: spacing.sm },
  hojaTitulo: {
    fontFamily: fonts.sansBold,
    ...typeScale.heading,
    color: colors.marfil,
    marginBottom: spacing.sm,
  },
  weekCard: {
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.cardBg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  weekHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  weekIconRing: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  weekHeadText: { flex: 1, gap: 2 },
  weekTitle: { fontFamily: fonts.sansSemiBold, ...typeScale.subheading, color: colors.marfil },
  weekSummary: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
  weekList: { gap: spacing.sm },
  weekRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  weekRowSelected: { backgroundColor: withAlpha(colors.paloRosa, 0.08) },
  weekRowToday: { borderColor: colors.guinda, backgroundColor: withAlpha(colors.guinda, 0.14) },
  weekDateCol: { width: 46, alignItems: "flex-start" },
  weekDayAbbr: { fontFamily: fonts.sansSemiBold, ...typeScale.label, letterSpacing: 1.5, color: colors.paloRosa },
  weekDateShort: {
    fontFamily: fonts.sansSemiBold,
    ...typeScale.label,
    letterSpacing: 1,
    color: colors.paloRosaLight,
    marginTop: 2,
  },
  weekInfo: { flex: 1, gap: 2 },
  weekMuscle: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.marfil },
  weekMeta: { fontFamily: fonts.sans, ...typeScale.label, color: colors.paloRosaLight },
  weekRest: { fontFamily: fonts.serifItalic, ...typeScale.subheading, color: colors.paloRosaLight },
  weekStatus: { flexDirection: "row", gap: spacing.xs },
  viewingNotice: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  viewingNoticeText: { fontFamily: fonts.sans, ...typeScale.label, color: colors.paloRosaLight },
  ordenDelDia: {
    gap: 4,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: withAlpha(colors.paloRosa, 0.08),
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  ordenDelDiaTitulo: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.marfil },
  ordenDelDiaNota: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosaLight },
  header: { gap: spacing.xs },
  title: { fontFamily: fonts.sansSemiBold, ...typeScale.title, color: colors.marfil },
  meta: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosaLight },
  note: {
    fontFamily: fonts.sans,
    ...typeScale.label,
    color: colors.paloRosaLight,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  list: { gap: spacing.sm },
  exerciseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  exerciseRowDisabled: { opacity: 0.5 },
  exerciseDot: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.cardBg,
    alignItems: "center",
    justifyContent: "center",
  },
  exerciseDotDone: { backgroundColor: colors.guinda },
  exerciseDotText: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.marfil },
  // pergamino: rol "texto sobre fondo de acento" — solo cuando el punto ya
  // pintó su fondo con guinda (ejercicio completo).
  exerciseDotTextDone: { color: colors.pergamino },
  exerciseInfo: { flex: 1, gap: 2 },
  exerciseName: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.marfil },
  exerciseMeta: { fontFamily: fonts.sans, ...typeScale.label, color: colors.paloRosaLight },
  chevron: { fontFamily: fonts.sans, ...typeScale.heading, color: colors.paloRosaLight },
  finishButton: {
    backgroundColor: colors.guinda,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  finishButtonDisabled: { opacity: 0.5 },
  // pergamino: rol "texto sobre fondo de acento" (aquí guinda, siempre).
  finishButtonText: { fontFamily: fonts.sansSemiBold, ...typeScale.label, letterSpacing: 3, color: colors.pergamino },
  restDay: { gap: spacing.lg, alignItems: "flex-start" },
  restMessage: { fontFamily: fonts.serifItalic, ...typeScale.subheading, color: colors.paloRosaLight },
  nextCard: {
    width: "100%",
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.cardBg,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  nextLabel: { fontFamily: fonts.sansSemiBold, ...typeScale.label, letterSpacing: 2, color: colors.paloRosa },
  nextGroup: { fontFamily: fonts.display, ...typeScale.subheading, color: colors.marfil },
  nextChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  nextChip: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  nextChipText: { fontFamily: fonts.sans, ...typeScale.label, color: colors.paloRosaLight },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  modalSheet: {
    width: "100%",
    backgroundColor: colors.obsidiana,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalTitle: { fontFamily: fonts.display, ...typeScale.heading, color: colors.marfil },
  modalSubtitle: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosaLight },
  statsRow: { flexDirection: "row", gap: spacing.md },
  statBox: { flex: 1, backgroundColor: colors.cardBg, borderRadius: radius.md, padding: spacing.md },
  statLabel: { fontFamily: fonts.sansSemiBold, ...typeScale.label, letterSpacing: 1.5, color: colors.paloRosa },
  statValue: { fontFamily: fonts.display, ...typeScale.heading, color: colors.marfil, marginTop: 4 },
  prSummary: {
    borderWidth: 1,
    borderColor: colors.champan,
    backgroundColor: withAlpha(colors.champan, 0.12),
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 4,
  },
  prSummaryTitle: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.champan },
  prSummaryText: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.marfil },
  confirmButton: {
    backgroundColor: colors.guinda,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  // pergamino: rol "texto sobre fondo de acento" (aquí guinda, siempre).
  confirmButtonText: { fontFamily: fonts.sansSemiBold, ...typeScale.label, letterSpacing: 3, color: colors.pergamino },
  modalClose: { alignItems: "center", paddingVertical: spacing.sm },
  modalCloseText: { fontFamily: fonts.sansSemiBold, ...typeScale.label, letterSpacing: 2, color: colors.paloRosa },
});
