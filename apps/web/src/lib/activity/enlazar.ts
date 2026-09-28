/**
 * Enlazar la sesión registrada en la app con la que trae el reloj (H2).
 *
 * El cardio de después de pesas se registra al terminarlo en la sesión en
 * vivo (fuente `APP`, con tipo y nivel en las notas). Si el Apple Watch lo
 * grabó, HealthKit manda la misma sesión con sus datos (pulso, kcal). Son una
 * sola sesión: contarla dos veces infla la racha y el gasto. La regla es
 * física, no de fuente: misma disciplina, mismo día y los intervalos se
 * traslapan (con holgura de `HOLGURA_MIN`, lo que tarda alguien en picar
 * "empezar" en el reloj y en el teléfono).
 *
 * Puro a propósito: `saveActivities` le pasa las sesiones del día y decide
 * qué escribir; aquí solo se contesta "¿cuál es su gemela?".
 */

const HOLGURA_MIN = 10;

export type SesionComparable = {
  discipline: string;
  source: string;
  externalId: string | null;
  date: string;
  startedAt: string;
  endedAt: string | null;
  durationMin: number;
};

function intervalo(sesion: SesionComparable): [number, number] {
  const inicio = Date.parse(sesion.startedAt);
  const fin = sesion.endedAt ? Date.parse(sesion.endedAt) : inicio + sesion.durationMin * 60_000;
  return [inicio, fin];
}

export function buscaGemela<T extends SesionComparable>(nueva: SesionComparable, existentes: T[]): T | null {
  const [inicio, fin] = intervalo(nueva);
  const holgura = HOLGURA_MIN * 60_000;

  for (const otra of existentes) {
    if (otra.source === nueva.source) continue;
    if (otra.discipline !== nueva.discipline || otra.date !== nueva.date) continue;
    // La del app que ya quedó enlazada lleva el `externalId` del reloj: no se
    // vuelve a emparejar con otra.
    const delApp = otra.source === "APP" ? otra : nueva;
    if (delApp.externalId) continue;

    const [otroInicio, otroFin] = intervalo(otra);
    if (inicio <= otroFin + holgura && otroInicio <= fin + holgura) return otra;
  }
  return null;
}
