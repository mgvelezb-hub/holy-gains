import {
  CAMINATA_SUAVE_KMH,
  DURACIONES_HIIT,
  NIVEL_MAXIMO_HIIT,
  protocoloDelCatalogo,
  type EsfuerzoHiit,
  type ProtocoloHiit,
} from "@/lib/training/disciplinas/hiit-caminadora";
import {
  controlDe,
  type ContextoControl,
  type ControlMaquina,
} from "@/lib/training/disciplinas/maquinas-cardio";
import type { EquipoCardio } from "@/lib/training/types";

/**
 * Plantillas HIIT por nivel 0–5 para cualquier máquina y duración (P1) — puro.
 *
 * La caminadora tiene los 14 protocolos que Mau probó y los usa siempre que
 * uno quepa (el más largo, con caminata suave en los minutos que sobren); las
 * demás máquinas, y la caminadora cuando ninguno cabe (10' de niveles 0–3),
 * salen de aquí. La forma imita la de sus protocolos: picos de 1 min, 1–2
 * min de recuperación que bajan por Moderado antes de Fácil, calentamiento
 * que sube de Fácil a Moderado y cierre en Fácil.
 *
 * Qué sube con el nivel —cociente trabajo:recuperación y techo— es regla de
 * la app, con la lógica habitual de progresar intervalos: primero
 * recuperaciones del doble del trabajo y luego acortarlas, antes de subir el
 * techo o sostenerlo más tiempo: N0 1:2 hasta Moderado Alto, N1 1:2 con
 * toques de Máximo, N2 1:1.5, N3 1:1 hasta Máximo, N4 1:1 con Fuerte
 * sostenido 2 min, N5 2:1. Los minutos enteros son decisión de la app: la
 * persona cambia la máquina a mano y un cambio cada 30 s no se alcanza a
 * hacer en una elíptica.
 */

/** `caminata` = los minutos que sobran tras un protocolo real de caminadora, a 5–6 km/h. */
export type FaseTramo =
  | "calentamiento"
  | "trabajo"
  | "recuperacion"
  | "continuo"
  | "calibracion"
  | "enfriamiento"
  | "caminata";

/** Un tramo sin máquina: minutos, esfuerzo y para qué está. */
export type TramoPlantilla = {
  desdeMin: number;
  hastaMin: number;
  esfuerzo: EsfuerzoHiit;
  fase: FaseTramo;
};

/** El tramo que pinta la app: el de la plantilla más lo que se pone en la máquina. */
export type TramoCardio = TramoPlantilla & {
  control: ControlMaquina;
  /** Zona de pulso objetivo en lpm, si se conoce la edad (reloj). */
  fcLpm?: [number, number];
  /** Solo protocolos reales de caminadora: tramo que no se veía en la captura. */
  inferido?: boolean;
};

/** El esfuerzo más alto que pisa cada nivel. */
export const TECHO_HIIT: Record<number, EsfuerzoHiit> = {
  0: "Moderado Alto",
  1: "Máximo",
  2: "Máximo",
  3: "Máximo",
  4: "Máximo",
  5: "Máximo",
};

export const COCIENTE_HIIT: Record<number, string> = { 0: "1:2", 1: "1:2", 2: "1:1.5", 3: "1:1", 4: "1:1", 5: "2:1" };

type Paso = [minutos: number, esfuerzo: EsfuerzoHiit, fase: "trabajo" | "recuperacion"];

