import NetInfo from "@react-native-community/netinfo";
import { useRouter } from "expo-router";
import { ChevronLeft, Dumbbell } from "lucide-react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { Parrafo } from "@/components/Parrafo";
import { ScoreCard } from "@/components/ScoreCard";
import { SectionLabel } from "@/components/SectionLabel";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import { ApiError, getCatalogoGym, getTrainingWeek, type EjercicioGym, type WeekView } from "@/lib/api";
import {
  EQUIPO_LABEL,
  type LibraryVideo,
  libraryFromWeek,
  nivelesDeZona,
  zonasDelCatalogo,
} from "@/lib/biblioteca-gym";
import { NIVEL_LABEL } from "@/lib/tecnica";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";
import { getCachedWeek, saveWeek } from "@/lib/training-db";
import { downloadVideo, isVideoDownloaded, localVideoFile, removeVideoDownload } from "@/lib/video-downloads";

/**
 * La hoja de Gym dentro de Biblioteca: una tarjeta por zona, con el catálogo
 * completo adentro (nivel por nivel, ejercicio por ejercicio).
 *
 * Antes cada zona era un acordeón dentro de otro acordeón dentro de la
 * tarjeta de Gym — tres niveles abriendo hacia abajo en la misma pantalla. La
 * LEY DE DISEÑO lo prohíbe: aquí la lista de zonas ya no se despliega, cada
 * una hace zoom a su propia hoja (un `Modal` de pantalla completa, mismo
 * estilo que el resto de la app) con las fichas agrupadas por nivel.
 */
