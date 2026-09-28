import { useFocusEffect, useRouter } from "expo-router";
import {
  CalendarRange,
  Clock,
  Dumbbell,
  FlipHorizontal,
  Layers,
  LayoutGrid,
  Repeat,
  RotateCcw,
  Shield,
  Sunrise,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { ScoreCard } from "@/components/ScoreCard";
import { SectionLabel } from "@/components/SectionLabel";
import { useTheme } from "@/context/theme";
import {
  getEjerciciosPorDia,
  getTrainingWeek,
  patchEntrenamiento,
  type DiaDeEjercicios,
  type Discipline,
  type DisciplineLoad,
  type MeResponse,
  type SwimLevel,
  type WeekView,
} from "@/lib/api";
import { renglonDeCardio } from "@/lib/cardio";
import { iconoDe } from "@/lib/disciplinas";
import { DISCIPLINAS, GRUPOS, NIVELES_POR_DISCIPLINA, diasDeGimnasio } from "@/lib/entrenamiento";
import { DIAS_SEMANA, PROPOSITOS } from "@/lib/replantear";
import { HORARIOS, leeHorarioPorDia } from "@/components/ajustes/HorarioDeEntrenamiento";
import {
  OPCIONES_ESQUEMA,
  OPCIONES_UNILATERAL,
  avisosDeLaSemana,
  diasResumenDe,
  disciplinaNombre,
  resumenDeSplit,
  textoModo,
  type CargaConModo,
} from "@/components/ajustes/detalle/EditoresEntrenamiento";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";

/**
 * "Tu entrenamiento" en Ajustes.
 *
 * EL PROBLEMA que resolvía la versión anterior era de jerarquía; el que
 * resuelve esta es de densidad. La sección había vuelto a crecer: catálogos
 * con descripciones, la rejilla de tiempo por día y un Collapsible de grupos
 * apilados en una pantalla de puro scroll.
 *
 * EL REDISEÑO aplica la ley de la app: la sección es una lista de renglones
 * de una línea que ya contestan el estado actual ("Mañana · 2 excepciones",
 * "Días compactos") y cada zoom-in abre una HOJA nueva en
 * `/ajustes/detalle/<tema>` donde vive el editor completo (ver
 * `components/ajustes/detalle/EditoresEntrenamiento.tsx`). Aquí solo quedan
 * las acciones directas (agregar una disciplina, los dos replanteos) y los
 * avisos del planificador.
 *
 * Los resúmenes se leen de `me` directo — la sección recarga `/me` al
 * recuperar el foco (ver `[seccion].tsx`), así que lo guardado en una hoja
 * se refleja al volver sin duplicar estado aquí.
 */
export function SeccionEntrenamiento({ me }: { me: MeResponse | null }) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [primaria, setPrimaria] = useState<Discipline>("PESAS");
  const [otras, setOtras] = useState<CargaConModo[]>([]);

  useEffect(() => {
    if (!me?.profile) return;
    setPrimaria(me.profile.primaryDiscipline ?? "PESAS");
    setOtras(me.profile.otherDisciplines ?? []);
  }, [me]);

  const presupuestoSemanal = me?.profile?.trainingDaysPerWeek ?? 0;
  const diasGym = diasDeGimnasio(presupuestoSemanal, otras, primaria);
  const niveles: Partial<Record<Discipline, SwimLevel>> = {
    NATACION: me?.profile?.swimLevel ?? "PRINCIPIANTE",
    ...(me?.profile?.disciplineLevels ?? {}),
  };

  // "Tu semana": la consecuencia real, pedida al servidor. Va arriba de todo
  // porque contesta "¿qué tengo?" antes de tocar ningún ajuste. Se recarga
  // al recuperar el foco: las hojas de detalle la cambian al guardar.
  const [semana, setSemana] = useState<WeekView | null>(null);
  const cargarSemana = useCallback(async () => {
    try {
      setSemana(await getTrainingWeek());
    } catch {
      // Sin semana no hay "Tu semana" que mostrar; los ajustes se guardaron igual.
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void cargarSemana();
    }, [cargarSemana]),
  );

  // Quién elige los ejercicios de cada tipo de día. Se pide al servidor junto
  // con la semana porque la respuesta de `/me` no la trae: el mapa por tipo de
  // día solo tiene sentido leído contra el split vigente.
  const [diasDeEjercicios, setDiasDeEjercicios] = useState<DiaDeEjercicios[]>([]);
  useFocusEffect(
    useCallback(() => {
      getEjerciciosPorDia()
        .then((respuesta) => setDiasDeEjercicios(respuesta.dias))
        .catch(() => {
          // Sin esto el renglón dice "Sugerencia de Coachy", que es el default.
        });
    }, []),
  );

  const diasDeLaSemana = useMemo(() => diasResumenDe(semana), [semana]);
  const avisos = useMemo(() => avisosDeLaSemana(semana), [semana]);
  const resumenSemana = useMemo(() => {
    if (!semana) return "Cargando...";
    const conSesion = diasDeLaSemana.length;
    return conSesion === 0
      ? "Sin sesiones armadas todavía"
      : `${conSesion} ${conSesion === 1 ? "día" : "días"} con sesión de 7`;
  }, [semana, diasDeLaSemana]);

  // Renglones-resumen: el estado actual en una línea, leído de lo ya cargado.
  const porDia = leeHorarioPorDia(me?.profile?.trainingSchedule);
  const excepciones = Object.keys(porDia).length;
  const nombreHorario =
    HORARIOS.find((horario) => horario.valor === (me?.profile?.trainingTime ?? "MANANA"))?.nombre ??
    "Mañana";
  const resumenHorario =
    excepciones > 0
      ? `${nombreHorario} · ${excepciones} ${excepciones === 1 ? "excepción" : "excepciones"}`
      : nombreHorario;

  const resumenArmado = (me?.profile?.compactDays ?? true) ? "Días compactos" : "Días repartidos";

  const resumenSplit = resumenDeSplit(me?.profile?.customSplit);

  // Cuántas disciplinas SÍ entran al plan semanal. El resto son bloques del
  // día, que no se planean ni se prometen.
  const totalBases = 1 + otras.length;
  const resumenBases = `${totalBases} ${totalBases === 1 ? "base" : "bases"} · ${disciplinaNombre(primaria).toLowerCase()} principal`;

  // Quién elige los ejercicios. El detalle por tipo de día vive en su hoja:
  // aquí solo se contesta "¿sigo a Coachy o ya los elegí yo?".
  const diasPropios = diasDeEjercicios.filter((dia) => !dia.sigueACoachy).length;
  const resumenEjercicios =
    diasPropios === 0
      ? "Sugerencia de Coachy"
      : `Elegidos por ti · ${diasPropios} ${diasPropios === 1 ? "día" : "días"}`;
  const resumenUnilateral =
    OPCIONES_UNILATERAL.find(
      (opcion) => opcion.valor === (me?.profile?.unilateralMode ?? "SEGUIDO"),
    )?.corto ?? "Seguido";

  const resumenEsquema =
    OPCIONES_ESQUEMA.find(
      (opcion) => opcion.valor === (me?.profile?.schemePreference ?? "RECOMENDADO"),
    )?.corto ?? "Que la app decida";

  const declarado = me?.profile?.timePerDay;
  const diasConTiempo = declarado
    ? DIAS_SEMANA.filter((dia) => (declarado[dia.valor] ?? 0) > 0).length
    : 0;
  const resumenTiempo =
    diasConTiempo === 0
      ? "Sin declarar todavía"
      : `${diasConTiempo} ${diasConTiempo === 1 ? "día" : "días"} con tiempo declarado`;

  const sinRepetir = me?.profile?.avoidRepeatGroups ?? [];
  const nombresGrupos = sinRepetir.map(
    (grupo) => GRUPOS.find((entrada) => entrada.valor === grupo)?.nombre ?? grupo,
  );
  const resumenGrupos =
    nombresGrupos.length === 0
      ? "Ninguno: split completo"
      : nombresGrupos.length <= 2
        ? nombresGrupos.join(" · ")
        : `${nombresGrupos.length} grupos protegidos`;

  const activas = DISCIPLINAS.filter(
    (disciplina) =>
      disciplina.valor === primaria || otras.some((carga) => carga.discipline === disciplina.valor),
  );
  /** El resumen de una disciplina activa, igual al que tenía su tarjeta. */
  function resumenDisciplina(discipline: Discipline): string {
    const opciones = NIVELES_POR_DISCIPLINA[discipline] ?? [];
    const nivel = niveles[discipline] ?? "PRINCIPIANTE";
    const nombreNivel = opciones.find((opcion) => opcion.valor === nivel)?.nombre ?? "Principiante";
    const carga = otras.find((entrada) => entrada.discipline === discipline);
    const nombreProposito =
      PROPOSITOS.find((opcion) => opcion.valor === carga?.proposito)?.nombre ?? null;

    const partes: string[] = [];
    if (discipline === primaria) {
      partes.push(`${diasGym} ${diasGym === 1 ? "día" : "días"} de gimnasio`);
    } else if (carga && discipline === "CARDIO") {
      // El renglón de cardio ya dice todo: frecuencia, modo, tipo, máquina y minutos.
      return renglonDeCardio(carga).replace(/^Cardio · /, "");
    } else if (carga) {
      partes.push(`${carga.sessionsPerWeek} ${carga.sessionsPerWeek === 1 ? "sesión" : "sesiones"}`);
      partes.push(textoModo(carga.modo));
      if (nombreProposito) partes.push(nombreProposito.toLowerCase());
    }
    partes.push(nombreNivel.toLowerCase());
    return partes.join(" · ");
  }

  return (
    <>
      {/* 1. "¿Qué tengo?" — la consecuencia real, antes de tocar nada. */}
      <ScoreCard
        icon={CalendarRange}
        tint={colors.paloRosa}
        title="Tu semana"
        summary={resumenSemana}
        onPress={() => router.push("/ajustes/detalle/semana")}
      />

      {/* Los avisos del planificador se quedan a la vista: son lo único de
          esta pantalla que puede pedir una decisión hoy. */}
      {avisos.map((aviso) => (
        <Text key={aviso} style={styles.aviso}>
          {aviso}
        </Text>
      ))}

      {/* 2. El estado actual, un renglón por decisión. El editor de cada una
          vive en su hoja de `/ajustes/detalle/`. */}
      <ScoreCard
        icon={Sunrise}
        tint={colors.champan}
        title="A qué hora entrenas"
        summary={resumenHorario}
        onPress={() => router.push("/ajustes/detalle/horario")}
      />

      <ScoreCard
        icon={LayoutGrid}
        tint={colors.champan}
        title="Cómo se arma tu semana"
        summary={resumenArmado}
        onPress={() => router.push("/ajustes/detalle/armado")}
      />

      <ScoreCard
        icon={CalendarRange}
        tint={colors.champan}
        title="Tu split"
        summary={resumenSplit}
        onPress={() => router.push("/ajustes/detalle/split")}
      />

      <ScoreCard
        icon={Dumbbell}
        tint={colors.champan}
        title="Ejercicios"
        summary={resumenEjercicios}
        onPress={() => router.push("/ajustes/detalle/ejercicios")}
      />

      <ScoreCard
        icon={Repeat}
        tint={colors.champan}
        title="Cómo te gusta entrenar"
        summary={resumenEsquema}
        onPress={() => router.push("/ajustes/detalle/esquema")}
      />

      <ScoreCard
        icon={FlipHorizontal}
        tint={colors.champan}
        title="Unilaterales"
        summary={resumenUnilateral}
        onPress={() => router.push("/ajustes/detalle/unilaterales")}
      />

      <ScoreCard
        icon={Clock}
        tint={colors.champan}
        title="Tiempo por día"
        summary={resumenTiempo}
        onPress={() => router.push("/ajustes/detalle/tiempo")}
      />

      <ScoreCard
        icon={Shield}
        tint={colors.champan}
        title="Grupos que no repites"
        summary={resumenGrupos}
        onPress={() => router.push("/ajustes/detalle/grupos")}
      />

      {/* 3. "¿Qué tan grande es el cambio?" — los dos replanteos, en orden. */}
      <Card>
        <View style={styles.sectionHeader}>
          <SectionLabel>Cambiar tu plan</SectionLabel>
          <InfoTip titulo="Qué nivel de cambio necesitas">
            <TextoInfo>
              Tres tamaños de cambio, de menor a mayor: ajustar una pieza (los renglones de esta
              pantalla, disciplina por disciplina), repartir el peso entre las que ya tienes
              activas, o empezar de cero cuando cambió algo más grande que una preferencia.
            </TextoInfo>
          </InfoTip>
        </View>

        <Pressable onPress={() => router.push("/recalibrar")} style={styles.recalibrar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.recalibrarTexto}>Repartir el peso entre disciplinas →</Text>
            <Text style={styles.linkDetalle}>Cuándo usarlo: nadar te está gustando y quieres más.</Text>
          </View>
        </Pressable>

        <Pressable onPress={() => router.push("/replantear")} style={styles.replantear}>
          <RotateCcw size={18} color={colors.pergamino} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            <Text style={styles.replantearTitulo}>Empezar de cero</Text>
            <Text style={styles.replantearDetalle}>
              Cuándo usarlo: cambió tu horario, tu objetivo o tu vida.
            </Text>
          </View>
        </Pressable>
      </Card>

      {/* 4. Qué se planea y qué no: las bases van al plan; lo demás se agrega
          el día, con el tiempo que sobre (los bloques del día). */}
      <ScoreCard
        icon={Layers}
        tint={colors.paloRosa}
        title="Disciplinas base"
        summary={resumenBases}
        onPress={() => router.push("/ajustes/detalle/bases")}
      />

      <SectionLabel>Ajuste fino, por disciplina</SectionLabel>

      {activas.map((disciplina) => (
        <ScoreCard
          key={disciplina.valor}
          icon={iconoDe(disciplina.valor)}
          tint={colors.champan}
          title={disciplinaNombre(disciplina.valor)}
          summary={resumenDisciplina(disciplina.valor)}
          onPress={() => router.push(`/ajustes/detalle/disciplina?d=${disciplina.valor}`)}
        />
      ))}

    </>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    aviso: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.champan,
      backgroundColor: withAlpha(colors.champan, 0.1),
      borderRadius: radius.md,
      padding: spacing.md,
    },
    recalibrar: { paddingVertical: spacing.md, marginTop: spacing.md },
    recalibrarTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.champan },
    linkDetalle: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.paloRosaLight,
      marginTop: 2,
    },
    replantear: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      marginTop: spacing.sm,
      backgroundColor: colors.guinda,
      borderWidth: 1,
      borderColor: colors.guindaLight,
      borderRadius: radius.xl,
      padding: spacing.lg,
    },
    replantearTitulo: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.pergamino },
    replantearDetalle: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: withAlpha(colors.pergamino, 0.85),
    },
  });
