import { useRouter } from "expo-router";
import { Dumbbell, Home } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { EngraneAjustes } from "@/components/EngraneAjustes";
import { Parrafo } from "@/components/Parrafo";
import { ScoreCard } from "@/components/ScoreCard";
import { ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import { useScrollTop } from "@/lib/scroll-top";
import {
  ApiError,
  DISCIPLINE_LABELS,
  getCatalogoGym,
  getTrainingWeek,
  type Discipline,
  type EjercicioGym,
  type WeekView,
} from "@/lib/api";
import { libraryFromWeek } from "@/lib/biblioteca-gym";
import { iconoDe } from "@/lib/disciplinas";
import { BIBLIOTECA_POR_DISCIPLINA, resumenDeBiblioteca } from "@/lib/tecnica";
import { fonts, spacing, type Palette, type as typeScale } from "@/lib/theme";
import { getCachedWeek, saveWeek } from "@/lib/training-db";

/**
 * Biblioteca — una tarjeta por disciplina, cada una de una línea.
 *
 * Hoy solo Gym tiene contenido: son los videos de tu semana, agrupados por
 * zona. Las demás disciplinas aparecen anunciadas y vacías a propósito, no por
 * descuido — cada una entra con su propia investigación (niveles, estructura
 * de sesión, progresión), y natación es la primera de la fila. Enseñar el
 * lugar vacío es más honesto que esconder que existe el plan.
 *
 * El catálogo completo de cada disciplina —zonas, niveles, fichas, videos—
 * vive en `app/biblioteca/gym.tsx` y `app/biblioteca/[disciplina].tsx`: aquí
 * solo se calcula el resumen que se lee cerrado (cuántos videos, cuántos
 * ejercicios) y se hace zoom a la hoja correspondiente. Antes esa jerarquía
 * completa vivía aquí mismo, como acordeones anidados tres niveles adentro —
 * la LEY DE DISEÑO prohíbe justo eso: nada se abre hacia abajo.
 */

function mondayISO(): string {
  const now = new Date();
  const day = now.getDay() || 7;
  now.setDate(now.getDate() - (day - 1));
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${String(now.getDate()).padStart(2, "0")}`;
}

export default function BibliotecaScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Tocar esta pestaña estando en ella regresa el scroll hasta arriba.
  const scrollRef = useScrollTop();

  const [week, setWeek] = useState<WeekView | null>(null);
  const [catalogo, setCatalogo] = useState<EjercicioGym[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const fresh = await getTrainingWeek();
      setWeek(fresh);
      await saveWeek(fresh.weekStart, fresh);
    } catch (error) {
      const cached = await getCachedWeek(mondayISO());
      if (cached) {
        setWeek(cached);
      } else {
        setLoadError(
          error instanceof ApiError ? error.message : "Sin conexión y sin biblioteca guardada todavía",
        );
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let vivo = true;
    getCatalogoGym()
      .then((respuesta) => {
        if (vivo) setCatalogo(respuesta.ejercicios);
      })
      .catch(() => {
        // Sin catálogo la pantalla sigue sirviendo con los videos de la semana.
      });
    return () => {
      vivo = false;
    };
  }, []);

  if (!week && !loadError) return <LoadingState label="Cargando tu biblioteca..." />;
  if (!week && loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!week) return null;

  const groups = libraryFromWeek(week);
  const totalVideos = groups.reduce((sum, g) => sum + g.videos.length, 0);

  /**
   * El resumen de Gym cuenta el catálogo completo, no solo la semana: es la
   * misma cifra que las demás disciplinas y por eso se comparan.
   */
  const videosDelCatalogo = catalogo.filter((ejercicio) => ejercicio.videoPath).length;

  const resumenGym =
    catalogo.length === 0
      ? totalVideos === 0
        ? "Tu semana todavía no tiene videos"
        : `${totalVideos} ${totalVideos === 1 ? "video" : "videos"} · ${groups.length} ${groups.length === 1 ? "zona" : "zonas"}`
      : `${videosDelCatalogo} ${videosDelCatalogo === 1 ? "video" : "videos"} · ${catalogo.length} ejercicios`;

  return (
    <ScrollView ref={scrollRef} style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Biblioteca</Text>
        <EngraneAjustes seccion="entrenamiento" />
      </View>
      <Parrafo style={styles.subtitle}>
        Todo lo que la app sabe prescribir, por disciplina y por nivel. Los videos se descargan con
        señal y quedan en tu teléfono para el gimnasio.
      </Parrafo>

      <ScoreCard
        icon={Dumbbell}
        tint={colors.paloRosa}
        title="Gym"
        summary={resumenGym}
        onPress={() => router.push("/biblioteca/gym")}
      />

      {/* Cada disciplina trae su biblioteca completa: los movimientos que su
          sesión pide por nombre, ordenados por nivel. El resumen se lee igual
          que el de Gym —videos y ejercicios— para que se comparen de un
          vistazo. */}
      {(Object.keys(BIBLIOTECA_POR_DISCIPLINA) as Discipline[]).map((disciplina) => {
        const ejercicios = BIBLIOTECA_POR_DISCIPLINA[disciplina] ?? [];
        const Icono = iconoDe(disciplina);

        return (
          <ScoreCard
            key={disciplina}
            icon={Icono}
            tint={colors.paloRosa}
            title={DISCIPLINE_LABELS[disciplina]}
            summary={resumenDeBiblioteca(ejercicios)}
            onPress={() => router.push(`/biblioteca/${disciplina}`)}
          />
        );
      })}

      {/* Lo único que queda sin prescripción: entrenar en casa es un contexto
          —dónde entrenas—, no una disciplina, y por eso no tiene sesión propia. */}
      <ScoreCard
        icon={Home}
        tint={colors.paloRosa}
        title="En casa"
        summary="Sin equipo o con lo mínimo"
        status={{ label: "Próximamente", tone: "neutral" }}
      />
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.obsidiana },
    content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.huge },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    title: { fontFamily: fonts.display, ...typeScale.title, color: colors.marfil },
    subtitle: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosaLight },
  });
