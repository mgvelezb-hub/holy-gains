import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SectionLabel } from "@/components/SectionLabel";
import { ErrorState, LoadingState } from "@/components/States";
import {
  Aviso,
  BotonSecundario,
  Campo,
  Hoja,
  ListaRenglones,
} from "@/components/suplementos/HojaSuplementos";
import { useTheme } from "@/context/theme";
import {
  ApiError,
  getSuplementos,
  postEleccionSuplemento,
  postInfusiones,
  type EleccionSuplemento,
  type FichaSuplemento,
  type SuplementosResponse,
} from "@/lib/api";
import { buscaEnCatalogo, lineaToma, motivoCorto } from "@/lib/suplementos";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * Ajustes → Suplementos.
 *
 * Tres listas de una línea —Tomas, Sugerencias y Tés e infusiones— y un
 * buscador para agregar del catálogo. Cada renglón abre su hoja: la toma con
 * su porqué, evidencia y tope; la sugerencia con motivo, qué cambiaría y los
 * tres botones. La app sugiere solo con una señal de los datos; lo que no se
 * acepta no entra.
 *
 * `?s=MAGNESIO` abre directo la hoja de esa sugerencia (viene de la
 * decisión).
 */

type HojaAbierta =
  | { tipo: "toma"; id: string }
  | { tipo: "sugerencia"; id: string }
  | { tipo: "ficha"; id: string }
  | null;

