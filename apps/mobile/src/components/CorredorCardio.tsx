import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { Check, HeartPulse, Pause, Play, SkipForward, Square, Timer } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/context/theme";
import { getMe, patchEntrenamiento, postActivities, type DetalleCardio } from "@/lib/api";
import { programaDe, type MaquinaConBase, type NivelBase } from "@/lib/api-cardio";
import {
  activoMsCorredor,
  actividadDeCardio,
  alcanzarCorredor,
  finDelCorredor,
  iniciarCorredor,
  irAPasoCorredor,
  pasosDeCardio,
  pausarCorredor,
  reanudarCorredor,
  restanteDelPasoSeg,
  saltarPasoCorredor,
  terminarCorredor,
  tituloTarjetaCardio,
  type CorredorCardio as EstadoCorredor,
} from "@/lib/cardio";
import { guardaCardioEnCurso, leeCardioEnCurso, marcaCardioHecho, olvidaCardioEnCurso } from "@/lib/cardio-en-curso";
import { colorDeEsfuerzo, debeAvisarCambio, protocoloDe, textoParaReloj, tramosDeSesion, unidadDe, type EsfuerzoDeFila } from "@/lib/hiit";
import {
  conNivelBase,
  controlDelTramo,
  esfuerzoDeTramo,
  indiceTrasCalibracion,
  nombreDeEsfuerzo,
  pasosDePrograma,
  programaConMarcado,
  textoLpm,
  textoNivelBase,
  textoParaRelojPrograma,
  valorDeCalibracion,
} from "@/lib/programa-cardio";
import { enviarFinAlReloj, enviarSesionAlReloj, estadoDelReloj } from "@/lib/reloj-nativo";
import { formatoReloj } from "@/lib/sesion-viva";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";

/** Cada cuánto se repinta la cuenta regresiva. */
const TICK_MS = 1000;

export type ResultadoCardio = { registrado: boolean; minutos: number; mensaje: string };

/**
 * El corredor del cardio (N2) — el MISMO en la sesión de pesas y en el cardio
 * suelto (`/cardio-en-vivo`), para que la lógica no se duplique.
 *
 * P1: con `programa`, cualquier máquina: lo que se pone en ella en grande
 * ("Resist. 10 · 140 SPM", "2:15/500 · 26 SPM"), el esfuerzo con su color,
 * el siguiente, la zona de pulso si hay reloj y, en la calibración, el botón
 * "Aquí voy moderado" que guarda ese paso como nivel base y sigue con la
 * modalidad elegida, ya recalculada con ese valor.
 *
 * Tramo por tramo con su velocidad grande y el color de su esfuerzo, la
 * cuenta regresiva contra la HORA de término (iOS congela los timers en el
 * fondo), háptica al cambiar de tramo y aviso 5 s antes de cada cambio de
 * velocidad, el tramo al reloj por el canal de sesión, pantalla encendida,
 * pausa/reanudar y "Terminar aquí" (registra lo corrido). El cursor se
 * guarda en el teléfono: salir y volver no lo reinicia.
 *
 * Arranca (o retoma) al montarse. Al terminar registra la sesión de CARDIO
 * del día con su duración real y avisa con `onTerminado`.
 */
