import { SIM_DT } from '../core/loop';
import { normalize, type Vec2 } from '../core/math';
import type { ProjectileSpec, SimConfig } from './config';
import { addPlayerPosture, damagePlayer, gainPips, gainRage, rageHit, hitEnemy, inFrontCone, isPlayerInvulnerable, startHitstop } from './combat/damage';
import { moveAndSlide } from './physics/collide';
import { playerRadius, raging } from './stats';
import { emit, type Projectile, type World } from './world';

/**
 * Projectiles: Satan's hellfire bolts and archers' arrows. They fly straight,
 * die on walls (so pillars block arrows), and resolve against their targets.
 * Arrows meeting Satan's guard go through the same order as melee:
 *   i-frames -> deflect (reflects it back) -> block (stops it) -> hit.
 */
export function spawnProjectile(
  world: World,
  kind: Projectile['kind'],
  owner: Projectile['owner'],
  from: Vec2,
  dir: Vec2,
  spec: ProjectileSpec,
  dmg: { healthDamage: number; postureDamage: number; knockback: number; hitstop: number; shake: number },
  gates = true,
): Projectile {
  const d = normalize(dir);
  const p: Projectile = {
    id: world.nextId++,
    kind,
    owner,
    shooter: owner === 'player' ? null : owner,
    pos: { ...from },
    prevPos: { ...from },
    vel: { x: d.x * spec.speed, y: d.y * spec.speed },
    radius: spec.radius,
    life: spec.lifeFrames,
    ...dmg,
    reflected: false,
    gates,
    perfect: false,
  };
  world.projectiles.push(p);
  return p;
}

/** True while an enemy's arrow is in the air (counts as an attack in flight). `exceptShooter` ignores that enemy's own arrows. */
export function enemyArrowInFlight(world: World, exceptShooter?: number): boolean {
  return world.projectiles.some((p) => p.owner !== 'player' && p.owner !== exceptShooter && p.gates);
}

function end(world: World, p: Projectile): void {
  p.life = 0;
  emit(world, { type: 'projectileEnd', pos: { ...p.pos }, kind: p.kind, reflected: p.reflected });
}

export function updateProjectiles(world: World, cfg: SimConfig): void {
  for (const p of world.projectiles) {
    p.prevPos = { ...p.pos };
    p.life--;
    if (p.life <= 0) continue;
    const dx = p.vel.x * SIM_DT;
    const dy = p.vel.y * SIM_DT;
    const r = moveAndSlide(p.pos.x, p.pos.y, dx, dy, p.radius, world.segs, 1);
    // Check targets along the path (start, middle, end) so fast shots can't skip a body.
    const mid = { x: (p.pos.x + r.x) / 2, y: (p.pos.y + r.y) / 2 };
    const endPos = { x: r.x, y: r.y };
    let consumed = false;
    for (const at of [mid, endPos]) {
      if (consumed) break;
      if (p.owner === 'player') consumed = hitEnemiesAt(world, p, at, cfg);
      else consumed = hitPlayerAt(world, p, at, cfg);
    }
    if (p.life <= 0) continue;
    p.pos = endPos;
    if (!consumed && r.hit) end(world, p);
  }
  world.projectiles = world.projectiles.filter((p) => p.life > 0);
}

function hitEnemiesAt(world: World, p: Projectile, at: Vec2, cfg: SimConfig): boolean {
  for (const e of world.enemies) {
    if (e.phase === 'down') continue;
    if (Math.hypot(e.pos.x - at.x, e.pos.y - at.y) > e.radius + p.radius) continue;
    p.pos = { ...at };
    const dir = normalize(p.vel);
    const from = { x: at.x - dir.x * 12, y: at.y - dir.y * 12 };
    const def = cfg.enemies[e.type]!;
    // Satan's bolts hurt floaters' posture extra; their own deflected shots too.
    const postureMul = p.kind === 'bolt' ? (def.throwPostureMul ?? 1) : p.reflected && p.shooter === e.id ? (def.reflectPostureMul ?? 1) : 1;
    hitEnemy(world, e, from, dir, { healthDamage: p.healthDamage, postureDamage: p.postureDamage * postureMul, knockback: p.knockback, hitstop: p.hitstop, shake: p.shake, strong: p.perfect }, cfg);
    end(world, p);
    return true;
  }
  return false;
}

