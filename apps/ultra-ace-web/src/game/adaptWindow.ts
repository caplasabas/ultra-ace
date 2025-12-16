import type { Symbol as EngineSymbol } from '@ultra-ace/engine'
import type { UISymbol } from '../ui/Reel'

export function adaptWindow(
  window: EngineSymbol[][],
  previousWindow?: EngineSymbol[][],
): UISymbol[][] {
  const isFirst = !previousWindow

  return window.map((col, reelIndex) =>
    col.map((symbol, row) => {
      const prevSymbol = previousWindow?.[reelIndex]?.[row]

      return {
        id: `${reelIndex}-${row}`,
        kind: symbol.kind,
        isNew: isFirst || prevSymbol?.kind !== symbol.kind,
      }
    }),
  )
}
