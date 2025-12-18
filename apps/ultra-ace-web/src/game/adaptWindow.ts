import type { Symbol as EngineSymbol } from '@ultra-ace/engine'
import type { UISymbol } from '../ui/Reel'

export function adaptWindow(
  window: EngineSymbol[][],
  previousWindow?: EngineSymbol[][],
): UISymbol[][] {
  return window.map((col, reelIndex) =>
    col.map((symbol, row) => {
      const prev = previousWindow?.[reelIndex]?.[row]

      return {
        id: `${reelIndex}-${row}-${symbol.kind}`,
        kind: symbol.kind,

        // ✅ NEW if:
        // - no previous window (initial spin)
        // - OR symbol kind changed (cascade drop)
        isNew: !prev || prev.kind !== symbol.kind,
      }
    }),
  )
}
