import { Animated } from 'react-native'
import { useEffect, useRef } from 'react'
import Svg, { Polyline } from 'react-native-svg'

const AnimatedPolyline = Animated.createAnimatedComponent(Polyline)

interface LineWin {
  positions: { reel: number; row: number }[]
}

interface Props {
  lineWins: LineWin[]
  reelWidth: number
  rowCount: number
}

export function PaylinesOverlay({ lineWins, reelWidth, rowCount }: Props) {
  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (lineWins.length) {
      progress.setValue(0)
      Animated.timing(progress, {
        toValue: 1,
        duration: 400,
        useNativeDriver: false,
      }).start()
    }
  }, [lineWins])

  if (!lineWins.length) return null

  const reelHeight = reelWidth * rowCount
  const cellHeight = reelHeight / rowCount
  const svgWidth = reelWidth * lineWins[0].positions.length

  const dashOffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [svgWidth, 0],
  })

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        zIndex: 10,
      }}
    >
      <Svg width={svgWidth} height={reelHeight}>
        {lineWins.map((lw, i) => {
          const points = lw.positions
            .map(p => {
              const x = p.reel * reelWidth + reelWidth / 2
              const y = p.row * cellHeight + cellHeight / 2
              return `${x},${y}`
            })
            .join(' ')

          return (
            <AnimatedPolyline
              key={i}
              points={points}
              stroke="#ffd84d"
              strokeWidth={6}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${svgWidth} ${svgWidth}`}
              strokeDashoffset={dashOffset}
            />
          )
        })}
      </Svg>
    </Animated.View>
  )
}
