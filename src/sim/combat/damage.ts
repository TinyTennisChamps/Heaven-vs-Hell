import { angleDiff, angleOf, DEG, normalize, type Vec2 } from '../../core/math';
import type { EnemyAttackDef, SimConfig } from '../config';
import { emit, type Enemy, type PlayerState, type World } from '../world';
import { maxHp, maxPips, maxPosture, raging } from '../stats';

export function isPlayerInvulnerable(p: PlayerState, cfg: SimConfig): boolean {
  if (p.dead) return true; // nothing more can happen to a fallen Satan
  if (p.rageTransform > 0) return true; // the transform itself can't be interrupted
  if (!p.dash) return false;
  return p.dash.frame >= cfg.player.dash.iFrameStart && p.dash.frame <= cfg.player.dash.iFrameEnd;
}

export function startHitstop(world: World, frames: number, shake: number, cfg: SimConfig): void {
  world.hitstop = Math.max(world.hitstop, frames);
  world.camera.shake = Math.min(cfg.camera.shakeMax, Math.max(world.camera.shake, shake));
}

/** Is `from` inside the frontal cone of something at `pos` facing `facing`? */
export function inFrontCone(pos: Vec2, facing: Vec2, from: Vec2, coneDeg: number): boolean {
  const to = { x: from.x - pos.x, y: from.y - pos.y };
  if (Math.hypot(to.x, to.y) < 1e-6) return true;
  return Math.abs(angleDiff(angleOf(facing), angleOf(to))) <= (coneDeg / 2) * DEG;
}

export interface HitSpec {
  healthDamage: number;
  postureDamage: number;
  knockback: number;
  hitstop: number;
  shake: number;
  strong?: boolean;
  /** Ignores shields (the Rage roar bursts all round). */
  ignoreShield?: boolean;
}

// ---------------------------------------------------------------- enemies

export function shieldUp(e: Enemy): boolean {
  return e.phase === 'idle' || e.phase === 'windup';
}

export function breakEnemy(world: World, e: Enemy, cfg: SimConfig): void {
  e.phase = 'broken';
  e.phaseFrame = 0;
  e.attack = null;
  e.posture = cfg.enemies[e.type]!.posture.max;
  startHitstop(world, cfg.combat.breakHitstop, 3, cfg);
  emit(world, { type: 'postureBreak', pos: { ...e.pos } });
}

export function addEnemyPosture(world: World, e: Enemy, amount: number, cfg: SimConfig): void {
  if (e.phase === 'broken' || e.phase === 'down') return;
  const def = cfg.enemies[e.type]!;
  if (def.noPosture) return;
  e.posture = Math.min(def.posture.max, e.posture + amount);
  e.sinceHit = 0;
  if (e.posture >= def.posture.max) breakEnemy(world, e, cfg);
}

export function killEnemy(world: World, e: Enemy, cfg: SimConfig): void {
  e.hp = 0;
  e.phase = 'down';
  e.phaseFrame = 0;
  e.attack = null;
  world.stats.kills++;
  emit(world, { type: 'enemyDown', pos: { ...e.pos } });
  const p = world.player;
  if (raging(p)) {
    // Feeding the Rage: each kill extends it and heals a little.
    p.rageForm += cfg.rage.killExtendFrames;
    p.hp = Math.min(maxHp(world, cfg), p.hp + cfg.rage.killHeal);
  } else gainRage(world, cfg.rage.gain.kill, cfg);
}

/** Fill the Rage meter (not while raging). Vials scale the gain. */
export function gainRage(world: World, amount: number, cfg: SimConfig): void {
  const p = world.player;
  if (raging(p) || p.rageTransform > 0 || p.dead) return;
  const max = cfg.rage.max;
  const was = p.rage;
  p.rage = Math.min(max, p.rage + amount * (1 + world.mods.rageGain));
  if (was < max && p.rage >= max) emit(world, { type: 'rageFull', pos: { ...p.pos } });
}