function hitPlayerAt(world: World, p: Projectile, at: Vec2, cfg: SimConfig): boolean {
  const pl = world.player;
  if (Math.hypot(pl.pos.x - at.x, pl.pos.y - at.y) > playerRadius(world, cfg) + p.radius) return false;
  if (isPlayerInvulnerable(pl, cfg)) return false; // dashes straight through arrows
  const c = cfg.combat;
  const dir = normalize(p.vel);
  const from = { x: at.x - dir.x * 12, y: at.y - dir.y * 12 };
  p.pos = { ...at };

  if (raging(pl)) {
    rageHit(world, p.healthDamage, dir, p.hitstop, p.shake, cfg);
    end(world, p);
    return true;
  }

  // Deflect: send it back at the archer.
  if (pl.broken === 0 && pl.parry && !pl.parry.deflected && pl.parry.frame <= pl.parry.window && inFrontCone(pl.pos, pl.facing, from, c.parry.coneDeg)) {
    const perfect = pl.parry.frame <= c.parry.perfectFrames;
    pl.parry.deflected = true; // spent: one press, one deflect
    pl.parryPenalty = 0;
    world.stats.deflects++;
    if (perfect) {
      world.stats.perfects++;
      gainPips(world, cfg.player.throw.perfectParryPips, cfg);
      gainRage(world, cfg.rage.gain.perfectParry, cfg);
    }
    startHitstop(world, perfect ? c.parry.perfectHitstop : c.parry.hitstop, perfect ? c.parry.perfectShake : c.parry.shake, cfg);
    emit(world, { type: 'deflect', pos: { ...at }, dir: { x: -dir.x, y: -dir.y }, perfect });
    reflect(world, p, perfect, cfg);
    return true;
  }
  // Block: stops the arrow, costs posture.
  if (pl.broken === 0 && pl.guarding && inFrontCone(pl.pos, pl.facing, from, c.block.coneDeg)) {
    pl.blockStun = c.block.stunFrames;
    startHitstop(world, c.block.hitstop, p.shake * 0.5, cfg);
    emit(world, { type: 'block', pos: { ...at }, dir });
    addPlayerPosture(world, p.postureDamage * c.block.postureMul, cfg);
    end(world, p);
    return true;
  }
  // Hit.
  damagePlayer(world, p.healthDamage, cfg);
  pl.hitFlash = c.hitFlashFrames;
  pl.hurtStun = Math.max(pl.hurtStun, Math.round(c.hurtStunFrames * 0.6));
  pl.action = null;
  pl.parry = null;
  pl.knock = { x: dir.x * p.knockback, y: dir.y * p.knockback };
  world.stats.hitsTaken++;
  startHitstop(world, p.hitstop, p.shake, cfg);
  emit(world, { type: 'playerHit', pos: { ...pl.pos }, dir });
  addPlayerPosture(world, p.postureDamage * c.hitPostureMul, cfg);
  end(world, p);
  return true;
}

function reflect(world: World, p: Projectile, perfect: boolean, cfg: SimConfig): void {
  const r = cfg.combat.reflect;
  const shooter = world.enemies.find((e) => e.id === p.shooter && e.phase !== 'down');
  const speed = Math.hypot(p.vel.x, p.vel.y) * (perfect ? r.perfectSpeedMul : r.speedMul);
  const aimAt = shooter ? shooter.pos : { x: p.pos.x - p.vel.x, y: p.pos.y - p.vel.y };
  const d = normalize({ x: aimAt.x - p.pos.x, y: aimAt.y - p.pos.y });
  p.vel = { x: d.x * speed, y: d.y * speed };
  p.owner = 'player';
  p.reflected = true;
  p.perfect = perfect;
  p.healthDamage = perfect ? r.perfectHealthDamage : r.healthDamage;
  p.postureDamage = perfect ? r.perfectPostureDamage : r.postureDamage;
  p.life = 120;
  // Nudge it clear of Satan so it doesn't re-collide.
  p.pos = { x: p.pos.x + d.x * 8, y: p.pos.y + d.y * 8 };
  emit(world, { type: 'reflect', pos: { ...p.pos }, perfect });
}
