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
  }

  limits: {
    maxPayout: number
    maxMultiplier: number
  }
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  mode: 'NORMAL',

  rtpProfile: {
    baseTarget: 0.82,
    freeTarget: 0.92,
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
      SCATTER: 0.06,
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
      SCATTER: 0.02,
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
      SCATTER: 0.02,
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
    refillChance: 0.025,
    freeInitialChance: 0.018,
    freeRefillChance: 0.055,
    redWildChance: 0.007,
    freeRedWildChance: 0.02,
  },

  joker: {
    min: 1,
    max: 4,
  },

  scatter: {
    baseAward: 10,
    retriggerAward: 5,
  },

  limits: {
    maxPayout: 2_000_000,
    maxMultiplier: 10_000,
  },
}
