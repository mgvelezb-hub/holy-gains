import {
  MINIMO_DIA_CON_CARDIO,
  compatibilidad,
  ordenar,
  repartirCardioDespues,
  repartirMinutos,
  type BloqueDia,
} from "@/lib/training/combinaciones";
import { NOMBRES_DE_DIA, WEEK_DAYS, type WeekDay } from "@/lib/training/split";
import type { Discipline, ModoDisciplina, PreferenciasCardio } from "@/lib/training/types";

/**
 * Rearmar la semana desde cero — lógica PURA.
 *
 * Es lo que corre cuando alguien dice "empecemos de nuevo": se le pregunta
 * cuánto tiempo tiene cada día, qué disciplina manda, cuáles acompañan y para
 * qué sirve cada una, y de ahí sale un reparto que **cabe de verdad**.
 *
 * Las tres reglas que lo hacen distinto de repartir a ojo:
 *
 * 1. **El tiempo del día es un techo, no una sugerencia.** Si el martes hay
 *    una hora, no caben gimnasio, alberca y squash: la app lo dice y reparte
 *    lo que sí cabe, en vez de armar una semana que se abandona el jueves.
 * 2. **El propósito cambia cuánto pesa cada disciplina.** Lo que se entrena en
 *    serio pide sesiones completas; un pasatiempo pide un hueco, no un plan.
 * 3. **La primaria nunca se queda sin semana.** Es la que arma el esqueleto;
 *    las demás caen alrededor.
 *
 * Lo que NO hace: inventar sesiones de disciplinas que no sabemos prescribir.
 * Reserva el día y dice para qué es, igual que el planificador semanal.
 *
 * **Fase 9 — antes de decir "no cupo".** Lo que no encontró día propio no se
 * da por perdido de inmediato: primero intenta anexarse como segundo bloque a
 * un día YA asignado (de la primaria o de otra secundaria), usando
 * `combinaciones.ts` para decidir si de verdad conviven y cuánto tiempo le
 * toca a cada una del tiempo real de ese día. Solo si tampoco hay ahí un
 * hueco compatible se avisa. Este módulo no conoce el `DayKind` del gimnasio
 * (eso lo decide `buildSplit` más tarde, cuando ya se generó la semana), así
 * que la regla de "nada de alto impacto en día de pierna" no aplica aquí —
 * las demás reglas duras de `compatibilidad` (misma disciplina, CrossFit con
 * gimnasio, squash+box) sí.
 *
 * **Fase 10 — compactar por gusto (`diasCompactos`).** La Fase 9 combina solo
 * cuando algo no encontró día propio. Con `diasCompactos` encendido —lo que
 * declaró la persona en Ajustes (`Profile.compactDays`), no algo que se
 * pregunte aquí— se compacta igual aunque todo haya cabido suelto: mismo
 * greedy por `compatibilidad` que en `disciplines.ts` (el par de mejor
 * puntaje primero, hasta que ninguno quepa), pero contra el tiempo real de
 * `tiempo` en vez del `timePerDay` declarado aparte — este módulo, a
 * diferencia de `disciplines.ts`, sí lo tiene en la mano en el momento del
 * reparto. Por la misma razón que la Fase 9, tampoco aquí aplica la regla de
 * "nada de alto impacto en día de pierna": sin `DayKind`, no hay pierna que
 * proteger.
 */

export const PROPOSITOS = ["ENTRENAMIENTO", "COMPLEMENTO", "HOBBY"] as const;
export type Proposito = (typeof PROPOSITOS)[number];

/**
 * Cuánto pesa cada propósito al repartir el presupuesto.
 *
 * No son porcentajes: son pesos relativos. Lo que se entrena en serio vale el
 * triple que un pasatiempo, y el complemento —lo que se hace para sostener lo
 * demás: movilidad, cardio suave— queda en medio.
 */
const PESO_POR_PROPOSITO: Record<Proposito, number> = {
  ENTRENAMIENTO: 3,
  COMPLEMENTO: 2,
  HOBBY: 1,
};

/**
 * Minutos que pide una sesión digna de cada propósito.
 *
 * Por debajo de esto la sesión deja de valer la pena: media hora de gimnasio
 * es una sesión corta, quince minutos es un calentamiento.
 */
const MINUTOS_MINIMOS: Record<Proposito, number> = {
  ENTRENAMIENTO: 45,
  COMPLEMENTO: 30,
  HOBBY: 30,
};