/** Satan's attack lands on an enemy. Returns 'shield' if the shield absorbed it. */
export function hitEnemy(world: World, e: Enemy, from: Vec2, dir: Vec2, spec: HitSpec, cfg: SimConfig): 'hit' | 'shield' {
  const def = cfg.enemies[e.type]!;
  e.hitFlash = cfg.combat.hitFlashFrames;
  e.sinceHit = 0;

  if (!spec.ignoreShield && def.shieldArcDeg > 0 && shieldUp(e) && inFrontCone(e.pos, e.facing, from, def.shieldArcDeg)) {
    e.blockedHits++;
    e.shieldFlash = 6;
    e.hitFlash = 0;
    e.knock = { x: dir.x * spec.knockback * 0.3, y: dir.y * spec.knockback * 0.3 };
    startHitstop(world, Math.max(2, spec.hitstop - 1), spec.shake * 0.6, cfg);
    emit(world, { type: 'shieldBlock', pos: { x: (e.pos.x + from.x) / 2, y: (e.pos.y + from.y) / 2 }, dir: { ...dir } });
    addEnemyPosture(world, e, spec.postureDamage * def.shieldPostureMul, cfg);
    return 'shield';
  }

  const riposte = e.phase === 'recoil';
  const r = cfg.combat.riposte;
  e.hp -= spec.healthDamage * (riposte ? r.healthMul : 1);
  e.knock = { x: dir.x * spec.knockback, y: dir.y * spec.knockback };
  world.stats.hitsLanded++;
  startHitstop(world, spec.hitstop + (riposte ? 2 : 0), spec.shake * (riposte ? 1.4 : 1), cfg);
  emit(world, { type: 'hit', pos: { ...e.pos }, dir: { ...dir }, strong: !!spec.strong || riposte, riposte });
  if (e.hp <= 0) {
    killEnemy(world, e, cfg);
    return 'hit';
  }
  addEnemyPosture(world, e, spec.postureDamage * (riposte ? r.postureMul : 1), cfg);
  return 'hit';
}

// ---------------------------------------------------------------- player

export type HitOutcome = 'evaded' | 'perfect' | 'deflect' | 'block' | 'hit';

export function addPlayerPosture(world: World, amount: number, cfg: SimConfig): void {
  const p = world.player;
  if (p.broken > 0 || raging(p)) return; // Rage: hyper armour, no posture
  const max = maxPosture(world, cfg);
  p.posture = Math.min(max, p.posture + amount);
  p.sinceHit = 0;
  if (p.posture >= max) {
    p.broken = cfg.player.posture.breakStunFrames;
    p.action = null;
    p.parry = null;
    p.guarding = false;
    startHitstop(world, cfg.combat.breakHitstop, 3, cfg);
    emit(world, { type: 'playerBroken', pos: { ...p.pos } });
  }
}

/**
 * An enemy attack reaches Satan. Resolution order:
 *   i-frames -> judgement (skips guard; `deflectable` ones still allow the deflect) -> deflect window -> block cone -> hit.
 */
