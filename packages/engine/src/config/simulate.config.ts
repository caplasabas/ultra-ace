import {
  DEFAULT_ENGINE_CONFIG,
  DEFAULT_ENGINE_HAPPY_HOUR,
  type EngineConfig,
} from '../runtime/engineConfig.js'

export const SIMULATION_CONFIG = {
  spins: 1_000_000,
  // spins: 100_000,
  betPerSpin: 60,
  lines: 5,
  // seed: 'ultra-ace-test',
  seed: Date.now().toString(),
}
// src/config/simulate.engine.config.ts

export const SIM_ENGINE_CONFIG: EngineConfig = {
  ...DEFAULT_ENGINE_CONFIG,
  mode: 'NORMAL',

  rtpProfile: {
    baseTarget: 0.82,
    freeTarget: 0.92,
  },

  cascades: {
    ...DEFAULT_ENGINE_CONFIG.cascades,
    maxCascades: 100,
  },

  limits: {
    ...DEFAULT_ENGINE_CONFIG.limits,
    maxPayout: 2_000_000,
  },
}

export const SIM_ENGINE_CONFIG_HAPPY_HOUR: EngineConfig = {
  ...DEFAULT_ENGINE_HAPPY_HOUR,

  mode: 'HAPPY_HOUR',
}
