import { normalize } from '../../core/math';
import { nextFloat } from '../../core/rng';
import type { Think } from './enemy';

/**
 * Raphael, the Healer-Knight (L2 boss). Two segments. He fights from the
 * sanctified light when he can (faster posture recovery), sweeps wide,
 * cleaves overhead (very rewarding to deflect), lunges with the Serpent Staff
 * (Judgement: dash it), and when his posture runs high kneels into the Mending
 * Rite — a long channel that restores 40% posture unless you strike him and
 * cut it short. Phase 2: the sweep doubles, the Rite also heals 10% health,
 * and once he calls two Grigori to his side.
 */
export const thinkRaphael: Think = (world, e, def) => {
  if (!world.flags.dummyAttacks) return { move: { x: 0, y: 0 }, attack: null };
  const ai = def.ai ?? {};
  const phase2 = e.segments < (def.segments ?? 1);
  const p = world.player.pos;
  const to = { x: p.x - e.pos.x, y: p.y - e.pos.y };
  const dist = Math.hypot(to.x, to.y);
  const dir = normalize(to);
  const A = def.attacks;
  const stand = { x: 0, y: 0 };

  // Drift toward a nearby pool of sanctified light between exchanges.
  let move = dist > 40 ? { x: dir.x * def.speed, y: dir.y * def.speed } : { x: 0, y: 0 };
  const pools = world.zones.list.filter((z) => z.intensity > 0.5);
  const inPool = pools.some((z) => Math.hypot(e.pos.x - z.pos.x, e.pos.y - z.pos.y) <= z.radius * 0.8);
  if (!inPool && dist > 50) {
    const near = pools.map((z) => ({ z, d: Math.hypot(e.pos.x - z.pos.x, e.pos.y - z.pos.y) })).sort((a, b) => a.d - b.d)[0];
    if (near && near.d < (ai.zoneSeek ?? 120)) {
      const zd = normalize({ x: near.z.pos.x - e.pos.x, y: near.z.pos.y - e.pos.y });
      move = { x: zd.x * def.speed, y: zd.y * def.speed };
    }
  }

  if (e.cooldown > 0) return { move, attack: null };
  if (phase2 && !e.cds.summon) return { move: stand, attack: 'summon' };
  // Badly shaken: mend (unless Satan is right on him).
  if (e.posture > e.postureMax * (ai.riteAt ?? 0.45) && !e.cds.rite && dist > 46) return { move: stand, attack: 'rite' };

  const r = nextFloat(world.rng);
  if (dist > (ai.serpentMin ?? 64)) {
    if (dist <= A.serpent!.range && r < 0.45) return { move: stand, attack: 'serpent' };
    return { move, attack: null };
  }
  if (dist <= A.cleave!.range && r < 0.35) return { move: stand, attack: 'cleave' };
  if (dist <= A.sweep!.range) return { move: stand, attack: phase2 ? 'sweepA' : 'sweep' };
  return { move, attack: null };
};
