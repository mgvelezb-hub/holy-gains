import { useRouter } from "expo-router";
import {
  Activity as ActivityIcon,
  CalendarCheck,
  ChevronRight,
  ClipboardCheck,
  Dumbbell,
  Flame,
  FlaskConical,
  Footprints,
  HeartPulse,
  Moon,
  Target,
  Timer,
  TrendingUp,
  Trophy,
  Waves,
} from "lucide-react-native";
import { useMemo, type ComponentType } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ActivityRings, type Ring } from "@/components/ActivityRings";
import { ChartBoundary } from "@/components/ChartBoundary";
import { GapChart, type Brecha } from "@/components/GapChart";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { LineChart } from "@/components/LineChart";
import { PanelGrande } from "@/components/PanelGrande";
import { Parrafo } from "@/components/Parrafo";
import { RadarChart, type Eje } from "@/components/RadarChart";
import { ScoreTile } from "@/components/ScoreTile";
import { useTheme } from "@/context/theme";
import { iconoDe } from "@/lib/disciplinas";
import {
  DISCIPLINE_LABELS,
  type Discipline,
  type Activity,
  type CheckInPoint,
  type CheckInRow,
  type ComidasResponse,
  type Decision,
  type GoalResponse,
  type HealthDayPayload,
  type LabResult,
  type MeResponse,
  type PersonalRecord,
  type TrainingHistoryRow,
  type WeekView,
} from "@/lib/api";
import type { GolfResponse } from "@/lib/api-golf";
import { textoDeGlidepath, type Glidepath } from "@/lib/glidepath";
import { EJERCICIO_META_MIN, PASOS_META, SUENO_META_MIN, formatSleep } from "@/lib/insights";
import { brechasDelMes, type MetasDelMes } from "@/lib/metas";
import type { PanelConfig } from "@/lib/paneles";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";

/**
 * Un panel del Resumen, ya resuelto.
 *
 * Vive aparte de la pantalla porque lo usan DOS lugares: el Resumen y el
 * editor, que enseña el tablero de verdad mientras se acomoda. Un editor con
 * cajas grises que dicen el nombre del panel obliga a salir, mirar y volver a
 * entrar por cada cambio; con el panel real, lo que se ve al acomodar es lo
 * que va a quedar.
 *
 * Recibe la vista ya calculada —no vuelve a pedir nada— para que pintarlo dos
 * veces no cueste dos cargas.
 */

export type VistaResumen = {
  datos: {
    sessions: TrainingHistoryRow[] | null;
    records: PersonalRecord[] | null;
    checkIns: CheckInRow[] | null;
    healthDays: HealthDayPayload[] | null;
    activities: Activity[] | null;
    week: WeekView | null;
    goal: GoalResponse | null;
    decision: Decision | null;
    points: CheckInPoint[] | null;
    me: MeResponse | null;
    labs: LabResult[] | null;
    comidas: ComidasResponse | null;
    /** Agregados de golf (`getGolf()`) — `null` si el fetch falló, no si no hay rondas. */
    golf: GolfResponse | null;
  };
  pasos: { value: number; date: string } | null;
  ejercicio: { value: number; date: string } | null;
  sueno: { value: number; date: string } | null;
  hrv: { value: number; date: string } | null;
  vo2: { value: number; date: string } | null;
  fecha: string | null;
  rings: Ring[];
  ejes: Eje[];
  metas: MetasDelMes;
  brechas: Brecha[];
  plan: Glidepath | null;
  ultimoCheckIn: CheckInRow | null;
  diasCheckIn: number | null;
  checkInPendiente: boolean;
  sesionesTotal: number;
  sesionesHechas: number;
  streak: number;
  best: number;
  prs: PersonalRecord[];
  ultimoPr: PersonalRecord | null;
  objetivoEstado: string | null;
  objetivoListo: boolean;
  objetivoLabel: string | null;
  anchoPanel: number;
  ultimoLab: LabResult | null;
  cumplimiento: {
    rutina: number | null;
    rutinaDetalle: string | null;
    dieta: number | null;
    dietaMedida: boolean;
    dietaContestadas: number;
  };
  serieDe: (campo: "waistCm" | "weightKg") => number[];
  serieSalud: (campo: "steps" | "sleepMin" | "hrvMs" | "vo2max") => number[];
  puntosSalud: (
    campo: "steps" | "sleepMin" | "hrvMs" | "vo2max",
  ) => Array<{ date: string; value: number | null }>;
  formatDateEs: (fecha: string) => string;
};

const DIAS_SEMANA = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];

/** Una fila de los anillos: ícono, valor y su meta, tocable hasta el detalle. */
function Leyenda({
  icon: Icon,
  color,
  label,
  valor,
  meta,
  onPress,
}: {
  icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  color: string;
  label: string;
  valor: string;
  meta: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.leyenda, pressed && styles.pressed]}>
      <Icon size={16} color={color} strokeWidth={2} />
      <View style={styles.leyendaTexto}>
        <Text style={styles.leyendaValor}>{valor}</Text>
        <Text style={styles.leyendaLabel}>
          {label} · {meta}
        </Text>
      </View>
      {/* La flecha en CADA renglón dice "esto abre algo" sin un letrero
          arriba: era la queja literal sobre el "toca cualquiera". */}
      <ChevronRight size={14} color={colors.pergaminoSoft} strokeWidth={2} />
    </Pressable>
  );
}

function Macro({ label, valor }: { label: string; valor: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.macro}>
      <Text style={styles.macroLabel}>{label}</Text>
      <Text style={styles.macroValor}>{valor}</Text>
    </View>
  );
}

/** La firma que comparten los íconos del set y los propios de las disciplinas. */
type IconoProps = { size?: number; color?: string; strokeWidth?: number };

