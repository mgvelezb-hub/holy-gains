/**
 * Fechas de la pantalla del ciclo — lógica PURA.
 *
 * "¿Qué día empezó?" ofrece los últimos días con nombre humano ("Hoy",
 * "Ayer", "sáb 3 oct"): nadie recuerda la fecha, recuerda el día.
 */

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"] as const;
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;

function aFecha(iso: string): Date {
  return new Date(`${iso}T12:00:00.000Z`);
}

function aISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** Hoy y los `n - 1` días anteriores, del más reciente al más viejo. */
export function diasRecientes(hoy: string, n: number): string[] {
  const base = aFecha(hoy);
  return Array.from({ length: n }, (_, i) => {
    const fecha = new Date(base);
    fecha.setUTCDate(base.getUTCDate() - i);
    return aISO(fecha);
  });
}

/** "Hoy", "Ayer" o "sáb 3 oct". */
export function etiquetaDeDia(dia: string, hoy: string): string {
  if (dia === hoy) return "Hoy";
  if (diasRecientes(hoy, 2)[1] === dia) return "Ayer";
  const fecha = aFecha(dia);
  return `${DIAS[fecha.getUTCDay()]} ${fecha.getUTCDate()} ${MESES[fecha.getUTCMonth()]}`;
}
