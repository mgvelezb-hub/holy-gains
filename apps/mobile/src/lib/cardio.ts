import type { ActivityPayload, DetalleCardio, EquipoCardio, WarmupStep } from "@/lib/api";

/**
 * El cardio de después de pesas en la sesión en vivo (H2) — lógica pura.
 *
 * Al cerrar la última serie aparece su tarjeta; al empezarlo, el timer es el
 * MISMO del calentamiento dinámico (pasos con su hora de término), así que
 * aquí solo se traduce la prescripción a esos pasos. Al terminar se registra
 * como sesión de disciplina del día; si el reloj también la grabó, el
 * servidor las enlaza (`buscaGemela` en la web).
 */

const EQUIPO: Record<EquipoCardio, string> = {
  CAMINADORA: "caminadora",
  ESCALERA: "escalera",
  BICI: "bici",
  ELIPTICA: "elíptica",
  LIBRE: "libre",
};

function nivel(detalle: DetalleCardio, valor: number): string {
  return detalle.equipo === "LIBRE" ? "" : ` · nivel ${valor}`;
}

/** "Cardio · 20 min · caminadora HIIT nivel 8". */
export function tituloTarjetaCardio(detalle: DetalleCardio, minutos: number): string {
  const tipo = detalle.tipo === "HIIT" ? "HIIT" : "continuo";
  const como =
    detalle.equipo === "LIBRE" ? tipo : `${EQUIPO[detalle.equipo]} ${tipo} nivel ${detalle.nivelMaquina}`;
  return `Cardio · ${minutos} min · ${como}`;
}

/** Los pasos que corre el timer: calentamiento, el bloque principal, enfriamiento. */
export function pasosDeCardio(detalle: DetalleCardio, minutos: number): WarmupStep[] {
  const suave = detalle.intervalos?.nivelSuave ?? Math.max(1, detalle.nivelMaquina - 2);
  const pasos: WarmupStep[] = [
    { nombre: `Calentamiento${nivel(detalle, suave)}`, segundos: detalle.calentamientoSeg },
  ];

  if (detalle.intervalos) {
    const { rondas, fuerteSeg, suaveSeg, nivelFuerte, nivelSuave } = detalle.intervalos;
    for (let ronda = 1; ronda <= rondas; ronda += 1) {
      pasos.push({ nombre: `Fuerte${nivel(detalle, nivelFuerte)} · ronda ${ronda} de ${rondas}`, segundos: fuerteSeg });
      pasos.push({ nombre: `Suave${nivel(detalle, nivelSuave)} · ronda ${ronda} de ${rondas}`, segundos: suaveSeg });
    }
  } else {
    const principal = Math.max(60, minutos * 60 - detalle.calentamientoSeg - detalle.enfriamientoSeg);
    pasos.push({ nombre: `Zona 2${nivel(detalle, detalle.nivelMaquina)}`, segundos: principal });
  }

  pasos.push({ nombre: "Enfriamiento", segundos: detalle.enfriamientoSeg });
  return pasos;
}

/** Lo que queda en las notas de la sesión: tipo, máquina y nivel. */
export function notasDeCardio(detalle: DetalleCardio): string {
  const tipo = detalle.tipo === "HIIT" ? "HIIT" : "Continuo";
  return detalle.equipo === "LIBRE"
    ? tipo
    : `${tipo} · ${EQUIPO[detalle.equipo]} · nivel ${detalle.nivelMaquina}`;
}

/** La sesión de CARDIO del día, con la hora real de inicio y fin. */
export function actividadDeCardio(
  detalle: DetalleCardio,
  fecha: string,
  inicio: Date,
  fin: Date,
): ActivityPayload {
  return {
    discipline: "CARDIO",
    source: "APP",
    externalId: null,
    startedAt: inicio.toISOString(),
    endedAt: fin.toISOString(),
    date: fecha,
    durationMin: Math.max(1, Math.round((fin.getTime() - inicio.getTime()) / 60_000)),
    notes: notasDeCardio(detalle),
  };
}
