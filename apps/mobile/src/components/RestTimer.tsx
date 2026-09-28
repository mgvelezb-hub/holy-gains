import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "@/context/theme";
import { fonts, radius, spacing, withAlpha, type Palette, type as typeScale } from "@/lib/theme";

const PRESETS = [60, 90, 120];

/**
 * Cronómetro de descanso. Arranca solo al marcar una serie, con el tiempo
 * sugerido por el esquema (`exercise.restSeconds`, igual que la web en
 * apps/web/src/app/app/entrenamiento/rest-timer.tsx). Sin sonido — en el
 * gimnasio la música tapa cualquier tono — y sin vibración: `expo-haptics` no
 * está entre las dependencias de esta fase.
 *
 * Los chips 60/90/120 dejan ajustar el objetivo si la atleta quiere descansar
 * más de lo automático (piernas pesado, por ejemplo).
 */
export function RestTimer({
  startedAt,
  seconds,
  onDismiss,
}: {
  startedAt: number;
  seconds: number;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // El intervalo solo fuerza el repintado; la hora se lee en cada render.
  //
  // Antes la hora vivía en un estado que se inicializaba al montar y se
  // actualizaba cada 250 ms: al cerrar OTRA serie con el cronómetro ya en
  // pantalla, `startedAt` cambiaba pero `now` seguía siendo el de la serie
  // anterior, y el primer frame restaba contra una hora vieja — el reloj
  // arrancaba en un número y saltaba a otro en el siguiente tick.
  const [, setTick] = useState(0);
  // El objetivo elegido con los chips vale para ESTE descanso. Guardado como
  // estado suelto se quedaba pegado al siguiente (y a otro ejercicio con otro
  // `seconds`), que es el otro número del que saltaba.
  const [eleccion, setEleccion] = useState<{ para: number; segundos: number } | null>(null);
  const target = eleccion?.para === startedAt ? eleccion.segundos : seconds;
  const setTarget = (segundos: number) => setEleccion({ para: startedAt, segundos });

  useEffect(() => {
    const id = setInterval(() => setTick((valor) => valor + 1), 250);
    return () => clearInterval(id);
  }, [startedAt]);

  const now = Date.now();
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const left = target - elapsed;
  const done = left <= 0;

  const label = done
    ? "¡Va la que sigue!"
    : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  return (
    <View style={[styles.container, done && styles.done]}>
      <View style={styles.row}>
        <Text style={styles.timer}>{label}</Text>
        <Pressable onPress={onDismiss} hitSlop={8}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>
      <View style={styles.presets}>
        {PRESETS.map((preset) => (
          <Pressable
            key={preset}
            onPress={() => setTarget(preset)}
            style={[styles.preset, target === preset && styles.presetActive]}
          >
            <Text style={[styles.presetText, target === preset && styles.presetTextActive]}>
              {preset}s
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  container: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.cardBg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  done: {
    borderColor: colors.champan,
    backgroundColor: withAlpha(colors.champan, 0.12),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  timer: {
    fontFamily: fonts.display,
    ...typeScale.heading,
    color: colors.marfil,
  },
  close: {
    fontFamily: fonts.sans,
    ...typeScale.subheading,
    color: colors.paloRosaLight,
    padding: spacing.xs,
  },
  presets: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  preset: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  presetActive: {
    backgroundColor: colors.guindaLight,
    borderColor: colors.guindaLight,
  },
  presetText: {
    fontFamily: fonts.sansSemiBold,
    ...typeScale.label,
    letterSpacing: 1,
    color: colors.paloRosa,
  },
  presetTextActive: {
    // pergamino: rol "texto sobre fondo de acento" (aquí guindaLight).
    color: colors.pergamino,
  },
});
