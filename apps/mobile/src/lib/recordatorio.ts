import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { clasificarPermiso, type AccionAviso, type PermisoAviso } from "@/lib/analisis-checkin";

/**
 * El recordatorio del check-in.
 *
 * Es una notificación **local**: la programa el teléfono y se dispara sola,
 * sin servidor de por medio. Eso importa por dos razones — funciona con una
 * cuenta de desarrollador gratuita (el push desde servidor necesita APNs, que
 * es de pago) y funciona sin señal, porque la hora del cierre de semana se
 * conoce de antemano y no hace falta que nadie avise nada.
 *
 * Solo hay una programada a la vez: cambiar el día o la hora cancela la
 * anterior. Sin eso, cada cambio dejaría una notificación huérfana repitiendo
 * el día viejo para siempre.
 */

export const RECORDATORIO_ID = "checkin-semanal";

export const DIAS = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
] as const;

/** Pide permiso de notificaciones. `false` si no se pudo o lo negaron. */
export async function pedirPermisoNotificaciones(): Promise<boolean> {
  if (Platform.OS === "web") return false;

  const actual = await Notifications.getPermissionsAsync().catch(() => null);
  if (actual?.granted) return true;

  const pedido = await Notifications.requestPermissionsAsync().catch(() => null);
  return Boolean(pedido?.granted);
}

/** Cómo está el permiso, sin pedirlo. */
export async function estadoPermisoNotificaciones(): Promise<PermisoAviso> {
  if (Platform.OS === "web") return "concedido";
  return clasificarPermiso(await Notifications.getPermissionsAsync().catch(() => null));
}

/**
 * Deja programado el recordatorio semanal, o lo quita si falta día u hora.
 *
 * `weekday` de expo va de 1 (domingo) a 7 (sábado), mientras que el perfil lo
 * guarda de 0 a 6 como `Date.getDay()`. La conversión vive aquí y en un solo
 * lugar: es el clásico error de un día de corrimiento.
 */
export async function programarRecordatorio(
  weekday: number | null,
  hour: number | null,
): Promise<boolean> {
  if (Platform.OS === "web") return false;

  await Notifications.cancelScheduledNotificationAsync(RECORDATORIO_ID).catch(() => {});
  if (weekday === null || hour === null) return false;

  if (!(await pedirPermisoNotificaciones())) return false;

  await Notifications.scheduleNotificationAsync({
    identifier: RECORDATORIO_ID,
    content: {
      title: "Toca cerrar tu semana",
      body: "Cintura, peso y cómo te sentiste. Son dos minutos.",
      // La app lee esto al abrirse desde la notificación para llevar directo
      // al formulario.
      data: { ruta: "/checkin" },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: weekday + 1,
      hour,
      minute: 0,
    },
  });

  return true;
}

/** `true` si hay un recordatorio vivo en este teléfono. */
export async function recordatorioActivo(): Promise<boolean> {
  const programadas = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  return programadas.some((n) => n.identifier === RECORDATORIO_ID);
}

// ---------------------------------------------------------------------------
// El análisis del check-in
// ---------------------------------------------------------------------------

export const AVISO_ANALISIS_ID = "analisis-checkin";

/**
 * "Tu análisis ya está listo", para cuando la persona sale de la app antes de
 * que el servidor termine.
 *
 * **Límite conocido:** es un aviso LOCAL programado a ciegas. Sin APNs el
 * servidor no puede despertar al teléfono, y con la app en segundo plano el
 * teléfono no puede preguntar si ya está; así que se programa a `segundos`
 * (3 min, que casi siempre alcanza) en cuanto se envía el check-in, y el
 * sondeo en primer plano lo cancela al encontrar la retro o lo mueve +3 min
 * si está por vencer sin ella (reglas en `pasoAviso`).
 */
export async function programarAvisoAnalisis(segundos: number): Promise<boolean> {
  if (Platform.OS === "web") return false;

  await Notifications.cancelScheduledNotificationAsync(AVISO_ANALISIS_ID).catch(() => {});
  if (!(await pedirPermisoNotificaciones())) return false;

  await Notifications.scheduleNotificationAsync({
    identifier: AVISO_ANALISIS_ID,
    content: {
      title: "Tu retroalimentación está lista",
      body: "Tu análisis del check-in ya está listo · Ábrelo",
      // Sin `sound` iOS lo entrega en silencio: llega al centro de avisos y
      // nadie se entera.
      sound: "default",
      data: { ruta: "/decision" },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: segundos,
    },
  }).catch(() => {});

  return true;
}

export async function cancelarAvisoAnalisis(): Promise<void> {
  if (Platform.OS === "web") return;
  await Notifications.cancelScheduledNotificationAsync(AVISO_ANALISIS_ID).catch(() => {});
}

/** Ejecuta lo que decidió `pasoAviso` / `alEnviar` (`lib/analisis-checkin.ts`). */
export async function aplicarAccionAviso(accion: AccionAviso): Promise<void> {
  if (accion.tipo === "programar") await programarAvisoAnalisis(accion.segundos);
  if (accion.tipo === "cancelar") await cancelarAvisoAnalisis();
}

