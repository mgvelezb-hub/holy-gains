import { fichaDe, esSuplemento, type FichaSuplemento, type ObjetivoSuplemento, type Supplement } from './suplementos.js';
import type { DietStyle, Phase } from './types.js';

/**
 * Sugerencias de suplementos — logica PURA.
 *
 * El motor propone, la persona decide. Una sugerencia solo existe si hay una
 * SENAL concreta en sus datos (un laboratorio, un sintoma del check-in, el
 * sueno del reloj, su entrenamiento), y viaja con el motivo, la evidencia, la
 * dosis del catalogo y lo que cambiaria. Sin senal, nada: un plan que empuja
 * productos deja de ser un plan.
 *
 * Reglas duras:
 *
 * - **Freno clinico primero.** Embarazo, lactancia, medicacion declarada o un
 *   laboratorio fuera del rango que imprimio el propio laboratorio (el mismo
 *   criterio de la Fase 8: no hay rangos nuestros) apagan todas las
 *   sugerencias y dejan una sola linea: consulta con tu medico. Los
 *   marcadores que ESTA capa sabe leer —vitamina D, ferritina, B12— no frenan:
 *   son la senal.
 * - **Maximo 3** a la vez, por prioridad (la senal mas fuerte primero).
 * - **Lo descartado no vuelve en 90 dias.** Lo que ya toma pasa a Tomas.
 */

export type Eleccion = 'acepto' | 'no_quiero' | 'ya_lo_tomo';
export interface EleccionRegistrada {
  eleccion: Eleccion;
  /** ISO `YYYY-MM-DD`; `null` en el formato viejo sin fecha. */
  fecha: string | null;
}
export type EleccionesSuplementos = Partial<Record<Supplement, EleccionRegistrada>>;

export type ObjetivoPerfil = 'RECOMPOSICION' | 'PERDIDA_GRASA' | 'GANANCIA_MUSCULO' | 'SALUD' | 'RENDIMIENTO';

export interface CheckInSenal {
  date: string;
  /** 1-5 */
  energy: number;
  /** 1-5 */
  hunger: number;
  satiety?: number | null;
  /** 1-5, lo declarado en el check-in. */
  sleep?: number | null;
  symptoms?: string[];
}

export interface DiaSalud {
  date: string;
  sleepMin?: number | null;
  restingHr?: number | null;
  hrvMs?: number | null;
  steps?: number | null;
  exerciseMin?: number | null;
}

export interface ValorLab {
  /** Fecha del estudio. */
  takenOn: string;
  key: string;
  value: number;
  refLow?: number | null;
  refHigh?: number | null;
}

export interface EntradaSugerencias {
  /** ISO `YYYY-MM-DD`: la regla de 90 dias y la vigencia de los laboratorios. */
  hoy: string;
  objetivo?: ObjetivoPerfil;
  fase: Phase;
  dieta?: DietStyle;
  pesoKg: number;
  diasFuerza: number;
  cardioMinSemana: number;
  /** La sesion de cardio mas larga de las ultimas dos semanas, si se sabe. */
  sesionCardioMaxMin?: number | null;
  /** Entrena por la manana (antes de las 12). */
  entrenaTemprano: boolean;
  proteinaObjetivoG?: number;
  kcalObjetivo?: number;
  /** Etiquetas de `Profile.conditions`. */
  condiciones?: string[];
  /** Lo que ya toma (`Profile.supplements`). */
  suplementos: string[];
  elecciones?: EleccionesSuplementos;
  /** Check-ins recientes, en cualquier orden: se usan los dos ultimos. */
  checkIns: CheckInSenal[];
  /** Dias del reloj: se usan los ultimos 14 antes de `hoy`. */
  healthDays: DiaSalud[];
  /** Valores de QUIMICA sanguinea. Se usa el mas reciente por llave, del ultimo ano. */
  labs: ValorLab[];
}

