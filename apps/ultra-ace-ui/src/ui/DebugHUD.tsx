import { View, Text, StyleSheet } from 'react-native'
import type { DebugSpinInfo } from '@game/types'

export function DebugHUD({ info }: { info?: DebugSpinInfo }) {
  if (!info) return null

  return (
    <View style={styles.container}>
      <Text style={styles.line}>Seed: {info.seed}</Text>
      <Text style={styles.line}>ReelStops: [{info.reelStops.join(', ')}]</Text>
      <Text style={styles.line}>Bet: {info.bet}</Text>
      <Text style={styles.line}>Win: {info.win}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 12,
    left: 12,
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 6,
  },
  line: {
    color: '#0f0',
    fontSize: 12,
  },
})
