import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Check, ChevronLeft, HeartPulse, Pause, Play } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Parrafo } from "@/components/Parrafo";
import { ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import {
  ApiError,
  DISCIPLINE_LABELS,
  postManualActivity,
  type Discipline,
  type OtherSessionView,
  type WeekView,
} from "@/lib/api";
import { iconoDe } from "@/lib/disciplinas";
import { pulsoEntre, type PulsoDeTramo } from "@/lib/health";
import {
  cerrarTramo,
  cronometro,
  estadoInicialLibre,
  iniciar,
  intervaloDe,
  minutosDe,
  pausar,
  reanudar,
  transcurridoMs,
  type EstadoLibre,
  type TramoHecho,
  type TramoPlan,
} from "@/lib/sesion-libre";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";
import { getCachedWeek } from "@/lib/training-db";

/**
 * Sesión en vivo de una disciplina que no es pesas.
 *
 * El gimnasio se cuenta en series; nadar, boxear o jugar squash se cuentan en
 * tramos y minutos, y eso es lo que esta pantalla mide: un cronómetro que
 * corre, los bloques del plan uno por uno, y al cerrar cada uno la pregunta al
 * reloj de qué pulso hubo en ese tramo.
 *
 * **La frecuencia cardiaca es post-hoc, no en vivo.** El reloj escribe en
 * Salud y la app lee de ahí; empujar latidos a la pantalla en tiempo real
 * necesita una app en la muñeca, que Expo no compila. En la práctica, con un
 * entrenamiento abierto en el reloj las muestras llegan en segundos y la
 * lectura al cerrar un tramo ya trae datos — por eso la pantalla lo pide al
 * empezar, en vez de fingir que no hace falta.
 *
 * Al terminar, la sesión se registra como actividad con su **duración real**,
 * no con la planeada: es el único dato honesto cuando el plan decía 45 minutos
 * y la alberca estaba llena.
 */

/** Cada cuánto se repinta el cronómetro. */
const TICK_MS = 1000;

function mondayISO(): string {
  const ahora = new Date();
  const dia = ahora.getDay() || 7;
  ahora.setDate(ahora.getDate() - (dia - 1));
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  return `${ahora.getFullYear()}-${mes}-${String(ahora.getDate()).padStart(2, "0")}`;
}

function hoyISO(): string {
  const ahora = new Date();
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  return `${ahora.getFullYear()}-${mes}-${String(ahora.getDate()).padStart(2, "0")}`;
}

export default function SesionLibreScreen() {
  // `discipline` es opcional: sin él (por ejemplo un enlace viejo) se toma la
  // primera sesión de la fecha, igual que antes. Con dos sesiones el mismo
  // día (Fase 7) es lo único que distingue cuál de las dos se quiere abrir.
  const { fecha, discipline } = useLocalSearchParams<{ fecha: string; discipline?: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  useKeepAwake();

  const [sesion, setSesion] = useState<OtherSessionView | null>(null);
  const [estado, setEstado] = useState<EstadoLibre | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const [pulsos, setPulsos] = useState<Record<number, PulsoDeTramo>>({});
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const semana: WeekView | null = await getCachedWeek(mondayISO());
      const dia = fecha ?? hoyISO();
      const candidatas = semana?.otherSessions?.filter((entrada) => entrada.date === dia) ?? [];
      const encontrada = discipline
        ? (candidatas.find((entrada) => entrada.discipline === discipline) ?? candidatas[0] ?? null)
        : (candidatas[0] ?? null);

      if (!encontrada) {
        setError("Esa sesión no está en el teléfono. Abre Rutinas una vez con señal.");
        return;
      }

      // Con plan, los tramos son sus bloques; sin plan, la sesión es un solo
      // tramo: la app no inventa una estructura que no validó.
      const tramos: TramoPlan[] = encontrada.sesion
        ? encontrada.sesion.blocks.map((bloque) => ({
            titulo: bloque.title,
            detalle: bloque.detail,
          }))
        : [{ titulo: DISCIPLINE_LABELS[encontrada.discipline], detalle: "Tu sesión completa" }];

      setSesion(encontrada);
      setEstado(estadoInicialLibre(tramos));
    } catch {
      setError("No se pudo abrir tu sesión.");
    }
  }, [fecha, discipline]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // El cronómetro solo repinta mientras corre: en pausa no hay nada que mover.
  useEffect(() => {
    if (!estado || estado.corriendoDesdeMs === null) return;
    const intervalo = setInterval(() => setAhora(Date.now()), TICK_MS);
    return () => clearInterval(intervalo);
  }, [estado?.corriendoDesdeMs]);

  function arrancar() {
    if (!estado) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setEstado(iniciar(estado, Date.now()));
    setAhora(Date.now());
  }

  function alternarPausa() {
    if (!estado) return;
    const ahoraMs = Date.now();
    setEstado(estado.corriendoDesdeMs === null ? reanudar(estado, ahoraMs) : pausar(estado, ahoraMs));
    setAhora(ahoraMs);
  }

  function cerrarTramoActual() {
    if (!estado) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const { estado: siguiente, termino } = cerrarTramo(estado, Date.now());
    setEstado(siguiente);
    if (termino) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // El pulso del tramo se pide en cuanto se cierra: si el reloj ya escribió
    // las muestras, la retro aparece sola; si no, se queda sin dato y la
    // pantalla lo dice en vez de inventar un promedio.
    const cerrado = siguiente.hechos[siguiente.hechos.length - 1];
    const indice = siguiente.hechos.length - 1;
    if (!cerrado) return;

    const intervalo = intervaloDe(siguiente, cerrado);
    if (!intervalo) return;

    void pulsoEntre(intervalo.desde, intervalo.hasta).then((pulso) => {
      setPulsos((previos) => ({ ...previos, [indice]: pulso }));
    });
  }

  async function terminar() {
    if (!estado || !sesion || guardando) return;
    setGuardando(true);
    try {
      const minutos = minutosDe(transcurridoMs(estado, Date.now()));
      await postManualActivity({
        discipline: sesion.discipline as Discipline,
        durationMin: minutos,
        date: sesion.date,
        notes: sesion.sesion ? `${sesion.sesion.focus} · ${sesion.sesion.cargaTotal} ${sesion.sesion.unidad}` : null,
      });
      router.replace("/rutinas");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar tu sesión");
    } finally {
      setGuardando(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void cargar()} />;
  if (!estado || !sesion) return <LoadingState label="Preparando tu sesión..." />;

  const Icono = iconoDe(sesion.discipline);
  const nombre = DISCIPLINE_LABELS[sesion.discipline];
  const corriendo = estado.corriendoDesdeMs !== null;
  const arrancada = estado.inicioMs !== null;
  const tramoActual = estado.pendientes[0] ?? null;

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.barra}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.salir}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.salirTexto}>Salir</Text>
        </Pressable>
        <View style={styles.tituloBarra}>
          <Icono size={18} color={colors.champan} strokeWidth={2} />
          <Text style={styles.tituloTexto}>{nombre}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.contenido}>
        <View style={styles.relojCaja}>
          <Text style={styles.reloj}>{cronometro(transcurridoMs(estado, ahora))}</Text>
          <Text style={styles.relojNota}>
            {!arrancada
              ? "El tiempo empieza cuando tú digas"
              : corriendo
                ? `Tramo ${estado.hechos.length + 1} de ${estado.hechos.length + estado.pendientes.length}`
                : "En pausa: esto no cuenta como entrenamiento"}
          </Text>
        </View>

        {!arrancada ? (
          <>
            <Pressable onPress={arrancar} style={styles.botonPrincipal}>
              <Play size={24} color={colors.pergamino} strokeWidth={2.5} />
              <Text style={styles.botonPrincipalTexto}>Empezar</Text>
            </Pressable>

            <Parrafo style={styles.aviso}>
              Si traes reloj, abre también el entrenamiento ahí. La app no lee latidos en vivo —eso
              necesita una app en la muñeca—, pero con el entrenamiento abierto tu reloj escribe el
              pulso en Salud y aquí aparece al cerrar cada tramo.
            </Parrafo>
          </>
        ) : estado.terminada ? (
          <>
            <Text style={styles.tituloFin}>Sesión completa</Text>
            <Parrafo style={styles.subtituloFin}>
              {minutosDe(transcurridoMs(estado, ahora))} min de {nombre.toLowerCase()}. Se registra
              con la duración real, no con la planeada.
            </Parrafo>

            <Pressable onPress={terminar} disabled={guardando} style={styles.botonPrincipal}>
              <Check size={22} color={colors.pergamino} strokeWidth={2.5} />
              <Text style={styles.botonPrincipalTexto}>
                {guardando ? "Guardando..." : "Guardar sesión"}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            {tramoActual && (
              <View style={styles.tramoCaja}>
                <Text style={styles.tramoTitulo}>{tramoActual.titulo}</Text>
                {tramoActual.detalle ? (
                  <Text style={styles.tramoDetalle}>{tramoActual.detalle}</Text>
                ) : null}
              </View>
            )}

            <Pressable onPress={cerrarTramoActual} style={styles.botonPrincipal}>
              <Check size={24} color={colors.pergamino} strokeWidth={2.5} />
              <Text style={styles.botonPrincipalTexto}>Tramo hecho</Text>
            </Pressable>

            <Pressable onPress={alternarPausa} style={styles.botonSecundario}>
              {corriendo ? (
                <Pause size={18} color={colors.marfil} strokeWidth={2} />
              ) : (
                <Play size={18} color={colors.marfil} strokeWidth={2} />
              )}
              <Text style={styles.botonSecundarioTexto}>{corriendo ? "Pausa" : "Reanudar"}</Text>
            </Pressable>
          </>
        )}

        {estado.hechos.length > 0 && (
          <View style={styles.lista}>
            <Text style={styles.listaTitulo}>Lo que llevas</Text>
            {estado.hechos.map((tramo, indice) => (
              <TramoCerrado key={`${tramo.titulo}-${indice}`} tramo={tramo} pulso={pulsos[indice]} />
            ))}
          </View>
        )}

        {sesion.sesion?.notes.map((nota) => (
          <Parrafo key={nota} style={styles.aviso}>
            {nota}
          </Parrafo>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Un tramo ya cerrado, con lo que el reloj alcanzó a registrar. */
function TramoCerrado({ tramo, pulso }: { tramo: TramoHecho; pulso?: PulsoDeTramo }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const duracion = cronometro(tramo.hastaMs - tramo.desdeMs);

  return (
    <View style={styles.tramoFila}>
      <View style={{ flex: 1 }}>
        <Text style={styles.tramoFilaTitulo}>{tramo.titulo}</Text>
        <Text style={styles.tramoFilaDetalle}>
          {duracion}
          {tramo.detalle ? ` · ${tramo.detalle}` : ""}
        </Text>
      </View>

      {pulso === undefined ? null : pulso.promedio === null ? (
        <Text style={styles.pulsoVacio}>sin pulso</Text>
      ) : (
        <View style={styles.pulso}>
          <HeartPulse size={15} color={colors.error} strokeWidth={2} />
          <Text style={styles.pulsoTexto}>
            {pulso.promedio}
            {pulso.maximo !== null && pulso.maximo !== pulso.promedio ? ` · máx ${pulso.maximo}` : ""}
          </Text>
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.obsidiana },
    barra: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    salir: { flexDirection: "row", alignItems: "center", gap: 2 },
    salirTexto: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
    tituloBarra: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    tituloTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.marfil },
    contenido: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.huge },
    relojCaja: { alignItems: "center", gap: spacing.xs, paddingVertical: spacing.lg },
    reloj: {
      fontFamily: fonts.sansBold,
      ...typeScale.hero,
      color: colors.champan,
      fontVariant: ["tabular-nums"],
    },
    relojNota: { fontFamily: fonts.sans, ...typeScale.body, color: colors.paloRosa },
    tramoCaja: {
      borderRadius: radius.xxl,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
      padding: spacing.lg,
      gap: 4,
    },
    tramoTitulo: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    tramoDetalle: { fontFamily: fonts.sans, ...typeScale.body, color: colors.paloRosa },
    botonPrincipal: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: colors.guinda,
      borderWidth: 1,
      borderColor: colors.guindaLight,
      borderRadius: radius.xxl,
      paddingVertical: spacing.xl,
    },
    botonPrincipalTexto: { fontFamily: fonts.sansBold, ...typeScale.heading, color: colors.pergamino },
    botonSecundario: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingVertical: spacing.md,
    },
    botonSecundarioTexto: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.marfil },
    lista: { gap: spacing.sm },
    listaTitulo: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.label,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: colors.paloRosa,
    },
    tramoFila: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.xl,
      backgroundColor: withAlpha(colors.paloRosa, 0.08),
    },
    tramoFilaTitulo: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.marfil },
    tramoFilaDetalle: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
    pulso: { flexDirection: "row", alignItems: "center", gap: 4 },
    pulsoTexto: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.bodySm,
      color: colors.marfil,
      fontVariant: ["tabular-nums"],
    },
    pulsoVacio: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosaLight },
    aviso: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
    tituloFin: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    subtituloFin: { fontFamily: fonts.sans, ...typeScale.body, color: colors.paloRosa },
  });