export type DisciplinaElegida = {
  discipline: Discipline;
  proposito: Proposito;
  /** 1 a 3: cuánto quiere la persona que pese, dentro de su propósito. */
  importancia: number;
  /**
   * `DESPUES`: va pegada a los días de la primaria, no compite por un día
   * propio (H2). Sin `modo`, día propio — igual que siempre.
   */
  modo?: ModoDisciplina;
  /** Solo con `DESPUES`: cuántas por semana. Sin dato, una por día de primaria. */
  sesiones?: number;
  /** Solo CARDIO: se guarda tal cual y de aquí salen sus minutos. */
  cardio?: PreferenciasCardio;
};

/** Minutos de cardio después de pesas cuando la persona no los declaró. */
export const MINUTOS_CARDIO_DESPUES = 20;

const NOMBRE_SECUNDARIA: Partial<Record<Discipline, string>> = {
  CARDIO: "El cardio",
  NATACION: "La natación",
  SQUASH: "El squash",
  BOX: "El box",
  FUNCIONAL: "El funcional",
  CROSSFIT: "El CrossFit",
  GOLF: "El golf",
};

function nombreSecundaria(discipline: Discipline): string {
  return NOMBRE_SECUNDARIA[discipline] ?? "Esa disciplina";
}

export type TiempoPorDia = Record<WeekDay, number>;

export type EntradaReplan = {
  /** Minutos disponibles cada día. 0 = ese día no se entrena. */
  tiempo: TiempoPorDia;
  primaria: Discipline;
  /** Las demás. La primaria no se repite aquí. */
  secundarias: DisciplinaElegida[];
  /** Cuántas sesiones de la primaria quiere a la semana, como tope deseado. */
  sesionesPrimaria: number;
  /**
   * Preferencia declarada en Ajustes (`Profile.compactDays`): compactar por
   * gusto (Fase 10) además de por desborde (Fase 9). `undefined`/`false` deja
   * el reparto de siempre.
   */
  diasCompactos?: boolean;
};

export type SesionAsignada = {
  weekday: WeekDay;
  discipline: Discipline;
  minutos: number;
  esPrimaria: boolean;
  /** Va pegada después de la primaria: no paga un día del presupuesto. */
  despues?: boolean;
};

/**
 * Lo que se puede hacer con una secundaria sin salir del replanteo (I1): el
 * aviso ya no manda a Ajustes, trae la acción y la vista previa se recalcula.
 */
export type AccionReplan = {
  discipline: Discipline;
  /** Cómo quedó en esta propuesta. */
  modo: ModoDisciplina;
  /** El cambio que se ofrece: "Pegar el cardio después de pesas" / "Darle su propio día". */
  alternativa: { modo: ModoDisciplina; texto: string };
};

export type Replan = {
  asignadas: SesionAsignada[];
  /**
   * Sesiones por disciplina, listo para guardar en el perfil. La primaria
   * sale sin `proposito`/`importancia` — esos dos campos son de las
   * secundarias, lo que la persona contestó al elegirlas (`secundarias` en
   * `EntradaReplan`). Guardarlos aquí es lo que evita que la próxima
   * recalibración tenga que adivinar la importancia contando sesiones.
   */
  cargas: Array<{
    discipline: Discipline;
    sessionsPerWeek: number;
    proposito?: Proposito;
    importancia?: number;
    modo?: ModoDisciplina;
    cardio?: PreferenciasCardio;
  }>;
  /** Días que quedaron con entrenamiento. */
  diasActivos: WeekDay[];
  /**
   * Sesiones que pagan presupuesto: la primaria y las de día propio. Lo que
   * va "después de pesas" no cuenta — es `liftingDays`, y antes se guardaba
   * `asignadas.length`, que sumaba cada cardio pegado como si fuera un día.
   */
  presupuesto: number;
  /** Una por secundaria: cómo quedó y el cambio que se le puede hacer ahí mismo. */
  acciones: AccionReplan[];
  /**
   * Lo que no cupo y por qué. Se dice siempre: un plan que recorta en silencio
   * hace pensar que la app se equivocó.
   */
  avisos: string[];
};

/** Los días con tiempo suficiente para algo, del que más tiene al que menos. */
function diasUtiles(tiempo: TiempoPorDia, minimo: number): WeekDay[] {
  return WEEK_DAYS.filter((dia) => (tiempo[dia] ?? 0) >= minimo);
}

