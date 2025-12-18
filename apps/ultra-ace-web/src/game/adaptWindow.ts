import type { Symbol as EngineSymbol } from '@ultra-ace/engine'
import type { UISymbol } from '../ui/Reel'

interface RemovedPosition {
  reel: number
  row: number
}

export function adaptWindow(
  window: EngineSymbol[][],
  removedPositions?: RemovedPosition[] | undefined,
): UISymbol[][] {
  const removedSet = new Set(
    removedPositions?.map(p => `${p.reel}-${p.row}`) ?? [],
  )

  return window.map((col, reelIndex) =>
    col.map((symbol, row) => ({
      id: `${reelIndex}-${row}-${symbol.kind}`,
      kind: symbol.kind,

      // ✅ ONLY these positions animate during cascadeRefill
      isNew: removedSet.has(`${reelIndex}-${row}`),
    })),
  )
}
