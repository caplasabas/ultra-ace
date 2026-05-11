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

import WILD from '../assets/symbols/WILD.png'

import WILD_RED from '../assets/symbols/WILD_RED.png'

import PINATA_ACE from '../assets/symbols/PINATA_ACE.svg'
import PINATA_KING from '../assets/symbols/PINATA_KING.svg'
import PINATA_QUEEN from '../assets/symbols/PINATA_QUEEN.svg'
import PINATA_JACK from '../assets/symbols/PINATA_JACK.svg'
import PINATA_CHILLI from '../assets/symbols/PINATA_CHILLI.svg'
import PINATA_MARACAS from '../assets/symbols/PINATA_MARACAS.svg'
import PINATA_SKULL from '../assets/symbols/PINATA_SKULL.svg'
import PINATA_SOMBRERO from '../assets/symbols/PINATA_SOMBRERO.svg'
import PINATA_TACO from '../assets/symbols/PINATA_TACO.svg'
import PINATA_SCATTER from '../assets/symbols/PINATA_SCATTER.svg'

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

  ACE: { normal: PINATA_ACE },
  KING: { normal: PINATA_KING },
  QUEEN: { normal: PINATA_QUEEN },
  JACK: { normal: PINATA_JACK },
  CHILLI: { normal: PINATA_CHILLI },
  MARACAS: { normal: PINATA_MARACAS },
  SKULL: { normal: PINATA_SKULL },
  SOMBRERO: { normal: PINATA_SOMBRERO },
  TACO: { normal: PINATA_TACO },
  // Override cloned scatter art for the Pinata engine symbol id.
  SCATTER: { normal: PINATA_SCATTER },
} as const