export interface Sugerencia {
  supplement: Supplement;
  nombre: string;
  motivo: string;
  evidencia: string;
  dosis: string;
  momento: string;
  /** 0-100: que tan fuerte es la senal. Ordena y decide cuales 3 entran. */
  prioridad: number;
  /** Lo que se esperaria ver, y en cuanto tiempo. */
  cambiaria: string;
  /** Id de la regla que la disparo. */
  regla: string;
  /** Linea de precaucion obligatoria (hierro, vitamina D muy baja). */
  aviso?: string;
}

export interface ResultadoSugerencias {
  /** Si hay freno clinico, la linea para la persona; si no, `null`. */
  freno: string | null;
  sugerencias: Sugerencia[];
  /** Lo que no es un suplemento pero importa mas: sueno, descarga, pedir estudios. */
  notas: string[];
}

export const MAX_SUGERENCIAS = 3;
export const DIAS_DESCARTE = 90;
export const MENSAJE_FRENO = 'Consulta con tu médico antes de agregar suplementos.';

/** Condiciones que apagan TODAS las sugerencias. */
const FRENOS_GLOBALES = ['embarazo', 'lactancia', 'medicacion'];

/** Umbrales. Cada uno con su fuente. */
const UMBRAL = {
  /** Endocrine Society (Holick 2011): < 20 deficiencia, 21-29 insuficiencia. */
  vitaminaDDeficiencia: 20,
  vitaminaDSuficiente: 30,
  /** Sin rango del laboratorio: < 30 ng/mL ya sugiere reservas bajas en la practica clinica. */
  ferritinaBaja: 30,
  /** NIH ODS: < 200 pg/mL es bajo. */
  b12Baja: 200,
  /** Horas de sueno promedio por debajo de las cuales el sueno es la prioridad. */
  suenoCortoH: 6.5,
  /** Noches minimas con dato para concluir algo del reloj. */
  nochesMinimas: 5,
  /** HRV: caida de 10 % entre la primera y la segunda semana. */
  hrvCaida: 0.9,
  /** FC en reposo: +3 lpm entre semanas. */
  fcSube: 3,
  pasosAltos: 15000,
  entrenoLargoMin: 75,
  cardioLargoMin: 45,
  /** kcal por debajo de las cuales la comida deja huecos de micronutrientes. */
  kcalBaja: 1600,
  /** FDA: 400 mg/dia de cafeina en adultos sanos. */
  cafeinaTopeMg: 400,
  cafeinaMgKg: 3,
};

const LABS_VITAMINA_D = ['vitamina_d', 'vit_d', '25oh', '25_oh', 'calcidiol'];
const LABS_FERRITINA = ['ferritina'];
const LABS_B12 = ['b12', 'cobalamina'];

function esMarcador(key: string, patrones: string[]): boolean {
  const k = key.toLowerCase();
  return patrones.some((p) => k.includes(p));
}

function esMarcadorPropio(key: string): boolean {
  return esMarcador(key, LABS_VITAMINA_D) || esMarcador(key, LABS_FERRITINA) || esMarcador(key, LABS_B12);
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000);
}

function media(valores: number[]): number | null {
  if (valores.length === 0) return null;
  return valores.reduce((a, b) => a + b, 0) / valores.length;
}

/** El valor mas reciente por llave, del ultimo ano. */
function labsVigentes(labs: ValorLab[], hoy: string): ValorLab[] {
  const porLlave = new Map<string, ValorLab>();
  for (const lab of labs) {
    const edad = diasEntre(lab.takenOn, hoy);
    if (edad < 0 || edad > 365) continue;
    const previo = porLlave.get(lab.key);
    if (!previo || previo.takenOn < lab.takenOn) porLlave.set(lab.key, lab);
  }
  return [...porLlave.values()];
}

function fueraDeRango(lab: ValorLab): boolean {
  if (lab.refLow !== null && lab.refLow !== undefined && lab.value < lab.refLow) return true;
  if (lab.refHigh !== null && lab.refHigh !== undefined && lab.value > lab.refHigh) return true;
  return false;
}

function buscaLab(labs: ValorLab[], patrones: string[]): ValorLab | undefined {
  return labs.filter((l) => esMarcador(l.key, patrones)).sort((a, b) => b.takenOn.localeCompare(a.takenOn))[0];
}

