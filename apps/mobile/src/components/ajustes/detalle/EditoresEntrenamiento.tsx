import { useRouter } from "expo-router";
import { ChevronDown, ChevronUp, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Card } from "@/components/Card";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { NumberStepper } from "@/components/NumberStepper";
import { Parrafo } from "@/components/Parrafo";
import { SectionLabel } from "@/components/SectionLabel";
import { useTheme } from "@/context/theme";
import {
  ApiError,
  getCatalogoGym,
  getEjerciciosPorDia,
  getTrainingWeek,
  patchEjerciciosManuales,
  patchEntrenamiento,
  type DiaDeEjercicios,
  type EjercicioGym,
  type Discipline,
  type DisciplineLoad,
  type MeResponse,
  type PreferenciasCardio,
  type CustomSplit,
  type DayKind,
  type MuscleGroup,
  type SchemePreference,
  type UnilateralMode,
  type SessionView,
  type SwimLevel,
  type WeekView,
} from "@/lib/api";
import {
  DISCIPLINAS,
  GRUPOS,
  NIVELES_POR_DISCIPLINA,
  type BloqueDelDia,
  diasDeGimnasio,
  lineaDelDia,
  ordenarBloquesDelDia,
} from "@/lib/entrenamiento";
import {
  CARDIO_POR_DEFECTO,
  OPCIONES_EQUIPO,
  OPCIONES_NIVEL,
  OPCIONES_TIPO,
  renglonDeCardio,
} from "@/lib/cardio";
import { DIAS_SEMANA, PROPOSITOS, TIEMPOS_DIA, type Proposito, type WeekDay } from "@/lib/replantear";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";

/**
 * Los editores de "Tu entrenamiento", cada uno en su propia hoja de zoom.
 *
 * Vivían apilados en `SeccionEntrenamiento` — catálogos con descripciones,
 * la rejilla de tiempo por día, el Collapsible de grupos— y la sección era
 * puro scroll. La sección ahora es una lista de renglones con el estado
 * actual y cada renglón abre su hoja. La lógica y las llamadas son las
 * mismas que tenían allá; el refresco de "Tu semana" ya no se dispara desde
 * aquí porque la sección lo recarga sola al recuperar el foco.
 */

/**
 * Las cuatro opciones de "Cómo te gusta entrenar".
 *
 * "Que la app decida" va PRIMERO: es el default y la recomendación real —
 * variar el estímulo semana a semana (periodización ondulante) es igual o
 * mejor que un esquema fijo para ganar fuerza (Rhea et al. 2002). Las otras
 * tres describen el esquema en el vocabulario de la atleta (peso/reps), no
 * en el del catálogo (`FUERZA`/`HIPERTROFIA`/`METABOLICO` son las llaves que
 * entiende el servidor; ver `SCHEME_PREFERENCES` en `schemes.ts` del motor
 * para el sustento y el mapeo exacto — p. ej. `HIPERTROFIA` fija el esquema
 * `RANGO_MEDIO` del catálogo, que no tiene uno propio).
 *
 * `corto` es lo que cabe en el renglón-resumen de la sección.
 */
export const OPCIONES_ESQUEMA: Array<{
  valor: SchemePreference;
  nombre: string;
  corto: string;
  detalle: string;
}> = [
  {
    valor: "RECOMENDADO",
    nombre: "Que la app decida (recomendado)",
    corto: "Que la app decida",
    detalle: "Rota el estímulo cada semana, que es lo que la evidencia respalda.",
  },
  {
    valor: "FUERZA",
    nombre: "Mucho peso, pocas reps",
    corto: "Mucho peso, pocas reps",
    detalle: "Series de 3–6, descansos largos.",
  },
  {
    valor: "HIPERTROFIA",
    nombre: "Peso medio, reps medias",
    corto: "Peso medio, reps medias",
    detalle: "Series de 8–12, el rango clásico de músculo.",
  },
  {
    valor: "METABOLICO",
    nombre: "Poco peso, muchas reps",
    corto: "Poco peso, muchas reps",
    detalle: "Series de 25–30, quema y resistencia.",
  },
  {
    valor: "COACH",
    nombre: "Como el coach",
    corto: "Coach",
    detalle: "15-12-10-8 subiendo peso, tempo 3-1-1 y la última del accesorio al fallo.",
  },
];

/** Los tipos de día, con el nombre que ve la atleta. Mismo orden que en el motor. */
export const OPCIONES_DIA: Array<{ valor: DayKind | "DESCANSO"; nombre: string }> = [
  { valor: "DESCANSO", nombre: "Descanso" },
  { valor: "PIERNA_CUADRICEPS", nombre: "Pierna · cuádriceps" },
  { valor: "PIERNA_FEMORAL", nombre: "Pierna · femoral" },
  { valor: "PIERNA_GLUTEO", nombre: "Glúteo" },
  { valor: "PECHO_ESPALDA", nombre: "Pecho y espalda" },
  { valor: "PECHO_TRICEP", nombre: "Pecho y tríceps" },
  { valor: "ESPALDA_BICEP", nombre: "Espalda y bíceps" },
  { valor: "HOMBRO", nombre: "Hombro" },
  { valor: "BRAZO", nombre: "Bíceps y tríceps" },
  { valor: "HOMBRO_BRAZO", nombre: "Hombro y brazo" },
  { valor: "TORSO", nombre: "Torso completo" },
];

/**
 * Los presets del split, con el nombre y la descripción del motor
 * (`SPLIT_PRESETS` en `apps/web/src/lib/training/split.ts`). El mapa de días
 * de cada uno lo arma el servidor al guardarlo — aquí solo se elige.
 */
export const OPCIONES_SPLIT: Array<{
  valor: "ACTUAL" | "INFERIOR_SUPERIOR_3_3" | "PPL_X2";
  nombre: string;
  corto: string;
  detalle: string;
  dias: CustomSplit;
}> = [
  {
    valor: "ACTUAL",
    nombre: "El de la app (recomendado)",
    corto: "El de la app",
    detalle: "El split del coach, repartido según tus días. Pierna 2-3 veces por semana.",
    dias: {},
  },
  {
    valor: "INFERIOR_SUPERIOR_3_3",
    nombre: "3 inferior / 3 superior",
    corto: "3 inferior / 3 superior",
    detalle: "Alterna pierna y torso. Si entrenas menos de seis días, se ajusta a los tuyos.",
    dias: {
      LUN: "PIERNA_CUADRICEPS",
      MAR: "PECHO_TRICEP",
      MIE: "PIERNA_GLUTEO",
      JUE: "ESPALDA_BICEP",
      VIE: "PIERNA_FEMORAL",
      SAB: "HOMBRO_BRAZO",
      DOM: "DESCANSO",
    },
  },
  {
    valor: "PPL_X2",
    nombre: "Pierna / empuje / jalón, dos vueltas",
    corto: "PPL ×2",
    detalle: "Pierna, pecho y tríceps, espalda y bíceps — y otra vuelta, hasta donde alcancen tus días.",
    dias: {
      LUN: "PIERNA_CUADRICEPS",
      MAR: "PECHO_TRICEP",
      MIE: "ESPALDA_BICEP",
      JUE: "PIERNA_GLUTEO",
      VIE: "PECHO_TRICEP",
      SAB: "ESPALDA_BICEP",
      DOM: "DESCANSO",
    },
  },
];

