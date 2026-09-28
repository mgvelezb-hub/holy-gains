import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card } from "@/components/Card";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { NumberStepper } from "@/components/NumberStepper";
import { Parrafo } from "@/components/Parrafo";
import { SectionLabel } from "@/components/SectionLabel";
import { useTheme } from "@/context/theme";
import {
  ApiError,
  deleteBloqueDia,
  getBloquesDelDia,
  postBloqueDia,
  type BloqueAgregado,
  type BloquesDelDiaResponse,
  type Discipline,
} from "@/lib/api";
import { DISCIPLINAS } from "@/lib/entrenamiento";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * "Agregar bloque" — la disciplina que se decide EL DÍA.
 *
 * El modelo de la app cambió aquí: la disciplina base se planea en Ajustes
 * (sesiones por semana, mismo día que pesas o día propio), y todo lo demás se
 * agrega el día que hay tiempo. Nadie sabe en lunes que el jueves le van a
 * sobrar cuarenta minutos para nadar; hacerle prometer sesiones por semana a
 * eso solo llenaba la semana de planes incumplidos.
 *
 * Dos tipos de bloque, y la diferencia importa: `ENTRENO` le pide a Coachy que
 * arme la sesión con esos minutos; `LIBRE` solo reserva el tiempo y deja que
 * el reloj registre lo que pase. Quien sale a jugar por gusto no quiere una
 * prescripción.
 */

