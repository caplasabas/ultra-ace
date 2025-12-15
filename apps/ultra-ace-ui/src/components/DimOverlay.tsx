import { StyleSheet } from 'react-native'
import { MotionView } from '@components/MotionView'

export function DimOverlay({ active }: { active: boolean }) {
  if (!active) return null

  return (
    <MotionView
      pointerEvents="none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 0.55 }}
      transition={{ duration: 0.25 }}
      style={styles.overlay}
    />
  )
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 1,
  },
})