/**
 * Cuántas sesiones le tocan a cada secundaria.
 *
 * Se reparte por peso —propósito × importancia— sobre los días que sobran
 * después de la primaria. Redondear hacia abajo es deliberado: es mejor que
 * sobre un día libre a que la semana pida más de lo que hay.
 */
function repartirSecundarias(
  secundarias: DisciplinaElegida[],
  huecos: number,
): Array<{ discipline: Discipline; sesiones: number; proposito: Proposito }> {
  if (secundarias.length === 0 || huecos <= 0) {
    return secundarias.map((entrada) => ({
      discipline: entrada.discipline,
      sesiones: 0,
      proposito: entrada.proposito,
    }));
  }

  const pesos = secundarias.map((entrada) => ({
    entrada,
    peso: PESO_POR_PROPOSITO[entrada.proposito] * Math.max(1, Math.min(3, entrada.importancia)),
  }));
  const total = pesos.reduce((suma, actual) => suma + actual.peso, 0);

  const repartido = pesos.map(({ entrada, peso }) => ({
    discipline: entrada.discipline,
    proposito: entrada.proposito,
    sesiones: Math.floor((huecos * peso) / total),
  }));

  // Lo que sobró por redondear va a la de mayor peso: repartirlo "parejo"
  // acabaría dándole una sesión a un pasatiempo antes que a lo que se entrena.
  let restante = huecos - repartido.reduce((suma, actual) => suma + actual.sesiones, 0);
  const orden = [...pesos].sort((a, b) => b.peso - a.peso);
  let indice = 0;
  while (restante > 0 && orden.length > 0) {
    const objetivo = orden[indice % orden.length]!.entrada.discipline;
    const fila = repartido.find((entrada) => entrada.discipline === objetivo);
    if (fila) fila.sesiones += 1;
    restante -= 1;
    indice += 1;
  }

  return repartido;
}

/**
 * Intenta anexar `discipline` como segundo bloque a un día que ya tiene una
 * sesión asignada (de la primaria o de otra secundaria).
 *
 * Entre todos los días ya ocupados y sin su segundo bloque, se queda con el
 * de mejor `compatibilidad` — y solo si `repartirMinutos` alcanza con el
 * tiempo real de ese día (`tiempo[dia]`, no una suma de valores por defecto:
 * aquí sí se sabe cuánto tiempo hay de verdad). Si combina, la sesión del
 * ocupante original se actualiza con su minutaje real; la nueva se agrega con
 * el mismo `weekday`.
 */
function intentarAnexarEnDia(
  discipline: Discipline,
  tiempo: TiempoPorDia,
  asignadas: SesionAsignada[],
  diasConDosBloques: Set<WeekDay>,
): boolean {
  const nuevo: BloqueDia = { discipline };

  // Un weekday puede ya traer una o dos sesiones; solo el primer ocupante
  // cuenta para decidir si cabe un segundo bloque — un tercero nunca se
  // ofrece.
  const primerOcupantePorDia = new Map<WeekDay, SesionAsignada>();
  for (const sesion of asignadas) {
    if (!primerOcupantePorDia.has(sesion.weekday)) primerOcupantePorDia.set(sesion.weekday, sesion);
  }

  let mejor: {
    ocupante: SesionAsignada;
    orden: [BloqueDia, BloqueDia];
    minutos: [number, number];
    score: number;
  } | null = null;

  for (const [dia, ocupante] of primerOcupantePorDia) {
    if (diasConDosBloques.has(dia)) continue;

    const existente: BloqueDia = { discipline: ocupante.discipline };
    const score = compatibilidad(existente, nuevo);
    if (score === null) continue;

    const orden = ordenar(existente, nuevo);
    const reparto = repartirMinutos(tiempo[dia] ?? 0, orden);
    if (!reparto) continue;

    if (!mejor || score > mejor.score) {
      mejor = { ocupante, orden, minutos: reparto.minutos, score };
    }
  }

  if (!mejor) return false;

  diasConDosBloques.add(mejor.ocupante.weekday);
  const [primero] = mejor.orden;
  const nuevoEsPrimero = primero.discipline === discipline;

  mejor.ocupante.minutos = nuevoEsPrimero ? mejor.minutos[1] : mejor.minutos[0];
  asignadas.push({
    weekday: mejor.ocupante.weekday,
    discipline,
    minutos: nuevoEsPrimero ? mejor.minutos[0] : mejor.minutos[1],
    esPrimaria: false,
  });

  return true;
}

