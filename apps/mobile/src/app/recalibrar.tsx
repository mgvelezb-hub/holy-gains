import { useRouter } from "expo-router";
import { ChevronLeft, Minus, Plus } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card } from "@/components/Card";
import { Parrafo } from "@/components/Parrafo";
import { SectionLabel } from "@/components/SectionLabel";
import { ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import {
  ApiError,
  DISCIPLINE_LABELS,
  getMe,
  postRecalibrar,
  type Discipline,
  type MeResponse,
  type RecalibrarResponse,
} from "@/lib/api";
import { iconoDe } from "@/lib/disciplinas";
import { PROPOSITOS, type Proposito } from "@/lib/replantear";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";

/**
 * Mover el peso entre disciplinas.
 *
 * Es el hermano ligero de rearmar la rutina: ahí se contesta todo de nuevo,
 * aquí solo se mueve cuánto pesa cada una sobre la semana que ya existe. Es lo
 * que se quiere después de dos semanas —"nadar me está gustando, quiero más"—
 * sin volver a declarar horarios ni objetivo.
 *
 * **No se vuelve a preguntar el tiempo.** Subir la importancia de algo no crea
 * días: si el reparto nuevo no cabe en los que hay, la pantalla lo dice en vez
 * de armar una semana imposible.
 */
export default function RecalibrarScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState<RecalibrarResponse | null>(null);

  const [pesos, setPesos] = useState<
    Array<{ discipline: Discipline; proposito: Proposito; importancia: number }>
  >([]);

  const cargar = useCallback(async () => {
    try {
      const perfil = await getMe();
      setMe(perfil);

      const primaria = (perfil.profile?.primaryDiscipline as Discipline) ?? "PESAS";
      const otras = perfil.profile?.otherDisciplines ?? [];

      // Se parte de lo que hay hoy. Si la disciplina ya declaró propósito e
      // importancia (Fase 7, vía la tarjeta de Ajustes) se usan tal cual; si
      // no —un entry viejo, de antes de que existieran esos campos— se
      // derivan de cuántas sesiones lleva, que es mejor que un valor neutro
      // que borraría el reparto actual en cuanto se toque cualquier cosa.
      setPesos([
        { discipline: primaria, proposito: "ENTRENAMIENTO", importancia: 3 },
        ...otras.map((carga) => ({
          discipline: carga.discipline,
          proposito: carga.proposito ?? ("COMPLEMENTO" as Proposito),
          importancia: carga.importancia ?? Math.max(1, Math.min(3, carga.sessionsPerWeek)),
        })),
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar tu perfil");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function mover(discipline: Discipline, delta: number) {
    setPesos((previos) =>
      previos.map((peso) =>
        peso.discipline === discipline
          ? { ...peso, importancia: Math.max(1, Math.min(3, peso.importancia + delta)) }
          : peso,
      ),
    );
  }

  function cambiarProposito(discipline: Discipline, proposito: Proposito) {
    setPesos((previos) =>
      previos.map((peso) => (peso.discipline === discipline ? { ...peso, proposito } : peso)),
    );
  }

  async function aplicar() {
    setGuardando(true);
    setError(null);
    try {
      setResultado(await postRecalibrar(pesos));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo recalibrar tu semana");
    } finally {
      setGuardando(false);
    }
  }

  if (error && !me) return <ErrorState message={error} onRetry={() => void cargar()} />;
  if (!me) return <LoadingState label="Cargando tu semana..." />;

  const primaria = (me.profile?.primaryDiscipline as Discipline) ?? "PESAS";

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.backText}>Atrás</Text>
        </Pressable>

        <Text style={styles.title}>Cuánto pesa cada una</Text>
        <Parrafo style={styles.subtitle}>
          Sobre los días que ya tienes. Subirle a una le quita a otra: el tiempo de tu semana no
          cambia porque lo pidas.
        </Parrafo>

        {pesos.length <= 1 ? (
          <Card>
            <Parrafo style={styles.ayuda}>
              Solo tienes una disciplina activa. Agrega otra en Ajustes y aquí podrás repartir el
              peso entre ellas.
            </Parrafo>
          </Card>
        ) : (
          pesos.map((peso) => {
            const Icono = iconoDe(peso.discipline);
            const esPrimaria = peso.discipline === primaria;

            return (
              <Card key={peso.discipline}>
                <View style={styles.cabeza}>
                  <Icono size={20} color={colors.champan} strokeWidth={2} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.nombre}>{DISCIPLINE_LABELS[peso.discipline]}</Text>
                    {esPrimaria ? (
                      <Text style={styles.etiqueta}>Arma el esqueleto de tu semana</Text>
                    ) : null}
                  </View>
                </View>

                <View style={styles.control}>
                  <Pressable
                    onPress={() => mover(peso.discipline, -1)}
                    disabled={peso.importancia === 1}
                    hitSlop={8}
                    style={[styles.paso, peso.importancia === 1 && styles.pasoOff]}
                  >
                    <Minus size={18} color={colors.marfil} strokeWidth={2.5} />
                  </Pressable>

                  <View style={styles.barras}>
                    {[1, 2, 3].map((nivel) => (
                      <View
                        key={nivel}
                        style={[styles.barra, nivel <= peso.importancia && styles.barraOn]}
                      />
                    ))}
                  </View>

                  <Pressable
                    onPress={() => mover(peso.discipline, 1)}
                    disabled={peso.importancia === 3}
                    hitSlop={8}
                    style={[styles.paso, peso.importancia === 3 && styles.pasoOff]}
                  >
                    <Plus size={18} color={colors.marfil} strokeWidth={2.5} />
                  </Pressable>
                </View>

                {!esPrimaria && (
                  <View style={styles.propositos}>
                    {PROPOSITOS.map((opcion) => (
                      <Pressable
                        key={opcion.valor}
                        onPress={() => cambiarProposito(peso.discipline, opcion.valor)}
                        style={[styles.chip, peso.proposito === opcion.valor && styles.chipOn]}
                      >
                        <Text
                          style={[
                            styles.chipTexto,
                            peso.proposito === opcion.valor && styles.chipTextoOn,
                          ]}
                        >
                          {opcion.nombre}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </Card>
            );
          })
        )}

        {pesos.length > 1 && (
          <Pressable
            onPress={aplicar}
            disabled={guardando}
            style={[styles.boton, guardando && styles.botonOff]}
          >
            <Text style={styles.botonTexto}>
              {guardando ? "Recalibrando..." : "Aplicar a mi semana"}
            </Text>
          </Pressable>
        )}

        {error && <Text style={styles.errorTexto}>{error}</Text>}

        {resultado && (
          <Card>
            <SectionLabel>Cómo queda</SectionLabel>

            {resultado.cambios.map((cambio) => (
              <View key={cambio.discipline} style={styles.cambioFila}>
                <Text style={styles.cambioNombre}>{DISCIPLINE_LABELS[cambio.discipline]}</Text>
                <Text style={styles.cambioValor}>
                  {cambio.antes} → {cambio.ahora}
                  {cambio.antes === cambio.ahora ? " (igual)" : ""}
                </Text>
              </View>
            ))}

            {resultado.avisos.map((aviso) => (
              <Parrafo key={aviso} style={styles.aviso}>
                {aviso}
              </Parrafo>
            ))}

            <Pressable onPress={() => router.replace("/rutinas")} style={styles.boton}>
              <Text style={styles.botonTexto}>Ver mis rutinas</Text>
            </Pressable>
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.obsidiana },
    content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.huge },
    back: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: spacing.sm },
    backText: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
    title: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    subtitle: { fontFamily: fonts.sans, ...typeScale.body, color: colors.paloRosa },
    ayuda: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
    cabeza: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    nombre: { fontFamily: fonts.sansSemiBold, ...typeScale.subheading, color: colors.marfil },
    etiqueta: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
    control: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      marginTop: spacing.md,
    },
    paso: {
      width: 40,
      height: 40,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: withAlpha(colors.paloRosa, 0.14),
    },
    pasoOff: { opacity: 0.35 },
    barras: { flex: 1, flexDirection: "row", gap: 6 },
    barra: {
      flex: 1,
      height: 10,
      borderRadius: radius.full,
      backgroundColor: withAlpha(colors.paloRosa, 0.15),
    },
    barraOn: { backgroundColor: colors.champan },
    propositos: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
    chip: {
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    chipOn: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
    chipTexto: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    chipTextoOn: { color: colors.pergamino },
    boton: {
      marginTop: spacing.lg,
      paddingVertical: spacing.lg,
      borderRadius: radius.full,
      backgroundColor: colors.guinda,
      borderWidth: 1,
      borderColor: colors.guindaLight,
      alignItems: "center",
    },
    botonOff: { opacity: 0.5 },
    botonTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.pergamino },
    errorTexto: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.error },
    cambioFila: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    cambioNombre: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.marfil },
    cambioValor: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.bodySm,
      color: colors.champan,
      fontVariant: ["tabular-nums"],
    },
    aviso: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.champan,
      marginTop: spacing.md,
      backgroundColor: withAlpha(colors.champan, 0.1),
      borderRadius: radius.md,
      padding: spacing.md,
    },
  });
