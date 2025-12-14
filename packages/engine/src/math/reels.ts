// src/math/reels.ts
import { Symbol } from "packages/engine/src/types/symbol";

export const REELS: Symbol[][] = [
  // Reel 1 – no wilds
  [
    'LOW','LOW','LOW','LOW','LOW','LOW','LOW','LOW',
    '9','9','9','9','9','9',
    '10','10','10','10','10',
    'J','J','J','J',
    'Q','Q','Q',
    'K','K',
    'A',
  ],

  // Reel 2 – wild assist
  [
    'LOW','LOW','LOW','LOW','LOW','LOW','LOW',
    '9','9','9','9','9','9',
    '10','10','10','10','10',
    'J','J','J','J',
    'Q','Q','Q',
    'K','K',
    'A',
    'WILD','WILD','WILD'
  ],

  // Reel 3 – continuation core
  [
    'LOW','LOW','LOW','LOW','LOW','LOW',
    '9','9','9','9','9','9',
    '10','10','10','10','10',
    'J','J','J','J',
    'Q','Q','Q',
    'K','K',
    'A',
    'WILD','WILD','WILD','WILD'
  ],

  // Reel 4 – taper
  [
    'LOW','LOW','LOW','LOW','LOW','LOW','LOW','LOW',
    '9','9','9','9','9',
    '10','10','10','10',
    'J','J','J',
    'Q','Q',
    'K','K',
    'A',
  ],

  // Reel 5 – governor
  [
    'LOW','LOW','LOW','LOW','LOW','LOW','LOW','LOW','LOW',
    '9','9','9','9','9',
    '10','10','10','10',
    'J','J','J',
    'Q','Q',
    'K',
    'A',
  ],
]
