import NetInfo from "@react-native-community/netinfo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { Parrafo } from "@/components/Parrafo";
import { ScoreCard } from "@/components/ScoreCard";
import { SectionLabel } from "@/components/SectionLabel";
import { ErrorState } from "@/components/States";
import { useTheme } from "@/context/theme";
import { DISCIPLINE_LABELS, signVideoPaths, type Discipline } from "@/lib/api";
import { iconoDe } from "@/lib/disciplinas";
import {
  BIBLIOTECA_POR_DISCIPLINA,
  NIVEL_LABEL,
  ORDEN_NIVEL,
  porCategoria,
  type EjercicioDisciplina,
} from "@/lib/tecnica";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";
import { downloadVideo, isVideoDownloaded, localVideoFile, removeVideoDownload } from "@/lib/video-downloads";

/**
 * La hoja de una disciplina dentro de Biblioteca: sus movimientos agrupados
 * por categoría (técnica, levantamiento, golpeo...), cada una con su propia
 * hoja de detalle.
 *
 * Antes era una torre de acordeones —nivel → categoría → ejercicio, tres
 * niveles abriendo hacia abajo. La LEY DE DISEÑO lo prohíbe: aquí la lista de
 * categorías ya no se despliega, cada una hace zoom a su propia hoja (un
 * `Modal` de pantalla completa) con los ejercicios agrupados por nivel y su
 * ficha en un InfoTip en vez de texto suelto.
 *
 * El video es el mismo patrón que Gym (`biblioteca/gym.tsx`): el catálogo de
 * estas disciplinas vive en código (`lib/tecnica/*.ts`), no en la tabla
 * `exercises`, así que la URL firmada sale de `/api/v1/exercise-videos/sign`
 * en vez de venir ya resuelta en la respuesta del catálogo.
 */
export default function BibliotecaDisciplinaScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { disciplina } = useLocalSearchParams<{ disciplina: string }>();
  const [categoriaAbierta, setCategoriaAbierta] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [openVideo, setOpenVideo] = useState<string | null>(null);

  const ejercicios = BIBLIOTECA_POR_DISCIPLINA[disciplina as Discipline] ?? [];
  const videoPaths = useMemo(
    () => [
      ...new Set(
        ejercicios
          .map((ejercicio) => ejercicio.videoPath)
          .filter((path): path is string => Boolean(path)),
      ),
    ],
    [ejercicios],
  );

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const path of videoPaths) next[path] = isVideoDownloaded(path);
    setDownloaded(next);
  }, [videoPaths]);

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
    if (videoPaths.length === 0) return;
    signVideoPaths(videoPaths)
      .then((res) => setSignedUrls(res.urls))
      .catch(() => {
        // Sin sesión válida o sin red: los que ya estén descargados igual reproducen.
      });
  }, [videoPaths]);

  const handleDownload = useCallback(async (path: string) => {
    const url = signedUrls[path];
    if (!url || busy[path]) return;
    setBusy((current) => ({ ...current, [path]: true }));
    try {
      await downloadVideo(path, url);
      setDownloaded((current) => ({ ...current, [path]: true }));
    } catch {
      // Sin red a medio camino, o el link firmado caducó: se queda como estaba.
    } finally {
      setBusy((current) => ({ ...current, [path]: false }));
    }
  }, [signedUrls, busy]);

  const handleRemove = useCallback((path: string) => {
    removeVideoDownload(path);
    setDownloaded((current) => ({ ...current, [path]: false }));
    setOpenVideo((current) => (current === path ? null : current));
  }, []);

  if (ejercicios.length === 0) {
    return <ErrorState message="Esa disciplina no existe." onRetry={() => router.back()} />;
  }

  const Icono = iconoDe(disciplina as Discipline);
  const categorias = porCategoria(ejercicios);
  const categoriaActual = categorias.find((c) => c.categoria === categoriaAbierta) ?? null;
  const conVideoTotal = ejercicios.filter((e) => e.videoPath).length;

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.backText}>Atrás</Text>
        </Pressable>

        <View style={styles.header}>
          <Icono size={28} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.title}>{DISCIPLINE_LABELS[disciplina as Discipline]}</Text>
        </View>
        <Parrafo style={styles.subtitle}>
          Los que aparecen en tus sesiones, con cómo se hacen, para qué sirven y el error más común.
          {conVideoTotal > 0
            ? ` ${conVideoTotal} tienen video de referencia.`
            : " Todavía sin video de referencia."}
        </Parrafo>

        {!online && (
          <View style={styles.offlineBadge}>
            <Text style={styles.offlineBadgeText}>Sin conexión — solo se reproducen los descargados</Text>
          </View>
        )}

        <View style={styles.lista}>
          {categorias.map((grupo) => (
            <ScoreCard
              key={grupo.categoria}
              icon={Icono}
              tint={colors.paloRosa}
              title={grupo.categoria}
              summary={`${grupo.ejercicios.length} ${grupo.ejercicios.length === 1 ? "ejercicio" : "ejercicios"}`}
              onPress={() => setCategoriaAbierta(grupo.categoria)}
            />
          ))}
        </View>
      </ScrollView>

      <Modal
        visible={categoriaActual !== null}
        animationType="slide"
        onRequestClose={() => setCategoriaAbierta(null)}
      >
        <SafeAreaView style={styles.screen} edges={["top"]}>
          <ScrollView contentContainerStyle={styles.content}>
            <Pressable onPress={() => setCategoriaAbierta(null)} hitSlop={10} style={styles.back}>
              <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
              <Text style={styles.backText}>Atrás</Text>
            </Pressable>
            <Text style={styles.title}>{categoriaActual?.categoria}</Text>

            {ORDEN_NIVEL.map((nivel) => {
              const delNivel = (categoriaActual?.ejercicios ?? []).filter(
                (ejercicio) => ejercicio.nivel === nivel,
              );
              if (delNivel.length === 0) return null;
              return (
                <View key={nivel} style={styles.nivelBloque}>
                  <SectionLabel>{NIVEL_LABEL[nivel]}</SectionLabel>
                  <View style={styles.filas}>
                    {delNivel.map((ejercicio) => (
                      <EjercicioFila
                        key={ejercicio.id}
                        ejercicio={ejercicio}
                        online={online}
                        videoUrl={ejercicio.videoPath ? (signedUrls[ejercicio.videoPath] ?? null) : null}
                        isDownloaded={Boolean(ejercicio.videoPath && downloaded[ejercicio.videoPath])}
                        isBusy={Boolean(ejercicio.videoPath && busy[ejercicio.videoPath])}
                        isOpen={openVideo === ejercicio.id}
                        onToggleOpen={() => setOpenVideo(openVideo === ejercicio.id ? null : ejercicio.id)}
                        onDownload={() => ejercicio.videoPath && handleDownload(ejercicio.videoPath)}
                        onRemove={() => ejercicio.videoPath && handleRemove(ejercicio.videoPath)}
                      />
                    ))}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
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

function EjercicioFila({
  ejercicio,
  online,
  videoUrl,
  isDownloaded,
  isBusy,
  isOpen,
  onToggleOpen,
  onDownload,
  onRemove,
}: {
  ejercicio: EjercicioDisciplina;
  online: boolean;
  videoUrl: string | null;
  isDownloaded: boolean;
  isBusy: boolean;
  isOpen: boolean;
  onToggleOpen: () => void;
  onDownload: () => void;
  onRemove: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const reproducible = isDownloaded || (online && Boolean(videoUrl));
  const atribucion = fuenteLabel(ejercicio.videoLicense, ejercicio.videoAuthor);

  return (
    <View style={styles.fila}>
      <View style={styles.filaHead}>
        <View style={styles.filaInfo}>
          <View style={styles.filaTituloRow}>
            <Text style={styles.filaNombre}>{ejercicio.nombre}</Text>
            <InfoTip titulo={ejercicio.nombre}>
              <TextoInfo>Cómo: {ejercicio.como}</TextoInfo>
              <TextoInfo>Para qué: {ejercicio.para}</TextoInfo>
              <TextoInfo>Ojo con: {ejercicio.ojo}</TextoInfo>
            </InfoTip>
          </View>
          {ejercicio.videoPath && (
            <Text style={styles.filaMeta}>{isDownloaded ? "Descargado" : "Con video"}</Text>
          )}
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
            <Pressable onPress={onDownload} disabled={isBusy || !online || !videoUrl} hitSlop={8}>
              {isBusy ? (
                <ActivityIndicator color={colors.paloRosa} size="small" />
              ) : (
                <Text style={[styles.accion, (!online || !videoUrl) && styles.accionDisabled]}>
                  Descargar
                </Text>
              )}
            </Pressable>
          )}
        </View>
      )}

      {isOpen && reproducible && (
        <>
          <VideoPlayer uri={isDownloaded ? localVideoFile(ejercicio.videoPath!).uri : (videoUrl as string)} />
          {atribucion && <Text style={styles.atribucion}>{atribucion}</Text>}
        </>
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
    filas: { gap: spacing.sm },
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
    filaNombre: { flex: 1, fontFamily: fonts.sansSemiBold, ...typeScale.bodySm, color: colors.marfil },
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
