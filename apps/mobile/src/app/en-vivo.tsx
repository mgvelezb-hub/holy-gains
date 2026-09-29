import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useKeepAwake } from "expo-keep-awake";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  Check,
  ChevronLeft,
  HeartPulse,
  Minus,
  PlayCircle,
  Plus,
  SkipForward,
  Timer,
  Watch,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Hoja } from "@/components/Hoja";
import { CorredorCardio } from "@/components/CorredorCardio";
import { InfoTip, TextoInfo } from "@/components/InfoTip";
import { Parrafo } from "@/components/Parrafo";
import { ErrorState, LoadingState } from "@/components/States";
import { useTheme } from "@/context/theme";
import {
  getEjercicioPrefs,
  patchEjercicioPrefs,
  type ExerciseAlternative,
  type OtherSessionView,
  type SessionSyncInput,
  type SessionView,
  type WarmupStep,
  type WeekView,
} from "@/lib/api";
import { cardioDeLaFecha, pasosDeCardio, tituloTarjetaCardio } from "@/lib/cardio";
import { leeCardioDelDia, leeCardioEnCurso, leeCardioHecho } from "@/lib/cardio-en-curso";
import {
  alCerrarSerieEnElReloj,
  alFrecuenciaDelReloj,
  drenarSeriesCerradas,
  enviarFinAlReloj,
  enviarSesionAlReloj,
  estadoDelReloj,
  type LecturaDeFc,
} from "@/lib/reloj-nativo";
import {
  aplicarDelReloj,
  paraElReloj,
  type SerieCerradaEnReloj,
} from "@/lib/reloj-sesion";
import {
  ajustarDescanso,
  alternativasLibres,
  barraPorDefecto,
  cerrarDescanso,
  cerrarSerie,
  conFrecuencia,
  conRpe,
  descansoTermino,
  editarSerie,
  estadoInicial,
  etiquetaDeSerie,
  formatoReloj,
  ladoDesdeTotal,
  objetivoDeSerie,
  omitirSaltadas,
  pesoDeDropset,
  pesoSugerido,
  preguntarMontaje,
  progreso,
  sustituirEnSesion,
  terminarEjercicio,
  textoDeTempo,
  totalDesdeLado,
  restanteSeg,
  saltarDescanso,
  volumenKg,
  type EjercicioVivo,
  type EstadoSesion,
  type Montaje,
} from "@/lib/sesion-viva";
import {
  aKilos,
  aUnidad,
  ajustaPeso,
  formatoPeso,
  pasosDe,
  type UnidadDePeso,
} from "@/lib/peso";
import {
  guardaPreferenciaDePeso,
  leePreferenciaDePeso,
} from "@/lib/preferencias-sesion";
import {
  guardaSesionEnCurso,
  leeSesionEnCurso,
  olvidaSesionEnCurso,
} from "@/lib/sesion-en-curso";
import { pulsoEntre, type PulsoDeTramo } from "@/lib/health";
import { fonts, radius, spacing, type as typeScale, withAlpha, type Palette } from "@/lib/theme";
import { clientIdFor, exercisePrefix } from "@/lib/training-client-id";
import { getCachedWeek, getPendingSession, upsertPendingSession } from "@/lib/training-db";
import { refreshPendingCount, syncAndNotify } from "@/lib/training-sync";

/**
 * Sesión en vivo — la pantalla que se usa con la barra en la mano.
 *
 * Lo que la separa del modo de captura de siempre: aquí no hay que buscar
 * dónde anotar. En qué serie vas y cuántas reps faltan están escritos en
 * grande y no se van nunca; cerrar una serie es un botón que ocupa media
 * pantalla; y el descanso arranca solo, porque el cronómetro que hay que
 * acordarse de iniciar es el que nadie inicia.
 *
 * El teléfono avisa con **háptica**, no con sonido: en un gimnasio con música
 * un pitido no se oye, y si se oye, se oye para todos. Una vibración corta al
 * cerrar la serie y una doble al terminar el descanso alcanzan, y funcionan
 * con el teléfono boca abajo en la banca.
 *
 * La pantalla se queda encendida mientras dura la sesión: entre serie y serie
 * pasan dos minutos, y desbloquear con las manos llenas de magnesio es
 * exactamente el tipo de fricción que hace que la gente deje de registrar.
 *
 * **Con Apple Watch**: la misma sesión se ve en la muñeca y la serie se puede
 * cerrar desde ahí, sin sacar el teléfono. Lo que el reloj cierra llega por
 * `WatchConnectivity` y entra aquí; lo que ya estaba cerrado en el teléfono no
 * se pisa nunca, porque el peso solo se teclea de este lado.
 *
 * Lo que el reloj **todavía no** hace es contar las repeticiones solo. Graba el
 * movimiento de cada serie y lo manda con ella, que es el dato con el que ese
 * conteo se va a poder calibrar; escribirlo antes daría umbrales inventados y
 * un contador que cuenta mal, que es peor que no tenerlo.
 */

/** Cada cuánto baja el descanso. Un segundo, como cualquier cronómetro. */
const TICK_MS = 1000;

/**
 * Montajes por ejercicio (carga por lado, barra) y el perfil de pulso, en el
 * teléfono: la sesión se usa sin señal y la pregunta "¿se carga por lado?" no
 * puede repetirse cada vez que no hay red. El servidor
 * (`/api/v1/me/ejercicio-prefs`) es la copia que sobrevive al teléfono.
 */
const LLAVE_MONTAJES = "holygains.sesion.montajes";

type DatosDeSesion = {
  montajes: Record<string, Montaje>;
  edad: number | null;
  fcReposo: number | null;
};

async function leeDatosLocales(): Promise<DatosDeSesion> {
  try {
    const crudo = await AsyncStorage.getItem(LLAVE_MONTAJES);
    const leido = crudo ? (JSON.parse(crudo) as Partial<DatosDeSesion>) : {};
    return {
      montajes: typeof leido.montajes === "object" && leido.montajes !== null ? leido.montajes : {},
      edad: typeof leido.edad === "number" ? leido.edad : null,
      fcReposo: typeof leido.fcReposo === "number" ? leido.fcReposo : null,
    };
  } catch {
    return { montajes: {}, edad: null, fcReposo: null };
  }
}

async function guardaDatosLocales(datos: DatosDeSesion): Promise<void> {
  try {
    await AsyncStorage.setItem(LLAVE_MONTAJES, JSON.stringify(datos));
  } catch {
    // Sin copia local solo se vuelve a preguntar; la sesión sigue.
  }
}

/**
 * Lunes de esta semana, que es la llave del cache.
 *
 * Misma cuenta que en Rutinas: sin señal no hay a quién preguntarle qué semana
 * es, y el teléfono ya lo sabe.
 */
function mondayISO(): string {
  const ahora = new Date();
  const dia = ahora.getDay() || 7;
  ahora.setDate(ahora.getDate() - (dia - 1));
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  return `${ahora.getFullYear()}-${mes}-${String(ahora.getDate()).padStart(2, "0")}`;
}

