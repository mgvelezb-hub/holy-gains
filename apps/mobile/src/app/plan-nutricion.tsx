import { useFocusEffect, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card } from "@/components/Card";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { Parrafo } from "@/components/Parrafo";
import { SectionLabel } from "@/components/SectionLabel";
import { useTheme } from "@/context/theme";
import {
  ApiError,
  getCheckins,
  getMe,
  getNutrition,
  type MeResponse,
  type NutritionDecisionSummary,
} from "@/lib/api";
import { DIETA_ACTUAL, PRESUPUESTOS, aguaDelDia } from "@/lib/nutricion";
import { fonts, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * Hoja "Tu plan" — el desglose completo de macros y el porqué.
 *
 * En el tablero, la tarjeta "Tu plan" solo dice kcal y fase: lo suficiente
 * para un vistazo. Proteína/carbohidrato/grasa en gramos, el tipo de dieta y
 * el agua del día son cosas que se consultan, no que se leen a diario, así
 * que viven aquí. Se ven una vez cuando alguien quiere entender su plan a
 * fondo — como `porque-plan.tsx`, que hace lo mismo con las reglas del motor.
 */
export default function PlanNutricionScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [decision, setDecision] = useState<NutritionDecisionSummary | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [pesoKg, setPesoKg] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargado, setCargado] = useState(false);

  const load = useCallback(async () => {
    try {
      const [nutrition, perfil, checkins] = await Promise.all([
        getNutrition(),
        getMe().catch(() => null),
        getCheckins(4).catch(() => null),
      ]);
      setDecision(nutrition.decision);
      setMe(perfil);
      setPesoKg(checkins?.checkIns.find((fila) => fila.weightKg !== null)?.weightKg ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cargar tu plan");
    } finally {
      setCargado(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!cargado) return <LoadingState label="Cargando tu plan..." />;
  if (error && !decision) return <ErrorState message={error} onRetry={load} />;

  const agua = aguaDelDia(pesoKg);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.backText}>Atrás</Text>
        </Pressable>

        <Text style={styles.title}>Tu plan</Text>

        {!decision ? (
          <EmptyState message="En cuanto tu coach publique tu decisión, aquí aparecen tus números." />
        ) : (
          <Card>
            <SectionLabel>{decision.phase.replace(/_/g, " ")}</SectionLabel>
            <Text style={styles.kcal}>{decision.kcal} kcal</Text>
            <View style={styles.macros}>
              <Macro label="Proteína" valor={`${decision.proteinG} g`} />
              <Macro label="Carbohidratos" valor={`${decision.carbsG} g`} />
              <Macro label="Grasas" valor={`${decision.fatG} g`} />
            </View>
          </Card>
        )}

        <Card>
          <View style={styles.head}>
            <SectionLabel>Tu dieta</SectionLabel>
            <InfoTip titulo="Sobre el presupuesto">
              <TextoInfo>
                El presupuesto se cambia en Ajustes → Nutrición, y entra en tu siguiente check-in: el
                menú de esta semana ya se compró.
              </TextoInfo>
            </InfoTip>
          </View>
          <Text style={styles.nombreDieta}>
            {DIETA_ACTUAL.nombre}
            {me?.profile ? ` · ${me.profile.mealsPerDay} comidas al día` : ""}
          </Text>
          {me?.profile && (
            <Text style={styles.presupuesto}>
              Presupuesto {PRESUPUESTOS.find((p) => p.valor === me.profile!.budget)?.nombre.toLowerCase()}
            </Text>
          )}
          <Parrafo style={styles.parrafo}>{DIETA_ACTUAL.resumen}</Parrafo>
          {DIETA_ACTUAL.puntos.map((punto) => (
            <Text key={punto} style={styles.vinneta}>
              · {punto}
            </Text>
          ))}
        </Card>

        <Card>
          <SectionLabel>Agua del día</SectionLabel>
          <Text style={styles.nombreDieta}>
            {agua === null ? "Registra tu peso en el check-in para calcularla" : `${agua} litros`}
          </Text>
          <Parrafo style={styles.parrafo}>
            {agua === null
              ? "Sale de tu peso: 35 ml por kilo al día, la referencia práctica para una persona adulta sana con actividad moderada."
              : `Son 35 ml por kilo de tu peso (${pesoKg} kg), la referencia práctica para actividad moderada. Sube con el calor y con las sesiones largas; si entrenas fuerte, agrégale medio litro ese día.`}
          </Parrafo>
        </Card>

        {error && decision && <Text style={styles.errorTexto}>{error}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

function Macro({ label, valor }: { label: string; valor: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.macro}>
      <Text style={styles.macroValor}>{valor}</Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.obsidiana },
    content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.md },
    back: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      paddingVertical: spacing.sm,
      alignSelf: "flex-start",
    },
    backText: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
    title: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    head: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    kcal: {
      fontFamily: fonts.sansBold,
      ...typeScale.title,
      color: colors.marfil,
      marginTop: spacing.xs,
    },
    macros: {
      flexDirection: "row",
      gap: spacing.xl,
      marginTop: spacing.md,
    },
    macro: { gap: 2 },
    macroValor: {
      fontFamily: fonts.sansBold,
      ...typeScale.heading,
      color: colors.marfil,
    },
    macroLabel: {
      fontFamily: fonts.sansMedium,
      ...typeScale.label,
      color: colors.paloRosa,
    },
    nombreDieta: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.body,
      color: colors.marfil,
      marginTop: spacing.xs,
    },
    presupuesto: {
      fontFamily: fonts.sansMedium,
      ...typeScale.bodySm,
      color: colors.champan,
      marginTop: 2,
    },
    parrafo: {
      fontFamily: fonts.sans,
      ...typeScale.body,
      color: colors.marfil,
      marginTop: spacing.sm,
    },
    vinneta: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.paloRosaLight,
      marginTop: 2,
    },
    errorTexto: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.error,
    },
  });
