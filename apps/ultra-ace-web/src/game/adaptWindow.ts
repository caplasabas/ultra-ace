import type { Symbol as EngineSymbol } from '@ultra-ace/engine'
import type { UISymbol } from '../ui/Reel'

interface RemovedPosition {
  reel: number
  row: number
}

export function adaptWindow(
  window: EngineSymbol[][],
  removedPositions?: RemovedPosition[],
  previousWindow?: EngineSymbol[][],
): UISymbol[][] {
  const removedSet = new Set(removedPositions?.map(p => `${p.reel}-${p.row}`) ?? [])

  return window.map((col, reelIndex) =>
    col.map((symbol, row) => {
      const prev = previousWindow?.[reelIndex]?.[row]

      const goldToWild = prev?.isGold === true && prev.kind !== 'WILD' && symbol.kind === 'WILD'

      return {
        id: `${reelIndex}-${row}`,

        // 🔒 LOCKED VISUAL KIND
        // BACK stays BACK through the entire flip
        kind: goldToWild ? 'BACK' : symbol.kind,

        isNew: removedSet.has(`${reelIndex}-${row}`),

        // GOLD never returns after BACK
        isGold: symbol.isGold === true && !goldToWild,
        goldTTL: symbol.goldTTL,

        // 🔑 metadata only
        goldToWild,
        wildColor: symbol.wildColor,
      }
    }),
  )
}
