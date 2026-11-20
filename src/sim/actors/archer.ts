import { normalize } from '../../core/math';
import { nextFloat } from '../../core/rng';
import type { Think } from './enemy';

/**
 * Choir Archer — keeps its distance (backs off if Satan closes in, approaches
 * if too far), draws and looses arrows of pale-blue light, sometimes a quick
 * follow-up shot, and bow-bashes if cornered. Arrows can be deflected back.
 */
export const thinkArcher: Think = (world, e, def) => {
  if (!world.flags.dummyAttacks) return { move: { x: 0, y: 0 }, attack: null };
  const p = world.player.pos;
  const to = { x: p.x - e.pos.x, y: p.y - e.pos.y };
  const dist = Math.hypot(to.x, to.y);
  const dir = normalize(to);
  const want = def.preferredRange ?? 90;

  let move = { x: 0, y: 0 };
  if (dist < want - 25) move = { x: -dir.x * def.speed, y: -dir.y * def.speed };
  else if (dist > want + 30) move = { x: dir.x * def.speed * 0.8, y: dir.y * def.speed * 0.8 };
  else {
    // Drift sideways a little so it isn't a sitting target.
    const side = e.id % 2 === 0 ? 1 : -1;
    move = { x: -dir.y * def.speed * 0.35 * side, y: dir.x * def.speed * 0.35 * side };
  }

  if (e.cooldown > 0) return { move, attack: null };
  if (dist <= def.attacks.bowBash!.range && nextFloat(world.rng) < 0.6) return { move: { x: 0, y: 0 }, attack: 'bowBash' };
  if (dist <= def.attacks.shot!.range) return { move: { x: 0, y: 0 }, attack: 'shot' };
  return { move, attack: null };
};
