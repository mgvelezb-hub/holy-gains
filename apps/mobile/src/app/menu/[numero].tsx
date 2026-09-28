import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card } from "@/components/Card";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { Parrafo } from "@/components/Parrafo";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import { ApiError, getNutrition, postSwap, type Menu, type MenuItem, type MenuMeal } from "@/lib/api";
import { agruparComida } from "@/lib/preparaciones";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * Lo que el motor agregó en F1 y el tipo compartido de `api.ts` todavía no
 * declara: la porción ya escrita como se sirve. `why` se conserva en el tipo
 * porque la API lo manda y otras pantallas lo consumen, pero esta hoja ya no
 * lo pinta (feedback: el "?" por alimento "no sirve ni suma").
 */
type ItemDelMenu = MenuItem & {
  display?: string | null;
  why?: {
    closes: "proteina" | "carbo" | "grasa" | "fibra";
    units: number;
    unitLabel: string;
    note?: string;
  } | null;
  /** El platillo al que pertenece (licuado, sopa); ausente si va suelto. */
  preparacionId?: string;
};

/** La comida con su platillo, que `api.ts` todavía no declara. */
type ComidaConPlatillo = MenuMeal & {
  preparacion?: { id: string; nombre: string; tipo: string };
};

/**
 * Hoja de un menú completo — `/menu/1` o `/menu/2`.
 *
 * Antes las comidas del menú vivían adentro de la tarjeta de Nutrición: abrir
 * "Menú 1" empujaba el resto del tablero hacia abajo y competía por espacio
 * con las demás tarjetas. La LEY DE DISEÑO del dueño es clara: nada se abre
 * hacia abajo, cada zoom-in es su propia hoja. Aquí vive el menú completo, y
 * el swap sigue siendo interacción (se abre al tocar el alimento) porque es
 * captura de una elección, no lectura de un párrafo.
 *
 * Vuelve a llamar `getNutrition()` en vez de recibir el menú por parámetro
 * (patrón de `lista-super.tsx`): así, si el usuario ya cambió un alimento
 * antes de llegar aquí, o lo cambia y sale, esta hoja siempre pinta lo que el
 * servidor tiene guardado, sin depender de que la pantalla anterior le pase
 * datos frescos.
 */
