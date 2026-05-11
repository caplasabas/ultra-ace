export type SymbolKind =
  | 'SKULL'
  | 'SOMBRERO'
  | 'MARACAS'
  | 'TACO'
  | 'CHILLI'
  | 'ACE'
  | 'KING'
  | 'QUEEN'
  | 'JACK'
  | 'WILD'
  | 'SCATTER'
  | 'EMPTY'

export interface Symbol {
  kind: SymbolKind

  /* GOLD */
  isGold?: boolean
  goldTTL?: number
  goldMultiplier?: number

  isDecorativeGold?: boolean

  /* WILD */
  isWild?: boolean
  wildColor?: 'blue' | 'red'

  /* 🔑 UI-ONLY METADATA */
  fromGold?: boolean

  isScatterTerminal?: boolean
}
