// MotionView.ts
import { Platform, View } from 'react-native'
import { motion } from 'framer-motion'

export const MotionView = Platform.OS === 'web' ? motion(View) : View
