import { Sun, Sunrise, Sunset, Moon } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { Parrafo } from "@/components/Parrafo";
import { SectionLabel } from "@/components/SectionLabel";
import { useTheme } from "@/context/theme";
import {
  ApiError,
  patchEntrenamiento,
  type MeResponse,
  type TrainingTime,
} from "@/lib/api";
import { DIAS_SEMANA, type WeekDay } from "@/lib/replantear";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * "¿A qué hora entrenas?" — parejo toda la semana, o distinto por día.
 *
 * NO es una etiqueta: es lo que decide la ESTRUCTURA de tus comidas. Quien
 * entrena en la mañana desayuna antes de entrenar y come fuerte después; quien
 * entrena de noche desayuna bajo en carbohidratos y se los guarda para la
 * tarde. Antes esto se contestaba una vez en el onboarding y no había forma de
 * moverlo, así que a quien cambiaba de turno le quedaba un menú que llamaba
 * "pre-entreno" a lo que para ella era el desayuno.
 *
 * Por eso, al cambiar el horario, el servidor rearma el menú con la MISMA
 * semilla: los alimentos siguen siendo reconocibles y lo que se acomoda es
 * cuándo van los carbohidratos.
 *
 * El horario por día existe para quien no entrena siempre a la misma hora
 * (mañana entre semana, tarde el sábado). Mientras no se declare, manda el
 * horario parejo.
 *
 * Este editor vive en la hoja `/ajustes/detalle/horario`; en la sección solo
 * queda un renglón con el estado ("Mañana · 2 excepciones"). Por eso la
 * rejilla por día ya no se esconde detrás de un toggle: la hoja ES el zoom y
 * aquí todo se enseña de una vez.
 */

export const HORARIOS: Array<{ valor: TrainingTime; nombre: string; icono: typeof Sun }> = [
  { valor: "MANANA", nombre: "Mañana", icono: Sunrise },
  { valor: "MEDIODIA", nombre: "Mediodía", icono: Sun },
  { valor: "TARDE", nombre: "Tarde", icono: Sunset },
  { valor: "NOCHE", nombre: "Noche", icono: Moon },
];

/** Lo que se puede poner en un día suelto: los cuatro horarios o descanso. */
type HorarioDeDia = TrainingTime | "DESCANSO";

