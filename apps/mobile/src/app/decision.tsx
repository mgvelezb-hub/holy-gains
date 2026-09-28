import { useRouter } from "expo-router";
import { Camera, ChevronLeft, Pill, Route, Ruler, ThumbsUp, Wrench } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Parrafo } from "@/components/Parrafo";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScoreCard } from "@/components/ScoreCard";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import { flechaDelta, resumenEsteMes, resumenFotos } from "@/lib/analisis-checkin";
import {
  ApiError,
  getDecision,
  type BloqueMensual,
  type DecisionConSuplementos,
  type LecturaZona,
  type MetricaMensual,
} from "@/lib/api";
import { cancelarAvisoAnalisis } from "@/lib/recordatorio";
import { lineaSugerencia, motivoCorto } from "@/lib/suplementos";
import { ListaRenglones } from "@/components/suplementos/HojaSuplementos";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * El zoom de "Tu decisión": kcal, macros, la retro y el mensaje de Coachy.
 *
 * LEY DE DISEÑO: nada se abre hacia abajo. Cada parte de la retro es una
 * línea con su dato duro, y el detalle vive en su propia hoja. En el mensual
 * se suman "Este mes" (medidas contra el mes anterior y el inicio) y "Tus
 * fotos" (zonas contra la referencia).
 */

type Hoja = "mes" | "fotos" | "bien" | "ajustar" | "plan" | "suplementos" | null;

const METRICA_LABEL: Record<MetricaMensual, string> = {
  cintura: "Cintura",
  peso: "Peso",
  brazoIzq: "Brazo izq.",
  brazoDer: "Brazo der.",
  piernaIzq: "Pierna izq.",
  piernaDer: "Pierna der.",
};

const ZONA_LABEL: Record<LecturaZona["zona"], string> = {
  cintura: "Cintura",
  cadera_gluteo: "Cadera y glúteo",
  pierna: "Pierna",
  brazo: "Brazo",
  espalda: "Espalda",
};

const BRECHA_LABEL: Record<LecturaZona["brecha"], string> = {
  cerca: "cerca",
  media: "a medio camino",
  lejos: "lejos",
};

const TENDENCIA_LABEL: Record<LecturaZona["tendencia"], string> = {
  "acercándose": "acercándose",
  igual: "igual",
  "alejándose": "en sentido contrario",
};

