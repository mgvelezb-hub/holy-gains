import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Check, ChevronLeft, ChevronRight, PlayCircle, RotateCcw } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Hoja } from "@/components/Hoja";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { ProtocoloCardio } from "@/components/ProtocoloCardio";
import { ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import {
  getActivities,
  getMe,
  getTrainingWeek,
  patchEntrenamiento,
  type OtherSessionView,
  type UnidadVelocidad,
  type WeekView,
} from "@/lib/api";
import {
  cardioDeLaFecha,
  hayPesasPendientes,
  lunesDe,
  minutosDeCardioHechos,
  pasosDeCardio,
  tituloTarjetaCardio,
} from "@/lib/cardio";
import {
  guardaCardioDelDia,
  leeCardioDelDia,
  leeCardioEnCurso,
  leeCardioHecho,
  olvidaCardioDelDia,
  type CardioDelDiaGuardado,
} from "@/lib/cardio-en-curso";
import { getCardioDelDia, programaDe, type EquipoCardioP1, type TipoCardioP1 } from "@/lib/api-cardio";
import { unidadDe } from "@/lib/hiit";
import { conMaquinaYModalidad, OPCIONES_MAQUINA, OPCIONES_MODALIDAD } from "@/lib/programa-cardio";
import { todayISO } from "@/lib/streak";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";
import { getCachedWeek } from "@/lib/training-db";
import { guardarUnidadVelocidad } from "@/lib/unidad-velocidad";

/**
 * La hoja del cardio (N2) — su propia pantalla, porque cada zoom abre hoja
 * nueva: el título del programa ("HIIT 15' + 5' caminata · Nivel 0 ·
 * Caminadora"), la tabla COMPLETA con scroll y "Empezar cardio" fijo abajo.
 *
 * P1b: "Máquina de hoy" y "Modalidad de hoy" re-piden el cardio de ESTA
 * fecha al servidor con los mismos minutos ("la caminadora está ocupada →
 * elíptica") sin tocar la preferencia; se guarda en el teléfono para que el
 * corredor corra esa tabla. "Usar siempre" sí la vuelve preferencia.
 *
 * Antes la tabla vivía en un Modal de Rutinas que cortaba lo que pasaba del
 * 85 % y el corredor solo existía al cerrar la última serie de pesas: no
 * había cómo empezar el cardio por su cuenta. Ahora se empieza SIEMPRE; si
 * ese día aún hay pesas, se dice en una línea (va después, pero adelante).
 */
export default function CardioScreen() {
  const { fecha: fechaParam } = useLocalSearchParams<{ fecha: string }>();
  const fecha = fechaParam ?? todayISO();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [cardio, setCardio] = useState<OtherSessionView | null>(null);
  const [pesasPendientes, setPesasPendientes] = useState(false);
  const [hechoMin, setHechoMin] = useState<number | null>(null);
  const [tramoEnCurso, setTramoEnCurso] = useState<number | null>(null);
  const [unidad, setUnidad] = useState<UnidadVelocidad>("kmh");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  /** Lo elegido solo para hoy, o `null` si va la tabla del plan. */
  const [delDia, setDelDia] = useState<CardioDelDiaGuardado | null>(null);
  const [cambiando, setCambiando] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [avisoCambio, setAvisoCambio] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      let semana: WeekView | null = await getCachedWeek(lunesDe(fecha)).catch(() => null);
      let encontrado = cardioDeLaFecha(semana?.otherSessions, fecha);
      if (!encontrado) {
        semana = await getTrainingWeek(fecha);
        encontrado = cardioDeLaFecha(semana.otherSessions, fecha);
      }
      if (!encontrado || !encontrado.sesion?.cardio) {
        setError("Ese cardio no está en el teléfono. Abre Rutinas una vez con señal.");
        return;
      }
      const elegido = await leeCardioDelDia(fecha);
      if (elegido) encontrado = { ...encontrado, minutes: elegido.minutes, sesion: elegido.sesion };
      const hoy = todayISO();
      const pasos = pasosDeCardio(encontrado.sesion!.cardio!, encontrado.minutes);
      const [local, actividades, enCurso] = await Promise.all([
        leeCardioHecho(fecha),
        getActivities(30).catch(() => null),
        leeCardioEnCurso(hoy, pasos.length),
      ]);
      const delServidor = actividades ? minutosDeCardioHechos(actividades.actividades, fecha) : null;

      setCardio(encontrado);
      setDelDia(elegido);
      setUnidad(unidadDe(encontrado.sesion!.cardio));
      setPesasPendientes(hayPesasPendientes(semana?.sessions ?? [], fecha));
      setHechoMin(delServidor ?? local);
      setTramoEnCurso(enCurso ? enCurso.paso : null);
    } catch {
      setError("No se pudo abrir el cardio.");
    } finally {
      setCargando(false);
    }
  }, [fecha]);

  // Al volver del corredor, la hoja ya dice "Hecho".
  useFocusEffect(
    useCallback(() => {
      void cargar();
    }, [cargar]),
  );

  /** Cambia la unidad en pantalla de inmediato y la guarda en las preferencias de cardio. */
  function cambiarUnidad(siguiente: UnidadVelocidad) {
    setUnidad(siguiente);
    guardarUnidadVelocidad(siguiente).catch(() => {
      // Sin señal: se ve en la unidad elegida y la próxima vez se vuelve a intentar.
    });
  }

  /** Pide al servidor el cardio de hoy con otra máquina o modalidad (mismos minutos). */
  async function cambiarDelDia(cambios: { maquina?: EquipoCardioP1; modalidad?: TipoCardioP1 }) {
    if (!cardio?.sesion?.cardio || cambiando) return;
    const actual = programaDe(cardio.sesion.cardio);
    const maquina = cambios.maquina ?? delDia?.maquina ?? (actual?.maquina as EquipoCardioP1 | undefined);
    const modalidad = cambios.modalidad ?? delDia?.modalidad;
    setCambiando(true);
    setAvisoCambio(null);
    try {
      const respuesta = await getCardioDelDia(fecha, { ...(maquina ? { maquina } : {}), ...(modalidad ? { modalidad } : {}) });
      const guardado: CardioDelDiaGuardado = {
        fecha,
        maquina: maquina ?? "CAMINADORA",
        ...(modalidad ? { modalidad } : {}),
        minutes: respuesta.minutes,
        sesion: respuesta.sesion,
      };
      await guardaCardioDelDia(guardado);
      setDelDia(guardado);
      setCardio({ ...cardio, minutes: respuesta.minutes, sesion: respuesta.sesion });
      setUnidad(unidadDe(respuesta.sesion.cardio));
    } catch {
      setAvisoCambio("Sin señal no se puede recalcular la tabla. Inténtalo de nuevo.");
    } finally {
      setCambiando(false);
    }
  }

  /** Vuelve a la tabla del plan. */
  async function volverAlPlan() {
    await olvidaCardioDelDia();
    setAvisoCambio(null);
    setCargando(true);
    await cargar();
  }

  /** "Usar siempre": la máquina y la modalidad de hoy pasan a la preferencia de cardio. */
  async function usarSiempre() {
    if (!delDia) return;
    try {
      const me = await getMe();
      const otras = me.profile?.otherDisciplines ?? [];
      if (!otras.some((carga) => carga.discipline === "CARDIO")) return;
      await patchEntrenamiento({ otherDisciplines: conMaquinaYModalidad(otras, delDia.maquina, delDia.modalidad) });
      setAvisoCambio("Listo: desde ahora tu cardio es así.");
    } catch {
      setAvisoCambio("No se pudo guardar sin señal. Inténtalo de nuevo.");
    }
  }

  function empezar() {
    router.push({ pathname: "/cardio-en-vivo", params: { fecha } } as never);
  }

  if (error) return <ErrorState message={error} onRetry={() => void cargar()} />;
  if (cargando || !cardio?.sesion?.cardio) return <LoadingState label="Abriendo tu cardio..." />;

  const detalle = cardio.sesion.cardio;
  const programa = programaDe(detalle);
  const titulo = programa ? programa.titulo : tituloTarjetaCardio(detalle, cardio.minutes);
  const pasos = pasosDeCardio(detalle, cardio.minutes, unidad);

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.barra}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.atras}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.atrasTexto}>Atrás</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.contenido}>
        <Text style={styles.eyebrow}>
          CARDIO · {cardio.minutes} MIN{fecha === todayISO() ? " · HOY" : ""}
        </Text>
        <Text style={styles.titulo} accessibilityRole="header">
          {titulo}
        </Text>

        {pesasPendientes && hechoMin === null && (
          <View style={styles.orden}>
            <Text style={styles.ordenTexto}>Va después de pesas; si hoy lo haces antes, adelante.</Text>
            <InfoTip titulo="Por qué después de pesas">
              <TextoInfo>
                Cuando la fuerza es el objetivo, las pesas van primero: llegas con las piernas y el
                sistema nervioso frescos a lo que más pide técnica y carga, y el cardio no te roba
                repeticiones. Hacerlo antes no rompe nada; solo espera un poco menos en las series
                pesadas de pierna.
              </TextoInfo>
            </InfoTip>
          </View>
        )}

        {cardio.note ? <Text style={styles.nota}>{cardio.note}</Text> : null}

        {programa && (
          <View style={styles.hoy}>
            {/* Una línea que abre su hoja: nada se despliega hacia abajo. */}
            <Pressable
              onPress={() => setAbierto(true)}
              style={styles.hoyCabeza}
              accessibilityRole="button"
            >
              <Text style={styles.hoyTitulo} numberOfLines={1}>
                {delDia ? "Solo hoy · " : "Máquina y modalidad · "}
                {OPCIONES_MAQUINA.find((o) => o.valor === programa.maquina)?.nombre ?? programa.maquina}
                {" · "}
                {OPCIONES_MODALIDAD.find((o) => o.valor === programa.modalidad)?.nombre ?? programa.modalidad}
              </Text>
              <ChevronRight size={18} color={colors.paloRosa} strokeWidth={2} />
            </Pressable>
            {avisoCambio && <Text style={styles.nota}>{avisoCambio}</Text>}
          </View>
        )}

        {programa && (
          <Hoja visible={abierto} onClose={() => setAbierto(false)} titulo="Cardio de hoy">
              <>
                <Text style={styles.hoyLabel}>Máquina de hoy</Text>
                <View style={styles.chips}>
                  {OPCIONES_MAQUINA.map((opcion) => {
                    const activo = programa.maquina === opcion.valor;
                    return (
                      <Pressable
                        key={opcion.valor}
                        onPress={() => void cambiarDelDia({ maquina: opcion.valor })}
                        disabled={cambiando || activo}
                        style={[styles.chip, activo && styles.chipOn]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: activo }}
                      >
                        <Text style={[styles.chipTexto, activo && styles.chipTextoOn]}>{opcion.nombre}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.hoyLabel}>Modalidad de hoy</Text>
                <View style={styles.chips}>
                  {OPCIONES_MODALIDAD.filter((opcion) => opcion.valor !== "VARIADO").map((opcion) => {
                    const activo = programa.modalidad === opcion.valor;
                    return (
                      <Pressable
                        key={opcion.valor}
                        onPress={() => void cambiarDelDia({ modalidad: opcion.valor })}
                        disabled={cambiando || activo}
                        style={[styles.chip, activo && styles.chipOn]}
                        accessibilityRole="button"
                        accessibilityState={{ selected: activo }}
                      >
                        <Text style={[styles.chipTexto, activo && styles.chipTextoOn]}>{opcion.nombre}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {cambiando && <Text style={styles.nota}>Recalculando con los mismos {cardio.minutes} min…</Text>}
                {delDia && !cambiando && (
                  <View style={styles.hoyAcciones}>
                    <Pressable onPress={() => void usarSiempre()} style={styles.secundario} accessibilityRole="button">
                      <Text style={styles.secundarioTexto}>Usar siempre</Text>
                    </Pressable>
                    <Pressable onPress={() => void volverAlPlan()} style={styles.secundario} accessibilityRole="button">
                      <Text style={styles.secundarioTexto}>Volver al plan</Text>
                    </Pressable>
                  </View>
                )}
              </>
          </Hoja>
        )}

        {programa ? (
          <ProtocoloCardio programa={programa} unidad={unidad} onUnidad={cambiarUnidad} />
        ) : (
          <View style={styles.pasos}>
            {pasos.map((paso, indice) => (
              <View key={`${indice}-${paso.nombre}`} style={styles.pasoFila}>
                <Text style={styles.pasoNombre}>{paso.nombre}</Text>
                <Text style={styles.pasoTiempo}>{Math.round(paso.segundos / 60)} min</Text>
              </View>
            ))}
          </View>
        )}

        {cardio.sesion.notes
          .filter((nota) => nota !== programa?.notaMaquina)
          .map((nota) => (
          <Text key={nota} style={styles.nota}>
            {nota}
          </Text>
        ))}
      </ScrollView>

      {/* Fijo abajo: el botón no se va con el scroll de la tabla. */}
      <View style={styles.pie}>
        {hechoMin !== null ? (
          <>
            <View style={styles.hecho} accessibilityRole="text">
              <Check size={20} color={colors.champan} strokeWidth={2.5} />
              <Text style={styles.hechoTexto}>Hecho · {hechoMin} min</Text>
            </View>
            <Pressable onPress={empezar} style={styles.secundario} accessibilityRole="button">
              <RotateCcw size={16} color={colors.champan} strokeWidth={2} />
              <Text style={styles.secundarioTexto}>Repetir</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable onPress={empezar} style={styles.principal} accessibilityRole="button">
              <PlayCircle size={22} color={colors.pergamino} strokeWidth={2.5} />
              <Text style={styles.principalTexto}>
                {tramoEnCurso !== null ? `Seguir cardio · tramo ${tramoEnCurso + 1}` : "Empezar cardio"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: "/actividad",
                  params: { discipline: "CARDIO", minutes: `${cardio.minutes}` },
                } as never)
              }
              style={styles.secundario}
              accessibilityRole="button"
            >
              <Text style={styles.secundarioTexto}>Ya lo hice: registrarlo a mano</Text>
            </Pressable>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.obsidiana },
    barra: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
    atras: { flexDirection: "row", alignItems: "center", gap: 2, alignSelf: "flex-start", minHeight: 44 },
    atrasTexto: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
    scroll: { flex: 1 },
    contenido: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
    eyebrow: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.label,
      letterSpacing: 1.2,
      color: colors.paloRosa,
    },
    titulo: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    orden: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: withAlpha(colors.champan, 0.35),
      backgroundColor: withAlpha(colors.champan, 0.08),
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    ordenTexto: { flex: 1, fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    nota: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
    pasos: { gap: spacing.xs },
    hoy: {
      gap: spacing.sm,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.superficie,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    hoyCabeza: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 36 },
    hoyTitulo: { fontFamily: fonts.sansSemiBold, ...typeScale.bodySm, color: colors.marfil },
    hoyLabel: { fontFamily: fonts.sansMedium, ...typeScale.label, color: colors.paloRosa },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
    },
    chipOn: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
    chipTexto: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    chipTextoOn: { color: colors.pergamino },
    hoyAcciones: { flexDirection: "row", justifyContent: "space-around" },
    pasoFila: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: spacing.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.cardBg,
    },
    pasoNombre: { flex: 1, fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.marfil },
    pasoTiempo: { fontFamily: fonts.sansSemiBold, ...typeScale.bodySm, color: colors.champan },
    pie: {
      gap: spacing.xs,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
      backgroundColor: colors.obsidiana,
    },
    principal: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: colors.guinda,
      borderWidth: 1,
      borderColor: colors.guindaLight,
      borderRadius: radius.xxl,
      paddingVertical: spacing.lg,
    },
    principalTexto: { fontFamily: fonts.sansBold, ...typeScale.heading, color: colors.pergamino },
    hecho: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      borderRadius: radius.xxl,
      borderWidth: 1,
      borderColor: withAlpha(colors.champan, 0.45),
      paddingVertical: spacing.lg,
    },
    hechoTexto: { fontFamily: fonts.sansBold, ...typeScale.heading, color: colors.champan },
    secundario: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      minHeight: 44,
    },
    secundarioTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.champan },
  });
