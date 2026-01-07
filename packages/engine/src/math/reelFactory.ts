import { Symbol } from '../types/symbol.js'
import { REEL_WEIGHTS } from './reelWeights.js'

const REEL_SIZE = 1000

export function buildReel(weights: Record<string, number> = REEL_WEIGHTS): Symbol[] {
  const reel: Symbol[] = []

  const total = Object.values(weights).reduce((a, b) => a + b, 0)

  for (const [kind, weight] of Object.entries(weights)) {
    const count = Math.floor((weight / total) * REEL_SIZE)
    for (let i = 0; i < count; i++) {
      reel.push({ kind } as Symbol)
    }
  }

  return shuffle(reel)
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5)
}
