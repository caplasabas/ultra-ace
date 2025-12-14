import { Text, StyleSheet } from 'react-native'

export function WinCounter({ amount }: { amount: number }) {
  return <Text style={styles.text}>WIN: {amount}</Text>
}

const styles = StyleSheet.create({
  text: {
    marginTop: 12,
    fontSize: 18,
    color: '#fff',
  },
})
