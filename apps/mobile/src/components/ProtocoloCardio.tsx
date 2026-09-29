import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/context/theme";
import type { UnidadVelocidad } from "@/lib/api";
import type { ProgramaCardio } from "@/lib/api-cardio";
import { colorDeEsfuerzo } from "@/lib/hiit";
import { filasDePrograma, tienePulso } from "@/lib/programa-cardio";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";

/**
 * La tabla de cualquier cardio (P1; antes `ProtocoloHiit`, solo caminadora):
 * Tiempo · lo que se pone en la máquina · Esfuerzo, con el color de cada
 * esfuerzo del tema. El chip km/h ↔ mph solo aparece en caminadora; las
 * demás máquinas ya traen su control escrito por la web ("Resist. 10 · 140
 * SPM", "2:15/500 · 26 SPM"). Si la web conoce la edad, cada fila dice su
 * zona de pulso debajo del control.
 *
 * Un tramo `inferido` (protocolo real de Mau que no se veía en la captura)
 * lleva un "?" discreto aquí, en el detalle; la sesión en vivo no lo enseña.
 */
export function ProtocoloCardio({
  programa,
  unidad,
  onUnidad,
}: {
  programa: ProgramaCardio;
  unidad: UnidadVelocidad;
  onUnidad?: (unidad: UnidadVelocidad) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const filas = filasDePrograma(programa, unidad);
  const hayInferidos = filas.some((fila) => fila.inferido);
  const conPulso = tienePulso(programa);
  const esCaminadora = programa.maquina === "CAMINADORA";

  return (
    <View style={styles.caja}>
      <View style={styles.cabeza}>
        <Text style={styles.titulo}>{programa.titulo}</Text>
        {esCaminadora && (
          <View style={styles.unidades} accessibilityRole="radiogroup">
            {(["kmh", "mph"] as const).map((valor) => {
              const activa = valor === unidad;
              return (
                <Pressable
                  key={valor}
                  onPress={() => onUnidad?.(valor)}
                  disabled={!onUnidad || activa}
                  hitSlop={8}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: activa }}
                  style={[styles.unidad, activa && styles.unidadActiva]}
                >
                  <Text style={[styles.unidadTexto, activa && styles.unidadTextoActiva]}>
                    {valor === "kmh" ? "km/h" : "mph"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      <View style={[styles.fila, styles.filaCabeza]}>
        <Text style={[styles.celdaTiempo, styles.encabezado]}>Tiempo</Text>
        <Text style={[styles.celdaControl, styles.encabezado]}>{esCaminadora ? "Velocidad" : "En la máquina"}</Text>
        <Text style={[styles.celdaEsfuerzo, styles.encabezado]}>Esfuerzo</Text>
      </View>

      {filas.map((fila) => {
        const color = colorDeEsfuerzo(fila.esfuerzo, colors);
        return (
          <View key={fila.tiempo} style={[styles.fila, { borderLeftColor: color }]}>
            <Text style={styles.celdaTiempo}>{fila.tiempo}</Text>
            <View style={styles.celdaControlCaja}>
              <Text style={styles.celdaControlTexto}>{fila.control}</Text>
              {conPulso && fila.lpm && <Text style={styles.lpm}>{fila.lpm}</Text>}
            </View>
            <View style={styles.celdaEsfuerzoCaja}>
              <View style={[styles.punto, { backgroundColor: color }]} />
              <Text style={[styles.celdaEsfuerzo, { color }]}>{fila.esfuerzo}</Text>
              {fila.inferido && (
                <Text style={styles.inferido} accessibilityLabel="tramo completado por el patrón">
                  ?
                </Text>
              )}
            </View>
          </View>
        );
      })}

      {programa.notaMaquina && (
        <Text style={styles.nota} numberOfLines={2}>
          {programa.notaMaquina}
        </Text>
      )}
      {hayInferidos && <Text style={styles.nota}>? = tramo que no se veía en la tabla original; se completó por su patrón.</Text>}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    caja: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.superficie,
      padding: spacing.md,
      gap: spacing.xs,
    },
    cabeza: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, marginBottom: spacing.xs },
    titulo: { flex: 1, fontFamily: fonts.sansSemiBold, ...typeScale.subheading, color: colors.champan },
    unidades: {
      flexDirection: "row",
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      overflow: "hidden",
    },
    unidad: { paddingHorizontal: spacing.sm, paddingVertical: 4 },
    unidadActiva: { backgroundColor: colors.champan },
    unidadTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.label, color: colors.paloRosa },
    unidadTextoActiva: { color: colors.pergamino },
    fila: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 6,
      paddingLeft: spacing.sm,
      borderLeftWidth: 3,
      borderLeftColor: "transparent",
      backgroundColor: withAlpha(colors.marfil, 0.03),
      borderRadius: radius.sm,
    },
    filaCabeza: { backgroundColor: "transparent" },
    encabezado: { fontFamily: fonts.sansSemiBold, color: colors.paloRosaLight, ...typeScale.label },
    celdaTiempo: { flex: 0.9, fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.marfil },
    celdaControlCaja: { flex: 1.6, paddingRight: spacing.xs },
    celdaControl: { flex: 1.6, fontFamily: fonts.sansSemiBold, ...typeScale.bodySm, color: colors.marfil },
    celdaControlTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.bodySm, color: colors.marfil },
    lpm: { fontFamily: fonts.sans, ...typeScale.label, color: colors.paloRosaLight },
    celdaEsfuerzoCaja: { flex: 1.2, flexDirection: "row", alignItems: "center", gap: 6 },
    celdaEsfuerzo: { flexShrink: 1, fontFamily: fonts.sansSemiBold, ...typeScale.bodySm },
    punto: { width: 8, height: 8, borderRadius: 4 },
    inferido: { fontFamily: fonts.sans, ...typeScale.label, color: colors.paloRosaLight },
    nota: { fontFamily: fonts.sans, ...typeScale.label, color: colors.paloRosaLight, marginTop: spacing.xs },
  });
