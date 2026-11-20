/**
 * Palettes from the Visual Direction PDF. Rule: red-family colours (SATAN.*)
 * are ONLY for Satan, his attacks, his HUD and his items. Never environment or enemies.
 */
export const HEAVEN = {
  ivory: 0xfffdf6,
  ivory2: 0xf4eedf,
  marble: 0xe3d9c2,
  stone: 0xc9b99a,
  stoneDark: 0x9b8f78,
  gold1: 0xfff0b8,
  gold2: 0xe8c872,
  gold3: 0xb8923e,
  goldDark: 0x7a5e2a,
  sage: 0xd9e4cf,
} as const;

export const ANGEL = {
  white: 0xffffff,
  pearl: 0xf3f0ea,
  pearl2: 0xdad5e0,
  sky: 0xd0e8f5,
  sky2: 0xa9c4da,
  sky3: 0x789684,
  silver: 0xd4d8e0,
  silver2: 0x9ea4b4,
  glassTeal: 0x9fd3d0,
  lilac: 0xc7b4e0,
  angelLine: 0x6b6585,
  void: 0x2a2840,
} as const;

export const SATAN = {
  hellfire: 0xff4a3d,
  crimson: 0xd3122a,
  blood: 0x8a0a1e,
  lava: 0x4a0612,
  ember: 0xff8a3d,
  cloak: 0x1a0e14,
  cloak2: 0x2e1c26,
  horn: 0x483a48,
  eyeGlow: 0xffe9a8,
} as const;

/** Judgement (unblockable) telegraph — white-gold, never red. */
export const JUDGEMENT = 0xfff6c8;

/** Outer Gardens accents (hedges, water). Greens and blues only. */
export const GARDEN = {
  hedgeTop: 0xc4d8b4,
  hedge: 0xa3bf95,
  hedgeDark: 0x7f9c76,
  blossom: 0xffffff,
  water: 0xa9c4da,
  waterLight: 0xd0e8f5,
  cloud: 0xffffff,
  cloudShade: 0xe4eef5,
} as const;
