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

      /**
       * 🔒 GOLD → WILD is a ONE-TIME TRANSITION
       * Flip ONLY during postGoldTransform
       */
      const shouldFlip = wasGold && becameWild && phase === 'postGoldTransform'

      /**
       * 🔒 BACK is shown ONLY before flip
       */
      const visualKind =
        wasGold && becameWild && phase !== 'postGoldTransform' ? 'BACK' : symbol.kind

      /**
       * 🔒 Once flipped, the wild is SETTLED forever
       */
      const isSettledWild = becameWild && (phase === 'postGoldTransform' || prev?.kind === 'WILD')

      /**
       * 🔒 Persisted = symbol existed and was NOT removed
       */
      const isPersisted =
        prev !== undefined && prev.kind !== 'EMPTY' && !removedSet.has(`${reelIndex}-${row}`)

      return {
        id: `${reelIndex}-${row}`,
        kind: visualKind,

        // true ONLY for actual cascade refill
        isNew: removedSet.has(`${reelIndex}-${row}`),

        // blocks re-deal animations
        isPersisted,

        // gold never returns after transform
        isGold: false,
        goldTTL: symbol.goldTTL,

        // 🔑 animation latch
        goldToWild: shouldFlip,
        wildColor: symbol.wildColor,

        // 🔑 FINAL STATE LATCH (CRITICAL)
        isSettledWild,
      }
    }),
  )
}
