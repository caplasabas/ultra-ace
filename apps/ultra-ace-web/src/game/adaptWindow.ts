import type { Symbol as EngineSymbol } from '@ultra-ace/engine'
import type { UISymbol } from '../ui/Reel'
import type { CascadePhase } from '../hooks/useCascadeTimeline'

interface RemovedPosition {
  reel: number
  row: number
}

export function adaptWindow(
  window: EngineSymbol[][],
  removedPositions?: RemovedPosition[],
  previousWindow?: EngineSymbol[][],
  phase?: CascadePhase,
): UISymbol[][] {
  const removedSet = new Set(removedPositions?.map(p => `${p.reel}-${p.row}`) ?? [])

  return window.map((col, reelIndex) =>
    col.map((symbol, row) => {
      const prev = previousWindow?.[reelIndex]?.[row]

      const goldToWild = prev?.isGold === true && prev.kind !== 'WILD' && symbol.kind === 'WILD'

      // 🔒 visual lock: BACK until flip phase
      const visualKind = goldToWild && phase !== 'postGoldTransform' ? 'BACK' : symbol.kind

      return {
        id: `${reelIndex}-${row}`,

        kind: visualKind,

        isNew: removedSet.has(`${reelIndex}-${row}`),

        // gold never returns after BACK
        isGold: symbol.isGold === true && !goldToWild,
        goldTTL: symbol.goldTTL,

        // metadata only
        goldToWild,
        wildColor: symbol.wildColor,
      }
    }),
  )
}
