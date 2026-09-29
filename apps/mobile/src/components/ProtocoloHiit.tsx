import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/context/theme";
import type { ProtocoloHiit as Protocolo, UnidadVelocidad } from "@/lib/api";
import { colorDeEsfuerzo, filasDeProtocolo, tituloProtocolo } from "@/lib/hiit";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";

/**
 * La tabla del protocolo HIIT de caminadora (N1), como la de las capturas
 * de Mau: Tiempo · Velocidad · Esfuerzo, con el color de cada esfuerzo del
 * tema y un chip km/h ↔ mph que guarda la preferencia.
 *
 * Un tramo `inferido` (no se veía en la captura de la que salió) lleva un
 * "?" discreto aquí, en el detalle; la sesión en vivo no lo enseña.
 */
export function ProtocoloHiit({
  protocolo,
  unidad,
  onUnidad,
}: {
  protocolo: Protocolo;
  unidad: UnidadVelocidad;
  onUnidad?: (unidad: UnidadVelocidad) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const filas = filasDeProtocolo(protocolo, unidad);
  const hayInferidos = filas.some((fila) => fila.inferido);

  return (
    <View style={styles.caja}>
      <View style={styles.cabeza}>
        <Text style={styles.titulo}>{tituloProtocolo(protocolo)}</Text>
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
      </View>

      <View style={[styles.fila, styles.filaCabeza]}>
        <Text style={[styles.celdaTiempo, styles.encabezado]}>Tiempo</Text>
        <Text style={[styles.celdaVelocidad, styles.encabezado]}>Velocidad</Text>
        <Text style={[styles.celdaEsfuerzo, styles.encabezado]}>Esfuerzo</Text>
      </View>

      {filas.map((fila) => {
        const color = colorDeEsfuerzo(fila.esfuerzo, colors);
        return (
          <View key={fila.tiempo} style={[styles.fila, { borderLeftColor: color }]}>
            <Text style={styles.celdaTiempo}>{fila.tiempo}</Text>
            <Text style={styles.celdaVelocidad}>{fila.velocidad}</Text>
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

      {protocolo.recortado && (
        <Text style={styles.nota}>Tu nivel aún no tiene 10': es el de 15' recortado a 10 min, cerrando en Fácil.</Text>
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
    cabeza: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.xs },
    titulo: { fontFamily: fonts.sansSemiBold, ...typeScale.subheading, color: colors.champan },
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
    celdaTiempo: { flex: 1, fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.marfil },
    celdaVelocidad: { flex: 1.2, fontFamily: fonts.sansSemiBold, ...typeScale.bodySm, color: colors.marfil },
    celdaEsfuerzoCaja: { flex: 1.3, flexDirection: "row", alignItems: "center", gap: 6 },
    celdaEsfuerzo: { flexShrink: 1, fontFamily: fonts.sansSemiBold, ...typeScale.bodySm },
    punto: { width: 8, height: 8, borderRadius: 4 },
    inferido: { fontFamily: fonts.sans, ...typeScale.label, color: colors.paloRosaLight },
    nota: { fontFamily: fonts.sans, ...typeScale.label, color: colors.paloRosaLight, marginTop: spacing.xs },
  });
