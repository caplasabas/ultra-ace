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

      // 🔒 EMPTY IS TERMINAL VISUALLY
      if (symbol.kind === 'EMPTY') {
        return {
          id: `${reelIndex}-${row}`,
          kind: 'EMPTY',

          isNew: false,
          isPersisted: false,

          isGold: false,
          goldTTL: undefined,

          isDecorativeGold: false,

          goldToWild: false,
          wildColor: undefined,

          isSettledWild: false,

          prevKind: undefined,
          wasGold: false,
        }
      }

      const wasGold = prev?.isGold === true
      const becameWild = symbol.kind === 'WILD'

      const isFinalPhase = phase === 'settle' || phase === 'idle'
      const isSettledWild = becameWild && (phase === 'postGoldTransform' || prev?.kind === 'WILD')

      const shouldFlip = wasGold && becameWild && phase === 'postGoldTransform'

      const visualKind = isFinalPhase
        ? symbol.kind
        : wasGold && becameWild && !isSettledWild && phase !== 'postGoldTransform'
          ? 'BACK'
          : symbol.kind

      const symbolChanged =
        prev &&
        (prev.kind !== symbol.kind ||
          prev.isGold !== symbol.isGold ||
          prev.goldTTL !== symbol.goldTTL ||
          prev.isWild !== symbol.isWild ||
          prev.wildColor !== symbol.wildColor ||
          prev.fromGold !== symbol.fromGold)

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
