import { prescribirCardio } from "@/lib/training/disciplinas/cardio";
import type { SesionDisciplina } from "@/lib/training/disciplinas/tipos";
import type { OtherSession } from "@/lib/training/disciplines";
import type { EquipoCardio, TipoCardio, TrainingProfile } from "@/lib/training/types";

/**
 * "Hoy la caminadora está ocupada → elíptica" (P1b) — puro.
 *
 * La hoja de cardio del teléfono deja cambiar la máquina y la modalidad de UN
 * día sin tocar la preferencia guardada. Aquí se vuelve a prescribir esa
 * sesión con los MISMOS minutos, la misma semana, el mismo ordinal (de él
 * depende la rotación del variado y la calibración) y el mismo historial y
 * edad; solo cambian la máquina y/o la modalidad.
 */

export type CambiosCardioDelDia = { equipo?: EquipoCardio; tipo?: TipoCardio };

export type CardioDelDia = { fecha: string; minutes: number; ordinal: number; sesion: SesionDisciplina };

/** Qué número de cardio con plan es el de `fecha` en la semana (1.º, 2.º…), o `null` si ese día no hay. */
export function ordinalDeCardio(sesiones: readonly OtherSession[], fecha: string): number | null {
  const cardios = sesiones
    .filter((sesion) => sesion.discipline === "CARDIO" && sesion.sesion?.cardio)
    .sort((a, b) => a.date.localeCompare(b.date) || a.orden - b.orden);
  const indice = cardios.findIndex((sesion) => sesion.date === fecha);
  return indice === -1 ? null : indice + 1;
}

export function cardioDelDia(input: {
  sesiones: readonly OtherSession[];
  fecha: string;
  training: TrainingProfile;
  isoWeek: number;
  cambios: CambiosCardioDelDia;
}): CardioDelDia | null {
  const { sesiones, fecha, training, isoWeek, cambios } = input;
  const ordinal = ordinalDeCardio(sesiones, fecha);
  const original = sesiones.find((sesion) => sesion.date === fecha && sesion.discipline === "CARDIO" && sesion.sesion?.cardio);
  if (ordinal === null || !original) return null;

  const carga = training.otherDisciplines.find((load) => load.discipline === "CARDIO");
  const prefs = {
    ...carga?.cardio,
    ...(cambios.equipo ? { equipo: cambios.equipo } : {}),
    ...(cambios.tipo ? { tipo: cambios.tipo } : {}),
  };
  const nivelDisciplina = training.disciplineLevels.CARDIO;
  const sesion = prescribirCardio({
    minutes: original.minutes,
    isoWeek,
    objetivo: training.goal as never,
    prefs,
    ordinal,
    ...(nivelDisciplina ? { nivelDisciplina } : {}),
    ...(training.historialCardio ? { historial: training.historialCardio } : {}),
    ...(training.edad !== undefined ? { edad: training.edad } : {}),
  });
  return { fecha, minutes: original.minutes, ordinal, sesion };
}
