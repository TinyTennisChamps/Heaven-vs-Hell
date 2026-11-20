import { thinkArcher } from './actors/archer';
import { thinkDominion } from './actors/dominion';
import { thinkDummy } from './actors/dummy';
import type { Think } from './actors/enemy';

/**
 * Enemy behaviours by type. Adding an enemy = a data file in data/enemies/
 * plus one entry here (and a placeholder drawing in render).
 */
export const ENEMY_THINK: Record<string, Think> = {
  dummy: thinkDummy,
  dominion: thinkDominion,
  archer: thinkArcher,
};
