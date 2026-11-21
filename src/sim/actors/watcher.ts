import { normalize } from '../../core/math';
import type { Think } from './enemy';

/**
 * Watcher ("Grigori") — a floating eye with golden wings. Keeps 110–160 px
 * away, orbiting; looses a three-laser volley (aim tracks, then locks) from
 * range; and if Satan crowds it (or lands two melee hits) the eye splits into
 * a toothed maw and chomps. Deflecting the chomp jams its jaws open (a long
 * riposte stagger); deflecting a laser sends it back into the eye.
 */
export const thinkWatcher: Think = (world, e, def) => {
  const ai = def.ai ?? {};
  const p = world.player.pos;
  const to = { x: p.x - e.pos.x, y: p.y - e.pos.y };
  const dist = Math.hypot(to.x, to.y);
  const dir = normalize(to);
  e.closeTicks = dist <= (ai.biteRange ?? 48) ? e.closeTicks + 1 : 0;

  if (!world.flags.dummyAttacks) return { move: { x: 0, y: 0 }, attack: null };
  const A = def.attacks;

  // Chomp: crowded for a while, or hit twice up close.
  const crowded = e.closeTicks >= (ai.biteCloseTicks ?? 20) || e.meleeHits >= (ai.biteMeleeHits ?? 2);
  if (crowded && e.cooldown <= 0 && dist <= A.chomp!.range) {
    e.closeTicks = 0;
    e.meleeHits = 0;
    return { move: { x: 0, y: 0 }, attack: 'chomp' };
  }

  // Spacing: retreat fast if crowded and the bite isn't ready, else hold the band and orbit.
  const side = e.id % 2 === 0 ? 1 : -1;
  let move: { x: number; y: number };
  if (dist < (ai.retreatRange ?? 70)) move = { x: -dir.x * (ai.retreatSpeed ?? 110), y: -dir.y * (ai.retreatSpeed ?? 110) };
  else if (dist < (ai.rangeMin ?? 110)) move = { x: -dir.x * def.speed, y: -dir.y * def.speed };
  else if (dist > (ai.rangeMax ?? 160)) move = { x: dir.x * def.speed, y: dir.y * def.speed };
  else move = { x: -dir.y * def.speed * side, y: dir.x * def.speed * side };

  if (e.cooldown <= 0 && !e.cds.laser && dist >= (ai.laserMinRange ?? 90) && dist <= A.laser!.range) {
    return { move: { x: 0, y: 0 }, attack: 'laser' };
  }
  return { move, attack: null };
};
