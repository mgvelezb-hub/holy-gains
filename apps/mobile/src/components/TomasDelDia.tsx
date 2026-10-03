import { Check, Circle } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { useTheme } from "@/context/theme";
import { getSuplementos, postLogSuplemento, type TomaDelDia } from "@/lib/api";
import { AYUDA_TOMAS, alternaToma, renglonToma } from "@/lib/tomas-comida";
import { fonts, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";

/**
 * Las tomas de hoy para las hojas del día (menú, "Mis comidas hoy", la
 * comida). Tolerante a fallar: sin red o sin suplementos, las comidas se
 * pintan igual, solo sin sus renglones de toma.
 */
export function useTomasDeHoy(): {
  tomas: TomaDelDia[];
  cargar: () => Promise<void>;
  alternar: (supplement: string) => Promise<void>;
} {
  const [estado, setEstado] = useState<{ hoy: string; tomas: TomaDelDia[] } | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await getSuplementos();
      setEstado({ hoy: res.hoy, tomas: res.tomas });
    } catch {
      setEstado(null);
    }
  }, []);

  const alternar = useCallback(
    async (supplement: string) => {
      if (!estado) return;
      const toma = estado.tomas.find((t) => t.supplement === supplement);
      if (!toma) return;
      const anterior = estado;
      setEstado({ ...estado, tomas: alternaToma(estado.tomas, supplement) });
      try {
        await postLogSuplemento(estado.hoy, supplement, !toma.hecho);
      } catch {
        // Una toma marcada que no se guardó mentiría en el conteo de mañana.
        setEstado(anterior);
      }
    },
    [estado],
  );

  return { tomas: estado?.tomas ?? [], cargar, alternar };
}

/**
 * Un renglón de toma. El check es "ya lo tomé hoy", no "acepto tomarlo" (eso
 * vive en Ajustes → Suplementos): sin marcar dice "○ Creatina 5 g · tócalo al
 * tomarlo"; marcado, "✓ Creatina 5 g · tomada" en verde, sin tachar.
 * Tocar de nuevo desmarca. Con `cuando`, la toma que no va con comida dice su
 * momento ("30 min antes de dormir"); con `conAyuda` (la primera del día),
 * el InfoTip que lo explica.
 */
export function RenglonToma({
  toma,
  onToggle,
  conCuando = false,
  conAyuda = false,
}: {
  toma: TomaDelDia;
  onToggle: (supplement: string) => void;
  conCuando?: boolean;
  conAyuda?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={() => onToggle(toma.supplement)}
      style={({ pressed }) => [styles.fila, pressed && styles.presionada]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: toma.hecho }}
      hitSlop={4}
    >
      {toma.hecho ? (
        <Check size={16} color={colors.exito} strokeWidth={2.5} />
      ) : (
        <Circle size={16} color={colors.paloRosa} strokeWidth={2} />
      )}
      <Text style={[styles.texto, toma.hecho && styles.hecho]} numberOfLines={1}>
        {renglonToma(toma)}
        {conCuando && !toma.hecho ? ` · ${toma.cuando}` : ""}
      </Text>
      {conAyuda && (
        <InfoTip titulo="Tus tomas">
          <TextoInfo>{AYUDA_TOMAS}.</TextoInfo>
        </InfoTip>
      )}
    </Pressable>
  );
}

/**
 * Las tomas de una comida, debajo de sus alimentos. Nada si no hay.
 * `primeraDelDia` es la primera toma del día: esa lleva el InfoTip.
 */
export function TomasDeLaComida({
  tomas,
  onToggle,
  primeraDelDia,
}: {
  tomas: TomaDelDia[];
  onToggle: (supplement: string) => void;
  primeraDelDia?: string;
}) {
  if (tomas.length === 0) return null;
  return (
    <View>
      {tomas.map((toma) => (
        <RenglonToma
          key={toma.supplement}
          toma={toma}
          onToggle={onToggle}
          conAyuda={toma.supplement === primeraDelDia}
        />
      ))}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    fila: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      minHeight: 36,
      paddingVertical: 5,
    },
    presionada: { backgroundColor: withAlpha(colors.paloRosa, 0.08) },
    texto: { flex: 1, fontFamily: fonts.sans, ...typeScale.body, color: colors.champan },
    hecho: { color: colors.exito },
  });