/** Fecha de hoy en el teléfono, que es la que ve la persona. */
function hoyISO(): string {
  const ahora = new Date();
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  const dia = String(ahora.getDate()).padStart(2, "0");
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

const TIPOS: Array<{ valor: "ENTRENO" | "LIBRE"; nombre: string; detalle: string }> = [
  {
    valor: "ENTRENO",
    nombre: "Bloque de entrenamiento",
    detalle: "Coachy arma la sesión con los minutos que tengas.",
  },
  {
    valor: "LIBRE",
    nombre: "Bloque libre",
    detalle: "Solo se registra el tiempo y lo que marque tu reloj.",
  },
];

export default function BloqueDelDiaScreen() {
  const { date } = useLocalSearchParams<{ date?: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const fecha = date ?? hoyISO();

  const [datos, setDatos] = useState<BloquesDelDiaResponse | null>(null);
  const [disciplina, setDisciplina] = useState<Discipline | null>(null);
  const [tipo, setTipo] = useState<"ENTRENO" | "LIBRE">("ENTRENO");
  const [minutos, setMinutos] = useState(40);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const cargar = useCallback(() => {
    getBloquesDelDia(fecha)
      .then(setDatos)
      .catch((problema) =>
        setMensaje(problema instanceof ApiError ? problema.message : "No se pudo cargar el día"),
      );
  }, [fecha]);

  useEffect(() => cargar(), [cargar]);

  const puestas = new Set((datos?.bloques ?? []).map((bloque) => bloque.discipline));
  const disponibles = DISCIPLINAS.filter(
    (entrada) => entrada.valor !== datos?.base && !puestas.has(entrada.valor),
  );

  async function agregar() {
    if (!disciplina) return;
    setMensaje(null);
    try {
      const respuesta = await postBloqueDia({ date: fecha, discipline: disciplina, tipo, minutos });
      setDatos((previo) => (previo ? { ...previo, bloques: respuesta.bloques } : previo));
      setDisciplina(null);
      // El aviso de compatibilidad se enseña DESPUÉS de agregar: nunca impide.
      setMensaje(respuesta.aviso ?? "Listo: lo verás en tu día, después de lo de siempre.");
    } catch (problema) {
      setMensaje(problema instanceof ApiError ? problema.message : "No se pudo agregar el bloque");
    }
  }

  async function quitar(bloque: BloqueAgregado) {
    setMensaje(null);
    try {
      const respuesta = await deleteBloqueDia(fecha, bloque.discipline);
      setDatos((previo) => (previo ? { ...previo, bloques: respuesta.bloques } : previo));
    } catch (problema) {
      setMensaje(problema instanceof ApiError ? problema.message : "No se pudo quitar el bloque");
    }
  }

  function nombreDe(discipline: Discipline): string {
    return DISCIPLINAS.find((entrada) => entrada.valor === discipline)?.nombre ?? discipline;
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.backText}>Atrás</Text>
        </Pressable>

        <Text style={styles.title}>Agregar bloque</Text>

        {(datos?.bloques ?? []).length > 0 && (
          <Card>
            <SectionLabel>Ya en este día</SectionLabel>
            <View style={styles.lista}>
              {datos!.bloques.map((bloque) => (
                <View key={bloque.discipline} style={styles.bloqueFila}>
                  <Text style={styles.bloqueNombre}>
                    {nombreDe(bloque.discipline)} · {bloque.minutos} min ·{" "}
                    {bloque.tipo === "ENTRENO" ? "entrenamiento" : "libre"}
                  </Text>
                  <Pressable onPress={() => quitar(bloque)} hitSlop={8}>
                    <X size={18} color={colors.champan} strokeWidth={2} />
                  </Pressable>
                </View>
              ))}
            </View>
          </Card>
        )}

        <Card>
          <View style={styles.sectionHeader}>
            <SectionLabel>Qué vas a hacer</SectionLabel>
            <InfoTip titulo="Qué es un bloque del día">
              <TextoInfo>
                Tu disciplina base ya está en el plan de la semana. Esto es lo demás: lo que
                agregas el día que te sobra tiempo, encima de lo que ya te tocaba.
              </TextoInfo>
            </InfoTip>
          </View>

          <View style={styles.chips}>
            {disponibles.map((entrada) => {
              const activo = disciplina === entrada.valor;
              return (
                <Pressable
                  key={entrada.valor}
                  onPress={() => setDisciplina(entrada.valor)}
                  style={[styles.chip, activo && styles.chipOn]}
                >
                  <Text style={[styles.chipTexto, activo && styles.chipTextoOn]}>
                    {entrada.nombre}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <Card>
          <NumberStepper
            label="Minutos que tienes"
            value={minutos}
            onChange={setMinutos}
            step={5}
            min={5}
            suffix="min"
          />
        </Card>

        <Card>
          <View style={styles.sectionHeader}>
            <SectionLabel>¿Entrenamiento o libre?</SectionLabel>
            <InfoTip titulo="La diferencia">
              <TextoInfo>
                Entrenamiento: Coachy te prescribe la sesión de esa disciplina con los minutos que
                le des — estructura, series y descansos.
              </TextoInfo>
              <TextoInfo>
                Libre: no te arma nada. Solo se registra el tiempo y los datos de tu reloj durante
                ese bloque, igual que cualquier sesión libre.
              </TextoInfo>
            </InfoTip>
          </View>

          <View style={styles.lista}>
            {TIPOS.map((opcion) => {
              const activo = tipo === opcion.valor;
              return (
                <Pressable
                  key={opcion.valor}
                  onPress={() => setTipo(opcion.valor)}
                  style={[styles.fila, activo && styles.filaOn]}
                >
                  <Text style={[styles.filaNombre, activo && styles.filaNombreOn]}>
                    {opcion.nombre}
                  </Text>
                  <Text style={styles.filaDetalle}>{opcion.detalle}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <Pressable
          onPress={agregar}
          disabled={!disciplina}
          style={[styles.boton, !disciplina && styles.botonOff]}
        >
          <Text style={styles.botonTexto}>Agregar al día</Text>
        </Pressable>

        {mensaje && <Parrafo style={styles.mensaje}>{mensaje}</Parrafo>}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.obsidiana },
    content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.huge * 2 },
    back: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      paddingVertical: spacing.sm,
      alignSelf: "flex-start",
    },
    backText: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
    title: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    lista: { gap: spacing.sm, marginTop: spacing.md },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
    chip: {
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingVertical: 6,
      paddingHorizontal: spacing.md,
    },
    chipOn: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
    chipTexto: { fontFamily: fonts.sansMedium, ...typeScale.label, color: colors.marfil },
    chipTextoOn: { color: colors.pergamino },
    bloqueFila: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    bloqueNombre: {
      flex: 1,
      fontFamily: fonts.sansMedium,
      ...typeScale.bodySm,
      color: colors.marfil,
    },
    fila: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    filaOn: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
    filaNombre: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.marfil },
    filaNombreOn: { color: colors.pergamino },
    filaDetalle: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.champan },
    boton: {
      borderRadius: radius.md,
      backgroundColor: colors.guinda,
      paddingVertical: spacing.md,
      alignItems: "center",
    },
    botonOff: { opacity: 0.4 },
    botonTexto: { fontFamily: fonts.sansBold, ...typeScale.body, color: colors.pergamino },
    mensaje: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.champan },
  });
