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
export {
  generateMenu,
  prepMinDelDia,
  equivalenciasDeAlimento,
  listaDeSuper,
  type MenuOptions,
} from './menu.js';
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
  esSuplemento,
  fichaDe,
  pautasDeSuplementos,
  permitePolvos,
  type AnclaSuplemento,
  type CategoriaSuplemento,
  type FichaSuplemento,
  type ObjetivoSuplemento,
  type PautaSuplemento,
  type Supplement,
} from './suplementos.js';
export { runBacktest, type BacktestReport, type BacktestWeek } from './backtest.js';
