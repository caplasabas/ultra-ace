import { Symbol } from '../types/symbol.js'

const REEL_SIZE = 1000

export function buildReel(weights: Record<string, number>, rng: () => number): Symbol[] {
  const reel: Symbol[] = []

  const total = Object.values(weights).reduce((a, b) => a + b, 0)

  for (const [kind, weight] of Object.entries(weights)) {
    const count = Math.floor((weight / total) * REEL_SIZE)
    for (let i = 0; i < count; i++) {
      reel.push({ kind } as Symbol)
    }
  }

  return shuffle(reel, rng)
}

function shuffle<T>(arr: T[], rng = Math.random): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
