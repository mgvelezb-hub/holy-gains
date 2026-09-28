import { Check, Plus, RotateCcw, Trash2, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PanelResumen, type VistaResumen } from "@/components/PanelResumen";
import { Parrafo } from "@/components/Parrafo";
import { useTheme } from "@/context/theme";
import {
  DESCRIPCION_TAMANO,
  ETIQUETA_TAMANO,
  conTamano,
  definicionDe,
  etiquetaDeVista,
  layoutPorDefecto,
  moverA,
  panelesDisponibles,
  vistasPara,
  type PanelConfig,
  type Tamano,
  type Vista,
} from "@/lib/paneles";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";

/**
 * El editor del Resumen: el tablero de verdad, mientras se acomoda.
 *
 * Lo que se ve mientras arrastras son los paneles reales, con tus datos y en
 * el tamaño que van a quedar. La primera versión enseñaba una lista de
 * nombres, y acomodar así obliga a salir, mirar y volver a entrar por cada
 * cambio — el tablero se arma a ciegas.
 *
 * Tres cosas se hacen encima del panel: arrastrarlo (mantener y mover), sacarlo
 * (la tacha de la esquina, como en cualquier pantalla de widgets) y tocarlo
 * para elegir tamaño y detalle, que se aplican en vivo.
 *
 * El insets de arriba se calcula a mano y no con `SafeAreaView`: dentro de un
 * `Modal` el contexto de área segura no siempre baja, y el resultado era el
 * título encimado con la hora y la batería.
 */
