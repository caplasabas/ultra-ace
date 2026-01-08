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

      const wasGold = prev?.isGold === true
      const becameWild = symbol.kind === 'WILD'

      const isFinalPhase = phase === 'settle' || phase === 'idle'
      // 🔒 FINAL WILD LATCH (CRITICAL)
      const isSettledWild = becameWild && (phase === 'postGoldTransform' || prev?.kind === 'WILD')

      // 🔒 Flip ONLY once
      const shouldFlip = wasGold && becameWild && phase === 'postGoldTransform'

      // 🔒 BACK only allowed BEFORE flip AND not settled
      const visualKind = isFinalPhase
        ? symbol.kind
        : wasGold && becameWild && !isSettledWild && phase !== 'postGoldTransform'
          ? 'BACK'
          : symbol.kind

      const symbolChanged =
        prev &&
        (prev.kind !== symbol.kind ||
          prev.isGold !== symbol.isGold ||
          prev.wildColor !== symbol.wildColor)

      const isPersisted =
        prev !== undefined &&
        prev.kind !== 'EMPTY' &&
        !removedSet.has(`${reelIndex}-${row}`) &&
        !symbolChanged

      const isNew = removedSet.has(`${reelIndex}-${row}`) || prev?.kind === 'EMPTY' || symbolChanged

      return {
        id: `${reelIndex}-${row}`,
        kind: visualKind,

        isNew,
        isPersisted,

        isGold: false,
        goldTTL: symbol.goldTTL,

        isDecorativeGold: symbol.isDecorativeGold,

        goldToWild: shouldFlip,
        wildColor: symbol.wildColor,

        isSettledWild,

        prevKind: prev?.kind,
        wasGold,
      }
    }),
  )
}
