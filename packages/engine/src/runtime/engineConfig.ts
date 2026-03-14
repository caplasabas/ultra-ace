import { SymbolKind } from '../types/symbol.js'

export type EngineMode = 'NORMAL' | 'HAPPY_HOUR'

export interface EngineConfig {
  mode: EngineMode

  rtpProfile: {
    baseTarget: number
    freeTarget: number
  }

  reels: {
    reelsVisibleRows: number
    initialWeights: Partial<Record<SymbolKind, number>>
    initialWeightsFree: Partial<Record<SymbolKind, number>>
    refillWeights: Partial<Record<SymbolKind, number>>
    refillWeightsFree: Partial<Record<SymbolKind, number>>
  }

  caps: {
    reel: Partial<Record<SymbolKind, number>>
    column: Partial<Record<SymbolKind, number>>
  }

  cascades: {
    maxCascades: number
    multiplierLadderBase: number[]
    multiplierLadderFree: number[]
    maxSameSymbolPerReel: number
  }

  gold: {
    ttl: number
    initialChance: number
    refillChance: number
    freeInitialChance: number
    freeRefillChance: number
    naturalFreeInitialBoost: number
    naturalFreeRefillBoost: number
    redWildChance: number
    freeRedWildChance: number
  }

  joker: {
    min: number
    max: number
  }

  scatter: {
    baseAward: number
    retriggerAward: number
    teaseUpgradeChanceFrom1: number
    teaseUpgradeChanceFrom2: number
  }

  limits: {
    maxPayout: number
    maxMultiplier: number
  }
}

const NORMAL_BASE_TARGET_MIN = 0
const NORMAL_BASE_TARGET_MAX = 0.7
const NORMAL_FREE_TARGET_MIN = 0
const NORMAL_FREE_TARGET_MAX = 0.8

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function normalizeEngineConfig(config: EngineConfig): EngineConfig {
  if (config.mode !== 'NORMAL') return config

  return {
    ...config,
    rtpProfile: {
      baseTarget: clamp(config.rtpProfile.baseTarget, NORMAL_BASE_TARGET_MIN, NORMAL_BASE_TARGET_MAX),
      freeTarget: clamp(config.rtpProfile.freeTarget, NORMAL_FREE_TARGET_MIN, NORMAL_FREE_TARGET_MAX),
    },
  }
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  mode: 'NORMAL',

  rtpProfile: {
    baseTarget: 0.7,
    freeTarget: 0.8,
  },

  reels: {
    reelsVisibleRows: 4,
    initialWeights: {
      DIAMOND: 0.65,
      CLUB: 0.65,
      SPADE: 0.5,
      HEART: 0.5,

      J: 0.4,
      Q: 0.25,
      K: 0.15,
      A: 0.08,

      WILD: 0,
      SCATTER: 0.048,
    },
    initialWeightsFree: {
      SPADE: 0.9,
      HEART: 0.9,
      DIAMOND: 0.8,
      CLUB: 0.8,

      J: 0.3,
      Q: 0.18,
      K: 0.1,
      A: 0.05,

      WILD: 0,
      SCATTER: 0.0095,
    },
    refillWeights: {
      DIAMOND: 0.22,
      CLUB: 0.22,
      SPADE: 0.2,
      HEART: 0.2,

      J: 0.08,
      Q: 0.04,
      K: 0.025,
      A: 0.015,

      WILD: 0,
      SCATTER: 0,
    },
    refillWeightsFree: {
      SPADE: 0.9,
      HEART: 0.9,
      DIAMOND: 0.8,
      CLUB: 0.8,

      J: 0.3,
      Q: 0.18,
      K: 0.1,
      A: 0.05,

      WILD: 0,
      SCATTER: 0.031,
    },
  },

  caps: {
    reel: {
      A: 2,
      K: 3,
      Q: 3,
      J: 4,
      HEART: 4,
      SPADE: 4,
      CLUB: 4,
      DIAMOND: 5,
    },
    column: {
      A: 1,
      K: 1,
      Q: 1,
      J: 2,
      HEART: 1,
      SPADE: 2,
      CLUB: 2,
      DIAMOND: 2,
    },
  },

  cascades: {
    maxCascades: 100,
    multiplierLadderBase: [1, 2, 3, 5],
    multiplierLadderFree: [2, 4, 6, 10],
    maxSameSymbolPerReel: 20,
  },

  gold: {
    ttl: 0,
    initialChance: 0.012,
    refillChance: 0.02,
    freeInitialChance: 0.012,
    freeRefillChance: 0.038,
    naturalFreeInitialBoost: 1.2,
    naturalFreeRefillBoost: 1.28,
    redWildChance: 0.011,
    freeRedWildChance: 0.03,
  },

  joker: {
    min: 1,
    max: 4,
  },

  scatter: {
    baseAward: 10,
    retriggerAward: 5,
    teaseUpgradeChanceFrom1: 0,
    teaseUpgradeChanceFrom2: 0,
  },

  limits: {
    maxPayout: 2_000_000,
    maxMultiplier: 10_000,
  },
}

export const DEFAULT_ENGINE_HAPPY_HOUR: EngineConfig = {
  ...DEFAULT_ENGINE_CONFIG,

  mode: 'HAPPY_HOUR',

  rtpProfile: {
    baseTarget: 1.25,
    freeTarget: 1.58,
  },

  reels: {
    ...DEFAULT_ENGINE_CONFIG.reels,
    initialWeights: {
      DIAMOND: 0.55,
      CLUB: 0.55,
      SPADE: 0.42,
      HEART: 0.42,
      J: 0.48,
      Q: 0.32,
      K: 0.21,
      A: 0.125,
      WILD: 0,
      SCATTER: 0.084,
    },
    initialWeightsFree: {
      SPADE: 0.78,
      HEART: 0.78,
      DIAMOND: 0.68,
      CLUB: 0.68,
      J: 0.38,
      Q: 0.24,
      K: 0.145,
      A: 0.08,
      WILD: 0,
      SCATTER: 0.026,
    },
    refillWeightsFree: {
      SPADE: 0.78,
      HEART: 0.78,
      DIAMOND: 0.68,
      CLUB: 0.68,
      J: 0.38,
      Q: 0.24,
      K: 0.145,
      A: 0.08,
      WILD: 0,
      SCATTER: 0.026,
    },
  },

  caps: {
    reel: {
      ...DEFAULT_ENGINE_CONFIG.caps.reel,
    },
    column: {
      ...DEFAULT_ENGINE_CONFIG.caps.column,
    },
  },

  gold: {
    ...DEFAULT_ENGINE_CONFIG.gold,
    initialChance: 0.028,
    refillChance: 0.095,
    freeInitialChance: 0.13,
    freeRefillChance: 0.29,
    naturalFreeInitialBoost: 1.22,
    naturalFreeRefillBoost: 1.28,
    redWildChance: 0.016,
    freeRedWildChance: 0.06,
  },

  cascades: {
    ...DEFAULT_ENGINE_CONFIG.cascades,
    multiplierLadderBase: [1, 2, 3, 5],
    multiplierLadderFree: [2, 4, 6, 10],
  },

  scatter: {
    baseAward: 10,
    retriggerAward: 5,
    teaseUpgradeChanceFrom1: 0.02,
    teaseUpgradeChanceFrom2: 0.12,
  },
}
