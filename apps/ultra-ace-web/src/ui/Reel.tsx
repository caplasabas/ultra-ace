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
}

const CARD_HEIGHT = 86
const GAP_Y = 5

export function Reel({ symbols, reelIndex, winningPositions, phase }: Props) {
  return (
    <div
      className={[
        'reel',
        phase === 'reelSweepOut' && 'sweep-out',
        phase === 'reelSweepIn' && 'sweep-in',
        phase === 'settle' && 'settle',
      ]
        .filter(Boolean)
        .join(' ')}
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
              symbol.isNew && phase === 'refill' && 'deal',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              top: y,
              animationDelay: symbol.isNew && phase === 'refill' ? `${row * 70}ms` : '0ms',
              zIndex: isWin ? 10 : 1,
            }}
          >
            {imgSrc && (
              <img src={imgSrc} alt={symbol.kind} className="symbol-img" draggable={false} />
            )}
          </div>
        )
      })}
    </div>
  )
}