// ---------------------------------------------------------------------------
// Comidas del día
// ---------------------------------------------------------------------------

/** Prefijo de los recordatorios de comida, para poder cancelarlos en bloque. */
const COMIDA_PREFIJO = "holygains-comida-";

/**
 * El recordatorio en dos tiempos.
 *
 * Antes había un solo aviso a la hora exacta preguntando "¿ya comiste?" — y
 * llegaba tarde para lo único que de verdad ayuda: decidir QUÉ preparar. Por
 * eso ahora son dos, con trabajos distintos:
 *
 *  - **T-30 min, "Prepárate".** Con el resumen del menú de ese slot, para que
 *    dé tiempo de sacar lo que hace falta. Botones: ver el menú completo o
 *    marcarla como hecha ahí mismo (para quien ya la adelantó).
 *  - **Hora exacta: nada.** Un aviso a la hora en que se supone que ya se
 *    está comiendo es ruido, no ayuda.
 *  - **+45 min, seguimiento.** Solo tiene sentido para quien no contestó: si
 *    ya se registró (por el botón de "prepárate" o desde la app), no aporta
 *    nada nuevo. Expo no deja consultar el servidor al momento de disparar
 *    un aviso local, así que la supresión real ocurre en `_layout.tsx`
 *    —cuando llega con la app en primer plano y ya hay registro, se
 *    descarta ahí—; en segundo plano queda como límite conocido del modelo
 *    de notificaciones locales.
 *
 * Los botones se registran en el **teléfono** y el Apple Watch los pinta solo
 * en la notificación reflejada, sin una línea de código de watchOS.
 */
export const CATEGORIA_COMIDA_PREP = "holygains-comida-prep";
export const CATEGORIA_COMIDA_SEGUIMIENTO = "holygains-comida-seguimiento";

/** "Ya la hice" / "Ya comí": misma acción en las dos categorías, registra ahora mismo. */
export const ACCION_COMIDA_LISTA = "comida-lista";
/** Abre el menú completo del día. */
export const ACCION_COMIDA_VER_MENU = "comida-ver-menu";
/** Abre la hoja de esa comida para decir a qué hora comió de verdad. */
export const ACCION_COMIDA_OTRA_HORA = "comida-otra-hora";
/** Abre la hoja de esa comida para elegir el motivo de por qué se saltó. */
export const ACCION_COMIDA_SALTAR = "comida-saltar";

/** Cuánto antes de la hora del plan llega el "Prepárate". */
const PREP_MINUTOS_ANTES = 30;
/** Cuánto después de la hora del plan llega el seguimiento, si no hay registro. */
const SEGUIMIENTO_MINUTOS_DESPUES = 45;

/**
 * Registra los botones de las dos categorías. Es idempotente: volver a
 * llamarla reemplaza las categorías con el mismo contenido.
 */
export async function registrarAccionesDeComida(): Promise<void> {
  if (Platform.OS === "web") return;

  await Notifications.setNotificationCategoryAsync(CATEGORIA_COMIDA_PREP, [
    { identifier: ACCION_COMIDA_VER_MENU, buttonTitle: "Ver menú", options: { opensAppToForeground: true } },
    { identifier: ACCION_COMIDA_LISTA, buttonTitle: "Ya la hice", options: { opensAppToForeground: false } },
  ]).catch(() => {
    // Sin categoría el aviso sigue llegando, solo que sin botones.
  });

  await Notifications.setNotificationCategoryAsync(CATEGORIA_COMIDA_SEGUIMIENTO, [
    { identifier: ACCION_COMIDA_LISTA, buttonTitle: "Ya comí", options: { opensAppToForeground: false } },
    {
      identifier: ACCION_COMIDA_OTRA_HORA,
      buttonTitle: "Comí a otra hora",
      options: { opensAppToForeground: true },
    },
    {
      identifier: ACCION_COMIDA_SALTAR,
      buttonTitle: "La salté",
      // Destructiva para que se pinte distinto y no se toque por error: es
      // la que ensucia el apego.
      options: { opensAppToForeground: true, isDestructive: true },
    },
  ]).catch(() => {});
}

/** `"14:30"` + minutos (puede ser negativo) → hora y minuto dentro de un día. `null` si no es una hora. */
export function sumaMinutosHora(hora: string, minutos: number): { hour: number; minute: number } | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hora.trim());
  if (!match) return null;
  const total = Number(match[1]) * 60 + Number(match[2]) + minutos;
  // Envuelve dentro de las 24 horas: cruzar medianoche no debe tronar, solo
  // cae en el día de calendario contiguo (caso raro, aviso de madrugada).
  const envuelto = ((total % 1440) + 1440) % 1440;
  return { hour: Math.floor(envuelto / 60), minute: envuelto % 60 };
}

