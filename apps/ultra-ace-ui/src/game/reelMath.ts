import { REELS, SpinOutcome, Symbol } from '@ultra-ace/engine'
import type { UISymbol, VisualReel } from './types'

export function toUISymbol(symbol: Symbol): UISymbol {
  if (symbol.kind === 'WILD') return 'WILD'
  if (symbol.kind === 'SCATTER') return 'SCATTER'

  // CARD
  switch (symbol.rank) {
    case 'A':
      return 'A'
    case 'K':
      return 'K'
    case 'Q':
      return 'Q'
    case 'J':
      return 'J'

    // LOW SYMBOLS → SUITS
    case '10':
      return suitToUISymbol(symbol.suit)
    case '9':
      return suitToUISymbol(symbol.suit)

    default:
      throw new Error(`Unhandled rank: ${symbol.rank}`)
  }
}

function suitToUISymbol(suit: string): UISymbol {
  switch (suit) {
    case 'S':
      return 'SPADE'
    case 'H':
      return 'HEART'
    case 'D':
      return 'DIAMOND'
    case 'C':
      return 'CLUB'
    default:
      throw new Error(`Unknown suit: ${suit}`)
  }
}

export function mapOutcomeToVisualResult(outcome: SpinOutcome) {
  const reels: VisualReel[] = outcome.reelStops.map((stopIndex, reelIndex) => {
    const reelStrip = REELS[reelIndex]

    const symbols = reelStrip.map(toUISymbol)

    return {
      symbols,
      stopIndex,
    }
  })

  return { reels, outcome }
}
