export type LineSymbol =
  | 'A'
  | 'K'
  | 'Q'
  | 'J'
  | '10'
  | '9'
  | 'LOW'
  | 'WILD'

export type ScatterSymbol = 'SCATTER'

export type Symbol = LineSymbol | ScatterSymbol
