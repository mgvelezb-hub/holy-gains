import { Flag, RotateCcw } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { Parrafo } from "@/components/Parrafo";
import { SectionLabel } from "@/components/SectionLabel";
import { useTheme } from "@/context/theme";
import {
  ApiError,
  getCheckins,
  putPuntoCero,
  type CheckInRow,
  type PuntoCero,
} from "@/lib/api";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * "Tu punto cero" — desde qué check-in se compara todo.
 *
 * EL PROBLEMA: quien vuelve a entrenar después de meses parada arrastra un
 * historial que ya no la describe. La app comparaba siempre contra el primer
 * registro que existiera, así que su cintura de hoy salía peor que la de hace
 * un año y cada avance real se leía como retroceso. Eso desanima justo a
 * quien más necesita seguir.
 *
 * LO QUE HACE: marca un check-in como la referencia. A partir de ahí las
 * gráficas, los avances y la comparación de fotos arrancan ahí.
 *
 * LO QUE NO HACE: borrar. El historial anterior se queda completo en el
 * servidor y vuelve a contar en cuanto se quita la marca — por eso el botón
 * de quitar no pide confirmación: no hay nada que perder.
 */
export function SeccionPuntoCero({
  puntoCero,
  onCambio,
}: {
  puntoCero: PuntoCero;
  onCambio: (nuevo: PuntoCero) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [ultimo, setUltimo] = useState<CheckInRow | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    getCheckins(1)
      .then((respuesta) => {
        if (vivo) setUltimo(respuesta.checkIns[0] ?? null);
      })
      .catch(() => {
        // Sin check-ins que ofrecer, la tarjeta lo dice abajo. Un fallo de red
        // aquí no vale un error rojo en Ajustes.
      });
    return () => {
      vivo = false;
    };
  }, [puntoCero]);

  const guardar = useCallback(
    async (checkInId: string | null) => {
      if (guardando) return;
      setError(null);
      setGuardando(true);
      try {
        const respuesta = await putPuntoCero(checkInId);
        onCambio(respuesta.puntoCero);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "No se pudo guardar tu punto cero");
      } finally {
        setGuardando(false);
      }
    },
    [guardando, onCambio],
  );

  return (
    <Card>
      <View style={styles.sectionHeader}>
        <SectionLabel>Tu punto cero</SectionLabel>
        <InfoTip titulo="Tu punto cero">
          <TextoInfo>
            Si llevas tiempo sin entrenar, compararte contra tus medidas de hace meses no te dice
            nada útil: cualquier avance de hoy se ve chico al lado de otra etapa de tu vida. Marca
            un check-in como tu punto cero y desde ahí arrancan tus gráficas, tus avances y la
            comparación de fotos.
          </TextoInfo>
          <TextoInfo>
            Nada se borra. Tu historial anterior sigue guardado y vuelve a contar en cuanto quites
            la marca.
          </TextoInfo>
        </InfoTip>
      </View>

      {puntoCero ? (
        <View style={styles.estado}>
          <Flag size={18} color={colors.champan} strokeWidth={2} />
          <Text style={styles.estadoTexto}>
            Comparando desde tu check-in del {fechaLarga(puntoCero.date)}.
          </Text>
        </View>
      ) : (
        <View style={styles.estado}>
          <Parrafo style={styles.estadoTexto}>
            Ahora mismo te comparas contra tu primer check-in registrado.
          </Parrafo>
        </View>
      )}

      {ultimo && ultimo.id !== puntoCero?.checkInId && (
        <Pressable
          onPress={() => guardar(ultimo.id)}
          disabled={guardando}
          style={styles.accion}
        >
          <Flag size={18} color={colors.pergamino} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            <Text style={styles.accionTitulo}>Empezar desde mi último check-in</Text>
            <Text style={styles.accionDetalle}>
              El del {fechaLarga(ultimo.date)} pasa a ser tu referencia.
            </Text>
          </View>
          {guardando && <ActivityIndicator size="small" color={colors.champan} />}
        </Pressable>
      )}

      {!ultimo && (
        <Parrafo style={styles.vacio}>
          Cuando subas tu primer check-in vas a poder marcarlo como tu punto cero.
        </Parrafo>
      )}

      {puntoCero && (
        <Pressable onPress={() => guardar(null)} disabled={guardando} style={styles.accion}>
          <RotateCcw size={18} color={colors.pergamino} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            <Text style={styles.accionTitulo}>Volver a contar desde el principio</Text>
            <Text style={styles.accionDetalle}>
              Recupera todo tu historial como referencia.
            </Text>
          </View>
        </Pressable>
      )}

      {error && <Text style={styles.error}>{error}</Text>}
    </Card>
  );
}

/** "31 de agosto de 2026" a partir del ISO `YYYY-MM-DD` que manda el servidor. */
function fechaLarga(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  // Mediodía para que el cambio de huso no recorra la fecha un día.
  const fecha = new Date(year, month - 1, day, 12);
  return fecha.toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    estado: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    estadoTexto: { flex: 1, fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.marfil },
    accion: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.guindaLight,
      backgroundColor: colors.guinda,
    },
    accionTitulo: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    accionDetalle: {
      fontFamily: fonts.sans,
      ...typeScale.label,
      color: colors.pergamino,
      marginTop: 2,
    },
    vacio: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.pergamino,
      marginTop: spacing.md,
    },
    error: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.champan,
      marginTop: spacing.sm,
    },
  });
