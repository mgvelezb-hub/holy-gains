/**
 * La máquina de estados de una sesión de gimnasio en vivo — lógica PURA.
 *
 * Vive aparte de la pantalla porque es donde están las reglas que importan y
 * porque así se puede probar sin montar nada: qué serie sigue, cuándo empieza
 * el descanso, cuándo se acabó el ejercicio, cuándo se acabó la sesión.
 *
 * Dos decisiones que no conviene re-litigar:
 *
 * - **El descanso arranca solo al cerrar una serie, no al abrir la app.** El
 *   cronómetro que hay que acordarse de iniciar es el que nadie inicia; y el
 *   momento exacto en que termina una serie es el único que la app sí conoce
 *   sin sensores.
 * - **La última serie de un ejercicio no descansa.** Descansar 90 segundos
 *   para irse a otra máquina es tiempo muerto disfrazado de método.
 */

export type SerieViva = {
  /** Reps que pide el plan. */
  objetivo: number;
  /** Reps que de verdad salieron. `null` = todavía no se cierra. */
  hechas: number | null;
  /** Kilos con los que se hizo. */
  pesoKg: number | null;
  /** De calentamiento: no cuenta para progresión ni para el volumen. */
  calentamiento: boolean;
  /**
   * Tempo prescrito, en segundos: bajar, pausa, subir. Se lee "3-1-1". El
   * tipo va estructural, no importado: este módulo es puro y no conoce el
   * cliente de la API.
   */
  tempo?: { ecc: number; pause: number; con: number };
  /** `fallo` = hasta que no salga otra; `dropset` = pegada a la anterior, sin descanso. */
  intensidad?: "normal" | "fallo" | "dropset";
  /** Con qué lado va, en los ejercicios de un lado a la vez. */
  lado?: "IZQ" | "DER" | "AMBOS";
  /**
   * El peso que traía el plan, antes de que la persona lo cambiara. Es lo que
   * permite leer la tendencia: si en la primera cargó 5 kg más de lo sugerido,
   * la siguiente se sugiere también 5 kg arriba.
   */
  pesoPlanKg?: number | null;
  /** RPE de la serie (1–10), si se capturó. */
  rpe?: number | null;
  /**
   * La persona dio el ejercicio por terminado antes de esta serie: se queda
   * SIN registrar (no en cero) y ya no cuenta como pendiente.
   */
  omitida?: boolean;
};

export type EjercicioVivo = {
  indice: number;
  nombre: string;
  /** Id del catálogo, cuando lo hay: con él se sabe si dos ejercicios son el mismo. */
  exerciseId?: string | null;
  /** Rol del ejercicio en el catálogo ("cuadriceps_compuesto"): de ahí sale el descanso. */
  poolRole?: string;
  /** Esquema de series ("FUERZA", "PIRAMIDAL"...): fuerza descansa más que metabólico. */
  esquema?: string;
  /**
   * A qué se puede cambiar si la máquina está ocupada. Viaja con la sesión
   * —y por lo tanto al teléfono— para que el cambio funcione sin señal.
   *
   * El tipo se declara estructural y no importado: este módulo es puro y no
   * conoce el cliente de la API.
   */
  alternativas?: Array<{
    exerciseId: string;
    name: string;
    declared: boolean;
    videoPath: string | null;
  }>;
  /** Segundos de descanso que pide el esquema entre series. */
  descansoSeg: number;
  /** Se hace un lado a la vez: sus series traen `lado`. */
  unilateral?: boolean;
  series: SerieViva[];
};

export type EstadoSesion = {
  ejercicios: EjercicioVivo[];
  /** En qué ejercicio va. */
  ejercicioActual: number;
  /** En qué serie de ese ejercicio va. */
  serieActual: number;
  /**
   * Cuándo termina el descanso, en milisegundos epoch. `null` = no descansa.
   *
   * Es una HORA y no un contador de segundos a propósito. Antes se restaba un
   * segundo por tick, y iOS congela los timers cuando la app se va al fondo:
   * quien contestaba un mensaje a media serie volvía con el descanso parado
   * en el segundo en que salió, marcando un minuto que ya había pasado. Una
   * hora de término se lee igual de bien después de cinco minutos en el
   * fondo, con la pantalla apagada o tras un reinicio de la pantalla.
   */
  descansoHasta: number | null;
  /**
   * De qué serie es el descanso en curso y cuándo empezó. Es lo que deja que
   * la frecuencia cardiaca del reloj mueva el término: hace falta saber cuánto
   * lleva descansando y cuánto costó la serie. `manual` = la persona ya lo
   * movió con "+30 s" y la FC deja de tocarlo.
   */
  descanso?: { desde: number; ejercicio: number; serie: number; manual: boolean } | null;
  /** La sesión ya no tiene series pendientes. */
  terminada: boolean;
};