/** Código de día de `mealTimesByDay` ("DOM".."SAB") → `weekday` de expo-notifications (1=domingo). */
const DIA_CODIGO_A_WEEKDAY: Record<string, number> = {
  DOM: 1,
  LUN: 2,
  MAR: 3,
  MIE: 4,
  JUE: 5,
  VIE: 6,
  SAB: 7,
};

export function diaCodigoAWeekday(codigo: string): number | undefined {
  return DIA_CODIGO_A_WEEKDAY[codigo];
}

export interface ItemMenuAviso {
  name: string;
  /** Nombre corto para el aviso, si el del menú es largo. */
  display?: string;
}

/**
 * El resumen del menú que va en el cuerpo del "Prepárate": nombres, sin
 * gramos, TODOS. Antes cortaba a 4 y el quinto alimento no aparecía en ningún
 * lado; iOS acomoda el cuerpo largo al expandir el aviso.
 */
export function resumenMenu(items: ItemMenuAviso[]): string {
  return items
    .map((item) => item.display ?? item.name)
    .join(", ");
}

/**
 * El cuerpo del "Prepárate": el menú y, si hay una toma amarrada a esa
 * comida, "+ omega-3". Así el suplemento llega con la comida que lo lleva,
 * sin un aviso propio que se sume al ruido.
 */
export function cuerpoPreparate(items: ItemMenuAviso[], extras: readonly string[] = []): string {
  const menu = resumenMenu(items) || "Ya casi es hora de tu comida.";
  return extras.length === 0 ? menu : `${menu} + ${extras.join(" + ")}`;
}

export interface ComidaAviso {
  slot: string;
  label: string;
  /** Tomas del día amarradas a esta comida ("omega-3", "té de manzanilla"). */
  extras?: string[];
  /** Menú vigente (1 o 2): a dónde abre "Ver menú". */
  menuNumber: number;
  items: ItemMenuAviso[];
  /**
   * Hora efectiva por día de la semana (`"DOM"`..`"SAB"` → `"HH:MM"`), ya
   * resuelta contra `mealTimesByDay` con la general como respaldo. Un día
   * sin entrada aquí no se programa: sin hora no hay a qué avisar.
   */
  horaPorDia: Record<string, string>;
}

/**
 * Programa el "Prepárate" y el seguimiento de cada comida, por cada día de
 * la semana en que tenga hora.
 *
 * Son avisos `WEEKLY` —no `DAILY`— justo porque `horaPorDia` puede traer una
 * hora distinta el sábado: un solo trigger diario no puede representar eso.
 */
export async function programarComidas(comidas: ComidaAviso[]): Promise<boolean> {
  if (Platform.OS === "web") return false;

  // Se cancelan todos antes de reprogramar: el menú y los horarios cambian de
  // semana a semana y un aviso viejo a una hora que ya no existe es peor que
  // ninguno.
  const programados = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(
    programados
      .filter((aviso) => aviso.identifier.startsWith(COMIDA_PREFIJO))
      .map((aviso) => Notifications.cancelScheduledNotificationAsync(aviso.identifier).catch(() => {})),
  );

  if (comidas.length === 0) return false;
  if (!(await pedirPermisoNotificaciones())) return false;

  await registrarAccionesDeComida();

  for (const comida of comidas) {
    for (const [dia, hora] of Object.entries(comida.horaPorDia)) {
      const weekday = diaCodigoAWeekday(dia);
      if (weekday === undefined) continue;

      const prep = sumaMinutosHora(hora, -PREP_MINUTOS_ANTES);
      if (prep) {
        await Notifications.scheduleNotificationAsync({
          identifier: `${COMIDA_PREFIJO}${comida.slot}-${dia}-prep`,
          content: {
            title: `Prepárate: ${comida.label}`,
            body: cuerpoPreparate(comida.items, comida.extras),
            categoryIdentifier: CATEGORIA_COMIDA_PREP,
            data: { ruta: `/menu/${comida.menuNumber}`, comidaSlot: comida.slot, comidaPlaneada: hora },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
            weekday,
            hour: prep.hour,
            minute: prep.minute,
          },
        }).catch(() => {
          // Un aviso que no se pudo programar no puede tumbar los demás.
        });
      }

      const seguimiento = sumaMinutosHora(hora, SEGUIMIENTO_MINUTOS_DESPUES);
      if (seguimiento) {
        await Notifications.scheduleNotificationAsync({
          identifier: `${COMIDA_PREFIJO}${comida.slot}-${dia}-seguimiento`,
          content: {
            title: "¿Cómo te fue con la comida?",
            body: comida.label,
            categoryIdentifier: CATEGORIA_COMIDA_SEGUIMIENTO,
            data: { ruta: `/comida/${comida.slot}`, comidaSlot: comida.slot, comidaPlaneada: hora },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
            weekday,
            hour: seguimiento.hour,
            minute: seguimiento.minute,
          },
        }).catch(() => {});
      }
    }
  }

  return true;
}
