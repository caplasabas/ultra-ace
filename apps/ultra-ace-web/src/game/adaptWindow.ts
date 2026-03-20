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
      const positionKey = `${reelIndex}-${row}`
      const prev = previousWindow?.[reelIndex]?.[row]
      const wasGoldSource =
        prev?.isGold === true || prev?.goldTTL !== undefined || prev?.isDecorativeGold === true
      const becameWild = symbol.kind === 'WILD'
      const isGoldToWildTransform = wasGoldSource && becameWild
      const shouldHoldGoldFrame = isGoldToWildTransform && phase !== 'postGoldTransform'
      const isRedWildPropagationTarget =
        symbol.kind === 'WILD' &&
        symbol.wildColor === 'red' &&
        !symbol.fromGold &&
        prev !== undefined &&
        !(prev.kind === 'WILD' && prev.wildColor === 'red')
      const shouldHoldIncomingRedWild =
        isRedWildPropagationTarget && (phase === 'cascadeRefill' || phase === 'postGoldTransform')

      // 🔒 EMPTY IS TERMINAL VISUALLY
      if (symbol.kind === 'EMPTY') {
        return {
          id: positionKey,
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

      const wasGold = wasGoldSource

      const isFinalPhase = phase === 'settle' || phase === 'idle'
      const isSettledWild =
        becameWild &&
        (phase === 'postGoldTransform' || phase === 'settle' || phase === 'idle' || prev?.kind === 'WILD')

      const shouldFlip = isGoldToWildTransform && phase === 'postGoldTransform'

      const visualKind = isFinalPhase
        ? symbol.kind
        : shouldHoldGoldFrame
          ? (prev?.kind ?? symbol.kind)
          : shouldHoldIncomingRedWild
            ? (prev?.kind ?? symbol.kind)
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
        (!removedSet.has(positionKey) || isGoldToWildTransform || isRedWildPropagationTarget) &&
        (!symbolChanged || isGoldToWildTransform || isRedWildPropagationTarget)

      const isNew =
        !isGoldToWildTransform &&
        !isRedWildPropagationTarget &&
        (removedSet.has(positionKey) || prev?.kind === 'EMPTY' || symbolChanged)

      return {
        id: positionKey,
        kind: visualKind,

        isNew,
        isPersisted,

        isGold: shouldHoldGoldFrame ? true : symbol.isGold,
        goldTTL: shouldHoldGoldFrame ? prev?.goldTTL : symbol.goldTTL,
        redWildIncoming: shouldHoldIncomingRedWild,

        isDecorativeGold: shouldHoldGoldFrame ? prev?.isDecorativeGold : symbol.isDecorativeGold,

        goldToWild: shouldFlip,
        wildColor: symbol.wildColor,

        isSettledWild,

        prevKind: prev?.kind,
        wasGold,
      }
    }),
  )
}