export function estadoInicial(ejercicios: EjercicioVivo[]): EstadoSesion {
  const primera = primeraPendiente(ejercicios);
  return {
    ejercicios,
    ejercicioActual: primera?.ejercicio ?? 0,
    serieActual: primera?.serie ?? 0,
    descansoHasta: null,
    terminada: primera === null,
  };
}

/** La primera serie sin cerrar, recorriendo en el orden en que se entrena. */
export function primeraPendiente(
  ejercicios: EjercicioVivo[],
): { ejercicio: number; serie: number } | null {
  for (let e = 0; e < ejercicios.length; e += 1) {
    const series = ejercicios[e]!.series;
    for (let s = 0; s < series.length; s += 1) {
      const serie = series[s]!;
      if (serie.hechas === null && serie.omitida !== true) return { ejercicio: e, serie: s };
    }
  }
  return null;
}

/**
 * Cierra la serie en curso.
 *
 * Devuelve el estado nuevo y **qué sigue**, que es lo que la pantalla necesita
 * para decidir si vibra distinto, si arranca la cuenta o si ya se acabó.
 */
export function cerrarSerie(
  estado: EstadoSesion,
  valores: { reps: number; pesoKg: number | null },
  ahora: number = Date.now(),
): { estado: EstadoSesion; siguiente: "descanso" | "otro_ejercicio" | "fin" } {
  const ejercicios = estado.ejercicios.map((ejercicio, e) => {
    if (e !== estado.ejercicioActual) return ejercicio;
    return {
      ...ejercicio,
      series: ejercicio.series.map((serie, s) =>
        s === estado.serieActual
          ? { ...serie, hechas: valores.reps, pesoKg: valores.pesoKg }
          : serie,
      ),
    };
  });

  const pendiente = primeraPendiente(ejercicios);
  if (pendiente === null) {
    return {
      estado: { ...estado, ejercicios, descansoHasta: null, descanso: null, terminada: true },
      siguiente: "fin",
    };
  }

  const cambiaEjercicio = pendiente.ejercicio !== estado.ejercicioActual;

  // Un dropset va PEGADO a la serie anterior: si lo que sigue es uno, no hay
  // descanso que arrancar. Esa es toda su definición — bajar el peso y seguir
  // sin soltar. Descansar noventa segundos antes lo convierte en otra serie
  // normal más ligera.
  const siguienteEsDropset =
    !cambiaEjercicio &&
    ejercicios[pendiente.ejercicio]?.series[pendiente.serie]?.intensidad === "dropset";
  const actual = ejercicios[estado.ejercicioActual];
  const cerrada = actual?.series[estado.serieActual];
  const descanso =
    siguienteEsDropset || !actual || !cerrada ? 0 : descansoPara(cerrada, actual).segundos;

  return {
    estado: {
      ...estado,
      ejercicios,
      ejercicioActual: pendiente.ejercicio,
      serieActual: pendiente.serie,
      // La última serie de un ejercicio TAMBIÉN descansa.
      //
      // Antes no: se asumía que el traslado a la otra máquina ya era el
      // descanso. En el gimnasio no se cumple —la otra máquina suele estar a
      // diez pasos— y quien acababa una serie pesada arrancaba la siguiente
      // sin nada de por medio, o se quedaba mirando el teléfono sin saber
      // cuánto llevaba parado. Si el traslado ya fue suficiente está el botón
      // "Ya estoy", que cuesta un toque; adivinar por la persona costaba una
      // serie mal descansada.
      descansoHasta: descanso > 0 ? ahora + descanso * 1000 : null,
      descanso:
        descanso > 0
          ? { desde: ahora, ejercicio: estado.ejercicioActual, serie: estado.serieActual, manual: false }
          : null,
      terminada: false,
    },
    siguiente: cambiaEjercicio ? "otro_ejercicio" : "descanso",
  };
}