/**
 * Pega una secundaria `DESPUES` a los días de la primaria, en orden de semana,
 * hasta `sesiones` (H2).
 *
 * El cardio no se reparte 60/40: lleva los minutos que la persona declaró y
 * el gym cede el resto (`repartirCardioDespues`). Lo demás (squash después de
 * pesas) sí usa `repartirMinutos`. Lo que no cupo se dice día por día —"El
 * cardio no cupo el martes: 40 min declarados"— en vez de desaparecer.
 */
function anexarDespues(
  elegida: DisciplinaElegida,
  sesiones: number,
  tiempo: TiempoPorDia,
  asignadas: SesionAsignada[],
  diasConDosBloques: Set<WeekDay>,
  avisos: string[],
): number {
  let colocadas = 0;
  const diasPrimaria = asignadas.filter((sesion) => sesion.esPrimaria);

  for (const ocupante of diasPrimaria) {
    if (colocadas >= sesiones) break;
    if (diasConDosBloques.has(ocupante.weekday)) continue;
    const total = tiempo[ocupante.weekday] ?? 0;

    if (elegida.discipline === "CARDIO") {
      const reparto = repartirCardioDespues(total, elegida.cardio?.minutos ?? MINUTOS_CARDIO_DESPUES);
      if (!reparto) {
        avisos.push(
          `El cardio no cupo el ${NOMBRES_DE_DIA[ocupante.weekday]}: ${total} min declarados (pide al menos ${MINIMO_DIA_CON_CARDIO}).`,
        );
        continue;
      }
      ocupante.minutos = reparto.gym;
      asignadas.push({
        weekday: ocupante.weekday,
        discipline: "CARDIO",
        minutos: reparto.cardio,
        esPrimaria: false,
        despues: true,
      });
    } else {
      const existente: BloqueDia = { discipline: ocupante.discipline };
      const nuevo: BloqueDia = { discipline: elegida.discipline };
      if (compatibilidad(existente, nuevo, { explicita: true }) === null) continue;
      const orden = ordenar(existente, nuevo);
      const reparto = repartirMinutos(total, orden);
      if (!reparto) {
        avisos.push(
          `${nombreSecundaria(elegida.discipline)} no cupo el ${NOMBRES_DE_DIA[ocupante.weekday]}: ${total} min declarados.`,
        );
        continue;
      }
      const nuevoEsPrimero = orden[0].discipline === elegida.discipline;
      ocupante.minutos = nuevoEsPrimero ? reparto.minutos[1] : reparto.minutos[0];
      asignadas.push({
        weekday: ocupante.weekday,
        discipline: elegida.discipline,
        minutos: nuevoEsPrimero ? reparto.minutos[0] : reparto.minutos[1],
        esPrimaria: false,
        despues: true,
      });
    }

    diasConDosBloques.add(ocupante.weekday);
    colocadas += 1;
  }

  if (colocadas < sesiones && diasPrimaria.length < sesiones) {
    avisos.push(
      `${nombreSecundaria(elegida.discipline)} después de pesas: pediste ${sesiones} y solo hay ${diasPrimaria.length} ${diasPrimaria.length === 1 ? "día" : "días"} de gimnasio.`,
    );
  }
  return colocadas;
}

/** Un día con exactamente una sesión: candidato a compactarse con otro. */
type CandidatoCompacto = { weekday: WeekDay; sesion: SesionAsignada };

/** Los días de una sola sesión, en orden de semana (más temprano primero). */
function candidatosCompactables(asignadas: SesionAsignada[]): CandidatoCompacto[] {
  const candidatos: CandidatoCompacto[] = [];
  for (const weekday of WEEK_DAYS) {
    const enEseDia = asignadas.filter((sesion) => sesion.weekday === weekday);
    if (enEseDia.length === 1) candidatos.push({ weekday, sesion: enEseDia[0]! });
  }
  return candidatos;
}