export function EditorDePaneles({
  visible,
  layout,
  vista,
  onChange,
  onClose,
}: {
  visible: boolean;
  layout: PanelConfig[];
  /** Los datos ya calculados: el editor pinta paneles reales, no maquetas. */
  vista: VistaResumen;
  onChange: (layout: PanelConfig[]) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const disponibles = useMemo(() => panelesDisponibles(layout), [layout]);
  const [abierto, setAbierto] = useState<string | null>(null);

  function quitar(id: string) {
    onChange(layout.filter((panel) => panel.id !== id));
    if (abierto === id) setAbierto(null);
  }

  function agregar(id: string) {
    const def = definicionDe(id);
    if (!def) return;
    onChange([
      ...layout,
      {
        id,
        tamano: def.porDefecto?.tamano ?? def.tamanos[0]!,
        vista: def.porDefecto?.vista ?? def.vistas[0]!,
      },
    ]);
    setAbierto(id);
  }

  function aplicarTamano(id: string, tamano: Tamano) {
    onChange(conTamano(layout, id, tamano));
  }

  function aplicarVista(id: string, vista: Vista) {
    onChange(layout.map((panel) => (panel.id === id ? { ...panel, vista } : panel)));
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.raiz}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <Text style={styles.titulo}>Tu resumen</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.listo}>
            <Check size={16} color={colors.pergamino} strokeWidth={3} />
            <Text style={styles.listoTexto}>Listo</Text>
          </Pressable>
        </View>

        <View style={styles.barraAcciones}>
          <Pressable onPress={() => onChange(layoutPorDefecto())} hitSlop={8} style={styles.accion}>
            <RotateCcw size={15} color={colors.paloRosa} strokeWidth={2} />
            <Text style={styles.accionTexto}>Restaurar</Text>
          </Pressable>
          <Pressable onPress={() => onChange([])} hitSlop={8} style={styles.accion}>
            <Trash2 size={15} color={colors.paloRosa} strokeWidth={2} />
            <Text style={styles.accionTexto}>Limpiar todo</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={[styles.contenido, { paddingBottom: insets.bottom + 80 }]}
        >
          <Parrafo style={styles.ayuda}>
            Mantén y arrastra para acomodar. Toca un panel para cambiar su tamaño o su detalle: lo
            que ves aquí es lo que va a quedar.
          </Parrafo>

          {layout.map((panel, index) => (
            <PanelEditable
              key={panel.id}
              index={index}
              total={layout.length}
              panel={panel}
              vista={vista}
              abierto={abierto === panel.id}
              onAbrir={() => setAbierto(abierto === panel.id ? null : panel.id)}
              onQuitar={() => quitar(panel.id)}
              onTamano={(tamano) => aplicarTamano(panel.id, tamano)}
              onVista={(vista) => aplicarVista(panel.id, vista)}
              onSoltar={(destino) => onChange(moverA(layout, panel.id, destino))}
            />
          ))}

          {layout.length === 0 && (
            <Parrafo style={styles.ayuda}>
              Tu resumen quedó vacío. Agrega los paneles que quieras de la lista de abajo.
            </Parrafo>
          )}

          {disponibles.length > 0 && (
            <>
              <Text style={styles.seccion}>Para agregar</Text>
              <View style={styles.disponibles}>
                {disponibles.map((def) => (
                  <Pressable
                    key={def.id}
                    onPress={() => agregar(def.id)}
                    style={({ pressed }) => [styles.pastilla, pressed && styles.pastillaPresionada]}
                  >
                    <Plus size={14} color={colors.champan} strokeWidth={2.5} />
                    <Text style={styles.pastillaTexto}>{def.nombre}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      </GestureHandlerRootView>
    </Modal>
  );
}

/**
 * Un panel del tablero en modo edición.
 *
 * El arrastre mueve SOLO este panel con `transform`; los demás se quedan en su
 * sitio hasta que se suelta. Se ve menos vistoso que una lista que se abre
 * sola, y a cambio no hay dos elementos disputándose el mismo hueco —que fue
 * justo lo que rompió la primera versión, con las filas encimadas.
 *
 * El alto de referencia para calcular el destino se mide del propio panel
 * (`onLayout`): los paneles no miden lo mismo, y suponerlo movía la fila
 * equivocada.
 */
function PanelEditable({
  index,
  total,
  panel,
  vista,
  abierto,
  onAbrir,
  onQuitar,
  onTamano,
  onVista,
  onSoltar,
}: {
  index: number;
  total: number;
  panel: PanelConfig;
  vista: VistaResumen;
  abierto: boolean;
  onAbrir: () => void;
  onQuitar: () => void;
  onTamano: (tamano: Tamano) => void;
  onVista: (vista: Vista) => void;
  onSoltar: (destino: number) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const def = definicionDe(panel.id);

  const desplazamiento = useSharedValue(0);
  const levantado = useSharedValue(false);
  const alto = useSharedValue(160);

  const gesto = Gesture.Pan()
    .activateAfterLongPress(200)
    .onStart(() => {
      levantado.value = true;
    })
    .onUpdate((evento) => {
      desplazamiento.value = evento.translationY;
    })
    .onEnd(() => {
      const saltos = Math.round(desplazamiento.value / Math.max(80, alto.value));
      const destino = Math.max(0, Math.min(total - 1, index + saltos));
      levantado.value = false;
      desplazamiento.value = withTiming(0, { duration: 140 });
      if (destino !== index) runOnJS(onSoltar)(destino);
    });

  const estilo = useAnimatedStyle(() => ({
    transform: [{ translateY: desplazamiento.value }, { scale: levantado.value ? 1.02 : 1 }],
    zIndex: levantado.value ? 20 : 1,
    opacity: levantado.value ? 0.96 : 1,
  }));

  if (!def) return null;

  return (
    <Animated.View
      style={[styles.editable, estilo]}
      onLayout={(evento) => {
        alto.value = evento.nativeEvent.layout.height;
      }}
    >
      <GestureDetector gesture={gesto}>
        <View>
          {/* El panel real, en su tamaño real. `pointerEvents="none"` para que
              el toque sea del editor y no de los enlaces internos del panel. */}
          <View pointerEvents="none" style={panel.tamano === "mini" && styles.mitad}>
            <PanelResumen config={panel} vista={vista} />
          </View>

          <Pressable onPress={onAbrir} style={styles.capa} />

          <Pressable
            onPress={onQuitar}
            hitSlop={10}
            style={styles.tacha}
            accessibilityLabel={`Quitar ${def.nombre}`}
          >
            <X size={14} color={colors.pergamino} strokeWidth={3} />
          </Pressable>
        </View>
      </GestureDetector>

      {abierto && (
        <View style={styles.opciones}>
          <Text style={styles.opcionesTitulo}>Tamaño</Text>
          {def.tamanos.map((tamano: Tamano) => (
            <Pressable
              key={tamano}
              onPress={() => onTamano(tamano)}
              style={[styles.opcionFila, panel.tamano === tamano && styles.opcionActiva]}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.opcionTexto, panel.tamano === tamano && styles.opcionTextoActivo]}
                >
                  {ETIQUETA_TAMANO[tamano]}
                </Text>
                <Text
                  style={[
                    styles.opcionDescripcion,
                    panel.tamano === tamano && styles.opcionTextoActivo,
                  ]}
                >
                  {DESCRIPCION_TAMANO[tamano]}
                </Text>
              </View>
              {panel.tamano === tamano && (
                <Check size={16} color={colors.pergamino} strokeWidth={3} />
              )}
            </Pressable>
          ))}

          {/* Las vistas se nombran EN ESTE panel: "con su desglose" no dice
              nada, "día por día" sí. Y solo aparecen las que caben en el
              tamaño elegido — ofrecer una que se degrada sola enseña a
              desconfiar del editor. */}
          {vistasPara(def, panel.tamano).length > 1 && (
            <>
              <Text style={styles.opcionesTitulo}>Qué muestra</Text>
              {vistasPara(def, panel.tamano).map((opcion: Vista) => (
                <Pressable
                  key={opcion}
                  onPress={() => onVista(opcion)}
                  style={[styles.opcionFila, panel.vista === opcion && styles.opcionActiva]}
                >
                  <Text
                    style={[
                      styles.opcionTexto,
                      { flex: 1 },
                      panel.vista === opcion && styles.opcionTextoActivo,
                    ]}
                  >
                    {etiquetaDeVista(def, opcion)}
                  </Text>
                  {panel.vista === opcion && (
                    <Check size={16} color={colors.pergamino} strokeWidth={3} />
                  )}
                </Pressable>
              ))}
            </>
          )}

          {def.tamanos.length === 1 && vistasPara(def, panel.tamano).length === 1 && (
            <Parrafo style={styles.opcionDescripcion}>
              Este panel existe en una sola forma: en otra no enseñaría nada distinto.
            </Parrafo>
          )}
        </View>
      )}

    </Animated.View>
  );
}

/** El botón que abre el editor, para la cabecera del Resumen. */
export function BotonEditar({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.editar} accessibilityLabel="Editar tu resumen">
      <Text style={styles.editarTexto}>Editar</Text>
    </Pressable>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    raiz: { flex: 1, backgroundColor: colors.obsidiana },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
      gap: spacing.md,
    },
    titulo: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    listo: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      backgroundColor: colors.guinda,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderRadius: radius.full,
    },
    listoTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.pergamino },
    barraAcciones: {
      flexDirection: "row",
      gap: spacing.lg,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    accion: { flexDirection: "row", alignItems: "center", gap: 5 },
    accionTexto: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.paloRosa },
    contenido: { padding: spacing.lg, gap: spacing.md },
    ayuda: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
    seccion: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.label,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: colors.paloRosa,
      marginTop: spacing.lg,
    },
    editable: { gap: spacing.sm },
    // Media pantalla se enseña a media pantalla: si en el editor se viera a
    // todo lo ancho, elegir el tamaño sería adivinar.
    mitad: { width: "52%" },
    capa: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
    tacha: {
      position: "absolute",
      top: -8,
      right: -6,
      width: 28,
      height: 28,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.error,
    },
    opciones: {
      padding: spacing.md,
      borderRadius: radius.xl,
      backgroundColor: withAlpha(colors.paloRosa, 0.1),
      gap: spacing.sm,
    },
    opcionesTitulo: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.label,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: colors.paloRosa,
    },
    opcionFila: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    opcionDescripcion: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
    opcionActiva: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
    opcionTexto: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    opcionTextoActivo: { color: colors.pergamino },
    disponibles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    pastilla: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: withAlpha(colors.champan, 0.45),
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    pastillaPresionada: { opacity: 0.7 },
    pastillaTexto: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    editar: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
    editarTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.bodySm, color: colors.champan },
  });