/**
 * Corrige una serie YA cerrada: los kilos que no se anotaron, o las reps que
 * salieron mal.
 *
 * Existe porque cerrar una serie sin peso no tenía vuelta atrás: la serie
 * quedaba capturada en cero y la única salida era rehacer la sesión. Aquí no
 * se mueve el cursor —quien corrige la serie 2 sigue en la 4— ni se toca el
 * descanso en curso.
 */
export function editarSerie(
  estado: EstadoSesion,
  ejercicioIndice: number,
  serieIndice: number,
  valores: { reps: number; pesoKg: number | null },
): EstadoSesion {
  return {
    ...estado,
    ejercicios: estado.ejercicios.map((ejercicio, e) =>
      e !== ejercicioIndice
        ? ejercicio
        : {
            ...ejercicio,
            series: ejercicio.series.map((serie, s) =>
              s !== serieIndice ? serie : { ...serie, hechas: valores.reps, pesoKg: valores.pesoKg },
            ),
          },
    ),
  };
}

/**
 * Segundos que faltan de descanso ahora mismo. `null` si no está descansando.
 *
 * Se calcula contra el reloj, no contra un contador: es lo que hace que el
 * descanso siga corriendo con la app en el fondo o la pantalla apagada.
 */
export function restanteSeg(estado: EstadoSesion, ahora: number = Date.now()): number | null {
  if (estado.descansoHasta === null) return null;
  const restante = Math.ceil((estado.descansoHasta - ahora) / 1000);
  return restante > 0 ? restante : 0;
}

/** El descanso ya se agotó (llegó a cero) pero sigue marcado como en curso. */
export function descansoTermino(estado: EstadoSesion, ahora: number = Date.now()): boolean {
  return estado.descansoHasta !== null && ahora >= estado.descansoHasta;
}

/** Apaga el descanso agotado. Se llama al detectar que llegó a cero. */
export function cerrarDescanso(estado: EstadoSesion): EstadoSesion {
  return { ...estado, descansoHasta: null, descanso: null };
}

/** Suma (o resta) segundos al descanso en curso, moviendo su hora de término. */
export function ajustarDescanso(
  estado: EstadoSesion,
  segundos: number,
  ahora: number = Date.now(),
): EstadoSesion {
  if (estado.descansoHasta === null) return estado;
  const hasta = estado.descansoHasta + segundos * 1000;
  if (hasta <= ahora) return { ...estado, descansoHasta: null, descanso: null };
  return {
    ...estado,
    descansoHasta: hasta,
    descanso: estado.descanso ? { ...estado.descanso, manual: true } : estado.descanso,
  };
}

export function saltarDescanso(estado: EstadoSesion): EstadoSesion {
  return { ...estado, descansoHasta: null, descanso: null };
}

/** Cuántas series de la sesión ya se cerraron, y cuántas hay. */
export function progreso(estado: EstadoSesion): { hechas: number; total: number } {
  let hechas = 0;
  let total = 0;
  for (const ejercicio of estado.ejercicios) {
    for (const serie of ejercicio.series) {
      // Las que se dejaron al terminar el ejercicio antes no son deuda: la
      // barra se llena con lo que la persona decidió hacer.
      if (serie.omitida === true && serie.hechas === null) continue;
      total += 1;
      if (serie.hechas !== null) hechas += 1;
    }
  }
  return { hechas, total };
}

/** "1:30" — el descanso se lee en minutos y segundos, no en 90. */
export function formatoReloj(segundos: number): string {
  const minutos = Math.floor(segundos / 60);
  const resto = segundos % 60;
  return `${minutos}:${String(resto).padStart(2, "0")}`;
}

/**
 * El volumen levantado hasta ahora, en kilos.
 *
 * Las series de calentamiento no cuentan: son parte de la sesión pero no del
 * trabajo, y sumarlas infla el número que después se compara semana a semana.
 */
export function volumenKg(estado: EstadoSesion): number {
  let total = 0;
  for (const ejercicio of estado.ejercicios) {
    for (const serie of ejercicio.series) {
      if (serie.calentamiento || serie.hechas === null || serie.pesoKg === null) continue;
      total += serie.hechas * serie.pesoKg;
    }
  }
  return Math.round(total);
}

/**
 * El tempo, tal como se dice en el gimnasio: "3-1-1" — tres segundos bajando,
 * uno de pausa, uno subiendo. `null` cuando el ejercicio no lo prescribe.
 */
