import { useLocalSearchParams, useRouter } from "expo-router";
import { Check, ChevronLeft } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card } from "@/components/Card";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { Parrafo } from "@/components/Parrafo";
import { SectionLabel } from "@/components/SectionLabel";
import { ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import {
  ApiError,
  DISCIPLINE_LABELS,
  getMe,
  postReplan,
  type Discipline,
  type MeResponse,
  type ReplanResponse,
} from "@/lib/api";
import { iconoDe } from "@/lib/disciplinas";
import {
  DIAS_SEMANA,
  PROPOSITOS,
  RANGOS_EDAD,
  TIEMPOS_DIA,
  type Proposito,
  type WeekDay,
} from "@/lib/replantear";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";

/**
 * Rearmar la rutina desde cero.
 *
 * Cuatro preguntas y un resultado. El orden no es casual: primero lo que no se
 * negocia —cuánto tiempo hay cada día—, después lo que sí —qué disciplina
 * manda y qué acompaña—. Al revés, la persona elige tres disciplinas y luego
 * descubre que no caben, que es exactamente la conversación que este flujo
 * existe para evitar.
 *
 * El tiempo se pregunta en frases y no en minutos, por lo mismo que en el
 * recorte de la sesión: nadie sabe si le quedan 25 o 40 minutos, pero todo el
 * mundo sabe si un martes trae prisa.
 */
export default function ReplantearScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [rangoEdad, setRangoEdad] = useState<string | null>(null);
  const [tiempo, setTiempo] = useState<Record<WeekDay, number>>(() =>
    Object.fromEntries(DIAS_SEMANA.map((dia) => [dia.valor, 0])) as Record<WeekDay, number>,
  );
  const [primaria, setPrimaria] = useState<Discipline>("PESAS");
  const [sesionesPrimaria, setSesionesPrimaria] = useState(3);
  const [secundarias, setSecundarias] = useState<
    Array<{ discipline: Discipline; proposito: Proposito; importancia: number }>
  >([]);

  const [resultado, setResultado] = useState<ReplanResponse | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const perfil = await getMe();
      setMe(perfil);
      setPrimaria((perfil.profile?.primaryDiscipline as Discipline) ?? "PESAS");

      // El tiempo por día declarado en Ajustes (Fase 7) prellena este paso en
      // vez de arrancar todo en cero: si ya se declaró una vez, repetirlo a
      // mano cada vez que se rearma la rutina es el trabajo que este flujo
      // debería evitar.
      const declarado = perfil.profile?.timePerDay;
      if (declarado) {
        setTiempo(
          Object.fromEntries(
            DIAS_SEMANA.map((dia) => [dia.valor, declarado[dia.valor] ?? 0]),
          ) as Record<WeekDay, number>,
        );
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar tu perfil");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /** El mismo tiempo para todos los días: el atajo que casi todos usan. */
  function parejo(minutos: number) {
    setTiempo(
      Object.fromEntries(DIAS_SEMANA.map((dia) => [dia.valor, minutos])) as Record<WeekDay, number>,
    );
  }

  function alternarSecundaria(discipline: Discipline) {
    setSecundarias((previas) =>
      previas.some((entrada) => entrada.discipline === discipline)
        ? previas.filter((entrada) => entrada.discipline !== discipline)
        : [...previas, { discipline, proposito: "COMPLEMENTO" as Proposito, importancia: 2 }],
    );
  }

  function cambiarProposito(discipline: Discipline, proposito: Proposito) {
    setSecundarias((previas) =>
      previas.map((entrada) =>
        entrada.discipline === discipline ? { ...entrada, proposito } : entrada,
      ),
    );
  }

  async function calcular() {
    setGuardando(true);
    setError(null);
    try {
      setResultado(
        await postReplan({
          tiempo,
          primaria,
          sesionesPrimaria,
          secundarias,
          ageRange: rangoEdad,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo armar tu semana");
    } finally {
      setGuardando(false);
    }
  }

  if (error && !me) return <ErrorState message={error} onRetry={() => void cargar()} />;
  if (!me) return <LoadingState label="Cargando tu perfil..." />;

  const pideEdad = !me.profile?.heightCm ? false : me.profile?.ageRange === undefined;
  const totalMinutos = DIAS_SEMANA.reduce((suma, dia) => suma + (tiempo[dia.valor] ?? 0), 0);

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.backText}>Atrás</Text>
        </Pressable>

        <Text style={styles.title}>Rearmar tu rutina</Text>
        <Parrafo style={styles.subtitle}>
          Cuatro preguntas y tu semana queda de nuevo. Lo que ya entrenaste no se toca.
        </Parrafo>

        {pideEdad && (
          <Card>
            <View style={styles.sectionHeader}>
              <SectionLabel>Tu edad</SectionLabel>
              <InfoTip titulo="Por qué se pregunta">
                <TextoInfo>
                  El gasto de tu cuerpo cambia con la edad. Sin este dato la app supone 30 años,
                  que es suponer.
                </TextoInfo>
              </InfoTip>
            </View>
            <View style={styles.chips}>
              {RANGOS_EDAD.map((rango) => (
                <Pressable
                  key={rango.valor}
                  onPress={() => setRangoEdad(rango.valor)}
                  style={[styles.chip, rangoEdad === rango.valor && styles.chipOn]}
                >
                  <Text
                    style={[styles.chipTexto, rangoEdad === rango.valor && styles.chipTextoOn]}
                  >
                    {rango.nombre}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Card>
        )}

        <Card>
          <View style={styles.sectionHeader}>
            <SectionLabel>Cuánto tiempo tienes cada día</SectionLabel>
            <InfoTip titulo="Por qué en frases">
              <TextoInfo>
                En frases, no en minutos: nadie sabe si le quedan 25 o 40, pero todo el mundo sabe
                si un martes trae prisa.
              </TextoInfo>
            </InfoTip>
          </View>

          <Text style={styles.subLabel}>Todos los días igual</Text>
          <View style={styles.chips}>
            {TIEMPOS_DIA.map((opcion) => (
              <Pressable
                key={opcion.nombre}
                onPress={() => parejo(opcion.minutos)}
                style={styles.chip}
              >
                <Text style={styles.chipTexto}>{opcion.nombre}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.subLabel}>O día por día</Text>
          {DIAS_SEMANA.map((dia) => (
            <View key={dia.valor} style={styles.diaFila}>
              <Text style={styles.diaNombre}>{dia.nombre}</Text>
              <View style={styles.diaOpciones}>
                {TIEMPOS_DIA.map((opcion) => {
                  const activo = (tiempo[dia.valor] ?? 0) === opcion.minutos;
                  return (
                    <Pressable
                      key={opcion.nombre}
                      onPress={() =>
                        setTiempo((previo) => ({ ...previo, [dia.valor]: opcion.minutos }))
                      }
                      style={[styles.diaChip, activo && styles.chipOn]}
                    >
                      <Text style={[styles.diaChipTexto, activo && styles.chipTextoOn]}>
                        {opcion.corto}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </Card>

        <Card>
          <View style={styles.sectionHeader}>
            <SectionLabel>Qué disciplina manda</SectionLabel>
            <InfoTip titulo="Qué hace la primaria">
              <TextoInfo>
                La primaria arma el esqueleto de tu semana y se lleva los días con más tiempo. Las
                demás caen alrededor.
              </TextoInfo>
            </InfoTip>
          </View>

          <View style={styles.chips}>
            {(Object.keys(DISCIPLINE_LABELS) as Discipline[])
              .filter((disciplina) => disciplina !== "OTRO")
              .map((disciplina) => {
                const Icono = iconoDe(disciplina);
                const activo = primaria === disciplina;
                return (
                  <Pressable
                    key={disciplina}
                    onPress={() => setPrimaria(disciplina)}
                    style={[styles.chip, activo && styles.chipOn]}
                  >
                    <Icono
                      size={16}
                      color={activo ? colors.pergamino : colors.paloRosa}
                      strokeWidth={2}
                    />
                    <Text style={[styles.chipTexto, activo && styles.chipTextoOn]}>
                      {DISCIPLINE_LABELS[disciplina]}
                    </Text>
                  </Pressable>
                );
              })}
          </View>

          <Text style={styles.subLabel}>Cuántas veces por semana</Text>
          <View style={styles.chips}>
            {[2, 3, 4, 5, 6].map((cuantas) => (
              <Pressable
                key={cuantas}
                onPress={() => setSesionesPrimaria(cuantas)}
                style={[styles.chip, sesionesPrimaria === cuantas && styles.chipOn]}
              >
                <Text
                  style={[styles.chipTexto, sesionesPrimaria === cuantas && styles.chipTextoOn]}
                >
                  {cuantas}
                </Text>
              </Pressable>
            ))}
          </View>
        </Card>

        <Card>
          <View style={styles.sectionHeader}>
            <SectionLabel>Qué más entrenas</SectionLabel>
            <InfoTip titulo="Y para qué">
              <TextoInfo>
                Lo que entrenas en serio pide sesiones completas; un pasatiempo pide un hueco, no
                un plan.
              </TextoInfo>
            </InfoTip>
          </View>

          {(Object.keys(DISCIPLINE_LABELS) as Discipline[])
            .filter((disciplina) => disciplina !== primaria && disciplina !== "OTRO")
            .map((disciplina) => {
              const elegida = secundarias.find((entrada) => entrada.discipline === disciplina);
              const Icono = iconoDe(disciplina);

              return (
                <View key={disciplina} style={styles.secundaria}>
                  <Pressable
                    onPress={() => alternarSecundaria(disciplina)}
                    style={styles.secundariaCabeza}
                  >
                    <Icono
                      size={18}
                      color={elegida ? colors.champan : colors.paloRosa}
                      strokeWidth={2}
                    />
                    <Text style={styles.secundariaNombre}>{DISCIPLINE_LABELS[disciplina]}</Text>
                    {elegida ? <Check size={16} color={colors.champan} strokeWidth={3} /> : null}
                  </Pressable>

                  {elegida && (
                    <View style={styles.chips}>
                      {PROPOSITOS.map((opcion) => (
                        <Pressable
                          key={opcion.valor}
                          onPress={() => cambiarProposito(disciplina, opcion.valor)}
                          style={[styles.chip, elegida.proposito === opcion.valor && styles.chipOn]}
                        >
                          <Text
                            style={[
                              styles.chipTexto,
                              elegida.proposito === opcion.valor && styles.chipTextoOn,
                            ]}
                          >
                            {opcion.nombre}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
        </Card>

        <Pressable
          onPress={calcular}
          disabled={guardando || totalMinutos === 0}
          style={[styles.boton, (guardando || totalMinutos === 0) && styles.botonOff]}
        >
          <Text style={styles.botonTexto}>
            {guardando ? "Armando..." : resultado ? "Volver a armar" : "Armar mi semana"}
          </Text>
        </Pressable>

        {totalMinutos === 0 && (
          <Text style={styles.ayuda}>Elige cuánto tiempo tienes antes de armar la semana.</Text>
        )}

        {error && <Text style={styles.errorTexto}>{error}</Text>}

        {resultado && <Resultado resultado={resultado} onVer={() => router.replace("/rutinas")} />}
      </ScrollView>
    </SafeAreaView>
  );
}

/** La semana que salió, con lo que no cupo dicho en voz alta. */
function Resultado({
  resultado,
  onVer,
}: {
  resultado: ReplanResponse;
  onVer: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Card>
      <View style={styles.sectionHeader}>
        <SectionLabel>Tu semana</SectionLabel>
        <InfoTip titulo="Qué más se mueve con esto">
          <TextoInfo>
            Tu alimentación y tu camino al objetivo se recalculan con esta semana en tu siguiente
            check-in: los dos dependen de cuánto entrenas.
          </TextoInfo>
        </InfoTip>
      </View>

      {resultado.asignadas.length === 0 ? (
        <Text style={styles.ayuda}>No se pudo armar ninguna sesión con ese tiempo.</Text>
      ) : (
        resultado.asignadas.map((sesion) => {
          const Icono = iconoDe(sesion.discipline);
          return (
            <View key={`${sesion.weekday}-${sesion.discipline}`} style={styles.resultadoFila}>
              <Text style={styles.resultadoDia}>{sesion.weekday}</Text>
              <Icono size={18} color={colors.champan} strokeWidth={2} />
              <Text style={styles.resultadoNombre}>{DISCIPLINE_LABELS[sesion.discipline]}</Text>
              <Text style={styles.resultadoMin}>{sesion.minutos} min</Text>
            </View>
          );
        })
      )}

      {/* Lo que no cupo se dice: un plan que recorta en silencio hace pensar
          que la app se equivocó. */}
      {resultado.avisos.map((aviso) => (
        <Parrafo key={aviso} style={styles.aviso}>
          {aviso}
        </Parrafo>
      ))}

      <Pressable onPress={onVer} style={styles.boton}>
        <Text style={styles.botonTexto}>Ver mis rutinas</Text>
      </Pressable>
    </Card>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.obsidiana },
    content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.huge },
    sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    back: { flexDirection: "row", alignItems: "center", gap: 2, paddingVertical: spacing.sm },
    backText: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
    title: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    subtitle: { fontFamily: fonts.sans, ...typeScale.body, color: colors.paloRosa },
    ayuda: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.paloRosa,
      marginTop: spacing.sm,
    },
    subLabel: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.label,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: colors.paloRosa,
      marginTop: spacing.lg,
      marginBottom: spacing.xs,
    },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    chipOn: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
    chipTexto: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    chipTextoOn: { color: colors.pergamino },
    diaFila: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    diaNombre: { width: 40, fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    diaOpciones: { flexDirection: "row", gap: 6, flex: 1 },
    diaChip: {
      flex: 1,
      alignItems: "center",
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingVertical: 6,
    },
    diaChipTexto: { fontFamily: fonts.sansMedium, ...typeScale.label, color: colors.marfil },
    secundaria: { marginTop: spacing.md, gap: spacing.xs },
    secundariaCabeza: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    secundariaNombre: {
      flex: 1,
      fontFamily: fonts.sansSemiBold,
      ...typeScale.body,
      color: colors.marfil,
    },
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
    resultadoFila: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.cardBorder,
    },
    resultadoDia: { width: 42, fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.paloRosa },
    resultadoNombre: { flex: 1, fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.marfil },
    resultadoMin: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.bodySm,
      color: colors.champan,
      fontVariant: ["tabular-nums"],
    },
    aviso: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.champan,
      marginTop: spacing.sm,
      backgroundColor: withAlpha(colors.champan, 0.1),
      borderRadius: radius.md,
      padding: spacing.md,
    },
  });