export default function EnVivoScreen() {
  const { workoutId } = useLocalSearchParams<{ workoutId: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Mientras la sesión está abierta la pantalla no se apaga.
  useKeepAwake();

  const [sesion, setSesion] = useState<SessionView | null>(null);
  const [estado, setEstado] = useState<EstadoSesion | null>(null);
  const [draft, setDraft] = useState<SessionSyncInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reps, setReps] = useState(0);
  const [peso, setPeso] = useState<number | null>(null);

  // Unidad y salto de los botones ±. Se leen del teléfono al abrir: cambian
  // con el gimnasio (discos en libras en uno, en kilos en otro) y no valen un
  // viaje al servidor a media serie.
  const [unidad, setUnidad] = useState<UnidadDePeso>("kg");
  const [paso, setPaso] = useState(2.5);

  // La captura manual: `null` = cerrada. Con `serie` puesta se está corrigiendo
  // una serie YA cerrada; sin ella, se está tecleando la que sigue.
  const [capturando, setCapturando] = useState<
    { campo: "reps" | "peso"; serie: { ejercicio: number; serie: number } | null } | null
  >(null);
  const [borrador, setBorrador] = useState("");

  /**
   * Calentamiento dinámico, antes del primer ejercicio (feedback del dueño,
   * 2026-09: "el calentamiento debería ser previo al primer ejercicio").
   *
   * `fase` se decide una sola vez al cargar la sesión (ver `cargar`): abre en
   * "calentamiento" solo si el plan lo trae y todavía no hay ninguna serie
   * cerrada. Nunca es obligatorio — "Saltar calentamiento" salta directo a
   * "entrenando" en cualquier momento.
   */
  const [fase, setFase] = useState<"calentamiento" | "entrenando" | "cardio">("entrenando");

  /**
   * El cardio de después de pesas de hoy (H2), si el plan lo trae. Aparece
   * al cerrar la última serie y lo corre `CorredorCardio` (N2): el MISMO
   * componente del cardio suelto, con su cursor, pausa y registro.
   */
  const [cardioDelDia, setCardioDelDia] = useState<OtherSessionView | null>(null);
  const [cardioEstado, setCardioEstado] = useState<"pendiente" | "hecho" | "omitido">("pendiente");
  const [cardioMsg, setCardioMsg] = useState<string | null>(null);
  const [calentamientoIniciado, setCalentamientoIniciado] = useState(false);
  const [pasoCalentamiento, setPasoCalentamiento] = useState(0);
  /**
   * Hora de término del paso actual, igual que `descansoHasta` en
   * `sesion-viva.ts`: una HORA absoluta, no un contador. iOS congela los
   * timers con la app en el fondo, así que el tiempo real sale de comparar
   * esta hora contra el reloj de pared, no de ir restando segundo a segundo.
   * `null` = el paso actual no está corriendo (calentamiento sin empezar, o
   * ya terminado).
   */
  const [calentamientoHasta, setCalentamientoHasta] = useState<number | null>(null);
  const [ahoraCalentamiento, setAhoraCalentamiento] = useState(() => Date.now());
  const calentamientoIntervalo = useRef<ReturnType<typeof setInterval> | null>(null);

  // El reloj de pared. El descanso se calcula contra ÉL y no contra un
  // contador que se congela cuando iOS suspende la app.
  const [ahora, setAhora] = useState(() => Date.now());

  // El intervalo se guarda en ref para poder apagarlo desde varios lugares sin
  // que el efecto se vuelva a montar en cada tick.
  const intervalo = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Pulso por serie, leído del reloj al cerrarla.
   *
   * La llave es `ejercicio:serie` para que la retro quede pegada a la serie
   * que la produjo y no a un promedio de la sesión, que no dice si la cuarta
   * costó más que la primera.
   */
  const [pulsos, setPulsos] = useState<Record<string, PulsoDeTramo>>({});
  const [cambiando, setCambiando] = useState(false);
  const inicioDeSerie = useRef<Date>(new Date());

  /**
   * Montaje de cada ejercicio (carga por lado y barra) y el perfil de pulso.
   * Se lee del teléfono al abrir y se refresca del servidor si hay señal.
   */
  const [datos, setDatos] = useState<DatosDeSesion>({ montajes: {}, edad: null, fcReposo: null });
  const datosRef = useRef(datos);
  datosRef.current = datos;
  /** La pregunta "¿se carga por lado?": en qué paso va y para qué ejercicio. */
  const [preguntaMontaje, setPreguntaMontaje] = useState<
    { exerciseId: string; nombre: string; paso: "lado" | "barra" } | null
  >(null);
  const [barraBorrador, setBarraBorrador] = useState("");
  /** Ejercicios por los que ya se preguntó en esta sesión (aunque se haya cerrado sin contestar). */
  const preguntados = useRef<Set<string>>(new Set());

  /** La última lectura de pulso del reloj y a cuánto tiene que bajar. */
  const [fc, setFc] = useState<(LecturaDeFc & { objetivo: number | null }) | null>(null);

  // Hay un Apple Watch con la app puesta.
  //
  // Se vuelve a revisar al volver del fondo, y no una sola vez al montar: el
  // reloj puede tardar en aparecer (la app del reloj se está instalando, el
  // reloj estaba fuera de alcance, WatchConnectivity todavía no activaba). Con
  // la comprobación única, ese arranque en frío dejaba la sesión SIN mandar
  // nada a la muñeca durante todo el entrenamiento, y el reloj se veía muerto.
  const [reloj, setReloj] = useState(() => estadoDelReloj());
  const conReloj = reloj.soportado && reloj.emparejado && reloj.appInstalada;

  useEffect(() => {
    const suscripcion = AppState.addEventListener("change", (siguiente) => {
      if (siguiente === "active") setReloj(estadoDelReloj());
    });
    // Y una revisión más al abrir: la activación de la sesión es asíncrona y
    // suele completarse justo después del primer render.
    const tarde = setTimeout(() => setReloj(estadoDelReloj()), 2000);

    return () => {
      suscripcion.remove();
      clearTimeout(tarde);
    };
  }, []);

  // Lo que llega del reloj puede llegar con la pantalla en segundo plano, o
  // entre renders. Estas referencias son para leer el estado de ahora sin
  // volver a montar la suscripción cada vez que cambia algo.
  const estadoRef = useRef<EstadoSesion | null>(null);
  const draftRef = useRef<SessionSyncInput | null>(null);
  const sesionRef = useRef<SessionView | null>(null);
  estadoRef.current = estado;
  draftRef.current = draft;
  sesionRef.current = sesion;

  const cargar = useCallback(async () => {
    try {
      const semana: WeekView | null = await getCachedWeek(mondayISO());
      const encontrada = semana?.sessions.find((entrada) => entrada.workoutId === workoutId) ?? null;
      if (!encontrada) {
        setError("Esa sesión no está en el teléfono. Ábrela una vez en Rutinas con señal.");
        return;
      }

      const pendiente = await getPendingSession(encontrada.workoutId);
      const guardadas = pendiente?.payload ?? {
        workoutId: encontrada.workoutId,
        completedAt: null,
        notes: null,
        sets: [],
        substitutions: [],
      };

      // Lo ya capturado manda: si alguien cerró tres series en el modo de
      // siempre y luego entra aquí, la sesión en vivo arranca en la cuarta.
      const ejercicios: EjercicioVivo[] = encontrada.exercises.map((ejercicio, indice) => ({
        indice,
        nombre: ejercicio.name,
        exerciseId: ejercicio.exerciseId,
        // Rol y esquema deciden el descanso por esfuerzo (`descansoPara`).
        poolRole: ejercicio.poolRole,
        esquema: ejercicio.scheme,
        alternativas: ejercicio.alternatives,
        descansoSeg: ejercicio.restSeconds,
        unilateral: ejercicio.unilateral === true,
        series: ejercicio.sets.map((serie, setIndex) => {
          const capturada = guardadas.sets.find(
            (set) => set.clientId === clientIdFor(encontrada.workoutId, indice, setIndex),
          );
          // El peso de un dropset no viene del plan: sale de la serie de la
          // que cuelga, 20 % abajo. Prellenarlo es lo que evita que alguien
          // tenga que hacer la cuenta con la mancuerna en la mano.
          const anterior = ejercicio.sets[setIndex - 1];
          const sugerido =
            serie.intensity === "dropset" && serie.weightKg === null
              ? pesoDeDropset(anterior?.weightKg ?? null)
              : serie.weightKg;

          return {
            objetivo: serie.reps,
            hechas: capturada?.reps ?? null,
            pesoKg: capturada?.weightKg ?? sugerido ?? null,
            pesoPlanKg: sugerido ?? null,
            calentamiento: serie.warmup,
            ...(serie.tempo ? { tempo: serie.tempo } : {}),
            ...(serie.intensity ? { intensidad: serie.intensity } : {}),
            ...(serie.side ? { lado: serie.side } : {}),
          };
        }),
      }));

      setSesion(encontrada);
      setDraft(guardadas);
      const cardio = cardioDeLaFecha(semana?.otherSessions, encontrada.date);
      // P1b: la máquina o modalidad que se eligió en la hoja para hoy manda.
      const elegido = cardio ? await leeCardioDelDia(encontrada.date) : null;
      setCardioDelDia(cardio && elegido ? { ...cardio, minutes: elegido.minutes, sesion: elegido.sesion } : cardio);

      const base = estadoInicial(ejercicios);

      // Volver del video de la técnica no puede reiniciar la sesión: se
      // recupera dónde ibas y el descanso que estaba corriendo. Si el
      // descanso ya venció mientras estabas afuera, entra vencido y la
      // pantalla lo apaga en el primer render, que es lo correcto.
      const enCurso = await leeSesionEnCurso(encontrada.workoutId);
      let estadoFinal = base;
      if (enCurso && !base.terminada) {
        const ejercicio = ejercicios[enCurso.ejercicioActual];
        const serieValida = ejercicio?.series[enCurso.serieActual] !== undefined;
        if (serieValida) {
          // Lo que quedó sin cerrar ANTES del cursor fue un "Terminar este
          // ejercicio": se da por terminado, no se vuelve a pedir.
          estadoFinal = omitirSaltadas({
            ...base,
            ejercicioActual: enCurso.ejercicioActual,
            serieActual: enCurso.serieActual,
            descansoHasta: enCurso.descansoHasta,
          });
          setReps(enCurso.reps);
          setPeso(enCurso.pesoKg);
        }
      }
      setEstado(estadoFinal);

      // El calentamiento solo se abre si el plan lo trae y todavía no hay
      // ninguna serie cerrada: volver a entrar con la sesión ya empezada no
      // puede mandar de regreso al calentamiento.
      setFase(
        encontrada.warmup !== null && progreso(estadoFinal).hechas === 0
          ? "calentamiento"
          : "entrenando",
      );

      // N2: el cardio de hoy ya hecho (aquí o suelto) no se vuelve a ofrecer;
      // uno a medias se retoma directo en su tramo.
      if (cardio?.sesion?.cardio && estadoFinal.terminada) {
        const pasosCardio = pasosDeCardio(cardio.sesion.cardio, cardio.minutes);
        const [hecho, enCurso] = await Promise.all([
          leeCardioHecho(encontrada.date),
          leeCardioEnCurso(encontrada.date, pasosCardio.length),
        ]);
        if (hecho !== null) {
          setCardioEstado("hecho");
          setCardioMsg(`Cardio de hoy ya registrado · ${hecho} min.`);
        } else if (enCurso) {
          setFase("cardio");
        }
      }
      setCalentamientoIniciado(false);
      setPasoCalentamiento(0);
      setCalentamientoHasta(null);
    } catch {
      setError("No se pudo abrir tu sesión.");
    }
  }, [workoutId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Al cambiar de serie, los campos se preparan con lo que pide el plan: reps
  // objetivo y el peso de la serie anterior. Escribir desde cero cada vez es
  // la fricción que hace que nadie registre.
  useEffect(() => {
    if (!estado || estado.terminada) return;
    const ejercicioActual = estado.ejercicios[estado.ejercicioActual];
    const serie = ejercicioActual?.series[estado.serieActual];
    if (!ejercicioActual || !serie) return;
    setReps(serie.objetivo);
    // El peso sale de la tendencia: lo que sugiere la progresión corrido por
    // lo que de verdad se cargó en la anterior (o la anterior ajustada por
    // reps en una pirámide). Se ve y se ajusta durante el descanso, para
    // salir de él ya listo.
    setPeso(pesoSugerido(ejercicioActual, estado.serieActual) ?? serie.pesoKg);
  }, [estado?.ejercicioActual, estado?.serieActual, estado?.terminada]);

  // El reloj del descanso.
  //
  // El intervalo NO descuenta nada: solo empuja la hora actual para que la
  // pantalla se vuelva a pintar. Cuánto falta sale siempre de la hora de
  // término (`descansoHasta`) contra el reloj de pared, así que contestar un
  // mensaje a media serie —con iOS congelando los timers— ya no deja el
  // descanso parado en el segundo en que se salió.
  useEffect(() => {
    if (!estado || estado.descansoHasta === null) {
      if (intervalo.current) {
        clearInterval(intervalo.current);
        intervalo.current = null;
      }
      return;
    }

    if (intervalo.current) return;

    intervalo.current = setInterval(() => setAhora(Date.now()), TICK_MS);

    return () => {
      if (intervalo.current) {
        clearInterval(intervalo.current);
        intervalo.current = null;
      }
    };
  }, [estado?.descansoHasta === null]);

  // El reloj del paso de calentamiento en curso. Mismo patrón que el del
  // descanso arriba: el intervalo solo empuja la hora, nunca resta segundos.
  useEffect(() => {
    if (calentamientoHasta === null) {
      if (calentamientoIntervalo.current) {
        clearInterval(calentamientoIntervalo.current);
        calentamientoIntervalo.current = null;
      }
      return;
    }

    if (calentamientoIntervalo.current) return;

    calentamientoIntervalo.current = setInterval(() => setAhoraCalentamiento(Date.now()), TICK_MS);

    return () => {
      if (calentamientoIntervalo.current) {
        clearInterval(calentamientoIntervalo.current);
        calentamientoIntervalo.current = null;
      }
    };
  }, [calentamientoHasta === null]);

  // Cuando el paso actual se agota, avanza solo al siguiente —o, si era el
  // último, pasa a la primera serie— con una háptica marcando el cambio.
  useEffect(() => {
    if (calentamientoHasta === null || ahoraCalentamiento < calentamientoHasta) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    avanzarCalentamiento(pasoCalentamiento + 1);
  }, [calentamientoHasta, ahoraCalentamiento]);

  // Al volver de otra app —el video de la técnica, un mensaje— la hora se
  // pone al día de inmediato, sin esperar el siguiente tick.
  useEffect(() => {
    const suscripcion = AppState.addEventListener("change", (siguiente) => {
      if (siguiente === "active") setAhora(Date.now());
    });
    return () => suscripcion.remove();
  }, []);

  // El aviso de "se acabó el descanso" se dispara una sola vez, cuando la
  // hora de término ya pasó. Vive aquí y no en el intervalo porque también
  // tiene que dispararse al volver de segundo plano con el descanso vencido.
  useEffect(() => {
    if (!estado || !descansoTermino(estado, ahora)) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setEstado((actual) => (actual ? cerrarDescanso(actual) : actual));
  }, [estado?.descansoHasta, ahora]);

  // El cursor se guarda en cada movimiento: es lo que hace que salir a ver un
  // video y volver caiga exactamente donde estabas.
  useEffect(() => {
    if (!estado || !sesion || estado.terminada) return;
    void guardaSesionEnCurso({
      workoutId: sesion.workoutId,
      ejercicioActual: estado.ejercicioActual,
      serieActual: estado.serieActual,
      descansoHasta: estado.descansoHasta,
      reps,
      pesoKg: peso,
    });
  }, [
    sesion?.workoutId,
    estado?.ejercicioActual,
    estado?.serieActual,
    estado?.descansoHasta,
    estado?.terminada,
    reps,
    peso,
  ]);

  // La preferencia de captura (kg/lb y salto) se lee una vez al abrir.
  useEffect(() => {
    void leePreferenciaDePeso().then((preferencia) => {
      setUnidad(preferencia.unidad);
      setPaso(preferencia.paso);
    });
  }, []);

  // Montajes y perfil de pulso: primero lo del teléfono (sirve sin señal) y
  // luego el servidor, que manda si responde. Lo que el teléfono sabe y el
  // servidor todavía no (se contestó sin red) se conserva.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const locales = await leeDatosLocales();
      if (!vivo) return;
      setDatos(locales);
      try {
        const remoto = await getEjercicioPrefs();
        if (!vivo) return;
        const fusion: DatosDeSesion = {
          montajes: { ...locales.montajes, ...remoto.prefs },
          edad: remoto.edad ?? locales.edad,
          fcReposo: remoto.fcReposo ?? locales.fcReposo,
        };
        setDatos(fusion);
        void guardaDatosLocales(fusion);
        // Lo contestado sin señal se sube ahora.
        for (const [id, montaje] of Object.entries(locales.montajes)) {
          if (!remoto.prefs[id]) void patchEjercicioPrefs(id, montaje).catch(() => undefined);
        }
      } catch {
        // Sin señal: se queda lo del teléfono.
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  function guardarMontaje(exerciseId: string, montaje: Montaje) {
    const siguiente = { ...datosRef.current, montajes: { ...datosRef.current.montajes, [exerciseId]: montaje } };
    setDatos(siguiente);
    void guardaDatosLocales(siguiente);
    void patchEjercicioPrefs(exerciseId, montaje).catch(() => undefined);
  }

  // La primera vez en una barra o máquina de discos se pregunta cómo se
  // carga. Se pregunta una sola vez por ejercicio y sesión: cerrar la hoja
  // sin contestar es un "ahora no", no una invitación a insistir.
  useEffect(() => {
    if (!estado || estado.terminada || fase !== "entrenando") return;
    const actual = estado.ejercicios[estado.ejercicioActual];
    const id = actual?.exerciseId;
    if (!actual || !id || datos.montajes[id] || preguntados.current.has(id)) return;
    if (!preguntarMontaje(actual.nombre)) return;
    preguntados.current.add(id);
    setPreguntaMontaje({ exerciseId: id, nombre: actual.nombre, paso: "lado" });
  }, [estado?.ejercicioActual, estado?.ejercicios, estado?.terminada, fase, datos.montajes]);

  /**
   * El pulso que manda el reloj durante el descanso (`{tipo:'fc', bpm, t}`
   * cada ~5 s). Mueve el término del descanso hacia la recuperación real —
   * ver `descansoPara` — y alimenta el "Recuperándote · 128 → 110 lpm".
   */
  useEffect(() => {
    if (!conReloj) return;
    const suscripcion = alFrecuenciaDelReloj((lectura) => {
      const actual = estadoRef.current;
      if (!actual) return;
      const perfil = { reposo: datosRef.current.fcReposo, edad: datosRef.current.edad };
      const { estado: siguiente, descanso } = conFrecuencia(actual, lectura.bpm, perfil, Date.now());
      setFc({ ...lectura, objetivo: descanso?.fcObjetivo ?? null });
      if (siguiente !== actual) setEstado(siguiente);
    });
    return () => suscripcion?.remove();
  }, [conReloj]);

  const persistir = useCallback(async (siguiente: SessionSyncInput) => {
    setDraft(siguiente);
    await upsertPendingSession(siguiente.workoutId, siguiente);
    await refreshPendingCount();
    void syncAndNotify();
  }, []);

  /**
   * Manda a la muñeca el estado de la sesión.
   *
   * Depende de `estado.ejercicios` y no de `estado`: durante el descanso el
   * estado cambia cada segundo, y mandar el espejo entero una vez por segundo
   * sería gastar batería del reloj para no decirle nada nuevo. La lista de
   * ejercicios solo cambia cuando una serie se cierra, que es justo cuando el
   * reloj necesita enterarse.
   */
  useEffect(() => {
    if (!conReloj || !sesion || !estado) return;
    enviarSesionAlReloj(paraElReloj(sesion.workoutId, sesion.muscleGroup, estado));
    // También cuando se mueve el término del descanso (esfuerzo, RPE, pulso,
    // "+30 s"): el reloj cuenta el descanso que de verdad toca.
  }, [conReloj, sesion?.workoutId, estado?.ejercicios, estado?.descansoHasta]);

  /**
   * Recoge las series que se cerraron desde la muñeca.
   *
   * El teléfono manda sobre el reloj en los conflictos —eso lo resuelve
   * `aplicarDelReloj`— y aquí solo se escribe lo que de verdad se aplicó: meter
   * en el borrador una serie que la pantalla descartó dejaría la base local
   * diciendo algo distinto de lo que se ve.
   */
  const recogerDelReloj = useCallback(async () => {
    const actual = estadoRef.current;
    const borrador = draftRef.current;
    const abierta = sesionRef.current;
    if (!actual || !borrador || !abierta) return;

    const cerradas = drenarSeriesCerradas<SerieCerradaEnReloj>();
    if (cerradas.length === 0) return;

    const { estado: siguiente, aplicadas } = aplicarDelReloj(actual, cerradas, abierta.workoutId);
    if (aplicadas.length === 0) return;

    setEstado(siguiente);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const nuevos = aplicadas.map((cerrada) => {
      const ejercicio = siguiente.ejercicios[cerrada.ejercicioIndice]!;
      const serie = ejercicio.series[cerrada.serieIndice]!;
      return {
        clientId: clientIdFor(abierta.workoutId, cerrada.ejercicioIndice, cerrada.serieIndice),
        exerciseId: abierta.exercises[cerrada.ejercicioIndice]?.exerciseId ?? null,
        exerciseName: ejercicio.nombre,
        setIndex: cerrada.serieIndice,
        targetReps: serie.objetivo,
        reps: cerrada.reps,
        weightKg: serie.pesoKg,
        rpe: null,
        warmup: serie.calentamiento,
        performedAt: cerrada.cerradaEn,
      };
    });

    const escritos = new Set(nuevos.map((set) => set.clientId));
    await persistir({
      ...borrador,
      sets: [...borrador.sets.filter((set) => !escritos.has(set.clientId)), ...nuevos],
    });
  }, [persistir]);

  /**
   * Cuándo se recoge: al abrir, cuando el reloj avisa, y al volver del segundo
   * plano. Lo último importa porque iOS entrega lo que el reloj mandó aunque la
   * app esté dormida, y ese aviso puede llegar sin nadie escuchando.
   */
  useEffect(() => {
    if (!conReloj) return;

    void recogerDelReloj();

    const suscripcion = alCerrarSerieEnElReloj(() => void recogerDelReloj());
    const appState = AppState.addEventListener("change", (siguiente) => {
      if (siguiente === "active") void recogerDelReloj();
    });

    return () => {
      suscripcion?.remove();
      appState.remove();
    };
  }, [conReloj, recogerDelReloj]);

  /**
   * Va al paso `indice` del calentamiento. Si ya no hay paso en ese índice
   * —se acabó la lista— cierra el calentamiento y pasa a la primera serie,
   * que es exactamente lo que hace "Saltar calentamiento".
   */
  function avanzarCalentamiento(indice: number) {
    const pasos = pasosEnCurso();
    const siguiente = pasos[indice];
    if (!siguiente) {
      setCalentamientoHasta(null);
      setFase("entrenando");
      return;
    }
    setPasoCalentamiento(indice);
    setCalentamientoHasta(Date.now() + siguiente.segundos * 1000);
  }

  /** Los pasos que corre el timer del calentamiento. */
  function pasosEnCurso(): WarmupStep[] {
    return sesion?.warmup?.pasos ?? [];
  }

  /** El cardio lo corre `CorredorCardio`: aquí solo se cambia de fase. */
  function empezarCardio() {
    setFase("cardio");
  }

  function empezarCalentamiento() {
    setCalentamientoIniciado(true);
    avanzarCalentamiento(0);
  }

  function saltarPasoCalentamiento() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    avanzarCalentamiento(pasoCalentamiento + 1);
  }

  /** Nunca es obligatorio: pasa directo a la primera serie, desde donde sea. */
  function saltarTodoElCalentamiento() {
    setCalentamientoHasta(null);
    setFase("entrenando");
  }

  function marcarSerie() {
    if (!estado || !draft || !sesion || estado.terminada) return;

    const ejercicioIndex = estado.ejercicioActual;
    const setIndex = estado.serieActual;
    const ejercicio = estado.ejercicios[ejercicioIndex];
    const serie = ejercicio?.series[setIndex];
    if (!ejercicio || !serie) return;

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    // El pulso de la serie: desde que terminó el descanso anterior (o desde
    // que abrió la pantalla, en la primera) hasta ahora. Se pide al cerrar,
    // no durante: la app lee lo que el reloj ya escribió en Salud, no hay
    // canal en vivo sin una app en la muñeca.
    const desde = inicioDeSerie.current;
    const hasta = new Date();
    inicioDeSerie.current = hasta;

    const clave = `${ejercicioIndex}:${setIndex}`;
    void pulsoEntre(desde, hasta).then((pulso) => {
      if (pulso.promedio === null) return;
      setPulsos((previos) => ({ ...previos, [clave]: pulso }));
    });

    // La MISMA hora para el término del descanso y para el reloj de la
    // pantalla. `ahora` solo se empuja mientras hay descanso, así que entre
    // descansos se queda con la hora del último tick: el primer frame del
    // descanso nuevo restaba contra esa hora vieja y el cronómetro arrancaba
    // en un número (base + lo que llevaba parado) y saltaba al correcto en el
    // siguiente tick.
    const momento = Date.now();
    const { estado: siguiente } = cerrarSerie(estado, { reps, pesoKg: peso }, momento);
    setAhora(momento);
    setFc(null);
    setEstado(siguiente);

    const clientId = clientIdFor(sesion.workoutId, ejercicioIndex, setIndex);
    const plantilla = sesion.exercises[ejercicioIndex];

    void persistir({
      ...draft,
      sets: [
        ...draft.sets.filter((set) => set.clientId !== clientId),
        {
          clientId,
          exerciseId: plantilla?.exerciseId ?? null,
          exerciseName: ejercicio.nombre,
          setIndex,
          targetReps: serie.objetivo,
          reps,
          weightKg: peso,
          rpe: null,
          warmup: serie.calentamiento,
          performedAt: new Date().toISOString(),
        },
      ],
    });
  }

  /**
   * Cambiar de ejercicio a media sesión.
   *
   * Es el caso que pasa siempre: la máquina está ocupada y hay que resolver
   * ahora, no salir a Rutinas a reacomodar el plan. Solo se ofrecen
   * alternativas del mismo grupo muscular — cambiar de máquina no es cambiar
   * de músculo.
   *
   * Lo capturado en ese lugar se va con la máquina anterior: la carga de la
   * prensa no es la del hack squat, y conservarla mentiría en la progresión.
   */
  function sustituir(alternativa: ExerciseAlternative) {
    if (!estado || !draft || !sesion) return;

    // Si lo elegido ya tocaba más abajo, ese de abajo se cambia por otra de
    // sus alternativas: una sesión con el mismo ejercicio dos veces es un
    // error del cambio, no una elección. Cada cambio viaja a la cola en orden.
    const { estado: siguiente, cambios } = sustituirEnSesion(
      estado,
      estado.ejercicioActual,
      alternativa,
    );
    setEstado(siguiente);
    setCambiando(false);

    const indices = new Set(cambios.map((cambio) => cambio.indice));
    const prefijos = cambios.map((cambio) => exercisePrefix(sesion.workoutId, cambio.indice));
    void persistir({
      ...draft,
      sets: draft.sets.filter((serie) => !prefijos.some((prefijo) => serie.clientId.startsWith(prefijo))),
      substitutions: [
        ...draft.substitutions.filter((cambio) => !indices.has(cambio.exerciseIndex)),
        ...cambios.map((cambio) => ({
          exerciseIndex: cambio.indice,
          exerciseId: cambio.alternativa.exerciseId,
        })),
      ],
    });
  }

  /**
   * "¿Qué tan dura?" — el RPE de la serie que se acaba de cerrar, opcional.
   * Mueve el descanso en curso (`conRpe`) y viaja en `WorkoutSet.rpe`, que es
   * lo que la progresión lee para decidir si la semana que viene sube.
   */
  function marcarRpe(rpe: number) {
    if (!estado || !draft || !sesion || !estado.descanso) return;
    const { ejercicio: ejercicioIndice, serie: serieIndice } = estado.descanso;
    void Haptics.selectionAsync();
    setEstado(conRpe(estado, ejercicioIndice, serieIndice, rpe, Date.now()));

    const clientId = clientIdFor(sesion.workoutId, ejercicioIndice, serieIndice);
    if (!draft.sets.some((set) => set.clientId === clientId)) return;
    void persistir({
      ...draft,
      sets: draft.sets.map((set) => (set.clientId === clientId ? { ...set, rpe } : set)),
    });
  }

  /**
   * "Terminar este ejercicio": pasa al siguiente y deja las series que
   * faltan SIN registrar — no se inventan ceros. En el último ejercicio es
   * terminar la sesión, y el reloj se entera.
   */
  function terminarEsteEjercicio() {
    if (!estado) return;
    const { estado: siguiente, siguiente: que } = terminarEjercicio(estado);
    setEstado(siguiente);
    setCambiando(false);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (que === "fin") enviarFinAlReloj();
  }

  /**
   * Guarda una serie YA cerrada que se corrigió (los kilos que faltaban, las
   * reps que salieron distintas).
   *
   * Cerrar una serie sin peso no tenía vuelta atrás: quedaba capturada en
   * blanco y la única salida era rehacer la sesión. Aquí se corrige sin mover
   * dónde vas ni tocar el descanso en curso.
   */
  function corregirSerie(
    ejercicioIndice: number,
    serieIndice: number,
    valores: { reps: number; pesoKg: number | null },
  ) {
    if (!estado || !draft || !sesion) return;

    const ejercicio = estado.ejercicios[ejercicioIndice];
    const serie = ejercicio?.series[serieIndice];
    if (!ejercicio || !serie) return;

    setEstado(editarSerie(estado, ejercicioIndice, serieIndice, valores));

    const clientId = clientIdFor(sesion.workoutId, ejercicioIndice, serieIndice);
    const plantilla = sesion.exercises[ejercicioIndice];
    const previa = draft.sets.find((set) => set.clientId === clientId);

    void persistir({
      ...draft,
      sets: [
        ...draft.sets.filter((set) => set.clientId !== clientId),
        {
          clientId,
          exerciseId: plantilla?.exerciseId ?? null,
          exerciseName: ejercicio.nombre,
          setIndex: serieIndice,
          targetReps: serie.objetivo,
          reps: valores.reps,
          weightKg: valores.pesoKg,
          rpe: serie.rpe ?? previa?.rpe ?? null,
          warmup: serie.calentamiento,
          // La hora en que se hizo es la original: corregir el peso no mueve
          // cuándo se levantó.
          performedAt: previa?.performedAt ?? new Date().toISOString(),
        },
      ],
    });
  }

  /** Cómo se carga el ejercicio en curso. `null` = total directo. */
  function montajeActual(): Montaje | null {
    const id = estado?.ejercicios[estado.ejercicioActual]?.exerciseId;
    const montaje = id ? datos.montajes[id] : undefined;
    return montaje?.cargaPorLado ? montaje : null;
  }

  /** Aplica lo tecleado en el campo manual y cierra el teclado. */
  function aplicarCaptura() {
    if (!capturando) return;

    const numero = Number(borrador.replace(",", "."));
    if (!Number.isFinite(numero) || numero < 0) {
      setCapturando(null);
      return;
    }

    const objetivo = capturando.serie;
    const esPeso = capturando.campo === "peso";
    // Lo tecleado está en la unidad que se está viendo; a kilos antes de
    // guardar, siempre. Con carga por lado se teclea UN lado y se guarda el
    // total: lado × 2 + barra.
    const montaje = montajeActual();
    const valor = !esPeso
      ? Math.round(numero)
      : montaje
        ? totalDesdeLado(aKilos(numero, unidad), montaje.barraKg)
        : aKilos(numero, unidad);

    if (objetivo === null) {
      if (esPeso) setPeso(valor);
      else setReps(valor);
    } else {
      const serie = estado?.ejercicios[objetivo.ejercicio]?.series[objetivo.serie];
      corregirSerie(objetivo.ejercicio, objetivo.serie, {
        reps: esPeso ? (serie?.hechas ?? serie?.objetivo ?? 0) : valor,
        pesoKg: esPeso ? valor : (serie?.pesoKg ?? null),
      });
    }

    setCapturando(null);
  }

  /** Abre el teclado para un campo, con el valor de hoy ya escrito. */
  function abrirCaptura(
    campo: "reps" | "peso",
    objetivo: { ejercicio: number; serie: number } | null,
  ) {
    const serie = objetivo ? estado?.ejercicios[objetivo.ejercicio]?.series[objetivo.serie] : null;

    const actual =
      campo === "reps"
        ? objetivo
          ? (serie?.hechas ?? serie?.objetivo ?? 0)
          : reps
        : objetivo
          ? serie?.pesoKg ?? null
          : peso;

    const montaje = montajeActual();
    setBorrador(
      actual === null || actual === undefined
        ? ""
        : campo === "peso"
          ? formatoPeso(aUnidad(montaje ? ladoDesdeTotal(actual, montaje.barraKg) : actual, unidad))
          : String(actual),
    );
    setCapturando({ campo, serie: objetivo });
  }

  function cambiarUnidad(siguiente: UnidadDePeso) {
    // El paso se lleva a uno que exista en la unidad nueva: 2.5 lb no es ni un
    // disco chico, y 10 kg no es un ajuste, es otro ejercicio.
    const opciones = pasosDe(siguiente);
    const nuevoPaso = opciones.includes(paso) ? paso : (opciones[2] ?? opciones[0]!);
    setUnidad(siguiente);
    setPaso(nuevoPaso);
    void guardaPreferenciaDePeso({ unidad: siguiente, paso: nuevoPaso });
  }

  function cambiarPaso(siguiente: number) {
    setPaso(siguiente);
    void guardaPreferenciaDePeso({ unidad, paso: siguiente });
  }

  /**
   * Terminar la sesión AQUÍ, con lo que se hizo.
   *
   * El caso que lo pidió: una sesión de 26 series a la que ya no se le podía
   * más, y la única salida era darle "serie hecha" a todo lo que faltaba —
   * capturando series que nunca pasaron, en cero, solo para poder cerrar.
   * Eso ensucia el historial y la progresión con datos falsos.
   *
   * Aquí las series que no se hicieron se quedan SIN capturar, que es la
   * verdad: la sesión cierra con lo que sí pasó, y la semana siguiente
   * arranca de esos números reales.
   */
  const [confirmandoFin, setConfirmandoFin] = useState(false);

  async function terminarAqui() {
    if (!draft) return;
    setConfirmandoFin(false);
    // El reloj deja de mostrar la sesión: sin esto seguía en la serie que
    // tocaba, de una sesión que ya estaba cerrada.
    enviarFinAlReloj();
    await persistir({ ...draft, completedAt: new Date().toISOString() });
    await olvidaSesionEnCurso();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace("/rutinas");
  }

  async function cerrarSesion() {
    if (!draft) return;
    enviarFinAlReloj();
    await persistir({ ...draft, completedAt: new Date().toISOString() });
    await olvidaSesionEnCurso();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.replace("/rutinas");
  }

  if (error) return <ErrorState message={error} onRetry={() => void cargar()} />;
  if (!estado || !sesion) return <LoadingState label="Preparando tu sesión..." />;

  const avance = progreso(estado);
  const ejercicio = estado.ejercicios[estado.ejercicioActual];
  // La hora de la pantalla nunca es más vieja que la de este render: el
  // estado `ahora` solo avanza con el intervalo, y un descanso recién
  // arrancado no puede leerse contra el tick de hace tres minutos.
  const ahoraVisible = Math.max(ahora, Date.now());
  const restante = restanteSeg(estado, ahoraVisible);
  const descansando = restante !== null && restante > 0;

  const montaje = montajeActual();
  const alternativas = alternativasLibres(estado, estado.ejercicioActual);
  const pendientesDelEjercicio =
    ejercicio?.series.filter((serie) => serie.hechas === null && serie.omitida !== true).length ?? 0;
  const hechasDelEjercicio = ejercicio?.series.filter((serie) => serie.hechas !== null).length ?? 0;
  /** "Por lado 20 kg · total 60 kg" — siempre a la vista con carga por lado. */
  const textoDeCarga =
    montaje && peso !== null
      ? `Por lado ${formatoPeso(aUnidad(ladoDesdeTotal(peso, montaje.barraKg), unidad))} ${unidad} · total ${formatoPeso(aUnidad(peso, unidad))} ${unidad}`
      : null;
  const fcVigente = fc !== null && ahoraVisible - fc.en < 20_000 ? fc : null;

  function ajustarPesoSiguiente(delta: number) {
    setPeso((valor) => {
      if (!montaje) return ajustaPeso(valor, delta, unidad);
      const lado = ladoDesdeTotal(valor ?? montaje.barraKg, montaje.barraKg);
      return totalDesdeLado(ajustaPeso(lado, delta, unidad), montaje.barraKg);
    });
  }

  const serieActual = ejercicio?.series[estado.serieActual] ?? null;
  const tempoActual = textoDeTempo(serieActual?.tempo);

  const warmup = sesion.warmup;
  const enCalentamiento = !estado.terminada && fase === "calentamiento" && warmup !== null;
  // Mismo arreglo que el descanso: `ahoraCalentamiento` es la hora del
  // último tick, y el primer paso arrancaba contado contra la hora en que se
  // abrió la pantalla.
  const restanteCalentamiento =
    calentamientoHasta === null
      ? null
      : Math.max(
          0,
          Math.ceil((calentamientoHasta - Math.max(ahoraCalentamiento, Date.now())) / 1000),
        );

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <View style={styles.barra}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.salir}>
          <ChevronLeft size={22} color={colors.paloRosa} strokeWidth={2} />
          <Text style={styles.salirTexto}>Salir</Text>
        </Pressable>
        <View style={styles.barraDerecha}>
          {conReloj ? (
            <View style={styles.relojChip}>
              <Watch size={13} color={colors.champan} strokeWidth={2} />
              <Text style={styles.relojChipTexto}>Reloj</Text>
            </View>
          ) : null}
          <Text style={styles.progresoTexto}>
            {avance.hechas} de {avance.total} series · {volumenKg(estado)} kg
            {/* Los minutos que de verdad se lleva la sesión: series, descansos
                y calentamiento medidos, no la tabla de "60 min ⇒ 6 ejercicios"
                que producía sesiones de dos horas. Ausente en sesiones armadas
                antes de la Fase 3 — ahí no se enseña nada. */}
            {sesion.estimatedMin ? ` · ≈ ${sesion.estimatedMin} min` : ""}
          </Text>
        </View>
      </View>

      <View style={styles.barraProgreso}>
        <View
          style={[
            styles.barraLlena,
            { width: `${avance.total === 0 ? 0 : (avance.hechas / avance.total) * 100}%` },
          ]}
        />
      </View>

      {estado.terminada && fase === "cardio" && cardioEstado !== "hecho" && cardioDelDia?.sesion?.cardio ? (
        // N2: el mismo corredor del cardio suelto. Al terminar (o "Terminar
        // aquí") registra y vuelve a "Sesión completa" con el mensaje.
        <CorredorCardio
          detalle={cardioDelDia.sesion.cardio}
          minutos={cardioDelDia.minutes}
          fecha={sesion.date}
          onTerminado={(resultado) => {
            setCardioEstado("hecho");
            setCardioMsg(resultado.mensaje);
          }}
        />
      ) : estado.terminada ? (
        <ScrollView contentContainerStyle={styles.contenido}>
          <Text style={styles.tituloFin}>Sesión completa</Text>
          <Parrafo style={styles.subtituloFin}>
            {avance.total} series · {volumenKg(estado)} kg levantados. Ya quedó guardada en tu
            teléfono; se sube sola cuando haya señal.
          </Parrafo>
          {cardioDelDia?.sesion?.cardio && cardioEstado === "pendiente" ? (
            // La tarjeta del cardio: una línea y un botón. Lo corre
            // `CorredorCardio`; al terminar se registra solo.
            <View style={styles.serieCaja}>
              <Text style={styles.seriePlan}>
                {tituloTarjetaCardio(cardioDelDia.sesion.cardio, cardioDelDia.minutes)}
              </Text>
              <Pressable onPress={empezarCardio} style={styles.botonPrincipal}>
                <PlayCircle size={22} color={colors.pergamino} strokeWidth={2.5} />
                <Text style={styles.botonPrincipalTexto}>Empezar cardio</Text>
              </Pressable>
              <Pressable onPress={() => setCardioEstado("omitido")} hitSlop={8}>
                <Text style={styles.cambiarEnlace}>Hoy no</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {cardioMsg && <Parrafo style={styles.subtituloFin}>{cardioMsg}</Parrafo>}
              <Pressable onPress={cerrarSesion} style={styles.botonPrincipal}>
                <Check size={22} color={colors.pergamino} strokeWidth={2.5} />
                <Text style={styles.botonPrincipalTexto}>Cerrar sesión</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      ) : enCalentamiento && warmup ? (
        <ScrollView contentContainerStyle={styles.contenido}>
          <Text style={styles.ejercicioPaso}>CALENTAMIENTO</Text>
          <Text style={styles.ejercicioNombre}>
            Antes de {ejercicio?.nombre ?? "tu primer ejercicio"}
          </Text>

          {!calentamientoIniciado ? (
            <View style={styles.serieCaja}>
              <Parrafo style={styles.seriePlan}>
                {Math.round(warmup.totalSeg / 60)} min para llegar lista al primer ejercicio:
                pulso arriba y los músculos de hoy en movimiento, sin estirar estático.
              </Parrafo>
              <View style={styles.lista}>
                {warmup.pasos.map((paso, index) => (
                  <View key={index} style={styles.listaFila}>
                    <Text style={styles.listaTexto}>{paso.nombre}</Text>
                    <Text style={styles.listaValor}>{paso.segundos} s</Text>
                  </View>
                ))}
              </View>
              <Pressable onPress={empezarCalentamiento} style={styles.botonPrincipal}>
                <Check size={22} color={colors.pergamino} strokeWidth={2.5} />
                <Text style={styles.botonPrincipalTexto}>Empezar calentamiento</Text>
              </Pressable>
              <Pressable onPress={saltarTodoElCalentamiento} hitSlop={8}>
                <Text style={styles.cambiarEnlace}>Saltar calentamiento</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.descanso}>
              <Timer size={20} color={colors.champan} strokeWidth={2} />
              <Text style={styles.descansoReloj}>{formatoReloj(restanteCalentamiento ?? 0)}</Text>
              <Text style={styles.descansoTexto}>
                {warmup.pasos[pasoCalentamiento]?.nombre ?? ""}
              </Text>
              <Text style={styles.progresoTexto}>
                Paso {pasoCalentamiento + 1} de {warmup.pasos.length}
              </Text>

              <View style={styles.descansoBotones}>
                <Pressable onPress={saltarPasoCalentamiento} style={styles.botonSecundario}>
                  <SkipForward size={16} color={colors.marfil} strokeWidth={2} />
                  <Text style={styles.botonSecundarioTexto}>Saltar paso</Text>
                </Pressable>
                <Pressable onPress={saltarTodoElCalentamiento} style={styles.botonSecundario}>
                  <Text style={styles.botonSecundarioTexto}>Saltar calentamiento</Text>
                </Pressable>
              </View>
            </View>
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.contenido}>
          <Text style={styles.ejercicioPaso}>
            Ejercicio {estado.ejercicioActual + 1} de {estado.ejercicios.length}
          </Text>
          <Text style={styles.ejercicioNombre}>{ejercicio?.nombre}</Text>

          <View style={styles.serieCaja}>
            <View style={styles.serieCabecera}>
              {/* En un unilateral el conteo va dentro del lado ("Derecho ·
                  serie 2 de 3"): quien tiene la mancuerna en la mano no
                  necesita saber que es la quinta de seis. */}
              <Text style={styles.serieEtiqueta}>
                {ejercicio ? etiquetaDeSerie(ejercicio, estado.serieActual) : ""}
              </Text>
              {tempoActual && (
                <>
                  <Text style={styles.serieTempo}>{tempoActual}</Text>
                  <InfoTip titulo="Qué es 3-1-1">
                    <TextoInfo>
                      Los segundos de cada repetición: {tempoActual.split("-")[0]} bajando,{" "}
                      {tempoActual.split("-")[1]} de pausa abajo y {tempoActual.split("-")[2]}{" "}
                      subiendo. Bajar despacio es la mitad del trabajo — la misma serie a tirones
                      no es la misma serie.
                    </TextoInfo>
                  </InfoTip>
                </>
              )}
            </View>
            {/* El plan es una referencia, no un campo: lo que se captura son
                las reps que DE VERDAD salieron. Si te quedas corto, la semana
                que viene el plan arranca en tu número, no en el que no
                alcanzaste. */}
            <Text style={styles.seriePlan}>
              El plan pide{" "}
              {serieActual ? objetivoDeSerie(serieActual) : "0 reps"} · anota las que hiciste
            </Text>

            {/* Un campo por renglón: compartir fila encimaba los botones de
                reps con los de peso, y los chips de salto parecían de las
                reps. Cada campo con sus controles, y los del peso PEGADOS al
                peso. */}
            <View style={styles.campos}>
              <Campo
                etiqueta="Reps que hiciste"
                valor={`${reps}`}
                onMenos={() => setReps((valor) => Math.max(0, valor - 1))}
                onMas={() => setReps((valor) => valor + 1)}
                onTocarValor={() => abrirCaptura("reps", null)}
              />

              <View style={styles.campoPeso}>
                <Campo
                  etiqueta={`${unidad === "kg" ? "Kilos" : "Libras"}${montaje ? " por lado" : ""}`}
                  valor={
                    peso === null
                      ? "—"
                      : formatoPeso(
                          aUnidad(montaje ? ladoDesdeTotal(peso, montaje.barraKg) : peso, unidad),
                        )
                  }
                  onMenos={() => ajustarPesoSiguiente(-paso)}
                  onMas={() => ajustarPesoSiguiente(paso)}
                  onTocarValor={() => abrirCaptura("peso", null)}
                />
                {textoDeCarga && <Text style={styles.cargaTexto}>{textoDeCarga}</Text>}
                {/* El salto de los botones y la unidad del PESO. La barra sube
                    de 2.5 en 2.5 pero la mancuerna de 0.5, y hay gimnasios con
                    los discos en libras. Tocar el número teclea la cantidad
                    exacta. */}
                <View style={styles.ajustes}>
                  <View style={styles.ajusteGrupo}>
                    {pasosDe(unidad).map((opcion) => (
                      <Pressable
                        key={opcion}
                        onPress={() => cambiarPaso(opcion)}
                        style={[styles.ajusteChip, paso === opcion && styles.ajusteChipOn]}
                      >
                        <Text style={[styles.ajusteTexto, paso === opcion && styles.ajusteTextoOn]}>
                          ±{formatoPeso(opcion)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <View style={styles.ajusteGrupo}>
                    {(["kg", "lb"] as const).map((opcion) => (
                      <Pressable
                        key={opcion}
                        onPress={() => cambiarUnidad(opcion)}
                        style={[styles.ajusteChip, unidad === opcion && styles.ajusteChipOn]}
                      >
                        <Text style={[styles.ajusteTexto, unidad === opcion && styles.ajusteTextoOn]}>
                          {opcion}
                        </Text>
                      </Pressable>
                    ))}
                    {ejercicio?.exerciseId ? (
                      <Pressable
                        onPress={() =>
                          setPreguntaMontaje({
                            exerciseId: ejercicio.exerciseId!,
                            nombre: ejercicio.nombre,
                            paso: "lado",
                          })
                        }
                        style={[styles.ajusteChip, montaje && styles.ajusteChipOn]}
                      >
                        <Text style={[styles.ajusteTexto, montaje && styles.ajusteTextoOn]}>por lado</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              </View>
            </View>
          </View>

          {descansando ? (
            <View style={styles.descanso}>
              <Timer size={20} color={colors.champan} strokeWidth={2} />
              <Text style={styles.descansoReloj}>{formatoReloj(restante ?? 0)}</Text>
              <Text style={styles.descansoTexto}>de descanso</Text>
              {fcVigente && fcVigente.objetivo !== null && (
                <Text style={styles.descansoFc}>
                  {fcVigente.bpm <= fcVigente.objetivo
                    ? `Recuperada · ${fcVigente.bpm} lpm`
                    : `Recuperándote · ${fcVigente.bpm} → ${fcVigente.objetivo} lpm`}
                </Text>
              )}

              {/* El RPE, opcional y en una línea: tocar uno ajusta el descanso
                  y le dice a la progresión cuánto sobró. */}
              {estado.descanso && (
                <View style={styles.rpeFila}>
                  <Text style={styles.rpeTexto}>¿Qué tan dura?</Text>
                  {[6, 7, 8, 9, 10].map((valor) => {
                    const marcado =
                      estado.ejercicios[estado.descanso!.ejercicio]?.series[estado.descanso!.serie]?.rpe ===
                      valor;
                    return (
                      <Pressable
                        key={valor}
                        onPress={() => marcarRpe(valor)}
                        hitSlop={4}
                        style={[styles.ajusteChip, marcado && styles.ajusteChipOn]}
                      >
                        <Text style={[styles.ajusteTexto, marcado && styles.ajusteTextoOn]}>{valor}</Text>
                      </Pressable>
                    );
                  })}
                  <InfoTip titulo="Qué tan dura">
                    <TextoInfo>
                      Del 6 al 10: 10 es que no salía otra, 8 es que te sobraban dos. Es opcional; si lo
                      marcas, el descanso se ajusta y la semana que viene el plan sabe si subir el peso.
                    </TextoInfo>
                  </InfoTip>
                </View>
              )}

              {/* El peso de la que sigue, a la mano: salir del descanso ya
                  con los discos puestos. Los mismos ± que el campo de arriba. */}
              {serieActual && (
                <View style={styles.siguienteFila}>
                  <Pressable onPress={() => ajustarPesoSiguiente(-paso)} hitSlop={8} style={styles.campoBoton}>
                    <Minus size={18} color={colors.marfil} strokeWidth={2.5} />
                  </Pressable>
                  <Pressable onPress={() => abrirCaptura("peso", null)} hitSlop={8} style={styles.siguienteCaja}>
                    <Text style={styles.siguienteTexto} numberOfLines={1}>
                      Siguiente ·{" "}
                      {peso === null
                        ? "sin peso"
                        : textoDeCarga ?? `${formatoPeso(aUnidad(peso, unidad))} ${unidad}`}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => ajustarPesoSiguiente(paso)} hitSlop={8} style={styles.campoBoton}>
                    <Plus size={18} color={colors.marfil} strokeWidth={2.5} />
                  </Pressable>
                </View>
              )}

              <View style={styles.descansoBotones}>
                <Pressable
                  onPress={() =>
                    setEstado((actual) => (actual ? ajustarDescanso(actual, 30, Date.now()) : actual))
                  }
                  style={styles.botonSecundario}
                >
                  <Plus size={16} color={colors.marfil} strokeWidth={2} />
                  <Text style={styles.botonSecundarioTexto}>30 s</Text>
                </Pressable>
                <Pressable
                  onPress={() => setEstado((actual) => (actual ? saltarDescanso(actual) : actual))}
                  style={styles.botonSecundario}
                >
                  <SkipForward size={16} color={colors.marfil} strokeWidth={2} />
                  <Text style={styles.botonSecundarioTexto}>Ya estoy</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable onPress={marcarSerie} style={styles.botonPrincipal}>
              <Check size={26} color={colors.pergamino} strokeWidth={2.5} />
              <Text style={styles.botonPrincipalTexto}>Serie hecha</Text>
            </Pressable>
          )}

          {/* La duda de técnica llega a media serie, no en la sala. Abre hoja
              (`router.push`) y al volver el cursor y el descanso siguen donde
              estaban: la sesión guarda dónde vas en cada movimiento. */}
          {sesion.exercises[estado.ejercicioActual]?.videoPath && (
            <Pressable
              onPress={() =>
                router.push(
                  `/tecnica?workoutId=${sesion.workoutId}&indice=${estado.ejercicioActual}`,
                )
              }
              hitSlop={8}
              style={styles.tecnicaBoton}
            >
              <PlayCircle size={18} color={colors.champan} strokeWidth={2} />
              <Text style={styles.tecnicaTexto}>Ver técnica</Text>
            </Pressable>
          )}

          {/* Terminar SOLO este ejercicio (3 de 5 series): las que faltan se
              quedan sin registrar y se pasa al siguiente. */}
          {hechasDelEjercicio > 0 && pendientesDelEjercicio > 0 && (
            <Pressable onPress={terminarEsteEjercicio} hitSlop={8} style={styles.terminarEjercicio}>
              <Text style={styles.cambiarEnlace}>Terminar este ejercicio</Text>
            </Pressable>
          )}

          {alternativas.length > 0 && (
            <View style={styles.cambiarCaja}>
              <Pressable onPress={() => setCambiando((valor) => !valor)} hitSlop={8}>
                <Text style={styles.cambiarEnlace}>
                  {cambiando ? "Dejar este ejercicio" : "¿Máquina ocupada? Cambiar ejercicio"}
                </Text>
              </Pressable>

              {cambiando &&
                alternativas.map((alternativa) => (
                  <Pressable
                    key={alternativa.exerciseId}
                    onPress={() => sustituir(alternativa)}
                    style={styles.alternativa}
                  >
                    <Text style={styles.alternativaNombre}>{alternativa.name}</Text>
                    <Text style={styles.alternativaNota}>mismo grupo muscular</Text>
                  </Pressable>
                ))}
            </View>
          )}

          <View style={styles.lista}>
            {ejercicio?.series.map((serie, index) => (
              <Pressable
                key={index}
                // Una serie ya cerrada se corrige tocándola: cerrar sin peso
                // dejaba el dato en blanco para siempre y la única salida era
                // rehacer la sesión.
                onPress={() =>
                  serie.hechas !== null &&
                  abrirCaptura("peso", { ejercicio: estado.ejercicioActual, serie: index })
                }
                disabled={serie.hechas === null}
                style={[
                  styles.listaFila,
                  index === estado.serieActual && styles.listaFilaActual,
                ]}
              >
                <Text style={styles.listaTexto}>{etiquetaDeSerie(ejercicio!, index)}</Text>
                <View style={styles.listaDerecha}>
                  <Text style={styles.listaValor}>
                    {serie.hechas === null
                      ? objetivoDeSerie(serie)
                      : `${serie.hechas} × ${
                          serie.pesoKg === null
                            ? "sin peso"
                            : `${formatoPeso(aUnidad(serie.pesoKg, unidad))} ${unidad}`
                        }`}
                  </Text>
                  {serie.hechas !== null && serie.pesoKg === null && (
                    <Text style={styles.listaCorregir}>anotar peso</Text>
                  )}
                  {(() => {
                    const pulso = pulsos[`${estado.ejercicioActual}:${index}`];
                    if (!pulso || pulso.promedio === null) return null;
                    return (
                      <View style={styles.listaPulso}>
                        <HeartPulse size={13} color={colors.error} strokeWidth={2} />
                        <Text style={styles.listaPulsoTexto}>{pulso.promedio}</Text>
                      </View>
                    );
                  })()}
                </View>
              </Pressable>
            ))}
          </View>

          {avance.hechas > 0 && (
            <View style={styles.terminarCaja}>
              {confirmandoFin ? (
                <>
                  <Parrafo style={styles.terminarPregunta}>
                    ¿Cerrar con {avance.hechas} de {avance.total} series? Las que faltan se quedan
                    sin registrar — no se inventan ceros.
                  </Parrafo>
                  <View style={styles.terminarBotones}>
                    <Pressable onPress={() => setConfirmandoFin(false)} style={styles.botonSecundario}>
                      <Text style={styles.botonSecundarioTexto}>Seguir</Text>
                    </Pressable>
                    <Pressable onPress={() => void terminarAqui()} style={styles.botonSecundario}>
                      <Check size={16} color={colors.marfil} strokeWidth={2} />
                      <Text style={styles.botonSecundarioTexto}>Sí, terminar</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <Pressable onPress={() => setConfirmandoFin(true)} hitSlop={8}>
                  <Text style={styles.terminarEnlace}>Hasta aquí llegué hoy · terminar mi sesión</Text>
                </Pressable>
              )}
            </View>
          )}

          <Parrafo style={styles.nota}>
            {conReloj
              ? "Esta misma serie está en tu reloj y la puedes cerrar desde ahí. Abre Holy Gains en la muñeca para verla. Las repeticiones todavía las cuentas tú: el reloj está grabando el movimiento de cada serie para poder contarlas solo más adelante."
              : motivoSinReloj(reloj)}
          </Parrafo>
        </ScrollView>
      )}

      {/* Teclado para la cantidad exacta: sirve para teclear el peso de la
          serie que viene y también para anotar el que faltó en una serie ya
          cerrada, tocándola en la lista. */}
      <Hoja
        visible={capturando !== null}
        onClose={() => setCapturando(null)}
        variante="centro"
        contenidoStyle={styles.tecladoCaja}
      >
        <Text style={styles.tecladoTitulo}>
          {capturando?.campo === "reps" ? "Repeticiones" : unidad === "kg" ? "Kilos" : "Libras"}
        </Text>
        {capturando?.serie && (
          <Text style={styles.tecladoNota}>
            Corrigiendo la serie {capturando.serie.serie + 1} de {ejercicio?.nombre}.
          </Text>
        )}

        <TextInput
          value={borrador}
          onChangeText={setBorrador}
          keyboardType="decimal-pad"
          autoFocus
          selectTextOnFocus
          style={styles.tecladoInput}
          onSubmitEditing={aplicarCaptura}
          returnKeyType="done"
        />

        <View style={styles.tecladoBotones}>
          <Pressable onPress={() => setCapturando(null)} style={styles.botonSecundario}>
            <Text style={styles.botonSecundarioTexto}>Cancelar</Text>
          </Pressable>
          <Pressable onPress={aplicarCaptura} style={[styles.botonSecundario, { flex: 1 }]}>
            <Check size={16} color={colors.marfil} strokeWidth={2} />
            <Text style={styles.botonSecundarioTexto}>Guardar</Text>
          </Pressable>
        </View>
      </Hoja>

      {/* "¿Esta máquina se carga por lado?" — una vez por ejercicio, y se
          recuerda (Profile.exercisePrefs). Con carga por lado se teclea UN
          lado y se registra el total: lado × 2 + barra. */}
      <Hoja
        visible={preguntaMontaje !== null}
        onClose={() => setPreguntaMontaje(null)}
        variante="centro"
        contenidoStyle={styles.tecladoCaja}
      >
        {preguntaMontaje?.paso === "lado" ? (
          <>
            <Text style={styles.tecladoTitulo}>¿Esta máquina se carga por lado?</Text>
            <Text style={styles.tecladoNota}>{preguntaMontaje.nombre}</Text>
            <View style={styles.tecladoBotones}>
              <Pressable
                onPress={() => {
                  guardarMontaje(preguntaMontaje.exerciseId, { cargaPorLado: false, barraKg: 0 });
                  setPreguntaMontaje(null);
                }}
                style={[styles.botonSecundario, { flex: 1 }]}
              >
                <Text style={styles.botonSecundarioTexto}>No, peso total</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const previa = datos.montajes[preguntaMontaje.exerciseId];
                  const barra =
                    previa?.cargaPorLado === true
                      ? previa.barraKg
                      : barraPorDefecto(preguntaMontaje.nombre, unidad);
                  setBarraBorrador(formatoPeso(aUnidad(barra, unidad)));
                  setPreguntaMontaje({ ...preguntaMontaje, paso: "barra" });
                }}
                style={[styles.botonSecundario, { flex: 1 }]}
              >
                <Check size={16} color={colors.marfil} strokeWidth={2} />
                <Text style={styles.botonSecundarioTexto}>Sí, por lado</Text>
              </Pressable>
            </View>
          </>
        ) : preguntaMontaje ? (
          <>
            <Text style={styles.tecladoTitulo}>¿Cuánto pesa la barra o el carro?</Text>
            <Text style={styles.tecladoNota}>
              En {unidad}. Barra olímpica: {unidad === "kg" ? "20 kg" : "45 lb"}; carro de prensa,
              0 si no sabes.
            </Text>
            <TextInput
              value={barraBorrador}
              onChangeText={setBarraBorrador}
              keyboardType="decimal-pad"
              autoFocus
              selectTextOnFocus
              style={styles.tecladoInput}
              returnKeyType="done"
            />
            <View style={styles.tecladoBotones}>
              <Pressable
                onPress={() => {
                  guardarMontaje(preguntaMontaje.exerciseId, {
                    cargaPorLado: true,
                    barraKg: barraPorDefecto(preguntaMontaje.nombre, unidad),
                  });
                  setPreguntaMontaje(null);
                }}
                style={styles.botonSecundario}
              >
                <Text style={styles.botonSecundarioTexto}>No sé</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const numero = Number(barraBorrador.replace(",", "."));
                  const barraKg =
                    Number.isFinite(numero) && numero >= 0
                      ? aKilos(numero, unidad)
                      : barraPorDefecto(preguntaMontaje.nombre, unidad);
                  guardarMontaje(preguntaMontaje.exerciseId, { cargaPorLado: true, barraKg });
                  setPreguntaMontaje(null);
                }}
                style={[styles.botonSecundario, { flex: 1 }]}
              >
                <Check size={16} color={colors.marfil} strokeWidth={2} />
                <Text style={styles.botonSecundarioTexto}>Guardar</Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </Hoja>
    </SafeAreaView>
  );
}

/**
 * Por qué no se está usando el reloj, en palabras.
 *
 * Antes se decía siempre lo mismo —"con un Apple Watch con Holy Gains…"— y
 * quien SÍ tenía el reloj puesto no sabía qué le faltaba. Decir cuál de las
 * tres cosas falla es lo que permite arreglarlo sin adivinar.
 */
function motivoSinReloj(reloj: ReturnType<typeof estadoDelReloj>): string {
  if (!reloj.soportado) {
    return "Las repeticiones las cuentas tú. Este dispositivo no habla con Apple Watch.";
  }
  if (!reloj.emparejado) {
    return "Las repeticiones las cuentas tú. Con un Apple Watch emparejado a este teléfono, la serie se cierra desde la muñeca sin sacar el teléfono.";
  }
  if (!reloj.appInstalada) {
    return "Tu reloj está emparejado pero no tiene Holy Gains instalado. Ábrelo desde la app Watch de tu iPhone (Apps disponibles → Holy Gains → Instalar) y vuelve a entrar aquí.";
  }
  return "Las repeticiones las cuentas tú.";
}

function Campo({
  etiqueta,
  valor,
  onMenos,
  onMas,
  onTocarValor,
}: {
  etiqueta: string;
  valor: string;
  onMenos: () => void;
  onMas: () => void;
  /** Tocar el número teclea la cantidad exacta, sin ir de paso en paso. */
  onTocarValor: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.campo}>
      <Text style={styles.campoEtiqueta}>{etiqueta}</Text>
      <View style={styles.campoFila}>
        <Pressable onPress={onMenos} hitSlop={8} style={styles.campoBoton}>
          <Minus size={20} color={colors.marfil} strokeWidth={2.5} />
        </Pressable>
        <Pressable onPress={onTocarValor} hitSlop={8} style={styles.campoValorCaja}>
          <Text style={styles.campoValor}>{valor}</Text>
        </Pressable>
        <Pressable onPress={onMas} hitSlop={8} style={styles.campoBoton}>
          <Plus size={20} color={colors.marfil} strokeWidth={2.5} />
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.obsidiana },
    barra: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    salir: { flexDirection: "row", alignItems: "center", gap: 2 },
    salirTexto: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.paloRosa },
    progresoTexto: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.paloRosa },
    barraDerecha: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    relojChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
      borderRadius: radius.full,
      backgroundColor: withAlpha(colors.champan, 0.14),
    },
    relojChipTexto: { fontFamily: fonts.sansMedium, ...typeScale.label, color: colors.champan },
    barraProgreso: {
      height: 4,
      backgroundColor: withAlpha(colors.paloRosa, 0.15),
      marginHorizontal: spacing.lg,
      borderRadius: radius.full,
      overflow: "hidden",
    },
    barraLlena: { height: 4, backgroundColor: colors.champan },
    contenido: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.huge },
    ejercicioPaso: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.label,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: colors.paloRosa,
    },
    ejercicioNombre: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    serieCaja: {
      borderRadius: radius.xxl,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBg,
      padding: spacing.lg,
      gap: spacing.md,
    },
    tecnicaBoton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.xs,
      borderWidth: 1,
      borderColor: withAlpha(colors.champan, 0.45),
      borderRadius: radius.full,
      paddingVertical: spacing.md,
    },
    tecnicaTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.champan },
    serieCabecera: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    serieTempo: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.label,
      color: colors.champan,
      borderWidth: 1,
      borderColor: withAlpha(colors.champan, 0.45),
      borderRadius: radius.full,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      overflow: "hidden",
    },
    serieEtiqueta: { fontFamily: fonts.sansSemiBold, ...typeScale.heading, color: colors.champan },
    campos: { gap: spacing.md },
    campoPeso: { gap: spacing.sm },
    campo: { flex: 1, gap: spacing.xs },
    campoEtiqueta: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.paloRosa },
    campoFila: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    campoBoton: {
      width: 44,
      height: 44,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: withAlpha(colors.paloRosa, 0.14),
    },
    seriePlan: {
      fontFamily: fonts.sans,
      ...typeScale.label,
      color: colors.pergaminoSoft,
      marginTop: 2,
      marginBottom: spacing.sm,
    },
    ajustes: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    ajusteGrupo: { flexDirection: "row", gap: 6 },
    ajusteChip: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      minHeight: 32,
      justifyContent: "center",
    },
    ajusteChipOn: { backgroundColor: colors.guinda, borderColor: colors.guindaLight },
    ajusteTexto: { fontFamily: fonts.sansMedium, ...typeScale.label, color: colors.marfil },
    ajusteTextoOn: { color: colors.pergamino },
    listaCorregir: { fontFamily: fonts.sans, ...typeScale.label, color: colors.champan },
    terminarCaja: { marginTop: spacing.lg, gap: spacing.sm },
    terminarEnlace: {
      fontFamily: fonts.sansMedium,
      ...typeScale.bodySm,
      color: colors.champan,
      textAlign: "center",
      paddingVertical: spacing.sm,
    },
    terminarPregunta: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.marfil },
    terminarBotones: { flexDirection: "row", gap: spacing.sm },
    campoValorCaja: { minWidth: 96, alignItems: "center", justifyContent: "center", minHeight: 44 },
    // La hoja común (N2) pone la superficie opaca, el borde y el velo.
    tecladoCaja: { gap: spacing.md },
    tecladoTitulo: { fontFamily: fonts.sansMedium, ...typeScale.subheading, color: colors.marfil },
    tecladoNota: { fontFamily: fonts.sans, ...typeScale.label, color: colors.paloRosaLight },
    tecladoInput: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.title,
      color: colors.marfil,
      borderBottomWidth: 1,
      borderBottomColor: colors.champan,
      paddingVertical: spacing.sm,
      textAlign: "center",
    },
    tecladoBotones: { flexDirection: "row", gap: spacing.sm },
    campoValor: {
      fontFamily: fonts.sansBold,
      ...typeScale.display,
      color: colors.marfil,
      minWidth: 70,
      textAlign: "center",
    },
    botonPrincipal: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: colors.guinda,
      borderWidth: 1,
      borderColor: colors.guindaLight,
      borderRadius: radius.xxl,
      paddingVertical: spacing.xl,
    },
    botonPrincipalTexto: {
      fontFamily: fonts.sansBold,
      ...typeScale.heading,
      color: colors.pergamino,
    },
    descanso: {
      alignItems: "center",
      gap: spacing.xs,
      borderRadius: radius.xxl,
      borderWidth: 1,
      borderColor: withAlpha(colors.champan, 0.35),
      backgroundColor: withAlpha(colors.champan, 0.1),
      paddingVertical: spacing.xl,
    },
    descansoReloj: {
      fontFamily: fonts.sansBold,
      ...typeScale.hero,
      color: colors.champan,
    },
    descansoTexto: { fontFamily: fonts.sans, ...typeScale.body, color: colors.paloRosa },
    descansoBotones: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },
    botonSecundario: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      borderRadius: radius.full,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    botonSecundarioTexto: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.marfil },
    cambiarCaja: { gap: spacing.sm },
    cambiarEnlace: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.champan },
    alternativa: {
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: spacing.md,
      gap: 2,
    },
    alternativaNombre: { fontFamily: fonts.sansMedium, ...typeScale.body, color: colors.marfil },
    alternativaNota: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
    lista: { gap: spacing.xs },
    listaFila: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
    },
    listaFilaActual: { backgroundColor: withAlpha(colors.champan, 0.12) },
    listaTexto: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosa },
    listaValor: { fontFamily: fonts.sansSemiBold, ...typeScale.bodySm, color: colors.marfil },
    listaDerecha: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    listaPulso: { flexDirection: "row", alignItems: "center", gap: 3 },
    listaPulsoTexto: {
      fontFamily: fonts.sansSemiBold,
      ...typeScale.bodySm,
      color: colors.paloRosa,
      fontVariant: ["tabular-nums"],
    },
    nota: { fontFamily: fonts.sans, ...typeScale.bodySm, color: colors.paloRosaLight },
    cargaTexto: {
      fontFamily: fonts.sansMedium,
      ...typeScale.bodySm,
      color: colors.champan,
      textAlign: "center",
    },
    descansoFc: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.marfil },
    siguienteFila: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    siguienteCaja: { flexShrink: 1, paddingHorizontal: spacing.sm },
    siguienteTexto: { fontFamily: fonts.sansSemiBold, ...typeScale.body, color: colors.marfil },
    terminarEjercicio: { alignItems: "center", paddingVertical: spacing.xs },
    rpeFila: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.sm },
    rpeTexto: { fontFamily: fonts.sansMedium, ...typeScale.bodySm, color: colors.paloRosa },
    tituloFin: { fontFamily: fonts.sansBold, ...typeScale.title, color: colors.marfil },
    subtituloFin: { fontFamily: fonts.sans, ...typeScale.body, color: colors.paloRosa },
  });