export function textoDeTempo(tempo: SerieViva["tempo"]): string | null {
  if (!tempo) return null;
  return `${tempo.ecc}-${tempo.pause}-${tempo.con}`;
}

/** Cuánto pesa un dropset: 20 % menos que la serie de la que sale. */
export function pesoDeDropset(pesoAnteriorKg: number | null): number | null {
  if (pesoAnteriorKg === null) return null;
  return Math.round(pesoAnteriorKg * 0.8 * 2) / 2;
}

/**
 * Lo que pide el plan en esta serie.
 *
 * Al fallo NO se escribe como un número a secas: quien lee "12" para y quien
 * lee "al fallo, mínimo 12" sigue. El piso importa tanto como el fallo — sin
 * él, una serie al fallo con mal día se cierra en 4 y nadie se entera.
 */
export function objetivoDeSerie(serie: SerieViva): string {
  if (serie.intensidad === "fallo") return `al fallo, mínimo ${serie.objetivo}`;
  if (serie.intensidad === "dropset") return `${serie.objetivo} reps · sin descanso`;
  return `${serie.objetivo} reps`;
}

const NOMBRE_DE_LADO: Record<NonNullable<SerieViva["lado"]>, string> = {
  DER: "Derecho",
  IZQ: "Izquierdo",
  AMBOS: "Los dos",
};

/**
 * Cómo se nombra la serie en pantalla.
 *
 * En un unilateral el conteo se lleva DENTRO del lado ("Derecho · serie 2 de
 * 3"), no sobre la lista completa: quien va en la quinta de seis está en la
 * segunda del izquierdo, y decirle "serie 5 de 6" no le sirve para nada
 * mientras tiene la mancuerna en la mano.
 */
export function etiquetaDeSerie(ejercicio: EjercicioVivo, indice: number): string {
  const serie = ejercicio.series[indice];
  if (!serie) return "";

  const sufijo = serie.calentamiento ? " · calentamiento" : "";
  const lado = serie.lado;

  if (lado === undefined || lado === "AMBOS") {
    return `Serie ${indice + 1} de ${ejercicio.series.length}${sufijo}`;
  }

  const delLado = ejercicio.series.filter((otra) => otra.lado === lado);
  const posicion = ejercicio.series.slice(0, indice + 1).filter((otra) => otra.lado === lado).length;

  return `${NOMBRE_DE_LADO[lado]} · serie ${posicion} de ${delLado.length}${sufijo}`;
}

// ---------------------------------------------------------------------------
// Descanso por esfuerzo (I2)
// ---------------------------------------------------------------------------

/**
 * Cómo se clasifica un ejercicio para el descanso.
 *
 * - `compuesto`: varias articulaciones y mucha masa muscular (sentadilla,
 *   press, remo, jalón, peso muerto). Es lo que más cansa al sistema nervioso
 *   y lo que más tarda en recuperar la fosfocreatina.
 * - `aislado`: una articulación (curl, extensión, elevación lateral).
 * - `accesorio`: lo de en medio (unilaterales, empujes cerrados, dominadas
 *   asistidas de bíceps).
 */
export type TipoDeEjercicio = "compuesto" | "accesorio" | "aislado";

const ROLES_COMPUESTOS = new Set([
  "cuadriceps_compuesto",
  "cadena_posterior",
  "empuje_horizontal",
  "empuje_inclinado",
  "empuje_vertical",
  "jalon_horizontal",
  "jalon_vertical",
  "complejo",
  "gluteo",
]);

const ROLES_AISLADOS = new Set([
  "apertura",
  "deltoide_lateral",
  "deltoide_posterior",
  "deltoide_frontal",
  "extension_polea",
  "extension_maquina",
  "extension_libre",
  "abductor",
  "aductor",
  "aductor_gluteo",
  "pantorrilla",
  "flexion_tronco",
  "flexion_cadera",
  "antiextension",
  "trapecio",
  "braquial",
  "femoral",
  "calentamiento_empuje",
]);

/** `null` cuando la sesión no trae el rol (sesiones cacheadas antes de I2). */
export function tipoDeEjercicio(poolRole: string | undefined): TipoDeEjercicio | null {
  if (!poolRole) return null;
  if (ROLES_COMPUESTOS.has(poolRole)) return "compuesto";
  if (ROLES_AISLADOS.has(poolRole) || poolRole.endsWith("_aislado")) return "aislado";
  return "accesorio";
}