export function PanelResumen({
  config,
  vista,
}: {
  config: PanelConfig;
  vista: VistaResumen;
}): React.ReactNode {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const {
    datos,
    pasos,
    ejercicio,
    sueno,
    hrv,
    vo2,
    fecha,
    rings,
    ejes,
    metas,
    brechas,
    plan,
    ultimoCheckIn,
    diasCheckIn,
    checkInPendiente,
    sesionesTotal,
    sesionesHechas,
    streak,
    best,
    prs,
    ultimoPr,
    objetivoEstado,
    objetivoListo,
    objetivoLabel,
    anchoPanel,
    ultimoLab,
    cumplimiento,
    serieDe,
    serieSalud,
    puntosSalud,
    formatDateEs,
  } = vista;

  function navegar(ruta: string) {
    router.push(ruta as never);
  }

  // `vista` (el objeto con los datos) y `vista` (la del panel) colisionaban:
  // la del panel se llama `estilo` aquí adentro.
  const { id, tamano, vista: estilo } = config;
  const mini = tamano === "mini";
  const completa = tamano === "completa";

  /**
   * Las dos preguntas del panel, separadas: el TAMAÑO dice cuánto espacio
   * ocupa y la VISTA qué se dibuja dentro. Un `compacta` con vista de
   * tendencia trae su chispa; el mismo `compacta` con vista de desglose trae
   * sus partes. Antes las dos cosas iban en un solo eje y varias
   * combinaciones daban la misma tarjeta.
   */
  const conTendencia = estilo === "tendencia";
  const conDesglose = estilo === "desglose";
  const conMeta = estilo === "meta" || estilo === "desglose";

  /**
   * El cuadro chico. Todos los `mini` se ven igual: un dato, una línea y su
   * estado. Sin gráficas y sin párrafos — para eso están los otros dos.
   */
  function cuadro(props: {
    icon: ComponentType<IconoProps>;
    tint: string;
    title: string;
    value: string;
    detail?: string | null;
    status?: { label: string; tone: "ok" | "warn" | "alto" | "neutral" } | null;
    serie?: number[];
    onPress?: () => void;
  }) {
    return (
      <ScoreTile
        icon={props.icon}
        tint={props.tint}
        title={props.title}
        value={props.value}
        // Con vista "solo el número" el cuadro se queda con el número: es lo
        // que se pidió y es lo que se entrega.
        detail={estilo === "dato" ? null : (props.detail ?? null)}
        status={props.status ?? null}
        serie={conTendencia ? props.serie : undefined}
        onPress={props.onPress}
      />
    );
  }

  /**
   * El renglón bajo y el renglón alto comparten cabecera; lo único que cambia
   * es si llevan cuerpo. Así "compacta" y "completa" nunca se ven iguales por
   * accidente: si no hay `children`, no hay cuerpo.
   */
  function renglon(props: {
    icon: ComponentType<IconoProps>;
    tint: string;
    title: string;
    value: string;
    detail?: string | null;
    status?: { label: string; tone: "ok" | "warn" | "alto" | "neutral" } | null;
    onPress?: () => void;
    /** El desglose: la lista, los macros, los valores. */
    children?: React.ReactNode;
    /** La serie, para la vista de tendencia. */
    serie?: number[];
    puntos?: Array<{ date: string; value: number | null }>;
    formato?: (valor: number) => string;
    /** Meta a marcar en la gráfica, si la hay. */
    meta?: number | null;
    /** El "porqué" del panel, guardado junto al título en vez de amontonado en el cuerpo. */
    infoTip?: React.ReactNode;
  }) {
    const cuerpo = conDesglose
      ? props.children
      : conTendencia && props.puntos && completa
        ? (
            <ChartBoundary label="La tendencia no se pudo dibujar.">
              <LineChart
                points={props.puntos}
                color={props.tint}
                goal={props.meta ?? null}
                format={props.formato}
              />
            </ChartBoundary>
          )
        : null;

    return (
      <PanelGrande
        icon={props.icon}
        tint={props.tint}
        title={props.title}
        value={props.value}
        detail={estilo === "dato" ? null : (props.detail ?? null)}
        status={props.status ?? null}
        onPress={props.onPress}
        // En compacta la tendencia cabe como chispa; la gráfica grande es de
        // la completa.
        serie={conTendencia && !completa ? props.serie : undefined}
        infoTip={props.infoTip}
      >
        {cuerpo}
      </PanelGrande>
    );
  }

  switch (id) {
    // -----------------------------------------------------------------------
    case "anillos": {
      const resumenDia = [
        pasos ? `${pasos.value.toLocaleString("es-MX")} pasos` : null,
        ejercicio ? `${ejercicio.value} min` : null,
        sueno ? formatSleep(sueno.value) : null,
      ]
        .filter(Boolean)
        .join(" · ");

      return (
        <View style={styles.hero}>
          <View style={styles.heroHead}>
            <Text style={styles.heroTitle}>Tu día</Text>
          </View>

          <View style={styles.heroBody}>
            <ActivityRings rings={rings} size={completa ? 132 : 96} />

            {conMeta ? (
              <View style={styles.leyendas}>
                <Leyenda
                  icon={Footprints}
                  color={colors.champan}
                  label="Pasos"
                  valor={pasos ? `${pasos.value.toLocaleString("es-MX")}` : "—"}
                  meta={`de ${PASOS_META.toLocaleString("es-MX")}`}
                  onPress={() => navegar("/salud/pasos")}
                />
                <Leyenda
                  icon={Timer}
                  color={colors.guindaLight}
                  label="Ejercicio"
                  valor={ejercicio ? `${ejercicio.value} min` : "—"}
                  // La meta viene del anillo, que ya la calcula del plan real
                  // del día (metaDeHoy): decir "de 30 min" a quien entrena 120
                  // era la queja literal.
                  meta={`de ${rings.find((r) => r.label === "Ejercicio")?.goal ?? EJERCICIO_META_MIN} min`}
                  onPress={() => navegar("/salud/ejercicio")}
                />
                <Leyenda
                  icon={Moon}
                  color={colors.paloRosa}
                  label="Sueño"
                  valor={sueno ? formatSleep(sueno.value) : "—"}
                  meta={`de ${formatSleep(SUENO_META_MIN)}`}
                  onPress={() => navegar("/salud/descanso")}
                />
              </View>
            ) : (
              <View style={styles.leyendas}>
                <Text style={styles.heroResumen}>{resumenDia || "Sin datos del reloj todavía"}</Text>
                <Text style={styles.heroCaption}>
                  {fecha ? `Último dato: ${formatDateEs(fecha)}` : "Conecta tu reloj"}
                </Text>
              </View>
            )}
          </View>

          {conDesglose && completa && (
            <View style={styles.extras}>
              <Leyenda
                icon={HeartPulse}
                color={colors.error}
                label="Recuperación"
                valor={hrv ? `${hrv.value} ms` : "Sin dato"}
                meta={hrv ? "vs. tu normal de 4 semanas" : "el reloj no la ha subido"}
                onPress={() => navegar("/salud/recuperacion")}
              />
              <Leyenda
                icon={ActivityIcon}
                color={colors.champan}
                label="Condición"
                valor={vo2 ? `${vo2.value}` : "Sin dato"}
                meta={vo2 ? "VO₂ máx" : "necesita entrenos al aire libre"}
                onPress={() => navegar("/salud/condicion")}
              />
            </View>
          )}
        </View>
      );
    }

    // -----------------------------------------------------------------------
    case "perfil": {
      const conDato = ejes.filter((eje) => eje.value !== null && typeof eje.esperado === "number");
      const peor = [...conDato].sort(
        (a, b) => (a.value! - (a.esperado ?? 0)) - (b.value! - (b.esperado ?? 0)),
      )[0];

      return (
        <View style={styles.perfil}>
          <Text style={styles.heroTitle}>Tu semana vs. lo esperado</Text>

          {conDesglose ? (
            <>
              <Parrafo style={styles.heroCaption}>
                Cada eje contra lo que tocaba a estas alturas
                {objetivoLabel ? `, para tu objetivo de ${objetivoLabel}` : ""}.
              </Parrafo>
              <ChartBoundary label="La telaraña no se pudo dibujar.">
                <RadarChart ejes={ejes} size={completa ? 260 : 220} />
              </ChartBoundary>
            </>
          ) : (
            <>
              <Parrafo style={styles.heroCaption}>
                {peor
                  ? `Lo que más te falta: ${peor.label}, ${Math.abs(
                      Math.round((peor.value! - (peor.esperado ?? 0)) * 100),
                    )} puntos abajo de lo esperado.`
                  : "Todavía sin datos suficientes para comparar tu semana."}
              </Parrafo>
              <View style={styles.ejesFila}>
                {conDato.map((eje) => {
                  const desvio = Math.round((eje.value! - (eje.esperado ?? 0)) * 100);
                  return (
                    <View key={eje.label} style={styles.ejePastilla}>
                      <Text style={styles.ejeNombre}>{eje.label}</Text>
                      <Text style={[styles.ejeValor, desvio < -5 && styles.ejeValorBajo]}>
                        {desvio > 0 ? "+" : ""}
                        {desvio}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </View>
      );
    }

    // -----------------------------------------------------------------------
    case "mes": {
      if (metas.medidas.length === 0) return null;
      const rieles = brechasDelMes(metas.medidas);
      const alCorriente = rieles.filter((riel) => (riel.avance ?? 0) >= 1).length;

      if (mini) {
        return cuadro({
          icon: TrendingUp,
          tint: colors.champan,
          title: "Tu mes",
          value: `${alCorriente}/${rieles.length}`,
          detail: "metas del mes cumplidas",
          onPress: () => navegar("/glidepath"),
        });
      }

      return (
        <View style={styles.perfil}>
          <Text style={styles.heroTitle}>Tu mes</Text>
          <Parrafo style={styles.heroCaption}>
            Dónde estás hoy y a dónde llega el escalón de este mes, desde tu check-in del{" "}
            {metas.desde}
          </Parrafo>

          <View style={{ marginTop: spacing.md }}>
            <ChartBoundary label="Las metas del mes no se pudieron dibujar.">
              <GapChart brechas={conDesglose ? rieles : rieles.slice(0, 2)} />
            </ChartBoundary>
          </View>

          <Pressable onPress={() => navegar("/glidepath")} hitSlop={6}>
            <Text style={styles.glidepathLink}>
              {conDesglose ? "Ver todo el camino al objetivo →" : `Ver las ${rieles.length} medidas →`}
            </Text>
          </Pressable>
        </View>
      );
    }

    // -----------------------------------------------------------------------
    case "brecha_objetivo": {
      if (brechas.length === 0) return null;
      const masLejos = [...brechas].sort((a, b) => (a.avance ?? 0) - (b.avance ?? 0))[0];

      if (mini) {
        return cuadro({
          icon: Target,
          tint: colors.guindaLight,
          title: "Vs. objetivo",
          value: masLejos?.label ?? "—",
          detail: "la zona más lejana",
          onPress: () => navegar("/objetivo"),
        });
      }

      return (
        <View style={styles.perfil}>
          <Text style={styles.heroTitle}>Vs. tu objetivo final</Text>
          <Parrafo style={styles.heroCaption}>
            {objetivoListo
              ? "Sale de comparar tus fotos con tu referencia: es una lectura por zona, no centímetros."
              : "Todavía sin fotos tuyas: esto es el énfasis que pide tu referencia, no tu brecha."}
          </Parrafo>
          <View style={{ marginTop: spacing.md }}>
            <ChartBoundary label="La brecha no se pudo dibujar.">
              <GapChart brechas={conDesglose ? brechas : brechas.slice(0, 3)} />
            </ChartBoundary>
          </View>

          <Pressable onPress={() => navegar("/objetivo")} hitSlop={6}>
            <Text style={styles.glidepathLink}>
              {conDesglose ? "Ver tu objetivo →" : `Ver las ${brechas.length} zonas →`}
            </Text>
          </Pressable>
        </View>
      );
    }

    // -----------------------------------------------------------------------
    case "cintura": {
      const valor = ultimoCheckIn?.waistCm != null ? `${ultimoCheckIn.waistCm} cm` : "—";
      const detalle = ultimoCheckIn
        ? `${datos.checkIns?.length ?? 0} check-ins · ${formatDateEs(ultimoCheckIn.date)}`
        : "Tu primer check-in arranca el historial";

      const contexto = conMeta && plan ? `meta del mes ${plan.meta} cm` : detalle;

      if (mini) {
        return cuadro({
          icon: TrendingUp,
          tint: colors.champan,
          title: "Cintura",
          value: valor,
          detail: contexto,
          serie: serieDe("waistCm"),
          onPress: () => navegar("/salud/medidas"),
        });
      }

      return renglon({
        icon: TrendingUp,
        tint: colors.champan,
        title: "Cintura",
        value: valor,
        detail: conMeta && plan ? `${detalle} · meta del mes ${plan.meta} cm` : detalle,
        onPress: () => navegar("/salud/medidas"),
        serie: serieDe("waistCm"),
        puntos: (datos.points ?? [])
          .slice(-10)
          .map((punto) => ({ date: punto.date, value: punto.waistCm })),
        formato: (valor: number) => `${valor} cm`,
        meta: plan?.meta ?? null,
        children: plan ? <Parrafo style={styles.panelNota}>{textoDeGlidepath(plan)}</Parrafo> : null,
      });
    }

    // -----------------------------------------------------------------------
    case "checkin": {
      const valor = diasCheckIn === null ? "—" : diasCheckIn === 0 ? "Hoy" : `${diasCheckIn} d`;
      const estado = {
        label: checkInPendiente ? "Toca" : "Al día",
        tone: (checkInPendiente ? "warn" : "ok") as "warn" | "ok",
      };
      const cierre =
        datos.me?.profile?.checkinWeekday != null
          ? `cierras los ${DIAS_SEMANA[datos.me.profile.checkinWeekday]}`
          : "sin día de cierre elegido";

      if (mini) {
        return cuadro({
          icon: CalendarCheck,
          tint: colors.guindaLight,
          title: "Check-in",
          value: valor,
          detail: diasCheckIn === null ? "nunca has hecho uno" : "desde el último",
          status: estado,
          onPress: () => navegar("/checkin"),
        });
      }

      return renglon({
        icon: CalendarCheck,
        tint: colors.guindaLight,
        title: "Check-in",
        value: valor,
        detail: conMeta
          ? `${diasCheckIn === null ? "Nunca has hecho uno" : "desde el último"} · ${cierre}`
          : diasCheckIn === null
            ? "Nunca has hecho uno"
            : "desde el último",
        status: estado,
        onPress: () => navegar("/checkin"),
        infoTip: (
          <InfoTip titulo="Check-in">
            <TextoInfo>
              {datos.me?.profile?.checkinHour != null
                ? `Te avisa a las ${datos.me.profile.checkinHour}:00, con recordatorio en el teléfono.`
                : "Elige día y hora en Ajustes para que te avise."}
            </TextoInfo>
            <TextoInfo>
              Seis campos: cintura, peso y cuatro escalas. Brazos y piernas van una vez al mes, y
              el cumplimiento llega prellenado.
            </TextoInfo>
          </InfoTip>
        ),
      });
    }

    // -----------------------------------------------------------------------
    case "semana": {
      const valor = sesionesTotal === 0 ? "—" : `${sesionesHechas}/${sesionesTotal}`;
      const proxima = (datos.week?.sessions ?? []).find((sesion) => sesion.completedAt === null);

      if (mini) {
        return cuadro({
          icon: Dumbbell,
          tint: colors.paloRosa,
          title: "Esta semana",
          value: valor,
          detail: "sesiones cerradas",
          onPress: () => navegar("/rutinas"),
        });
      }

      return renglon({
        icon: Dumbbell,
        tint: colors.paloRosa,
        title: "Esta semana",
        value: valor,
        detail:
          conMeta && proxima
            ? `sigue ${proxima.muscleGroup.toLowerCase()} · ${proxima.date.slice(8)}/${proxima.date.slice(5, 7)}`
            : sesionesTotal === 0
              ? "Sin semana generada"
              : "sesiones cerradas",
        onPress: () => navegar("/rutinas"),
        children: (
          <>
            {(datos.week?.sessions ?? []).map((sesion) => (
              <View key={sesion.workoutId} style={styles.filaSemana}>
                <Text style={styles.filaSemanaDia}>
                  {sesion.date.slice(8)}/{sesion.date.slice(5, 7)}
                </Text>
                <Text style={styles.filaSemanaGrupo} numberOfLines={1}>
                  {sesion.muscleGroup}
                </Text>
                <Text
                  style={[
                    styles.filaSemanaEstado,
                    sesion.completedAt !== null && styles.filaSemanaHecha,
                  ]}
                >
                  {sesion.completedAt !== null ? "hecha" : "pendiente"}
                </Text>
              </View>
            ))}
          </>
        ),
      });
    }

    // -----------------------------------------------------------------------
    case "disciplinas": {
      const otras = datos.week?.otherSessions ?? [];
      const valor = `${sesionesTotal + otras.length}`;

      // El ícono del panel es el de la disciplina que más aparece en la
      // semana, no unas olas fijas: quien juega squash no tiene por qué ver
      // una alberca en su tablero.
      const conteo = otras.reduce<Partial<Record<Discipline, number>>>((cuenta, sesion) => {
        cuenta[sesion.discipline] = (cuenta[sesion.discipline] ?? 0) + 1;
        return cuenta;
      }, {});
      const dominante = (Object.entries(conteo) as Array<[Discipline, number]>).sort(
        (a, b) => b[1] - a[1],
      )[0]?.[0];
      const IconoPanel = iconoDe(dominante ?? "PESAS");
      const reparto =
        otras.length === 0
          ? "solo pesas"
          : `${sesionesTotal} de pesas · ${otras
              .map((sesion) => DISCIPLINE_LABELS[sesion.discipline].toLowerCase())
              .join(", ")}`;

      if (mini) {
        return cuadro({
          icon: IconoPanel,
          tint: colors.paloRosa,
          title: "Disciplinas",
          value: valor,
          detail: "sesiones esta semana",
          onPress: () => navegar("/rutinas"),
        });
      }

      return renglon({
        icon: IconoPanel,
        tint: colors.paloRosa,
        title: "Tus disciplinas",
        value: valor,
        detail: reparto,
        onPress: () => navegar("/rutinas"),
        infoTip: (
          <InfoTip titulo="Tus disciplinas">
            <TextoInfo>
              Agrega otra disciplina en Ajustes y se reparte sola en tu semana, gastando del mismo
              presupuesto de sesiones.
            </TextoInfo>
          </InfoTip>
        ),
        children: (
          <>
            <FilaDisciplina
              discipline="PESAS"
              detalle={`${sesionesTotal} ${sesionesTotal === 1 ? "sesión" : "sesiones"}`}
            />
            {(Object.entries(conteo) as Array<[Discipline, number]>).map(([disciplina, cuantas]) => (
              <FilaDisciplina
                key={disciplina}
                discipline={disciplina}
                detalle={`${cuantas} ${cuantas === 1 ? "sesión" : "sesiones"}`}
              />
            ))}
          </>
        ),
      });
    }

    // -----------------------------------------------------------------------
    case "avance_disciplinas": {
      // La primaria manda el esqueleto de la semana; las demás son las que la
      // persona agregó en Ajustes. Entre las dos arman "lo que entreno hoy" —
      // no lo que trae la semana generada, que puede ser un subconjunto.
      const primaria: Discipline = datos.me?.profile?.primaryDiscipline ?? "PESAS";
      const otras = datos.me?.profile?.otherDisciplines ?? [];
      const activas = [primaria, ...otras.map((carga) => carga.discipline)].filter(
        (disciplina, indice, arreglo) => arreglo.indexOf(disciplina) === indice,
      );

      // Una disciplina con DATOS aparece aunque no esté en el plan: quien
      // registra rondas de golf sin tener golf como disciplina activa tenía
      // sus estadísticas guardadas y NINGÚN lugar donde verlas — el panel
      // filtraba por plan y la fila jamás se pintaba. Los datos mandan sobre
      // la configuración: si existen, se enseñan.
      if (!activas.includes("GOLF") && (datos.golf?.rondas?.length ?? 0) > 0) {
        activas.push("GOLF");
      }

      const filas = activas.map((disciplina) => avanceDeDisciplina(disciplina, datos));
      const principal = filas[0]!;
      const IconoPrincipal = iconoDe(primaria);

      if (mini) {
        return cuadro({
          icon: IconoPrincipal,
          tint: colors.paloRosa,
          title: DISCIPLINE_LABELS[primaria],
          value: principal.valor,
          detail: principal.detalle,
          status: principal.tendencia,
          onPress: () => navegar(principal.ruta),
        });
      }

      return renglon({
        icon: IconoPrincipal,
        tint: colors.paloRosa,
        title: "Avance por disciplina",
        value: principal.valor,
        detail: principal.detalle,
        status: principal.tendencia,
        onPress: () => navegar(principal.ruta),
        infoTip: (
          <InfoTip titulo="Avance por disciplina">
            <TextoInfo>
              La tendencia compara tus últimas dos semanas contra las dos anteriores —en golf, tus
              últimas cinco rondas contra las de antes. Sin ese historial todavía, la fila se queda
              sin flecha en vez de inventar una.
            </TextoInfo>
            <TextoInfo>
              Golf sale de tus rondas registradas, pesas de tus sesiones cerradas y el resto de las
              actividades que capturas a mano o sincroniza tu reloj.
            </TextoInfo>
          </InfoTip>
        ),
        children: (
          <>
            {filas.map((fila) => (
              <FilaAvanceDisciplina
                key={fila.discipline}
                fila={fila}
                // La hoja de zoom, no la captura directa: GIR%, putts,
                // volumen semanal y el resto del detalle viven ahí, no en
                // este renglón ya compactado a un vistazo.
                onPress={() => navegar(`/avance/${fila.discipline}`)}
              />
            ))}
          </>
        ),
      });
    }

    // -----------------------------------------------------------------------
    case "cumplimiento": {
      const valor = cumplimiento.rutina === null ? "—" : `${cumplimiento.rutina} %`;

      if (mini) {
        return cuadro({
          icon: ClipboardCheck,
          tint: colors.champan,
          title: "Cumplimiento",
          value: valor,
          detail: "de tu rutina",
          onPress: () => navegar("/checkin"),
        });
      }

      return renglon({
        icon: ClipboardCheck,
        tint: colors.champan,
        title: "Cumplimiento",
        value: valor,
        detail: `rutina ${cumplimiento.rutinaDetalle ?? "—"} · dieta ${
          cumplimiento.dieta === null ? "sin datos" : `${cumplimiento.dieta} %`
        }`,
        onPress: () => navegar("/checkin"),
        infoTip: (
          <InfoTip titulo="Cumplimiento">
            <TextoInfo>
              Los dos se cuentan solos: la rutina con lo que cierras y sube el reloj, y la dieta
              con las comidas que confirmas.
            </TextoInfo>
          </InfoTip>
        ),
        children: (
          <>
            <View style={styles.filaSemana}>
              <Text style={styles.filaSemanaGrupo}>Rutina</Text>
              <Text style={styles.filaSemanaEstado}>
                {cumplimiento.rutinaDetalle ?? "sin semana generada"}
              </Text>
            </View>
            <View style={styles.filaSemana}>
              <Text style={styles.filaSemanaGrupo}>Dieta</Text>
              <Text style={styles.filaSemanaEstado}>
                {cumplimiento.dieta === null
                  ? "sin datos todavía"
                  : cumplimiento.dietaMedida
                    ? `${cumplimiento.dieta} % · ${cumplimiento.dietaContestadas} comidas confirmadas`
                    : `${cumplimiento.dieta} % en tu último check-in`}
              </Text>
            </View>
            {/* Aviso accionable: falta dato real (comidas confirmadas), no
                explicación de mecánica — se queda visible, no va al InfoTip. */}
            {!cumplimiento.dietaMedida && (
              <Parrafo style={styles.panelNota}>
                La rutina se cuenta sola. Para que la dieta también, confirma tus comidas desde
                Hoy o desde el aviso.
              </Parrafo>
            )}
          </>
        ),
      });
    }

    // -----------------------------------------------------------------------
    case "racha": {
      if (mini) {
        return cuadro({
          icon: Flame,
          tint: colors.champan,
          title: "Racha",
          value: `${streak}`,
          detail:
            streak === 0
              ? "hoy cuenta para empezar"
              : conMeta && best > streak
                ? `días · tu mejor: ${best}`
                : "días seguidos",
        });
      }

      return renglon({
        icon: Flame,
        tint: colors.champan,
        title: "Racha",
        value: `${streak}`,
        detail:
          streak === 0
            ? "Hoy cuenta para empezar"
            : conMeta
              ? best > streak
                ? `días seguidos · tu mejor: ${best}`
                : "días seguidos, y es tu mejor marca"
              : "días seguidos",
      });
    }

    // -----------------------------------------------------------------------
    case "estudios": {
      const valor = ultimoLab ? formatDateEs(ultimoLab.takenOn) : "—";
      const estado =
        ultimoLab && ultimoLab.outsideRange.length > 0
          ? { label: "Revisar", tone: "warn" as const }
          : null;
      const detalle = ultimoLab
        ? `${ultimoLab.values.length} valores · ${ultimoLab.kind === "INBODY" ? "bioimpedancia" : "química"}`
        : "Todavía sin estudios cargados";

      if (mini) {
        return cuadro({
          icon: FlaskConical,
          tint: colors.guindaLight,
          title: "Estudios",
          value: ultimoLab ? valor.split(" de ")[0]! : "—",
          detail: ultimoLab ? `${ultimoLab.values.length} valores` : "sin cargar",
          status: estado,
          onPress: () => navegar("/laboratorios"),
        });
      }

      return renglon({
        icon: FlaskConical,
        tint: colors.guindaLight,
        title: "Tus estudios",
        value: valor,
        detail: detalle,
        status: estado,
        onPress: () => navegar("/laboratorios"),
        infoTip: (
          <InfoTip titulo="Tus estudios">
            <TextoInfo>
              Se guardan y se grafican. La app no los interpreta: lo que salga fuera del rango de
              tu laboratorio lo revisa un médico.
            </TextoInfo>
          </InfoTip>
        ),
        children: (
          <>
            {(ultimoLab?.values ?? []).slice(0, 5).map((dato) => (
              <View key={dato.key} style={styles.filaSemana}>
                <Text style={styles.filaSemanaGrupo} numberOfLines={1}>
                  {dato.label}
                </Text>
                <Text style={styles.filaSemanaEstado}>
                  {dato.value} {dato.unit}
                </Text>
              </View>
            ))}
          </>
        ),
      });
    }

    // -----------------------------------------------------------------------
    case "plan": {
      const valor = datos.decision ? `${datos.decision.kcal}` : "—";
      const fase = datos.decision ? datos.decision.phase.replace(/_/g, " ").toLowerCase() : null;

      if (mini) {
        return cuadro({
          icon: Flame,
          tint: colors.paloRosa,
          title: "Tu plan",
          value: valor,
          detail: fase ? `kcal · ${fase}` : "sin decisión",
          onPress: () => navegar("/nutricion"),
        });
      }

      return renglon({
        icon: Flame,
        tint: colors.paloRosa,
        title: "Tu plan",
        value: valor,
        detail: datos.decision
          ? `kcal · ${fase} · P ${datos.decision.proteinG} · C ${datos.decision.carbsG} · G ${datos.decision.fatG}`
          : "Sin decisión publicada",
        onPress: () => navegar("/nutricion"),
        children: datos.decision ? (
          <View style={styles.macros}>
            <Macro label="Proteína" valor={`${datos.decision.proteinG} g`} />
            <Macro label="Carbohidratos" valor={`${datos.decision.carbsG} g`} />
            <Macro label="Grasas" valor={`${datos.decision.fatG} g`} />
          </View>
        ) : (
          <Text style={styles.panelNota}>Tu primera decisión sale de tu primer check-in.</Text>
        ),
      });
    }

    // -----------------------------------------------------------------------
    case "objetivo": {
      const valor =
        objetivoEstado === "listo"
          ? "Listo"
          : objetivoEstado === "en_espera"
            ? "En análisis"
            : "Pendiente";
      const referencias =
        datos.goal && "references" in datos.goal.status
          ? `${datos.goal.status.references} referencias`
          : "Sube tus fotos de referencia";

      if (mini) {
        return cuadro({
          icon: Target,
          tint: colors.guindaLight,
          title: "Objetivo",
          value: valor,
          detail: referencias,
          onPress: () => navegar("/objetivo"),
        });
      }

      return renglon({
        icon: Target,
        tint: colors.guindaLight,
        title: "Objetivo",
        value: valor,
        detail: `${referencias} · la referencia es dirección, no promesa`,
        onPress: () => navegar("/objetivo"),
      });
    }

    // -----------------------------------------------------------------------
    case "records": {
      if (mini) {
        return cuadro({
          icon: Trophy,
          tint: colors.champan,
          title: "Récords",
          value: `${prs.length}`,
          detail: ultimoPr ? ultimoPr.exerciseName : "sin PRs todavía",
          onPress: () => navegar("/historial"),
        });
      }

      return renglon({
        icon: Trophy,
        tint: colors.champan,
        title: "Récords",
        value: `${prs.length}`,
        detail: ultimoPr
          ? `último: ${ultimoPr.exerciseName} ${ultimoPr.weightKg} kg`
          : "Cierra sesiones para tener PRs",
        onPress: () => navegar("/historial"),
        children: (
          <>
            {prs.slice(0, 5).map((record) => (
              <View key={record.exerciseName} style={styles.filaSemana}>
                <Text style={styles.filaSemanaGrupo} numberOfLines={1}>
                  {record.exerciseName}
                </Text>
                <Text style={styles.filaSemanaEstado}>
                  {record.weightKg} kg × {record.reps}
                </Text>
              </View>
            ))}
          </>
        ),
      });
    }

    // -----------------------------------------------------------------------
    case "peso":
      return metrica({
        icon: TrendingUp,
        tint: colors.paloRosa,
        title: "Peso",
        value: ultimoCheckIn?.weightKg != null ? `${ultimoCheckIn.weightKg} kg` : "—",
        detail: "de tu último check-in",
        serie: serieDe("weightKg"),
        puntos: (datos.points ?? [])
          .slice(-10)
          .map((punto) => ({ date: punto.date, value: punto.weightKg })),
        formato: (valor: number) => `${valor} kg`,
        ruta: "/salud/medidas",
      });

    case "pasos":
      return metrica({
        icon: Footprints,
        tint: colors.champan,
        title: "Pasos",
        value: pasos ? pasos.value.toLocaleString("es-MX") : "—",
        detail: `de ${PASOS_META.toLocaleString("es-MX")} al día`,
        serie: serieSalud("steps"),
        puntos: puntosSalud("steps"),
        formato: (valor: number) => `${Math.round(valor)}`,
        ruta: "/salud/pasos",
      });

    case "sueno":
      return metrica({
        icon: Moon,
        tint: colors.paloRosa,
        title: "Sueño",
        value: sueno ? formatSleep(sueno.value) : "—",
        detail: `de ${formatSleep(SUENO_META_MIN)} por noche`,
        serie: serieSalud("sleepMin"),
        puntos: puntosSalud("sleepMin"),
        formato: (valor: number) => formatSleep(valor),
        ruta: "/salud/descanso",
      });

    case "recuperacion":
      return metrica({
        icon: HeartPulse,
        tint: colors.error,
        title: "Recuperación",
        value: hrv ? `${hrv.value}` : "—",
        detail: "ms de variabilidad, contra tu propia normal",
        serie: serieSalud("hrvMs"),
        puntos: puntosSalud("hrvMs"),
        formato: (valor: number) => `${Math.round(valor)} ms`,
        ruta: "/salud/recuperacion",
      });

    case "condicion":
      return metrica({
        icon: ActivityIcon,
        tint: colors.champan,
        title: "Condición",
        value: vo2 ? `${vo2.value}` : "—",
        detail: "VO₂ máx estimado por el reloj",
        serie: serieSalud("vo2max"),
        puntos: puntosSalud("vo2max"),
        formato: (valor: number) => `${valor}`,
        ruta: "/salud/condicion",
      });

    default:
      return null;
  }

  /** Las cinco métricas de una sola serie comparten molde en los tres tamaños. */
  function metrica(props: {
    icon: ComponentType<IconoProps>;
    tint: string;
    title: string;
    value: string;
    detail: string;
    serie: number[];
    puntos: Array<{ date: string; value: number | null }>;
    formato: (valor: number) => string;
    ruta: string;
  }): React.ReactNode {
    if (mini) {
      return cuadro({
        icon: props.icon,
        tint: props.tint,
        title: props.title,
        value: props.value,
        detail: props.detail,
        serie: props.serie,
        onPress: () => navegar(props.ruta),
      });
    }

    return renglon({
      icon: props.icon,
      tint: props.tint,
      title: props.title,
      value: props.value,
      detail: props.detail,
      onPress: () => navegar(props.ruta),
      serie: props.serie,
      puntos: props.puntos,
      formato: props.formato,
    });
  }
}

/**
 * Una disciplina en el desglose: su ícono, su nombre y cuántas sesiones.
 *
 * Con el ícono la lista se recorre de un vistazo; sin él son cuatro renglones
 * de texto que hay que leer uno por uno para encontrar el que interesa.
 */
function FilaDisciplina({
  discipline,
  detalle,
}: {
  discipline: Discipline;
  detalle: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const Icono = iconoDe(discipline);

  return (
    <View style={styles.filaSemana}>
      <Icono size={18} color={colors.paloRosa} strokeWidth={2} />
      <Text style={styles.filaSemanaGrupo}>{DISCIPLINE_LABELS[discipline]}</Text>
      <Text style={styles.filaSemanaEstado}>{detalle}</Text>
    </View>
  );
}

// -----------------------------------------------------------------------------
// "avance_disciplinas" — lógica pura, sin JSX, para poder probarla a ojo
// leyendo el switch: cada disciplina activa sale de una fuente distinta
// (golf trae su propio endpoint agregado; pesas de las sesiones cerradas;
// el resto de las actividades registradas) y las tres se resuelven al mismo
// molde para que la fila no tenga que saber de dónde vino su número.
// -----------------------------------------------------------------------------

type Tendencia = { label: string; tone: "ok" | "warn" | "neutral" } | null;

type AvanceDisciplina = {
  discipline: Discipline;
  /** El número protagonista de la fila. */
  valor: string;
  /** La línea de contexto: de qué está hecho ese número. */
  detalle: string;
  tendencia: Tendencia;
  /** A dónde lleva tocar la fila: el detalle de golf, el historial de pesas,
   * o la captura de actividad para todo lo demás. */
  ruta: string;
};

/** Días completos entre una fecha yyyy-MM-dd y hoy, en UTC para no correr el
 * día por el huso local — mismo criterio que `diasDesde` de la pantalla. */
function diasDesde(fecha: string): number {
  const desde = Date.parse(`${fecha}T12:00:00.000Z`);
  const hoy = Date.parse(`${new Date().toISOString().slice(0, 10)}T12:00:00.000Z`);
  return Math.round((hoy - desde) / 86_400_000);
}

/** La flecha va pegada al texto: es el chip completo, no un ícono aparte. */
function flechaTendencia(direccion: "up" | "down" | "flat"): Tendencia {
  if (direccion === "up") return { label: "↑ Mejorando", tone: "ok" };
  if (direccion === "down") return { label: "↓ Empeorando", tone: "warn" };
  return { label: "→ Estable", tone: "neutral" };
}

function avanceGolf(golf: GolfResponse | null): Omit<AvanceDisciplina, "discipline" | "ruta"> {
  if (golf === null) return { valor: "—", detalle: "Sin conexión", tendencia: null };
  const { agregados } = golf;
  if (agregados.rondas === 0) return { valor: "—", detalle: "Sin registros aún", tendencia: null };

  const score = agregados.scoreVsPar.ultimas5;
  const valor = score === null ? `${agregados.rondas} rondas` : `${score > 0 ? "+" : ""}${score} vs par`;
  const detalle =
    [
      agregados.girPct !== null ? `GIR ${agregados.girPct}%` : null,
      agregados.puttsPromedio !== null ? `${agregados.puttsPromedio} putts` : null,
    ]
      .filter((parte): parte is string => parte !== null)
      .join(" · ") || `${agregados.rondas} rondas jugadas`;

  const tendencia =
    agregados.tendencia === "MEJORANDO"
      ? flechaTendencia("up")
      : agregados.tendencia === "EMPEORANDO"
        ? flechaTendencia("down")
        : agregados.tendencia === "ESTABLE"
          ? flechaTendencia("flat")
          : null;

  return { valor, detalle, tendencia };
}

function avancePesas(sessions: TrainingHistoryRow[] | null): Omit<AvanceDisciplina, "discipline" | "ruta"> {
  if (sessions === null) return { valor: "—", detalle: "Sin conexión", tendencia: null };
  const cerradas = sessions.filter((sesion) => sesion.completed);
  if (cerradas.length === 0) return { valor: "—", detalle: "Sin registros aún", tendencia: null };

  const volumenEn = (desde: number, hasta: number) =>
    cerradas
      .filter((sesion) => {
        const dias = diasDesde(sesion.date);
        return dias >= desde && dias < hasta;
      })
      .reduce((suma, sesion) => suma + sesion.volumeKg, 0);

  const reciente = volumenEn(0, 14);
  const previo = volumenEn(14, 28);
  const tendencia =
    previo > 0
      ? flechaTendencia(reciente > previo * 1.05 ? "up" : reciente < previo * 0.95 ? "down" : "flat")
      : null;

  return {
    valor: `${cerradas.length} ${cerradas.length === 1 ? "sesión" : "sesiones"}`,
    detalle: `${Math.round(reciente).toLocaleString("es-MX")} kg en los últimos 14 días`,
    tendencia,
  };
}

function avanceActividad(
  discipline: Discipline,
  activities: Activity[] | null,
): Omit<AvanceDisciplina, "discipline" | "ruta"> {
  if (activities === null) return { valor: "—", detalle: "Sin conexión", tendencia: null };
  const propias = activities.filter((actividad) => actividad.discipline === discipline);
  if (propias.length === 0) return { valor: "—", detalle: "Sin registros aún", tendencia: null };

  const enRango = (desde: number, hasta: number) =>
    propias.filter((actividad) => {
      const dias = diasDesde(actividad.date);
      return dias >= desde && dias < hasta;
    });

  const ultimos30 = enRango(0, 30);
  if (ultimos30.length === 0) {
    return { valor: "—", detalle: "Nada en los últimos 30 días", tendencia: null };
  }

  const minutos = ultimos30.reduce((suma, actividad) => suma + actividad.durationMin, 0);
  const quincenaReciente = enRango(0, 15).length;
  const quincenaPrevia = enRango(15, 30).length;
  const tendencia =
    quincenaPrevia > 0
      ? flechaTendencia(
          quincenaReciente > quincenaPrevia ? "up" : quincenaReciente < quincenaPrevia ? "down" : "flat",
        )
      : null;

  return {
    valor: `${ultimos30.length} ${ultimos30.length === 1 ? "sesión" : "sesiones"}`,
    detalle: `${minutos} min en los últimos 30 días`,
    tendencia,
  };
}

/** A dónde lleva tocar la fila de esa disciplina. */
function rutaDeDisciplina(discipline: Discipline): string {
  if (discipline === "GOLF") return "/golf";
  if (discipline === "PESAS") return "/historial";
  return "/actividad";
}

function avanceDeDisciplina(discipline: Discipline, datos: VistaResumen["datos"]): AvanceDisciplina {
  const base =
    discipline === "GOLF"
      ? avanceGolf(datos.golf)
      : discipline === "PESAS"
        ? avancePesas(datos.sessions)
        : avanceActividad(discipline, datos.activities);

  return { discipline, ruta: rutaDeDisciplina(discipline), ...base };
}

/**
 * Una disciplina en el desglose de avance: ícono, nombre, UN valor
 * protagonista y su tendencia — el chevron dice que hay más atrás.
 *
 * Antes el renglón traía una segunda línea con GIR%, putts, minutos o
 * sesiones (lo que `avanceGolf`/`avancePesas`/`avanceActividad` calculan
 * como `detalle`). El pedido del dueño fue colapsar eso: el renglón es un
 * scorecard mínimo y ese detalle se mudó entero a la hoja de zoom
 * (`app/avance/[disciplina].tsx`), que es a donde lleva el toque.
 */
function FilaAvanceDisciplina({ fila, onPress }: { fila: AvanceDisciplina; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const Icono = iconoDe(fila.discipline);

  const toneColor: Record<"ok" | "warn" | "neutral", string> = {
    ok: colors.champan,
    warn: colors.paloRosa,
    neutral: colors.paloRosaLight,
  };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.filaAvance, pressed && styles.pressed]}
    >
      <Icono size={18} color={colors.paloRosa} strokeWidth={2} />
      <Text style={styles.filaAvanceNombre} numberOfLines={1}>
        {DISCIPLINE_LABELS[fila.discipline]}
      </Text>
      <View style={styles.filaAvanceDerecha}>
        <Text style={styles.filaAvanceValor}>{fila.valor}</Text>
        {fila.tendencia && (
          <Text style={[styles.filaAvanceTendencia, { color: toneColor[fila.tendencia.tone] }]}>
            {fila.tendencia.label}
          </Text>
        )}
      </View>
      <ChevronRight size={18} color={colors.paloRosaLight} strokeWidth={2} />
    </Pressable>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    hero: {
      borderRadius: radius.xxl,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
      padding: spacing.xl,
      gap: spacing.xs,
    },
    heroHead: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: spacing.sm,
    },
    heroTitle: { fontFamily: fonts.sansBold, ...typeScale.heading, color: colors.marfil },
    heroPista: { fontFamily: fonts.sans, ...typeScale.label, color: colors.paloRosaLight },
    heroCaption: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
    heroResumen: { fontFamily: fonts.sansBold, ...typeScale.subheading, color: colors.marfil },
    ejesFila: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
    ejePastilla: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingHorizontal: spacing.md,
      paddingVertical: 5,
    },
    ejeNombre: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.paloRosa },
    ejeValor: { fontFamily: fonts.sansBold, ...typeScale.bodySm, color: colors.champan },
    ejeValorBajo: { color: colors.error },
    heroBody: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.lg,
      marginTop: spacing.md,
    },
    leyendas: { flex: 1, gap: spacing.md },
    leyenda: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    pressed: { opacity: 0.85 },
    leyendaTexto: { flex: 1 },
    leyendaValor: { fontFamily: fonts.sansBold, ...typeScale.subheading, color: colors.marfil },
    leyendaLabel: {
      fontFamily: fonts.sans,
      ...typeScale.bodySm,
      color: withAlpha(colors.paloRosa, 0.9),
    },
    extras: {
      flexDirection: "row",
      gap: spacing.lg,
      marginTop: spacing.lg,
      paddingTop: spacing.lg,
      borderTopWidth: 1,
      borderTopColor: colors.cardBorder,
    },
    perfil: {
      borderRadius: radius.xxl,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
      padding: spacing.xl,
      gap: spacing.xs,
      alignItems: "stretch",
    },
    glidepathLink: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.bodySm,
      color: colors.champan,
      marginTop: spacing.md,
    },
    panelNota: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
    filaSemana: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: 4,
    },
    filaSemanaDia: {
      width: 52,
      fontFamily: fonts.sansMedium,
      ...typeScale.bodySm,
      color: colors.paloRosaLight,
      fontVariant: ["tabular-nums"],
    },
    filaSemanaGrupo: {
      flex: 1,
      fontFamily: fonts.sansMedium,
      ...typeScale.bodySm,
      color: colors.marfil,
    },
    filaSemanaEstado: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
    filaSemanaHecha: { color: colors.champan, fontFamily: fonts.sansSemiBold },
    filaAvance: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
    filaAvanceNombre: { flex: 1, fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    filaAvanceDerecha: { alignItems: "flex-end", gap: 1 },
    filaAvanceValor: { fontFamily: fonts.sansSemiBold, ...typeScale.bodySm, color: colors.marfil },
    filaAvanceTendencia: { fontFamily: fonts.sansMedium, ...typeScale.label },
    macros: { flexDirection: "row", gap: spacing.lg },
    macro: { gap: 2 },
    macroLabel: { fontFamily: fonts.sansMedium, ...typeScale.label, color: colors.paloRosa },
    macroValor: { fontFamily: fonts.sansBold, ...typeScale.subheading, color: colors.marfil },
  });