function mondayISO(): string {
  const now = new Date();
  const day = now.getDay() || 7;
  now.setDate(now.getDate() - (day - 1));
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${String(now.getDate()).padStart(2, "0")}`;
}

export default function BibliotecaGymScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [week, setWeek] = useState<WeekView | null>(null);
  const [catalogo, setCatalogo] = useState<EjercicioGym[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [openVideo, setOpenVideo] = useState<string | null>(null);
  const [zonaAbierta, setZonaAbierta] = useState<string | null>(null);

  const groups = useMemo(() => (week ? libraryFromWeek(week) : []), [week]);
  const zonas = useMemo(() => zonasDelCatalogo(catalogo), [catalogo]);

  const refreshDownloaded = useCallback((videos: LibraryVideo[]) => {
    const next: Record<string, boolean> = {};
    for (const video of videos) next[video.videoPath] = isVideoDownloaded(video.videoPath);
    setDownloaded(next);
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [fresh, catalogoRes] = await Promise.all([
        getTrainingWeek(),
        getCatalogoGym().catch(() => null),
      ]);
      setWeek(fresh);
      await saveWeek(fresh.weekStart, fresh);
      if (catalogoRes) setCatalogo(catalogoRes.ejercicios);
      refreshDownloaded(
        catalogoRes
          ? catalogoRes.ejercicios
              .filter((ejercicio) => ejercicio.videoPath)
              .map((ejercicio) => ({
                key: ejercicio.id,
                name: ejercicio.name,
                groupKey: ejercicio.muscleGroup,
                videoPath: ejercicio.videoPath!,
                videoUrl: ejercicio.videoUrl,
              }))
          : libraryFromWeek(fresh).flatMap((g) => g.videos),
      );
    } catch (error) {
      const cached = await getCachedWeek(mondayISO());
      if (cached) {
        setWeek(cached);
        refreshDownloaded(libraryFromWeek(cached).flatMap((g) => g.videos));
      } else {
        setLoadError(
          error instanceof ApiError ? error.message : "Sin conexión y sin biblioteca guardada todavía",
        );
      }
    }
  }, [refreshDownloaded]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    NetInfo.fetch().then((state) => {
      setOnline(Boolean(state.isConnected) && state.isInternetReachable !== false);
    });
    const unsubscribe = NetInfo.addEventListener((state) => {
      setOnline(Boolean(state.isConnected) && state.isInternetReachable !== false);
    });
    return unsubscribe;
  }, []);

  async function handleDownload(video: LibraryVideo) {
    if (!video.videoUrl || busy[video.videoPath]) return;
    setBusy((current) => ({ ...current, [video.videoPath]: true }));
    try {
      await downloadVideo(video.videoPath, video.videoUrl);
      setDownloaded((current) => ({ ...current, [video.videoPath]: true }));
    } catch {
      // Sin red a medio camino, o el link firmado caducó: se queda como estaba.
    } finally {
      setBusy((current) => ({ ...current, [video.videoPath]: false }));
    }
  }

  function handleRemove(video: LibraryVideo) {
    removeVideoDownload(video.videoPath);
    setDownloaded((current) => ({ ...current, [video.videoPath]: false }));
    if (openVideo === video.key) setOpenVideo(null);
  }

  if (!week && !loadError) return <LoadingState label="Cargando tu biblioteca..." />;
  if (!week && loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!week) return null;

  const nombresDeLaSemana = new Set(
    week.sessions.flatMap((sesion) => sesion.exercises.map((ejercicio) => ejercicio.name)),
  );

  const usaCatalogo = catalogo.length > 0;
  const zonaActual = usaCatalogo
    ? (zonas.find((z) => z.grupo === zonaAbierta) ?? null)
    : null;
  const grupoActual = !usaCatalogo ? (groups.find((g) => g.key === zonaAbierta) ?? null) : null;

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.backText}>Atrás</Text>
        </Pressable>

        <View style={styles.header}>
          <Dumbbell size={28} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.title}>Gym</Text>
        </View>
        <Parrafo style={styles.subtitle}>
          Todo el catálogo por zona y por nivel. Tu rutina solo usa los de tu nivel y los de abajo;
          los que tienen video se pueden descargar para el gimnasio.
        </Parrafo>

        {!online && (
          <View style={styles.offlineBadge}>
            <Text style={styles.offlineBadgeText}>Sin conexión — solo se reproducen los descargados</Text>
          </View>
        )}

        {usaCatalogo ? (
          zonas.length === 0 ? (
            <EmptyState message="Tu catálogo todavía no tiene ejercicios." />
          ) : (
            <View style={styles.lista}>
              {zonas.map((zona) => {
                const conVideo = zona.ejercicios.filter((ejercicio) => ejercicio.videoPath);
                const descargados = conVideo.filter(
                  (ejercicio) => downloaded[ejercicio.videoPath!],
                ).length;
                return (
                  <ScoreCard
                    key={zona.grupo}
                    icon={Dumbbell}
                    tint={colors.paloRosa}
                    title={zona.label}
                    summary={`${zona.ejercicios.length} ejercicios${
                      conVideo.length > 0 ? ` · ${descargados}/${conVideo.length} descargados` : ""
                    }`}
                    onPress={() => setZonaAbierta(zona.grupo)}
                  />
                );
              })}
            </View>
          )
        ) : groups.length === 0 ? (
          <EmptyState message="Tu semana todavía no tiene ejercicios con video." />
        ) : (
          <View style={styles.lista}>
            {groups.map((group) => {
              const groupDownloaded = group.videos.filter((v) => downloaded[v.videoPath]).length;
              return (
                <ScoreCard
                  key={group.key}
                  icon={Dumbbell}
                  tint={colors.paloRosa}
                  title={group.label}
                  summary={`${group.videos.length} ejercicios · ${groupDownloaded}/${group.videos.length} descargados`}
                  onPress={() => setZonaAbierta(group.key)}
                />
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={zonaActual !== null || grupoActual !== null}
        animationType="slide"
        onRequestClose={() => setZonaAbierta(null)}
      >
        <SafeAreaView style={styles.screen} edges={["top"]}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setZonaAbierta(null)} hitSlop={10} style={styles.back}>
              <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
              <Text style={styles.backText}>Atrás</Text>
            </Pressable>
            <Text style={styles.title}>{zonaActual?.label ?? grupoActual?.label}</Text>

            {zonaActual &&
              nivelesDeZona(zonaActual.ejercicios).map((grupoNivel) => (
                <View key={grupoNivel.nivel} style={styles.nivelBloque}>
                  <SectionLabel>{NIVEL_LABEL[grupoNivel.nivel]}</SectionLabel>
                  <View style={styles.filas}>
                    {grupoNivel.ejercicios.map((ejercicio) => (
                      <EjercicioGymFila
                        key={ejercicio.id}
                        ejercicio={ejercicio}
                        enTuSemana={nombresDeLaSemana.has(ejercicio.name)}
                        online={online}
                        isDownloaded={Boolean(ejercicio.videoPath && downloaded[ejercicio.videoPath])}
                        isBusy={Boolean(ejercicio.videoPath && busy[ejercicio.videoPath])}
                        isOpen={openVideo === ejercicio.id}
                        onToggleOpen={() => setOpenVideo(openVideo === ejercicio.id ? null : ejercicio.id)}
                        onDownload={() =>
                          ejercicio.videoPath &&
                          handleDownload({
                            key: ejercicio.id,
                            name: ejercicio.name,
                            groupKey: ejercicio.muscleGroup,
                            videoPath: ejercicio.videoPath,
                            videoUrl: ejercicio.videoUrl,
                          })
                        }
                        onRemove={() =>
                          ejercicio.videoPath &&
                          handleRemove({
                            key: ejercicio.id,
                            name: ejercicio.name,
                            groupKey: ejercicio.muscleGroup,
                            videoPath: ejercicio.videoPath,
                            videoUrl: ejercicio.videoUrl,
                          })
                        }
                      />
                    ))}
                  </View>
                </View>
              ))}

            {grupoActual && (
              <View style={styles.filas}>
                {grupoActual.videos.map((video) => (
                  <VideoFila
                    key={video.key}
                    video={video}
                    online={online}
                    isDownloaded={Boolean(downloaded[video.videoPath])}
                    isBusy={Boolean(busy[video.videoPath])}
                    isOpen={openVideo === video.key}
                    onToggleOpen={() => setOpenVideo(openVideo === video.key ? null : video.key)}
                    onDownload={() => handleDownload(video)}
                    onRemove={() => handleRemove(video)}
                  />
                ))}
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

/** Un ejercicio del catálogo: nombre, ficha en un InfoTip y —si tiene— video. */
function EjercicioGymFila({
  ejercicio,
  enTuSemana,
  online,
  isDownloaded,
  isBusy,
  isOpen,
  onToggleOpen,
  onDownload,
  onRemove,
}: {
  ejercicio: EjercicioGym;
  enTuSemana: boolean;
  online: boolean;
  isDownloaded: boolean;
  isBusy: boolean;
  isOpen: boolean;
  onToggleOpen: () => void;
  onDownload: () => void;
  onRemove: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const tieneFicha = Boolean(ejercicio.howTo || ejercicio.whyFor || ejercicio.watchOut);
  const reproducible = isDownloaded || (online && Boolean(ejercicio.videoUrl));

  return (
    <View style={styles.fila}>
      <View style={styles.filaHead}>
        <View style={styles.filaInfo}>
          <View style={styles.filaTituloRow}>
            <Text style={styles.filaNombre}>
              {ejercicio.name}
              {enTuSemana ? <Text style={styles.enSemana}> · en tu semana</Text> : null}
            </Text>
            {tieneFicha && (
              <InfoTip titulo={ejercicio.name}>
                {ejercicio.howTo && <TextoInfo>Cómo: {ejercicio.howTo}</TextoInfo>}
                {ejercicio.whyFor && <TextoInfo>Para qué: {ejercicio.whyFor}</TextoInfo>}
                {ejercicio.watchOut && <TextoInfo>Ojo con: {ejercicio.watchOut}</TextoInfo>}
                {ejercicio.substitutes.length > 0 && (
                  <TextoInfo>Si está ocupado: {ejercicio.substitutes.join(" · ")}</TextoInfo>
                )}
              </InfoTip>
            )}
          </View>
          <Text style={styles.filaMeta}>
            {EQUIPO_LABEL[ejercicio.equipment] ?? ejercicio.equipment}
            {ejercicio.videoPath ? (isDownloaded ? " · descargado" : " · con video") : " · sin video"}
          </Text>
        </View>

        {ejercicio.videoPath && (
          <Pressable onPress={reproducible ? onToggleOpen : undefined} disabled={!reproducible} hitSlop={8}>
            <Text style={[styles.play, !reproducible && styles.playDisabled]}>{isOpen ? "▼" : "▶"}</Text>
          </Pressable>
        )}
      </View>

      {ejercicio.videoPath && (
        <View style={styles.filaAcciones}>
          {isDownloaded ? (
            <Pressable onPress={onRemove} hitSlop={8}>
              <Text style={styles.accion}>Quitar descarga</Text>
            </Pressable>
          ) : (
            <Pressable onPress={onDownload} disabled={isBusy || !online} hitSlop={8}>
              {isBusy ? (
                <ActivityIndicator color={colors.paloRosa} size="small" />
              ) : (
                <Text style={[styles.accion, !online && styles.accionDisabled]}>Descargar</Text>
              )}
            </Pressable>
          )}
        </View>
      )}

      {isOpen && reproducible && (
        <>
          <VideoPlayer
            uri={isDownloaded ? localVideoFile(ejercicio.videoPath!).uri : (ejercicio.videoUrl as string)}
          />
          {fuenteLabel(ejercicio.videoLicense, ejercicio.videoAuthor) && (
            <Text style={styles.atribucion}>
              {fuenteLabel(ejercicio.videoLicense, ejercicio.videoAuthor)}
            </Text>
          )}
        </>
      )}
    </View>
  );
}

/** Nombre de la fuente para la línea de atribución discreta bajo el video. */
function fuenteLabel(licencia: string | null | undefined, autor: string | null | undefined): string | null {
  if (!licencia) return null;
  if (licencia.startsWith("CC-BY-SA")) {
    return `Video: ${autor ?? "wger.de"} · ${licencia} · wger.de`;
  }
  return "Ilustración: free-exercise-db · dominio público";
}

/** Un video sin ficha (biblioteca armada solo con la semana, sin catálogo). */
function VideoFila({
  video,
  online,
  isDownloaded,
  isBusy,
  isOpen,
  onToggleOpen,
  onDownload,
  onRemove,
}: {
  video: LibraryVideo;
  online: boolean;
  isDownloaded: boolean;
  isBusy: boolean;
  isOpen: boolean;
  onToggleOpen: () => void;
  onDownload: () => void;
  onRemove: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const playable = isDownloaded || (online && Boolean(video.videoUrl));

  return (
    <View style={styles.fila}>
      <View style={styles.filaHead}>
        <View style={styles.filaInfo}>
          <Text style={styles.filaNombre}>{video.name}</Text>
          <Text style={styles.filaMeta}>
            {isDownloaded ? "Descargado" : playable ? "Disponible" : "(necesita conexión)"}
          </Text>
        </View>
        <Pressable onPress={playable ? onToggleOpen : undefined} disabled={!playable} hitSlop={8}>
          {playable && <Text style={styles.play}>{isOpen ? "▼" : "▶"}</Text>}
        </Pressable>
      </View>

      <View style={styles.filaAcciones}>
        {isDownloaded ? (
          <Pressable onPress={onRemove} hitSlop={8}>
            <Text style={styles.accion}>Quitar descarga</Text>
          </Pressable>
        ) : (
          <Pressable onPress={onDownload} disabled={isBusy || !online || !video.videoUrl} hitSlop={8}>
            {isBusy ? (
              <ActivityIndicator color={colors.paloRosa} size="small" />
            ) : (
              <Text style={[styles.accion, (!online || !video.videoUrl) && styles.accionDisabled]}>
                Descargar
              </Text>
            )}
          </Pressable>
        )}
      </View>

      {isOpen && playable && (
        <VideoPlayer uri={isDownloaded ? localVideoFile(video.videoPath).uri : (video.videoUrl as string)} />
      )}
    </View>
  );
}

function VideoPlayer({ uri }: { uri: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const player = useVideoPlayer(uri, (instance) => {
    instance.play();
  });

  return <VideoView style={styles.videoView} player={player} nativeControls contentFit="contain" />;
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
    header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.xs },
    title: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    subtitle: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosaLight, marginTop: spacing.xs },
    offlineBadge: {
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
      borderRadius: radius.md,
      padding: spacing.md,
      marginTop: spacing.sm,
    },
    offlineBadgeText: { fontFamily: fonts.sans, ...typeScale.label, color: colors.paloRosaLight },
    lista: { gap: spacing.md, marginTop: spacing.md },
    nivelBloque: { gap: spacing.sm, marginTop: spacing.lg },
    filas: { gap: spacing.md },
    fila: {
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.xs,
    },
    filaHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
    filaInfo: { flex: 1, gap: 2 },
    filaTituloRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    filaNombre: { fontFamily: fonts.sansSemiBold, ...typeScale.bodySm, color: colors.marfil },
    enSemana: { fontFamily: fonts.sansSemiBold, color: colors.champan },
    filaMeta: { fontFamily: fonts.sans, ...typeScale.label, color: colors.paloRosaLight },
    play: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.champan },
    playDisabled: { color: colors.paloRosaLight },
    filaAcciones: { flexDirection: "row", justifyContent: "flex-end" },
    accion: { fontFamily: fonts.sansSemiBold, ...typeScale.label, letterSpacing: 1.5, color: colors.paloRosa },
    accionDisabled: { color: colors.paloRosaLight, opacity: 0.6 },
    videoView: {
      width: "100%",
      aspectRatio: 16 / 9,
      borderRadius: radius.md,
      marginTop: spacing.xs,
      backgroundColor: "#000",
    },
    atribucion: {
      fontFamily: fonts.sans,
      ...typeScale.label,
      color: colors.paloRosaLight,
      marginTop: spacing.xs,
    },
  });
