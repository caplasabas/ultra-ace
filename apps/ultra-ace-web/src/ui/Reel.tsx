import './reel.css'
import type { CascadePhase } from '../hooks/useCascadeTimeline'
import { SYMBOL_MAP } from './symbolMap'
import { CSSProperties } from 'react'

export interface UISymbol {
  id: string
  kind: string
  isNew?: boolean
  isGold?: boolean
  goldTTL?: number
  goldToWild?: boolean
  wildColor?: string
}

interface Props {
  symbols: UISymbol[]
  reelIndex: number
  winningPositions: Set<string>
  phase: CascadePhase
  layer: 'old' | 'new'
}

type CSSVars = CSSProperties & {
  '--hx'?: string
  '--hy'?: string
}

export function Reel({ symbols, reelIndex, winningPositions, phase, layer }: Props) {
  const isInitialDeal = layer === 'new' && phase === 'initialRefill'
  const isCascadeRefill = layer === 'new' && phase === 'cascadeRefill'
  const isFlipPhase = phase === 'postGoldTransform'

  return (
    <div
      className={['reel', layer === 'old' && phase === 'reelSweepOut' && 'sweep-out-old']
        .filter(Boolean)
        .join(' ')}
      style={{
        left: `calc(${reelIndex} * (var(--reel-width) + var(--reel-gap)))`,
      }}
    >
      {symbols.map((symbol, row) => {
        const isWin = winningPositions.has(`${reelIndex}-${row}`)
        const isCascadeDeal = isCascadeRefill && symbol.isNew

        const isScatter = symbol.kind === 'SCATTER'

        const isBack = symbol.kind === 'BACK'
        const shouldFlip = isFlipPhase && symbol.goldToWild === true

        const delay = reelIndex * 140 + (symbols.length - 1 - row) * 55 + row * 6

        /* ----------------------------------
           IMAGE RESOLUTION (KEY FIX)
        ---------------------------------- */

        const showWildFace = shouldFlip

        const imgSrc = showWildFace
          ? symbol.wildColor === 'red'
            ? SYMBOL_MAP.WILD_RED.normal
            : SYMBOL_MAP.WILD.normal
          : isBack
            ? SYMBOL_MAP.BACK.normal
            : symbol.isGold && SYMBOL_MAP[symbol.kind]?.gold
              ? SYMBOL_MAP[symbol.kind].gold
              : SYMBOL_MAP[symbol.kind].normal

        return (
          <div
            key={symbol.id}
            className={[
              'card',

              isBack && 'back',
              showWildFace && 'wild',
              showWildFace && symbol.wildColor === 'red' && 'wild-red',

              symbol.isGold && 'gold',

              isScatter && 'scatter',
              isInitialDeal && 'deal-initial',
              isCascadeDeal && 'deal',

              isWin && phase === 'pop' && 'pop',

              // ✅ flip happens on SAME NODE
              shouldFlip && 'flip-to-wild',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              top: `calc(${row} * (var(--scaled-card-height) + var(--card-gap)))`,
              animationDelay: isInitialDeal || isCascadeDeal ? `${delay}ms` : '0ms',
              zIndex: phase === 'highlight' && isWin ? 10 : 1,
            }}
          >
            <div
              className={[
                'card-inner',
                isBack && isCascadeRefill && 'highlight',
                isWin && phase === 'highlight' && 'highlight',
              ]
                .filter(Boolean)
                .join(' ')}
              style={
                isWin && phase === 'highlight'
                  ? ({
                      '--hx': `${(reelIndex % 2 ? 1 : -1) * 6}px`,
                      '--hy': `${(row % 2 ? 1 : -1) * 6}px`,
                    } as CSSVars)
                  : undefined
              }
            >
              <img src={imgSrc} className="symbol-img" draggable={false} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
