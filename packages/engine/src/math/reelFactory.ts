import { Symbol } from '../types/symbol'
import { REEL_WEIGHTS } from './reelWeights'

export function buildReel(): Symbol[] {
  const reel: Symbol[] = []

  for (const [kind, count] of Object.entries(REEL_WEIGHTS)) {
    for (let i = 0; i < count; i++) {
      reel.push({ kind } as Symbol)
    }
  }

  return shuffle(reel)
}

function shuffle<T>(arr: T[]): T[] {
  return [...arr].sort(() => Math.random() - 0.5)
}
