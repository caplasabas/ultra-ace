import { View, Image, StyleSheet } from 'react-native'
import type { VisualReel } from '@game/types'
import { VISIBLE_ROWS } from '@constants/layout'
import { SYMBOL_MAP } from './symbolMap'

interface Props {
  reel: VisualReel
  width: number
  reelIndex: number
  winningPositions?: Set<string>
  dim?: boolean
}

export function Reel({ reel, width, reelIndex, winningPositions, dim = false }: Props) {
  const visible = reel.symbols.slice(reel.stopIndex, reel.stopIndex + VISIBLE_ROWS)

  return (
    <View style={[styles.reel, { width }, dim && styles.dimmed]}>
      {visible.map((symbol, rowIndex) => {
        const isWinning = winningPositions?.has(`${reelIndex}-${rowIndex}`)

        return (
          <View key={rowIndex} style={[styles.symbol, isWinning && styles.winningSymbol]}>
            <Image source={SYMBOL_MAP[symbol]} style={styles.image} resizeMode="contain" />
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  reel: {
    aspectRatio: 1 / VISIBLE_ROWS,
  },

  dimmed: {
    opacity: 0.35,
  },

  symbol: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#050c12',
  },

  winningSymbol: {
    backgroundColor: 'rgba(255,216,77,0.15)',
    borderRadius: 6,
  },

  image: {
    width: '75%',
    height: '75%',
  },
})
