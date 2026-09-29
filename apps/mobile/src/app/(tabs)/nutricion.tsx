import {
  Activity,
  AlertTriangle,
  CalendarClock,
  Clock,
  Flame,
  FlaskConical,
  Info,
  MessageCircleQuestion,
  Package,
  Pill,
  ShoppingBasket,
  Sun,
  UtensilsCrossed,
} from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";

import { EngraneAjustes } from "@/components/EngraneAjustes";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { ScoreCard, type ScoreTone } from "@/components/ScoreCard";
import { SectionLabel } from "@/components/SectionLabel";
import { ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import { useScrollTop } from "@/lib/scroll-top";
import { ApiError, putMenuPreferido, type MenuPreference } from "@/lib/api";
import { getPlanNutricion, type AvisoPlan, type PlanNutricion } from "@/lib/api-nutricion";
import {
  faseLegible,
  lineaHorarios,
  lineaHoy,
  lineaMenu,
  lineaPlan,
  lineaSuper,
  lineaSuplementos,
} from "@/lib/plan-nutricion";
import { programarComidas } from "@/lib/recordatorio";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";
import { actualizarComidaEnElReloj, enviarSiguienteComidaAlReloj } from "@/lib/reloj-nativo";
import { comidaCompleta, comidasPendientesDesde, itemsParaAviso, renglonesPlanos } from "@/lib/siguiente-comida";
import { syncWidgetData } from "@/lib/widget";
import { avisoDeMenuPorMostrar, marcaAvisoDeMenuVisto } from "@/lib/aviso-menu";

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
 * K1: todo sale de `planDeNutricion` (`GET /api/v1/nutricion/plan`). Las
 * tarjetas solo dicen en una línea lo que el plan ya trae —kcal y fase, la
 * próxima comida con sus tomas, los menús, la lista con lo que ya tienes, las
 * tomas, los horarios— y los avisos (freno clínico, glucosa, vitamina D,
 * despensa) van arriba con su acción. Nada se calcula aquí, ni los
 * recordatorios: llegan ya escritos y con la hora de cada día.
 */

const ICONO_AVISO = { freno: AlertTriangle, glucosa: Activity, vitamina_d: Sun, despensa: Package } as const;
const TONO_AVISO: Record<AvisoPlan["nivel"], ScoreTone> = { freno: "alto", aviso: "warn", info: "neutral" };
const ETIQUETA_AVISO: Record<AvisoPlan["nivel"], string> = { freno: "Freno", aviso: "Ajusta tu plan", info: "" };

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
  const [plan, setPlan] = useState<PlanNutricion | null>(null);
  // "Tu menú se actualizó con las reglas nuevas": una sola vez por decisión.
  const [avisoMenu, setAvisoMenu] = useState<{ llave: string; texto: string } | null>(null);
  const [sinOnboarding, setSinOnboarding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const nuevo = await getPlanNutricion();
      setPlan(nuevo);
      void avisoDeMenuPorMostrar(nuevo)
        .then((pendiente) => {
          setAvisoMenu(pendiente);
          if (pendiente) void marcaAvisoDeMenuVisto(pendiente.llave);
        })
        .catch(() => {});
      setSinOnboarding(false);
      setError(null);

      // El widget y el reloj reciben la próxima comida del menú de HOY (el
      // que dice el plan), con la hora de hoy ya resuelta.
      try {
        const pendientes = comidasPendientesDesde(nuevo);
        const siguiente = pendientes[0] ?? null;
        const datos = {
          comidaLabel: siguiente?.nombre ?? null,
          comidaHora: siguiente?.hora ?? null,
          comidaItems: siguiente ? renglonesPlanos(siguiente) : null,
          comidaDetalle: siguiente,
        };
        syncWidgetData(datos);
        actualizarComidaEnElReloj({ comida: datos.comidaLabel, comidaHora: datos.comidaHora, comidaItems: datos.comidaItems });
        enviarSiguienteComidaAlReloj(pendientes);
      } catch {
        // Sincronizar el widget o el reloj nunca debe tumbar Nutrición.
      }

      // Los avisos de comida llegan escritos del servidor: el "Prepárate" con
      // su menú y sus tomas, y la hora de cada día (el sábado distinto). Los
      // renglones salen de la misma fuente que el widget y el reloj (el
      // platillo con sus ingredientes); si el slot no está en el menú de hoy,
      // se quedan los del servidor.
      void programarComidas(
        nuevo.recordatorios.map((rec) => {
          const completa = comidaCompleta(nuevo, rec.slot);
          return {
            slot: rec.slot,
            label: rec.label,
            extras: rec.extras,
            menuNumber: rec.menuNumber,
            items: completa ? itemsParaAviso(completa) : rec.items,
            horaPorDia: rec.horaPorDia,
          };
        }),
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setSinOnboarding(true);
        setError(null);
        return;
      }
      setError(e instanceof ApiError ? e.message : "No se pudo cargar tu alimentación");
    }
  }, []);

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

  if (!plan && !error && !sinOnboarding) return <LoadingState label="Cargando tu alimentación..." />;
  if (!plan && error) return <ErrorState message={error} onRetry={load} />;

  const preferencia = plan?.menuPreference ?? "AMBOS";
  const menus = (plan?.menus ?? []).filter(
    (menu) =>
      preferencia === "AMBOS" ||
      (preferencia === "MENU_1" && menu.menuNumber === 1) ||
      (preferencia === "MENU_2" && menu.menuNumber === 2),
  );

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

      {avisoMenu && (
        <ScoreCard
          icon={Package}
          tint={colors.champan}
          title="Menú actualizado"
          summary={avisoMenu.texto}
          status={null}
          onPress={() => setAvisoMenu(null)}
        />
      )}

      {(plan?.avisos ?? []).map((aviso) => (
        <ScoreCard
          key={aviso.id}
          icon={ICONO_AVISO[aviso.id]}
          tint={aviso.nivel === "freno" ? colors.error : colors.champan}
          title={aviso.titulo}
          summary={aviso.corto}
          status={aviso.nivel === "info" ? null : { label: ETIQUETA_AVISO[aviso.nivel], tone: TONO_AVISO[aviso.nivel] }}
          onPress={aviso.accion ? () => router.push(aviso.accion!.ruta as never) : undefined}
          infoTip={
            <InfoTip titulo={aviso.titulo}>
              <TextoInfo>{aviso.texto}</TextoInfo>
            </InfoTip>
          }
        />
      ))}

      <ScoreCard
        icon={Flame}
        tint={colors.champan}
        title="Tu plan"
        summary={plan ? lineaPlan(plan) : "Termina tu perfil para ver tu plan"}
        status={plan?.decision ? { label: faseLegible(plan.decision.phase), tone: "ok" } : null}
        onPress={plan?.decision ? () => router.push("/plan-nutricion" as never) : undefined}
        infoTip={
          plan?.porque ? (
            <InfoTip titulo="Por qué estos números">
              <TextoInfo>{plan.porque}</TextoInfo>
            </InfoTip>
          ) : undefined
        }
      />

      {plan && plan.hoy.comidas.length > 0 && (
        <ScoreCard
          icon={Clock}
          tint={colors.paloRosa}
          title="Hoy"
          summary={lineaHoy(plan)}
          onPress={() => router.push("/comida-hoy" as never)}
        />
      )}

      {plan && plan.menus.length > 1 && <SelectorDeMenu preferencia={preferencia} onCambio={() => void load()} />}

      {plan &&
        menus.map((menu) => (
          <ScoreCard
            key={menu.menuNumber}
            icon={UtensilsCrossed}
            tint={colors.guindaLight}
            title={`Menú ${menu.menuNumber}`}
            summary={lineaMenu(menu, plan)}
            onPress={() => router.push(`/menu/${menu.menuNumber}` as never)}
          />
        ))}

      {plan && (
        <ScoreCard
          icon={ShoppingBasket}
          tint={colors.paloRosa}
          title="Lista de súper"
          summary={lineaSuper(plan)}
          onPress={() => router.push("/lista-super" as never)}
        />
      )}

      {plan && (plan.resumenTomas.total > 0 || plan.tomasPausadas > 0) && (
        <ScoreCard
          icon={Pill}
          tint={colors.champan}
          title="Suplementos"
          summary={lineaSuplementos(plan)}
          status={plan.freno ? { label: "En pausa", tone: "alto" } : null}
          onPress={() => router.push("/suplementos-hoy" as never)}
        />
      )}

      {plan && plan.hoy.comidas.length > 0 && (
        <ScoreCard
          icon={CalendarClock}
          tint={colors.guindaLight}
          title="Horarios"
          summary={lineaHorarios(plan)}
          onPress={() => router.push("/ajustes/detalle/horarios-comida" as never)}
        />
      )}

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
              Se guardan y se grafican. Tu glucosa en ayuno y tu vitamina D sí cambian tu plan: la
              primera pide carbohidratos de índice glucémico bajo y más fibra, la segunda trae la
              sugerencia de D3. Lo que salga fuera del rango de tu laboratorio lo revisa un médico.
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
  /** Ya guardó: la pantalla vuelve a pedir el plan (la lista cambia con la elección). */
  onCambio: () => void;
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
      await putMenuPreferido(valor);
      onCambio();
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