/** Los ciclos de cada nivel; se alternan A, B, A, B… */
const CICLOS: Record<number, Paso[][]> = {
  // 1:2, techo Moderado Alto.
  0: [[[1, "Moderado Alto", "trabajo"], [1, "Moderado", "recuperacion"], [1, "Fácil", "recuperacion"]]],
  // 1:2, un pico de Máximo cada dos ciclos.
  1: [
    [[1, "Moderado Alto", "trabajo"], [1, "Moderado", "recuperacion"], [1, "Fácil", "recuperacion"]],
    [[1, "Máximo", "trabajo"], [1, "Moderado", "recuperacion"], [1, "Fácil", "recuperacion"]],
  ],
  // 1:1.5 (2 de trabajo, 3 de recuperación).
  2: [
    [[1, "Moderado Alto", "trabajo"], [1, "Fuerte", "trabajo"], [2, "Moderado", "recuperacion"], [1, "Fácil", "recuperacion"]],
    [[1, "Fuerte", "trabajo"], [1, "Máximo", "trabajo"], [2, "Moderado", "recuperacion"], [1, "Fácil", "recuperacion"]],
  ],
  // 1:1 hasta Máximo.
  3: [
    [[1, "Fuerte", "trabajo"], [1, "Moderado", "recuperacion"]],
    [[1, "Máximo", "trabajo"], [1, "Fácil", "recuperacion"]],
  ],
  // 1:1 con Fuerte sostenido.
  4: [
    [[2, "Fuerte", "trabajo"], [1, "Moderado", "recuperacion"], [1, "Fácil", "recuperacion"]],
    [[1, "Fuerte", "trabajo"], [1, "Máximo", "trabajo"], [1, "Moderado", "recuperacion"], [1, "Fácil", "recuperacion"]],
  ],
  // 2:1, cortos al Máximo.
  5: [
    [[1, "Fuerte", "trabajo"], [1, "Máximo", "trabajo"], [1, "Moderado", "recuperacion"]],
    [[1, "Máximo", "trabajo"], [1, "Fuerte", "trabajo"], [1, "Fácil", "recuperacion"]],
  ],
};

/** Una sesión de cardio más corta que esto ya no tiene calentamiento, intervalos y enfriamiento. */
export const DURACION_MINIMA_CARDIO = 8;

export function nivelHiitValido(nivel: number): number {
  return Math.max(0, Math.min(NIVEL_MAXIMO_HIIT, Math.round(nivel)));
}

export function duracionValida(duracion: number): number {
  return Math.max(DURACION_MINIMA_CARDIO, Math.round(duracion));
}

/**
 * Pega tramos de `[minutos, esfuerzo, fase]` en orden y funde los vecinos
 * con el mismo esfuerzo. Al fundir una recuperación Fácil con el
 * enfriamiento, el tramo queda como enfriamiento.
 */
export function encadenar(pasos: ReadonlyArray<readonly [number, EsfuerzoHiit, FaseTramo]>): TramoPlantilla[] {
  const tramos: TramoPlantilla[] = [];
  let reloj = 0;
  for (const [minutos, esfuerzo, fase] of pasos) {
    if (minutos <= 0) continue;
    const anterior = tramos.at(-1);
    if (anterior && anterior.esfuerzo === esfuerzo && (anterior.fase === fase || fase === "enfriamiento")) {
      anterior.hastaMin += minutos;
      anterior.fase = fase;
    } else {
      tramos.push({ desdeMin: reloj, hastaMin: reloj + minutos, esfuerzo, fase });
    }
    reloj += minutos;
  }
  return tramos;
}

/** Calentamiento progresivo: 3 min desde 20', 2 en menos. */
export function calentamientoDe(duracion: number): Array<[number, EsfuerzoHiit, FaseTramo]> {
  return duracion >= 20
    ? [[2, "Fácil", "calentamiento"], [1, "Moderado", "calentamiento"]]
    : [[1, "Fácil", "calentamiento"], [1, "Moderado", "calentamiento"]];
}

export const ENFRIAMIENTO_MIN = 2;

