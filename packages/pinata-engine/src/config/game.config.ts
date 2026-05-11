import { SymbolKind } from '../types/symbol'

export const GAME_CONFIG = {
  cascadeFillPool: [
    { kind: 'SKULL' },
    { kind: 'SOMBRERO' },
    { kind: 'MARACAS' },
    { kind: 'TACO' },
    { kind: 'CHILLI' },
    { kind: 'ACE' },
    { kind: 'KING' },
    { kind: 'QUEEN' },
    { kind: 'JACK' },
  ] satisfies { kind: SymbolKind }[],

  devForceScatterChance: 0,
}
