import { View, Text, StyleSheet } from 'react-native'
import type { VisualReel } from '@game/types'
import { SYMBOL_HEIGHT, REEL_HEIGHT } from '@constants/layout'

export function Reel({ reel }: { reel: VisualReel }) {
  return (
    <View style={styles.window}>
      {reel.symbols.map((symbol, i) => (
        <View key={i} style={styles.symbol}>
          <Text style={styles.text}>{symbol}</Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  window: {
    height: REEL_HEIGHT,
    width: 120,
    overflow: 'hidden',
    borderColor: '#444',
    borderWidth: 1
  },
  symbol: {
    height: SYMBOL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center'
  },
  text: {
    fontSize: 28,
    color: '#fff'
  }
})