type Objetivo = "fuerza" | "hipertrofia" | "metabolico";

function objetivoDeEsquema(esquema: string | undefined): Objetivo {
  if (esquema === "FUERZA") return "fuerza";
  if (esquema === "METABOLICO" || esquema === "REHAB") return "metabolico";
  return "hipertrofia";
}

/**
 * La base en segundos por tipo de ejercicio y esquema.
 *
 * Compuesto pesado 120–180 s, accesorio 60–90 s, aislado 45–60 s; dentro de
 * cada rango, fuerza arriba y metabólico abajo.
 *
 * Referencias: de Salles et al. 2009 (Sports Med 39:765, "Rest interval
 * between sets in strength training": 3–5 min para fuerza máxima, 1–2 min
 * para hipertrofia); ACSM Position Stand 2009 (Med Sci Sports Exerc 41:687:
 * 2–3 min en los multiarticulares pesados, 1–2 min en los demás); Grgic et
 * al. 2017 (Eur J Sport Sci 17:983: descansos largos en los compuestos no
 * frenan la hipertrofia y sí sostienen el volumen).
 */
const BASE_SEG: Record<TipoDeEjercicio, Record<Objetivo, number>> = {
  compuesto: { fuerza: 180, hipertrofia: 150, metabolico: 120 },
  accesorio: { fuerza: 90, hipertrofia: 75, metabolico: 60 },
  aislado: { fuerza: 60, hipertrofia: 50, metabolico: 45 },
};

/** Lo que el reloj sabe del pulso mientras se descansa. */
export type FcEnDescanso = {
  /** Latidos por minuto ahora. */
  bpm: number;
  /** Segundos desde que cerró la serie. */
  transcurridoSeg: number;
  /** FC en reposo de la persona, si Salud la tiene. */
  reposo: number | null;
  /** Edad en años, para estimar la FC máxima. */
  edad: number | null;
};

export type Descanso = {
  segundos: number;
  /** La base del ejercicio, antes de ajustar por esfuerzo. */
  baseSeg: number;
  /** Nunca menos que esto aunque la FC ya haya bajado (70 % de la base). */
  pisoSeg: number;
  /** Nunca más que esto aunque la FC no baje (150 % de la base). */
  techoSeg: number;
  /** A cuántos lpm hay que bajar para darse por recuperada. `null` sin FC. */
  fcObjetivo: number | null;
  /** Ya bajó al objetivo. `null` cuando no hay FC. */
  recuperado: boolean | null;
};

function redondeaA5(segundos: number): number {
  return Math.round(segundos / 5) * 5;
}

/**
 * A cuántos latidos hay que bajar para arrancar la siguiente serie:
 * `max(FC reposo + 30, 55 % de la FC máxima)`, con la FC máxima de Tanaka
 * (208 − 0.7·edad; Tanaka et al. 2001, J Am Coll Cardiol 37:153). Con solo
 * uno de los dos datos se usa ese; sin ninguno no hay objetivo.
 */
export function fcDeRecuperacion(reposo: number | null, edad: number | null): number | null {
  const porReposo = reposo !== null && reposo > 0 ? reposo + 30 : null;
  const porMaxima = edad !== null && edad > 0 ? Math.round(0.55 * (208 - 0.7 * edad)) : null;
  if (porReposo === null) return porMaxima;
  if (porMaxima === null) return porReposo;
  return Math.max(porReposo, porMaxima);
}

/**
 * Cuánto descansar después de `serie`.
 *
 * 1. La base sale del ejercicio (tipo + esquema). Sin rol conocido se usa el
 *    descanso que trae el plan.
 * 2. Se ajusta por lo que costó la serie: al fallo, RPE 9–10 o quedarse
 *    corto del objetivo → +30 %; si sobraron 3 reps o más, o RPE ≤ 6 → −20 %.
 * 3. Con FC del reloj, el descanso termina cuando el pulso baja al objetivo
 *    (`fcDeRecuperacion`), nunca antes del 70 % de la base ni después del
 *    150 %. Si todavía no baja, se estira de 15 en 15 segundos.
 *
 * Una serie de calentamiento no cansa: descansa lo justo para cambiar discos.
 */
