import { SymbolKind } from '../types/symbol'

export const GAME_CONFIG = {
  cascadeFillPool: [
    { kind: 'SKULL' },
    { kind: 'SOMBRERO' },
    { kind: 'MARACAS' },
    { kind: 'TACO' },
    { kind: 'CHILLI' },
    { kind: 'A' },
    { kind: 'K' },
    { kind: 'Q' },
    { kind: 'J' },
  ] satisfies { kind: SymbolKind }[],

  devForceScatterChance: 0,
}
