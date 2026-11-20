/** Deterministic mulberry32. State lives in the sim world so replays are exact. */
export interface RngState {
  seed: number;
}

export function createRng(seed: number): RngState {
  return { seed: seed >>> 0 };
}

/** Returns a float in [0, 1). Mutates the state. */
export function nextFloat(rng: RngState): number {
  rng.seed = (rng.seed + 0x6d2b79f5) >>> 0;
  let t = rng.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function nextRange(rng: RngState, min: number, max: number): number {
  return min + (max - min) * nextFloat(rng);
}

export function nextInt(rng: RngState, minInclusive: number, maxExclusive: number): number {
  return Math.floor(nextRange(rng, minInclusive, maxExclusive));
}
