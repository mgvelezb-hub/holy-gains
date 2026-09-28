import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card } from "@/components/Card";
import { ChartBoundary } from "@/components/ChartBoundary";
import { LineChart, type Punto } from "@/components/LineChart";
import { Parrafo } from "@/components/Parrafo";
import { SectionLabel } from "@/components/SectionLabel";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import { ApiError, getLabs, postLab, type LabResult } from "@/lib/api";
import { CAMPOS_INBODY, CAMPOS_QUIMICA, seriesDe } from "@/lib/laboratorios";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";

/**
 * Tus estudios: InBody y química sanguínea.
 *
 * La regla de esta pantalla, dicha en voz alta y respetada por el código:
 * **se guardan y se grafican; no se interpretan.** No hay semáforos propios ni
 * rangos del producto. Si tu laboratorio imprimió su rango, se captura y se
 * dice qué cayó fuera —que es leer el documento, no opinar sobre él— y ahí la
 * app se detiene.
 *
 * La única lectura que sí hace es aritmética: si un InBody se contradice a sí
 * mismo, se marca, porque un reporte que no cuadra no puede alimentar tu
 * perfil.
 */

/** "2026-03-02" → "2 de marzo de 2026". Se lee, no se teclea. */
function fechaLarga(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(year, month - 1, day));
  return fecha.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Un día antes o después, sin cruzar de mes a la brava. */
