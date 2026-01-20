import { DEFAULT_ENGINE_CONFIG, type EngineConfig } from '../runtime/engineConfig.js'

export const SIMULATION_CONFIG = {
  // spins: 1_000_000,
  spins: 100_000,
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
  ...DEFAULT_ENGINE_CONFIG,

  mode: 'HAPPY_HOUR',

  rtpProfile: {
    baseTarget: 1.8,
    freeTarget: 1.9,
  },

  gold: {
    ...DEFAULT_ENGINE_CONFIG.gold,
    initialChance: 0.02,
    refillChance: 0.08,
    freeInitialChance: 0.12,
    freeRefillChance: 0.48,
  },

  cascades: {
    ...DEFAULT_ENGINE_CONFIG.cascades,
  },
}
