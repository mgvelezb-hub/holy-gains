import Constants from "expo-constants";
import { useRouter } from "expo-router";
import {
  CalendarClock,
  CalendarHeart,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Images,
  LogOut,
  Palette as PaletteIcon,
  Salad,
  Smartphone,
  User,
  Watch,
} from "lucide-react-native";
import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useTheme } from "@/context/theme";
import { getCiclo } from "@/lib/api";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";
import { SECCIONES, type Seccion } from "@/app/ajustes/[seccion]";

/**
 * Ajustes — un menú, no un tablero.
 *
 * Aquí no hay tarjetas-resumen: en Resumen la tarjeta cerrada tiene que
 * contestar sin abrirse, pero un ajuste no tiene un dato que valga la pena
 * enseñar en la lista —"Apariencia: Champán" no ayuda a decidir nada—. Lo que
 * se necesita es encontrar rápido, y para eso sirve una lista de renglones
 * cortos que lleva a su hoja.
 */

type Entrada = {
  /** La sección de `/ajustes/[seccion]`, o una pantalla propia (`ruta`). */
  seccion: Seccion | "ciclo";
  ruta?: string;
  /** Solo para perfiles de mujer (el seguimiento del ciclo). */
  soloMujer?: boolean;
  icon: ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  detalle: string;
  soloIOS?: boolean;
};

const ENTRADAS: Entrada[] = [
  { seccion: "checkin", icon: CalendarClock, detalle: "Qué día cierras tu semana y a qué hora" },
  {
    seccion: "entrenamiento",
    icon: Dumbbell,
    detalle: "Grupos que no repites y otras disciplinas",
  },
  { seccion: "nutricion", icon: Salad, detalle: "Presupuesto, tiempo de cocina y alimentos" },
  { seccion: "perfil", icon: User, detalle: "Tus datos y tu fase actual" },
  {
    seccion: "ciclo",
    ruta: "/ciclo",
    icon: CalendarHeart,
    detalle: "Tu periodo y la duración de tu ciclo",
    soloMujer: true,
  },
  { seccion: "apariencia", icon: PaletteIcon, detalle: "Claro, oscuro o champán" },
  { seccion: "fotos", icon: Images, detalle: "Tu clave, Face ID y tu bóveda" },
  { seccion: "reloj", icon: Watch, detalle: "Apple Salud y la app del reloj", soloIOS: true },
  { seccion: "telefono", icon: Smartphone, detalle: "Cola offline, videos y espacio" },
  { seccion: "sesion", icon: LogOut, detalle: "Cerrar sesión" },
];

/** El nombre de cada preferencia de tema, para el renglón de Apariencia. */
const NOMBRE_TEMA: Record<string, string> = {
  system: "Sistema",
  light: "Claro",
  dark: "Oscuro",
  champan: "Champán",
};

export default function AjustesScreen() {
  const router = useRouter();
  const { colors, preference } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // El ciclo solo se ofrece a quien se registró como mujer: lo dice el servidor.
  const [esMujer, setEsMujer] = useState(false);
  useEffect(() => {
    getCiclo()
      .then((ciclo) => setEsMujer(ciclo.disponible))
      .catch(() => setEsMujer(false));
  }, []);

  const entradas = ENTRADAS.filter(
    (entrada) => (!entrada.soloIOS || Platform.OS === "ios") && (!entrada.soloMujer || esMujer),
  );
  const version = Constants.expoConfig?.version ?? "—";

  /**
   * El estado actual, solo cuando ya está cargado gratis: el tema vive en el
   * contexto que esta pantalla ya consume. Los demás renglones pedirían una
   * llamada al servidor nada más para decorar el menú, así que conservan su
   * descripción fija.
   */
  function detalleDe(entrada: Entrada): string {
    if (entrada.seccion === "apariencia") {
      return `Ahora: ${NOMBRE_TEMA[preference] ?? "Sistema"}`;
    }
    return entrada.detalle;
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.backText}>Atrás</Text>
        </Pressable>

        <Text style={styles.title}>Ajustes</Text>

        <View style={styles.lista}>
          {entradas.map((entrada, index) => {
            const Icon = entrada.icon;
            return (
              <Pressable
                key={entrada.seccion}
                onPress={() => router.push((entrada.ruta ?? `/ajustes/${entrada.seccion}`) as never)}
                style={({ pressed }) => [
                  styles.fila,
                  index === 0 && styles.filaPrimera,
                  index === entradas.length - 1 && styles.filaUltima,
                  pressed && styles.filaPresionada,
                ]}
              >
                <View style={styles.icono}>
                  <Icon size={19} color={colors.champan} strokeWidth={2} />
                </View>

                <View style={styles.textos}>
                  <Text style={styles.nombre}>
                    {entrada.seccion === "ciclo" ? "Tu ciclo" : SECCIONES[entrada.seccion]}
                  </Text>
                  <Text style={styles.detalle}>{detalleDe(entrada)}</Text>
                </View>

                <ChevronRight size={19} color={colors.paloRosa} strokeWidth={2} />
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.version}>Holy Gains {version}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.obsidiana },
  content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.lg },
  back: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: spacing.sm,
    alignSelf: "flex-start",
  },
  backText: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
  title: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
  lista: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.cardBg,
    overflow: "hidden",
  },
  fila: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    // La separación entre renglones es una línea, no un hueco: en una lista de
    // ajustes el bloque continuo se recorre más rápido que seis tarjetas.
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
  },
  filaPrimera: { borderTopWidth: 0 },
  filaUltima: {},
  filaPresionada: { backgroundColor: withAlpha(colors.paloRosa, 0.08) },
  icono: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(colors.champan, 0.16),
  },
  textos: { flex: 1, gap: 1 },
  nombre: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.marfil },
  detalle: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
  version: {
    fontFamily: fonts.sans,
    ...typeScale.bodySm,
    color: colors.paloRosaLight,
    textAlign: "center",
  },
});