/** Cómo se hacen los unilaterales, en el vocabulario del gimnasio. */
export const OPCIONES_UNILATERAL: Array<{
  valor: UnilateralMode;
  nombre: string;
  corto: string;
  detalle: string;
}> = [
  {
    valor: "SEGUIDO",
    nombre: "Seguido",
    corto: "Seguido",
    detalle: "Todas las series del derecho y luego las del izquierdo.",
  },
  {
    valor: "ALTERNADO",
    nombre: "Alternado",
    corto: "Alternado",
    detalle: "Cambias de lado serie a serie. Cada lado descansa más.",
  },
];

/** El renglón-resumen del split: el preset que coincide, o cuántos días tiene. */
export function resumenDeSplit(split: CustomSplit | null | undefined): string {
  if (!split) return "El de la app";

  const preset = OPCIONES_SPLIT.find(
    (opcion) =>
      opcion.valor !== "ACTUAL" &&
      DIAS_SEMANA.every((dia) => (split[dia.valor] ?? "DESCANSO") === (opcion.dias[dia.valor] ?? "DESCANSO")),
  );
  if (preset) return preset.corto;

  const dias = DIAS_SEMANA.filter(
    (dia) => split[dia.valor] !== undefined && split[dia.valor] !== "DESCANSO",
  ).length;
  return dias === 0 ? "El de la app" : `Propio · ${dias} ${dias === 1 ? "día" : "días"}`;
}

export function disciplinaNombre(discipline: Discipline): string {
  return DISCIPLINAS.find((entrada) => entrada.valor === discipline)?.nombre ?? discipline;
}

/**
 * Cómo convive una disciplina secundaria con el gimnasio (Fase 11).
 *
 * `DisciplineLoad` en `lib/api.ts` no trae `modo` todavía — otros agentes
 * editan ese archivo en paralelo y solo se les permite agregar funciones al
 * final, así que el campo se declara aquí en vez de tocar el tipo compartido.
 * El servidor ya lo acepta y lo guarda (`parseDisciplineLoads` en
 * `apps/web/src/lib/training/db.ts`); esto es solo la forma de pedírselo sin
 * romper la regla del archivo.
 */
export type ModoDisciplina = "DESPUES" | "DIA_PROPIO";
export type CargaConModo = DisciplineLoad & { modo?: ModoDisciplina; cardio?: PreferenciasCardio };

/**
 * "2/semana · después de pesas" — el renglón de una disciplina secundaria.
 *
 * Sin `modo` declarado el motor se comporta como `DIA_PROPIO` (compatibilidad
 * hacia atrás, ver `types.ts` del motor): el texto dice lo mismo que hace, no
 * lo que una disciplina nueva elegiría por default.
 */
export function textoModo(modo: ModoDisciplina | undefined): string {
  return modo === "DESPUES" ? "después de pesas" : "día propio";
}

