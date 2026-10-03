import { useFocusEffect, useRouter } from "expo-router";
import {
  CalendarCheck,
  Dumbbell,
  Flame,
  Footprints,
  Moon,
  Pill,
  Plus,
  Ruler,
  UtensilsCrossed,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  ApiError,
  DISCIPLINE_LABELS,
  getActivities,
  getCheckins,
  getComidasLogRango,
  getDecision,
  getHealthDays,
  getHistoryTraining,
  getMe,
  getNotifications,
  getNutrition,
  getSuplementos,
  getTrainingToday,
  getTrainingWeek,
  markNotificationsRead,
  type Activity,
  type CheckInRow,
  type Decision,
  type HealthDayPayload,
  type MeResponse,
  type Notification,
  type OtherSessionView,
  type ProximoMensual,
  type TrainingTodayResponse,
  type NutritionResponse,
  type TodayCard,
} from "@/lib/api";
import { EngraneAjustes } from "@/components/EngraneAjustes";
import { esCardioConPlan } from "@/lib/cardio";
import { lineaCheckin } from "@/lib/analisis-checkin";
import { HeroCard } from "@/components/HeroCard";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { ScoreCard } from "@/components/ScoreCard";
import { StatRow } from "@/components/StatRow";
import { ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import { useScrollTop } from "@/lib/scroll-top";
import { refrescarAvisosDeComida } from "@/lib/avisos-comida";
import { bestStreak, currentStreak, todayISO, trainingDays } from "@/lib/streak";
import {
  fonts,
  radius,
  shadow,
  spacing,
  type as typeScale,
  type Palette,
} from "@/lib/theme";
import { CambiarBloque } from "@/components/CambiarBloque";
import { nombreDelRecorte, ordenarBloquesDelDia } from "@/lib/entrenamiento";
import { formatMealItem, pickNextMeal, syncWidgetData } from "@/lib/widget";
import { enviarResumenAlReloj, enviarSiguienteComidaAlReloj } from "@/lib/reloj-nativo";
import { comidasPendientesDesde, renglonesPlanos, type PlanParaSiguienteComida } from "@/lib/siguiente-comida";

/**
 * "Hoy" — la pantalla de lo que se hace en las próximas horas.
 *
 * La frontera con Resumen es dura: aquí solo entra lo que cambia lo que haces
 * HOY. Por eso no vive aquí la racha (no mueve nada de hoy), ni la lista de
 * súper, ni los menús completos de la semana, ni nada del check-in — todo eso
 * se resuelve en Nutrición o en Resumen. Lo que sí: la sesión de hoy, los
 * datos del reloj del día, la comida de hoy y lo que Coachy te diría ahorita.
 *
 * LEY DE DISEÑO: los bloques de sesión (`TodayTrainingCard`, en `HeroCard`)
 * son el corazón y se quedan siempre visibles. Todo lo demás —comida del día,
 * decisión de nutrición, notificaciones, actividades recientes— se compacta a
 * `ScoreCard` de una línea; el detalle de cada uno vive en su propia hoja
 * (`/comida-hoy`, `/decision`, `/actividades-recientes`). Nada se abre hacia
 * abajo dentro de esta pantalla.
 */

type HomeData = {
  me: MeResponse;
  decision: Decision | null;
  /** Contador al siguiente mensual, con la regla del servidor. */
  proximoMensual: ProximoMensual | null;
  nutrition: NutritionResponse | null;
  today: TodayCard | null;
  /**
   * Las sesiones de otra disciplina de hoy (Fase 7): un día puede traer
   * hasta dos (gym + una, o dos sin gym). `/training/today` solo declara la
   * primera que encuentra, así que aquí se completa con la semana cuando esa
   * carga sí tuvo éxito.
   */
  todayOthers: OtherSessionView[];
  notifications: Notification[];
  /**
   * Racha de entrenamiento. No se pinta en Hoy —vive en Resumen y en el
   * widget—, pero se calcula aquí porque Hoy es la pantalla que siempre se
   * abre, y el widget se quedaría sin actualizar si dependiera de que alguien
   * entre a Resumen.
   */
  streak: number;
  healthDays: HealthDayPayload[];
  checkIns: CheckInRow[];
  activities: Activity[];
  /** "1 de 3 · siguiente: omega-3 con la comida"; `null` si no toma nada o falló. */
  suplementos: { total: number; linea: string } | null;
};

/** true si el error de API es "onboarding incompleto" (403): no es una falla real. */
function isOnboardingIncomplete(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

/** Minutos → "7 h 20 min". Sin dato → null. */
function formatSleep(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest}`;
}

/** El día del reloj más reciente que traiga ese campo (un día puede venir a medias). */
function latestWith(
  days: HealthDayPayload[],
  field: "steps" | "sleepMin",
): number | null {
  const sorted = [...days].sort((a, b) => b.date.localeCompare(a.date));
  for (const day of sorted) {
    const value = day[field];
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

export default function HoyScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Tocar esta pestaña estando en ella regresa el scroll hasta arriba.
  const scrollRef = useScrollTop();
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const [me, decisionRes, notificationsRes, nutrition, today, week, history, checkinsRes, healthRes, activitiesRes, suplementosRes] =
        await Promise.all([
          getMe(),
          getDecision(),
          getNotifications(),
          getNutrition().catch((e) => (isOnboardingIncomplete(e) ? null : Promise.reject(e))),
          getTrainingToday().catch(
            (e): TrainingTodayResponse =>
              isOnboardingIncomplete(e)
                ? { today: null, otherSession: null }
                : (Promise.reject(e) as never),
          ),
          // `/training/today` solo trae UNA sesión de otra disciplina aunque
          // el día tenga dos (Fase 7); la semana sí trae las dos, y por eso se
          // pide aparte. Tolerante a fallar: sin ella se cae a la de `today`.
          getTrainingWeek().catch(() => null),
          // Las fuentes de la racha son tolerantes a fallar por separado: un
          // endpoint caído no debe tumbar la pantalla de Hoy.
          getHistoryTraining().catch(() => null),
          getCheckins().catch(() => null),
          getHealthDays().catch(() => null),
          getActivities().catch(() => null),
          // Las tomas del día: tolerante a fallar, como la racha.
          getSuplementos().catch(() => null),
        ]);

      const sources = {
        sessions: history?.sessions,
        activities: activitiesRes?.actividades,
      };
      const days = trainingDays(sources);
      const streak = currentStreak(days, todayISO());
      const todayCard = today?.today ?? null;
      const hoy = todayISO();
      const todayOthers = week
        ? (week.otherSessions ?? []).filter((entry) => entry.date === hoy)
        : today.otherSession
          ? [today.otherSession]
          : [];
      const primeraOtra = todayOthers[0] ?? null;

      setData({
        me,
        decision: decisionRes.decision,
        proximoMensual: decisionRes.proximoMensual ?? null,
        nutrition,
        today: todayCard,
        todayOthers,
        notifications: notificationsRes.notificaciones,
        streak,
        healthDays: healthRes?.dias ?? [],
        checkIns: checkinsRes?.checkIns ?? [],
        activities: activitiesRes?.actividades ?? [],
        suplementos: suplementosRes
          ? { total: suplementosRes.resumen.total, linea: suplementosRes.resumen.linea }
          : null,
      });
      setError(null);

      try {
        // `GET /nutrition` ya es el plan canónico (menú de hoy, horas de hoy,
        // tomas amarradas); `NutritionResponse` solo declara las llaves viejas.
        // Sin `hoy` (API viejo) se cae al menú 1 como antes.
        const plan = nutrition as (typeof nutrition & PlanParaSiguienteComida) | null;
        const pendientes = plan?.hoy ? comidasPendientesDesde(plan) : [];
        const legado = plan?.hoy ? null : pickNextMeal(nutrition?.menus[0]?.meals ?? []);
        const siguiente = pendientes[0] ?? null;
        const comidaLabel = siguiente?.nombre ?? legado?.label ?? null;
        const comidaHora = siguiente?.hora ?? legado?.timeHint ?? null;
        // TODOS los renglones: cada superficie decide cuántos caben y avisa
        // "+N más". Antes aquí se cortaba a 3 y el cuarto no llegaba a nadie.
        const comidaItems = siguiente ? renglonesPlanos(siguiente) : legado ? legado.items.map(formatMealItem) : null;
        syncWidgetData({
          racha: streak,
          mejorRacha: bestStreak(days),
          hoyGrupo:
            todayCard?.muscleGroup ??
            (primeraOtra ? DISCIPLINE_LABELS[primeraOtra.discipline] : "Descanso"),
          hoyEjercicios: todayCard?.exerciseCount ?? null,
          hoyEsquema: todayCard?.schemeLabel ?? null,
          hoyHecho: todayCard?.completed ?? false,
          comidaLabel,
          comidaHora,
          comidaItems,
          comidaDetalle: siguiente,
        });

        // El reloj recibe lo mismo, por el otro canal. Se manda desde aquí y
        // no desde una pantalla propia porque Hoy es la que siempre se abre:
        // colgarlo de Resumen dejaría la muñeca con datos de la semana pasada
        // para quien no entra ahí.
        enviarResumenAlReloj({
          hoy:
            todayCard?.muscleGroup ??
            (primeraOtra ? DISCIPLINE_LABELS[primeraOtra.discipline] : "Descanso"),
          ejercicios: todayCard?.exerciseCount ?? null,
          hecho: todayCard?.completed ?? false,
          comida: comidaLabel,
          comidaHora,
          comidaItems,
          racha: streak,
        });
        // La lista completa con tomas, para la pantalla "Siguiente comida"
        // del reloj y su complicación.
        enviarSiguienteComidaAlReloj(pendientes);
        // Los avisos de comida con los suplementos que aún faltan hoy: Hoy
        // es la pantalla que siempre se abre, así que se reprograman aquí
        // aunque no se entre a Nutrición.
        void refrescarAvisosDeComida(suplementosRes?.tomas);
      } catch {
        // Sincronizar el widget o el reloj nunca debe tumbar la pantalla de Hoy.
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cargar tu información");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Al volver de la hoja de Suplementos, solo su línea se refresca: recargar
  // todo Hoy por un check sería parpadeo sin necesidad.
  const primeraVez = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (primeraVez.current) {
        primeraVez.current = false;
        return;
      }
      getSuplementos()
        .then((res) =>
          setData((actual) =>
            actual ? { ...actual, suplementos: { total: res.resumen.total, linea: res.resumen.linea } } : actual,
          ),
        )
        .catch(() => {});
    }, []),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function dismissNotification(id: string) {
    setDismissed((prev) => new Set(prev).add(id));
    try {
      await markNotificationsRead([id]);
    } catch {
      // Si falla la marca en el servidor no revertimos: la app ya la ocultó
      // localmente y la próxima carga la trae de vuelta si de verdad no se marcó.
    }
  }

  if (!data && !error) return <LoadingState label="Cargando tu día..." />;
  if (!data && error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const { me, decision, nutrition, today, notifications } = data;
  const visibleNotifications = notifications.filter((n) => !dismissed.has(n.id));
  const firstName = me.profile?.displayName ?? "atleta";
  const steps = latestWith(data.healthDays, "steps");
  const sleep = formatSleep(latestWith(data.healthDays, "sleepMin"));
  const lastCheckIn = [...data.checkIns].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.paloRosa} />}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.greeting}>Hola, {firstName}</Text>
          {me.profile?.currentPhase && (
            <Text style={styles.phase}>{me.profile.currentPhase.replace(/_/g, " ")}</Text>
          )}
        </View>
        {/* Hoy vive del entrenamiento del día: su engrane va directo a esa
            sección, no al índice completo de Ajustes. */}
        <EngraneAjustes seccion="entrenamiento" />
      </View>

      {visibleNotifications.map((notification) => (
        <NotificationBanner
          key={notification.id}
          notification={notification}
          onDismiss={() => dismissNotification(notification.id)}
        />
      ))}

      <TodayTrainingCard
        today={today}
        otherSessions={data.todayOthers}
        onPress={() => router.push("/rutinas")}
        onReload={load}
      />

      {/* Lo que no se planeó pero cabe hoy: la disciplina base ya está en la
          semana, y esto es lo que se decide el día con el tiempo que sobra.
          Una línea, y el editor completo en su hoja. */}
      <ScoreCard
        icon={Plus}
        tint={colors.champan}
        title="Agregar bloque"
        summary="Con el tiempo que te sobre hoy"
        onPress={() => router.push("/bloque-dia")}
      />

      <View style={styles.stats}>
        <StatRow
          icon={Footprints}
          label="Actividad"
          value={steps === null ? "—" : steps.toLocaleString("es-MX")}
          unit={steps === null ? null : "pasos"}
          tint={colors.champan}
          onPress={() => router.push("/salud/pasos")}
        />
        <StatRow
          icon={Moon}
          label="Descanso"
          value={sleep ?? "—"}
          unit={null}
          tint={colors.paloRosa}
          onPress={() => router.push("/salud/descanso")}
        />
        <StatRow
          icon={Ruler}
          label="Cintura"
          value={lastCheckIn?.waistCm != null ? `${lastCheckIn.waistCm}` : "—"}
          unit={lastCheckIn?.waistCm != null ? "cm" : null}
          tint={colors.guindaLight}
          onPress={() => router.push("/salud/medidas")}
        />
      </View>

      <ComidaDeHoy nutrition={nutrition} onPress={() => router.push("/comida-hoy")} />

      {/* Las tomas del día en una línea; el marcado vive en su hoja. */}
      {data.suplementos && data.suplementos.total > 0 && (
        <ScoreCard
          icon={Pill}
          tint={colors.champan}
          title="Suplementos"
          summary={data.suplementos.linea}
          onPress={() => router.push("/suplementos-hoy")}
        />
      )}

      <DecisionCard decision={decision} onPress={() => router.push("/decision")} />

      {/* El check-in en una línea, con el contador del servidor: se reinicia
          solo al registrar el mensual, nunca por abrir la app. */}
      <ScoreCard
        icon={CalendarCheck}
        tint={colors.champan}
        title="Check-in"
        summary={lineaCheckin(data.proximoMensual)}
        onPress={() => router.push("/checkin")}
      />

      {/* Registrar a mano es la excepción desde que el reloj sube los
          entrenamientos solo: va al final, debajo de lo que sí hay que hacer
          hoy. El botón de registrar vive dentro de la hoja de zoom. */}
      <ActivitiesCard
        activities={data.activities}
        onPress={() => router.push("/actividades-recientes")}
      />
    </ScrollView>
  );
}

/**
 * Un aviso, de una línea. El título es lo que se ve siempre; el cuerpo —el
 * porqué, más largo— vive en un `InfoTip` que solo se abre si alguien lo
 * pide, y el aviso sigue accionable: se descarta con el mismo toque de
 * siempre, sin abrir ninguna hoja.
 */
function NotificationBanner({
  notification,
  onDismiss,
}: {
  notification: Notification;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerTitle} numberOfLines={1}>
        {notification.title}
      </Text>
      {notification.body ? (
        <InfoTip titulo={notification.title}>
          <TextoInfo>{notification.body}</TextoInfo>
        </InfoTip>
      ) : null}
      <Text onPress={onDismiss} style={styles.bannerClose} suppressHighlighting>
        ✕
      </Text>
    </View>
  );
}

function TodayTrainingCard({
  today,
  otherSessions,
  onPress,
  onReload,
}: {
  today: TodayCard | null;
  /** Hasta dos (Fase 7), ya sin ordenar: `ordenarBloquesDelDia` decide el orden. */
  otherSessions: OtherSessionView[];
  onPress: () => void;
  /** Recargar Hoy después de cambiar un bloque por otra disciplina. */
  onReload: () => void | Promise<void>;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const bloques = ordenarBloquesDelDia(today, otherSessions);

  if (bloques.length === 0) {
    return (
      <HeroCard
        eyebrow="Hoy"
        title="Descanso"
        subtitle="Sin sesión programada. Si te moviste por tu cuenta, regístralo abajo."
        color={colors.guindaDark}
      />
    );
  }

  // Con dos sesiones el día tiene dos compromisos, no uno con nota al pie:
  // cada uno lleva su tarjeta, en el orden en que se hacen. La primera es
  // siempre la protagonista (guinda); la que sigue es "también" (guindaDark).
  return (
    <>
      {bloques.map((bloque, index) => {
        const esPrimera = index === 0;
        const color = esPrimera ? undefined : colors.guindaDark;

        if (bloque.tipo === "gym") {
          const card = bloque.data;
          return (
            <HeroCard
              key="gym"
              eyebrow={esPrimera ? (card.completed ? "Hoy · hecho" : "Hoy toca") : "Hoy también"}
              title={card.muscleGroup}
              subtitle={`${card.exerciseCount} ejercicios · ${card.schemeLabel}${
                card.cardioMinutes ? ` · ${card.cardioMinutes} min cardio` : ""
              }${card.trimmedMinutes ? ` · ${nombreDelRecorte(card.trimmedMinutes).toLowerCase()}` : ""}`}
              color={color}
              onPress={onPress}
            />
          );
        }

        const otra = bloque.data;
        // El golf tiene su propia pantalla de registro (score, GIR, putts,
        // castigos) — no le sirve el destino genérico de las demás
        // secundarias, que es "Rutinas" (donde no hay nada de golf que ver).
        // N2: el cardio con plan abre su hoja (tabla completa y "Empezar
        // cardio"), no Rutinas.
        const onPressBloque =
          otra.discipline === "GOLF"
            ? () => router.push("/golf" as never)
            : esCardioConPlan(otra)
              ? () => router.push({ pathname: "/cardio/[fecha]", params: { fecha: otra.date } } as never)
              : onPress;
        return (
          <View key={`otra-${otra.discipline}-${index}`}>
            <HeroCard
              eyebrow={esPrimera ? "Hoy toca" : "Hoy también"}
              title={DISCIPLINE_LABELS[otra.discipline]}
              subtitle={
                otra.sesion
                  ? `${otra.sesion.cargaTotal} ${otra.sesion.unidad} · ${otra.sesion.focus} · ${otra.minutes} min`
                  : `${otra.minutes} min · tú eliges cómo la entrenas`
              }
              color={color}
              onPress={onPressBloque}
            />
            {/* La cancha ocupada o la alberca cerrada no deberían costar el
                día: el bloque se cambia por otra cosa desde aquí. */}
            <CambiarBloque fecha={todayISO()} actual={otra.discipline} onCambiado={onReload} />
          </View>
        );
      })}
    </>
  );
}

/**
 * Lo que se entrenó fuera del gym, resumido en una línea. El detalle completo
 * —y el botón de registrar a mano— vive en `/actividades-recientes`.
 */
function ActivitiesCard({
  activities,
  onPress,
}: {
  activities: Activity[];
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const ultima = activities[0] ?? null;
  const summary =
    activities.length === 0
      ? "Sin registros todavía"
      : `${activities.length} ${activities.length === 1 ? "reciente" : "recientes"} · última: ${DISCIPLINE_LABELS[ultima!.discipline]}`;

  return (
    <ScoreCard
      icon={Dumbbell}
      tint={colors.champan}
      title="Otras disciplinas"
      summary={summary}
      onPress={onPress}
    />
  );
}

function DecisionCard({ decision, onPress }: { decision: Decision | null; onPress: () => void }) {
  const { colors } = useTheme();
  if (!decision) {
    return (
      <ScoreCard
        icon={Flame}
        tint={colors.champan}
        title="Tu decisión"
        summary="Tu coach todavía está armando tu siguiente decisión."
      />
    );
  }

  const summary = `${decision.kcal} kcal${decision.meta ? ` · ${decision.meta}` : ""}`;

  return (
    <ScoreCard icon={Flame} tint={colors.champan} title="Tu decisión" summary={summary} onPress={onPress} />
  );
}

/**
 * La comida de hoy, resumida en una línea: cuántas ya se confirmaron y la
 * hora de la que sigue. El menú completo y la confirmación de cada comida
 * viven en `/comida-hoy` (Fase 2: ahí mismo se abre `/comida/[slot]` para
 * editar la hora real o decir por qué se saltó).
 */
function ComidaDeHoy({
  nutrition,
  onPress,
}: {
  nutrition: NutritionResponse | null;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const menu = nutrition?.menus[0] ?? null;

  // Cuántas de las de hoy ya se confirmaron. Se pide aparte porque el menú
  // no sabe de registros: es la misma separación que ya tiene `/comida-hoy`.
  const [confirmadas, setConfirmadas] = useState(0);
  useEffect(() => {
    if (!menu) return;
    let vivo = true;
    const hoy = todayISO();
    getComidasLogRango({ from: hoy, to: hoy })
      .then((respuesta) => {
        if (vivo) setConfirmadas(respuesta.registros.filter((registro) => registro.taken).length);
      })
      .catch(() => {
        // Sin poder leer el registro, la tarjeta se queda solo con "sigue".
      });
    return () => {
      vivo = false;
    };
  }, [menu]);

  if (!menu) {
    return (
      <ScoreCard
        icon={UtensilsCrossed}
        tint={colors.guindaLight}
        title="Tu comida de hoy"
        summary="Tu menú se sirve en cuanto tu coach publique tu decisión."
      />
    );
  }

  const siguiente = pickNextMeal(menu.meals);
  const summary = siguiente
    ? `Comidas · ${confirmadas} de ${menu.meals.length} · siguiente ${siguiente.timeHint}`
    : `Comidas · ${confirmadas} de ${menu.meals.length}`;

  return (
    <ScoreCard
      icon={UtensilsCrossed}
      tint={colors.guindaLight}
      title="Tu comida de hoy"
      summary={summary}
      onPress={onPress}
    />
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.obsidiana,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.huge,
    gap: spacing.lg,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  greeting: {
    fontFamily: fonts.sansBold,
    ...typeScale.title,
    color: colors.marfil,
  },
  phase: {
    fontFamily: fonts.sansMedium,
    ...typeScale.bodySm,
    letterSpacing: 1.2,
    color: colors.champan,
  },
  stats: {
    gap: spacing.md,
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.cardBg,
    borderWidth: 1,
    borderColor: colors.champanSoft,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    minHeight: 44,
    ...shadow.card,
  },
  bannerTitle: {
    flex: 1,
    fontFamily: fonts.sansSemiBold,
    ...typeScale.body,
    color: colors.marfil,
  },
  bannerClose: {
    fontFamily: fonts.sans,
    ...typeScale.body,
    color: colors.paloRosaLight,
    padding: spacing.xs,
  },
});
