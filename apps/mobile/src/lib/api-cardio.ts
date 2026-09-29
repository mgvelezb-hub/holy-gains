import {
  apiFetch,
  type DetalleCardio,
  type EsfuerzoHiit,
  type NivelCardio,
  type SesionDisciplina,
  type UnidadVelocidad,
} from "@/lib/api";

/**
 * P1 — el cardio de toda máquina y toda modalidad, como lo manda la web.
 *
 * Contrato EXACTO de `ProgramaCardio` (`apps/web/src/lib/training/disciplinas/
 * modalidades-cardio.ts`), `TramoCardio` (`plantillas-hiit.ts`),
 * `ControlMaquina` y `NivelesBaseCardio` (`maquinas-cardio.ts`, `types.ts`) y
 * de `GET /api/v1/training/cardio`. Va aparte de `api.ts` porque los tipos de
 * H2 de ahí (`EquipoCardio`, `TipoCardio`) solo conocen cuatro máquinas y dos
 * tipos; aquí se amplían sin reescribir lo que ya los usa.
 */

export type MaquinaCardio = "CAMINADORA" | "ELIPTICA" | "REMO" | "BICI" | "BICI_AIRE" | "ESCALERA" | "SKI_ERG";
export type EquipoCardioP1 = MaquinaCardio | "LIBRE";

export type ModalidadCardio = "HIIT" | "ZONA2" | "TEMPO" | "NORUEGO" | "PIRAMIDAL" | "RECUPERACION";
/** Lo que se guarda en la preferencia: `CONTINUO` (nombre viejo de zona 2) y `VARIADO` (rota por objetivo). */
export type TipoCardioP1 = ModalidadCardio | "CONTINUO" | "VARIADO";

/** Las máquinas que se anclan a un nivel base personal (la caminadora va por km/h). */
export type MaquinaConBase = "ELIPTICA" | "BICI" | "ESCALERA" | "REMO" | "SKI_ERG" | "BICI_AIRE";
export type NivelBase = number | { ritmo500: string } | { watts: number };
export type NivelesBaseCardio = {
  ELIPTICA?: number;
  BICI?: number;
  ESCALERA?: number;
  REMO?: { ritmo500: string };
  SKI_ERG?: { ritmo500: string };
  BICI_AIRE?: { watts: number };
};

/** Lo que se pone en la máquina en un tramo, ya calculado por la web. */
export type ControlMaquina = {
  maquina: EquipoCardioP1;
  resistencia?: number;
  cadencia?: [number, number];
  unidadCadencia?: "SPM" | "RPM";
  ritmo500Seg?: number;
  ritmoOMasLento?: boolean;
  watts?: [number, number];
  kmh?: [number, number];
  postura?: "sentado" | "de pie";
  /** "Resist. 10 · 140 SPM", "2:15/500 · 26 SPM", "10–12 km/h". */
  texto: string;
};

export type FaseTramo = "calentamiento" | "trabajo" | "recuperacion" | "continuo" | "calibracion" | "enfriamiento" | "caminata";

export type TramoCardio = {
  desdeMin: number;
  hastaMin: number;
  esfuerzo: EsfuerzoHiit;
  fase: FaseTramo;
  control: ControlMaquina;
  /** Zona de pulso objetivo, si la web conoce la edad. */
  fcLpm?: [number, number];
  /** Protocolo real de caminadora: tramo que no se veía en la captura. */
  inferido?: boolean;
};

export type CalibracionCardio = {
  maquina: MaquinaConBase;
  instruccion: string;
  pasos: Array<{
    desdeMin: number;
    hastaMin: number;
    control: ControlMaquina;
    valor: NivelBase;
    /**
     * Q1: los tramos que siguen a la calibración recalculados con este valor
     * (mismos minutos). Opcional: un programa viejo en caché no lo trae.
     */
    tramosSiMarcas?: TramoCardio[];
  }>;
};

export type ProgramaCardio = {
  maquina: EquipoCardioP1;
  /**
   * La elegida, también cuando arranca calibrando (Q1: `calibracion` va al
   * inicio). `CALIBRACION` solo llega de un programa viejo guardado.
   */
  modalidad: ModalidadCardio | "CALIBRACION";
  nivel: number | null;
  duracion: number;
  /** "HIIT 20' · Nivel 2 · Elíptica", "Zona 2 · 30' · Remo". */
  titulo: string;
  fuente: "catalogo" | "plantilla";
  porque: string;
  paraQuien: string;
  tramos: TramoCardio[];
  notaMaquina: string | null;
  base: NivelBase | null;
  baseEstimada: boolean;
  calibracion: CalibracionCardio | null;
  ajuste: string | null;
  fcMaxima: number | null;
  /** Caminadora con protocolo real: minutos del protocolo y de caminata suave (20' = 15 + 5). */
  protocoloMin?: number;
  caminataMin?: number;
};

/** `DetalleCardio` de H2/N1 más lo que suma P1 (la máquina ya puede ser cualquiera). */
export type DetalleCardioP1 = Omit<DetalleCardio, "equipo"> & {
  equipo: EquipoCardioP1;
  modalidad?: ProgramaCardio["modalidad"];
  programa?: ProgramaCardio;
  unidad?: UnidadVelocidad;
};

/** Las preferencias de CARDIO en `otherDisciplines`, con lo de N1 y P1. */
export type PreferenciasCardioP1 = {
  equipo?: EquipoCardioP1;
  tipo?: TipoCardioP1;
  nivel?: NivelCardio;
  minutos?: number;
  unidadVelocidad?: UnidadVelocidad;
  nivelBase?: NivelesBaseCardio;
};

/** El programa minuto a minuto del detalle, si la web ya lo manda (P1). */
export function programaDe(detalle: DetalleCardio | DetalleCardioP1 | null | undefined): ProgramaCardio | null {
  return (detalle as DetalleCardioP1 | null | undefined)?.programa ?? null;
}

/** Respuesta de `GET /api/v1/training/cardio`. */
export type CardioDelDia = { fecha: string; minutes: number; ordinal: number; sesion: SesionDisciplina };

/**
 * El cardio de `fecha` con otra máquina y/o modalidad solo por ese día: mismos
 * minutos, la preferencia guardada intacta.
 */
export function getCardioDelDia(
  fecha: string,
  cambios: { maquina?: EquipoCardioP1; modalidad?: TipoCardioP1 },
): Promise<CardioDelDia> {
  const params = new URLSearchParams({ date: fecha });
  if (cambios.maquina) params.set("maquina", cambios.maquina);
  if (cambios.modalidad) params.set("modalidad", cambios.modalidad);
  return apiFetch<CardioDelDia>(`/api/v1/training/cardio?${params.toString()}`);
}
