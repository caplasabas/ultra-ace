import { View, StyleSheet } from 'react-native'
import { useSpin } from '@hooks/useSpin'
import { Reel } from '@ui/Reel'
import { SpinButton } from '@ui/SpinButton'
import { WinCounter } from '@ui/WinCounter'

export default function SlotScreen() {
  const { spin, reels, win } = useSpin()

  return (
    <View style={styles.container}>
      <View style={styles.reels}>
        {reels.map((reel, i) => (
          <Reel key={i} reel={reel} />
        ))}
      </View>

      <WinCounter amount={win} />
      <SpinButton onPress={spin} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#081018',
    justifyContent: 'center',
    alignItems: 'center'
  },
  reels: {
    flexDirection: 'row',
    gap: 8
  }
})
