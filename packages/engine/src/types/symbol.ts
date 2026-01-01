export type SymbolKind =
  | 'A'
  | 'K'
  | 'Q'
  | 'J'
  | 'SPADE'
  | 'HEART'
  | 'DIAMOND'
  | 'CLUB'
  | 'WILD'
  | 'SCATTER'
  | 'EMPTY'

export interface Symbol {
  kind: SymbolKind

  /* GOLD */
  isGold?: boolean
  goldTTL?: number

  /* WILD */
  isWild?: boolean
  wildColor?: 'blue' | 'red'

  /* 🔑 UI-ONLY METADATA */
  fromGold?: boolean
}
