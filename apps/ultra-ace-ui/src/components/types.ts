import { UISymbol } from '@game/types'

export type CascadePhase =
  | 'idle'
  | 'reelSweep'
  | 'highlight'
  | 'pop'
  | 'collapse'
  | 'refill'
  | 'settle'

export interface UISymbolInstance {
  id: string
  kind: UISymbol
  isNew?: boolean // ⬅️ refill spawn flag
  fallOffset?: number // ⬅️
}

interface CascadePlaybackState {
  cascadeIndex: number
  phase: CascadePhase
}