/**
 * Fase 10: compacta por preferencia, no por desborde — igual que su
 * contraparte en `disciplines.ts`, pero mutando `SesionAsignada[]` (aquí no
 * hay `Colocacion` ni gimnasio aparte: la primaria es una sesión más dentro
 * de `asignadas`, así que participa en la compactación igual que cualquier
 * secundaria).
 *
 * Greedy: en cada vuelta evalúa todos los pares de días de una sola sesión,
 * se queda con el de mejor `compatibilidad` que quepa en `repartirMinutos`
 * contra el tiempo REAL de ese día (`tiempo[destino]`, no una suma de
 * valores por defecto), fusiona, y repite desde cero hasta que ningún par
 * combine. El día que sobrevive como destino es el más temprano de los dos —
 * no hay una regla fisiológica que decida cuál fecha se queda.
 */
function intentarCompactarAsignadas(asignadas: SesionAsignada[], tiempo: TiempoPorDia): void {
  for (;;) {
    const candidatos = candidatosCompactables(asignadas);

    type Fusion = {
      destino: CandidatoCompacto;
      origen: CandidatoCompacto;
      orden: [BloqueDia, BloqueDia];
      minutos: [number, number];
      score: number;
    };
    let mejor: Fusion | null = null;

    for (let i = 0; i < candidatos.length; i++) {
      for (let j = i + 1; j < candidatos.length; j++) {
        // `candidatosCompactables` recorre `WEEK_DAYS` en orden e `i < j`:
        // el destino ya es el más temprano de los dos.
        const destino = candidatos[i]!;
        const origen = candidatos[j]!;
        const bloqueDestino: BloqueDia = { discipline: destino.sesion.discipline };
        const bloqueOrigen: BloqueDia = { discipline: origen.sesion.discipline };

        const score = compatibilidad(bloqueDestino, bloqueOrigen);
        if (score === null) continue; // incompatibilidad dura: manda siempre

        const orden = ordenar(bloqueDestino, bloqueOrigen);
        const reparto = repartirMinutos(tiempo[destino.weekday] ?? 0, orden);
        if (!reparto) continue; // no caben los dos mínimos con el tiempo real del día

        if (!mejor || score > mejor.score) {
          mejor = { destino, origen, orden, minutos: reparto.minutos, score };
        }
      }
    }

    if (!mejor) return; // no queda par compatible que quepa: termina aquí

    const [primero] = mejor.orden;
    const destinoEsPrimero = primero.discipline === mejor.destino.sesion.discipline;

    mejor.destino.sesion.minutos = destinoEsPrimero ? mejor.minutos[0] : mejor.minutos[1];
    mejor.origen.sesion.minutos = destinoEsPrimero ? mejor.minutos[1] : mejor.minutos[0];
    // La sesión de origen se muda a la fecha destino: su día original queda
    // sin sesión — libre de verdad.
    mejor.origen.sesion.weekday = mejor.destino.weekday;
  }
}

/**
 * El reparto de la semana.
 *
 * Primero la primaria toma los días que le alcanzan; lo que queda se reparte
 * entre las secundarias por peso. Un día lleva una sola sesión salvo que dos
 * disciplinas combinen de verdad (Fase 9): compatibles según
 * `combinaciones.ts` y con tiempo real para los mínimos de ambas más la
 * transición. Una tercera nunca se ofrece — combinar es la excepción que
 * evita perder una sesión, no la norma.
 */
