import J from '../assets/symbols/J.png'
import Q from '../assets/symbols/Q.png'
import K from '../assets/symbols/K.png'
import A from '../assets/symbols/A.png'

import J_GOLD from '../assets/symbols/J_GOLD.png'
import Q_GOLD from '../assets/symbols/Q_GOLD.png'
import K_GOLD from '../assets/symbols/K_GOLD.png'
import A_GOLD from '../assets/symbols/A_GOLD.png'

import S from '../assets/symbols/S.png'
import H from '../assets/symbols/H.png'
import D from '../assets/symbols/D.png'
import C from '../assets/symbols/C.png'

import BACK from '../assets/symbols/BACK.png'

import S_GOLD from '../assets/symbols/S_GOLD.png'
import H_GOLD from '../assets/symbols/H_GOLD.png'
import D_GOLD from '../assets/symbols/D_GOLD.png'
import C_GOLD from '../assets/symbols/C_GOLD.png'

import SCATTER from '../assets/symbols/SCATTER.png'

import WILD from '../assets/symbols/WILD.png'

import WILD_RED from '../assets/symbols/WILD_RED.png'

export const SYMBOL_MAP: Record<string, { normal: string; gold?: string }> = {
  A: { normal: A, gold: A_GOLD },
  K: { normal: K, gold: K_GOLD },
  Q: { normal: Q, gold: Q_GOLD },
  J: { normal: J, gold: J_GOLD },

  SPADE: { normal: S, gold: S_GOLD },
  HEART: { normal: H, gold: H_GOLD },
  DIAMOND: { normal: D, gold: D_GOLD },
  CLUB: { normal: C, gold: C_GOLD },

  BACK: {
    normal: BACK,
  },

  WILD: { normal: WILD },
  WILD_RED: { normal: WILD_RED },
  SCATTER: { normal: SCATTER },
} as const