export default function DecisionScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // `undefined` = todavía no contestó el servidor; `null` = contestó y no hay
  // decisión publicada. Sin la distinción, un `null` inicial se leería igual
  // que "ya se sabe que no hay decisión" antes de que la llamada regrese.
  const [decision, setDecision] = useState<DecisionConSuplementos | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [hoja, setHoja] = useState<Hoja>(null);

  const load = useCallback(async () => {
    try {
      const res = await getDecision();
      setDecision(res.decision as DecisionConSuplementos | null);
      setError(null);
      // Ya la está viendo: el aviso de "tu análisis está listo" sobra.
      if (res.estado === "lista") void cancelarAvisoAnalisis();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cargar tu decisión");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (decision === undefined && !error) return <LoadingState label="Cargando tu decisión..." />;
  if (decision === undefined && error) return <ErrorState message={error} onRetry={load} />;

  const mensual = decision?.mensual?.esMensual ? decision.mensual : null;
  const retro = decision?.retro ?? null;
  const sugeridos = decision?.suplementos?.sugerencias ?? [];

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.paloRosa} />
        }
      >
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.backText}>Atrás</Text>
        </Pressable>

        <Text style={styles.title}>{mensual ? "Tu mes" : "Tu decisión"}</Text>

        {!decision ? (
          <EmptyState message="Tu coach todavía está armando tu siguiente decisión." />
        ) : (
          <>
            <Text style={styles.eyebrow}>{decision.phase.replace(/_/g, " ").toUpperCase()}</Text>
            <Text style={styles.kcal}>{decision.kcal} kcal</Text>
            {decision.meta && <Text style={styles.meta}>{decision.meta}</Text>}

            <View style={styles.macroRow}>
              <View style={styles.macro}>
                <Text style={styles.macroValue}>{decision.proteinG}g</Text>
                <Text style={styles.macroLabel}>Proteína</Text>
              </View>
              <View style={styles.macro}>
                <Text style={styles.macroValue}>{decision.carbsG}g</Text>
                <Text style={styles.macroLabel}>Carbos</Text>
              </View>
              <View style={styles.macro}>
                <Text style={styles.macroValue}>{decision.fatG}g</Text>
                <Text style={styles.macroLabel}>Grasas</Text>
              </View>
            </View>

            {(mensual || retro) && (
              <View style={styles.secciones}>
                {mensual && (
                  <ScoreCard
                    icon={Ruler}
                    tint={colors.guindaLight}
                    title="Este mes"
                    summary={resumenEsteMes(mensual.deltas)}
                    onPress={() => setHoja("mes")}
                  />
                )}
                {mensual && (
                  <ScoreCard
                    icon={Camera}
                    tint={colors.paloRosa}
                    title="Tus fotos"
                    summary={resumenFotos(mensual.fotos)}
                    onPress={() => setHoja("fotos")}
                  />
                )}
                {retro && (
                  <ScoreCard
                    icon={ThumbsUp}
                    tint={colors.champan}
                    title="Va bien"
                    summary={retro.va_bien[0] ?? "—"}
                    onPress={() => setHoja("bien")}
                  />
                )}
                {retro && (
                  <ScoreCard
                    icon={Wrench}
                    tint={colors.paloRosa}
                    title="Hay que ajustar"
                    summary={retro.ajustar[0] ?? "Nada por ahora: sigue igual"}
                    onPress={retro.ajustar.length > 0 ? () => setHoja("ajustar") : undefined}
                  />
                )}
                {sugeridos.length > 0 && (
                  <ScoreCard
                    icon={Pill}
                    tint={colors.champan}
                    title={`Suplementos sugeridos · ${sugeridos.length}`}
                    summary={lineaSugerencia(sugeridos[0]!)}
                    onPress={() => setHoja("suplementos")}
                  />
                )}
                {retro && (
                  <ScoreCard
                    icon={Route}
                    tint={colors.champan}
                    title="Tu plan de aquí en adelante"
                    summary={retro.plan.macros}
                    onPress={() => setHoja("plan")}
                  />
                )}
              </View>
            )}

            {decision.texto && (
              <View style={styles.mensaje}>
                <Text style={styles.mensajeTitulo}>Mensaje de Coachy</Text>
                <Parrafo style={styles.mensajeTexto}>{decision.texto}</Parrafo>
              </View>
            )}
          </>
        )}
      </ScrollView>

      <HojaDetalle
        visible={hoja !== null}
        titulo={tituloDe(hoja)}
        onClose={() => setHoja(null)}
      >
        {hoja === "mes" && mensual && <DetalleMes deltas={mensual.deltas} />}
        {hoja === "fotos" && mensual && <DetalleFotos fotos={mensual.fotos} />}
        {hoja === "bien" && retro && <Lista renglones={retro.va_bien} />}
        {hoja === "ajustar" && retro && <Lista renglones={retro.ajustar} />}
        {hoja === "suplementos" && (
          <ListaRenglones
            renglones={sugeridos.map((s) => ({ id: s.supplement, titulo: s.nombre, detalle: motivoCorto(s.motivo) }))}
            onPress={(id) => {
              // La decisión (Acepto / Ya lo tomo / No quiero) vive en la hoja de
              // Ajustes → Suplementos: un solo lugar donde se elige.
              setHoja(null);
              router.push(`/ajustes/suplementos?s=${id}`);
            }}
          />
        )}
        {hoja === "plan" && retro && (
          <View style={styles.hojaCuerpo}>
            <Lista renglones={[retro.plan.macros, retro.plan.menu, retro.plan.rutina]} />
            <PrimaryButton
              label="Ver plan de nutrición"
              onPress={() => {
                setHoja(null);
                router.push("/plan-nutricion");
              }}
            />
            <PrimaryButton
              label="Ver rutinas"
              onPress={() => {
                setHoja(null);
                router.push("/rutinas");
              }}
            />
          </View>
        )}
      </HojaDetalle>
    </SafeAreaView>
  );
}

function tituloDe(hoja: Hoja): string {
  switch (hoja) {
    case "mes":
      return "Este mes";
    case "fotos":
      return "Tus fotos";
    case "bien":
      return "Va bien";
    case "ajustar":
      return "Hay que ajustar";
    case "plan":
      return "Tu plan de aquí en adelante";
    case "suplementos":
      return "Suplementos sugeridos";
    default:
      return "";
  }
}

