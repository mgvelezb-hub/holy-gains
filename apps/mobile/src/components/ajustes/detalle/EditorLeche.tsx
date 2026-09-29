import { Check } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { SectionLabel } from "@/components/SectionLabel";
import { useTheme } from "@/context/theme";
import { ApiError, patchBaseLicuado, patchLeche, type MeResponse } from "@/lib/api";
import {
  BASES_DE_LICUADO,
  TIPOS_DE_LECHE,
  baseLicuadoDelPerfil,
  tipoLecheDelPerfil,
  type BaseLicuado,
  type TipoLeche,
} from "@/lib/leche";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * La leche de licuados y cremas: cuatro opciones de una línea, y debajo con
 * qué se licua (agua o esa leche). Al cambiar cualquiera se rearma la semana
 * de hoy en adelante, igual que con la despensa: si ya registraste comidas,
 * se pregunta antes.
 */
export function EditorLeche({ me }: { me: MeResponse | null }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [leche, setLeche] = useState<TipoLeche>("descremada");
  const [base, setBase] = useState<BaseLicuado>("leche");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (me?.profile) {
      setLeche(tipoLecheDelPerfil(me.profile));
      setBase(baseLicuadoDelPerfil(me.profile));
    }
  }, [me]);

  async function guardarBase(valor: BaseLicuado, rearmar = false) {
    const anterior = base;
    setBase(valor);
    setMsg(null);
    try {
      const respuesta = await patchBaseLicuado(valor, rearmar);
      if (respuesta.congelado && !respuesta.rearmado) {
        Alert.alert(
          "Tu semana ya empezó",
          "Guardamos cómo haces tus licuados. ¿Rearmamos el menú de hoy en adelante? Lo que ya registraste se queda como está.",
          [
            { text: "Después", style: "cancel" },
            { text: "Rearmar", onPress: () => void guardarBase(valor, true) },
          ],
        );
        setMsg("Guardado. Entra en tu siguiente menú.");
        return;
      }
      setMsg(respuesta.rearmado ? "Listo: tus licuados ya se preparan así." : "Guardado.");
    } catch (error) {
      setBase(anterior);
      setMsg(error instanceof ApiError ? error.message : "No se pudo guardar la base de tus licuados");
    }
  }

  async function guardar(valor: TipoLeche, rearmar = false) {
    const anterior = leche;
    setLeche(valor);
    setMsg(null);
    try {
      const respuesta = await patchLeche(valor, rearmar);
      if (respuesta.congelado && !respuesta.rearmado) {
        Alert.alert(
          "Tu semana ya empezó",
          "Guardamos tu leche. ¿Rearmamos el menú de hoy en adelante? Lo que ya registraste se queda como está.",
          [
            { text: "Después", style: "cancel" },
            { text: "Rearmar", onPress: () => void guardar(valor, true) },
          ],
        );
        setMsg("Guardado. Entra en tu siguiente menú.");
        return;
      }
      setMsg(respuesta.rearmado ? "Listo: tu semana ya usa esta leche." : "Guardado.");
    } catch (error) {
      setLeche(anterior);
      setMsg(error instanceof ApiError ? error.message : "No se pudo guardar tu leche");
    }
  }

  return (
    <Card>
      <View style={styles.sectionHeader}>
        <SectionLabel>Leche</SectionLabel>
        <InfoTip titulo="Leche">
          <TextoInfo>
            Cambia calorías y grasa de licuados y cremas; el plan se recalcula para que tu día
            siga cuadrando. Las otras leches no salen en tu menú.
          </TextoInfo>
        </InfoTip>
      </View>

      <View style={styles.lista}>
        {TIPOS_DE_LECHE.map((tipo) => {
          const on = leche === tipo.clave;
          return (
            <Pressable
              key={tipo.clave}
              onPress={() => (on ? undefined : guardar(tipo.clave))}
              style={[styles.fila, on && styles.filaOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.filaNombre, on && styles.filaNombreOn]} numberOfLines={1}>
                {tipo.nombre}
              </Text>
              {on && <Check size={18} color={colors.pergamino} strokeWidth={2.5} />}
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.sectionHeader, styles.segundaSeccion]}>
        <SectionLabel>Base de licuados</SectionLabel>
        <InfoTip titulo="Base de licuados">
          <TextoInfo>
            Con agua, tus licuados no llevan las calorías ni la proteína de la leche: el plan las
            reparte en tus otras comidas. Las cremas siguen con tu leche.
          </TextoInfo>
        </InfoTip>
      </View>

      <View style={styles.lista}>
        {BASES_DE_LICUADO.map((opcion) => {
          const on = base === opcion.clave;
          return (
            <Pressable
              key={opcion.clave}
              onPress={() => (on ? undefined : guardarBase(opcion.clave))}
              style={[styles.fila, on && styles.filaOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.filaNombre, on && styles.filaNombreOn]} numberOfLines={1}>
                {opcion.nombre}
              </Text>
              {on && <Check size={18} color={colors.pergamino} strokeWidth={2.5} />}
            </Pressable>
          );
        })}
      </View>

      {msg && <Text style={styles.msg}>{msg}</Text>}
    </Card>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    segundaSeccion: { marginTop: spacing.lg },
    lista: { gap: spacing.sm, marginTop: spacing.md },
    fila: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: 44,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
      paddingHorizontal: spacing.lg,
    },
    filaOn: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
    filaNombre: { flexShrink: 1, fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.marfil },
    filaNombreOn: { color: colors.pergamino },
    msg: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa, marginTop: spacing.md },
  });