export function HorarioDeEntrenamiento({ me }: { me: MeResponse | null }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [parejo, setParejo] = useState<TrainingTime>(
    (me?.profile?.trainingTime as TrainingTime | undefined) ?? "MANANA",
  );
  const [porDia, setPorDia] = useState<Partial<Record<WeekDay, HorarioDeDia>>>(
    leeHorarioPorDia(me?.profile?.trainingSchedule),
  );
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const guardar = useCallback(
    async (cambios: Parameters<typeof patchEntrenamiento>[0]) => {
      if (guardando) return;
      setError(null);
      setAviso(null);
      setGuardando(true);
      try {
        const respuesta = await patchEntrenamiento(cambios);
        if (respuesta.menuRearmado) {
          setAviso("Tu menú se rearmó: las comidas se acomodaron a tu nueva hora de entrenar.");
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "No se pudo guardar tu horario");
      } finally {
        setGuardando(false);
      }
    },
    [guardando],
  );

  function eligeParejo(valor: TrainingTime) {
    setParejo(valor);
    void guardar({ trainingTime: valor });
  }

  function eligeDia(dia: WeekDay, valor: HorarioDeDia) {
    // Volver a tocar el mismo valor lo quita: ese día regresa al horario
    // parejo en vez de quedarse clavado en una excepción que ya no aplica.
    const siguiente = { ...porDia };
    if (siguiente[dia] === valor) delete siguiente[dia];
    else siguiente[dia] = valor;

    setPorDia(siguiente);
    void guardar({
      trainingSchedule: Object.keys(siguiente).length > 0 ? siguiente : null,
    });
  }

  return (
    <Card>
      <View style={styles.sectionHeader}>
        <SectionLabel>A qué hora entrenas</SectionLabel>
        <InfoTip titulo="A qué hora entrenas">
          <TextoInfo>
            Esto no es una etiqueta: decide cómo se reparte tu comida. Si entrenas en la mañana,
            desayunas antes de entrenar y comes fuerte después. Si entrenas de noche, tu desayuno
            va bajo en carbohidratos y esos carbohidratos se guardan para la tarde.
          </TextoInfo>
          <TextoInfo>
            Al cambiarlo se rearma tu menú con los mismos alimentos: lo que se mueve es cuándo
            comes qué.
          </TextoInfo>
        </InfoTip>
      </View>

      <View style={styles.opciones}>
        {HORARIOS.map((horario) => {
          const activo = parejo === horario.valor;
          const Icono = horario.icono;
          return (
            <Pressable
              key={horario.valor}
              onPress={() => eligeParejo(horario.valor)}
              disabled={guardando}
              style={[styles.opcion, activo && styles.opcionOn]}
            >
              <Icono size={16} color={activo ? colors.pergamino : colors.marfil} strokeWidth={2} />
              <Text style={[styles.opcionTexto, activo && styles.opcionTextoOn]}>
                {horario.nombre}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* La rejilla por día siempre a la vista: esta hoja ES el zoom, y un
          toggle que abre hacia abajo es justo lo que el rediseño prohibió. */}
      <Text style={styles.subLabel}>Si no entrenas igual todos los días</Text>
      <View style={styles.dias}>
        <Parrafo style={styles.diasNota}>
          Los días que no marques siguen tu horario de arriba. Toca dos veces para quitar la
          excepción.
        </Parrafo>
        {DIAS_SEMANA.map(({ valor: dia, nombre }) => (
          <View key={dia} style={styles.diaFila}>
            <Text style={styles.diaNombre}>{nombre}</Text>
            <View style={styles.diaOpciones}>
              {HORARIOS.map((horario) => {
                const activo = porDia[dia] === horario.valor;
                return (
                  <Pressable
                    key={horario.valor}
                    onPress={() => eligeDia(dia, horario.valor)}
                    disabled={guardando}
                    style={[styles.diaChip, activo && styles.diaChipOn]}
                  >
                    <Text style={[styles.diaChipTexto, activo && styles.diaChipTextoOn]}>
                      {horario.nombre.slice(0, 3)}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => eligeDia(dia, "DESCANSO")}
                disabled={guardando}
                style={[styles.diaChip, porDia[dia] === "DESCANSO" && styles.diaChipOn]}
              >
                <Text
                  style={[
                    styles.diaChipTexto,
                    porDia[dia] === "DESCANSO" && styles.diaChipTextoOn,
                  ]}
                >
                  Desc
                </Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>

      {guardando && <ActivityIndicator size="small" color={colors.champan} style={styles.spinner} />}
      {aviso && <Parrafo style={styles.aviso}>{aviso}</Parrafo>}
      {error && <Text style={styles.error}>{error}</Text>}
    </Card>
  );
}

/** El `trainingSchedule` del perfil, sin confiar en su forma. Exportada para
 * que la sección arme su renglón-resumen ("Mañana · 2 excepciones") sin
 * duplicar el parseo. */
export function leeHorarioPorDia(json: unknown): Partial<Record<WeekDay, HorarioDeDia>> {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return {};
  const validos = new Set<string>([...HORARIOS.map((h) => h.valor), "DESCANSO"]);
  const salida: Partial<Record<WeekDay, HorarioDeDia>> = {};
  for (const [dia, valor] of Object.entries(json as Record<string, unknown>)) {
    if (typeof valor === "string" && validos.has(valor)) {
      salida[dia as WeekDay] = valor as HorarioDeDia;
    }
  }
  return salida;
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    opciones: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
    opcion: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
      minHeight: 44,
    },
    opcionOn: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
    opcionTexto: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    opcionTextoOn: { color: colors.pergamino },
    subLabel: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.label,
      letterSpacing: 1,
      color: colors.paloRosa,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    dias: { gap: spacing.sm },
    diasNota: {
      fontFamily: fonts.sans,
      ...typeScale.label,
      color: colors.pergaminoSoft,
      marginBottom: spacing.sm,
    },
    diaFila: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    diaNombre: { width: 40, fontFamily: fonts.sansMedium, ...typeScale.label, color: colors.marfil },
    diaOpciones: { flexDirection: "row", gap: 4, flex: 1 },
    diaChip: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 36,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    diaChipOn: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
    diaChipTexto: { fontFamily: fonts.sansMedium, ...typeScale.label, color: colors.marfil },
    diaChipTextoOn: { color: colors.pergamino },
    spinner: { marginTop: spacing.sm },
    aviso: { fontFamily: fonts.sans, ...typeScale.label, color: colors.champan, marginTop: spacing.sm },
    error: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.error, marginTop: spacing.sm },
  });