export function descansoPara(serie: SerieViva, ejercicio: EjercicioVivo, fc?: FcEnDescanso): Descanso {
  const tipo = tipoDeEjercicio(ejercicio.poolRole);
  const baseSeg = tipo ? BASE_SEG[tipo][objetivoDeEsquema(ejercicio.esquema)] : ejercicio.descansoSeg;
  const pisoSeg = redondeaA5(baseSeg * 0.7);
  const techoSeg = redondeaA5(baseSeg * 1.5);

  if (serie.calentamiento) {
    return { segundos: Math.min(baseSeg, 45), baseSeg, pisoSeg, techoSeg, fcObjetivo: null, recuperado: null };
  }

  const rpe = serie.rpe ?? null;
  const hechas = serie.hechas;
  // Un dropset termina al fallo por definición: cuenta como serie dura.
  const duro =
    serie.intensidad === "fallo" ||
    serie.intensidad === "dropset" ||
    (rpe !== null && rpe >= 9) ||
    (hechas !== null && hechas < serie.objetivo);
  const sobro =
    !duro && ((rpe !== null && rpe <= 6) || (hechas !== null && hechas >= serie.objetivo + 3));
  const porReglas = redondeaA5(baseSeg * (duro ? 1.3 : sobro ? 0.8 : 1));

  const fcObjetivo = fc ? fcDeRecuperacion(fc.reposo, fc.edad) : null;
  if (!fc || fcObjetivo === null) {
    return { segundos: porReglas, baseSeg, pisoSeg, techoSeg, fcObjetivo: null, recuperado: null };
  }

  const recuperado = fc.bpm <= fcObjetivo;
  const deseado = recuperado ? fc.transcurridoSeg : Math.max(porReglas, fc.transcurridoSeg + 15);
  const segundos = Math.round(Math.min(techoSeg, Math.max(pisoSeg, deseado)));
  return { segundos, baseSeg, pisoSeg, techoSeg, fcObjetivo, recuperado };
}

/**
 * Llega una lectura de pulso del reloj durante el descanso: mueve la hora de
 * término según `descansoPara`. Si la persona ya movió el descanso a mano, o
 * no hay descanso en curso, el estado no cambia (el pulso se sigue enseñando).
 */
export function conFrecuencia(
  estado: EstadoSesion,
  bpm: number,
  perfil: { reposo: number | null; edad: number | null },
  ahora: number = Date.now(),
): { estado: EstadoSesion; descanso: Descanso | null } {
  const enCurso = estado.descanso;
  if (!enCurso || estado.descansoHasta === null) return { estado, descanso: null };
  const ejercicio = estado.ejercicios[enCurso.ejercicio];
  const serie = ejercicio?.series[enCurso.serie];
  if (!ejercicio || !serie) return { estado, descanso: null };

  const descanso = descansoPara(serie, ejercicio, {
    bpm,
    transcurridoSeg: Math.max(0, Math.round((ahora - enCurso.desde) / 1000)),
    ...perfil,
  });
  if (enCurso.manual) return { estado, descanso };

  const hasta = Math.max(ahora, enCurso.desde + descanso.segundos * 1000);
  return { estado: { ...estado, descansoHasta: hasta }, descanso };
}

// ---------------------------------------------------------------------------
// El peso de la serie que sigue (I2)
// ---------------------------------------------------------------------------

function redondeaPeso(kilos: number): number {
  return kilos >= 10 ? Math.round(kilos / 2.5) * 2.5 : Math.round(kilos * 2) / 2;
}

/**
 * El peso con el que conviene salir del descanso a la serie `indice`.
 *
 * - Dropset: 20 % abajo del peso REAL de la anterior.
 * - Si el plan trae peso y la anterior se cargó distinto a lo sugerido, la
 *   diferencia se arrastra: quien subió 5 kg en la primera no quiere que la
 *   segunda le vuelva a sugerir el número viejo.
 * - Sin peso del plan, el de la anterior ajustado por reps con Epley
 *   (pirámide: menos reps, más kilos).
 */
