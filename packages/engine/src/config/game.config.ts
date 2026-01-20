import { SymbolKind } from '../types/symbol'

export const GAME_CONFIG = {
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
