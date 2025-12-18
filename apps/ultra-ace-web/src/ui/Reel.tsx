import './reel.css'
import type { CascadePhase } from '../hooks/useCascadeTimeline'
import { SYMBOL_MAP } from './symbolMap'
import { CSSProperties } from 'react'

export interface UISymbol {
  id: string
  kind: string
  isNew?: boolean
}

interface Props {
  symbols: UISymbol[]
  reelIndex: number
  winningPositions: Set<string>
  phase: CascadePhase
  layer: 'old' | 'new'
}

const CARD_WIDTH = 64 * 1.15
const CARD_HEIGHT = 86 * 1.15
const GAP_Y = 5

type CSSVars = CSSProperties & {
  '--hx'?: string
  '--hy'?: string
}

const getCSSNumber = (name: string) =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name))

export function Reel({ symbols, reelIndex, winningPositions, phase, layer }: Props) {
  const isInitialRefill = phase === 'initialRefill'
  const isCascadeRefill = phase === 'cascadeRefill'

  const reelWidth = getCSSNumber('--reel-width')
  const reelGap = getCSSNumber('--reel-gap')
  return (
    <div
      className={[
        'reel',
        layer === 'old' && phase === 'reelSweepOut' && 'sweep-out-old',
        layer === 'new' && isInitialRefill && 'reel-pre-deal',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        left: reelIndex * ((reelWidth + reelGap) * 0.9),
        // transform: 'translate3d(0,0,0)', // locked
      }}
    >
      {symbols.map((symbol, row) => {
        const isWin = winningPositions.has(`${reelIndex}-${row}`)

        const isInitialDeal = layer === 'new' && phase === 'initialRefill'

        const isCascadeDeal = layer === 'new' && phase === 'cascadeRefill' && symbol.isNew

        const TOTAL_ROWS = symbols.length

        const baseDelay = reelIndex * 140 // reel cadence (machine rhythm)

        const depthDelay = (TOTAL_ROWS - 1 - row) * 55 // top cards lag

        const microJitter = row * 6 // prevents robotic simultaneity

        const delay = baseDelay + depthDelay + microJitter

        // Directional bias for highlight (px)
        const dirX = (reelIndex % 2 === 0 ? -1 : 1) * (6 + row * 1.5)
        const dirY = (row % 2 === 0 ? -1 : 1) * (6 + reelIndex * 1.2)

        return (
          <div
            key={`${symbol.id}`}
            className={[
              'card',
              isInitialDeal && 'deal-initial',
              isCascadeDeal && 'deal',
              isWin && phase === 'pop' && 'pop',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              top: row * (CARD_HEIGHT + GAP_Y),
              animationDelay: isInitialDeal || isCascadeDeal ? `${delay}ms` : '0ms',
              zIndex: isWin ? 10 : 1,
            }}
          >
            {/* ✅ INNER LAYER FOR HIGHLIGHT */}
            <div
              className={['card-inner', isWin && phase === 'highlight' && 'highlight']
                .filter(Boolean)
                .join(' ')}
              style={
                isWin && phase === 'highlight'
                  ? ({
                      // CSS vars consumed by animation
                      '--hx': `${dirX}px`,
                      '--hy': `${dirY}px`,
                    } as CSSVars)
                  : undefined
              }
            >
              <img src={SYMBOL_MAP[symbol.kind]} className="symbol-img" draggable={false} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
