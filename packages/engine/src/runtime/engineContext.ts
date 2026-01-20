import { buildReel } from '../math/reelFactory.js'
import { EngineConfig } from './engineConfig.js'
import { Symbol } from '../types/symbol.js'

let CURRENT_CONFIG: EngineConfig | null = null
let CONFIG_VERSION: string | null = null
let INITIALIZED = false

let REELS_CACHE: {
  base: Symbol[][]
  free: Symbol[][]
  version: string
} = {
  base: [],
  free: [],
  version: 'V1',
}

export function initEngine(config: EngineConfig, version: string) {
  CURRENT_CONFIG = Object.freeze(config)
  CONFIG_VERSION = version
  INITIALIZED = true
}

export function updateEngineConfig(config: EngineConfig, version: string) {
  if (!INITIALIZED) {
    throw new Error('Engine not initialized')
  }
  CURRENT_CONFIG = Object.freeze(config)
  CONFIG_VERSION = version
}

export function getEngineConfig(): EngineConfig {
  if (!INITIALIZED || !CURRENT_CONFIG) {
    throw new Error('Engine not initialized')
  }
  return CURRENT_CONFIG
}

export function getEngineVersion() {
  return CONFIG_VERSION
}

export function getReels(cfg: EngineConfig, version: string, rng: () => number) {
  if (REELS_CACHE.version !== version) {
    REELS_CACHE = {
      version,
      base: Array.from({ length: 5 }, () => buildReel(cfg.reels.initialWeights, rng)),
      free: Array.from({ length: 5 }, () => buildReel(cfg.reels.initialWeightsFree, rng)),
    }
  }

  return REELS_CACHE
}