function HojaDetalle({
  visible,
  titulo,
  onClose,
  children,
}: {
  visible: boolean;
  titulo: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.back}>
            <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
            <Text style={styles.backText}>Atrás</Text>
          </Pressable>
          <Text style={styles.title}>{titulo}</Text>
          {children}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Lista({ renglones }: { renglones: string[] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.hojaCuerpo}>
      {renglones.map((renglon) => (
        <Parrafo key={renglon} style={styles.renglon}>
          {renglon}
        </Parrafo>
      ))}
    </View>
  );
}

function DetalleMes({ deltas }: { deltas: BloqueMensual["deltas"] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const filas = (Object.keys(METRICA_LABEL) as MetricaMensual[]).filter(
    (metrica) => deltas[metrica].actual !== null,
  );

  return (
    <View style={styles.hojaCuerpo}>
      <View style={styles.filaTabla}>
        <Text style={[styles.celda, styles.celdaTitulo]} />
        <Text style={[styles.celda, styles.celdaTitulo]}>vs mes pasado</Text>
        <Text style={[styles.celda, styles.celdaTitulo]}>vs inicio</Text>
      </View>
      {filas.map((metrica) => {
        const unidad = metrica === "peso" ? "kg" : "cm";
        const delta = deltas[metrica];
        return (
          <View key={metrica} style={styles.filaTabla}>
            <Text style={styles.celda}>
              {METRICA_LABEL[metrica]} · {delta.actual} {unidad}
            </Text>
            <Text style={styles.celda}>{flechaDelta(delta.vsMesAnterior, unidad)}</Text>
            <Text style={styles.celda}>{flechaDelta(delta.vsInicio, unidad)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function DetalleFotos({ fotos }: { fotos: BloqueMensual["fotos"] }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (!fotos || fotos.zonas.length === 0) {
    return <Text style={styles.renglon}>{resumenFotos(fotos)}.</Text>;
  }
  return (
    <View style={styles.hojaCuerpo}>
      {fotos.zonas.map((zona) => (
        <Text key={zona.zona} style={styles.renglon}>
          {ZONA_LABEL[zona.zona]}: {BRECHA_LABEL[zona.brecha]}, {TENDENCIA_LABEL[zona.tendencia]}.
        </Text>
      ))}
    </View>
  );
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
    title: {
      fontFamily: fonts.sansBold,
      ...typeScale.title,
      color: colors.marfil,
      marginBottom: spacing.sm,
    },
    eyebrow: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.label,
      letterSpacing: 1.2,
      color: colors.champan,
    },
    kcal: {
      fontFamily: fonts.sansBold,
      ...typeScale.hero,
      color: colors.marfil,
      marginTop: spacing.xs,
    },
    meta: {
      fontFamily: fonts.sans,
      ...typeScale.body,
      color: colors.paloRosaLight,
      marginTop: spacing.xs,
    },
    macroRow: {
      flexDirection: "row",
      gap: spacing.xl,
      marginTop: spacing.lg,
    },
    macro: { gap: 2 },
    macroValue: {
      fontFamily: fonts.sansBold,
      ...typeScale.heading,
      color: colors.marfil,
    },
    macroLabel: {
      fontFamily: fonts.sansMedium,
      ...typeScale.label,
      color: colors.paloRosa,
    },
    secciones: { marginTop: spacing.xl, gap: spacing.sm },
    mensaje: {
      marginTop: spacing.xl,
      paddingTop: spacing.lg,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
      gap: spacing.sm,
    },
    mensajeTitulo: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.label,
      letterSpacing: 1.2,
      color: colors.paloRosa,
    },
    mensajeTexto: {
      fontFamily: fonts.sans,
      ...typeScale.body,
      color: colors.marfil,
    },
    hojaCuerpo: { gap: spacing.md },
    renglon: {
      fontFamily: fonts.sans,
      ...typeScale.body,
      color: colors.marfil,
    },
    filaTabla: {
      flexDirection: "row",
      gap: spacing.sm,
      paddingVertical: spacing.xs,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
      borderRadius: radius.sm,
    },
    celda: {
      flex: 1,
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.marfil,
    },
    celdaTitulo: {
      fontFamily: fonts.sansSemiBold,
      color: colors.paloRosa,
    },
  });
