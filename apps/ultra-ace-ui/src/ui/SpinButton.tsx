import { Pressable, Text, StyleSheet } from 'react-native'

export function SpinButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, disabled && styles.disabled]}
    >
      <Text style={styles.text}>SPIN</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    marginTop: 16,
    paddingVertical: 16,
    paddingHorizontal: 40,
    backgroundColor: '#d32f2f',
    borderRadius: 999,
    borderWidth: 3,
    borderColor: '#ffcc80',
  },
  disabled: { opacity: 0.5 },
  text: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 18,
    letterSpacing: 1,
  },
})