export function resolveOnPlayer(world: World, attacker: Enemy, atk: EnemyAttackDef, cfg: SimConfig): HitOutcome {
  const p = world.player;
  if (isPlayerInvulnerable(p, cfg)) return 'evaded';
  const c = cfg.combat;
  const dir = normalize({ x: p.pos.x - attacker.pos.x, y: p.pos.y - attacker.pos.y });
  if (raging(p)) {
    rageHit(world, atk.healthDamage, dir, atk.hitstop, atk.shake, cfg);
    return 'hit';
  }
  const canGuard = !atk.judgement && p.broken === 0;
  const canDeflect = (!atk.judgement || !!atk.deflectable) && p.broken === 0;

  // Deflect: any tick inside the window, attacker in front.
  if (canDeflect && p.parry && p.parry.frame <= p.parry.window && inFrontCone(p.pos, p.facing, attacker.pos, c.parry.coneDeg)) {
    const perfect = p.parry.frame <= c.parry.perfectFrames;
    p.parry.deflected = true;
    p.parryPenalty = 0;
    world.stats.deflects++;
    if (perfect) {
      world.stats.perfects++;
      gainPips(world, cfg.player.throw.perfectParryPips, cfg);
      gainRage(world, cfg.rage.gain.perfectParry, cfg);
    }
    startHitstop(world, perfect ? c.parry.perfectHitstop : c.parry.hitstop, perfect ? c.parry.perfectShake : c.parry.shake, cfg);
    emit(world, { type: 'deflect', pos: { x: (p.pos.x + attacker.pos.x) / 2, y: (p.pos.y + attacker.pos.y) / 2 }, dir, perfect });
    addPlayerPosture(world, atk.postureDamage * (perfect ? c.parry.perfectSelfPostureMul : c.parry.selfPostureMul), cfg);
    // The attacker is knocked back by the deflect — harder on a perfect one.
    const kb = perfect ? c.parry.perfectRecoil : c.parry.recoil;
    attacker.knock = { x: -dir.x * kb, y: -dir.y * kb };
    addEnemyPosture(world, attacker, atk.postureDamage * (perfect ? c.parry.perfectAttackerPostureMul : c.parry.attackerPostureMul), cfg);
    if (perfect && attacker.phase !== 'broken' && attacker.phase !== 'down') {
      // Riposte: a perfect read staggers the attacker and opens it up.
      attacker.phase = 'recoil';
      attacker.phaseFrame = 0;
      attacker.attack = null;
      emit(world, { type: 'riposteOpen', pos: { ...attacker.pos } });
    }
    return perfect ? 'perfect' : 'deflect';
  }

  // Block: guard held, attacker inside the front cone.
  if (canGuard && p.guarding && inFrontCone(p.pos, p.facing, attacker.pos, c.block.coneDeg)) {
    p.blockStun = c.block.stunFrames;
    p.knock = { x: dir.x * c.block.knockback, y: dir.y * c.block.knockback };
    startHitstop(world, c.block.hitstop, atk.shake * 0.5, cfg);
    emit(world, { type: 'block', pos: { x: (p.pos.x + attacker.pos.x) / 2, y: (p.pos.y + attacker.pos.y) / 2 }, dir });
    addPlayerPosture(world, atk.postureDamage * c.block.postureMul, cfg);
    return 'block';
  }

  // Clean hit.
  damagePlayer(world, atk.healthDamage, cfg);
  p.hitFlash = c.hitFlashFrames;
  p.hurtStun = Math.max(p.hurtStun, c.hurtStunFrames);
  p.action = null;
  p.parry = null;
  p.knock = { x: dir.x * atk.knockback, y: dir.y * atk.knockback };
  world.stats.hitsTaken++;
  startHitstop(world, atk.hitstop, atk.shake, cfg);
  emit(world, { type: 'playerHit', pos: { ...p.pos }, dir });
  addPlayerPosture(world, atk.postureDamage * c.hitPostureMul, cfg);
  return 'hit';
}

/**
 * Hyper armour in Rage form: reduced damage, no stagger, no knockback, no
 * posture, and the claws keep going.
 */
export function rageHit(world: World, healthDamage: number, dir: { x: number; y: number }, hitstop: number, shake: number, cfg: SimConfig): void {
  const p = world.player;
  damagePlayer(world, Math.max(1, Math.round(healthDamage * cfg.rage.damageTakenMul)), cfg);
  p.hitFlash = cfg.combat.hitFlashFrames;
  world.stats.hitsTaken++;
  startHitstop(world, Math.max(1, Math.round(hitstop / 2)), shake * 0.6, cfg);
  emit(world, { type: 'playerHit', pos: { ...p.pos }, dir: { x: dir.x, y: dir.y } });
}

/** Health loss on Satan. At 0 he falls (or, with flags.immortal, e.g. training, refills). */
export function damagePlayer(world: World, amount: number, cfg: SimConfig): void {
  const p = world.player;
  p.hp -= amount;
  if (!raging(p)) gainRage(world, cfg.rage.gain.hitTaken, cfg);
  if (p.hp > 0) return;
  if (world.flags.immortal) {
    p.hp = maxHp(world, cfg);
    return;
  }
  p.hp = 0;
  p.dead = true;
  p.action = null;
  p.dash = null;
  p.parry = null;
  p.guarding = false;
  p.lockId = null;
  p.rageForm = 0;
  p.rageTransform = 0;
  emit(world, { type: 'playerDied', pos: { ...p.pos } });
}

// ---------------------------------------------------------------- throw pips

export function gainPips(world: World, n: number, cfg: SimConfig): void {
  const pl = world.player;
  const before = pl.pips;
  pl.pips = Math.min(maxPips(world, cfg), pl.pips + n);
  if (pl.pips > before) emit(world, { type: 'pipGained', pos: { ...pl.pos } });
}

/** Every `hitsPerPip` melee hits that land (not shield-blocked) refill one pip. */
export function meleeHitLanded(world: World, cfg: SimConfig): void {
  const pl = world.player;
  pl.pipProgress++;
  if (pl.pipProgress >= cfg.player.throw.hitsPerPip) {
    pl.pipProgress = 0;
    gainPips(world, 1, cfg);
  }
}
