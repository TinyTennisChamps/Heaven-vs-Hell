import { normalize } from '../../core/math';
import { nextFloat } from '../../core/rng';
import type { Think } from './enemy';

/**
 * Dominion — shield warrior, a posture fight. Keeps its tower shield toward
 * Satan (slow turn, so flanking works), spaces at spear range, thrusts (often
 * a 2-hit string), shield-bashes up close, counters after absorbing a few hits,
 * and occasionally commits to an unblockable Judgement lunge.
 */
export const thinkDominion: Think = (world, e, def) => {
  if (!world.flags.dummyAttacks) return { move: { x: 0, y: 0 }, attack: null };
  const p = world.player.pos;
  const to = { x: p.x - e.pos.x, y: p.y - e.pos.y };
  const dist = Math.hypot(to.x, to.y);
  const dir = normalize(to);

  // Flanking punish: Satan has been behind the shield too long — shield-spin.
  const fs = def.flankSpin;
  if (fs && e.flankTicks >= fs.afterFrames && e.specialCooldown <= 0 && def.attacks.spin) {
    e.flankTicks = 0;
    e.specialCooldown = fs.cooldownFrames;
    return { move: { x: 0, y: 0 }, attack: 'spin' };
  }

  // Counter: after absorbing several hits on the shield, bash immediately.
  if ((def.counterAfterBlocks ?? 0) > 0 && e.blockedHits >= (def.counterAfterBlocks ?? 0) && dist < def.attacks.bash!.range + 6) {
    e.blockedHits = 0;
    return { move: { x: 0, y: 0 }, attack: 'bash' };
  }

  let move = { x: 0, y: 0 };
  const want = def.attackRange * 0.75;
  if (dist > def.attackRange) move = { x: dir.x * def.speed, y: dir.y * def.speed };
  else if (dist < 14) move = { x: -dir.x * def.speed * 0.6, y: -dir.y * def.speed * 0.6 };
  else if (dist > want) move = { x: dir.x * def.speed * 0.4, y: dir.y * def.speed * 0.4 };

  if (e.cooldown > 0) return { move, attack: null };

  const r = nextFloat(world.rng);
  if (dist > def.attacks.thrust!.range && dist <= def.attacks.judgement!.range && r < (def.judgementChance ?? 0) * 2) {
    return { move: { x: 0, y: 0 }, attack: 'judgement' };
  }
  if (dist <= def.attacks.bash!.range && r < 0.35) return { move: { x: 0, y: 0 }, attack: 'bash' };
  if (dist <= def.attacks.thrust!.range) {
    if (r > 1 - (def.judgementChance ?? 0)) return { move: { x: 0, y: 0 }, attack: 'judgement' };
    return { move: { x: 0, y: 0 }, attack: 'thrust' };
  }
  return { move, attack: null };
};
