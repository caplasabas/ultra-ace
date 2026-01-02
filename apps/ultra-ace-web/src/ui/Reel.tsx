import './reel.css'
import type { CascadePhase } from '../hooks/useCascadeTimeline'
import { SYMBOL_MAP } from './symbolMap'
import { CSSProperties } from 'react'

export interface UISymbol {
  id: string
  kind: string

  isNew?: boolean
  isPersisted?: boolean
  isSettledWild?: boolean

  isGold?: boolean
  goldTTL?: number

  goldToWild?: boolean
  wildColor?: 'red' | 'blue'
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

/* ----------------------------------------
   🔒 SINGLE SOURCE OF TRUTH FOR SYMBOL IMAGE
---------------------------------------- */
function resolveSymbolImage(symbol: UISymbol): string {
  if (symbol.kind === 'BACK') return SYMBOL_MAP.BACK.normal

  if (symbol.isGold === true || symbol.goldTTL !== undefined) {
    const gold = SYMBOL_MAP[symbol.kind]?.gold
    if (gold) return gold
  }

  if (symbol.kind === 'WILD') {
    return symbol.wildColor === 'red' ? SYMBOL_MAP.WILD_RED.normal : SYMBOL_MAP.WILD.normal
  }

  return SYMBOL_MAP[symbol.kind].normal
}
export function Reel({ symbols, reelIndex, winningPositions, phase, layer }: Props) {
  const isInitialDeal = layer === 'new' && phase === 'initialRefill'
  const isCascadeRefill = layer === 'new' && phase === 'cascadeRefill'

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
        const isScatter = symbol.kind === 'SCATTER'
        const isBack = symbol.kind === 'BACK'

        const isCascadeDeal =
          isCascadeRefill &&
          symbol.isNew === true &&
          symbol.isPersisted !== true &&
          symbol.isSettledWild !== true

        const shouldFlip = symbol.goldToWild === true
        const delay = reelIndex * 140 + (symbols.length - 1 - row) * 55 + row * 6
        const imgSrc = resolveSymbolImage(symbol)

        return (
          <div
            className="card-shell"
            style={{
              top: `calc(${row} * (var(--scaled-card-height) + var(--card-gap)))`,
              zIndex: isWin && phase === 'highlight' ? 20 : 1,
            }}
          >
            {/* POP VFX */}
            {isWin && phase === 'pop' && (
              <div className="scorch-pop">
                <div className="scorch-atlas pop" />
              </div>
            )}

            <div
              className={[
                'card',
                isBack && 'back',
                symbol.kind === 'WILD' && 'wild',
                symbol.kind === 'WILD' && symbol.wildColor === 'red' && 'wild-red',
                symbol.isGold && 'gold',
                isScatter && 'scatter',
                isInitialDeal && 'deal-initial',
                isCascadeDeal && 'deal',
                isWin && phase === 'pop' && !symbol.isGold && 'pop',
                shouldFlip && 'flip-to-wild',
                symbol.isSettledWild && 'settled',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                animationDelay: isInitialDeal || isCascadeDeal ? `${delay}ms` : '0ms',
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

            <div
              className={['scorch-under', isWin && phase === 'highlight' && 'active delayed']
                .filter(Boolean)
                .join(' ')}
            >
              <div className="scorch-atlas core" />
              <div className="scorch-atlas rays" />
            </div>
          </div>
        )
      })}
    </div>
  )
}
