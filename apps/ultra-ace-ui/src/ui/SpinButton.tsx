import { Pressable, Text, StyleSheet } from 'react-native'

export function SpinButton({
                             onPress,
                             disabled
                           }: {
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        disabled && styles.disabled
      ]}
    >
      <Text style={styles.text}>SPIN</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    marginTop: 20,
    padding: 20,
    backgroundColor: '#e0b24c',
    borderRadius: 8
  },
  disabled: {
    opacity: 0.5
  },
  text: {
    fontWeight: 'bold',
    fontSize: 18
  }
})