function desplazarISO(iso: string, dias: number): string {
  const [year, month, day] = iso.split("-").map(Number) as [number, number, number];
  const fecha = new Date(Date.UTC(year, month - 1, day));
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/** Texto a número, con vacío como `null`: un rango no capturado no es cero. */
function numeroONull(texto: string | undefined): number | null {
  const limpio = (texto ?? "").trim().replace(",", ".");
  if (limpio === "") return null;
  const valor = Number(limpio);
  return Number.isFinite(valor) ? valor : null;
}

function hoyISO(): string {
  const now = new Date();
  const mes = String(now.getMonth() + 1).padStart(2, "0");
  const dia = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mes}-${dia}`;
}

export default function LaboratoriosScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [labs, setLabs] = useState<LabResult[] | null>(null);
  const [disclaimer, setDisclaimer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [tipo, setTipo] = useState<"INBODY" | "QUIMICA">("INBODY");
  const [fecha, setFecha] = useState(hoyISO());
  const [valores, setValores] = useState<Record<string, string>>({});
  const [rangos, setRangos] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const campos = tipo === "INBODY" ? CAMPOS_INBODY : CAMPOS_QUIMICA;

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await getLabs();
      setLabs(response.labs);
      setDisclaimer(response.disclaimer);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar tus estudios");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function guardar() {
    setGuardando(true);
    setMensaje(null);
    try {
      const values = campos
        .map((campo) => ({ campo, raw: valores[campo.key]?.trim() ?? "" }))
        .filter((entry) => entry.raw !== "")
        .map((entry) => ({
          key: entry.campo.key,
          label: entry.campo.label,
          value: Number(entry.raw.replace(",", ".")),
          unit: entry.campo.unit,
          refLow: numeroONull(rangos[`${entry.campo.key}_low`]),
          refHigh: numeroONull(rangos[`${entry.campo.key}_high`]),
        }))
        .filter((value) => Number.isFinite(value.value));

      if (values.length === 0) {
        setMensaje("Escribe al menos un valor del estudio.");
        return;
      }

      const { lab } = await postLab({ kind: tipo, takenOn: fecha, values });
      setValores({});
      setRangos({});
      setMensaje(
        lab.coherence.coherent
          ? "Guardado. Queda en tu historial y en la gráfica."
          : "Guardado, pero revisa los números: el reporte no cuadra consigo mismo.",
      );
      await load();
    } catch (err) {
      setMensaje(err instanceof ApiError ? err.message : "No se pudo guardar tu estudio");
    } finally {
      setGuardando(false);
    }
  }

  if (error && labs === null) return <ErrorState message={error} onRetry={() => void load()} />;
  if (labs === null) return <LoadingState label="Cargando tus estudios..." />;

  const delTipo = labs.filter((lab) => lab.kind === tipo);
  const parametros = [...new Set(delTipo.flatMap((lab) => lab.values.map((value) => value.key)))];

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
            tintColor={colors.paloRosa}
          />
        }
      >
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.backText}>Atrás</Text>
        </Pressable>

        <Text style={styles.title}>Tus estudios</Text>
        <Text style={styles.disclaimer}>{disclaimer}</Text>

        <View style={styles.tipoRow}>
          {(["INBODY", "QUIMICA"] as const).map((valor) => (
            <Pressable
              key={valor}
              onPress={() => setTipo(valor)}
              style={[styles.tipoChip, tipo === valor && styles.tipoChipOn]}
            >
              <Text style={[styles.tipoChipText, tipo === valor && styles.tipoChipTextOn]}>
                {valor === "INBODY" ? "Bioimpedancia" : "Química sanguínea"}
              </Text>
            </Pressable>
          ))}
        </View>

        {parametros.length > 0 && (
          <Card>
            <SectionLabel>Cómo van</SectionLabel>
            {parametros.map((key) => {
              const campo = campos.find((entry) => entry.key === key);
              const puntos: Punto[] = seriesDe(delTipo, key);
              return (
                <View key={key} style={styles.serie}>
                  <Text style={styles.serieTitulo}>
                    {campo?.label ?? key}
                    {campo?.unit ? ` · ${campo.unit}` : ""}
                  </Text>
                  <ChartBoundary>
                    <LineChart points={puntos} color={colors.champan} height={120} />
                  </ChartBoundary>
                </View>
              );
            })}
          </Card>
        )}

        <Card>
          <SectionLabel>Cargar un estudio</SectionLabel>
          <Parrafo style={styles.ayuda}>
            Escribe los valores tal como vienen en tu reporte. Los que dejes vacíos no se guardan.
          </Parrafo>

          <Text style={styles.campoLabel}>Fecha del estudio</Text>
          <View style={styles.fechaFila}>
            <Pressable onPress={() => setFecha(desplazarISO(fecha, -1))} hitSlop={8} style={styles.fechaBoton}>
              <Text style={styles.fechaBotonTexto}>−1 día</Text>
            </Pressable>
            <Text style={styles.fechaValor}>{fechaLarga(fecha)}</Text>
            <Pressable onPress={() => setFecha(desplazarISO(fecha, 1))} hitSlop={8} style={styles.fechaBoton}>
              <Text style={styles.fechaBotonTexto}>+1 día</Text>
            </Pressable>
          </View>
          <Pressable onPress={() => setFecha(hoyISO())} hitSlop={8}>
            <Text style={styles.fechaHoy}>Hoy</Text>
          </Pressable>

          {campos.map((campo) => (
            <View key={campo.key}>
              <Text style={styles.campoLabel}>
                {campo.label} {campo.unit ? `(${campo.unit})` : ""}
              </Text>
              <TextInput
                value={valores[campo.key] ?? ""}
                onChangeText={(text) => setValores((prev) => ({ ...prev, [campo.key]: text }))}
                keyboardType="decimal-pad"
                placeholder={campo.placeholder}
                placeholderTextColor={colors.paloRosaLight}
                style={styles.input}
              />

              {/* El rango es el que imprimió TU laboratorio. Sin él nadie
                  opina sobre el número, y por eso se puede capturar: sin esta
                  fila, la mitad útil de la pantalla estaba apagada. */}
              {(valores[campo.key] ?? "") !== "" && (
                <View style={styles.rangoFila}>
                  <TextInput
                    value={rangos[`${campo.key}_low`] ?? ""}
                    onChangeText={(text) =>
                      setRangos((prev) => ({ ...prev, [`${campo.key}_low`]: text }))
                    }
                    keyboardType="decimal-pad"
                    placeholder="ref. mín."
                    placeholderTextColor={colors.paloRosaLight}
                    style={[styles.input, styles.rangoInput]}
                  />
                  <TextInput
                    value={rangos[`${campo.key}_high`] ?? ""}
                    onChangeText={(text) =>
                      setRangos((prev) => ({ ...prev, [`${campo.key}_high`]: text }))
                    }
                    keyboardType="decimal-pad"
                    placeholder="ref. máx."
                    placeholderTextColor={colors.paloRosaLight}
                    style={[styles.input, styles.rangoInput]}
                  />
                </View>
              )}
            </View>
          ))}

          <Pressable
            onPress={guardar}
            disabled={guardando}
            style={[styles.boton, guardando && styles.botonOff]}
          >
            <Text style={styles.botonText}>{guardando ? "Guardando..." : "Guardar estudio"}</Text>
          </Pressable>

          {mensaje && <Parrafo style={styles.mensaje}>{mensaje}</Parrafo>}
        </Card>

        {delTipo.length === 0 ? (
          <EmptyState message="Todavía no cargas estudios. Cuando subas el primero, aquí queda su historial y su gráfica." />
        ) : (
          delTipo.map((lab) => (
            <Card key={lab.id}>
              <SectionLabel>{lab.takenOn}</SectionLabel>

              {!lab.coherence.coherent && lab.coherence.reason && (
                <Parrafo style={styles.alerta}>{lab.coherence.reason}</Parrafo>
              )}

              {lab.values.map((value) => {
                const fuera = lab.outsideRange.includes(value.key);
                return (
                  <View key={value.key} style={styles.fila}>
                    <Text style={styles.filaLabel}>{value.label}</Text>
                    <Text style={[styles.filaValor, fuera && styles.filaValorFuera]}>
                      {value.value} {value.unit}
                      {value.refLow !== null && value.refHigh !== null
                        ? `  (ref. ${value.refLow}–${value.refHigh})`
                        : ""}
                    </Text>
                  </View>
                );
              })}

              {lab.outsideRange.length > 0 && (
                <Parrafo style={styles.alerta}>
                  Hay {lab.outsideRange.length}{" "}
                  {lab.outsideRange.length === 1 ? "valor" : "valores"} fuera del rango que
                  imprimió tu laboratorio. No lo interpretamos: eso lo revisa un médico.
                </Parrafo>
              )}
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.obsidiana },
    content: { padding: spacing.lg, paddingBottom: spacing.huge, gap: spacing.lg },
    back: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: spacing.sm },
    backText: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
    title: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    disclaimer: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosaLight },
    tipoRow: { flexDirection: "row", gap: spacing.sm },
    tipoChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
    },
    tipoChipOn: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
    tipoChipText: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    tipoChipTextOn: { color: colors.pergamino },
    serie: { gap: spacing.xs, marginTop: spacing.md },
    serieTitulo: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.marfil },
    ayuda: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.paloRosaLight,
      marginTop: spacing.sm,
    },
    campoLabel: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.label,
      letterSpacing: 1,
      color: colors.paloRosa,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    input: {
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      fontFamily: fonts.sansMedium,
      ...typeScale.body,
      color: colors.marfil,
    },
    fechaFila: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    fechaBoton: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    fechaBotonTexto: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    fechaValor: {
      flex: 1,

      fontFamily: fonts.sansSemiBold,
      ...typeScale.body,
      color: colors.marfil,
    },
    fechaHoy: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.bodySm,
      color: colors.champan,
      marginTop: spacing.xs,
    },
    rangoFila: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
    rangoInput: { flex: 1, ...typeScale.bodySm },
    boton: {
      marginTop: spacing.lg,
      paddingVertical: spacing.md,
      borderRadius: radius.full,
      backgroundColor: colors.guinda,
      borderWidth: 1,
      borderColor: colors.guindaLight,
      alignItems: "center",
    },
    botonOff: { opacity: 0.5 },
    botonText: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.pergamino },
    mensaje: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.champan,
      marginTop: spacing.md,
    },
    fila: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.xs,
    },
    filaLabel: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil, flex: 1 },
    filaValor: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
    filaValorFuera: { color: colors.champan, fontFamily: fonts.sansSemiBold },
    alerta: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.champan,
      marginTop: spacing.md,
      backgroundColor: withAlpha(colors.champan, 0.1),
      borderRadius: radius.md,
      padding: spacing.md,
    },
  });
