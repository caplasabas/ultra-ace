import { Symbol } from '../types/symbol'

export const GAME_CONFIG = {
  reelsVisibleRows: 4,
  maxLines: 20,
  maxCascades: 10,

  multiplierLadder: [1, 1.5, 2.25, 3],

  seedChance: 0.14,
  seedReels: 3,
  seedSymbols: ['A', 'K', 'Q', 'J'] as const,

  cascadeFillPool: [
    { kind: 'SPADE' },
    { kind: 'HEART' },
    { kind: 'DIAMOND' },
    { kind: 'CLUB' },
    { kind: 'J' },
    { kind: 'Q' },
  ] satisfies Symbol[],
}
