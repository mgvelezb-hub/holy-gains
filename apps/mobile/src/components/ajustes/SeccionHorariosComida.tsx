import { ChevronRight, Clock } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { Hoja } from "@/components/Hoja";
import { Card } from "@/components/Card";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { Parrafo } from "@/components/Parrafo";
import { SectionLabel } from "@/components/SectionLabel";
import { useTheme } from "@/context/theme";
import {
  ApiError,
  getHorariosComidaCompleto,
  getHorariosComidaDia,
  putHorariosComida,
  putHorariosComidaDia,
  type TiempoDeComida,
} from "@/lib/api";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";

/** Los siete días, en el orden en que se listan y con su nombre corto. */
const DIAS_SEMANA: Array<{ codigo: string; nombre: string }> = [
  { codigo: "LUN", nombre: "Lun" },
  { codigo: "MAR", nombre: "Mar" },
  { codigo: "MIE", nombre: "Mié" },
  { codigo: "JUE", nombre: "Jue" },
  { codigo: "VIE", nombre: "Vie" },
  { codigo: "SAB", nombre: "Sáb" },
  { codigo: "DOM", nombre: "Dom" },
];

/**
 * "A qué hora comes" — mover los tiempos de comida del menú.
 *
 * EL PROBLEMA: el motor reparte los macros por tiempo de comida y le pone a
 * cada uno una hora sugerida, sacada de una jornada estándar. Quien entra a
 * trabajar a las 6, come a las 4 o entrena de noche veía horas que no iba a
 * cumplir — y un horario que no se cumple no es un plan: es un recordatorio a
 * deshoras que además hace ver el menú como ajeno.
 *
 * LOS CANDADOS los pone el servidor (`lib/coachy/horarios.ts`), no esta
 * pantalla: el orden de los tiempos, los 90 minutos mínimos entre uno y otro
 * y la ventana del día son reglas de cómo se digiere y se reparte la comida,
 * no de cómo se pinta un formulario. Aquí solo se enseña el motivo cuando el
 * servidor dice que no, con sus palabras.
 *
 * Se ajusta en pasos de 15 minutos con dos botones en vez de un teclado: es
 * un ajuste de minutos, y escribir "14:00" a mano en un teléfono es más
 * trabajo y más formas de equivocarse.
 */