export default function MenuScreen() {
  const router = useRouter();
  const { numero } = useLocalSearchParams<{ numero: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [menus, setMenus] = useState<Menu[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const menuNumber = Number(numero);

  const load = useCallback(async () => {
    try {
      const nutrition = await getNutrition();
      setMenus(nutrition.menus);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cargar tu menú");
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (!menus && !error) return <LoadingState label="Cargando tu menú..." />;
  if (!menus && error) return <ErrorState message={error} onRetry={load} />;
  if (!menus) return null;

  const menu = menus.find((m) => m.menuNumber === menuNumber) ?? null;

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

        <Text style={styles.title}>{menu ? `Menú ${menu.menuNumber}` : "Menú"}</Text>

        {!menu || menu.meals.length === 0 ? (
          <EmptyState message="Cuando tengas un menú publicado, aquí aparecen sus comidas." />
        ) : (
          menu.meals.map((meal) => (
            <Card key={meal.slot}>
              <ComidaDelMenu meal={meal} menuNumber={menu.menuNumber} onSwapped={load} />
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Una comida del menú: la lista limpia, y la equivalencia solo si se pide.
 *
 * Movida tal cual desde `nutricion.tsx` — mismo comportamiento, misma
 * explicación. La cantidad se lee primero en la unidad en que se sirve —"3
 * tortillas"— y los gramos van al lado, más chicos: siguen siendo la cifra
 * exacta, pero ya no son lo primero que hay que interpretar.
 *
 * Elegir una opción llama `POST /nutricion/swap`, y al guardar se refresca
 * el menú con el mismo `getNutrition()` de esta hoja (`onSwapped`). Si el
 * servidor rechaza el cambio, no se toca el estado local: no hay nada que
 * revertir porque nunca se aplicó de más.
 */
function ComidaDelMenu({
  meal,
  menuNumber,
  onSwapped,
}: {
  meal: MenuMeal;
  menuNumber: number;
  onSwapped: () => Promise<void>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [cambiando, setCambiando] = useState<string | null>(null);
  const [errorCambio, setErrorCambio] = useState<string | null>(null);

  const equivalenciaDe = (nombre: string) =>
    meal.equivalences.find((equivalencia) => equivalencia.forName === nombre) ?? null;

  async function cambiar(forName: string, toName: string) {
    if (cambiando) return;
    setErrorCambio(null);
    setCambiando(toName);
    try {
      await postSwap({ menuNumber, slot: meal.slot, forName, toName });
      await onSwapped();
      setAbierto(null);
    } catch (error) {
      setErrorCambio(error instanceof ApiError ? error.message : "No se pudo hacer el cambio");
    } finally {
      setCambiando(null);
    }
  }

  const grupo = agruparComida(
    meal.items as ItemDelMenu[],
    (meal as ComidaConPlatillo).preparacion,
  );

  function renglon(item: ItemDelMenu) {
    const equivalencia = equivalenciaDe(item.name);
    const expandido = abierto === item.name;
    // El motor ya escribe la cantidad como se sirve —"2 cditas"—; si el
    // menú es viejo, se cae a la porción por pieza y luego a los gramos.
    const cantidad =
      item.why && item.why.unitLabel !== "g"
        ? `${item.display?.split(" de ")[0] ?? ""}`.trim()
        : (item.portion ?? "");

    return (
      <View key={item.name}>
        <Pressable
          onPress={() => {
            if (!equivalencia) return;
            setErrorCambio(null);
            setAbierto(expandido ? null : item.name);
          }}
          disabled={!equivalencia}
          style={styles.itemFila}
        >
          <View style={styles.itemNombre}>
            <Text style={styles.item}>
              {item.name}
              {item.free ? " · libre" : ""}
            </Text>
          </View>

          <View style={styles.itemCantidad}>
            {cantidad ? (
              <Text style={styles.itemPorcion} numberOfLines={2}>
                {cantidad}
              </Text>
            ) : !item.free ? (
              <Text style={styles.itemPorcion}>{item.grams} g</Text>
            ) : null}
            {cantidad && !item.free ? (
              <Text style={styles.itemGramos}>{item.grams} g</Text>
            ) : null}
          </View>

          {equivalencia ? (
            <Text style={styles.itemCambio}>{expandido ? "−" : "cambiar"}</Text>
          ) : null}
        </Pressable>

        {expandido && equivalencia && (
          <View style={styles.equivalenciaWrap}>
            {equivalencia.aproximada ? (
              <Parrafo style={styles.equivalenciaAviso}>
                Cambio aproximado: los macros no quedan idénticos, pero es lo más cercano de tu
                catálogo. Se queda guardado.
              </Parrafo>
            ) : (
              <InfoTip titulo="Sobre este cambio">
                <TextoInfo>El cambio se queda: tu menú, tu widget y tu día lo muestran así.</TextoInfo>
              </InfoTip>
            )}
            <ScrollView
              style={styles.equivalenciaLista}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              {equivalencia.options.map((opcion) => {
                const aplicando = cambiando === opcion.name;
                return (
                  <Pressable
                    key={opcion.name}
                    onPress={() => cambiar(equivalencia.forName, opcion.name)}
                    disabled={cambiando !== null}
                    style={[styles.equivalenciaOpcion, aplicando && styles.equivalenciaOpcionOn]}
                  >
                    <Text style={styles.equivalenciaOpcionTexto} numberOfLines={2}>
                      {opcion.portion ?? `${opcion.name} (${opcion.grams} g)`}
                    </Text>
                    {aplicando ? (
                      <ActivityIndicator size="small" color={colors.champan} />
                    ) : opcion.aproximada ? (
                      <Text style={styles.equivalenciaAprox}>aprox.</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            {errorCambio && <Text style={styles.equivalenciaError}>{errorCambio}</Text>}
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.meal}>
      <Text style={styles.mealLabel}>
        {meal.label} · {meal.timeHint}
      </Text>

      {/* El platillo va primero: su nombre en una línea y sus ingredientes
          debajo, uno por renglón —sin acordeón—. Lo suelto sigue después. */}
      {grupo.platillo ? (
        <>
          <Text style={styles.platillo} numberOfLines={2}>
            {grupo.platillo.nombre}
          </Text>
          <View style={styles.platilloIngredientes}>
            {grupo.ingredientes.map((item) => renglon(item))}
          </View>
        </>
      ) : null}
      {grupo.sueltos.map((item) => renglon(item))}
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
    title: {
      fontFamily: fonts.sansBold,
      ...typeScale.title,
      color: colors.marfil,
      marginBottom: -spacing.xs,
    },
    meal: {
      gap: 2,
    },
    platillo: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.body,
      color: colors.marfil,
      paddingTop: 5,
    },
    platilloIngredientes: {
      paddingLeft: spacing.md,
      borderLeftWidth: 1,
      borderLeftColor: colors.cardBorder,
    },
    mealLabel: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.subheading,
      color: colors.champan,
      marginBottom: spacing.xs,
    },
    itemFila: {
      flexDirection: "row",
      alignItems: "baseline",
      gap: spacing.sm,
      paddingVertical: 5,
    },
    itemNombre: {
      flex: 1,
      minWidth: 110,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
    },
    item: {
      flexShrink: 1,
      fontFamily: fonts.sans,
      ...typeScale.body,
      color: colors.marfil,
    },
    itemCantidad: {
      alignItems: "flex-end",
      flexShrink: 1,
      maxWidth: "45%",
    },
    itemPorcion: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.body,
      color: colors.marfil,
      fontVariant: ["tabular-nums"],
      textAlign: "right",
    },
    itemGramos: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.paloRosa,
      fontVariant: ["tabular-nums"],
    },
    itemCambio: {
      fontFamily: fonts.sansMedium,
      ...typeScale.bodySm,
      color: colors.champan,
      width: 62,
      textAlign: "right",
    },
    equivalenciaWrap: {
      gap: spacing.sm,
      marginBottom: spacing.sm,
      paddingLeft: spacing.sm,
    },
    equivalenciaAviso: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.paloRosa,
    },
    equivalenciaLista: {
      maxHeight: 260,
      marginTop: spacing.sm,
    },
    equivalenciaOpcion: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginBottom: 6,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
      minHeight: 44,
    },
    equivalenciaAprox: {
      fontFamily: fonts.sans,
      ...typeScale.label,
      color: colors.paloRosa,
    },
    equivalenciaOpcionOn: {
      backgroundColor: colors.guinda,
      borderColor: colors.guindaLight,
    },
    equivalenciaOpcionTexto: {
      flex: 1,
      fontFamily: fonts.sansMedium,
      ...typeScale.bodySm,
      color: colors.marfil,
    },
    equivalenciaError: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.error,
    },
  });
