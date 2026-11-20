import { normalize } from '../../core/math';
import type { Think } from './enemy';

/** Training dummy: walk into range and swing (if world.flags.dummyAttacks). */
export const thinkDummy: Think = (world, e, def) => {
  if (!world.flags.dummyAttacks) return { move: { x: 0, y: 0 }, attack: null };
  const p = world.player.pos;
  const to = { x: p.x - e.pos.x, y: p.y - e.pos.y };
  const dist = Math.hypot(to.x, to.y);
  const dir = normalize(to);
  const move = dist > def.attackRange * 0.8 ? { x: dir.x * def.speed, y: dir.y * def.speed } : { x: 0, y: 0 };
  const attack = dist <= def.attackRange && e.cooldown <= 0 ? 'swing' : null;
  return { move, attack };
};
