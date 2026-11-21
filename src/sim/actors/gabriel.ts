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
 *           Leap (jumps, homes in, slams down), Light Lances (three re-aimed
 *           beams; deflect them back), Blade of Light (a long string that a
 *           parry won't stop — block or deflect every hit).
 *  Phase 2: the thrust becomes a five-hit string, the blade string seven,
 *           horns come more often, and Annunciation (a Judgement ring of
 *           light — dash out or through it).
 */
export const thinkGabriel: Think = (world, e, def) => {
  if (!world.flags.dummyAttacks) return { move: { x: 0, y: 0 }, attack: null };
  // Phase two after the first segment falls — or from the start (the L2 return).
  const phase2 = e.segments < (def.segments ?? 1) || !!def.ai?.forcePhase2;
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
  const stand = { x: 0, y: 0 };
  if (phase2 && dist <= A.annunciation!.range && r < 0.15) return { move: stand, attack: 'annunciation' };
  // At range: leap onto Satan, charge him, or loose a volley of light lances.
  if (dist > A.thrust1!.range + 20) {
    if (dist <= A.leap!.range && r < 0.3) return { move: stand, attack: 'leap' };
    if (dist <= A.charge!.range && r < 0.55) return { move: stand, attack: 'charge' };
    if (dist <= A.beam1!.range && r < 0.8) return { move: stand, attack: 'beam1' };
    return { move, attack: null };
  }
  // Close: the relentless blade string, the trumpet, the thrusts.
  if (dist <= A.blade1!.range && r < 0.3) return { move: stand, attack: phase2 ? 'p2blade1' : 'blade1' };
  if (dist <= A.trumpet!.range && r < 0.5) return { move: stand, attack: 'trumpet' };
  if (dist <= A.thrust1!.range) return { move: stand, attack: phase2 ? 'p2thrust1' : 'thrust1' };
  return { move, attack: null };
};
