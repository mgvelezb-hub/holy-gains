import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { Card } from "@/components/Card";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { SectionLabel } from "@/components/SectionLabel";
import { useTheme } from "@/context/theme";
import {
  ApiError,
  patchNutricion,
  patchPreparaciones,
  patchPresupuesto,
  type DietStyle,
  type MeResponse,
} from "@/lib/api";
import {
  ESTILOS_DIETA,
  PRESUPUESTOS,
  SUPLEMENTOS,
  VENTANAS_AYUNO,
  avisoDeDieta,
} from "@/lib/nutricion";
import { TIEMPOS_COCINA, listaDeAlimentos } from "@/lib/entrenamiento";
import {
  PREPARACIONES_TODAS,
  TIPOS_DE_PREPARACION,
  preferenciaDelPerfil,
  type PreferenciaPreparaciones,
} from "@/lib/preparaciones";
import { fonts, radius, spacing, type as typeScale, type Palette } from "@/lib/theme";

/**
 * Los editores de la sección Nutrición, cada uno en su propia hoja de zoom.
 *
 * Vivían apilados en `[seccion].tsx`: cinco catálogos con descripciones, uno
 * tras otro, y la sección era puro scroll. La sección ahora es una lista de
 * renglones con el estado actual ("Dieta: Estándar") y cada renglón abre su
 * hoja con el editor completo. La lógica y las llamadas son las mismas que
 * tenían allá — solo cambió dónde viven.
 */

