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
}

interface Props {
  symbols: UISymbol[]
  reelIndex: number
  winningPositions: Set<string>
  phase: CascadePhase
  layer: 'old' | 'new'
}

const CARD_HEIGHT = 86 * 1.15
const GAP_Y = 5

type CSSVars = CSSProperties & {
  '--hx'?: string
  '--hy'?: string
}

const getCSSNumber = (name: string) =>
  parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name))

export function Reel({ symbols, reelIndex, winningPositions, phase, layer }: Props) {
  const scale =
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--board-scale')) || 1

  const reelWidth =
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--reel-width-num')) *
    scale

  const reelGap =
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--reel-gap-num')) *
    scale

  const isInitialDeal = layer === 'new' && phase === 'initialRefill'
  const isCascadeRefill = layer === 'new' && phase === 'cascadeRefill'

  return (
    <div
      className={['reel', layer === 'old' && phase === 'reelSweepOut' && 'sweep-out-old']
        .filter(Boolean)
        .join(' ')}
      style={{
        left: reelIndex * (reelWidth + reelGap),
      }}
    >
      {symbols.map((symbol, row) => {
        const isWin = winningPositions.has(`${reelIndex}-${row}`)
        const isCascadeDeal = isCascadeRefill && symbol.isNew

        const delay = reelIndex * 140 + (symbols.length - 1 - row) * 55 + row * 6

        const dirX = (reelIndex % 2 === 0 ? -1 : 1) * (6 + row * 1.5)
        const dirY = (row % 2 === 0 ? -1 : 1) * (6 + reelIndex * 1.2)

        const imgSrc =
          symbol.isGold && SYMBOL_MAP[symbol.kind]?.gold
            ? SYMBOL_MAP[symbol.kind].gold
            : SYMBOL_MAP[symbol.kind].normal
        return (
          <div
            key={symbol.id}
            className={[
              'card',
              symbol.isGold && 'gold',
              symbol.goldToWild && 'gold-to-wild',
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
            <div
              className={['card-inner', isWin && phase === 'highlight' && 'highlight']
                .filter(Boolean)
                .join(' ')}
              style={
                isWin && phase === 'highlight'
                  ? ({
                      '--hx': `${dirX}px`,
                      '--hy': `${dirY}px`,
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
