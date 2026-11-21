import { normalize } from '../../core/math';
import { nextFloat } from '../../core/rng';
import type { Think } from './enemy';

/**
 * Gabriel, the Herald (L1 boss). Two health segments; phase 2 begins after the
 * first deathblow (or the first bar draining).
 *  Phase 1: Triple Thrust (third hit on a varied delay), Trumpet Blast (cone,
 *           heavy posture), Horn Call (summons cherubs — hit him during the
 *           long windup to cancel it), Herald's Charge (Judgement lunge that a
 *           timed parry can still deflect).
 *  Phase 2: the thrust becomes a five-hit string, horns come more often, and
 *           Annunciation (a Judgement ring of light — dash out or through it).
 */
export const thinkGabriel: Think = (world, e, def) => {
  if (!world.flags.dummyAttacks) return { move: { x: 0, y: 0 }, attack: null };
  const phase2 = e.segments < (def.segments ?? 1);
  const p = world.player.pos;
  const to = { x: p.x - e.pos.x, y: p.y - e.pos.y };
  const dist = Math.hypot(to.x, to.y);
  const dir = normalize(to);

  // Hold a spear's length away, drifting round Satan a little.
  const side = e.id % 2 === 0 ? 1 : -1;
  let move = { x: 0, y: 0 };
  if (dist > 40) move = { x: dir.x * def.speed, y: dir.y * def.speed };
  else if (dist < 22) move = { x: -dir.x * def.speed * 0.6, y: -dir.y * def.speed * 0.6 };
  else move = { x: -dir.y * def.speed * 0.3 * side, y: dir.x * def.speed * 0.3 * side };

  if (e.cooldown > 0) return { move, attack: null };
  const A = def.attacks;
  const r = nextFloat(world.rng);

  // Horn Call on its own timer, and only while the choir is thin.
  const cherubs = world.enemies.filter((o) => o.type === 'cherub' && o.phase !== 'down').length;
  if (e.specialCooldown <= 0 && cherubs < 3) {
    const every = def.hornEveryFrames ?? [1200, 720];
    e.specialCooldown = phase2 ? every[1] : every[0];
    return { move: { x: 0, y: 0 }, attack: phase2 ? 'p2horn' : 'horn' };
  }
  if (phase2 && dist <= A.annunciation!.range && r < 0.18) return { move: { x: 0, y: 0 }, attack: 'annunciation' };
  if (dist > A.thrust1!.range + 20 && dist <= A.charge!.range) {
    return r < 0.55 ? { move: { x: 0, y: 0 }, attack: 'charge' } : { move, attack: null };
  }
  if (dist <= A.trumpet!.range && r < 0.3) return { move: { x: 0, y: 0 }, attack: 'trumpet' };
  if (dist <= A.thrust1!.range) return { move: { x: 0, y: 0 }, attack: phase2 ? 'p2thrust1' : 'thrust1' };
  return { move, attack: null };
};