/** Estilo de dieta y, si es ayuno, la ventana en la que sí se come. */
export function EditorDieta({ me }: { me: MeResponse | null }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [dieta, setDieta] = useState<DietStyle>("ESTANDAR");
  const [ventana, setVentana] = useState<{ inicio: number | null; fin: number | null }>({
    inicio: null,
    fin: null,
  });
  const [dietaMsg, setDietaMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.profile) return;
    setDieta(me.profile.dietStyle ?? "ESTANDAR");
    setVentana({
      inicio: me.profile.fastingStartHour ?? null,
      fin: me.profile.fastingEndHour ?? null,
    });
  }, [me]);

  async function guardarDieta(valor: DietStyle) {
    const anterior = dieta;
    setDieta(valor);
    setDietaMsg(null);
    try {
      await patchNutricion({ dietStyle: valor });
      setDietaMsg(
        "Guardado — regenera tu menú en Nutrición para verlo hoy, o espera a tu siguiente check-in.",
      );
    } catch (error) {
      setDieta(anterior);
      setDietaMsg(error instanceof ApiError ? error.message : "No se pudo guardar tu dieta");
    }
  }

  async function guardarVentana(inicio: number, fin: number) {
    const anterior = ventana;
    setVentana({ inicio, fin });
    setDietaMsg(null);
    try {
      await patchNutricion({ fastingStartHour: inicio, fastingEndHour: fin });
      setDietaMsg(`Listo: comes entre las ${inicio}:00 y las ${fin}:00.`);
    } catch (error) {
      setVentana(anterior);
      setDietaMsg(error instanceof ApiError ? error.message : "No se pudo guardar tu ventana");
    }
  }

  return (
    <Card>
      <View style={styles.sectionHeader}>
        <SectionLabel>Tu tipo de dieta</SectionLabel>
        <InfoTip titulo="Tu tipo de dieta">
          <TextoInfo>
            Cada estilo cambia una cosa y nada más. Lo eliges tú: la app no decide sola qué
            filosofía sigues, y te dice qué implica cada una antes de cambiar.
          </TextoInfo>
        </InfoTip>
      </View>

      <View style={styles.lista}>
        {ESTILOS_DIETA.map((estilo) => (
          <Pressable
            key={estilo.valor}
            onPress={() => guardarDieta(estilo.valor)}
            style={[styles.fila, dieta === estilo.valor && styles.filaOn]}
          >
            <Text style={[styles.filaNombre, dieta === estilo.valor && styles.filaNombreOn]}>
              {estilo.nombre}
            </Text>
            <Text style={styles.filaDetalle}>{estilo.detalle}</Text>
          </Pressable>
        ))}
      </View>

      {dieta === "AYUNO" && (
        <>
          <Text style={styles.subLabel}>Tu ventana para comer</Text>
          <View style={styles.chipsRow}>
            {VENTANAS_AYUNO.map((opcion) => {
              const activo = ventana.inicio === opcion.inicio && ventana.fin === opcion.fin;
              return (
                <Pressable
                  key={opcion.nombre}
                  onPress={() => guardarVentana(opcion.inicio, opcion.fin)}
                  style={[styles.chip, activo && styles.chipOn]}
                >
                  <Text style={[styles.chipText, activo && styles.chipTextOn]}>
                    {opcion.nombre}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {(() => {
        const aviso = avisoDeDieta(dieta, {
          // La hora que importa es la del entrenamiento, no la del
          // recordatorio del check-in.
          entrenaTemprano: (me?.profile?.trainingTime ?? "MANANA") === "MANANA",
          inicioVentana: ventana.inicio,
        });
        return aviso ? <Text style={styles.msg}>{aviso}</Text> : null;
      })()}

      {dietaMsg && <Text style={styles.msg}>{dietaMsg}</Text>}
    </Card>
  );
}

/** Presupuesto de despensa: cambia el catálogo con el que se arma el menú. */
export function EditorPresupuesto({ me }: { me: MeResponse | null }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [presupuesto, setPresupuesto] = useState<"BAJO" | "MEDIO" | "ALTO" | null>(null);
  const [presupuestoMsg, setPresupuestoMsg] = useState<string | null>(null);

  useEffect(() => {
    if (me?.profile) setPresupuesto(me.profile.budget);
  }, [me]);

  async function guardarPresupuesto(valor: "BAJO" | "MEDIO" | "ALTO") {
    setPresupuesto(valor);
    setPresupuestoMsg(null);
    try {
      await patchPresupuesto(valor);
      setPresupuestoMsg(
        "Guardado — regenera tu menú en Nutrición para verlo hoy, o espera a tu siguiente check-in.",
      );
    } catch (error) {
      setPresupuestoMsg(
        error instanceof ApiError ? error.message : "No se pudo guardar tu presupuesto",
      );
    }
  }

  return (
    <Card>
      <View style={styles.sectionHeader}>
        <SectionLabel>Presupuesto de despensa</SectionLabel>
        <InfoTip titulo="Presupuesto de despensa">
          <TextoInfo>
            Acota con qué alimentos se arma tu menú. Los tres niveles cubren proteína,
            carbohidrato, grasa y vegetales: ninguno te deja sin con qué comer, cambian la
            variedad y el precio.
          </TextoInfo>
          <TextoInfo>
            Cambiarlo no rehace el menú de esta semana: ese ya se compró, y rehacerlo a media
            semana obliga a tirar comida.
          </TextoInfo>
        </InfoTip>
      </View>

      <View style={styles.lista}>
        {PRESUPUESTOS.map((opcion) => (
          <Pressable
            key={opcion.valor}
            onPress={() => guardarPresupuesto(opcion.valor)}
            style={[styles.fila, presupuesto === opcion.valor && styles.filaOn]}
          >
            <Text
              style={[styles.filaNombre, presupuesto === opcion.valor && styles.filaNombreOn]}
            >
              {opcion.nombre}
            </Text>
            <Text style={styles.filaDetalle}>{opcion.detalle}</Text>
          </Pressable>
        ))}
      </View>

      {presupuestoMsg && <Text style={styles.msg}>{presupuestoMsg}</Text>}
    </Card>
  );
}

/** Tiempo de cocina: el tope de minutos con el que el motor filtra el catálogo. */
export function EditorCocina({ me }: { me: MeResponse | null }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [tiempoCocina, setTiempoCocina] = useState<number | null>(null);
  const [cocinaMsg, setCocinaMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.profile) return;
    setTiempoCocina(me.profile.maxPrepMin ?? null);
  }, [me]);

  async function guardarTiempoCocina(minutos: number | null) {
    setTiempoCocina(minutos);
    setCocinaMsg(null);
    try {
      await patchNutricion({ maxPrepMin: minutos });
      setCocinaMsg(
        minutos === null
          ? "Sin tope: el menú puede pedir cocinar en el momento."
          : "Listo. Lo que se cocina en lote sigue entrando: cuenta como calentar.",
      );
    } catch (error) {
      setCocinaMsg(
        error instanceof ApiError ? error.message : "No se pudo guardar tu tiempo de cocina",
      );
    }
  }

  return (
    <Card>
      <View style={styles.sectionHeader}>
        <SectionLabel>Cuánto quieres cocinar</SectionLabel>
        <InfoTip titulo="Cuánto quieres cocinar">
          <TextoInfo>
            El tiempo se mide **el día que comes**, no el día que cocinas. El arroz tarda
            media hora en la olla, pero si se hace el domingo y entre semana se calienta la
            porción, cuenta como calentar — así que sigue entrando aunque elijas poco tiempo.
          </TextoInfo>
          <TextoInfo>
            Es una preferencia y no una regla: si el tope dejara una comida sin proteína,
            manda comer.
          </TextoInfo>
        </InfoTip>
      </View>

      <View style={styles.lista}>
        {TIEMPOS_COCINA.map((opcion) => {
          const activo = tiempoCocina === opcion.valor;
          return (
            <Pressable
              key={opcion.nombre}
              onPress={() => guardarTiempoCocina(opcion.valor)}
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

      {cocinaMsg && <Text style={styles.msg}>{cocinaMsg}</Text>}
    </Card>
  );
}

/**
 * Lo que la persona tiene en la alacena.
 *
 * Se pregunta qué TIENES, no qué deberías comprar: la app no recomienda
 * productos. Lo marcado entra al plan —el polvo como alimento del menú, la
 * creatina y el omega como pauta diaria— y lo no marcado no existe.
 */
export function EditorAlacena({ me }: { me: MeResponse | null }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [suplementos, setSuplementos] = useState<Array<"WHEY" | "CREATINA" | "OMEGA3">>([]);
  const [suplementosMsg, setSuplementosMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.profile) return;
    setSuplementos(
      ((me.profile.supplements ?? []) as Array<"WHEY" | "CREATINA" | "OMEGA3">).filter((valor) =>
        SUPLEMENTOS.some((opcion) => opcion.valor === valor),
      ),
    );
  }, [me]);

  async function alternarSuplemento(valor: "WHEY" | "CREATINA" | "OMEGA3") {
    const siguiente = suplementos.includes(valor)
      ? suplementos.filter((entrada) => entrada !== valor)
      : [...suplementos, valor];

    setSuplementos(siguiente);
    setSuplementosMsg(null);
    try {
      await patchNutricion({ supplements: siguiente });
      setSuplementosMsg(
        "Guardado — regenera tu menú en Nutrición para verlo hoy, o espera a tu siguiente check-in.",
      );
    } catch (error) {
      setSuplementos(suplementos);
      setSuplementosMsg(
        error instanceof ApiError ? error.message : "No se pudo guardar tus suplementos",
      );
    }
  }

  return (
    <Card>
      <View style={styles.sectionHeader}>
        <SectionLabel>Suplementos</SectionLabel>
        <InfoTip titulo="Suplementos">
          <TextoInfo>
            Lo básico que ya tienes: el polvo entra al menú como un alimento más y la creatina
            y el omega a tu pauta del día. Vitaminas, magnesio e infusiones viven en Ajustes →
            Suplementos, donde la app sugiere solo con una señal de tus datos y tú decides.
          </TextoInfo>
        </InfoTip>
      </View>

      <View style={styles.lista}>
        {SUPLEMENTOS.map((opcion) => {
          const activo = suplementos.includes(opcion.valor);
          return (
            <Pressable
              key={opcion.valor}
              onPress={() => alternarSuplemento(opcion.valor)}
              style={[styles.fila, activo && styles.filaOn]}
            >
              <Text style={[styles.filaNombre, activo && styles.filaNombreOn]}>
                {activo ? "✓ " : ""}
                {opcion.nombre}
              </Text>
              <Text style={styles.filaDetalle}>{opcion.detalle}</Text>
            </Pressable>
          );
        })}
      </View>

      {suplementosMsg && <Text style={styles.msg}>{suplementosMsg}</Text>}
    </Card>
  );
}

/**
 * Licuados, sopas y cremas: tres interruptores, uno por renglón. Apagar uno
 * no quita alimentos del menú —el motor los sirve sueltos—, solo deja de
 * agruparlos en ese platillo.
 */
export function EditorPreparaciones({ me }: { me: MeResponse | null }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [preferencia, setPreferencia] = useState<PreferenciaPreparaciones>(PREPARACIONES_TODAS);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.profile) return;
    setPreferencia(preferenciaDelPerfil(me.profile));
  }, [me]);

  async function alternar(clave: keyof PreferenciaPreparaciones, valor: boolean) {
    const anterior = preferencia;
    const siguiente = { ...preferencia, [clave]: valor };
    setPreferencia(siguiente);
    setMsg(null);
    try {
      await patchPreparaciones(siguiente);
      setMsg("Guardado — regenera tu menú en Nutrición para verlo hoy, o espera a tu siguiente check-in.");
    } catch (error) {
      setPreferencia(anterior);
      setMsg(error instanceof ApiError ? error.message : "No se pudo guardar");
    }
  }

  return (
    <Card>
      <View style={styles.sectionHeader}>
        <SectionLabel>Platillos en tu menú</SectionLabel>
        <InfoTip titulo="Licuados, sopas y cremas">
          <TextoInfo>
            El menú puede juntar alimentos en un platillo: el licuado del desayuno, la sopa de la
            comida. Se arman con los mismos alimentos y las mismas porciones de tu plan, así que
            los macros no cambian. Si apagas uno, esos alimentos siguen llegando sueltos.
          </TextoInfo>
        </InfoTip>
      </View>

      <View style={styles.lista}>
        {TIPOS_DE_PREPARACION.map((tipo) => (
          <View key={tipo.clave} style={styles.interruptor}>
            <Text style={styles.interruptorNombre} numberOfLines={1}>
              {tipo.nombre}
            </Text>
            <InfoTip titulo={tipo.nombre}>
              <TextoInfo>{tipo.detalle}</TextoInfo>
            </InfoTip>
            <Switch
              value={preferencia[tipo.clave]}
              onValueChange={(valor) => alternar(tipo.clave, valor)}
              trackColor={{ true: colors.guinda, false: colors.cardBorder }}
              thumbColor={colors.marfil}
            />
          </View>
        ))}
      </View>

      {msg && <Text style={styles.msg}>{msg}</Text>}
    </Card>
  );
}

/**
 * Lo que sí y lo que no: los favoritos pesan en la elección del menú y los
 * excluidos salen de él y de la lista de súper.
 */
export function EditorGustos({ me }: { me: MeResponse | null }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [favoritos, setFavoritos] = useState("");
  const [excluidos, setExcluidos] = useState("");
  const [alimentosMsg, setAlimentosMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.profile) return;
    setFavoritos((me.profile.favoriteFoods ?? []).join(", "));
    setExcluidos((me.profile.excludedFoods ?? []).join(", "));
  }, [me]);

  async function guardarAlimentos() {
    setAlimentosMsg(null);
    try {
      const guardado = await patchNutricion({
        favoriteFoods: listaDeAlimentos(favoritos),
        excludedFoods: listaDeAlimentos(excluidos),
      });
      setFavoritos(guardado.favoriteFoods.join(", "));
      setExcluidos(guardado.excludedFoods.join(", "));
      setAlimentosMsg(
        "Guardado — regenera tu menú en Nutrición para verlo hoy, o espera a tu siguiente check-in.",
      );
    } catch (error) {
      setAlimentosMsg(
        error instanceof ApiError ? error.message : "No se pudieron guardar tus alimentos",
      );
    }
  }

  return (
    <Card>
      <View style={styles.sectionHeader}>
        <SectionLabel>Lo que sí y lo que no</SectionLabel>
        <InfoTip titulo="Lo que sí y lo que no">
          <TextoInfo>
            Separa con comas. Lo que te gusta aparece más seguido; lo que no comes sale del
            menú y de la lista de súper. Las alergias no se editan aquí: esas las lleva tu
            perfil y nunca entran, ni por equivalencia.
          </TextoInfo>
        </InfoTip>
      </View>

      <Text style={styles.subLabel}>Lo que sí te gusta</Text>
      <TextInput
        value={favoritos}
        onChangeText={setFavoritos}
        onBlur={guardarAlimentos}
        placeholder="pollo, avena, camote"
        placeholderTextColor={colors.paloRosaLight}
        autoCapitalize="none"
        style={styles.input}
      />

      <Text style={styles.subLabel}>Lo que no comes</Text>
      <TextInput
        value={excluidos}
        onChangeText={setExcluidos}
        onBlur={guardarAlimentos}
        placeholder="salmón, brócoli"
        placeholderTextColor={colors.paloRosaLight}
        autoCapitalize="none"
        style={styles.input}
      />

      {alimentosMsg && <Text style={styles.msg}>{alimentosMsg}</Text>}
    </Card>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    lista: { gap: spacing.sm, marginTop: spacing.md },
    fila: {
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
      padding: spacing.lg,
      gap: 2,
    },
    filaOn: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
    filaNombre: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.marfil },
    filaNombreOn: { color: colors.pergamino },
    filaDetalle: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
    interruptor: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      minHeight: 44,
    },
    interruptorNombre: {
      flexShrink: 1,
      fontFamily: fonts.sansMedium,
      ...typeScale.body,
      color: colors.marfil,
    },
    subLabel: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.label,
      letterSpacing: 1,
      color: colors.paloRosa,
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
    },
    chipOn: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
    chipText: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    chipTextOn: { color: colors.pergamino },
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
    msg: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.champan,
      marginTop: spacing.md,
    },
  });
