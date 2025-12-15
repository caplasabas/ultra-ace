// src/ui/Reel.web.tsx

import { View, Image, StyleSheet } from 'react-native'
import type { VisualReel } from '@game/types'
import { VISIBLE_ROWS } from '@constants/layout'
import { SYMBOL_MAP } from './symbolMap'

export const CARD_HEIGHT = 100
export const CARD_ASPECT_RATIO = 192 / 254
export const CARD_WIDTH = Math.round(CARD_HEIGHT * CARD_ASPECT_RATIO) // 60

interface Props {
  reel: VisualReel
  reelIndex: number
  reelWidth: number
  winningPositions: Set<string>
}
import { Platform } from 'react-native'

export const cardShadow = Platform.select({
  web: {
    boxShadow: '0px 3px 8px rgba(0,0,0,0.35)',
  },
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  android: {
    elevation: 4,
  },
})

export function Reel({ reel, reelIndex, reelWidth, winningPositions }: Props) {
  const visible = Array.from({ length: VISIBLE_ROWS }, (_, row) => {
    const idx = (reel.stopIndex + row) % reel.symbols.length
    return reel.symbols[idx]
  })
  const hasAnyWin = winningPositions.size > 0

  return (
    <View style={[styles.reel]}>
      {visible.map((symbol, row) => {
        const isWin = winningPositions.has(`${reelIndex}-${row}`)

        return (
          <View
            style={[
              styles.card,
              cardShadow,
              hasAnyWin && !isWin && styles.dimmed,
              isWin && styles.win,
            ]}
          >
            <Image source={SYMBOL_MAP[symbol]} style={styles.image} resizeMode="contain" />
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  reel: {
    overflow: 'hidden',
    alignItems: 'center',
    flex: 1,
    gap: 5,
  },

  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    backgroundColor: '#E4E8EC',
    borderRadius: 5,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 5,
  },
  dimmed: {
    opacity: 0.35,
  },
  win: {
    borderWidth: 2,
    borderColor: '#ffd84d',
    boxShadow: '0 0 14px rgba(255,216,77,0.9)',
    backgroundColor: '#fffbe6',
    borderRadius: 5,
  },
})
