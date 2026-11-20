import { normalize } from '../../core/math';
import type { Think } from './enemy';

/**
 * Cherub — a winged head that comes in clouds. Circles Satan at `orbitRange`
 * (each one at its own angle so a cloud spreads into a ring), then lunges.
 * No posture: one hit kills. Swarmers ignore the focus rule; at most
 * `combat.groups.swarmMax` of them lunge at once (enforced in enemy.ts).
 */
export const thinkCherub: Think = (world, e, def) => {
  if (!world.flags.dummyAttacks) return { move: { x: 0, y: 0 }, attack: null };
  const p = world.player.pos;
  const to = { x: p.x - e.pos.x, y: p.y - e.pos.y };
  const dist = Math.hypot(to.x, to.y);
  const dir = normalize(to);
  const orbit = def.orbitRange ?? 42;

  // Radial: hold the orbit. Tangential: drift around Satan, direction by id.
  const side = e.id % 2 === 0 ? 1 : -1;
  const radial = dist > orbit + 6 ? 1 : dist < orbit - 8 ? -0.8 : 0;
  const tangential = 0.45 * side;
  const move = {
    x: (dir.x * radial - dir.y * tangential) * def.speed,
    y: (dir.y * radial + dir.x * tangential) * def.speed,
  };

  if (e.cooldown > 0) return { move, attack: null };
  if (dist <= def.attacks.lunge!.range + 6) return { move: { x: 0, y: 0 }, attack: 'lunge' };
  return { move, attack: null };
};
