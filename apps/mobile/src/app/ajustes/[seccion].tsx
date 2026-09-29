import Constants from "expo-constants";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  CalendarClock,
  Check,
  ChefHat,
  Clock,
  Soup,
  Heart,
  Package,
  RotateCcw,
  ShoppingBasket,
  Salad,
  Wallet,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card } from "@/components/Card";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { ErrorState, LoadingState } from "@/components/States";
import { Parrafo } from "@/components/Parrafo";
import { PrimaryButton } from "@/components/PrimaryButton";
import { RegenerarMenu } from "@/components/RegenerarMenu";
import { ScoreCard } from "@/components/ScoreCard";
import { SectionLabel } from "@/components/SectionLabel";
import { SeccionEntrenamiento } from "@/components/ajustes/SeccionEntrenamiento";
import { SeccionHogar } from "@/components/ajustes/SeccionHogar";
import { SeccionPuntoCero } from "@/components/ajustes/SeccionPuntoCero";
import { useTheme } from "@/context/theme";
import type { ThemePreference } from "@/context/theme";
import {
  ApiError,
  getActivities,
  getDespensa,
  getHorariosComida,
  getMe,
  getPuntoCero,
  getSuplementos,
  type PuntoCero,
  type MeResponse,
  type TiempoDeComida,
} from "@/lib/api";
import { ESTILOS_DIETA, PRESUPUESTOS, avisoDeDieta } from "@/lib/nutricion";
import { preferenciaDelPerfil, resumenPreparaciones } from "@/lib/preparaciones";
import { resumenLeche } from "@/lib/leche";
import { resumenRenglon } from "@/lib/suplementos";
import { estadoDelReloj } from "@/lib/reloj-nativo";
import { TIEMPOS_COCINA } from "@/lib/entrenamiento";
import {
  connectHealth,
  ensureCurrentPermissions,
  getHealthSummary,
  isHealthConnected,
  syncHealth,
  syncWorkouts,
  type HealthSummary,
} from "@/lib/health";
import {
  fonts,
  withAlpha,
  paletteChampan,
  paletteDark,
  paletteLight,
  radius,
  spacing,
  type Palette,
  type as typeScale,
} from "@/lib/theme";
import { countPendingSessions } from "@/lib/training-db";
import { DIAS } from "@/lib/recordatorio";
import {
  MAX_PIN_LENGTH,
  MIN_PIN_LENGTH,
  biometricsAvailable,
  biometricsEnabled,
  clearPin,
  hasPin,
  setBiometricsEnabled,
  setPin,
} from "@/lib/vault";
import { subscribePendingCount, syncAndNotify, type SyncResult } from "@/lib/training-sync";
import { countDownloadedVideos, purgeVideoDownloads } from "@/lib/video-downloads";
import { supabase } from "@/lib/supabase";

/**
 * Ajustes — fuera de tabs, empujada con back (igual que /objetivo).
 *
 * La ley de diseño: cada sección es una lista de renglones de una línea con
 * el estado actual ("Dieta: Estándar", "Domingo · 9:00"); NADA se abre hacia
 * abajo, y cada zoom-in empuja una hoja nueva en `/ajustes/detalle/<tema>`
 * donde vive el editor completo. Aquí solo quedan los editores que caben en
 * una pantalla por sí solos (apariencia, fotos, teléfono, reloj, sesión).
 */

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; palette: Palette | null }> = [
  { value: "system", label: "Sistema", palette: null },
  { value: "light", label: "Claro", palette: paletteLight },
  { value: "dark", label: "Oscuro", palette: paletteDark },
  { value: "champan", label: "Champán", palette: paletteChampan },
];

function formatSyncResult(result: SyncResult): string {
  if (result.sent === 0 && result.failed === 0) {
    return result.pending === 0 ? "Ya estaba todo sincronizado." : "Sin conexión: sigue guardado en tu teléfono.";
  }
  const parts: string[] = [];
  if (result.sent > 0) parts.push(`${result.sent} ${result.sent === 1 ? "sesión subida" : "sesiones subidas"}`);
  if (result.failed > 0) parts.push(`${result.failed} sin poder subir`);
  if (result.prs.length > 0) parts.push(`¡PR en ${result.prs.join(", ")}!`);
  return parts.join(" · ");
}

/**
 * El detalle de una sección de Ajustes: `/ajustes/apariencia`,
 * `/ajustes/perfil`, `/ajustes/telefono`, `/ajustes/reloj`, `/ajustes/fotos`,
 * `/ajustes/sesion`.
 *
 * Las seis viven en la misma pantalla porque comparten el mismo estado
 * cargado —perfil, cola de sincronización, salud, bóveda— y partirlo en seis
 * archivos multiplicaría las mismas llamadas por seis. Lo que cambia por
 * sección es únicamente qué tarjeta se pinta.
 */