export function CorredorCardio({
  detalle,
  minutos,
  fecha,
  onTerminado,
  soltarReloj = false,
}: {
  detalle: DetalleCardio;
  minutos: number;
  fecha: string;
  onTerminado: (resultado: ResultadoCardio) => void;
  /** Al terminar, el reloj deja de mostrar la sesión (el cardio suelto). */
  soltarReloj?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  useKeepAwake();

  const unidad = unidadDe(detalle);
  const programa = programaDe(detalle);
  const protocolo = programa ? null : protocoloDe(detalle);
  const pasos = useMemo(() => pasosDeCardio(detalle, minutos, unidad), [detalle, minutos, unidad]);
  /** El esfuerzo de cada paso, si el cardio va tramo por tramo (programa P1 o protocolo N1). */
  const esfuerzos = useMemo<EsfuerzoDeFila[] | null>(
    () =>
      programa
        ? programa.tramos.map(esfuerzoDeTramo)
        : protocolo
          ? tramosDeSesion(protocolo).map((tramo) => tramo.esfuerzo)
          : null,
    [programa, protocolo],
  );
  const tramos = esfuerzos;

  // Calibración: el nivel base que marcó. Solo cambia los NOMBRES (no las
  // duraciones): los pasos del timer siguen siendo los mismos. Q1: lo que
  // sigue a la calibración se recalcula con ese valor (`tramosSiMarcas`).
  const [marcado, setMarcado] = useState<{ maquina: MaquinaConBase; valor: NivelBase } | null>(null);
  const [avisoBase, setAvisoBase] = useState<string | null>(null);
  const vigente = useMemo(
    () => (programa && marcado ? programaConMarcado(programa, marcado.valor) : programa),
    [programa, marcado],
  );
  const nombres = useMemo(
    () => (vigente && marcado ? pasosDePrograma(vigente, unidad, marcado) : pasos),
    [vigente, marcado, pasos, unidad],
  );

  const [estado, setEstado] = useState<EstadoCorredor | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const [guardando, setGuardando] = useState(false);
  const registrado = useRef(false);

  const [reloj, setReloj] = useState(() => estadoDelReloj());
  const conReloj = reloj.soportado && reloj.emparejado && reloj.appInstalada;

  // Arranca o retoma lo guardado (poniéndolo al día con el reloj de pared).
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const guardado = await leeCardioEnCurso(fecha, pasos.length);
      if (!vivo) return;
      const ya = Date.now();
      setEstado(guardado ? alcanzarCorredor(guardado, pasos, ya) : iniciarCorredor(fecha, pasos, ya));
      setAhora(ya);
    })();
    return () => {
      vivo = false;
    };
  }, [fecha, pasos]);

  const corriendo = estado !== null && !estado.terminado && estado.hasta !== null;

  // El tick solo empuja la hora; nunca resta segundos.
  useEffect(() => {
    if (!corriendo) return;
    const intervalo = setInterval(() => setAhora(Date.now()), TICK_MS);
    return () => clearInterval(intervalo);
  }, [corriendo]);

  // Al volver de otra app, la hora (y el reloj) se ponen al día de inmediato.
  useEffect(() => {
    const suscripcion = AppState.addEventListener("change", (siguiente) => {
      if (siguiente !== "active") return;
      setAhora(Date.now());
      setReloj(estadoDelReloj());
    });
    const tarde = setTimeout(() => setReloj(estadoDelReloj()), 2000);
    return () => {
      suscripcion.remove();
      clearTimeout(tarde);
    };
  }, []);

  // Cuando el tramo se agota, avanza (una háptica marca el cambio) o termina.
  useEffect(() => {
    if (!estado || !corriendo) return;
    const alDia = alcanzarCorredor(estado, pasos, ahora);
    if (alDia === estado) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setEstado(alDia);
  }, [ahora, estado, corriendo, pasos]);

  // N1: 5 s antes de cada cambio de velocidad, una háptica de aviso (una vez por tramo).
  useEffect(() => {
    if (!estado || !corriendo || !tramos) return;
    const avisar = debeAvisarCambio({
      restanteSeg: restanteDelPasoSeg(estado, ahora),
      avisadoEn: estado.avisadoEn,
      paso: estado.paso,
      hayCambio: estado.paso < tramos.length - 1,
    });
    if (!avisar) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const paso = estado.paso;
    setEstado((vigente) => (vigente && vigente.paso === paso ? { ...vigente, avisadoEn: paso } : vigente));
  }, [ahora, estado, corriendo, tramos]);

  // Al reloj: el tramo actual en corto, al empezar cada tramo y al avisar.
  useEffect(() => {
    if (!conReloj || !estado || estado.terminado) return;
    const restanteSeg = restanteDelPasoSeg(estado, Date.now());
    if (vigente) {
      enviarSesionAlReloj(textoParaRelojPrograma({ programa: vigente, paso: estado.paso, restanteSeg, unidad }));
    } else if (protocolo) {
      enviarSesionAlReloj(textoParaReloj({ protocolo, paso: estado.paso, restanteSeg, unidad }));
    }
  }, [conReloj, vigente, protocolo, unidad, estado?.paso, estado?.avisadoEn, estado?.terminado]);

  // El cursor se guarda en cada movimiento (paso, pausa); al terminar se olvida.
  useEffect(() => {
    if (!estado) return;
    if (estado.terminado) {
      void olvidaCardioEnCurso();
      void registrar(estado);
      return;
    }
    void guardaCardioEnCurso(estado);
  }, [estado?.paso, estado?.hasta, estado?.restantePausaMs, estado?.avisadoEn, estado?.terminado]);

  /** Registra lo corrido como la sesión de CARDIO del día, una sola vez. */
  async function registrar(final: EstadoCorredor) {
    if (registrado.current) return;
    registrado.current = true;
    setGuardando(true);
    const fin = finDelCorredor(final, Date.now());
    const activoMs = activoMsCorredor(final, fin);
    const actividad = actividadDeCardio(detalle, fecha, new Date(final.inicio), new Date(fin), activoMs);
    if (soltarReloj) enviarFinAlReloj();
    try {
      await postActivities([actividad]);
      await marcaCardioHecho(fecha, actividad.durationMin);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onTerminado({ registrado: true, minutos: actividad.durationMin, mensaje: `Cardio registrado · ${actividad.durationMin} min.` });
    } catch {
      onTerminado({
        registrado: false,
        minutos: actividad.durationMin,
        mensaje: "No se pudo subir el cardio. Regístralo a mano cuando tengas señal.",
      });
    } finally {
      setGuardando(false);
    }
  }

  function alternarPausa() {
    if (!estado) return;
    void Haptics.selectionAsync();
    const ya = Date.now();
    setAhora(ya);
    setEstado(estado.hasta === null ? reanudarCorredor(estado, ya) : pausarCorredor(estado, ya));
  }

  function saltarTramo() {
    if (!estado) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const ya = Date.now();
    setAhora(ya);
    setEstado(saltarPasoCorredor(estado, pasos, ya));
  }

  /**
   * "Aquí voy moderado": el paso de calibración en curso es su nivel base en
   * esta máquina. Se guarda en las preferencias (relee el perfil antes: el
   * PATCH manda la lista completa) y el corredor sigue con la modalidad,
   * recalculada con ese valor.
   */
  function aquiVoyModerado() {
    if (!estado || !programa?.calibracion) return;
    const valor = valorDeCalibracion(programa, estado.paso);
    const destino = indiceTrasCalibracion(programa);
    if (valor === null || destino === null) return;
    const maquina = programa.calibracion.maquina;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setMarcado({ maquina, valor });
    const ya = Date.now();
    setAhora(ya);
    setEstado(irAPasoCorredor(estado, pasos, destino, ya));
    void (async () => {
      try {
        const me = await getMe();
        const otras = me.profile?.otherDisciplines ?? [];
        if (!otras.some((carga) => carga.discipline === "CARDIO")) return;
        await patchEntrenamiento({ otherDisciplines: conNivelBase(otras, maquina, valor) });
        setAvisoBase(`Nivel base guardado: ${textoNivelBase(maquina, valor)}`);
      } catch {
        setAvisoBase(`Anótalo: ${textoNivelBase(maquina, valor)}. No se pudo guardar sin señal.`);
      }
    })();
  }

  /** "Terminar aquí": registra lo corrido hasta ahora. */
  function terminarAqui() {
    if (!estado || estado.terminado) return;
    setEstado(terminarCorredor(estado, Date.now()));
  }

  if (!estado) {
    return (
      <View style={styles.contenido}>
        <Text style={styles.paso}>CARDIO</Text>
        <Text style={styles.nombre}>{tituloTarjetaCardio(detalle, minutos)}</Text>
      </View>
    );
  }

  const actual = nombres[estado.paso];
  const siguiente = nombres[estado.paso + 1];
  const restante = restanteDelPasoSeg(estado, ahora);
  const enPausa = estado.hasta === null && !estado.terminado;
  const colorTramo = tramos ? colorDeEsfuerzo(tramos[estado.paso] ?? "Fácil", colors) : colors.champan;
  const tramoPrograma = vigente?.tramos[estado.paso];
  // Grande, lo que se pone en la máquina; debajo, el esfuerzo con su color.
  const controlGrande = tramoPrograma && !estado.terminado ? controlDelTramo(tramoPrograma, unidad, marcado) : null;
  const pulso = conReloj && tramoPrograma && !estado.terminado ? textoLpm(tramoPrograma.fcLpm) : null;
  const calibrando = tramoPrograma?.fase === "calibracion" && !estado.terminado;
  const avisando = tramos !== null && estado.avisadoEn === estado.paso && siguiente !== undefined;

  return (
    <ScrollView contentContainerStyle={styles.contenido}>
      <Text style={styles.paso}>CARDIO</Text>
      <Text style={styles.nombre}>{tituloTarjetaCardio(detalle, minutos)}</Text>

      <View style={styles.caja}>
        <Timer size={20} color={colors.champan} strokeWidth={2} />
        {controlGrande ? (
          <>
            <Text style={styles.control} accessibilityRole="header">
              {controlGrande}
            </Text>
            <Text style={[styles.esfuerzo, { color: colorTramo }]}>
              {tramoPrograma ? nombreDeEsfuerzo(tramoPrograma) : ""}
            </Text>
          </>
        ) : (
          <Text style={[styles.tramo, { color: colorTramo }]} accessibilityRole="header">
            {estado.terminado ? "Listo" : (actual?.nombre ?? "")}
          </Text>
        )}
        {pulso && (
          <View style={styles.pulso}>
            <HeartPulse size={16} color={colors.paloRosa} strokeWidth={2} />
            <Text style={styles.pulsoTexto}>{pulso}</Text>
          </View>
        )}
        <Text style={styles.cuenta}>{formatoReloj(restante)}</Text>
        {estado.terminado ? (
          <Text style={styles.texto}>{guardando ? "Guardando…" : "Cardio terminado"}</Text>
        ) : enPausa ? (
          <Text style={styles.aviso}>En pausa</Text>
        ) : avisando ? (
          <Text style={styles.aviso} accessibilityLiveRegion="assertive">
            Cambia a {siguiente!.nombre}
          </Text>
        ) : siguiente ? (
          <Text style={styles.texto}>Luego: {siguiente.nombre}</Text>
        ) : (
          <Text style={styles.texto}>{tramos ? "Último tramo" : "Último paso"}</Text>
        )}
        <Text style={styles.progreso}>
          {tramos ? "Tramo" : "Paso"} {Math.min(estado.paso + 1, pasos.length)} de {pasos.length}
        </Text>

        {calibrando && (
          <Pressable onPress={aquiVoyModerado} style={styles.moderado} accessibilityRole="button">
            <Check size={20} color={colors.pergamino} strokeWidth={2.5} />
            <Text style={styles.moderadoTexto}>Aquí voy moderado</Text>
          </Pressable>
        )}
        {avisoBase && <Text style={styles.texto}>{avisoBase}</Text>}

        {!estado.terminado && (
          <View style={styles.botones}>
            <Pressable
              onPress={alternarPausa}
              style={styles.boton}
              accessibilityRole="button"
              accessibilityLabel={enPausa ? "Reanudar" : "Pausa"}
            >
              {enPausa ? (
                <Play size={16} color={colors.marfil} strokeWidth={2} />
              ) : (
                <Pause size={16} color={colors.marfil} strokeWidth={2} />
              )}
              <Text style={styles.botonTexto}>{enPausa ? "Reanudar" : "Pausa"}</Text>
            </Pressable>
            <Pressable onPress={saltarTramo} style={styles.boton} accessibilityRole="button">
              <SkipForward size={16} color={colors.marfil} strokeWidth={2} />
              <Text style={styles.botonTexto}>Saltar</Text>
            </Pressable>
          </View>
        )}
      </View>

      {!estado.terminado && (
        <Pressable onPress={terminarAqui} style={styles.terminar} accessibilityRole="button" hitSlop={8}>
          <Square size={14} color={colors.champan} strokeWidth={2.5} />
          <Text style={styles.terminarTexto}>Terminar aquí · registra lo que llevas</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    contenido: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.huge },
    paso: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.label,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: colors.paloRosa,
    },
    nombre: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    caja: {
      alignItems: "center",
      gap: spacing.xs,
      borderRadius: radius.xxl,
      borderWidth: 1,
      borderColor: withAlpha(colors.champan, 0.35),
      backgroundColor: withAlpha(colors.champan, 0.1),
      paddingVertical: spacing.xl,
      paddingHorizontal: spacing.lg,
    },
    tramo: { fontFamily: fonts.sansBold, ...typeScale.title, textAlign: "center" },
    control: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil, textAlign: "center" },
    esfuerzo: { fontFamily: fonts.sansSemiBold, ...typeScale.heading, textAlign: "center" },
    pulso: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    pulsoTexto: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
    moderado: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      minHeight: 48,
      marginTop: spacing.md,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.guindaLight,
      backgroundColor: colors.guinda,
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.sm,
    },
    moderadoTexto: { fontFamily: fonts.sansBold, ...typeScale.body, color: colors.pergamino },
    cuenta: { fontFamily: fonts.sansBold, ...typeScale.hero, color: colors.champan },
    texto: { fontFamily: fonts.sans, ...typeScale.body, color: colors.paloRosa, textAlign: "center" },
    aviso: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.champan, textAlign: "center" },
    progreso: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.paloRosa },
    botones: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
    boton: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      minHeight: 44,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    botonTexto: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.marfil },
    terminar: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs, minHeight: 44 },
    terminarTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.champan },
  });