/** Suma días a una fecha ISO. Misma cuenta que en `(tabs)/rutinas.tsx`. */
function addDaysISO(dateISO: string, days: number): string {
  const [year, month, day] = dateISO.split("-").map(Number);
  const date = new Date(year!, month! - 1, day!);
  date.setDate(date.getDate() + days);
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  const nextDay = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${nextMonth}-${nextDay}`;
}

const WEEKDAY_ABBR_BY_DOW = ["DOM", "LUN", "MAR", "MIÉ", "JUE", "VIE", "SÁB"];

/** "SÁB" a partir de una fecha ISO. */
function weekdayAbbrOf(dateISO: string): string {
  const [year, month, day] = dateISO.split("-").map(Number);
  return WEEKDAY_ABBR_BY_DOW[new Date(year!, month! - 1, day!).getDay()]!;
}

/** Un día de "Tu semana", ya resuelto a su etiqueta ("Squash → Natación"). */
export type DiaResumen = { date: string; abrev: string; etiqueta: string };

export function diasResumenDe(semana: WeekView | null): DiaResumen[] {
  if (!semana) return [];
  const dias: DiaResumen[] = [];
  for (let index = 0; index < 7; index += 1) {
    const date = addDaysISO(semana.weekStart, index);
    const gym = semana.sessions.find((sesion) => sesion.date === date) ?? null;
    const otrasDia = semana.otherSessions?.filter((otra) => otra.date === date) ?? [];
    const bloques: Array<BloqueDelDia<SessionView>> = ordenarBloquesDelDia(gym, otrasDia);
    if (bloques.length === 0) continue;
    dias.push({ date, abrev: weekdayAbbrOf(date), etiqueta: lineaDelDia(bloques) });
  }
  return dias;
}

/**
 * Los avisos del planificador para "Tu semana": el porqué de un día
 * combinado (la `note` que ya escribió el servidor) y las semanas de
 * descarga. No se inventa copy nuevo — se sube lo que el servidor ya declaró.
 */
export function avisosDeLaSemana(semana: WeekView | null): string[] {
  if (!semana) return [];
  const otras = semana.otherSessions ?? [];
  // Los del split van primero: son los únicos que piden una decisión hoy
  // ("Hombro el martes y pecho el miércoles: te va a doler. Cambiar").
  const avisos = new Set<string>(semana.avisos ?? []);

  for (const otra of otras) {
    const comparteConGym = semana.sessions.some((sesion) => sesion.date === otra.date);
    const comparteConOtra = otras.some((entrada) => entrada !== otra && entrada.date === otra.date);
    if ((comparteConGym || comparteConOtra) && otra.note) avisos.add(otra.note);
    if (otra.sesion?.deload) avisos.add(`Semana de descarga en ${otra.discipline.toLowerCase()}.`);
  }

  return Array.from(avisos);
}

/**
 * "Tu semana" a detalle: los siete días con su etiqueta y los avisos del
 * planificador. Es lectura pura — el renglón de la sección ya dice cuántos
 * días hay; esta hoja enseña cuáles y por qué se combinaron.
 */
export function DetalleSemana() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [semana, setSemana] = useState<WeekView | null>(null);
  const [cargado, setCargado] = useState(false);

  const cargarSemana = useCallback(async () => {
    try {
      setSemana(await getTrainingWeek());
    } catch {
      // Sin semana no hay detalle que mostrar; el vacío de abajo lo dice.
    } finally {
      setCargado(true);
    }
  }, []);
  useEffect(() => {
    void cargarSemana();
  }, [cargarSemana]);

  const dias = useMemo(() => diasResumenDe(semana), [semana]);
  const avisos = useMemo(() => avisosDeLaSemana(semana), [semana]);

  return (
    <Card>
      <SectionLabel>Tu semana</SectionLabel>

      {cargado && dias.length === 0 ? (
        <Text style={styles.vacio}>Todavía no hay semana armada.</Text>
      ) : (
        <View style={styles.semanaLista}>
          {dias.map((dia) => (
            <View key={dia.date} style={styles.semanaFila}>
              <Text style={styles.semanaDia}>{dia.abrev}</Text>
              <Text style={styles.semanaEtiqueta}>{dia.etiqueta}</Text>
            </View>
          ))}
        </View>
      )}

      {avisos.map((aviso) => (
        <Parrafo key={aviso} style={styles.aviso}>
          {aviso}
        </Parrafo>
      ))}
    </Card>
  );
}

/** "Cómo se arma tu semana" (Fase 10): días compactos o repartidos. */
export function EditorArmadoSemana({ me }: { me: MeResponse | null }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // `true` por default: coincide con `Profile.compactDays` en el servidor
  // mientras la respuesta de `/me` no llega.
  const [compactDays, setCompactDays] = useState(true);
  const [compactoMsg, setCompactoMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.profile) return;
    setCompactDays(me.profile.compactDays ?? true);
  }, [me]);

  /**
   * El orden DENTRO de un día combinado nunca se pregunta —eso lo decide la
   * app (la alberca al final, el impacto primero)—; esto solo decide SI se
   * combinan disciplinas compatibles el mismo día.
   */
  async function guardarCompactDays(valor: boolean) {
    const anterior = compactDays;
    setCompactDays(valor);
    setCompactoMsg(null);
    try {
      await patchEntrenamiento({ compactDays: valor });
      setCompactoMsg(
        valor
          ? "Guardado. Desde tu siguiente semana, lo que combine bien cae el mismo día."
          : "Guardado. Desde tu siguiente semana, cada disciplina vuelve a tener su propio día.",
      );
    } catch (error) {
      setCompactDays(anterior);
      setCompactoMsg(error instanceof ApiError ? error.message : "No se pudo guardar tu preferencia");
    }
  }

  return (
    <Card>
      <View style={styles.sectionHeader}>
        <SectionLabel>Cómo se arma tu semana</SectionLabel>
        <InfoTip titulo="Qué decide esto">
          <TextoInfo>
            El orden dentro de un día combinado no se pregunta: la app siempre cierra con la
            alberca (recuperación activa) y abre con el impacto —squash, box— cuando las piernas
            todavía están frescas. Esto solo decide si combina disciplinas compatibles el mismo
            día, o si le da a cada una su propio día.
          </TextoInfo>
        </InfoTip>
      </View>

      <View style={styles.lista}>
        <Pressable
          onPress={() => guardarCompactDays(true)}
          style={[styles.fila, compactDays && styles.filaOn]}
        >
          <Text style={[styles.filaNombre, compactDays && styles.filaNombreOn]}>
            Días compactos
          </Text>
          <Text style={styles.filaDetalle}>
            Combina disciplinas compatibles el mismo día y te deja más días de descanso
            completo.
          </Text>
        </Pressable>
        <Pressable
          onPress={() => guardarCompactDays(false)}
          style={[styles.fila, !compactDays && styles.filaOn]}
        >
          <Text style={[styles.filaNombre, !compactDays && styles.filaNombreOn]}>
            Días repartidos
          </Text>
          <Text style={styles.filaDetalle}>Una disciplina por día, sesiones más frescas.</Text>
        </Pressable>
      </View>

      {compactoMsg && <Text style={styles.msg}>{compactoMsg}</Text>}
    </Card>
  );
}

/** "Cómo te gusta entrenar": esquema fijo, o que la app siga rotando. */
export function EditorEsquema({ me }: { me: MeResponse | null }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // "RECOMENDADO" por default: coincide con el default de
  // `Profile.schemePreference` en el servidor mientras `/me` no llega.
  const [schemePreference, setSchemePreference] = useState<SchemePreference>("RECOMENDADO");
  const [schemeMsg, setSchemeMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.profile) return;
    setSchemePreference(me.profile.schemePreference ?? "RECOMENDADO");
  }, [me]);

  /**
   * La rotación (periodización ondulante) sigue siendo LA recomendación —
   * por eso "Que la app decida" va primero y marcada por default. Elegir un
   * esquema fijo no rompe nada: los días de rehabilitación (lesión activa)
   * nunca se mueven de su esquema, sin importar lo que se elija aquí.
   */
  async function guardarSchemePreference(valor: SchemePreference) {
    const anterior = schemePreference;
    setSchemePreference(valor);
    setSchemeMsg(null);
    try {
      await patchEntrenamiento({ schemePreference: valor });
      setSchemeMsg("Guardado. Aplica desde la próxima semana que se arme.");
    } catch (error) {
      setSchemePreference(anterior);
      setSchemeMsg(error instanceof ApiError ? error.message : "No se pudo guardar tu preferencia");
    }
  }

  return (
    <Card>
      <View style={styles.sectionHeader}>
        <SectionLabel>Cómo te gusta entrenar</SectionLabel>
        <InfoTip titulo="Qué decide esto">
          <TextoInfo>
            La rutina siempre viene con un esquema de series y reps. Por default la app lo rota
            cada semana —fuerza, metabólico, rango medio— porque variar el estímulo da mejores
            resultados que quedarse fijo. Si prefieres no variar, elige un estilo aquí y ese
            esquema se queda fijo todas las semanas.
          </TextoInfo>
          <TextoInfo>Aplica desde la próxima semana que se arme.</TextoInfo>
        </InfoTip>
      </View>

      <View style={styles.lista}>
        {OPCIONES_ESQUEMA.map((opcion) => {
          const activo = schemePreference === opcion.valor;
          return (
            <Pressable
              key={opcion.valor}
              onPress={() => guardarSchemePreference(opcion.valor)}
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

      {schemeMsg && <Text style={styles.msg}>{schemeMsg}</Text>}
    </Card>
  );
}

/**
 * Tiempo por día (Fase 7): lo que hace honesto el reparto de un día
 * combinado. Hasta la Fase 7 esto solo se declaraba rehaciendo el flujo
 * completo de "Empezar de cero"; aquí se ajusta un día a la vez.
 */
export function EditorTiempoPorDia({ me }: { me: MeResponse | null }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [tiempoPorDia, setTiempoPorDia] = useState<Record<WeekDay, number>>(() =>
    Object.fromEntries(DIAS_SEMANA.map((dia) => [dia.valor, 0])) as Record<WeekDay, number>,
  );
  const [tiempoMsg, setTiempoMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.profile) return;
    // Se prellena solo con lo declarado: los días ausentes se quedan en 0
    // ("ese día no"), que es un valor honesto y no un supuesto.
    const declarado = me.profile.timePerDay;
    if (declarado) {
      setTiempoPorDia(
        Object.fromEntries(
          DIAS_SEMANA.map((dia) => [dia.valor, declarado[dia.valor] ?? 0]),
        ) as Record<WeekDay, number>,
      );
    }
  }, [me]);

  async function guardarTiempoDia(dia: WeekDay, minutos: number) {
    const anterior = tiempoPorDia;
    const siguiente = { ...tiempoPorDia, [dia]: minutos };
    setTiempoPorDia(siguiente);
    setTiempoMsg(null);
    try {
      await patchEntrenamiento({ timePerDay: siguiente });
      setTiempoMsg("Guardado. Entra en tu siguiente semana.");
    } catch (error) {
      setTiempoPorDia(anterior);
      setTiempoMsg(error instanceof ApiError ? error.message : "No se pudo guardar tu tiempo");
    }
  }

  return (
    <Card>
      <View style={styles.sectionHeader}>
        <SectionLabel>Tiempo por día</SectionLabel>
        <InfoTip titulo="Para qué sirve esto">
          <TextoInfo>
            Un día con dos disciplinas —gym y alberca, squash y funcional— solo reparte bien el
            tiempo si sabe cuánto hay de verdad ese día. Hasta ahora esto solo se declaraba
            rehaciendo el flujo completo de "Empezar de cero"; aquí se ajusta un día a la vez.
          </TextoInfo>
        </InfoTip>
      </View>

      {DIAS_SEMANA.map((dia) => (
        <View key={dia.valor} style={styles.diaFila}>
          <Text style={styles.diaNombre}>{dia.nombre}</Text>
          <View style={styles.diaOpciones}>
            {TIEMPOS_DIA.map((opcion) => {
              const activo = (tiempoPorDia[dia.valor] ?? 0) === opcion.minutos;
              return (
                <Pressable
                  key={opcion.nombre}
                  onPress={() => guardarTiempoDia(dia.valor, opcion.minutos)}
                  style={[styles.diaChip, activo && styles.diaChipOn]}
                >
                  <Text style={[styles.diaChipTexto, activo && styles.diaChipTextoOn]}>
                    {opcion.corto}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}

      {tiempoMsg && <Text style={styles.msg}>{tiempoMsg}</Text>}
    </Card>
  );
}

/** Grupos que no quieres repetir en la semana. */
export function EditorGrupos({ me }: { me: MeResponse | null }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [sinRepetir, setSinRepetir] = useState<MuscleGroup[]>([]);
  const [entrenoMsg, setEntrenoMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.profile) return;
    setSinRepetir(me.profile.avoidRepeatGroups ?? []);
  }, [me]);

  async function guardarSinRepetir(grupo: MuscleGroup) {
    const siguiente = sinRepetir.includes(grupo)
      ? sinRepetir.filter((valor) => valor !== grupo)
      : [...sinRepetir, grupo];

    setSinRepetir(siguiente);
    setEntrenoMsg(null);
    try {
      await patchEntrenamiento({ avoidRepeatGroups: siguiente });
      setEntrenoMsg(
        siguiente.length === 0
          ? "Sin restricciones: la semana vuelve al split completo."
          : "Guardado. Esos grupos se entrenan una vez y los días que los repetían pasan a otra cosa.",
      );
    } catch (error) {
      setSinRepetir(sinRepetir);
      setEntrenoMsg(error instanceof ApiError ? error.message : "No se pudo guardar tu preferencia");
    }
  }

  return (
    <Card>
      <View style={styles.sectionHeader}>
        <SectionLabel>Grupos que no quieres repetir</SectionLabel>
        <InfoTip titulo="Cómo funciona">
          <TextoInfo>
            El grupo que marques se entrena una vez a la semana. Los días que lo repetían no
            desaparecen: pasan a trabajar otra cosa, así que sigues entrenando los mismos días.
          </TextoInfo>
        </InfoTip>
      </View>

      <View style={styles.chipsRow}>
        {GRUPOS.map((grupo) => {
          const activo = sinRepetir.includes(grupo.valor);
          return (
            <Pressable
              key={grupo.valor}
              onPress={() => guardarSinRepetir(grupo.valor)}
              style={[styles.chip, activo && styles.chipOn]}
            >
              <Text style={[styles.chipText, activo && styles.chipTextOn]}>
                {grupo.nombre}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {entrenoMsg && <Text style={styles.msg}>{entrenoMsg}</Text>}
    </Card>
  );
}

/**
 * UNA disciplina a detalle: sesiones, propósito y nivel juntos, que es como
 * se razona sobre ella. La primaria solo edita nivel — sus días salen del
 * presupuesto semanal menos lo que se llevan las demás.
 */
export function EditorDisciplina({
  me,
  discipline,
}: {
  me: MeResponse | null;
  discipline: Discipline;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [primaria, setPrimaria] = useState<Discipline>("PESAS");
  const [otras, setOtras] = useState<CargaConModo[]>([]);
  const [niveles, setNiveles] = useState<Partial<Record<Discipline, SwimLevel>>>({});
  const [entrenoMsg, setEntrenoMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.profile) return;
    setPrimaria(me.profile.primaryDiscipline ?? "PESAS");
    setOtras(me.profile.otherDisciplines ?? []);
    setNiveles({
      NATACION: me.profile.swimLevel ?? "PRINCIPIANTE",
      ...(me.profile.disciplineLevels ?? {}),
    });
  }, [me]);

  const presupuestoSemanal = me?.profile?.trainingDaysPerWeek ?? 0;
  const esPrimaria = discipline === primaria;
  const carga = otras.find((entrada) => entrada.discipline === discipline);
  const nivel = niveles[discipline] ?? "PRINCIPIANTE";
  const opciones = NIVELES_POR_DISCIPLINA[discipline] ?? [];
  const diasGym = diasDeGimnasio(presupuestoSemanal, otras, primaria);

  /**
   * Guarda sesiones o propósito de esta disciplina. Se manda el entry
   * COMPLETO dentro de `otherDisciplines`: mandar solo el campo que cambió
   * perdería los otros en el camino.
   */
  async function actualizarCarga(
    cambios: Partial<Pick<CargaConModo, "sessionsPerWeek" | "proposito" | "importancia" | "modo" | "cardio">>,
  ) {
    const actual = otras.find((entrada) => entrada.discipline === discipline);
    // Quien afina cómo hace su cardio lo está pensando después de pesas: una
    // carga vieja sin `modo` (el PATCH lo tiraba antes de H2) se completa aquí.
    const modoPorCardio =
      cambios.cardio !== undefined && actual?.modo === undefined && cambios.modo === undefined
        ? "DESPUES"
        : undefined;
    const cardio = cambios.cardio !== undefined ? { ...actual?.cardio, ...cambios.cardio } : actual?.cardio;
    const entry: CargaConModo = {
      discipline,
      sessionsPerWeek: Math.max(
        0,
        Math.min(7, cambios.sessionsPerWeek ?? actual?.sessionsPerWeek ?? 0),
      ),
      proposito: cambios.proposito ?? actual?.proposito ?? "COMPLEMENTO",
      importancia: cambios.importancia ?? actual?.importancia ?? 2,
      // `modo` no se toca a menos que se pida explícito: subir sesiones o
      // cambiar propósito no debe voltear en silencio una preferencia que la
      // persona ya declaró (ni inventarle una a una carga vieja sin ella).
      ...(cambios.modo !== undefined || actual?.modo !== undefined || modoPorCardio
        ? { modo: cambios.modo ?? actual?.modo ?? modoPorCardio }
        : {}),
      ...(cardio ? { cardio } : {}),
    };
    const siguiente =
      entry.sessionsPerWeek > 0
        ? [...otras.filter((entrada) => entrada.discipline !== discipline), entry]
        : otras.filter((entrada) => entrada.discipline !== discipline);

    setOtras(siguiente);
    setEntrenoMsg(null);
    try {
      await patchEntrenamiento({ otherDisciplines: siguiente });
      const restantes = diasDeGimnasio(presupuestoSemanal, siguiente, primaria);
      setEntrenoMsg(
        entry.sessionsPerWeek === 0
          ? `Quitada. Te quedan ${restantes} ${restantes === 1 ? "día" : "días"} de gimnasio a la semana.`
          : `Guardado: te quedan ${restantes} ${restantes === 1 ? "día" : "días"} de gimnasio a la semana.`,
      );
    } catch (error) {
      setOtras(otras);
      setEntrenoMsg(error instanceof ApiError ? error.message : "No se pudo guardar tu disciplina");
    }
  }

  async function guardarNivel(valor: SwimLevel) {
    const anterior = niveles;
    const siguiente = { ...niveles, [discipline]: valor };
    setNiveles(siguiente);
    setEntrenoMsg(null);
    try {
      // Natación además mantiene `swimLevel`, que existía antes de que el
      // nivel fuera por disciplina y sigue siendo su respaldo.
      await patchEntrenamiento({
        disciplineLevels: siguiente,
        ...(discipline === "NATACION" ? { swimLevel: valor } : {}),
      });
      setEntrenoMsg("Guardado. Entra en tu siguiente sesión de esa disciplina.");
    } catch (error) {
      setNiveles(anterior);
      setEntrenoMsg(error instanceof ApiError ? error.message : "No se pudo guardar tu nivel");
    }
  }

  return (
    <Card>
      <View style={styles.sectionHeader}>
        <SectionLabel>{disciplinaNombre(discipline)}</SectionLabel>
        <InfoTip titulo={disciplinaNombre(discipline)}>
          {esPrimaria ? (
            <TextoInfo>
              Es tu disciplina primaria: arma el esqueleto de tu semana. Sus días de gimnasio
              salen de tu presupuesto semanal menos lo que se llevan las demás disciplinas.
            </TextoInfo>
          ) : (
            <TextoInfo>
              "Después de pesas" se anexa a tus días de gimnasio y no te quita presupuesto. "Día
              propio" busca un día libre y sí le quita días al gimnasio. En cero, la disciplina se
              quita de tu semana.
            </TextoInfo>
          )}
        </InfoTip>
      </View>

      {esPrimaria && (
        <Text style={styles.nota}>
          {diasGym} {diasGym === 1 ? "día" : "días"} de gimnasio a la semana.
        </Text>
      )}

      {!esPrimaria && carga && (
        <NumberStepper
          label="Sesiones por semana"
          value={carga.sessionsPerWeek}
          onChange={(sesiones) => actualizarCarga({ sessionsPerWeek: sesiones })}
          step={1}
          min={0}
        />
      )}

      {!esPrimaria && carga && (
        <View style={styles.chipsRow}>
          {PROPOSITOS.map((opcion) => (
            <Pressable
              key={opcion.valor}
              onPress={() => actualizarCarga({ proposito: opcion.valor })}
              style={[styles.chip, carga.proposito === opcion.valor && styles.chipOn]}
            >
              <Text
                style={[styles.chipText, carga.proposito === opcion.valor && styles.chipTextOn]}
              >
                {opcion.nombre}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {!esPrimaria && carga && (
        <View style={styles.subHeader}>
          <Text style={styles.subLabel}>Cómo convive con el gimnasio</Text>
          <InfoTip titulo="Después de pesas vs. día propio">
            <TextoInfo>
              Después de pesas: se anexa a un día que ya tienes de gimnasio, con sus minutos
              repartidos entre las dos — no te quita presupuesto de pesas. Día propio: busca un día
              libre para ella sola, y ese día sí sale de tu presupuesto semanal.
            </TextoInfo>
          </InfoTip>
        </View>
      )}

      {!esPrimaria && carga && (
        <View style={styles.chipsRow}>
          {(["DESPUES", "DIA_PROPIO"] as const).map((opcion) => {
            const activo = (carga.modo ?? "DIA_PROPIO") === opcion;
            return (
              <Pressable
                key={opcion}
                onPress={() => actualizarCarga({ modo: opcion })}
                style={[styles.chip, activo && styles.chipOn]}
              >
                <Text style={[styles.chipText, activo && styles.chipTextOn]}>
                  {textoModo(opcion)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {!esPrimaria && carga && discipline === "CARDIO" && (
        <EditorCardio
          prefs={{ ...CARDIO_POR_DEFECTO, ...carga.cardio }}
          onChange={(cardio) => actualizarCarga({ cardio })}
        />
      )}

      {!esPrimaria && !carga && (
        <Parrafo style={styles.nota}>
          Esta disciplina ya no está en tu semana. Regresa a la sección para volver a agregarla.
        </Parrafo>
      )}

      {opciones.length > 0 && discipline !== "CARDIO" && (
        <View style={styles.lista}>
          {opciones.map((opcion) => (
            <Pressable
              key={opcion.valor}
              onPress={() => guardarNivel(opcion.valor)}
              style={[styles.fila, nivel === opcion.valor && styles.filaOn]}
            >
              <Text style={[styles.filaNombre, nivel === opcion.valor && styles.filaNombreOn]}>
                {opcion.nombre}
              </Text>
              <Text style={styles.filaDetalle}>{opcion.detalle}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {entrenoMsg && <Text style={styles.msg}>{entrenoMsg}</Text>}
    </Card>
  );
}

/**
 * Cómo hace su cardio (H2): máquina, HIIT o continuo, nivel y minutos. Cada
 * toque guarda — sin botón de "guardar" que olvidar — y todo cabe en chips
 * de una línea; el porqué vive en el InfoTip.
 */
function EditorCardio({
  prefs,
  onChange,
}: {
  prefs: Required<PreferenciasCardio>;
  onChange: (cambios: PreferenciasCardio) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  function filaDeChips<T extends string>(
    opciones: Array<{ valor: T; nombre: string }>,
    actual: T,
    elegir: (valor: T) => void,
  ) {
    return (
      <View style={styles.chipsRow}>
        {opciones.map((opcion) => {
          const activo = actual === opcion.valor;
          return (
            <Pressable
              key={opcion.valor}
              onPress={() => elegir(opcion.valor)}
              style={[styles.chip, activo && styles.chipOn]}
            >
              <Text style={[styles.chipText, activo && styles.chipTextOn]}>{opcion.nombre}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <>
      <View style={styles.subHeader}>
        <Text style={styles.subLabel}>Cómo haces tu cardio</Text>
        <InfoTip titulo="HIIT o continuo">
          <TextoInfo>
            Para perder grasa rinden igual; el HIIT lo logra en menos minutos, por eso es el default
            al terminar pesas. El nivel decide el de la máquina (básico 6–8, medio 9–12, avanzado
            13+) y sube uno cada semana, con descarga la cuarta.
          </TextoInfo>
        </InfoTip>
      </View>
      {filaDeChips(OPCIONES_EQUIPO, prefs.equipo, (equipo) => onChange({ equipo }))}
      {filaDeChips(OPCIONES_TIPO, prefs.tipo, (tipo) => onChange({ tipo }))}
      {filaDeChips(OPCIONES_NIVEL, prefs.nivel, (nivel) => onChange({ nivel }))}
      <NumberStepper
        label="Minutos por sesión"
        value={prefs.minutos}
        onChange={(minutos) => onChange({ minutos: Math.max(10, Math.min(60, minutos)) })}
        step={5}
        min={10}
      />
    </>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    sectionHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    subHeader: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.md },
    subLabel: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.paloRosa },
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
    chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
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
    semanaLista: { gap: spacing.xs, marginTop: spacing.sm },
    semanaFila: { flexDirection: "row", alignItems: "center", gap: spacing.md },
    semanaDia: {
      width: 40,
      fontFamily: fonts.sansSemiBold,
      ...typeScale.label,
      letterSpacing: 1,
      color: colors.paloRosa,
    },
    semanaEtiqueta: {
      flex: 1,
      fontFamily: fonts.sansMedium,
      ...typeScale.bodySm,
      color: colors.marfil,
    },
    vacio: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.paloRosaLight,
      marginTop: spacing.md,
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
    diaFila: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
    // El editor del split: el día arriba y sus chips debajo. En fila no cabían
    // once tipos de día sin que cada chip quedara ilegible.
    splitDia: { gap: spacing.xs, marginTop: spacing.md },
    splitDiaNombre: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.label,
      letterSpacing: 1,
      color: colors.paloRosa,
    },
    splitChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    mensaje: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.champan },
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
    diaChipOn: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
    diaChipTexto: { fontFamily: fonts.sansMedium, ...typeScale.label, color: colors.marfil },
    diaChipTextoOn: { color: colors.pergamino },
    chipsBases: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    ejercicioFila: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    ejercicioNombre: {
      flex: 1,
      fontFamily: fonts.sansMedium,
      ...typeScale.bodySm,
      color: colors.marfil,
    },
    ejercicioBoton: { padding: 2 },
    nota: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.paloRosaLight,
      marginTop: spacing.md,
    },
    msg: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: colors.champan,
      marginTop: spacing.md,
    },
  });

/**
 * "Tu split": qué se entrena cada día de la semana.
 *
 * Dos niveles, en el orden en que se decide: primero un preset (un toque
 * resuelve el 90 % de los casos) y debajo el editor día por día, con chips —
 * porque el 10 % restante es gente que ya sabe qué quiere entrenar el martes y
 * a la que ofrecerle solo tres plantillas la deja fuera.
 *
 * Con split propio el motor NO reordena: si dos días se estorban lo dice en
 * los avisos de "Tu entrenamiento" y ella decide. Reacomodarle la semana a
 * quien la escribió con sus manos es como se pierde la confianza en el plan.
 */
export function EditorSplit({ me }: { me: MeResponse | null }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [split, setSplit] = useState<CustomSplit | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.profile) return;
    setSplit(me.profile.customSplit ?? null);
  }, [me]);

  async function guardar(siguiente: CustomSplit | null) {
    const anterior = split;
    setSplit(siguiente);
    setMensaje(null);
    try {
      await patchEntrenamiento({ customSplit: siguiente });
      setMensaje(
        siguiente === null
          ? "Listo: el split vuelve a armarlo la app."
          : "Guardado. Aplica desde la próxima semana que se arme.",
      );
    } catch (error) {
      setSplit(anterior);
      setMensaje(error instanceof ApiError ? error.message : "No se pudo guardar tu split");
    }
  }

  /** Cambiar un solo día conserva los demás; sin split propio arranca del vacío. */
  function cambiarDia(dia: WeekDay, valor: DayKind | "DESCANSO") {
    void guardar({ ...(split ?? {}), [dia]: valor });
  }

  const actual = resumenDeSplit(split);

  return (
    <>
      <Card>
        <View style={styles.sectionHeader}>
          <SectionLabel>Elige un formato</SectionLabel>
          <InfoTip titulo="Qué decide esto">
            <TextoInfo>
              Qué grupo entrenas cada día. Si lo dejas en el de la app, ella lo reparte según tus
              días y evita que el hombro caiga justo antes del día de pecho.
            </TextoInfo>
            <TextoInfo>
              Si lo eliges tú, la app respeta tu orden tal cual y solo te avisa cuando dos días se
              estorban. Aplica desde la próxima semana que se arme.
            </TextoInfo>
          </InfoTip>
        </View>

        <View style={styles.lista}>
          {OPCIONES_SPLIT.map((opcion) => {
            const activo =
              opcion.valor === "ACTUAL" ? split === null : actual === opcion.corto;
            return (
              <Pressable
                key={opcion.valor}
                onPress={() => guardar(opcion.valor === "ACTUAL" ? null : { ...opcion.dias })}
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

      <Card>
        <SectionLabel>Día por día</SectionLabel>
        <View style={styles.lista}>
          {DIAS_SEMANA.map((dia) => {
            const valor = split?.[dia.valor] ?? "DESCANSO";
            return (
              <View key={dia.valor} style={styles.splitDia}>
                <Text style={styles.splitDiaNombre}>{dia.nombre}</Text>
                <View style={styles.splitChips}>
                  {OPCIONES_DIA.map((opcion) => {
                    const activo = valor === opcion.valor;
                    return (
                      <Pressable
                        key={opcion.valor}
                        onPress={() => cambiarDia(dia.valor, opcion.valor)}
                        style={[styles.chip, activo && styles.chipOn]}
                      >
                        <Text style={[styles.chipText, activo && styles.chipTextOn]}>
                          {opcion.nombre}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </View>
      </Card>

      {mensaje && <Parrafo style={styles.mensaje}>{mensaje}</Parrafo>}
    </>
  );
}

/**
 * "Unilaterales": cómo se reparten las series de los ejercicios que se hacen
 * de un lado a la vez (búlgara, remo con mancuerna, curl concentrado).
 */
export function EditorUnilateral({ me }: { me: MeResponse | null }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [modo, setModo] = useState<UnilateralMode>("SEGUIDO");
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.profile) return;
    setModo(me.profile.unilateralMode ?? "SEGUIDO");
  }, [me]);

  async function guardar(valor: UnilateralMode) {
    const anterior = modo;
    setModo(valor);
    setMensaje(null);
    try {
      await patchEntrenamiento({ unilateralMode: valor });
      setMensaje("Guardado. Aplica desde la próxima semana que se arme.");
    } catch (error) {
      setModo(anterior);
      setMensaje(error instanceof ApiError ? error.message : "No se pudo guardar tu preferencia");
    }
  }

  return (
    <Card>
      <View style={styles.sectionHeader}>
        <SectionLabel>Ejercicios de un lado a la vez</SectionLabel>
        <InfoTip titulo="Cuáles son">
          <TextoInfo>
            La búlgara, el remo con mancuerna, el curl concentrado: los que se hacen con un brazo o
            una pierna. La app te cuenta las series por lado ("Derecho · serie 2 de 3") en vez de
            en una lista corrida.
          </TextoInfo>
        </InfoTip>
      </View>

      <View style={styles.lista}>
        {OPCIONES_UNILATERAL.map((opcion) => {
          const activo = modo === opcion.valor;
          return (
            <Pressable
              key={opcion.valor}
              onPress={() => guardar(opcion.valor)}
              style={[styles.fila, activo && styles.filaOn]}
            >
              <Text style={[styles.filaNombre, activo && styles.filaNombreOn]}>{opcion.nombre}</Text>
              <Text style={styles.filaDetalle}>{opcion.detalle}</Text>
            </Pressable>
          );
        })}
      </View>

      {mensaje && <Parrafo style={styles.mensaje}>{mensaje}</Parrafo>}
    </Card>
  );
}

/**
 * "Ejercicios": la sugerencia de Coachy, o los que ella eligió.
 *
 * EL PROBLEMA: el generador elegía los ejercicios y no había forma de decir
 * "ese no, este sí". Quien ya sabe con qué entrena su pecho tenía que
 * cambiarlos uno por uno cada semana desde el gimnasio — que es como se
 * termina entrenando fuera de la app.
 *
 * Tres niveles, cada uno en su hoja (la ley de densidad: nada se abre hacia
 * abajo): la lista de tipos de día, el editor de un día, y el catálogo para
 * agregar. Lo que se guarda es el mapa completo `{tipoDeDía: [ids]}`, igual
 * que el split, para que dos ediciones seguidas no se pisen.
 */
export function EditorEjercicios() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const { dias, error, recargar } = useEjerciciosPorDia();

  if (error) return <Parrafo style={styles.mensaje}>{error}</Parrafo>;
  if (!dias) return <Text style={styles.mensaje}>Cargando tus ejercicios...</Text>;

  return (
    <>
      <Card>
        <View style={styles.sectionHeader}>
          <SectionLabel>Por tipo de día</SectionLabel>
          <InfoTip titulo="Quién elige los ejercicios">
            <TextoInfo>
              Coachy los propone según tu objetivo, tu condición de hoy y las zonas que están lejos
              de tu referencia. Es lo que pasa si no tocas nada.
            </TextoInfo>
            <TextoInfo>
              Si prefieres los tuyos, los eliges por tipo de día y en el orden que quieras. Coachy
              solo completa si te falta volumen, y el tiempo del día sigue mandando: lo que no cabe
              en tus minutos se recorta igual.
            </TextoInfo>
          </InfoTip>
        </View>

        <View style={styles.lista}>
          {dias.map((dia) => (
            <Pressable
              key={dia.dayKind}
              onPress={() => router.push(`/ajustes/detalle/ejercicios?k=${dia.dayKind}`)}
              style={styles.fila}
            >
              <Text style={styles.filaNombre}>{dia.label}</Text>
              <Text style={styles.filaDetalle}>
                {dia.sigueACoachy
                  ? "Sugerencia de Coachy"
                  : `Elegidos por ti · ${dia.elegidos.length}`}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      {dias.length === 0 && (
        <Text style={styles.mensaje} onPress={recargar}>
          Todavía no hay split armado. Toca para reintentar.
        </Text>
      )}
    </>
  );
}

/** Los días con su sugerencia, recargables. Lo comparten las tres hojas. */
function useEjerciciosPorDia(): {
  dias: DiaDeEjercicios[] | null;
  error: string | null;
  recargar: () => void;
} {
  const [dias, setDias] = useState<DiaDeEjercicios[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(() => {
    setError(null);
    getEjerciciosPorDia()
      .then((respuesta) => setDias(respuesta.dias))
      .catch((problema) =>
        setError(problema instanceof ApiError ? problema.message : "No se pudieron cargar"),
      );
  }, []);

  useEffect(() => recargar(), [recargar]);

  return { dias, error, recargar };
}

/** El mapa completo que espera el servidor, con un día sustituido. */
function mapaDeEjercicios(
  dias: DiaDeEjercicios[],
  dayKind: string,
  ejercicios: string[],
): Record<string, string[]> {
  const mapa: Record<string, string[]> = {};
  for (const dia of dias) {
    const lista = dia.dayKind === dayKind ? ejercicios : dia.elegidos;
    if (lista.length > 0) mapa[dia.dayKind] = lista;
  }
  return mapa;
}

/**
 * El editor de un tipo de día: quitar, reordenar, agregar, o volver a la
 * sugerencia.
 *
 * Arranca de la sugerencia de Coachy cuando no hay lista propia — editarla es
 * quitarle uno, no armar la sesión desde cero. En el momento en que se toca
 * algo, esa lista se vuelve suya y se guarda entera.
 */
export function EditorEjerciciosDia({ dayKind }: { dayKind: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const { dias, error } = useEjerciciosPorDia();
  const [lista, setLista] = useState<string[] | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const dia = dias?.find((entrada) => entrada.dayKind === dayKind) ?? null;

  useEffect(() => {
    if (!dia) return;
    setLista(dia.elegidos.length > 0 ? dia.elegidos : dia.sugeridos.map((e) => e.id));
  }, [dia]);

  /** El nombre de un id, venga de la sugerencia o del catálogo cacheado. */
  const nombres = useMemo(() => {
    const mapa: Record<string, string> = {};
    for (const entrada of dias ?? []) {
      for (const ejercicio of entrada.sugeridos) mapa[ejercicio.id] = ejercicio.name;
    }
    return mapa;
  }, [dias]);

  async function guardar(siguiente: string[] | null) {
    if (!dias) return;
    const anterior = lista;
    setLista(siguiente);
    setMensaje(null);
    try {
      await patchEjerciciosManuales(
        siguiente === null ? mapaDeEjercicios(dias, dayKind, []) : mapaDeEjercicios(dias, dayKind, siguiente),
      );
      setMensaje(
        siguiente === null
          ? "Listo: este día vuelve a la sugerencia de Coachy."
          : "Guardado. Aplica desde la próxima semana que se arme.",
      );
    } catch (problema) {
      setLista(anterior);
      setMensaje(problema instanceof ApiError ? problema.message : "No se pudo guardar");
    }
  }

  function mover(indice: number, salto: number) {
    if (!lista) return;
    const destino = indice + salto;
    if (destino < 0 || destino >= lista.length) return;
    const siguiente = [...lista];
    siguiente[indice] = lista[destino]!;
    siguiente[destino] = lista[indice]!;
    void guardar(siguiente);
  }

  if (error) return <Parrafo style={styles.mensaje}>{error}</Parrafo>;
  if (!dia || !lista) return <Text style={styles.mensaje}>Cargando...</Text>;

  return (
    <>
      <Card>
        <View style={styles.sectionHeader}>
          <SectionLabel>{dia.label}</SectionLabel>
          <InfoTip titulo="Por qué te propone esto">
            <TextoInfo>{dia.porque}</TextoInfo>
            <TextoInfo>
              El orden es el de la sesión: lo primero es lo que entrenas con más fuerza. Si tu lista
              se queda corta, Coachy completa con su sugerencia.
            </TextoInfo>
          </InfoTip>
        </View>

        <Parrafo style={styles.nota}>{dia.porque}</Parrafo>

        <View style={styles.lista}>
          {lista.map((id, indice) => (
            <View key={id} style={styles.ejercicioFila}>
              <Text style={styles.ejercicioNombre} numberOfLines={1}>
                {nombres[id] ?? id}
              </Text>
              <Pressable onPress={() => mover(indice, -1)} hitSlop={8} style={styles.ejercicioBoton}>
                <ChevronUp size={18} color={colors.paloRosa} strokeWidth={2} />
              </Pressable>
              <Pressable onPress={() => mover(indice, 1)} hitSlop={8} style={styles.ejercicioBoton}>
                <ChevronDown size={18} color={colors.paloRosa} strokeWidth={2} />
              </Pressable>
              <Pressable
                onPress={() => guardar(lista.filter((otro) => otro !== id))}
                hitSlop={8}
                style={styles.ejercicioBoton}
              >
                <X size={18} color={colors.champan} strokeWidth={2} />
              </Pressable>
            </View>
          ))}
        </View>
      </Card>

      <Card>
        <View style={styles.lista}>
          <Pressable
            onPress={() => router.push(`/ajustes/detalle/ejercicios?k=${dayKind}&agregar=1`)}
            style={styles.fila}
          >
            <Text style={styles.filaNombre}>Agregar del catálogo</Text>
            <Text style={styles.filaDetalle}>Los del grupo que entrenas este día</Text>
          </Pressable>

          {!dia.sigueACoachy && (
            <Pressable onPress={() => guardar(null)} style={styles.fila}>
              <Text style={styles.filaNombre}>Volver a la sugerencia</Text>
              <Text style={styles.filaDetalle}>Coachy vuelve a elegir este día</Text>
            </Pressable>
          )}
        </View>

        {mensaje && <Parrafo style={styles.mensaje}>{mensaje}</Parrafo>}
      </Card>
    </>
  );
}

/**
 * El catálogo para agregar un ejercicio a un tipo de día.
 *
 * Filtrado por los grupos musculares que ese día entrena: ofrecer curl de
 * bíceps en el día de pierna solo hace la lista más larga. Agregar guarda y
 * regresa — un toque, una decisión.
 */
export function EditorAgregarEjercicio({ dayKind }: { dayKind: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const { dias, error } = useEjerciciosPorDia();
  const [catalogo, setCatalogo] = useState<EjercicioGym[] | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    getCatalogoGym()
      .then((respuesta) => setCatalogo(respuesta.ejercicios))
      .catch(() => setMensaje("No se pudo cargar el catálogo"));
  }, []);

  const dia = dias?.find((entrada) => entrada.dayKind === dayKind) ?? null;

  const candidatos = useMemo(() => {
    if (!dia || !catalogo) return [];
    // Los grupos del día salen de la propia sugerencia: es la misma receta que
    // usa el generador, así que no hay una segunda lista que mantener.
    const grupos = new Set(dia.sugeridos.map((ejercicio) => ejercicio.muscleGroup));
    const yaEstan = new Set(dia.elegidos.length > 0 ? dia.elegidos : dia.sugeridos.map((e) => e.id));
    return catalogo.filter(
      (ejercicio) => grupos.has(ejercicio.muscleGroup) && !yaEstan.has(ejercicio.id),
    );
  }, [dia, catalogo]);

  async function agregar(id: string) {
    if (!dias || !dia) return;
    const base = dia.elegidos.length > 0 ? dia.elegidos : dia.sugeridos.map((e) => e.id);
    try {
      await patchEjerciciosManuales(mapaDeEjercicios(dias, dayKind, [...base, id]));
      router.back();
    } catch (problema) {
      setMensaje(problema instanceof ApiError ? problema.message : "No se pudo agregar");
    }
  }

  if (error) return <Parrafo style={styles.mensaje}>{error}</Parrafo>;
  if (!dia || !catalogo) return <Text style={styles.mensaje}>Cargando el catálogo...</Text>;

  return (
    <Card>
      <SectionLabel>{dia.label}</SectionLabel>
      <View style={styles.lista}>
        {candidatos.map((ejercicio) => (
          <Pressable key={ejercicio.id} onPress={() => agregar(ejercicio.id)} style={styles.fila}>
            <Text style={styles.filaNombre}>{ejercicio.name}</Text>
            <Text style={styles.filaDetalle}>{ejercicio.equipment}</Text>
          </Pressable>
        ))}
      </View>
      {mensaje && <Parrafo style={styles.mensaje}>{mensaje}</Parrafo>}
    </Card>
  );
}

/** Hasta tres disciplinas base: más que eso ya no es una semana, es una lista de deseos. */
const MAX_BASES = 3;

/**
 * "Disciplinas base": lo que SÍ se planea en la semana.
 *
 * EL CAMBIO DE MODELO: antes toda disciplina que se practicaba tenía que
 * declarar sesiones por semana. Eso es verdad para lo que se entrena en serio
 * —la base— y es una promesa que nadie puede cumplir para lo demás. Ahora la
 * persona elige de una a tres bases; el planificador solo mete esas en el
 * plan, con todo lo que ya sabía hacer (repartir minutos el mismo día, o dar
 * días propios). Lo demás se agrega el día, con el tiempo que sobre.
 *
 * La primera elegida es la primaria: la que arma el esqueleto de la semana.
 */
export function EditorDisciplinasBase({ me }: { me: MeResponse | null }) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [bases, setBases] = useState<Discipline[]>([]);
  const [cargas, setCargas] = useState<CargaConModo[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    if (!me?.profile) return;
    const primaria = me.profile.primaryDiscipline ?? "PESAS";
    const otras = me.profile.otherDisciplines ?? [];
    setBases([primaria, ...otras.map((carga) => carga.discipline)]);
    setCargas(otras);
  }, [me]);

  async function guardar(siguientes: Discipline[]) {
    const anteriores = bases;
    setBases(siguientes);
    setMensaje(null);

    const primaria = siguientes[0]!;
    // Las bases que ya tenían carga conservan la suya; una nueva entra con el
    // default de formulario (una sesión, el mismo día que pesas), que es lo
    // que casi siempre se quiere y se afina en su propio renglón.
    const otras: CargaConModo[] = siguientes.slice(1).map(
      (discipline) =>
        cargas.find((carga) => carga.discipline === discipline) ?? {
          discipline,
          sessionsPerWeek: 1,
          proposito: "COMPLEMENTO",
          importancia: 2,
          modo: "DESPUES",
        },
    );

    try {
      await patchEntrenamiento({ primaryDiscipline: primaria, otherDisciplines: otras });
      setCargas(otras);
      setMensaje("Guardado. Aplica desde la próxima semana que se arme.");
    } catch (error) {
      setBases(anteriores);
      setMensaje(error instanceof ApiError ? error.message : "No se pudieron guardar tus bases");
    }
  }

  function alternar(discipline: Discipline) {
    if (bases.includes(discipline)) {
      // Nunca sin base: la semana necesita algo que la arme.
      if (bases.length === 1) return;
      void guardar(bases.filter((otra) => otra !== discipline));
      return;
    }
    if (bases.length >= MAX_BASES) {
      setMensaje("Tres bases es el tope. Lo demás lo agregas el día que te sobre tiempo.");
      return;
    }
    void guardar([...bases, discipline]);
  }

  return (
    <>
      <Card>
        <View style={styles.sectionHeader}>
          <SectionLabel>Tus disciplinas base</SectionLabel>
          <InfoTip titulo="Qué es una base">
            <TextoInfo>
              Lo que entrenas en serio y quieres que la app planee: le reserva días, le reparte los
              minutos y ajusta el gimnasio alrededor. La primera que elijas arma el esqueleto de tu
              semana.
            </TextoInfo>
            <TextoInfo>
              Lo que no sea base lo agregas el día, con el tiempo que te sobre. Eso no le quita días
              a nada ni te deja debiendo sesiones.
            </TextoInfo>
          </InfoTip>
        </View>

        <View style={styles.chipsBases}>
          {DISCIPLINAS.map((entrada) => {
            const posicion = bases.indexOf(entrada.valor);
            const activo = posicion !== -1;
            return (
              <Pressable
                key={entrada.valor}
                onPress={() => alternar(entrada.valor)}
                style={[styles.chip, activo && styles.chipOn]}
              >
                <Text style={[styles.chipText, activo && styles.chipTextOn]}>
                  {posicion === 0 ? `${entrada.nombre} · principal` : entrada.nombre}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Parrafo style={styles.nota}>
          Lo que no sea base lo agregas el día, con el tiempo que te sobre.
        </Parrafo>

        {mensaje && <Parrafo style={styles.mensaje}>{mensaje}</Parrafo>}
      </Card>

      <Card>
        <SectionLabel>Cómo entrena cada base</SectionLabel>
        <View style={styles.lista}>
          {bases.slice(1).map((discipline) => {
            const carga = cargas.find((entrada) => entrada.discipline === discipline);
            return (
              <Pressable
                key={discipline}
                onPress={() => router.push(`/ajustes/detalle/disciplina?d=${discipline}`)}
                style={styles.fila}
              >
                <Text style={styles.filaNombre}>{disciplinaNombre(discipline)}</Text>
                <Text style={styles.filaDetalle}>
                  {carga && discipline === "CARDIO"
                    ? renglonDeCardio(carga).replace(/^Cardio · /, "")
                    : carga
                      ? `${carga.sessionsPerWeek}/semana · ${textoModo(carga.modo)}`
                      : "1/semana · el mismo día que pesas"}
                </Text>
              </Pressable>
            );
          })}
          {bases.length === 1 && (
            <Text style={styles.filaDetalle}>
              Solo tienes tu base principal. Lo demás va como bloque del día.
            </Text>
          )}
        </View>
      </Card>
    </>
  );
}
