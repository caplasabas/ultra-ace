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

export type Symbol = {
  kind: SymbolKind
}