function redondea(valor: number, decimales = 1): number {
  const f = 10 ** decimales;
  return Math.round(valor * f) / f;
}

/** Lo que el reloj dice de las ultimas dos semanas. */
function senalesDelReloj(healthDays: DiaSalud[], hoy: string) {
  const ventana = healthDays
    .filter((d) => {
      const edad = diasEntre(d.date, hoy);
      return edad >= 1 && edad <= 14;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const noches = ventana.map((d) => d.sleepMin).filter((m): m is number => typeof m === 'number' && m > 0);
  const suenoMedioH = noches.length >= UMBRAL.nochesMinimas ? (media(noches) ?? 0) / 60 : null;

  const primera = ventana.filter((d) => diasEntre(d.date, hoy) > 7);
  const segunda = ventana.filter((d) => diasEntre(d.date, hoy) <= 7);
  const valores = (dias: DiaSalud[], campo: 'hrvMs' | 'restingHr') =>
    dias.map((d) => d[campo]).filter((v): v is number => typeof v === 'number' && v > 0);
  const hrv1 = valores(primera, 'hrvMs');
  const hrv2 = valores(segunda, 'hrvMs');
  const fc1 = valores(primera, 'restingHr');
  const fc2 = valores(segunda, 'restingHr');
  const recuperacionCae =
    hrv1.length >= 3 && hrv2.length >= 3 && fc1.length >= 3 && fc2.length >= 3
      ? media(hrv2)! <= media(hrv1)! * UMBRAL.hrvCaida && media(fc2)! >= media(fc1)! + UMBRAL.fcSube
      : false;

  const pasos = ventana.map((d) => d.steps).filter((v): v is number => typeof v === 'number' && v > 0);
  const pasosAltos = pasos.length >= UMBRAL.nochesMinimas && (media(pasos) ?? 0) >= UMBRAL.pasosAltos;
  const ejercicio = ventana.map((d) => d.exerciseMin).filter((v): v is number => typeof v === 'number' && v > 0);
  const entrenoLargo = ejercicio.length >= 3 && (media(ejercicio) ?? 0) >= UMBRAL.entrenoLargoMin;

  return { suenoMedioH, recuperacionCae, pasosAltos, entrenoLargo };
}

function objetivosDe(objetivo: ObjetivoPerfil | undefined): ObjetivoSuplemento[] {
  switch (objetivo) {
    case 'PERDIDA_GRASA':
      return ['bajar_grasa'];
    case 'GANANCIA_MUSCULO':
      return ['ganar_musculo'];
    case 'RECOMPOSICION':
      return ['bajar_grasa', 'ganar_musculo'];
    case 'RENDIMIENTO':
      return ['rendimiento'];
    case 'SALUD':
      return ['salud'];
    default:
      return [];
  }
}

interface Candidata {
  supplement: Supplement;
  prioridad: number;
  motivo: string;
  cambiaria: string;
  regla: string;
  dosis?: string;
  aviso?: string;
}

function descartadoVigente(registro: EleccionRegistrada | undefined, hoy: string): boolean {
  if (!registro || registro.eleccion !== 'no_quiero') return false;
  // Sin fecha (formato viejo) se respeta el descarte: preguntar de nuevo lo
  // que alguien ya rechazo es justo el empuje que se quiere evitar.
  if (!registro.fecha) return true;
  return diasEntre(registro.fecha, hoy) < DIAS_DESCARTE;
}

export function sugerirSuplementos(input: EntradaSugerencias): ResultadoSugerencias {
  const condiciones = new Set((input.condiciones ?? []).map((c) => c.toLowerCase()));
  const labs = labsVigentes(input.labs, input.hoy);

  // 1. Freno clinico: nada que sugerir, una sola linea.
  const frenoGlobal =
    FRENOS_GLOBALES.some((c) => condiciones.has(c)) ||
    labs.some((lab) => !esMarcadorPropio(lab.key) && fueraDeRango(lab));
  if (frenoGlobal) return { freno: MENSAJE_FRENO, sugerencias: [], notas: [] };

  const ultimos = [...input.checkIns].sort((a, b) => a.date.localeCompare(b.date)).slice(-2);
  const ultimo = ultimos[ultimos.length - 1];
  const sintomas = new Set(ultimos.flatMap((c) => c.symptoms ?? []));
  const reloj = senalesDelReloj(input.healthDays, input.hoy);

  const energiaBaja = ultimo !== undefined && ultimo.energy <= 2;
  const hambreAlta = ultimo !== undefined && ultimo.hunger >= 4;
  const suenoCorto =
    reloj.suenoMedioH !== null
      ? reloj.suenoMedioH < UMBRAL.suenoCortoH
      : ultimo?.sleep !== undefined && ultimo.sleep !== null && ultimo.sleep <= 2;
  const enCorte = input.fase === 'CUT' || input.fase === 'CUT_AGRESIVO';
  const keto = input.dieta === 'keto';
  const vegetariana = input.dieta === 'vegetariana';

  const candidatas: Candidata[] = [];
  const notas: string[] = [];
  const suma = (c: Candidata) => candidatas.push(c);

  // 2. Laboratorios: la senal mas fuerte.
  const vitD = buscaLab(labs, LABS_VITAMINA_D);
  if (vitD && vitD.value < UMBRAL.vitaminaDSuficiente) {
    const deficiencia = vitD.value < UMBRAL.vitaminaDDeficiencia;
    suma({
      supplement: 'VITAMINA_D3',
      prioridad: 90,
      regla: 'lab_vitamina_d',
      motivo: `Tu vitamina D salió en ${vitD.value} ng/mL: ${deficiencia ? 'deficiencia' : 'insuficiencia'} (menos de 30).`,
      dosis: deficiencia ? '4000 UI al día (el tope)' : '2000 UI al día',
      cambiaria: 'Llevarla a 30 ng/mL o más. Se ve en un estudio de control a las 8–12 semanas, no en la báscula.',
      ...(deficiencia ? { aviso: 'Con menos de 20 ng/mL, confirma la dosis con tu médico y repite el estudio.' } : {}),
    });
  }

  const ferritina = buscaLab(labs, LABS_FERRITINA);
  if (ferritina) {
    const limite = ferritina.refLow ?? UMBRAL.ferritinaBaja;
    if (ferritina.value < limite) {
      suma({
        supplement: 'HIERRO',
        prioridad: 95,
        regla: 'lab_ferritina',
        motivo: `Tu ferritina salió en ${ferritina.value}, por debajo de ${limite}: tus reservas de hierro están bajas.`,
        dosis: 'la que indique tu médico',
        cambiaria: 'Si las reservas bajas explican el cansancio, la energía mejora en semanas; se confirma con otra ferritina.',
        aviso: 'Consulta con tu médico antes de tomarlo: la causa de la ferritina baja y la dosis las define él.',
      });
    }
  }

  const b12 = buscaLab(labs, LABS_B12);
  if (b12 && b12.value < (b12.refLow ?? UMBRAL.b12Baja)) {
    suma({
      supplement: 'VITAMINA_B12',
      prioridad: 90,
      regla: 'lab_b12',
      motivo: `Tu B12 salió en ${b12.value}, por debajo del rango.`,
      cambiaria: 'Recuperar el nivel en semanas; se confirma con otro estudio. Si no sube, tu médico busca por qué no se absorbe.',
    });
  }

  // 3. Dieta.
  if (vegetariana) {
    suma({
      supplement: 'VITAMINA_B12',
      prioridad: 80,
      regla: 'dieta_vegetariana',
      motivo: 'Sin carne ni pescado, la B12 es lo que falta primero; huevo y lácteos no siempre alcanzan.',
      cambiaria: 'Nada que se sienta: previene una deficiencia que tarda años en notarse.',
    });
    suma({
      supplement: 'ZINC',
      prioridad: 40,
      regla: 'dieta_vegetariana',
      motivo: 'Sin carne se absorbe menos zinc por los fitatos de granos y leguminosas.',
      cambiaria: 'Cubrir lo que la dieta vegetariana deja corto. No se siente; se previene.',
    });
  }
  if (keto) {
    suma({
      supplement: 'ELECTROLITOS',
      prioridad: sintomas.has('dolor_cabeza') ? 85 : 60,
      regla: sintomas.has('dolor_cabeza') ? 'keto_dolor_cabeza' : 'dieta_keto',
      motivo: sintomas.has('dolor_cabeza')
        ? 'Dolor de cabeza en keto: casi siempre es sodio que se fue con el agua.'
        : 'En keto se pierde más sodio y agua, sobre todo las primeras semanas.',
      cambiaria: 'Menos dolor de cabeza y fatiga en 2–3 días si esa era la causa.',
    });
    suma({
      supplement: 'MAGNESIO',
      prioridad: 45,
      regla: 'dieta_keto',
      motivo: 'Keto deja fuera leguminosas y granos, que son de las fuentes grandes de magnesio.',
      cambiaria: 'Cubrir lo que la dieta deja corto; menos calambres si eran por eso.',
    });
  }

  // 4. Check-in.
  if (sintomas.has('calambres')) {
    suma({
      supplement: 'MAGNESIO',
      prioridad: 60,
      regla: 'calambres',
      motivo: 'Marcaste calambres en tu check-in.',
      cambiaria: 'Si la causa es ingesta baja o sudor, menos calambres en 1–2 semanas. Si siguen, no es esto.',
    });
    if (input.cardioMinSemana >= 90 || keto || reloj.pasosAltos) {
      suma({
        supplement: 'ELECTROLITOS',
        prioridad: 55,
        regla: 'calambres',
        motivo: 'Calambres con mucho sudor: se va sodio, no solo agua.',
        cambiaria: 'Menos calambres en las sesiones largas.',
      });
    }
  }
  if (sintomas.has('estrenimiento')) {
    suma({
      supplement: 'FIBRA',
      prioridad: 75,
      regla: 'estrenimiento',
      motivo: 'Marcaste estreñimiento en tu check-in.',
      cambiaria: 'Ir al baño con regularidad en 1–2 semanas, siempre con más agua: 250 ml con cada toma y 2–3 L en el día.',
    });
  }
  if (sintomas.has('inflamacion_abdominal') && ultimos.length >= 2 && ultimos.every((c) => (c.symptoms ?? []).includes('inflamacion_abdominal'))) {
    suma({
      supplement: 'PROBIOTICO',
      prioridad: 20,
      regla: 'distension',
      motivo: 'Dos check-ins seguidos con inflamación abdominal.',
      cambiaria: 'Una prueba de 4 semanas: si la distensión no cambia, se deja.',
    });
  }
  if (hambreAlta && enCorte) {
    suma({
      supplement: 'FIBRA',
      prioridad: 55,
      regla: 'hambre_cut',
      motivo: 'Hambre alta en corte: la fibra con agua antes de comer ocupa espacio sin calorías.',
      cambiaria: 'Menos hambre entre comidas en la primera semana.',
    });
    const tieneWhey = input.suplementos.includes('WHEY');
    if (!tieneWhey && (input.proteinaObjetivoG ?? 0) >= 150) {
      suma({
        supplement: 'WHEY',
        prioridad: 50,
        regla: 'hambre_cut',
        motivo: `Hambre alta y ${Math.round(input.proteinaObjetivoG!)} g de proteína al día: el polvo facilita llegar y la proteína es lo que más sacia.`,
        cambiaria: 'Llegar a tu proteína sin forzar otra porción de carne; menos hambre de tarde.',
      });
    }
  }

  // 5. Reloj.
  if (suenoCorto) {
    const horas = reloj.suenoMedioH !== null ? `${redondea(reloj.suenoMedioH)} h en promedio` : 'mal dormir en tu check-in';
    const extra = energiaBaja ? 10 : 0;
    suma({
      supplement: 'MAGNESIO',
      prioridad: 65 + extra,
      regla: 'sueno_corto',
      motivo: `Duermes poco: ${horas}.`,
      cambiaria: 'Apoyo modesto para conciliar; lo que mueve la aguja es la hora fija de dormir.',
    });
    suma({
      supplement: 'MELATONINA',
      prioridad: 50 + extra,
      regla: 'sueno_corto',
      motivo: `Duermes poco (${horas}) y dormirte cuesta.`,
      cambiaria: 'Conciliar unos minutos antes. No alarga el sueño si te acuestas tarde.',
    });
    notas.push('Primero el sueño: misma hora de dormir, cuarto oscuro y nada de pantalla la última media hora. Ningún suplemento compensa dormir menos de 6.5 h.');
  }
  if (reloj.recuperacionCae) {
    suma({
      supplement: 'ASHWAGANDHA',
      prioridad: 45,
      regla: 'hrv_fc',
      motivo: 'Tu variabilidad cardiaca bajó y tu pulso en reposo subió en dos semanas: señal de estrés acumulado.',
      cambiaria: 'Opcional, por 8 semanas: menos estrés percibido. No sustituye descansar.',
    });
    notas.push('Tu reloj marca fatiga acumulada: considera una semana de descarga (menos series, mismo peso) antes de apretar más.');
  }
  if (reloj.pasosAltos || reloj.entrenoLargo) {
    suma({
      supplement: 'ELECTROLITOS',
      prioridad: 50,
      regla: 'actividad_alta',
      motivo: reloj.pasosAltos ? 'Caminas más de 15 mil pasos al día.' : 'Tus sesiones pasan de hora y cuarto.',
      cambiaria: 'Mejor rendimiento al final de la sesión y menos dolor de cabeza posterior.',
    });
  }
  if ((input.sesionCardioMaxMin ?? 0) > UMBRAL.cardioLargoMin) {
    suma({
      supplement: 'ELECTROLITOS',
      prioridad: 55,
      regla: 'cardio_largo',
      motivo: 'Tu cardio pasa de 45 minutos: con calor o mucho sudor se va sodio.',
      cambiaria: 'Terminar el cardio sin bajón ni dolor de cabeza.',
    });
  }

  // 6. Entrenamiento.
  if (input.diasFuerza >= 4) {
    suma({
      supplement: 'CREATINA',
      prioridad: 70,
      regla: 'fuerza_4',
      motivo: `Entrenas fuerza ${input.diasFuerza} días por semana.`,
      cambiaria: 'Una o dos repeticiones más en las series pesadas en 3–4 semanas. Sube 1–2 kg de agua en el músculo: no es grasa.',
    });
  }
  if (input.entrenaTemprano && !suenoCorto) {
    const mg = Math.min(Math.round((UMBRAL.cafeinaMgKg * input.pesoKg) / 10) * 10, UMBRAL.cafeinaTopeMg);
    suma({
      supplement: 'CAFEINA',
      prioridad: 30,
      regla: 'entreno_manana',
      motivo: 'Entrenas por la mañana: la cafeína rinde y aún da tiempo de que se vaya antes de dormir.',
      dosis: `${mg} mg (3 mg/kg, tope ${UMBRAL.cafeinaTopeMg} mg al día contando el café)`,
      cambiaria: 'Algo más de rendimiento en la sesión. Opcional: el café cuenta igual.',
    });
  }
  if ((input.kcalObjetivo !== undefined && input.kcalObjetivo < UMBRAL.kcalBaja) || input.fase === 'CUT_AGRESIVO') {
    suma({
      supplement: 'MULTIVITAMINICO',
      prioridad: 25,
      regla: 'kcal_baja',
      motivo: 'Comes poco en esta fase: con menos comida es más fácil que falte algún micronutriente.',
      cambiaria: 'Cubrir huecos mientras dure el corte. No se siente; se previene.',
    });
  }

  // Energia baja: no es un suplemento, es una pregunta.
  if (energiaBaja) {
    const tieneLabs = buscaLab(labs, LABS_FERRITINA) || buscaLab(labs, LABS_VITAMINA_D);
    if (!tieneLabs) {
      notas.push('Energía baja: vale pedir ferritina y vitamina D en tu próximo estudio antes de suplementar a ciegas.');
    }
  }

  // 7. Filtrar, desempatar y recortar.
  const elecciones = input.elecciones ?? {};
  const tomando = new Set(input.suplementos);
  for (const [id, registro] of Object.entries(elecciones)) {
    if (registro && (registro.eleccion === 'acepto' || registro.eleccion === 'ya_lo_tomo')) tomando.add(id);
  }
  const frenosDinamicos = new Set<string>();
  if (suenoCorto) frenosDinamicos.add('sueno_corto');
  if (!input.entrenaTemprano) frenosDinamicos.add('entreno_tarde');

  const objetivos = objetivosDe(input.objetivo);
  const mejor = new Map<Supplement, Candidata>();
  for (const c of candidatas) {
    const previa = mejor.get(c.supplement);
    if (!previa || c.prioridad > previa.prioridad) mejor.set(c.supplement, c);
  }

  const sugerencias: Sugerencia[] = [];
  for (const c of mejor.values()) {
    const ficha = fichaDe(c.supplement) as FichaSuplemento;
    if (tomando.has(c.supplement)) continue;
    if (descartadoVigente(elecciones[c.supplement], input.hoy)) continue;
    if (ficha.frenos.some((f) => condiciones.has(f) || frenosDinamicos.has(f))) continue;
    const afin = ficha.objetivos.some((o) => objetivos.includes(o)) ? 5 : 0;
    sugerencias.push({
      supplement: c.supplement,
      nombre: ficha.nombre,
      motivo: c.motivo,
      evidencia: ficha.evidencia,
      dosis: c.dosis ?? ficha.dosisTexto,
      momento: ficha.momento,
      prioridad: c.prioridad + afin,
      cambiaria: c.cambiaria,
      regla: c.regla,
      ...(c.aviso ? { aviso: c.aviso } : {}),
    });
  }

  sugerencias.sort((a, b) => b.prioridad - a.prioridad || a.supplement.localeCompare(b.supplement));
  return { freno: null, sugerencias: sugerencias.slice(0, MAX_SUGERENCIAS), notas };
}

// ---------------------------------------------------------------------------
// Elecciones guardadas en `Profile.supplementChoices`
// ---------------------------------------------------------------------------

const ELECCIONES: readonly Eleccion[] = ['acepto', 'no_quiero', 'ya_lo_tomo'];

function esEleccion(valor: unknown): valor is Eleccion {
  return typeof valor === 'string' && (ELECCIONES as readonly string[]).includes(valor);
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/**
 * Lee `supplementChoices`. Acepta el formato viejo (`"MAGNESIO": "no_quiero"`)
 * y el nuevo con fecha (`{ eleccion, fecha }`), que es el que permite que un
 * descarte caduque a los 90 dias. Las llaves con `_` son preferencias, no
 * suplementos.
 */
export function parseElecciones(json: unknown): { elecciones: EleccionesSuplementos } {
  const elecciones: EleccionesSuplementos = {};
  if (!esObjeto(json)) return { elecciones };
  for (const [llave, valor] of Object.entries(json)) {
    if (!esSuplemento(llave)) continue;
    if (esEleccion(valor)) {
      elecciones[llave] = { eleccion: valor, fecha: null };
    } else if (esObjeto(valor) && esEleccion(valor.eleccion)) {
      elecciones[llave] = {
        eleccion: valor.eleccion,
        fecha: typeof valor.fecha === 'string' ? valor.fecha : null,
      };
    }
  }
  return { elecciones };
}

/** El JSON nuevo con la eleccion registrada hoy; lo demas queda intacto. */
export function registraEleccion(
  json: unknown,
  supplement: Supplement,
  eleccion: Eleccion,
  hoy: string,
): Record<string, unknown> {
  const base = esObjeto(json) ? { ...json } : {};
  base[supplement] = { eleccion, fecha: hoy };
  return base;
}
