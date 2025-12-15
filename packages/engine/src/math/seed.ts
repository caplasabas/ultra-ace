import { Symbol, SymbolKind } from '../types/symbol'
import { PAYLINES } from './paylines'
import { GAME_CONFIG } from '../config/game.config'

export function seedInitialWindow(window: Symbol[][], rng: () => number, activeLines: number) {
  if (rng() > GAME_CONFIG.seedChance) return

  const lineIndex = Math.floor(rng() * activeLines)
  const line = PAYLINES[lineIndex]
  if (!line) return

  const symbol = GAME_CONFIG.seedSymbols[
    Math.floor(rng() * GAME_CONFIG.seedSymbols.length)
  ] as SymbolKind

  // only seed first N reels
  for (let reel = 0; reel < GAME_CONFIG.seedReels; reel++) {
    const row = line[reel]
    window[reel][row] = { kind: symbol }
  }
}
