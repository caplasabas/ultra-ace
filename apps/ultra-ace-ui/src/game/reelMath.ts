import type { Symbol } from '@ultra-ace/engine'
import type { UISymbol } from '@game/types'

export function engineSymbolToUISymbol(symbol: Symbol): UISymbol {
  return symbol.kind
}
