import './reel.css'
import type { CascadePhase } from '../hooks/useCascadeTimeline'
import { SYMBOL_MAP } from './symbolMap'

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

const CARD_HEIGHT = 86
const GAP_Y = 5
const REEL_WIDTH = 64
const REEL_GAP = 10

export function Reel({
                       symbols,
                       reelIndex,
                       winningPositions,
                       phase,
                       layer,
                     }: Props) {
  const isInitialRefill = phase === 'initialRefill'
  const isCascadeRefill = phase === 'cascadeRefill'

  return (
    <div
      className={[
        'reel',
        layer === 'old' &&
        phase === 'reelSweepOut' &&
        'sweep-out-old',
        layer === 'new' &&
        isInitialRefill &&
        'reel-pre-deal',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        left: reelIndex * (REEL_WIDTH + REEL_GAP),
        transform: 'translate3d(0,0,0)', // locked
      }}
    >
      {symbols.map((symbol, row) => {
        const isWin = winningPositions.has(`${reelIndex}-${row}`)
        const shouldDeal =
          layer === 'new' &&
          symbol.isNew &&
          (isInitialRefill || isCascadeRefill)

        return (
          <div
            key={`${symbol.id}-${phase}`}
            className={[
              'card',
              shouldDeal && 'deal',
              isWin && phase === 'pop' && 'pop',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              top: row * (CARD_HEIGHT + GAP_Y),
              animationDelay: shouldDeal
                ? `${(reelIndex + row) * 70}ms`
                : '0ms',
              zIndex: isWin ? 10: 1
            }}
          >
            {/* ✅ INNER LAYER FOR HIGHLIGHT */}
            <div
              className={[
                'card-inner',
                isWin && phase === 'highlight' && 'highlight',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <img
                src={SYMBOL_MAP[symbol.kind]}
                className="symbol-img"
                draggable={false}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
