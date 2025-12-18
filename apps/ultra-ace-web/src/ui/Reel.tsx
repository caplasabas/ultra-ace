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
  const hideNewReel =
    layer === 'new' &&
    phase === 'reelSweepOut'

  return (
    <div
      className={[
        'reel',

        // OLD reels move as a block
        layer === 'old' &&
        phase === 'reelSweepOut' &&
        'sweep-out-old',

        // NEW reels are invisible during sweep-out
        hideNewReel && 'reel-hidden',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        left: reelIndex * (REEL_WIDTH + REEL_GAP),
      }}
    >
      {symbols.map((symbol, row) => {
        const key = `${reelIndex}-${row}`
        const isWin = winningPositions.has(key)
        const y = row * (CARD_HEIGHT + GAP_Y)
        const imgSrc = SYMBOL_MAP[symbol.kind]

        return (
          <div
            key={symbol.id}
            className={[
              'card',
              isWin && phase === 'highlight' && 'highlight',
              isWin && phase === 'pop' && 'pop',

              // ONLY new cards deal in
              layer === 'new' &&
              symbol.isNew &&
              phase === 'refill' &&
              'deal',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              top: y,
              animationDelay:
                layer === 'new' &&
                symbol.isNew &&
                phase === 'refill'
                  ? `${(reelIndex + row) * 70}ms`
                  : '0ms',
            }}
          >
            {imgSrc && (
              <img
                src={imgSrc}
                alt={symbol.kind}
                className="symbol-img"
                draggable={false}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