export function SeccionHorariosComida() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [tiempos, setTiempos] = useState<TiempoDeComida[]>([]);
  const [horariosPorDia, setHorariosPorDia] = useState<Record<string, Record<string, string>>>({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  // Qué tiempo de comida tiene abierto el selector rápido. Los ±15 sirven
  // para el ajuste fino; mover una comida tres horas a punta de toques no.
  const [eligiendo, setEligiendo] = useState<TiempoDeComida | null>(null);

  const cargarGeneral = useCallback(() => {
    return getHorariosComidaCompleto().then((respuesta) => {
      setTiempos(respuesta.tiempos);
      setHorariosPorDia(respuesta.horariosPorDia ?? {});
    });
  }, []);

  useEffect(() => {
    let vivo = true;
    cargarGeneral()
      .catch(() => {
        // Sin menú publicado todavía no hay horarios que mover: la tarjeta lo
        // dice abajo en vez de pintar un error.
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [cargarGeneral]);

  const mover = useCallback(
    async (slot: string, minutos: number) => {
      if (guardando) return;
      const actual = tiempos.find((tiempo) => tiempo.slot === slot);
      if (!actual) return;

      const nueva = sumaMinutos(actual.hora, minutos);
      if (nueva === null) return;

      // Optimista: la hora se mueve en pantalla y si el servidor la rechaza
      // se restaura con lo que él diga. Esperar medio segundo por cada toque
      // de ±15 minutos haría el ajuste insoportable.
      const previos = tiempos;
      setTiempos((lista) =>
        lista.map((tiempo) => (tiempo.slot === slot ? { ...tiempo, hora: nueva, propia: true } : tiempo)),
      );
      setError(null);
      setGuardando(true);
      try {
        const respuesta = await putHorariosComida({ [slot]: nueva });
        setTiempos(respuesta.tiempos);
        setAvisos(respuesta.avisos ?? []);
      } catch (e) {
        setTiempos(previos);
        setError(e instanceof ApiError ? e.message : "No se pudo mover esa hora");
      } finally {
        setGuardando(false);
      }
    },
    [guardando, tiempos],
  );

  const poner = useCallback(
    async (slot: string, hora: string) => {
      if (guardando) return;
      setEligiendo(null);
      setError(null);
      setGuardando(true);
      try {
        const respuesta = await putHorariosComida({ [slot]: hora });
        setTiempos(respuesta.tiempos);
        setAvisos(respuesta.avisos ?? []);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "No se pudo poner esa hora");
      } finally {
        setGuardando(false);
      }
    },
    [guardando],
  );

  const restaurar = useCallback(
    async (slot: string) => {
      if (guardando) return;
      setError(null);
      setGuardando(true);
      try {
        const respuesta = await putHorariosComida({ [slot]: null });
        setTiempos(respuesta.tiempos);
        setAvisos(respuesta.avisos ?? []);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "No se pudo restaurar esa hora");
      } finally {
        setGuardando(false);
      }
    },
    [guardando],
  );

  // --- Horarios por día: mismo patrón que el general, pero acotado a un
  // solo día de la semana (`mealTimesByDay`). Nació del fin de semana: nadie
  // desayuna a la misma hora un sábado, y forzar el horario general ahí
  // vuelve el recordatorio ruido dos días de cada siete.
  const [diaAbierto, setDiaAbierto] = useState<string | null>(null);
  const [tiemposDia, setTiemposDia] = useState<TiempoDeComida[]>([]);
  const [cargandoDia, setCargandoDia] = useState(false);
  const [eligiendoDia, setEligiendoDia] = useState<TiempoDeComida | null>(null);

  const abrirDia = useCallback((codigo: string) => {
    setDiaAbierto(codigo);
    setCargandoDia(true);
    setError(null);
    getHorariosComidaDia(codigo)
      .then((respuesta) => setTiemposDia(respuesta.tiempos))
      .catch(() => setError("No se pudo cargar el horario de ese día"))
      .finally(() => setCargandoDia(false));
  }, []);

  const ponerDia = useCallback(
    async (slot: string, hora: string | null) => {
      if (!diaAbierto || guardando) return;
      setEligiendoDia(null);
      setError(null);
      setGuardando(true);
      try {
        const respuesta = await putHorariosComidaDia(diaAbierto, { [slot]: hora });
        setTiemposDia(respuesta.tiempos);
        setAvisos(respuesta.avisos ?? []);
        // El resumen de "N movidas" de la lista de días necesita el dato
        // fresco, no solo el detalle que se está editando.
        await cargarGeneral().catch(() => {});
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "No se pudo guardar ese horario");
      } finally {
        setGuardando(false);
      }
    },
    [diaAbierto, guardando, cargarGeneral],
  );

  return (
    <Card>
      <View style={styles.sectionHeader}>
        <SectionLabel>A qué hora comes</SectionLabel>
        <InfoTip titulo="A qué hora comes">
          <TextoInfo>
            Las horas que trae tu menú son una sugerencia armada sobre un día estándar. Si entras
            a trabajar temprano, comes tarde o entrenas de noche, muévelas: el recordatorio de
            cada comida sigue la hora que dejes aquí.
          </TextoInfo>
          <TextoInfo>
            Hay tres cosas que no te va a dejar hacer, y no es capricho: cambiar el orden de tus
            comidas, dejarlas a menos de hora y media una de otra —tan pegadas se vuelven una sola
            del doble de volumen— o programarlas de madrugada.
          </TextoInfo>
        </InfoTip>
      </View>

      {cargando ? (
        <ActivityIndicator size="small" color={colors.champan} style={{ marginTop: spacing.md }} />
      ) : tiempos.length === 0 ? (
        <Parrafo style={styles.vacio}>
          Cuando tengas tu menú publicado vas a poder mover sus horarios desde aquí.
        </Parrafo>
      ) : (
        <View style={styles.lista}>
          {tiempos.map((tiempo) => (
            <View key={tiempo.slot} style={styles.fila}>
              <View style={{ flex: 1 }}>
                <Text style={styles.nombre}>{tiempo.label}</Text>
                {tiempo.propia && (
                  <Pressable onPress={() => restaurar(tiempo.slot)} disabled={guardando}>
                    <Text style={styles.restaurar}>Volver a la hora sugerida</Text>
                  </Pressable>
                )}
              </View>

              <Pressable
                onPress={() => mover(tiempo.slot, -15)}
                disabled={guardando}
                style={styles.paso}
              >
                <Text style={styles.pasoTexto}>−15</Text>
              </Pressable>

              {/* La hora es un botón: toca el número y eliges directo, sin
                  ir de 15 en 15 desde las 7 de la mañana hasta las 3 de la
                  tarde. Los ±15 se quedan para el ajuste fino. */}
              <Pressable
                onPress={() => setEligiendo(tiempo)}
                disabled={guardando}
                style={styles.hora}
              >
                <Clock size={14} color={colors.champan} strokeWidth={2} />
                <Text style={styles.horaTexto}>{tiempo.hora}</Text>
              </Pressable>

              <Pressable
                onPress={() => mover(tiempo.slot, 15)}
                disabled={guardando}
                style={styles.paso}
              >
                <Text style={styles.pasoTexto}>+15</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <Hoja
        visible={eligiendo !== null}
        onClose={() => setEligiendo(null)}
        titulo={eligiendo?.label}
        contenidoStyle={styles.hojaLista}
      >
        <Parrafo style={styles.hojaNota}>
          Elige la hora. Si choca con otra comida te lo digo y no se guarda.
        </Parrafo>
        {HORAS.map((hora) => {
          const actual = eligiendo?.hora === hora;
          return (
            <Pressable
              key={hora}
              onPress={() => eligiendo && poner(eligiendo.slot, hora)}
              style={[styles.hojaOpcion, actual && styles.hojaOpcionOn]}
            >
              <Text style={[styles.hojaHora, actual && styles.hojaHoraOn]}>{hora}</Text>
            </Pressable>
          );
        })}
      </Hoja>

      {tiempos.length > 0 && (
        <View style={styles.porDia}>
          <Text style={styles.porDiaTitulo}>Por día de la semana</Text>
          {DIAS_SEMANA.map(({ codigo, nombre }) => {
            const movidas = Object.keys(horariosPorDia[codigo] ?? {}).length;
            return (
              <Pressable key={codigo} style={styles.diaFila} onPress={() => abrirDia(codigo)}>
                <Text style={styles.diaTexto}>
                  {nombre} · {movidas > 0 ? `${movidas} movida${movidas > 1 ? "s" : ""}` : "igual que siempre"}
                </Text>
                <ChevronRight size={16} color={colors.paloRosa} strokeWidth={2} />
              </Pressable>
            );
          })}
        </View>
      )}

      <Modal visible={diaAbierto !== null} animationType="slide" onRequestClose={() => setDiaAbierto(null)}>
        <View style={[styles.pantallaDia, { backgroundColor: colors.obsidiana }]}>
          <Pressable onPress={() => setDiaAbierto(null)} style={styles.diaCerrar}>
            <Text style={styles.restaurar}>Cerrar</Text>
          </Pressable>
          <Text style={styles.hojaTitulo}>
            {DIAS_SEMANA.find((dia) => dia.codigo === diaAbierto)?.nombre ?? ""}
          </Text>
          {cargandoDia ? (
            <ActivityIndicator size="small" color={colors.champan} style={{ marginTop: spacing.md }} />
          ) : (
            <View style={styles.lista}>
              {tiemposDia.map((tiempo) => (
                <View key={tiempo.slot} style={styles.fila}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.nombre}>{tiempo.label}</Text>
                    {tiempo.propia && (
                      <Pressable onPress={() => void ponerDia(tiempo.slot, null)} disabled={guardando}>
                        <Text style={styles.restaurar}>Volver a la hora de siempre</Text>
                      </Pressable>
                    )}
                  </View>
                  <Pressable onPress={() => setEligiendoDia(tiempo)} disabled={guardando} style={styles.hora}>
                    <Clock size={14} color={colors.champan} strokeWidth={2} />
                    <Text style={styles.horaTexto}>{tiempo.hora}</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>
      </Modal>

      <Hoja
        visible={eligiendoDia !== null}
        onClose={() => setEligiendoDia(null)}
        titulo={eligiendoDia?.label}
        contenidoStyle={styles.hojaLista}
      >
        {HORAS.map((hora) => {
          const actual = eligiendoDia?.hora === hora;
          return (
            <Pressable
              key={hora}
              onPress={() => eligiendoDia && void ponerDia(eligiendoDia.slot, hora)}
              style={[styles.hojaOpcion, actual && styles.hojaOpcionOn]}
            >
              <Text style={[styles.hojaHora, actual && styles.hojaHoraOn]}>{hora}</Text>
            </Pressable>
          );
        })}
      </Hoja>

      {error && <Text style={styles.error}>{error}</Text>}
      {avisos.map((aviso) => (
        <Parrafo key={aviso} style={styles.aviso}>
          {aviso}
        </Parrafo>
      ))}
    </Card>
  );
}

/**
 * Las horas que ofrece el selector: de 04:00 a 23:45, cada 15 minutos.
 *
 * Empieza a las 04:00 y termina a las 23:45 porque son los mismos límites que
 * el servidor impone (nada de madrugada): ofrecer horas que van a ser
 * rechazadas sería enseñar una puerta que no abre.
 */
const HORAS: string[] = (() => {
  const salida: string[] = [];
  for (let minutos = 4 * 60; minutos <= 23 * 60 + 45; minutos += 15) {
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    salida.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return salida;
})();

/** `"14:00"` más/menos minutos, sin salirse del día. `null` si no es una hora. */
function sumaMinutos(hora: string, minutos: number): string | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hora.trim());
  if (!match) return null;

  const total = Number(match[1]) * 60 + Number(match[2]) + minutos;
  if (total < 0 || total > 23 * 60 + 59) return null;

  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    lista: { gap: spacing.sm, marginTop: spacing.md },
    fila: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.sm,
    },
    nombre: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    restaurar: { fontFamily: fonts.sans, ...typeScale.label, color: colors.champan, marginTop: 2 },
    paso: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
    },
    pasoTexto: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    hora: { flexDirection: "row", alignItems: "center", gap: 4, minWidth: 68, justifyContent: "center" },
    horaTexto: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    vacio: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.pergaminoSoft, marginTop: spacing.md },
    hojaTitulo: { fontFamily: fonts.sansMedium, ...typeScale.subheading, color: colors.marfil },
    hojaNota: {
      fontFamily: fonts.sans,
      ...typeScale.label,
      // Sobre la hoja opaca (N2): pergaminoSoft no pasa AA en Claro/Champán.
      color: colors.paloRosaLight,
      marginBottom: spacing.sm,
    },
    hojaLista: { gap: 0 },
    hojaOpcion: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      marginBottom: 4,
    },
    hojaOpcionOn: { backgroundColor: colors.guinda },
    hojaHora: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.marfil },
    hojaHoraOn: { color: colors.pergamino },
    error: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.error, marginTop: spacing.sm },
    aviso: { fontFamily: fonts.sans, ...typeScale.label, color: colors.paloRosa, marginTop: spacing.sm },
    porDia: { marginTop: spacing.lg, gap: 4 },
    porDiaTitulo: {
      fontFamily: fonts.sansMedium,
      ...typeScale.label,
      color: colors.champan,
      marginBottom: 4,
    },
    diaFila: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: 44,
      paddingVertical: spacing.xs,
    },
    diaTexto: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    pantallaDia: { flex: 1, padding: spacing.lg, paddingTop: spacing.xl },
    diaCerrar: { alignSelf: "flex-start", paddingVertical: spacing.sm, marginBottom: spacing.sm },
  });
