import { normalize } from '../../core/math';
import { nextFloat } from '../../core/rng';
import type { Think } from './enemy';

/**
 * Zealot ("Principality") — an elite winged swordswoman. Very fast: circles
 * Satan at speed, sidesteps, wing-dashes in. Close up she mixes the Flurry
 * (5 uncancellable hits — parry them to break her), the Cross-step (3 hits,
 * the angle changes each time), normal slashes, and the Sweep (Judgement:
 * dash through or get out). At mid-range she opens with the thrust dash.
 * She leans toward the Sweep against a player who has been blocking a lot.
 * All weights and ranges are data (`ai` in zealot.json).
 */
export const thinkZealot: Think = (world, e, def) => {
  const ai = def.ai ?? {};
  const p = world.player;
  const to = { x: p.pos.x - e.pos.x, y: p.pos.y - e.pos.y };
  const dist = Math.hypot(to.x, to.y);
  const dir = normalize(to);
  if (!world.flags.dummyAttacks) return { move: { x: 0, y: 0 }, attack: null };
  const A = def.attacks;
  const stand = { x: 0, y: 0 };

  // Circle at speed around the duelling distance.
  const side = e.id % 2 === 0 ? 1 : -1;
  const want = ai.circleRange ?? 52;
  const radial = dist > want + 10 ? 1 : dist < want - 12 ? -0.7 : 0;
  const tangential = 0.8 * side;
  const move = { x: (dir.x * radial - dir.y * tangential) * def.speed, y: (dir.y * radial + dir.x * tangential) * def.speed };

  // Never act from far away (off-screen); close the gap with a wing-dash.
  if (dist > (ai.maxAttackDist ?? 200)) return { move: { x: dir.x * def.speed, y: dir.y * def.speed }, attack: null };
  if (dist > (ai.dashRange ?? 110) && !e.cds.wingdash) return { move: stand, attack: 'wingdash' };

  if (e.cooldown > 0) {
    // Breathing room between actions — with the odd sidestep to stay slippery.
    if (!e.cds.sidestep && nextFloat(world.rng) < (ai.sidestepChance ?? 0.02)) return { move: stand, attack: 'sidestep' };
    return { move, attack: null };
  }

  const r = nextFloat(world.rng);
  if (dist > (ai.closeRange ?? 46)) {
    // Mid-range: the thrust dash punishes standing off; otherwise close in.
    if (dist <= A.thrust!.range && r < 0.6) return { move: stand, attack: 'thrust' };
    return { move: { x: dir.x * def.speed, y: dir.y * def.speed }, attack: null };
  }

  // Close: weighted pick. A turtling player draws the Sweep.
  const w = {
    flurry: ai.wFlurry ?? 3,
    cross: ai.wCross ?? 2,
    sweep: e.cds.sweep ? 0 : (ai.wSweep ?? 1) + p.recentBlocks * (ai.sweepPerBlock ?? 0.6),
    normal: ai.wNormal ?? 3,
  };
  const total = w.flurry + w.cross + w.sweep + w.normal;
  let k = r * total;
  if ((k -= w.flurry) < 0) return { move: stand, attack: 'flurry1' };
  if ((k -= w.cross) < 0) return { move: stand, attack: 'cross1' };
  if ((k -= w.sweep) < 0) return { move: stand, attack: 'sweep' };
  const normals = ['slash', 'dslash1', 'backslash', 'sidestrike'];
  return { move: stand, attack: normals[Math.floor(nextFloat(world.rng) * normals.length)]! };
};
