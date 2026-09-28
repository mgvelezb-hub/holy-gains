import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card } from "@/components/Card";
import { Parrafo } from "@/components/Parrafo";
import { RegenerarMenu } from "@/components/RegenerarMenu";
import { SectionLabel } from "@/components/SectionLabel";
import { ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import {
  ApiError,
  getMe,
  postNutricionReplan,
  type DietStyle,
  type MeResponse,
  type NutricionReplanResponse,
} from "@/lib/api";
import { ESTILOS_DIETA, OBJETIVOS, PRESUPUESTOS, SUPLEMENTOS } from "@/lib/nutricion";
import { TIEMPOS_COCINA } from "@/lib/entrenamiento";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";

/**
 * Rearmar el perfil de alimentación.
 *
 * El equivalente del replanteo de rutina: se contestan las preguntas que de
 * verdad cambian el menú y el perfil queda de nuevo.
 *
 * La diferencia con Ajustes no es la lista de campos —son casi los mismos—
 * sino el momento: ahí se corrige una cosa, aquí se replantea el conjunto. Por
 * eso al final llega una **lectura** de lo que cada respuesta implica, incluido
 * lo que cuesta: una dieta que aparece sin explicación se sigue tres días.
 */
export default function ReplantearDietaScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState<NutricionReplanResponse | null>(null);

  const [objetivo, setObjetivo] = useState("RECOMPOSICION");
  const [comidas, setComidas] = useState(4);
  const [presupuesto, setPresupuesto] = useState<"BAJO" | "MEDIO" | "ALTO">("MEDIO");
  const [dieta, setDieta] = useState<DietStyle>("ESTANDAR");
  const [tiempoCocina, setTiempoCocina] = useState<number | null>(20);
  const [suplementos, setSuplementos] = useState<Array<"WHEY" | "CREATINA" | "OMEGA3">>([]);
  const [excluidos, setExcluidos] = useState("");
  const [favoritos, setFavoritos] = useState("");

  const cargar = useCallback(async () => {
    try {
      const perfil = await getMe();
      setMe(perfil);
      if (!perfil.profile) return;

      // Se parte de lo que ya hay: replantear no es empezar en blanco, es
      // volver a mirar cada respuesta con lo que la persona sabe hoy.
      setObjetivo(perfil.profile.goal ?? "RECOMPOSICION");
      setComidas(perfil.profile.mealsPerDay ?? 4);
      setPresupuesto(perfil.profile.budget ?? "MEDIO");
      setDieta((perfil.profile.dietStyle as DietStyle) ?? "ESTANDAR");
      setTiempoCocina(perfil.profile.maxPrepMin ?? null);
      setSuplementos(
        ((perfil.profile.supplements ?? []) as Array<"WHEY" | "CREATINA" | "OMEGA3">).filter(
          (valor) => SUPLEMENTOS.some((opcion) => opcion.valor === valor),
        ),
      );
      setExcluidos((perfil.profile.excludedFoods ?? []).join(", "));
      setFavoritos((perfil.profile.favoriteFoods ?? []).join(", "));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar tu perfil");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function lista(texto: string): string[] {
    return texto
      .split(",")
      .map((entrada) => entrada.trim())
      .filter(Boolean);
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      setResultado(
        await postNutricionReplan({
          goal: objetivo,
          mealsPerDay: comidas,
          budget: presupuesto,
          dietStyle: dieta,
          maxPrepMin: tiempoCocina,
          supplements: suplementos,
          excludedFoods: lista(excluidos),
          favoriteFoods: lista(favoritos),
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar tu perfil");
    } finally {
      setGuardando(false);
    }
  }

  if (error && !me) return <ErrorState message={error} onRetry={() => void cargar()} />;
  if (!me) return <LoadingState label="Cargando tu perfil..." />;

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.backText}>Atrás</Text>
        </Pressable>

        <Text style={styles.title}>Rearmar tu alimentación</Text>
        <Parrafo style={styles.subtitle}>
          Las respuestas que cambian tu menú, todas juntas. Entra con tu siguiente check-in.
        </Parrafo>

        <Card>
          <SectionLabel>Para qué entrenas</SectionLabel>
          <Opciones
            opciones={OBJETIVOS.map((opcion) => ({
              valor: opcion.valor,
              nombre: opcion.nombre,
              detalle: opcion.detalle,
            }))}
            activo={objetivo}
            onElegir={setObjetivo}
          />
        </Card>

        <Card>
          <SectionLabel>Cuántas comidas al día</SectionLabel>
          <View style={styles.chips}>
            {[3, 4, 5].map((cuantas) => (
              <Pressable
                key={cuantas}
                onPress={() => setComidas(cuantas)}
                style={[styles.chip, comidas === cuantas && styles.chipOn]}
              >
                <Text style={[styles.chipTexto, comidas === cuantas && styles.chipTextoOn]}>
                  {cuantas}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>

        <Card>
          <SectionLabel>Tu tipo de dieta</SectionLabel>
          <Opciones
            opciones={ESTILOS_DIETA.map((estilo) => ({
              valor: estilo.valor,
              nombre: estilo.nombre,
              detalle: estilo.detalle,
            }))}
            activo={dieta}
            onElegir={(valor) => setDieta(valor as DietStyle)}
          />
        </Card>

        <Card>
          <SectionLabel>Presupuesto</SectionLabel>
          <Opciones
            opciones={PRESUPUESTOS.map((opcion) => ({
              valor: opcion.valor,
              nombre: opcion.nombre,
              detalle: opcion.detalle,
            }))}
            activo={presupuesto}
            onElegir={(valor) => setPresupuesto(valor as "BAJO" | "MEDIO" | "ALTO")}
          />
        </Card>

        <Card>
          <SectionLabel>Cuánto tiempo para cocinar</SectionLabel>
          <Opciones
            opciones={TIEMPOS_COCINA.map((opcion: (typeof TIEMPOS_COCINA)[number]) => ({
              valor: String(opcion.valor),
              nombre: opcion.nombre,
              detalle: opcion.detalle,
            }))}
            activo={String(tiempoCocina)}
            onElegir={(valor) => setTiempoCocina(valor === "null" ? null : Number(valor))}
          />
        </Card>

        <Card>
          <SectionLabel>Lo que tienes en la alacena</SectionLabel>
          <Opciones
            opciones={SUPLEMENTOS.map((opcion) => ({
              valor: opcion.valor,
              nombre: opcion.nombre,
              detalle: opcion.detalle,
            }))}
            activo={null}
            varios={suplementos}
            onElegir={(valor) =>
              setSuplementos((previos) =>
                previos.includes(valor as "WHEY" | "CREATINA" | "OMEGA3")
                  ? previos.filter((entrada) => entrada !== valor)
                  : [...previos, valor as "WHEY" | "CREATINA" | "OMEGA3"],
              )
            }
          />
        </Card>

        <Card>
          <SectionLabel>Lo que sí y lo que no</SectionLabel>
          <Text style={styles.campoLabel}>Lo que te gusta</Text>
          <TextInput
            value={favoritos}
            onChangeText={setFavoritos}
            placeholder="pollo, camote, aguacate"
            placeholderTextColor={colors.paloRosaLight}
            style={styles.input}
          />

          <Text style={styles.campoLabel}>Lo que no comes</Text>
          <TextInput
            value={excluidos}
            onChangeText={setExcluidos}
            placeholder="atún, brócoli"
            placeholderTextColor={colors.paloRosaLight}
            style={styles.input}
          />
          <Parrafo style={styles.ayuda}>
            Separa con comas. Las alergias no se editan aquí: esas las lleva tu perfil y nunca
            entran, ni por equivalencia.
          </Parrafo>
        </Card>

        <Pressable
          onPress={guardar}
          disabled={guardando}
          style={[styles.boton, guardando && styles.botonOff]}
        >
          <Text style={styles.botonTexto}>
            {guardando ? "Guardando..." : "Guardar y ver qué implica"}
          </Text>
        </Pressable>

        {error && <Text style={styles.errorTexto}>{error}</Text>}

        {resultado && (
          <Card>
            <SectionLabel>Qué implica</SectionLabel>
            {resultado.lectura.length === 0 ? (
              <Parrafo style={styles.ayuda}>
                Nada de lo que elegiste tiene letra chica: tu plan sigue el método de siempre.
              </Parrafo>
            ) : (
              resultado.lectura.map((linea) => (
                <Parrafo key={linea} style={styles.lectura}>
                  {linea}
                </Parrafo>
              ))
            )}

            <Text style={styles.cuando}>{resultado.cuando}</Text>

            <RegenerarMenu />

            <Pressable onPress={() => router.replace("/nutricion")} style={styles.boton}>
              <Text style={styles.botonTexto}>Ver mi alimentación</Text>
            </Pressable>
          </Card>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Lista de opciones con su explicación: una sola o varias a la vez. */
function Opciones({
  opciones,
  activo,
  varios,
  onElegir,
}: {
  opciones: Array<{ valor: string; nombre: string; detalle: string }>;
  activo: string | null;
  varios?: string[];
  onElegir: (valor: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.opciones}>
      {opciones.map((opcion) => {
        const marcada = varios ? varios.includes(opcion.valor) : activo === opcion.valor;
        return (
          <Pressable
            key={opcion.valor}
            onPress={() => onElegir(opcion.valor)}
            style={[styles.opcion, marcada && styles.opcionOn]}
          >
            <Text style={[styles.opcionNombre, marcada && styles.opcionNombreOn]}>
              {varios && marcada ? "✓ " : ""}
              {opcion.nombre}
            </Text>
            <Text style={styles.opcionDetalle}>{opcion.detalle}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.obsidiana },
    flex: { flex: 1 },
    // El doble de `spacing.huge`: los campos de favoritos/excluidos quedan
    // cerca del final del scroll, y necesitan aire extra debajo para no
    // quedar tapados por el teclado al enfocarlos.
    content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.huge * 2 },
    back: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: spacing.sm },
    backText: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
    title: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    subtitle: { fontFamily: fonts.sans, ...typeScale.body, color: colors.paloRosa },
    ayuda: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.paloRosa,
      marginTop: spacing.sm,
    },
    opciones: { gap: spacing.sm, marginTop: spacing.sm },
    opcion: {
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: spacing.md,
      gap: 2,
    },
    opcionOn: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
    opcionNombre: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.marfil },
    opcionNombreOn: { color: colors.pergamino },
    opcionDetalle: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
    chips: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
    chip: {
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    chipOn: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
    chipTexto: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.marfil },
    chipTextoOn: { color: colors.pergamino },
    campoLabel: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.label,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: colors.paloRosa,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    input: {
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
    boton: {
      marginTop: spacing.lg,
      paddingVertical: spacing.lg,
      borderRadius: radius.full,
      backgroundColor: colors.guinda,
      borderWidth: 1,
      borderColor: colors.guindaLight,
      alignItems: "center",
    },
    botonOff: { opacity: 0.5 },
    botonTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.pergamino },
    errorTexto: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.error },
    lectura: {
      fontFamily: fonts.sans,
      ...typeScale.body,
      color: colors.marfil,
      marginTop: spacing.md,
    },
    cuando: {
      fontFamily: fonts.sansMedium,
      ...typeScale.bodySm,
      color: colors.champan,
      marginTop: spacing.lg,
      backgroundColor: withAlpha(colors.champan, 0.1),
      borderRadius: radius.md,
      padding: spacing.md,
    },
  });
