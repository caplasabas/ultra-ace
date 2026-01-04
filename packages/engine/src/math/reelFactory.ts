import { Symbol } from '../types/symbol.js'
import { REEL_WEIGHTS } from './reelWeights.js'

export function buildReel(weights = REEL_WEIGHTS): Symbol[] {
  const reel: Symbol[] = []

  for (const [kind, count] of Object.entries(weights)) {
    for (let i = 0; i < count; i++) {
      reel.push({ kind } as Symbol)
    }
  }

  return shuffle(reel)
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5)
}