export default function SuplementosScreen() {
  const router = useRouter();
  const { s } = useLocalSearchParams<{ s?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [data, setData] = useState<SuplementosResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoja, setHoja] = useState<HojaAbierta>(null);
  const [busqueda, setBusqueda] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const respuesta = await getSuplementos();
      setData(respuesta);
      setError(null);
      return respuesta;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudieron cargar tus suplementos");
      return null;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void cargar().then((respuesta) => {
        if (s && respuesta?.sugerencias.some((sug) => sug.supplement === s)) {
          setHoja({ tipo: "sugerencia", id: s });
        }
      });
    }, [cargar, s]),
  );

  async function elegir(id: string, eleccion: EleccionSuplemento) {
    setGuardando(true);
    setMsg(null);
    try {
      await postEleccionSuplemento(id, eleccion);
      setHoja(null);
      await cargar();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function alternarInfusiones(valor: boolean) {
    if (!data) return;
    setData({ ...data, quiereInfusiones: valor });
    try {
      await postInfusiones(valor);
      await cargar();
    } catch {
      setData({ ...data });
    }
  }

  if (!data && !error) return <LoadingState label="Cargando tus suplementos..." />;
  if (!data && error) return <ErrorState message={error} onRetry={() => void cargar()} />;
  if (!data) return null;

  const ficha = (id: string): FichaSuplemento | undefined => data.catalogo.find((f) => f.id === id);
  const tomasSup = data.tomas.filter((t) => t.categoria === "SUPLEMENTO");
  const tomasInf = data.tomas.filter((t) => t.categoria === "INFUSION");
  const sugSup = data.sugerencias.filter((x) => x.categoria === "SUPLEMENTO");
  const sugInf = data.sugerencias.filter((x) => x.categoria === "INFUSION");
  const resultados = buscaEnCatalogo(
    data.catalogo,
    busqueda,
    data.tomas.map((t) => t.supplement),
  );

  const tomaAbierta = hoja?.tipo === "toma" ? data.tomas.find((t) => t.supplement === hoja.id) : undefined;
  const sugAbierta =
    hoja?.tipo === "sugerencia" ? data.sugerencias.find((x) => x.supplement === hoja.id) : undefined;
  const fichaAbierta = hoja ? ficha(hoja.id) : undefined;

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.backText}>Atrás</Text>
        </Pressable>
        <Text style={styles.title}>Suplementos</Text>

        <Aviso texto={data.freno} />

        <View style={styles.header}>
          <SectionLabel>Tomas</SectionLabel>
          <InfoTip titulo="Tomas">
            <TextoInfo>
              Lo que tomas, amarrado a una comida para que no se olvide. Toca uno para ver su porqué,
              la evidencia y el tope del día.
            </TextoInfo>
          </InfoTip>
        </View>
        {tomasSup.length === 0 ? (
          <Text style={styles.vacio}>Ninguno todavía.</Text>
        ) : (
          <ListaRenglones
            renglones={tomasSup.map((t) => ({ id: t.supplement, titulo: t.nombre, detalle: lineaToma(t) }))}
            onPress={(id) => setHoja({ tipo: "toma", id })}
          />
        )}

        {!data.freno && (
          <>
            <View style={styles.header}>
              <SectionLabel>Sugerencias</SectionLabel>
              <InfoTip titulo="Sugerencias">
                <TextoInfo>
                  Salen de una señal de tus datos —un estudio, tu check-in, tu reloj— y nunca son más
                  de tres. Lo que descartes no vuelve en 90 días.
                </TextoInfo>
                {data.notas.map((nota) => (
                  <TextoInfo key={nota}>{nota}</TextoInfo>
                ))}
              </InfoTip>
            </View>
            {sugSup.length === 0 ? (
              <Text style={styles.vacio}>Nada que sugerir con tus datos de hoy.</Text>
            ) : (
              <ListaRenglones
                renglones={sugSup.map((x) => ({
                  id: x.supplement,
                  titulo: x.nombre,
                  detalle: motivoCorto(x.motivo),
                }))}
                onPress={(id) => setHoja({ tipo: "sugerencia", id })}
              />
            )}
          </>
        )}

        <View style={styles.header}>
          <SectionLabel>Tés e infusiones</SectionLabel>
          <Switch value={data.quiereInfusiones} onValueChange={(v) => void alternarInfusiones(v)} />
        </View>
        <ListaRenglones
          renglones={[
            ...tomasInf.map((t) => ({ id: `t:${t.supplement}`, titulo: t.nombre, detalle: lineaToma(t) })),
            ...(data.freno || !data.quiereInfusiones
              ? []
              : sugInf.map((x) => ({ id: `s:${x.supplement}`, titulo: x.nombre, detalle: `Sugerida · ${motivoCorto(x.motivo)}` }))),
          ]}
          onPress={(id) => setHoja({ tipo: id.startsWith("t:") ? "toma" : "sugerencia", id: id.slice(2) })}
        />
        {tomasInf.length === 0 && (sugInf.length === 0 || !data.quiereInfusiones) && (
          <Text style={styles.vacio}>
            {data.quiereInfusiones ? "Ninguna por ahora." : "Apagadas: la app no sugiere infusiones."}
          </Text>
        )}

        <SectionLabel>Agregar</SectionLabel>
        <TextInput
          value={busqueda}
          onChangeText={setBusqueda}
          placeholder="Busca: magnesio, manzanilla…"
          placeholderTextColor={colors.paloRosaLight}
          style={styles.input}
        />
        <ListaRenglones
          renglones={resultados.map((f) => ({ id: f.id, titulo: f.nombre, detalle: `${f.dosisTexto} · ${f.momento}` }))}
          onPress={(id) => setHoja({ tipo: "ficha", id })}
        />
      </ScrollView>

      <Hoja
        visible={hoja !== null}
        titulo={fichaAbierta?.nombre ?? ""}
        onClose={() => {
          setHoja(null);
          setMsg(null);
        }}
      >
        {hoja?.tipo === "toma" && tomaAbierta && (
          <>
            <Campo etiqueta="Cuánto y cuándo" texto={lineaToma(tomaAbierta)} />
            <Campo etiqueta="Preparación" texto={fichaAbierta?.preparacion} />
            <Campo etiqueta="Por qué" texto={fichaAbierta?.porque} />
            <Campo etiqueta="Evidencia" texto={fichaAbierta?.evidencia} />
            <Campo etiqueta="Tope" texto={fichaAbierta?.tope} />
            <Aviso texto={fichaAbierta?.aviso} />
            <BotonSecundario
              label="Quitar de mis tomas"
              disabled={guardando}
              onPress={() => void elegir(tomaAbierta.supplement, "no_quiero")}
            />
          </>
        )}

        {hoja?.tipo === "sugerencia" && sugAbierta && (
          <>
            <Campo etiqueta="Por qué ahora" texto={sugAbierta.motivo} />
            <Campo etiqueta="Cuánto y cuándo" texto={`${sugAbierta.dosis} · ${sugAbierta.momento}`} />
            <Campo etiqueta="Preparación" texto={sugAbierta.preparacion} />
            <Campo etiqueta="Qué cambiaría" texto={sugAbierta.cambiaria} />
            <Campo etiqueta="Evidencia" texto={sugAbierta.evidencia} />
            <Campo etiqueta="Tope" texto={fichaAbierta?.tope} />
            <Aviso texto={sugAbierta.aviso} />
            <PrimaryButton
              label="Acepto"
              loading={guardando}
              onPress={() => void elegir(sugAbierta.supplement, "acepto")}
            />
            <BotonSecundario
              label="Ya lo tomo"
              disabled={guardando}
              onPress={() => void elegir(sugAbierta.supplement, "ya_lo_tomo")}
            />
            <BotonSecundario
              label="No quiero"
              disabled={guardando}
              onPress={() => void elegir(sugAbierta.supplement, "no_quiero")}
            />
          </>
        )}

        {hoja?.tipo === "ficha" && fichaAbierta && (
          <>
            <Campo etiqueta="Cuánto y cuándo" texto={`${fichaAbierta.dosisTexto} · ${fichaAbierta.momento}`} />
            <Campo etiqueta="Preparación" texto={fichaAbierta.preparacion} />
            <Campo etiqueta="Por qué" texto={fichaAbierta.porque} />
            <Campo etiqueta="Evidencia" texto={fichaAbierta.evidencia} />
            <Campo etiqueta="Tope" texto={fichaAbierta.tope} />
            <Aviso texto={data.freno ?? fichaAbierta.aviso} />
            <PrimaryButton
              label="Lo tomo"
              loading={guardando}
              onPress={() => void elegir(fichaAbierta.id, "ya_lo_tomo")}
            />
          </>
        )}

        {msg && <Text style={styles.msg}>{msg}</Text>}
      </Hoja>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.obsidiana },
    content: { padding: spacing.lg, paddingBottom: spacing.huge * 2, gap: spacing.md },
    back: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      paddingVertical: spacing.sm,
      alignSelf: "flex-start",
    },
    backText: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
    title: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    vacio: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
    input: {
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      fontFamily: fonts.sans,
      ...typeScale.body,
      color: colors.marfil,
    },
    msg: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
  });
