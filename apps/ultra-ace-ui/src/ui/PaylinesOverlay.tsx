import Svg, { Polyline } from 'react-native-svg'
import { engineRowToUIRow } from '@utils/rowMapping'
import { CARD_HEIGHT } from '@ui/Reel'

interface LineWin {
  positions: { reel: number; row: number }[]
}

interface Props {
  lineWins: LineWin[]
  reelWidth: number
  rowCount: number
}

export function PaylinesOverlay({ lineWins, reelWidth, rowCount }: Props) {
  if (!lineWins.length) return null

  const reelHeight = CARD_HEIGHT * rowCount
  const svgWidth = reelWidth * 5

  return (
    <Svg width={svgWidth} height={reelHeight} style={{ position: 'absolute', top: 0, left: 0 }}>
      {lineWins.map((lw, i) => {
        const points = lw.positions
          .map(p => {
            const x = p.reel * reelWidth + reelWidth / 2
            const uiRow = engineRowToUIRow(p.row, rowCount)
            const y = uiRow * CARD_HEIGHT + CARD_HEIGHT / 2
            return `${x},${y}`
          })
          .join(' ')

        return (
          <Polyline
            key={i}
            points={points}
            stroke="#ffd84d"
            strokeWidth={0}
            fill="none"
            strokeLinecap="round"
          />
        )
      })}
    </Svg>
  )
}
