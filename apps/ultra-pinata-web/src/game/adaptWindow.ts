import type { Symbol as EngineSymbol } from '@ultra-ace/pinata-engine'
import type { UISymbol } from '../ui/Reel'
import type { CascadePhase } from '../hooks/useCascadeTimeline'

interface RemovedPosition {
  reel: number
  row: number
}

interface RefillPosition {
  reel: number
  row: number
  sourceRow: number
  symbol: EngineSymbol
}

export function adaptWindow(
  window: EngineSymbol[][],
  removedPositions?: RemovedPosition[],
  previousWindow?: EngineSymbol[][],
  phase?: CascadePhase,
  refillSymbols?: RefillPosition[],
): UISymbol[][] {
  const removedSet = new Set(removedPositions?.map(p => `${p.reel}-${p.row}`) ?? [])
  const refillByTarget = new Map(
    refillSymbols?.map(refill => [`${refill.reel}-${refill.row}`, refill]) ?? [],
  )

  return window.map((col, reelIndex) =>
    col.map((symbol, row) => {
      const positionKey = `${reelIndex}-${row}`
      const prev = previousWindow?.[reelIndex]?.[row]
      const refill = refillByTarget.get(positionKey)
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
          goldMultiplier: undefined,

          isDecorativeGold: false,

          goldToWild: false,
          wildColor: undefined,

          isSettledWild: false,

          prevKind: undefined,
          wasGold: false,
          refillSourceRow: undefined,
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
          prev.goldMultiplier !== symbol.goldMultiplier ||
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
        goldMultiplier: shouldHoldGoldFrame ? prev?.goldMultiplier : symbol.goldMultiplier,
        redWildIncoming: shouldHoldIncomingRedWild,

        isDecorativeGold: shouldHoldGoldFrame ? prev?.isDecorativeGold : symbol.isDecorativeGold,

        goldToWild: shouldFlip,
        wildColor: symbol.wildColor,

        isSettledWild,

        prevKind: prev?.kind,
        wasGold,
        refillSourceRow: refill?.sourceRow,
      }
    }),
  )
}

export function adaptTopPreviewWindow(
  topPreview: EngineSymbol[][] | undefined,
  fallbackWindow: EngineSymbol[][] | undefined,
): UISymbol[][] | undefined {
  const source = fallbackWindow ?? topPreview
  if (!source?.length) return undefined

  return source.map((col, reelIndex) => {
    const previewSymbols = topPreview?.[reelIndex]?.length
      ? topPreview[reelIndex]
      : fallbackWindow?.[reelIndex]?.[0]
        ? [fallbackWindow[reelIndex][0]]
        : []
    const previewCount = previewSymbols.length || 1

    return previewSymbols.flatMap((symbol, index) => {
      if (!symbol || symbol.kind === 'EMPTY') return []

      return {
        id: `preview-${reelIndex}-${index}-${symbol.kind}-${Number(symbol.goldMultiplier ?? 0)}`,
        kind: symbol.kind,
        isNew: true,
        isPersisted: false,
        isGold: symbol.isGold,
        goldTTL: symbol.goldTTL,
        goldMultiplier: symbol.goldMultiplier,
        isDecorativeGold: symbol.isDecorativeGold,
        goldToWild: false,
        wildColor: symbol.wildColor,
        isSettledWild: symbol.kind === 'WILD',
        prevKind: undefined,
        wasGold: false,
        refillSourceRow: index - previewCount,
      }
    })
  })
}
