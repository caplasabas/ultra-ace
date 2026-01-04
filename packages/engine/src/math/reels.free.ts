import { Symbol } from '../types/symbol.js'
import { buildReel } from './reelFactory.js'
import { REEL_WEIGHTS_FREE } from './reelWeights.js'

export const REELS_FREE: Symbol[][] = [
  buildReel(REEL_WEIGHTS_FREE),
  buildReel(REEL_WEIGHTS_FREE),
  buildReel(REEL_WEIGHTS_FREE),
  buildReel(REEL_WEIGHTS_FREE),
  buildReel(REEL_WEIGHTS_FREE),
]