export const SECCIONES = {
  checkin: "Tu check-in",
  entrenamiento: "Tu entrenamiento",
  nutricion: "Nutrición",
  apariencia: "Apariencia",
  perfil: "Tu perfil",
  telefono: "Tu teléfono",
  reloj: "Tu reloj",
  fotos: "Tus fotos",
  sesion: "Sesión",
} as const;

export type Seccion = keyof typeof SECCIONES;

export default function AjustesDetalleScreen() {
  const { seccion } = useLocalSearchParams<{ seccion: string }>();
  const activa = (Object.keys(SECCIONES) as Seccion[]).find((clave) => clave === seccion) ?? null;
  const router = useRouter();
  const { colors, preference, setPreference } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [me, setMe] = useState<MeResponse | null>(null);
  // Desde qué check-in se compara todo. Vive aquí y no dentro de la tarjeta
  // porque la carga inicial de Ajustes ya hace una tanda de llamadas: una más
  // suelta desde el hijo dejaría la tarjeta parpadeando al abrir la sección.
  const [puntoCero, setPuntoCero] = useState<PuntoCero>(null);
  const [meError, setMeError] = useState<string | null>(null);

  // Emparejar un reloj o instalarle la app son cosas que se hacen fuera de
  // aquí; se lee una vez al abrir Ajustes y no se vigila.
  const [reloj] = useState(estadoDelReloj);

  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const [videoCount, setVideoCount] = useState(0);
  const [deletingVideos, setDeletingVideos] = useState(false);

  const [signingOut, setSigningOut] = useState(false);

  // Fase N5 — "Tu reloj" (solo iOS: Android no tiene HealthKit, ver Fase Health Connect pendiente).
  const [healthConnected, setHealthConnected] = useState(false);
  const [healthSummary, setHealthSummary] = useState<HealthSummary | null>(null);
  const [activityCount, setActivityCount] = useState<number | null>(null);
  const [connectingHealth, setConnectingHealth] = useState(false);
  const [syncingHealth, setSyncingHealth] = useState(false);
  const [healthMessage, setHealthMessage] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    setMeError(null);
    try {
      const response = await getMe();
      setMe(response);
    } catch (error) {
      setMeError(error instanceof ApiError ? error.message : "No se pudo cargar tu perfil");
    }

    // El punto cero va aparte y sin romper nada si falla: es una etiqueta de
    // "desde cuándo te comparas", no un dato sin el cual Ajustes no sirva.
    try {
      const respuesta = await getPuntoCero();
      setPuntoCero(respuesta.puntoCero);
    } catch {
      setPuntoCero(null);
    }
  }, []);

  // Se recarga al recuperar el foco, no solo al montar: los editores viven
  // en hojas de `/ajustes/detalle/` y al volver de una los renglones-resumen
  // deben decir lo recién guardado.
  useFocusEffect(
    useCallback(() => {
      void loadMe();
    }, [loadMe]),
  );

  useEffect(() => {
    const unsubscribe = subscribePendingCount(setPendingCount);
    void countPendingSessions().then(setPendingCount);
    return unsubscribe;
  }, []);

  const refreshVideoCount = useCallback(() => {
    setVideoCount(countDownloadedVideos());
  }, []);

  useEffect(() => {
    refreshVideoCount();
  }, [refreshVideoCount]);

  // Horarios de comida: solo para el renglón-resumen de Nutrición ("4 tiempos
  // · 08:00–20:00"). El editor completo vive en su hoja de detalle y hace su
  // propia carga; aquí un fallo se queda callado y el renglón lo dice.
  const [tiemposComida, setTiemposComida] = useState<TiempoDeComida[] | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (activa !== "nutricion") return;
      let vivo = true;
      getHorariosComida()
        .then((respuesta) => {
          if (vivo) setTiemposComida(respuesta.tiempos);
        })
        .catch(() => {
          if (vivo) setTiemposComida(null);
        });
      return () => {
        vivo = false;
      };
    }, [activa]),
  );

  // La despensa: solo para el renglón-resumen ("12 alimentos"). Vive en su
  // propia hoja —el catálogo entero con buscador no cabe aquí— y se recarga
  // al volver de ella, igual que los horarios de comida.
  const [despensa, setDespensa] = useState<number | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (activa !== "nutricion") return;
      let vivo = true;
      getDespensa()
        .then((respuesta) => {
          if (vivo) setDespensa(respuesta.pantry.length);
        })
        .catch(() => {
          if (vivo) setDespensa(null);
        });
      return () => {
        vivo = false;
      };
    }, [activa]),
  );

  // Suplementos: solo para el renglón-resumen ("3 tomas · 2 sugerencias").
  // Las sugerencias las calcula el servidor al pedirlas; se recargan al
  // volver de la hoja, donde se aceptan o descartan.
  const [suplementos, setSuplementos] = useState<{ tomas: number; sugerencias: number } | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (activa !== "nutricion") return;
      let vivo = true;
      getSuplementos()
        .then((respuesta) => {
          if (vivo) setSuplementos({ tomas: respuesta.tomas.length, sugerencias: respuesta.sugerencias.length });
        })
        .catch(() => {
          if (vivo) setSuplementos(null);
        });
      return () => {
        vivo = false;
      };
    }, [activa]),
  );

  // Bóveda de fotos: clave propia del teléfono + biometría opcional.
  const [tieneClave, setTieneClave] = useState(false);
  const [biometria, setBiometria] = useState<"facial" | "huella" | null>(null);
  const [biometriaOn, setBiometriaOn] = useState(false);
  const [claveNueva, setClaveNueva] = useState("");
  const [claveMsg, setClaveMsg] = useState<string | null>(null);

  const loadVault = useCallback(async () => {
    setTieneClave(await hasPin());
    setBiometria(await biometricsAvailable());
    setBiometriaOn(await biometricsEnabled());
  }, []);

  useEffect(() => {
    void loadVault();
  }, [loadVault]);

  async function guardarClave() {
    try {
      await setPin(claveNueva);
      setClaveNueva("");
      setClaveMsg("Clave guardada. Tus fotos ya están detrás de ella.");
      await loadVault();
    } catch (error) {
      setClaveMsg(error instanceof Error ? error.message : "No se pudo guardar tu clave");
    }
  }

  async function quitarClave() {
    await clearPin();
    setClaveMsg("Clave quitada: tus fotos quedan sin candado.");
    await loadVault();
  }

  async function alternarBiometria(valor: boolean) {
    try {
      await setBiometricsEnabled(valor);
      setBiometriaOn(valor);
      setClaveMsg(null);
    } catch (error) {
      setClaveMsg(error instanceof Error ? error.message : "No se pudo cambiar Face ID");
    }
  }

  const loadHealth = useCallback(async () => {
    if (Platform.OS !== "ios") return;
    const connected = await isHealthConnected();
    setHealthConnected(connected);
    if (connected) {
      try {
        setHealthSummary(await getHealthSummary());
      } catch {
        // Sin red o el servidor no respondió: se queda con lo que ya tenía en pantalla.
      }
      try {
        const { actividades } = await getActivities();
        setActivityCount(actividades.length);
      } catch {
        // Igual: se queda con el conteo previo si lo había.
      }
    }
  }, []);

  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  async function refreshHealthSummaryAndCount() {
    setHealthSummary(await getHealthSummary());
    try {
      const { actividades } = await getActivities();
      setActivityCount(actividades.length);
    } catch {
      // Se queda con el conteo previo si la llamada falla.
    }
  }

  async function handleConnectHealth() {
    if (connectingHealth) return;
    setConnectingHealth(true);
    setHealthMessage(null);
    try {
      const granted = await connectHealth();
      if (!granted) {
        setHealthMessage("No se pudo abrir el diálogo de Salud. Intenta de nuevo.");
        return;
      }
      setHealthConnected(true);
      // Primera conexión: backfill grande para que el PAL tenga sus 14+ días de una vez.
      const [healthResult, workoutsResult] = await Promise.all([syncHealth(30), syncWorkouts(30)]);
      await refreshHealthSummaryAndCount();
      const enviados = (healthResult?.enviados ?? 0) + (workoutsResult?.enviados ?? 0);
      setHealthMessage(
        enviados > 0
          ? `Listo: ${enviados} ${enviados === 1 ? "dato enviado" : "datos enviados"}.`
          : "Conectado. Cuando el reloj traiga datos, se sincronizan solos.",
      );
    } finally {
      setConnectingHealth(false);
    }
  }

  async function handleSyncHealth() {
    if (syncingHealth) return;
    setSyncingHealth(true);
    setHealthMessage(null);
    try {
      await ensureCurrentPermissions();
      const [healthResult, workoutsResult] = await Promise.all([syncHealth(7), syncWorkouts(7)]);
      await refreshHealthSummaryAndCount();
      const parts: string[] = [];
      if (healthResult && healthResult.enviados > 0) {
        parts.push(`${healthResult.enviados} ${healthResult.enviados === 1 ? "día" : "días"}`);
      }
      if (workoutsResult && workoutsResult.enviados > 0) {
        parts.push(
          `${workoutsResult.enviados} ${workoutsResult.enviados === 1 ? "entrenamiento" : "entrenamientos"}`,
        );
      }
      setHealthMessage(parts.length > 0 ? `${parts.join(" · ")} enviados.` : "Sin datos nuevos del reloj.");
    } finally {
      setSyncingHealth(false);
    }
  }

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await syncAndNotify();
      setSyncMessage(formatSyncResult(result));
    } finally {
      setSyncing(false);
    }
  }

  function handleDeleteVideos() {
    if (videoCount === 0 || deletingVideos) return;
    Alert.alert(
      "Borrar videos descargados",
      `Se borran los ${videoCount} ${videoCount === 1 ? "video" : "videos"} que tienes guardados en el teléfono. Puedes volver a descargarlos cuando quieras.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Borrar",
          style: "destructive",
          onPress: () => {
            setDeletingVideos(true);
            try {
              purgeVideoDownloads();
              refreshVideoCount();
            } finally {
              setDeletingVideos(false);
            }
          },
        },
      ],
    );
  }

  function handleSignOut() {
    if (signingOut) return;
    Alert.alert("Cerrar sesión", "¿Seguro que quieres cerrar tu sesión?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Cerrar sesión",
        style: "destructive",
        onPress: async () => {
          setSigningOut(true);
          // El signOut ya dispara la purga de datos locales (context/session.tsx
          // escucha SIGNED_OUT) — no hay que repetirla aquí.
          await supabase.auth.signOut();
        },
      },
    ]);
  }

  const appVersion = Constants.expoConfig?.version ?? "—";

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} style={styles.backRow} hitSlop={8}>
          <Text style={styles.backText}>← Atrás</Text>
        </Pressable>

        <Text style={styles.title}>{activa ? SECCIONES[activa] : "Ajustes"}</Text>

        {activa === "checkin" && (
        <>
        <SeccionPuntoCero puntoCero={puntoCero} onCambio={setPuntoCero} />

        {/* El editor de día/hora vive en su hoja; aquí solo el estado. */}
        <ScoreCard
          icon={CalendarClock}
          tint={colors.champan}
          title="Cuándo cierras tu semana"
          summary={resumenCierre(me)}
          onPress={() => router.push("/ajustes/detalle/cierre")}
        />
        </>
        )}

        {activa === "entrenamiento" && <SeccionEntrenamiento me={me} />}

        {activa === "nutricion" && (
        <>
        {/* La sección es una lista de renglones con el estado actual; cada
            editor completo vive en su hoja de `/ajustes/detalle/`. */}
        <ScoreCard
          icon={Clock}
          tint={colors.champan}
          title="A qué hora comes"
          summary={resumenHorariosComida(tiemposComida)}
          onPress={() => router.push("/ajustes/detalle/horarios-comida")}
        />

        <ScoreCard
          icon={Salad}
          tint={colors.champan}
          title="Tu tipo de dieta"
          summary={resumenDieta(me)}
          status={
            avisoDeDieta(me?.profile?.dietStyle ?? "ESTANDAR", {
              entrenaTemprano: (me?.profile?.trainingTime ?? "MANANA") === "MANANA",
              inicioVentana: me?.profile?.fastingStartHour ?? null,
            })
              ? { label: "Revisar", tone: "warn" }
              : null
          }
          onPress={() => router.push("/ajustes/detalle/dieta")}
        />

        <ScoreCard
          icon={Wallet}
          tint={colors.champan}
          title="Presupuesto de despensa"
          summary={
            PRESUPUESTOS.find((opcion) => opcion.valor === me?.profile?.budget)?.nombre ??
            "Sin definir"
          }
          onPress={() => router.push("/ajustes/detalle/presupuesto")}
        />

        <ScoreCard
          icon={ChefHat}
          tint={colors.champan}
          title="Cuánto quieres cocinar"
          summary={
            TIEMPOS_COCINA.find((opcion) => opcion.valor === (me?.profile?.maxPrepMin ?? null))
              ?.nombre ?? "Sin restricción"
          }
          onPress={() => router.push("/ajustes/detalle/cocina")}
        />

        <ScoreCard
          icon={Soup}
          tint={colors.champan}
          title="Preparaciones: licuados, sopas y cremas"
          summary={`${resumenPreparaciones(preferenciaDelPerfil(me?.profile ?? null))} · ${resumenLeche(me?.profile ?? null)}`}
          onPress={() => router.push("/ajustes/detalle/preparaciones")}
        />

        <ScoreCard
          icon={ShoppingBasket}
          tint={colors.champan}
          title="Lo que tengo en casa"
          summary={resumenDespensa(despensa)}
          onPress={() => router.push("/ajustes/despensa")}
        />

        <ScoreCard
          icon={Package}
          tint={colors.champan}
          title="Suplementos"
          summary={
            suplementos
              ? resumenRenglon(suplementos.tomas, suplementos.sugerencias)
              : resumenAlacena(me)
          }
          onPress={() => router.push("/ajustes/suplementos")}
        />

        <ScoreCard
          icon={Heart}
          tint={colors.champan}
          title="Lo que sí y lo que no"
          summary={resumenGustos(me)}
          onPress={() => router.push("/ajustes/detalle/gustos")}
        />

        <Card>
          <View style={styles.sectionHeader}>
            <SectionLabel>Rearmar tu alimentación</SectionLabel>
            <InfoTip titulo="Rearmar tu alimentación">
              <TextoInfo>
                Cambiar una cosa se hace en los renglones de arriba. Cuando cambió el conjunto
                —otro objetivo, otro estilo, otro presupuesto— conviene volver a mirar todas las
                respuestas juntas y ver qué implica cada una.
              </TextoInfo>
            </InfoTip>
          </View>

          <Pressable onPress={() => router.push("/replantear-dieta")} style={styles.replantear}>
            <RotateCcw size={18} color={colors.pergamino} strokeWidth={2} />
            <View style={{ flex: 1 }}>
              <Text style={styles.replantearTitulo}>Volver a armar mi perfil</Text>
              <Text style={styles.replantearDetalle}>
                Entra con tu siguiente check-in: el menú de esta semana ya se compró.
              </Text>
            </View>
          </Pressable>
        </Card>

        <Card>
          <SectionLabel>Regenerar tu menú</SectionLabel>
          <RegenerarMenu />
        </Card>
        </>
        )}

        {activa === "apariencia" && (
        <Card>
          <SectionLabel>Apariencia</SectionLabel>
          <View style={styles.themeList}>
            {THEME_OPTIONS.map((option) => {
              const selected = preference === option.value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => setPreference(option.value)}
                  style={[styles.themeRow, selected && styles.themeRowSelected]}
                >
                  <ThemeSwatch palette={option.palette} />
                  <Text style={styles.themeLabel}>{option.label}</Text>
                  {selected && <Check size={18} color={colors.champan} strokeWidth={2} />}
                </Pressable>
              );
            })}
          </View>
        </Card>
        )}

        {activa === "perfil" && (
        <>
        <Card>
          <SectionLabel>Tu perfil</SectionLabel>
          {!me && !meError && <LoadingState label="Cargando tu perfil..." />}
          {!me && meError && <ErrorState message={meError} onRetry={loadMe} />}
          {me && (
            <View style={styles.profileList}>
              <InfoRow label="Nombre" value={me.profile?.displayName ?? "—"} styles={styles} />
              <InfoRow label="Correo" value={me.user.email} styles={styles} />
              <InfoRow label="Fase actual" value={me.profile?.currentPhase ?? "—"} styles={styles} />
              <InfoRow label="Objetivo" value={me.profile?.goal ?? "—"} styles={styles} />
              <InfoRow
                label="Días de pesas"
                value={me.profile ? `${me.profile.trainingDaysPerWeek} / semana` : "—"}
                styles={styles}
              />
              <InfoRow
                label="Estatura"
                value={me.profile?.heightCm != null ? `${me.profile.heightCm} cm` : "—"}
                styles={styles}
              />
              <Parrafo style={styles.profileNote}>
                Para cambiar tus datos de entrenamiento, escríbele a tu coach.
              </Parrafo>
            </View>
          )}
        </Card>

        <SeccionHogar />
        </>
        )}

        {activa === "telefono" && (
        <Card>
          <SectionLabel>Tu teléfono</SectionLabel>
          <View style={styles.phoneList}>
            <View style={styles.phoneRow}>
              <View style={styles.phoneInfo}>
                <Text style={styles.phoneLabel}>Sesiones sin subir</Text>
                <Text style={styles.phoneValue}>
                  {pendingCount === 0 ? "Todo sincronizado" : `${pendingCount} ${pendingCount === 1 ? "sesión" : "sesiones"}`}
                </Text>
              </View>
              <Pressable onPress={handleSync} disabled={syncing} style={styles.actionButton}>
                <Text style={[styles.actionButtonText, syncing && styles.actionButtonTextDisabled]}>
                  {syncing ? "Sincronizando…" : "Sincronizar ahora"}
                </Text>
              </Pressable>
            </View>
            {syncMessage && <Parrafo style={styles.syncMessage}>{syncMessage}</Parrafo>}

            <View style={styles.phoneDivider} />

            <View style={styles.phoneRow}>
              <View style={styles.phoneInfo}>
                <Text style={styles.phoneLabel}>Videos descargados</Text>
                <Text style={styles.phoneValue}>{videoCount === 0 ? "Ninguno" : `${videoCount}`}</Text>
              </View>
              <Pressable
                onPress={handleDeleteVideos}
                disabled={videoCount === 0 || deletingVideos}
                style={styles.actionButton}
              >
                <Text
                  style={[
                    styles.actionButtonTextDestructive,
                    (videoCount === 0 || deletingVideos) && styles.actionButtonTextDisabled,
                  ]}
                >
                  Borrar videos descargados
                </Text>
              </Pressable>
            </View>
          </View>
        </Card>
        )}

        {activa === "reloj" && Platform.OS === "ios" && (
          <Card>
            <SectionLabel>Tu reloj</SectionLabel>
            {!healthConnected ? (
              <View style={styles.healthBlock}>
                <Parrafo style={styles.profileNote}>
                  Conecta Apple Salud para que tus pasos, sueño y frecuencia cardiaca ajusten tu gasto
                  calórico solos — nada de armar atajos a mano.
                </Parrafo>
                <PrimaryButton
                  label="Conectar Apple Salud"
                  onPress={handleConnectHealth}
                  loading={connectingHealth}
                />
              </View>
            ) : (
              <View style={styles.healthBlock}>
                <View style={styles.phoneRow}>
                  <View style={styles.phoneInfo}>
                    <Text style={styles.phoneLabel}>Último dato recibido</Text>
                    <Text style={styles.phoneValue}>{healthSummary?.lastDate ?? "Todavía nada"}</Text>
                  </View>
                  <Pressable onPress={handleSyncHealth} disabled={syncingHealth} style={styles.actionButton}>
                    <Text style={[styles.actionButtonText, syncingHealth && styles.actionButtonTextDisabled]}>
                      {syncingHealth ? "Sincronizando…" : "Sincronizar ahora"}
                    </Text>
                  </Pressable>
                </View>
                <InfoRow
                  label="Promedio de pasos"
                  value={healthSummary?.avgSteps != null ? `${healthSummary.avgSteps.toLocaleString("es-MX")}` : "—"}
                  styles={styles}
                />
                <InfoRow
                  label="Entrenamientos registrados"
                  value={activityCount != null ? `${activityCount}` : "—"}
                  styles={styles}
                />
              </View>
            )}
            {healthMessage && <Parrafo style={styles.syncMessage}>{healthMessage}</Parrafo>}
          </Card>
        )}

        {/* La app de la muñeca es lo que hace que una sesión no se registre a
            medias: entre serie y serie, sacar el teléfono es la fricción que
            hace que la gente deje de anotar. Aquí se dice qué hace hoy y qué
            todavía no, porque prometer conteo automático antes de tenerlo es
            la forma más rápida de que alguien deje de confiar en el número. */}
        {activa === "reloj" && Platform.OS === "ios" && reloj.soportado && (
          <Card>
            <SectionLabel>Holy Gains en tu muñeca</SectionLabel>

            <InfoRow
              label="Apple Watch emparejado"
              value={reloj.emparejado ? "Sí" : "No"}
              styles={styles}
            />
            <InfoRow
              label="App instalada en el reloj"
              value={reloj.appInstalada ? "Sí" : "No"}
              styles={styles}
            />

            <Text style={styles.profileNote}>
              {reloj.appInstalada
                ? "Durante una sesión en vivo, la serie que te toca aparece en el reloj y la puedes cerrar desde ahí sin sacar el teléfono. Si el teléfono está lejos, lo que cierres se guarda y se manda cuando vuelva a estar cerca."
                : reloj.emparejado
                  ? "Tu reloj está emparejado pero todavía no tiene la app. Instálala desde la app de Apple Watch en tu teléfono, en Apps disponibles."
                  : "Con un Apple Watch emparejado, la serie que te toca se ve en la muñeca y se cierra desde ahí."}
            </Text>

            <Parrafo style={styles.profileNote}>
              Las repeticiones todavía las cuentas tú. El reloj graba el movimiento de cada serie
              para poder contarlas solo más adelante; hasta que ese conteo esté probado contra
              sesiones reales, el número que se guarda es el que tú pones.
            </Parrafo>
          </Card>
        )}

        {activa === "fotos" && (
        <Card>
          <SectionLabel>Tus fotos</SectionLabel>
          <Parrafo style={styles.vaultIntro}>
            Tus fotos de progreso no se ven en ninguna otra pantalla. Aquí defines la clave que las
            abre — distinta a la de tu teléfono a propósito: quien ya lo desbloqueó no debería
            poder verlas.
          </Parrafo>

          {/* Se dice ANTES de crearla, no después de olvidarla: la diferencia
              entre una decisión informada y una sorpresa. */}
          <Parrafo style={styles.vaultAviso}>
            Si la olvidas no hay manera de recuperarla. Tus fotos siguen guardadas en el servidor,
            pero esta pantalla no las va a poder abrir: habría que poner una clave nueva y perder
            el acceso a las anteriores.
          </Parrafo>

          <View style={styles.vaultRow}>
            <TextInput
              value={claveNueva}
              onChangeText={(value) => setClaveNueva(value.replace(/\D/g, "").slice(0, MAX_PIN_LENGTH))}
              placeholder={tieneClave ? "Nueva clave" : `${MIN_PIN_LENGTH} a ${MAX_PIN_LENGTH} dígitos`}
              placeholderTextColor={colors.paloRosaLight}
              keyboardType="number-pad"
              secureTextEntry
              style={styles.vaultInput}
            />
            <Pressable
              onPress={guardarClave}
              disabled={claveNueva.length < MIN_PIN_LENGTH}
              style={[styles.vaultButton, claveNueva.length < MIN_PIN_LENGTH && styles.vaultButtonOff]}
            >
              <Text style={styles.vaultButtonText}>{tieneClave ? "Cambiar" : "Crear"}</Text>
            </Pressable>
          </View>

          {biometria && (
            <View style={styles.vaultToggle}>
              <Text style={styles.vaultToggleLabel}>
                {biometria === "facial" ? "Abrir con Face ID" : "Abrir con Touch ID"}
              </Text>
              <Switch
                value={biometriaOn}
                onValueChange={alternarBiometria}
                trackColor={{ true: colors.guinda, false: colors.cardBorder }}
                thumbColor={colors.marfil}
              />
            </View>
          )}

          {claveMsg && <Text style={styles.vaultMsg}>{claveMsg}</Text>}

          <View style={styles.vaultLinks}>
            <Pressable onPress={() => router.push("/fotos")} hitSlop={8}>
              <Text style={styles.vaultLink}>Ver mis fotos →</Text>
            </Pressable>
            {tieneClave && (
              <Pressable onPress={quitarClave} hitSlop={8}>
                <Text style={styles.vaultLinkSoft}>Quitar clave</Text>
              </Pressable>
            )}
          </View>
        </Card>

        )}

        {activa === "sesion" && (
        <Card>
          <SectionLabel>Sesión</SectionLabel>
          <View style={styles.sessionBlock}>
            <Text style={styles.versionText}>Holy Gains v{appVersion}</Text>
            <PrimaryButton label="Cerrar sesión" onPress={handleSignOut} loading={signingOut} />
          </View>
        </Card>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/*
 * Los renglones-resumen de las secciones: el estado actual en una línea,
 * leído de lo que la pantalla ya cargó (`/me` y, en Nutrición, los horarios
 * de comida). El editor de cada uno vive en su hoja de `/ajustes/detalle/`.
 */

/** "Domingo · 9:00", o la verdad: sin recordatorio nadie avisa. */
function resumenCierre(me: MeResponse | null): string {
  const weekday = me?.profile?.checkinWeekday ?? null;
  const hour = me?.profile?.checkinHour ?? null;
  if (weekday === null || hour === null) return "Sin recordatorio";
  const dia = DIAS[weekday] ?? "";
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} · ${hour}:00`;
}

/** "4 tiempos · 08:00–20:00", con cuántos ya son horas propias. */
function resumenHorariosComida(tiempos: TiempoDeComida[] | null): string {
  if (!tiempos || tiempos.length === 0) return "Sin menú publicado todavía";
  const primera = tiempos[0]!.hora;
  const ultima = tiempos[tiempos.length - 1]!.hora;
  const propias = tiempos.filter((tiempo) => tiempo.propia).length;
  const base = `${tiempos.length} tiempos · ${primera}–${ultima}`;
  return propias > 0 ? `${base} · ${propias} ${propias === 1 ? "propia" : "propias"}` : base;
}

/** El estilo elegido y, si es ayuno, su ventana ("Ayuno intermitente · 12–20 h"). */
function resumenDieta(me: MeResponse | null): string {
  const estilo = me?.profile?.dietStyle ?? "ESTANDAR";
  const nombre = ESTILOS_DIETA.find((opcion) => opcion.valor === estilo)?.nombre ?? "Estándar";
  if (estilo === "AYUNO") {
    const inicio = me?.profile?.fastingStartHour ?? null;
    const fin = me?.profile?.fastingEndHour ?? null;
    if (inicio !== null && fin !== null) return `${nombre} · ${inicio}–${fin} h`;
  }
  return nombre;
}

/** Nombres cortos para que los suplementos quepan en un renglón (respaldo sin red). */
const ALACENA_CORTA: Record<string, string> = {
  WHEY: "Proteína",
  CREATINA: "Creatina",
  OMEGA3: "Omega-3",
};

function resumenAlacena(me: MeResponse | null): string {
  const marcados = (me?.profile?.supplements ?? [])
    .map((valor) => ALACENA_CORTA[valor])
    .filter((nombre): nombre is string => Boolean(nombre));
  return marcados.length === 0 ? "Nada marcado todavía" : marcados.join(" · ");
}

/** Cuántos alimentos tiene marcados en casa. La cuenta es el estado. */
function resumenDespensa(cuantos: number | null): string {
  if (cuantos === null) return "Sin cargar";
  if (cuantos === 0) return "Nada marcado todavía";
  return `${cuantos} ${cuantos === 1 ? "alimento" : "alimentos"}`;
}

function resumenGustos(me: MeResponse | null): string {
  const favoritos = me?.profile?.favoriteFoods?.length ?? 0;
  const excluidos = me?.profile?.excludedFoods?.length ?? 0;
  if (favoritos === 0 && excluidos === 0) return "Sin preferencias declaradas";
  const partes: string[] = [];
  if (favoritos > 0) partes.push(`${favoritos} ${favoritos === 1 ? "favorito" : "favoritos"}`);
  if (excluidos > 0) partes.push(`${excluidos} ${excluidos === 1 ? "excluido" : "excluidos"}`);
  return partes.join(" · ");
}

function InfoRow({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

/** Vista previa mínima de cada opción de tema. "Sistema" se pinta partida
 * mitad clara / mitad oscura porque no tiene una paleta propia. */
function ThemeSwatch({ palette }: { palette: Palette | null }) {
  if (!palette) {
    return (
      <View style={swatchStyles.swatch}>
        <View style={[swatchStyles.half, { backgroundColor: paletteLight.obsidiana }]} />
        <View style={[swatchStyles.half, { backgroundColor: paletteDark.obsidiana }]} />
      </View>
    );
  }
  return (
    <View style={[swatchStyles.swatch, { backgroundColor: palette.obsidiana, borderColor: palette.cardBorder }]}>
      <View style={[swatchStyles.dot, { backgroundColor: palette.guinda }]} />
    </View>
  );
}

const swatchStyles = StyleSheet.create({
  swatch: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.15)",
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "flex-end",
    padding: 4,
  },
  half: {
    flex: 1,
    height: "100%",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});

const makeStyles = (colors: Palette) => StyleSheet.create({
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  replantear: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.lg,
    backgroundColor: colors.guinda,
    borderWidth: 1,
    borderColor: colors.guindaLight,
    borderRadius: radius.xl,
    padding: spacing.lg,
  },
  replantearTitulo: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.pergamino },
  replantearDetalle: {
    fontFamily: fonts.sans,
    ...typeScale.bodySm,
    color: withAlpha(colors.pergamino, 0.85),
  },
  vaultAviso: {
    fontFamily: fonts.sansMedium,
    ...typeScale.bodySm,
    color: colors.champan,
    backgroundColor: withAlpha(colors.champan, 0.12),
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  vaultIntro: {
    fontFamily: fonts.sans,
    ...typeScale.bodySm,
    color: colors.paloRosaLight,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  vaultRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  vaultInput: {
    flex: 1,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.cardBg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontFamily: fonts.sansMedium,
    ...typeScale.body,
    color: colors.marfil,
  },
  vaultButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.guinda,
  },
  vaultButtonOff: { opacity: 0.5 },
  vaultButtonText: { fontFamily: fonts.sansSemiBold, ...typeScale.bodySm, color: colors.pergamino },
  vaultToggle: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg,
  },
  vaultToggleLabel: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.marfil },
  vaultMsg: {
    fontFamily: fonts.sans,
    ...typeScale.bodySm,
    color: colors.champan,
    marginTop: spacing.md,
  },
  vaultLinks: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.lg,
  },
  vaultLink: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.champan },
  vaultLinkSoft: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
  screen: {
    flex: 1,
    backgroundColor: colors.obsidiana,
  },
  flex: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    // Extra sobre `spacing.huge`: en las secciones con campos de texto al
    // fondo (favoritos/excluidos), el teclado necesita más aire debajo del
    // último campo para no taparlo — antes se escribía a ciegas ahí.
    paddingBottom: spacing.huge * 2,
  },
  backRow: { flexDirection: "row", alignItems: "center" },
  backText: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosaLight },
  title: {
    fontFamily: fonts.display,
    ...typeScale.title,
    color: colors.marfil,
  },
  themeList: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  themeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  themeRowSelected: {
    borderColor: colors.guindaLight,
  },
  themeLabel: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    ...typeScale.body,
    color: colors.marfil,
  },
  profileList: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
  infoRow: {
    gap: 2,
  },
  infoLabel: {
    fontFamily: fonts.sansSemiBold,
    ...typeScale.label,
    letterSpacing: 2,
    color: colors.paloRosa,
  },
  infoValue: {
    fontFamily: fonts.sans,
    ...typeScale.subheading,
    color: colors.marfil,
  },
  profileNote: {
    fontFamily: fonts.serifItalic,
    ...typeScale.body,
    color: colors.paloRosaLight,
    marginTop: spacing.xs,
  },
  phoneList: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  healthBlock: {
    marginTop: spacing.md,
    gap: spacing.md,
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  phoneInfo: { gap: 2 },
  phoneLabel: {
    fontFamily: fonts.sansMedium,
    ...typeScale.bodySm,
    color: colors.marfil,
  },
  phoneValue: {
    fontFamily: fonts.sans,
    ...typeScale.label,
    color: colors.paloRosaLight,
  },
  phoneDivider: {
    height: 1,
    backgroundColor: colors.cardBorder,
  },
  actionButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  actionButtonText: {
    fontFamily: fonts.sansSemiBold,
    ...typeScale.label,
    letterSpacing: 1.5,
    color: colors.champan,
    textAlign: "right",
  },
  actionButtonTextDestructive: {
    fontFamily: fonts.sansSemiBold,
    ...typeScale.label,
    letterSpacing: 1.5,
    color: colors.error,
    textAlign: "right",
  },
  actionButtonTextDisabled: {
    opacity: 0.5,
  },
  syncMessage: {
    fontFamily: fonts.sans,
    ...typeScale.label,
    color: colors.paloRosaLight,
  },
  sessionBlock: {
    marginTop: spacing.md,
    gap: spacing.lg,
  },
  versionText: {
    fontFamily: fonts.sans,
    ...typeScale.label,
    color: colors.paloRosaLight,
    textAlign: "center",
  },
});
