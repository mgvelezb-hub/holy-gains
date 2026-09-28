import {
  Flame,
  FlaskConical,
  Info,
  MessageCircleQuestion,
  ShoppingBasket,
  UtensilsCrossed,
} from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";

import { EngraneAjustes } from "@/components/EngraneAjustes";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { ScoreCard } from "@/components/ScoreCard";
import { SectionLabel } from "@/components/SectionLabel";
import { ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import { useScrollTop } from "@/lib/scroll-top";
import {
  ApiError,
  getHorariosComidaCompleto,
  getSuplementos,
  getNutrition,
  ONBOARDING_WEEK_DAYS,
  putMenuPreferido,
  type GroceryItem,
  type MenuPreference,
  type NutritionResponse,
} from "@/lib/api";
import { programarComidas, type ComidaAviso } from "@/lib/recordatorio";
import { extrasPorSlot } from "@/lib/suplementos";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";
import { actualizarComidaEnElReloj } from "@/lib/reloj-nativo";
import { formatMealItem, pickNextMeal, syncWidgetData } from "@/lib/widget";

/**
 * Nutrición — tablero de scorecards de una línea.
 *
 * LEY DE DISEÑO del dueño: primera impresión de orden, nada de texto suelto,
 * todo agrupado en tarjetas de una línea, y ningún zoom-in se abre hacia
 * abajo — cada uno abre su propia hoja. Antes esta pantalla mezclaba tarjetas
 * expandibles (macros, dieta, agua, cada menú completo, la consulta al plan)
 * con tarjetas que navegan (lista de súper, por qué del plan); abrir dos o
 * tres a la vez volvía la pantalla un acordeón largo. Ahora CADA tarjeta
 * navega — los macros completos y el porqué viven en `/plan-nutricion`, cada
 * menú completo con su swap vive en `/menu/[numero]`, y la consulta libre
 * vive en `/pregunta-plan`. Esta pantalla vuelve a caber casi sin scroll.
 *
 * Fase 1 mueve de casa lo que ya existía en Hoy. El tipo de dieta, sus
 * beneficios, los platillos por tiempo de preparación y el porqué de cada
 * alimento entran en la fase de Nutrición, no aquí.
 */

/** true si el error de API es "onboarding incompleto" (403): no es una falla real. */
function isOnboardingIncomplete(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

export default function NutricionScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Tocar esta pestaña estando en ella regresa el scroll hasta arriba.
  const scrollRef = useScrollTop();
  const [data, setData] = useState<NutritionResponse | null>(null);
  // Qué menús se cocinan esta semana y la lista de súper que les corresponde.
  // Viven aquí y no dentro del selector porque la lista de abajo también las
  // usa: cambiar de menú tiene que mover las dos cosas a la vez.
  const [preferencia, setPreferencia] = useState<MenuPreference>("AMBOS");
  const [groceriesLocal, setGroceriesLocal] = useState<GroceryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const nutrition = await getNutrition().catch((e) =>
        isOnboardingIncomplete(e) ? null : Promise.reject(e),
      );
      setData(nutrition ?? { decision: null, menus: [], groceries: [], materialized: false });
      setPreferencia(nutrition?.menuPreference ?? "AMBOS");
      // La lista recién llegada manda sobre cualquier recálculo anterior.
      setGroceriesLocal(null);

      // Nutrición es la única pantalla donde el usuario cambia un alimento
      // (swap, ahora en su propia hoja `/menu/[numero]`) y la equivalencia
      // queda guardada en el servidor: si no avisamos aquí, el widget de iOS
      // se queda con la comida vieja hasta que el usuario abre Hoy. Se
      // recarga al enfocar esta pantalla (ver `useFocusEffect` abajo), así
      // que volver de un swap en la hoja del menú también resincroniza esto.
      // Igual que Hoy, tomamos el menú 1 (`menus[0]`) como el vigente del
      // día — es el mismo criterio que ya usa `index.tsx` para el widget, así
      // ambas pantallas están de acuerdo en cuál menú es "el de hoy". Mandamos
      // SOLO los campos de comida: racha/entreno son de Hoy, y como
      // `undefined` no borra nada (ver el contrato en `lib/widget.ts`), no se
      // los pisamos desde aquí.
      try {
        const nextMeal = pickNextMeal(nutrition?.menus[0]?.meals ?? []);
        syncWidgetData({
          comidaLabel: nextMeal?.label ?? null,
          comidaHora: nextMeal?.timeHint ?? null,
          comidaItems: nextMeal ? nextMeal.items.slice(0, 3).map(formatMealItem) : null,
        });

        // El reloj recibe lo mismo, conservando lo que Hoy ya le dijo de
        // entrenamiento y racha (esta pantalla no sabe de eso).
        actualizarComidaEnElReloj({
          comida: nextMeal?.label ?? null,
          comidaHora: nextMeal?.timeHint ?? null,
          comidaItems: nextMeal ? nextMeal.items.slice(0, 3).map(formatMealItem) : null,
        });
      } catch {
        // Sincronizar el widget o el reloj nunca debe tumbar Nutrición.
      }

      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cargar tu alimentación");
    }
  }, []);

  /**
   * Los avisos por comida se programan con los horarios del menú vigente.
   *
   * Aquí y no en Hoy porque esta es la pantalla que ya tiene el menú completo
   * cargado; Hoy solo conoce la siguiente comida. `comida.timeHint` ya trae
   * la hora general propia aplicada (`toMenuView` la pisa sobre la del
   * motor); lo único que falta cruzar aquí es el horario por día
   * (`horariosPorDia`, Fase 2) para que un sábado con otra hora avise a su
   * propia hora, no a la de entre semana.
   */
  useFocusEffect(
    useCallback(() => {
      const comidas = data?.menus?.[0]?.meals ?? [];
      const menuNumber = data?.menus?.[0]?.menuNumber ?? 1;
      if (comidas.length === 0) return;

      let vivo = true;
      // Las tomas amarradas a cada comida viajan en su "Prepárate" ("+
      // omega-3"). Si no se pueden leer, el aviso sale igual, sin ellas.
      Promise.all([getHorariosComidaCompleto(), getSuplementos().catch(() => null)])
        .then(([respuesta, suplementos]) => {
          if (!vivo) return;
          const horariosPorDia = respuesta.horariosPorDia ?? {};
          const extras = extrasPorSlot(suplementos?.tomas ?? [], { soloPendientes: false });

          const avisos: ComidaAviso[] = comidas.map((comida) => ({
            slot: comida.slot,
            label: comida.label,
            extras: extras[comida.slot] ?? [],
            menuNumber,
            items: comida.items.map((item) => ({ name: item.name })),
            horaPorDia: Object.fromEntries(
              ONBOARDING_WEEK_DAYS.map((dia) => [dia, horariosPorDia[dia]?.[comida.slot] ?? comida.timeHint]),
            ),
          }));

          void programarComidas(avisos);
        })
        .catch(() => {
          // Sin poder leer el horario por día, se avisa con la hora general:
          // peor sería no avisar nada.
          void programarComidas(
            comidas.map((comida) => ({
              slot: comida.slot,
              label: comida.label,
              menuNumber,
              items: comida.items.map((item) => ({ name: item.name })),
              horaPorDia: Object.fromEntries(ONBOARDING_WEEK_DAYS.map((dia) => [dia, comida.timeHint])),
            })),
          );
        });
      return () => {
        vivo = false;
      };
    }, [data?.menus]),
  );

  // Se recarga al enfocar, no solo al montar: volver de la hoja de un menú
  // (donde vive el swap) tiene que verse aquí sin que la persona jale para
  // refrescar.
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

  if (!data && !error) return <LoadingState label="Cargando tu alimentación..." />;
  if (!data && error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const { decision, menus } = data;
  // La lista de súper puede venir recalculada por el selector de menú sin
  // volver a pedir toda la pantalla: mientras eso pasa, manda la local.
  const groceries = groceriesLocal ?? data.groceries;

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.paloRosa} />
      }
    >
      <View style={styles.header}>
        <Text style={styles.titulo}>Nutrición</Text>
        <EngraneAjustes seccion="nutricion" />
      </View>

      <ScoreCard
        icon={Flame}
        tint={colors.champan}
        title="Tu plan"
        summary={decision ? `${decision.kcal} kcal` : "Sin plan publicado todavía"}
        status={decision ? { label: decision.phase.replace(/_/g, " "), tone: "ok" } : null}
        onPress={decision ? () => router.push("/plan-nutricion" as never) : undefined}
      />

      {menus.length > 1 && (
        <SelectorDeMenu
          preferencia={preferencia}
          onCambio={(nueva, nuevasCompras) => {
            setPreferencia(nueva);
            setGroceriesLocal(nuevasCompras);
          }}
        />
      )}

      {menus
        .filter(
          (menu) =>
            preferencia === "AMBOS" ||
            (preferencia === "MENU_1" && menu.menuNumber === 1) ||
            (preferencia === "MENU_2" && menu.menuNumber === 2),
        )
        .map((menu) => {
          const primera = menu.meals[0];
          const resumen =
            menu.meals.length === 0
              ? "Sin comidas"
              : `${menu.meals.length} comidas · empieza ${primera?.timeHint ?? ""}`.trim();
          return (
            <ScoreCard
              key={menu.menuNumber}
              icon={UtensilsCrossed}
              tint={colors.guindaLight}
              title={`Menú ${menu.menuNumber}`}
              summary={resumen}
              onPress={() => router.push(`/menu/${menu.menuNumber}` as never)}
            />
          );
        })}

      <ScoreCard
        icon={ShoppingBasket}
        tint={colors.paloRosa}
        title="Lista de súper"
        summary={
          groceries.length === 0
            ? "Sin artículos todavía"
            : `${groceries.length} ${groceries.length === 1 ? "artículo" : "artículos"} · ${
                preferencia === "AMBOS" ? "los dos menús" : "un menú"
              }`
        }
        onPress={() => router.push("/lista-super" as never)}
      />

      <ScoreCard
        icon={Info}
        tint={colors.guindaLight}
        title="Por qué tu plan se ve así"
        summary="Las reglas que arman tu menú, en español"
        onPress={() => router.push("/porque-plan" as never)}
      />

      <ScoreCard
        icon={MessageCircleQuestion}
        tint={colors.champan}
        title="Pregúntale a tu plan"
        summary="Por qué esos alimentos, cómo cambiar uno, qué hacer si comes fuera"
        onPress={() => router.push("/pregunta-plan" as never)}
      />

      <ScoreCard
        icon={FlaskConical}
        tint={colors.paloRosa}
        title="Tus estudios"
        summary="InBody y química sanguínea, con su historial"
        onPress={() => router.push("/laboratorios" as never)}
        infoTip={
          <InfoTip titulo="Sobre tus estudios">
            <TextoInfo>
              Se guardan y se grafican. La app no los interpreta: lo que salga fuera del rango de tu
              laboratorio lo revisa un médico.
            </TextoInfo>
          </InfoTip>
        }
      />
    </ScrollView>
  );
}