export function pesoSugerido(ejercicio: EjercicioVivo, indice: number): number | null {
  const siguiente = ejercicio.series[indice];
  if (!siguiente) return null;
  const plan = siguiente.pesoPlanKg !== undefined ? siguiente.pesoPlanKg : siguiente.pesoKg;
  if (siguiente.calentamiento) return plan;

  let anterior: SerieViva | null = null;
  for (let s = indice - 1; s >= 0; s -= 1) {
    const candidata = ejercicio.series[s]!;
    if (candidata.hechas !== null && candidata.pesoKg !== null && !candidata.calentamiento) {
      anterior = candidata;
      break;
    }
  }

  if (siguiente.intensidad === "dropset") {
    return anterior ? pesoDeDropset(anterior.pesoKg) : plan;
  }
  if (!anterior || anterior.pesoKg === null) return plan;

  if (plan !== null && plan !== undefined) {
    const planAnterior = anterior.pesoPlanKg;
    if (planAnterior === null || planAnterior === undefined) return plan;
    return Math.max(0, redondeaPeso(plan + (anterior.pesoKg - planAnterior)));
  }

  const repsAnterior = anterior.hechas ?? anterior.objetivo;
  const estimado = (anterior.pesoKg * (1 + repsAnterior / 30)) / (1 + siguiente.objetivo / 30);
  return redondeaPeso(estimado);
}

// ---------------------------------------------------------------------------
// Carga por lado (I2)
// ---------------------------------------------------------------------------

/** Cómo está montado un ejercicio: se guarda en `Profile.exercisePrefs`. */
export type Montaje = { cargaPorLado: boolean; barraKg: number };

/** Lo que se registra: los dos lados más la barra (o el carro). */
export function totalDesdeLado(ladoKg: number, barraKg: number): number {
  return ladoKg * 2 + barraKg;
}

/** Lo que va en cada lado para llegar a `totalKg`. */
export function ladoDesdeTotal(totalKg: number, barraKg: number): number {
  return Math.max(0, (totalKg - barraKg) / 2);
}

const CON_DISCOS =
  /\b(barra|prensa|smith|hack|sentadilla|peso muerto|press de banca|press banca|hip thrust|remo en t|t-bar|landmine|pendulo|belt squat|discos)\b/;

const SIN_DISCOS = /\b(mancuerna|mancuernas|polea|cable|liga|kettlebell|pesa rusa|peso corporal)\b/;

