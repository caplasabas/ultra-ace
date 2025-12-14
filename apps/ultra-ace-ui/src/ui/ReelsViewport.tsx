import { View, StyleSheet } from 'react-native'
import { ReactNode } from 'react'
import { VISIBLE_ROWS } from '@constants/layout'

export function ReelsViewport({ children, reelWidth }: { children: ReactNode; reelWidth: number }) {
  return <View style={[styles.viewport, { height: reelWidth * VISIBLE_ROWS }]}>{children}</View>
}

const styles = StyleSheet.create({
  viewport: {
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#02080d',
    borderRadius: 10,
    borderWidth: 3,
    borderColor: '#c9a23f',
  },
})