/**
 * "¿Cuál de los dos menús cocino esta semana?"
 *
 * LA CONFUSIÓN que resuelve: la pantalla enseñaba dos menús sin decir qué
 * eran, y la lectura natural —"¿es uno por semana? ¿son dos semanas?"— estaba
 * mal. Son dos variantes de LA MISMA semana: mismos macros, distintos
 * alimentos, para no comer lo mismo siete días. Aquí se dice con todas sus
 * letras y se puede elegir cocinar uno solo.
 *
 * Compacta: antes cada opción era una fila completa con su propia frase de
 * explicación, tres renglones altos apilados. El QUÉ (mismos macros, evita
 * repetir comida) y el POR QUÉ de cada opción se movieron al `InfoTip` del
 * título; lo que queda a la vista son tres pastillas de una palabra.
 *
 * Elegir cambia la lista de súper, que es lo que de verdad duele: comprar los
 * ingredientes de un menú que no vas a cocinar es tirar comida. Un menú solo
 * se come los 7 días, así que su lista trae el doble de cada cosa.
 */
function SelectorDeMenu({
  preferencia,
  onCambio,
}: {
  preferencia: MenuPreference;
  onCambio: (nueva: MenuPreference, groceries: GroceryItem[]) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [guardando, setGuardando] = useState<MenuPreference | null>(null);
  const [error, setError] = useState<string | null>(null);

  const OPCIONES: Array<{ valor: MenuPreference; nombre: string }> = [
    { valor: "AMBOS", nombre: "Los dos" },
    { valor: "MENU_1", nombre: "Solo el 1" },
    { valor: "MENU_2", nombre: "Solo el 2" },
  ];

  async function elegir(valor: MenuPreference) {
    if (guardando || valor === preferencia) return;
    setError(null);
    setGuardando(valor);
    try {
      const respuesta = await putMenuPreferido(valor);
      onCambio(respuesta.menuPreference, respuesta.groceries);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo guardar tu elección");
    } finally {
      setGuardando(null);
    }
  }

  return (
    <View style={styles.selectorCard}>
      <View style={styles.selectorHead}>
        <SectionLabel>Tus dos menús</SectionLabel>
        <InfoTip titulo="Tus dos menús">
          <TextoInfo>
            No son dos semanas: son dos formas de comer LA MISMA semana, con los mismos macros y
            distintos alimentos, para que no acabes comiendo lo mismo siete días.
          </TextoInfo>
          <TextoInfo>Los dos: alternas, cada menú cubre media semana. Compras para ambos.</TextoInfo>
          <TextoInfo>
            Solo uno: lo comes los 7 días y su lista trae solo sus ingredientes, el doble de cada
            cosa.
          </TextoInfo>
        </InfoTip>
      </View>

      <View style={styles.selectorChips}>
        {OPCIONES.map((opcion) => {
          const activa = preferencia === opcion.valor;
          return (
            <Pressable
              key={opcion.valor}
              onPress={() => elegir(opcion.valor)}
              disabled={guardando !== null}
              style={[styles.selectorChip, activa && styles.selectorChipOn]}
            >
              {guardando === opcion.valor ? (
                <ActivityIndicator size="small" color={colors.champan} />
              ) : (
                <Text style={[styles.selectorChipTexto, activa && styles.selectorChipTextoOn]}>
                  {opcion.nombre}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>

      {error && <Text style={styles.equivalenciaError}>{error}</Text>}
    </View>
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
    gap: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  titulo: {
    fontFamily: fonts.sansBold,
    ...typeScale.title,
    color: colors.marfil,
  },
  selectorCard: {
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.cardBg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  selectorHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  selectorChips: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  selectorChip: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.obsidiana,
  },
  selectorChipOn: {
    backgroundColor: colors.guinda,
    borderColor: colors.guindaLight,
  },
  selectorChipTexto: {
    fontFamily: fonts.sansMedium,
    ...typeScale.bodySm,
    color: colors.marfil,
  },
  selectorChipTextoOn: {
    color: colors.pergamino,
  },
  equivalenciaError: {
    fontFamily: fonts.sans,
    ...typeScale.bodySm,
    color: colors.error,
  },
});
