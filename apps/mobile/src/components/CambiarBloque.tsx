import { CalendarOff, RefreshCw } from "lucide-react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { Parrafo } from "@/components/Parrafo";
import { useTheme } from "@/context/theme";
import { ApiError, postCambiarBloque, postCambiarBloqueDia, type Discipline } from "@/lib/api";
import { iconoDe } from "@/lib/disciplinas";
import { DISCIPLINAS } from "@/lib/entrenamiento";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * "Hoy no pude ir" — cambiar el bloque de hoy por otra cosa.
 *
 * EL CASO REAL: tocaba squash y la cancha estaba ocupada. Antes las salidas
 * eran no entrenar —y que el día contara como falla— o registrar una sesión
 * libre a mano, que deja sin rutina que seguir. Con esto el bloque cambia de
 * disciplina y, si se cambia a pesas, el servidor materializa la sesión de
 * gimnasio completa: split, ejercicios y pesos, igual que cualquier otra.
 *
 * Es una excepción de HOY, no un cambio de plan: mañana la semana vuelve a ser
 * la que se armó. El plan se cambia en Ajustes.
 */
export function CambiarBloque({
  fecha,
  actual,
  onCambiado,
}: {
  /** ISO `YYYY-MM-DD` del día del bloque. */
  fecha: string;
  actual: Discipline;
  onCambiado: () => void | Promise<void>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [abierto, setAbierto] = useState(false);
  // "cambiar": la lista de siempre, una disciplina reemplaza a `actual`.
  // "sinGym" (Fase 11): hoy no hay gimnasio, se eligen hasta dos disciplinas
  // sueltas — el caso de "hoy solo squash / natación". Reemplaza el
  // contenido de la MISMA hoja en vez de abrir una nueva: sigue siendo una
  // sola decisión ("¿por qué lo cambias?"), solo que esta rama pide más de
  // un toque.
  const [vista, setVista] = useState<"cambiar" | "sinGym">("cambiar");
  const [elegidas, setElegidas] = useState<Discipline[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opciones = DISCIPLINAS.filter((disciplina) => disciplina.valor !== actual);
  const opcionesSinGym = DISCIPLINAS.filter((disciplina) => disciplina.valor !== "PESAS");

  function cerrar() {
    setAbierto(false);
    setVista("cambiar");
    setElegidas([]);
    setError(null);
  }

  async function cambiar(discipline: Discipline) {
    if (guardando) return;
    setError(null);
    setGuardando(true);
    try {
      await postCambiarBloque(fecha, discipline);
      cerrar();
      await onCambiado();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cambiar tu bloque");
    } finally {
      setGuardando(false);
    }
  }

  function alternarElegida(discipline: Discipline) {
    setElegidas((previas) =>
      previas.includes(discipline)
        ? previas.filter((valor) => valor !== discipline)
        // Un día jamás lleva más de dos bloques: la tercera elección
        // reemplaza la primera, no se acumula.
        : [...previas, discipline].slice(-2),
    );
  }

  async function guardarSinGym() {
    if (guardando || elegidas.length === 0) return;
    setError(null);
    setGuardando(true);
    try {
      await postCambiarBloqueDia(fecha, elegidas);
      cerrar();
      await onCambiado();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo guardar tu día");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <Pressable onPress={() => setAbierto(true)} hitSlop={8} style={styles.enlace}>
        <RefreshCw size={14} color={colors.champan} strokeWidth={2} />
        <Text style={styles.enlaceTexto}>No pude ir · cambiar por otra cosa</Text>
      </Pressable>

      <Modal visible={abierto} transparent animationType="fade" onRequestClose={cerrar}>
        <Pressable style={styles.fondo} onPress={cerrar}>
          <Pressable style={styles.hoja} onPress={() => {}}>
            {vista === "cambiar" ? (
              <>
                <Text style={styles.titulo}>¿Por qué lo cambias?</Text>
                <Parrafo style={styles.nota}>
                  Solo cambia hoy. Mañana tu semana sigue como la armaste. Si eliges pesas, te armo
                  la sesión completa con tus pesos.
                </Parrafo>

                <View style={styles.lista}>
                  {opciones.map((opcion) => {
                    const Icono = iconoDe(opcion.valor);
                    return (
                      <Pressable
                        key={opcion.valor}
                        onPress={() => cambiar(opcion.valor)}
                        disabled={guardando}
                        style={styles.opcion}
                      >
                        <Icono size={18} color={colors.marfil} strokeWidth={2} />
                        <Text style={styles.opcionTexto}>{opcion.nombre}</Text>
                        {guardando && <ActivityIndicator size="small" color={colors.champan} />}
                      </Pressable>
                    );
                  })}

                  <Pressable
                    onPress={() => setVista("sinGym")}
                    disabled={guardando}
                    style={styles.opcion}
                  >
                    <CalendarOff size={18} color={colors.marfil} strokeWidth={2} />
                    <Text style={styles.opcionTexto}>Hoy solo squash / natación (sin gym)</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.titulo}>Hoy sin gimnasio</Text>
                <Parrafo style={styles.nota}>
                  Elige una o dos: es todo lo de hoy, ya no hay sesión de pesas.
                </Parrafo>

                <View style={styles.chips}>
                  {opcionesSinGym.map((opcion) => {
                    const Icono = iconoDe(opcion.valor);
                    const activa = elegidas.includes(opcion.valor);
                    return (
                      <Pressable
                        key={opcion.valor}
                        onPress={() => alternarElegida(opcion.valor)}
                        disabled={guardando}
                        style={[styles.chip, activa && styles.chipOn]}
                      >
                        <Icono size={16} color={activa ? colors.pergamino : colors.marfil} strokeWidth={2} />
                        <Text style={[styles.chipTexto, activa && styles.chipTextoOn]}>
                          {opcion.nombre}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Pressable
                  onPress={guardarSinGym}
                  disabled={guardando || elegidas.length === 0}
                  style={[styles.guardar, elegidas.length === 0 && styles.guardarDeshabilitado]}
                >
                  {guardando ? (
                    <ActivityIndicator size="small" color={colors.pergamino} />
                  ) : (
                    <Text style={styles.guardarTexto}>Guardar</Text>
                  )}
                </Pressable>
              </>
            )}

            {error && <Text style={styles.error}>{error}</Text>}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    enlace: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minHeight: 44,
    },
    enlaceTexto: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.champan },
    fondo: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" },
    hoja: {
      backgroundColor: colors.cardBg,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    titulo: { fontFamily: fonts.sansMedium, ...typeScale.subheading, color: colors.marfil },
    nota: { fontFamily: fonts.sans, ...typeScale.label, color: colors.pergaminoSoft },
    lista: { gap: spacing.sm, marginTop: spacing.sm },
    opcion: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      minHeight: 48,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    opcionTexto: { flex: 1, fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    chipOn: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
    chipTexto: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    chipTextoOn: { color: colors.pergamino },
    guardar: {
      marginTop: spacing.md,
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.md,
      backgroundColor: colors.guinda,
    },
    guardarDeshabilitado: { opacity: 0.5 },
    guardarTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.pergamino },
    error: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.error },
  });