/** La plantilla HIIT de `duracion` minutos (redondeada, ≥ 8) al `nivel` 0–5. */
export function plantillaHiit(duracion: number, nivel: number): TramoPlantilla[] {
  const total = duracionValida(duracion);
  const ciclos = CICLOS[nivelHiitValido(nivel)]!;
  const calentamiento = calentamientoDe(total);
  let restante = total - calentamiento.reduce((suma, [m]) => suma + m, 0) - ENFRIAMIENTO_MIN;

  const intervalos: Array<[number, EsfuerzoHiit, FaseTramo]> = [];
  for (let vuelta = 0; restante > 0; vuelta += 1) {
    for (const [minutos, esfuerzo, fase] of ciclos[vuelta % ciclos.length]!) {
      if (restante <= 0) break;
      const cabe = Math.min(minutos, restante);
      intervalos.push([cabe, esfuerzo, fase]);
      restante -= cabe;
    }
  }
  return encadenar([...calentamiento, ...intervalos, [ENFRIAMIENTO_MIN, "Fácil", "enfriamiento"]]);
}

/** Le pone a cada tramo lo que marca la máquina. */
export function tramosConControles(
  tramos: readonly TramoPlantilla[],
  maquina: EquipoCardio,
  contexto: ContextoControl,
): TramoCardio[] {
  return tramos.map((tramo) => ({ ...tramo, control: controlDe(maquina, tramo.esfuerzo, contexto) }));
}

/**
 * El protocolo real de Mau más largo que cabe en `duracion` minutos al
 * `nivel` (25, 15 o 10 —el 10' solo existe en niveles 4–5—), o `null` si
 * ninguno cabe.
 */
export function protocoloRealQueCabe(duracion: number, nivel: number): ProtocoloHiit | null {
  const n = nivelHiitValido(nivel);
  const total = duracionValida(duracion);
  for (const minutos of [...DURACIONES_HIIT].sort((a, b) => b - a)) {
    if (minutos > total) continue;
    const real = protocoloDelCatalogo(minutos, n);
    if (real) return real;
  }
  return null;
}

/**
 * El HIIT de una máquina. La caminadora conserva los protocolos reales de
 * Mau —le gustan y los probó—: corre el más largo que quepa y completa con
 * caminata suave a 5–6 km/h los minutos que sobren (20' = 15' real + 5'
 * caminata; 30' = 25' + 5'). Solo si ninguno cabe (10' de niveles 0–3) va la
 * plantilla con los km/h de su nivel. Todo lo demás, la plantilla.
 */
export function hiitParaMaquina(
  maquina: EquipoCardio,
  duracion: number,
  nivel: number,
  contexto: ContextoControl,
): { fuente: "catalogo" | "plantilla"; tramos: TramoCardio[]; protocoloMin?: number; caminataMin?: number } {
  const n = nivelHiitValido(nivel);
  const total = duracionValida(duracion);
  const real = maquina === "CAMINADORA" ? protocoloRealQueCabe(total, n) : null;
  if (real) {
    const ultimo = real.tramos.length - 1;
    const caminataMin = total - real.duracion;
    const tramos: TramoCardio[] = real.tramos.map((tramo, i) => ({
      desdeMin: tramo.desdeMin,
      hastaMin: tramo.hastaMin,
      esfuerzo: tramo.esfuerzo,
      fase:
        i === 0
          ? "calentamiento"
          : i === ultimo
            ? "enfriamiento"
            : tramo.esfuerzo === "Fácil" || tramo.esfuerzo === "Moderado"
              ? "recuperacion"
              : "trabajo",
      control: { maquina, kmh: [...tramo.kmh], texto: `${tramo.kmh[0]}–${tramo.kmh[1]} km/h` },
      ...(tramo.inferido ? { inferido: true } : {}),
    }));
    if (caminataMin > 0) {
      tramos.push({
        desdeMin: real.duracion,
        hastaMin: total,
        esfuerzo: "Fácil",
        fase: "caminata",
        control: {
          maquina,
          kmh: [...CAMINATA_SUAVE_KMH],
          texto: `${CAMINATA_SUAVE_KMH[0]}–${CAMINATA_SUAVE_KMH[1]} km/h · caminata suave`,
        },
      });
    }
    return { fuente: "catalogo", tramos, protocoloMin: real.duracion, caminataMin };
  }
  return {
    fuente: "plantilla",
    tramos: tramosConControles(plantillaHiit(total, n), maquina, { ...contexto, nivelHiit: n }),
  };
}
