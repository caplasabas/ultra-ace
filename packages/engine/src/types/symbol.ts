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
  isGold?: boolean
  goldTTL?: number
}
