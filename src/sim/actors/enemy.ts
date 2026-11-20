import { SIM_DT } from '../../core/loop';
import { angleDiff, angleOf, DEG, easeOutQuad, fromAngle, normalize, type Vec2 } from '../../core/math';
import { nextFloat, nextRange } from '../../core/rng';
import type { EnemyAttackDef, EnemyDef, SimConfig } from '../config';
import { arcHitsCircle } from '../combat/hitbox';
import { resolveOnPlayer } from '../combat/damage';
import { regenPosture } from '../combat/posture';
import { moveAndSlide } from '../physics/collide';
import { emit, type Enemy, type World } from '../world';

/**
 * Shared enemy runner: timers, posture, broken/down states, attack frame data
 * (windup with tracking -> lock -> active hit check -> recovery/chain), turning,
 * knockback and collision. Per-type "think" functions only decide what to do
 * while idle — this keeps every enemy's telegraphs and timings data-driven.
 */
export type Think = (world: World, e: Enemy, def: EnemyDef, cfg: SimConfig) => { move: Vec2; attack: string | null };

export function enemyAttack(cfg: SimConfig, e: Enemy): EnemyAttackDef | null {
  if (!e.attack) return null;
  return cfg.enemies[e.type]!.attacks[e.attack] ?? null;
}

function setPhase(e: Enemy, phase: Enemy['phase']): void {
  e.phase = phase;
  e.phaseFrame = 0;
}

function turnToward(e: Enemy, dir: Vec2, maxDeg: number): void {
  if (Math.hypot(dir.x, dir.y) < 1e-6) return;
  const a = angleOf(e.facing);
  const d = angleDiff(a, angleOf(dir));
  const m = maxDeg * DEG;
  e.facing = fromAngle(a + Math.max(-m, Math.min(m, d)));
}

export function startEnemyAttack(world: World, e: Enemy, key: string, cfg: SimConfig): void {
  const atk = cfg.enemies[e.type]!.attacks[key];
  if (!atk) return;
  e.attack = key;
  e.swingHit = false;
  e.attackDir = { ...e.facing };
  setPhase(e, 'windup');
  emit(world, { type: 'telegraph', pos: { ...e.pos }, judgement: !!atk.judgement });
}

export function updateEnemy(world: World, e: Enemy, cfg: SimConfig, think: Think): void {
  const def = cfg.enemies[e.type]!;
  const p = world.player;
  if (e.hitFlash > 0) e.hitFlash--;
  if (e.shieldFlash > 0) e.shieldFlash--;
  if (e.cooldown > 0) e.cooldown--;
  e.phaseFrame++;

  if (e.phase === 'down') {
    if (world.flags.respawn && e.phaseFrame >= def.respawnFrames) {
      e.hp = e.maxHp = def.health;
      e.posture = 0;
      e.pos = { ...e.spawn };
      e.prevPos = { ...e.spawn };
      e.knock = { x: 0, y: 0 };
      e.blockedHits = 0;
      e.cooldown = Math.round(nextRange(world.rng, def.cooldownMin, def.cooldownMax));
      setPhase(e, 'idle');
    }
    // Let the body slide from the final blow.
    moveBody(world, e, { x: 0, y: 0 }, cfg);
    return;
  }

  if (e.phase !== 'broken') {
    e.sinceHit++;
    e.posture = regenPosture(e.posture, e.sinceHit, e.hp, e.maxHp, def.posture);
  }

  const toP = normalize({ x: p.pos.x - e.pos.x, y: p.pos.y - e.pos.y });
  let move: Vec2 = { x: 0, y: 0 };
  let lungeDelta: Vec2 = { x: 0, y: 0 };

  switch (e.phase) {
    case 'broken':
      if (e.phaseFrame >= def.brokenFrames) {
        // Survived the opening: recover with posture partly restored.
        e.posture = def.posture.max * 0.5;
        e.sinceHit = 0;
        setPhase(e, 'idle');
        e.cooldown = def.cooldownMin;
      }
      break;
    case 'idle': {
      turnToward(e, toP, def.turnRateDeg);
      const plan = think(world, e, def, cfg);
      move = plan.move;
      if (plan.attack) startEnemyAttack(world, e, plan.attack, cfg);
      break;
    }
    case 'windup': {
      const atk = enemyAttack(cfg, e)!;
      if (e.phaseFrame <= atk.trackUntil) {
        turnToward(e, toP, Math.max(def.turnRateDeg, 8));
        e.attackDir = { ...e.facing };
      }
      if (e.phaseFrame >= atk.windup) setPhase(e, 'active');
      break;
    }
    case 'active': {
      const atk = enemyAttack(cfg, e)!;
      if (atk.lunge) {
        const n = Math.max(1, atk.lunge.overFrames);
        const f = Math.min(e.phaseFrame, n);
        const s = f <= n ? atk.lunge.px * (easeOutQuad(f / n) - easeOutQuad((f - 1) / n)) : 0;
        lungeDelta = { x: e.attackDir.x * s, y: e.attackDir.y * s };
      }
      if (!e.swingHit && arcHitsCircle(e.pos, e.attackDir, atk.hitbox, p.pos, cfg.player.radius)) {
        const out = resolveOnPlayer(world, e, atk, cfg);
        if (out !== 'evaded') e.swingHit = true;
      }
      if (e.phaseFrame >= atk.active && (e.phase as string) === 'active') setPhase(e, 'recover');
      break;
    }
    case 'recover': {
      const atk = enemyAttack(cfg, e)!;
      if (e.phaseFrame >= atk.recovery) {
        e.attack = null;
        setPhase(e, 'idle');
        e.cooldown = Math.round(nextRange(world.rng, def.cooldownMin, def.cooldownMax));
      } else if (atk.chain && e.phaseFrame === Math.floor(atk.recovery / 3)) {
        // Decide once, early in recovery, whether this becomes a 2-hit string.
        if (nextFloat(world.rng) < atk.chain.chance) startEnemyAttack(world, e, atk.chain.next, cfg);
      }
      break;
    }
  }

  moveBody(world, e, move, cfg, lungeDelta);
}

function moveBody(world: World, e: Enemy, vel: Vec2, cfg: SimConfig, extra: Vec2 = { x: 0, y: 0 }): void {
  const dx = (vel.x + e.knock.x) * SIM_DT + extra.x;
  const dy = (vel.y + e.knock.y) * SIM_DT + extra.y;
  e.knock.x *= cfg.combat.knockbackFriction;
  e.knock.y *= cfg.combat.knockbackFriction;
  if (Math.hypot(e.knock.x, e.knock.y) < 2) e.knock = { x: 0, y: 0 };
  e.vel = { ...vel };
  const r = moveAndSlide(e.pos.x, e.pos.y, dx, dy, e.radius, world.segs);
  e.pos.x = r.x;
  e.pos.y = r.y;
}
