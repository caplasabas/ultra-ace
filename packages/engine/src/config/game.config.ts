import { SymbolKind } from '../types/symbol'

export const GAME_CONFIG = {
  reelsVisibleRows: 4,
  maxLines: 5,

  maxCascades: 100,

  multiplierLadderBase: [1, 2, 3, 5],
  multiplierLadderFree: [2, 4, 6, 10],
  freeSpinsAwarded: 10,

  cascadeFillPool: [
    { kind: 'A' },
    { kind: 'K' },
    { kind: 'Q' },
    { kind: 'J' },
    { kind: 'SPADE' },
    { kind: 'HEART' },
    { kind: 'DIAMOND' },
    { kind: 'CLUB' },
  ] satisfies { kind: SymbolKind }[],

  devForceScatterChance: 0,
}
