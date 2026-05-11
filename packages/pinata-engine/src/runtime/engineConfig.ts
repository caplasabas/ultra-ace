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
    multiplierChance: number
    multiplierValues: number[]
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
    extraAwardPerScatter: number
    teaseUpgradeChanceFrom1: number
    teaseUpgradeChanceFrom2: number
  }

  limits: {
    maxPayout: number
    maxWinMultiplier: number
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
      baseTarget: clamp(
        config.rtpProfile.baseTarget,
        NORMAL_BASE_TARGET_MIN,
        NORMAL_BASE_TARGET_MAX,
      ),
      freeTarget: clamp(
        config.rtpProfile.freeTarget,
        NORMAL_FREE_TARGET_MIN,
        NORMAL_FREE_TARGET_MAX,
      ),
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
    reelsVisibleRows: 3,
    initialWeights: {
      CHILLI: 0.7,
      JACK: 0.68,
      QUEEN: 0.66,
      KING: 0.64,
      ACE: 0.62,
      TACO: 0.46,
      MARACAS: 0.34,
      SOMBRERO: 0.2,
      SKULL: 0.11,
      WILD: 0,
      SCATTER: 0.09,
    },
    initialWeightsFree: {
      CHILLI: 0.7,
      JACK: 0.66,
      QUEEN: 0.64,
      KING: 0.62,
      ACE: 0.6,
      TACO: 0.48,
      MARACAS: 0.36,
      SOMBRERO: 0.23,
      SKULL: 0.13,
      WILD: 0,
      SCATTER: 0.04,
    },
    refillWeights: {
      CHILLI: 0.7,
      JACK: 0.68,
      QUEEN: 0.66,
      KING: 0.64,
      ACE: 0.62,
      TACO: 0.46,
      MARACAS: 0.34,
      SOMBRERO: 0.2,
      SKULL: 0.11,
      WILD: 0,
      SCATTER: 0,
    },
    refillWeightsFree: {
      CHILLI: 0.7,
      JACK: 0.66,
      QUEEN: 0.64,
      KING: 0.62,
      ACE: 0.6,
      TACO: 0.48,
      MARACAS: 0.36,
      SOMBRERO: 0.23,
      SKULL: 0.13,
      WILD: 0,
      SCATTER: 0.012,
    },
  },

  caps: {
    reel: {
      SKULL: 1,
      SOMBRERO: 1,
      MARACAS: 2,
      TACO: 2,
      CHILLI: 3,
      ACE: 2,
      KING: 2,
      QUEEN: 2,
      JACK: 2,
    },
    column: {
      SKULL: 1,
      SOMBRERO: 1,
      MARACAS: 1,
      TACO: 1,
      CHILLI: 2,
      ACE: 1,
      KING: 1,
      QUEEN: 1,
      JACK: 1,
    },
  },

  cascades: {
    maxCascades: 100,
    multiplierLadderBase: [1],
    multiplierLadderFree: [1],
    maxSameSymbolPerReel: 20,
  },

  gold: {
    ttl: 0,
    initialChance: 0.035,
    refillChance: 0.06,
    freeInitialChance: 0.08,
    freeRefillChance: 0.14,
    naturalFreeInitialBoost: 1.2,
    naturalFreeRefillBoost: 1.28,
    multiplierChance: 0.35,
    multiplierValues: [2, 3, 5, 10, 25, 50, 100],
    redWildChance: 0,
    freeRedWildChance: 0,
  },

  joker: {
    min: 1,
    max: 4,
  },

  scatter: {
    baseAward: 15,
    retriggerAward: 15,
    extraAwardPerScatter: 2,
    teaseUpgradeChanceFrom1: 0,
    teaseUpgradeChanceFrom2: 0,
  },

  limits: {
    maxPayout: 2_000_000,
    maxWinMultiplier: 5_000,
    maxMultiplier: 10_000,
  },
}

export const DEFAULT_ENGINE_HAPPY_HOUR: EngineConfig = {
  ...DEFAULT_ENGINE_CONFIG,

  mode: 'HAPPY_HOUR',

  rtpProfile: {
    baseTarget: 1.7,
    freeTarget: 2.15,
  },

  reels: {
    ...DEFAULT_ENGINE_CONFIG.reels,
    initialWeights: {
      CHILLI: 0.7,
      JACK: 0.74,
      QUEEN: 0.72,
      KING: 0.7,
      ACE: 0.68,
      TACO: 0.56,
      MARACAS: 0.44,
      SOMBRERO: 0.3,
      SKULL: 0.18,
      WILD: 0,
      SCATTER: 0.045,
    },
    initialWeightsFree: {
      CHILLI: 0.7,
      JACK: 0.72,
      QUEEN: 0.7,
      KING: 0.68,
      ACE: 0.66,
      TACO: 0.58,
      MARACAS: 0.46,
      SOMBRERO: 0.33,
      SKULL: 0.2,
      WILD: 0,
      SCATTER: 0.016,
    },
    refillWeights: {
      CHILLI: 0.7,
      JACK: 0.74,
      QUEEN: 0.72,
      KING: 0.7,
      ACE: 0.68,
      TACO: 0.56,
      MARACAS: 0.44,
      SOMBRERO: 0.3,
      SKULL: 0.18,
      WILD: 0,
      SCATTER: 0.012,
    },
    refillWeightsFree: {
      CHILLI: 0.7,
      JACK: 0.72,
      QUEEN: 0.7,
      KING: 0.68,
      ACE: 0.66,
      TACO: 0.58,
      MARACAS: 0.46,
      SOMBRERO: 0.33,
      SKULL: 0.2,
      WILD: 0,
      SCATTER: 0.016,
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
    initialChance: 0.075,
    refillChance: 0.22,
    freeInitialChance: 0.18,
    freeRefillChance: 0.36,
    naturalFreeInitialBoost: 1.34,
    naturalFreeRefillBoost: 1.46,
    multiplierChance: 0.4,
    multiplierValues: [2, 3, 5, 10, 25, 50, 100],
    redWildChance: 0,
    freeRedWildChance: 0,
  },

  cascades: {
    ...DEFAULT_ENGINE_CONFIG.cascades,
    multiplierLadderBase: [1, 2, 4, 6, 9],
    multiplierLadderFree: [2, 4, 7, 10, 14],
  },

  joker: {
    min: 2,
    max: 6,
  },

  scatter: {
    baseAward: 15,
    retriggerAward: 15,
    extraAwardPerScatter: 2,
    teaseUpgradeChanceFrom1: 0.01,
    teaseUpgradeChanceFrom2: 0.05,
  },
}