export function replanificar(entrada: EntradaReplan): Replan {
  const avisos: string[] = [];

  const minimoPrimaria = MINUTOS_MINIMOS.ENTRENAMIENTO;
  const disponiblesPrimaria = diasUtiles(entrada.tiempo, minimoPrimaria);

  const sesionesPrimaria = Math.max(
    0,
    Math.min(entrada.sesionesPrimaria, disponiblesPrimaria.length),
  );

  if (sesionesPrimaria < entrada.sesionesPrimaria) {
    avisos.push(
      `Pediste ${entrada.sesionesPrimaria} sesiones de ${entrada.primaria.toLowerCase()} y solo ` +
        `${disponiblesPrimaria.length} de tus días tienen al menos ${minimoPrimaria} minutos.`,
    );
  }

  // La primaria se lleva los días con más tiempo: es la que más pide.
  const ordenadosPorTiempo = [...disponiblesPrimaria].sort(
    (a, b) => (entrada.tiempo[b] ?? 0) - (entrada.tiempo[a] ?? 0),
  );
  const diasPrimaria = new Set(ordenadosPorTiempo.slice(0, sesionesPrimaria));

  const asignadas: SesionAsignada[] = WEEK_DAYS.filter((dia) => diasPrimaria.has(dia)).map((dia) => ({
    weekday: dia,
    discipline: entrada.primaria,
    minutos: entrada.tiempo[dia] ?? 0,
    esPrimaria: true,
  }));

  // Días que ya combinaron dos disciplinas: no se ofrece un tercer bloque.
  const diasConDosBloques = new Set<WeekDay>();

  // H2 — las `DESPUES` van primero y pegadas a la primaria: no compiten por
  // huecos. Antes no existían aquí, y con la primaria en todos los días con
  // tiempo el cardio salía con 0 sesiones y sin aviso.
  const despues = entrada.secundarias.filter((elegida) => elegida.modo === "DESPUES");
  const colocadasDespues = new Map<Discipline, number>();
  for (const elegida of despues) {
    const pedidas = Math.max(0, Math.min(7, Math.trunc(elegida.sesiones ?? diasPrimaria.size)));
    colocadasDespues.set(
      elegida.discipline,
      anexarDespues(elegida, pedidas, entrada.tiempo, asignadas, diasConDosBloques, avisos),
    );
  }

  const librePorDia = WEEK_DAYS.filter((dia) => !diasPrimaria.has(dia));
  const reparto = repartirSecundarias(
    entrada.secundarias.filter((elegida) => elegida.modo !== "DESPUES"),
    librePorDia.filter((dia) => (entrada.tiempo[dia] ?? 0) >= MINUTOS_MINIMOS.HOBBY).length,
  );

  // Cada secundaria toma sus días entre los que le alcanzan, empezando por los
  // que menos tiempo tienen: los días largos se dejan para lo que pide más.
  const tomados = new Set<WeekDay>();
  // I1: lo que no trae modo y no encontró día libre se pega después de pesas
  // por default. Es lo que casi siempre se quiere —la primaria ya llenó los
  // días— y antes se quedaba en 0 sesiones con un aviso que mandaba a Ajustes.
  const modoAplicado = new Map<Discipline, ModoDisciplina>();
  for (const fila of reparto) {
    if (fila.sesiones === 0) {
      const elegida = entrada.secundarias.find((candidata) => candidata.discipline === fila.discipline);
      if (elegida && elegida.modo === undefined && diasPrimaria.size > 0) {
        const pedidas = Math.max(0, Math.min(7, Math.trunc(elegida.sesiones ?? diasPrimaria.size)));
        const colocadas = anexarDespues(
          { ...elegida, modo: "DESPUES" },
          pedidas,
          entrada.tiempo,
          asignadas,
          diasConDosBloques,
          avisos,
        );
        if (colocadas > 0) {
          modoAplicado.set(fila.discipline, "DESPUES");
          colocadasDespues.set(fila.discipline, colocadas);
          avisos.push(
            `${nombreSecundaria(fila.discipline)} va después de pesas: no quedó ningún día libre con tiempo.`,
          );
          continue;
        }
      }
      // Sin huecos no hay reparto que hacer, pero callarlo es lo que hizo
      // desaparecer el cardio de Mau (H2): se dice, y la acción para
      // resolverlo viaja en `acciones` — ya no se manda a nadie a Ajustes.
      avisos.push(`${nombreSecundaria(fila.discipline)} no cupo: no queda ningún día libre con tiempo.`);
      continue;
    }

    const minimo = MINUTOS_MINIMOS[fila.proposito];
    const candidatos = librePorDia
      .filter((dia) => !tomados.has(dia) && (entrada.tiempo[dia] ?? 0) >= minimo)
      .sort((a, b) => (entrada.tiempo[a] ?? 0) - (entrada.tiempo[b] ?? 0));

    const cabe = Math.min(fila.sesiones, candidatos.length);

    for (const dia of candidatos.slice(0, cabe)) {
      tomados.add(dia);
      asignadas.push({
        weekday: dia,
        discipline: fila.discipline,
        minutos: entrada.tiempo[dia] ?? 0,
        esPrimaria: false,
      });
    }

    // Lo que no encontró día propio intenta anexarse a uno ya asignado antes
    // de darlo por perdido — ver el docblock del módulo.
    let anexadas = 0;
    for (let restante = fila.sesiones - cabe; restante > 0; restante--) {
      const anexada = intentarAnexarEnDia(fila.discipline, entrada.tiempo, asignadas, diasConDosBloques);
      if (!anexada) break; // si ya no combinó en ningún lado, un intento más tampoco lo hará.
      anexadas += 1;
    }

    const totalColocadas = cabe + anexadas;
    if (totalColocadas < fila.sesiones) {
      avisos.push(
        `${fila.discipline.toLowerCase()} se queda en ${totalColocadas} ${totalColocadas === 1 ? "sesión" : "sesiones"}: ` +
          `no hay más días con al menos ${minimo} minutos libres, ni un día ya asignado con el que combine.`,
      );
    }
  }

  // FASE 10 — compactar por gusto, quepa o no quepa todo suelto. ------------
  if (entrada.diasCompactos) {
    intentarCompactarAsignadas(asignadas, entrada.tiempo);
  }

  const porDisciplina = new Map<Discipline, number>();
  for (const sesion of asignadas) {
    porDisciplina.set(sesion.discipline, (porDisciplina.get(sesion.discipline) ?? 0) + 1);
  }

  // Lo que la persona contestó al elegir cada secundaria, para hilarlo hasta
  // `cargas` y que sobreviva en el perfil (ver el docblock de `Replan`).
  const eleccionPorDisciplina = new Map(
    entrada.secundarias.map((elegida) => [elegida.discipline, elegida] as const),
  );

  const ordenadas = asignadas.sort(
    (a, b) => WEEK_DAYS.indexOf(a.weekday) - WEEK_DAYS.indexOf(b.weekday),
  );

  if (ordenadas.length === 0) {
    avisos.push(
      `Ninguno de tus días llega a ${MINUTOS_MINIMOS.HOBBY} minutos. Con menos que eso no hay ` +
        "sesión que valga la pena: conviene juntar el tiempo en menos días.",
    );
  }

  return {
    asignadas: ordenadas,
    cargas: [
      ...porDisciplina.entries(),
      // Una secundaria elegida que no alcanzó sesión sigue siendo suya: se
      // guarda en 0 (declarada, no planeada) en vez de borrarse del perfil.
      ...entrada.secundarias
        .filter((elegida) => !porDisciplina.has(elegida.discipline))
        .map((elegida) => [elegida.discipline, 0] as const),
    ].map(([discipline, sessionsPerWeek]) => {
      const elegida = eleccionPorDisciplina.get(discipline);
      const modo = modoAplicado.get(discipline) ?? elegida?.modo;
      return {
        discipline,
        // Una `DESPUES` guarda lo que pidió, no lo que cupo esta vez: la
        // semana que viene puede traer más tiempo, y el aviso ya dijo qué
        // días no alcanzaron.
        sessionsPerWeek:
          modo === "DESPUES"
            ? Math.max(sessionsPerWeek, Math.trunc(elegida?.sesiones ?? colocadasDespues.get(discipline) ?? 0))
            : sessionsPerWeek,
        ...(elegida ? { proposito: elegida.proposito, importancia: elegida.importancia } : {}),
        ...(modo ? { modo } : {}),
        ...(elegida?.cardio ? { cardio: elegida.cardio } : {}),
      };
    }),
    diasActivos: [...new Set(ordenadas.map((sesion) => sesion.weekday))],
    presupuesto: ordenadas.filter((sesion) => !sesion.despues).length,
    acciones: entrada.secundarias.map((elegida) => {
      const modo = modoAplicado.get(elegida.discipline) ?? elegida.modo ?? "DIA_PROPIO";
      const nombre = nombreSecundaria(elegida.discipline);
      const minuscula = nombre.charAt(0).toLowerCase() + nombre.slice(1);
      return {
        discipline: elegida.discipline,
        modo,
        alternativa:
          modo === "DESPUES"
            ? { modo: "DIA_PROPIO" as const, texto: "Darle su propio día" }
            : { modo: "DESPUES" as const, texto: `Pegar ${minuscula} después de pesas` },
      };
    }),
    avisos,
  };
}

/**
 * El horario que entiende el generador, a partir del reparto.
 *
 * `trainingSchedule` guarda un momento del día por jornada; aquí solo se
 * distingue entrenar de descansar, porque a qué hora se entrena lo declara la
 * persona aparte y no debe reescribirse al replanificar.
 */
export function horarioDesde(
  replan: Replan,
  horaPreferida: string,
): Record<WeekDay, string> {
  const activos = new Set(replan.diasActivos);
  return Object.fromEntries(
    WEEK_DAYS.map((dia) => [dia, activos.has(dia) ? horaPreferida : "DESCANSO"]),
  ) as Record<WeekDay, string>;
}