function sinAcentos(texto: string): string {
  return texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * ¿Vale preguntar "¿se carga por lado?" en este ejercicio? Solo en barras y
 * máquinas de discos; en mancuernas y poleas la pregunta es ruido.
 */
export function preguntarMontaje(nombre: string): boolean {
  const limpio = sinAcentos(nombre);
  if (SIN_DISCOS.test(limpio)) return false;
  return CON_DISCOS.test(limpio);
}

/**
 * Lo que pesa la barra si la persona no sabe: olímpica 20 kg (45 lb en
 * gimnasios de libras); el carro de prensa, hack o péndulo, 0.
 */
export function barraPorDefecto(nombre: string, unidad: "kg" | "lb"): number {
  const limpio = sinAcentos(nombre);
  if (/\b(prensa|hack|pendulo|belt squat)\b/.test(limpio)) return 0;
  return unidad === "kg" ? 20 : 45 / 2.2046226218;
}

// ---------------------------------------------------------------------------
// Terminar un ejercicio (I2)
// ---------------------------------------------------------------------------

/**
 * "Terminar este ejercicio": pasa al siguiente y deja las series que faltan
 * SIN registrar (no en cero). En el último ejercicio termina la sesión.
 *
 * El descanso que ya corría se respeta: la serie que acaba de cerrar sí
 * costó, y el traslado a la otra máquina no la descansa sola.
 */
export function terminarEjercicio(estado: EstadoSesion): {
  estado: EstadoSesion;
  siguiente: "otro_ejercicio" | "fin";
} {
  const ejercicios = estado.ejercicios.map((ejercicio, e) =>
    e !== estado.ejercicioActual
      ? ejercicio
      : {
          ...ejercicio,
          series: ejercicio.series.map((serie) =>
            serie.hechas === null ? { ...serie, omitida: true } : serie,
          ),
        },
  );

  const pendiente = primeraPendiente(ejercicios);
  if (pendiente === null) {
    return {
      estado: { ...estado, ejercicios, descansoHasta: null, descanso: null, terminada: true },
      siguiente: "fin",
    };
  }

  return {
    estado: {
      ...estado,
      ejercicios,
      ejercicioActual: pendiente.ejercicio,
      serieActual: pendiente.serie,
    },
    siguiente: "otro_ejercicio",
  };
}

/**
 * Al retomar una sesión con el cursor ya en un ejercicio posterior, lo que
 * quedó sin cerrar atrás se da por terminado: es lo que pasó con "Terminar
 * este ejercicio", y sin esto la siguiente serie regresaba al ejercicio que
 * la persona ya había dejado.
 */
export function omitirSaltadas(estado: EstadoSesion): EstadoSesion {
  return {
    ...estado,
    ejercicios: estado.ejercicios.map((ejercicio, e) =>
      e >= estado.ejercicioActual
        ? ejercicio
        : {
            ...ejercicio,
            series: ejercicio.series.map((serie) =>
              serie.hechas === null ? { ...serie, omitida: true } : serie,
            ),
          },
    ),
  };
}

// ---------------------------------------------------------------------------
// Cambiar un ejercicio sin repetir (I2)
// ---------------------------------------------------------------------------

type Alternativa = NonNullable<EjercicioVivo["alternativas"]>[number];

function claveDeNombre(nombre: string): string {
  return sinAcentos(nombre).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function esElMismo(
  a: { exerciseId?: string | null; nombre: string },
  b: { exerciseId: string; name: string },
): boolean {
  if (a.exerciseId && a.exerciseId === b.exerciseId) return true;
  return claveDeNombre(a.nombre) === claveDeNombre(b.name);
}

/**
 * Las alternativas de `indice` que no están ya en la sesión.
 *
 * La lista viaja congelada con la semana; un cambio hecho a media sesión (o
 * un plan que cambió después) podía dejar ofrecido justo lo que tocaba dos
 * ejercicios más abajo. Aquí se filtra contra la sesión TAL COMO VA.
 */
export function alternativasLibres(estado: EstadoSesion, indice: number): Alternativa[] {
  const ejercicio = estado.ejercicios[indice];
  if (!ejercicio) return [];
  const otros = estado.ejercicios.filter((_, e) => e !== indice);
  return (ejercicio.alternativas ?? []).filter(
    (opcion) => !esElMismo(ejercicio, opcion) && !otros.some((otro) => esElMismo(otro, opcion)),
  );
}

function conAlternativa(ejercicio: EjercicioVivo, alternativa: Alternativa): EjercicioVivo {
  return {
    ...ejercicio,
    exerciseId: alternativa.exerciseId,
    nombre: alternativa.name,
    // Lo capturado se va con la máquina anterior: la carga de la prensa no
    // es la del hack squat.
    series: ejercicio.series.map((serie) => ({
      ...serie,
      hechas: null,
      pesoKg: null,
      pesoPlanKg: null,
      omitida: false,
    })),
  };
}

/**
 * Cambia el ejercicio `indice` por `alternativa` y, si esa alternativa ya
 * estaba más abajo en la sesión, cambia ESE por otra de sus alternativas que
 * no esté en la sesión (ni sea la máquina que se acaba de dejar, que está
 * ocupada). Si no hay con qué, el de abajo se queda como estaba.
 *
 * Devuelve cada cambio aplicado, en orden, para encolarlos al servidor.
 */
export function sustituirEnSesion(
  estado: EstadoSesion,
  indice: number,
  alternativa: Alternativa,
): { estado: EstadoSesion; cambios: Array<{ indice: number; alternativa: Alternativa }> } {
  const original = estado.ejercicios[indice];
  if (!original) return { estado, cambios: [] };

  const ejercicios = [...estado.ejercicios];
  ejercicios[indice] = conAlternativa(original, alternativa);
  const cambios = [{ indice, alternativa }];

  for (let j = indice + 1; j < ejercicios.length; j += 1) {
    const abajo = ejercicios[j]!;
    if (!esElMismo(abajo, alternativa)) continue;

    const reemplazo = (abajo.alternativas ?? []).find(
      (opcion) =>
        !esElMismo(original, opcion) &&
        !ejercicios.some((otro, e) => e !== j && esElMismo(otro, opcion)) &&
        !esElMismo(abajo, opcion),
    );
    if (!reemplazo) continue;
    ejercicios[j] = conAlternativa(abajo, reemplazo);
    cambios.push({ indice: j, alternativa: reemplazo });
  }

  const esActual = indice === estado.ejercicioActual;
  return {
    estado: {
      ...estado,
      ejercicios,
      serieActual: esActual ? 0 : estado.serieActual,
      descansoHasta: esActual ? null : estado.descansoHasta,
      descanso: esActual ? null : estado.descanso,
    },
    cambios,
  };
}
