export * from './types.js';
export {
  ConfigSchema,
  DEFAULT_CONFIG,
  EngineConfigError,
  assertDeficitInRange,
  deficitRange,
  loadConfig,
  pickDeficit,
  type ConfigOverrides,
  type EngineConfig,
} from './config.js';
export {
  bmrMifflin,
  clamp,
  deficitForKcal,
  energyBase,
  kcalFloor,
  kcalForDeficit,
  leanMass,
  macrosFor,
  pal,
  roundTo,
  tdee,
  withRefeedCarbs,
} from './calc.js';
export {
  atPhaseCap,
  deeperPhase,
  emptySignals,
  maxWeeksFor,
  nextPhase,
  phaseAfterCap,
  type PhaseSignals,
  type PhaseTransition,
} from './phases.js';
export { decide, decideAll, weeksBetween, type DecideOptions } from './adjust.js';
export { NO_DENSE_CARB_PHASES, distribute } from './meals.js';
export { MENU_ENGINE_VERSION } from './version.js';
export {
  generateMenu,
  prepMinDelDia,
  equivalenciasDeAlimento,
  listaDeSuper,
  opcionesDePlatillo,
  cambiarPlatillo,
  maxGrams,
  type CambioDePlatilloInput,
  type MenuOptions,
  type OpcionDePlatillo,
} from './menu.js';
export { familiaDe, type FamiliaPrincipal } from './familias.js';
export {
  FOODS,
  buscaAlimentos,
  catalogoCon,
  findFood,
  foodsByRole,
  matchesAny,
  normalize,
  terminosDeBusqueda,
} from './foods.js';
export { PREPARACIONES } from './preparaciones.js';
export {
  CATALOGO_SUPLEMENTOS,
  SUPPLEMENTS,
  dosisCafeinaMg,
  esSuplemento,
  fichaDe,
  pautasDeSuplementos,
  permitePolvos,
  resumenTomas,
  tomasDeHoy,
  type AnclaSuplemento,
  type CategoriaSuplemento,
  type FichaSuplemento,
  type ObjetivoSuplemento,
  type PautaSuplemento,
  type Supplement,
  type TomaDelDia,
} from './suplementos.js';
export {
  DIAS_DESCARTE,
  MAX_SUGERENCIAS,
  MENSAJE_FRENO,
  fijaInfusiones,
  parseElecciones,
  registraEleccion,
  sugerirSuplementos,
  type CheckInSenal,
  type DiaSalud,
  type Eleccion,
  type EleccionRegistrada,
  type EleccionesSuplementos,
  type EntradaSugerencias,
  type ObjetivoPerfil,
  type ResultadoSugerencias,
  type Sugerencia,
  type ValorLab,
} from './sugerencias-suplementos.js';
export { runBacktest, type BacktestReport, type BacktestWeek } from './backtest.js';
