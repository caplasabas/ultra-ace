import { Image, StyleSheet, Platform } from 'react-native'
import { MotionView } from '@components/MotionView'
import type { CascadePhase, UISymbolInstance } from '@components/types'
import { SYMBOL_MAP } from './symbolMap'

export const CARD_HEIGHT = 100
export const CARD_ASPECT_RATIO = 192 / 254
export const CARD_WIDTH = Math.round(CARD_HEIGHT * CARD_ASPECT_RATIO)

interface Props {
  reel: {
    symbols: UISymbolInstance[]
  }
  reelIndex: number
  winningPositions: Set<string>
  phase: CascadePhase
}

export function Reel({ reel, reelIndex, winningPositions, phase }: Props) {
  return (
    <MotionView style={styles.reel}>
      {reel.symbols.map((symbol, row) => {
        const key = `${reelIndex}-${row}`
        const isWin = winningPositions.has(key)

        const finalY = row * CARD_HEIGHT
        const spawnY = -CARD_HEIGHT * 4

        const isHighlight = phase === 'highlight' && isWin
        const isPop = phase === 'pop' && isWin
        const isRefillNew = phase === 'refill' && symbol.isNew

        return (
          <MotionView
            key={symbol.id}
            initial={isRefillNew ? { y: spawnY } : false}
            animate={{
              y: finalY,

              // 🔥 MUCH STRONGER SCALE
              scale: isHighlight ? [1, 1.45, 1.35] : isPop ? [1.35, 0.9, 0] : 1,

              opacity: isPop ? 0 : 1,

              // subtle juice
              rotateZ: isHighlight ? ['0deg', '-1.5deg', '1.5deg', '0deg'] : '0deg',
            }}
            transition={{
              y: { duration: isRefillNew ? 0.6 : 0, ease: 'easeOut' },
              scale: { duration: 0.35, ease: 'easeOut' },
              opacity: { duration: 0.25 },
              rotateZ: { duration: 0.35 },
            }}
            style={{
              ...styles.card,

              // 🔝 ALWAYS ABOVE DIM OVERLAY
              zIndex: isHighlight ? 10 : 1,

              ...(isHighlight ? styles.glow : null),
            }}
          >
            {symbol.kind !== 'EMPTY' && (
              <Image source={SYMBOL_MAP[symbol.kind]} style={styles.image} resizeMode="contain" />
            )}
          </MotionView>
        )
      })}
    </MotionView>
  )
}

const styles = StyleSheet.create({
  reel: {
    position: 'relative',
    height: CARD_HEIGHT * 4,
    flex: 1,
    // overflow: 'hidden',
  },

  card: {
    position: 'absolute',
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: '#E4E8EC',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // 💡 STRONG, VISIBLE GLOW
  glow: {
    shadowColor: '#ffd84d',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 18,
    elevation: Platform.OS === 'android' ? 14 : 0,
  },

  image: {
    width: '100%',
    height: '100%',
  },
})
