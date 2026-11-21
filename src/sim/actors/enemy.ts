import { SIM_DT } from '../../core/loop';
import { angleDiff, angleOf, DEG, easeOutQuad, fromAngle, normalize, type Vec2 } from '../../core/math';
import { nextFloat, nextRange } from '../../core/rng';
import type { EnemyAttackDef, EnemyDef, SimConfig } from '../config';
import { arcHitsCircle } from '../combat/hitbox';
import { inFrontCone, resolveOnPlayer } from '../combat/damage';
import { regenPosture } from '../combat/posture';
import { moveAndSlide } from '../physics/collide';
import { enemyArrowInFlight, spawnProjectile } from '../projectiles';
import { playerRadius } from '../stats';
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
  e.engage = false;
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
  if (e.specialCooldown > 0) e.specialCooldown--;
  e.phaseFrame++;

  if (e.arrive > 0) {
    // Spawning in: visible, harmless, not yet thinking.
    e.arrive--;
    turnToward(e, normalize({ x: p.pos.x - e.pos.x, y: p.pos.y - e.pos.y }), 90);
    return;
  }

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
    case 'recoil':
      if (e.phaseFrame >= cfg.combat.riposte.frames) {
        setPhase(e, 'idle');
        e.cooldown = Math.round(def.cooldownMin * 0.5);
      }
      break;
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
      // Shielded enemies pivot faster when Satan gets round the side or back.
      const flanked = def.shieldArcDeg > 0 && !inFrontCone(e.pos, e.facing, p.pos, def.shieldArcDeg);
      const near = Math.hypot(p.pos.x - e.pos.x, p.pos.y - e.pos.y) <= (def.flankSpin?.range ?? 0);
      e.flankTicks = flanked && near ? e.flankTicks + 1 : 0;
      turnToward(e, toP, flanked ? (def.flankTurnRateDeg ?? def.turnRateDeg) : def.turnRateDeg);
      const plan = think(world, e, def, cfg);
      move = plan.move;
      if (def.swarm) {
        // Swarmers have their own pool: up to swarmMax lunge at once, regardless of focus.
        e.engage = false;
        if (plan.attack && swarmAttacking(world, cfg) >= cfg.combat.groups.swarmMax) {
          plan.attack = null;
          e.cooldown = Math.round(nextRange(world.rng, 8, 30));
        }
      } else if (world.focusId !== null && world.focusId !== e.id) {
        // Not the focus: hang back, and only now and then get a turn to step
        // in and attack — never while anyone else's attack is in flight.
        if (!e.engage) {
          move = holdBackMove(world, e, def, cfg);
          plan.attack = null;
          if (e.cooldown <= 0) {
            if (world.flags.dummyAttacks && nextFloat(world.rng) < cfg.combat.groups.supportAttackChance) e.engage = true;
            else e.cooldown = Math.round(def.cooldownMin * cfg.combat.groups.supportCooldownMul);
          }
        } else if (plan.attack && !noAttackInFlight(world, e, plan.attack, cfg)) {
          plan.attack = null; // wait for the opening, keep approaching
        }
      } else {
        e.engage = false;
        // The focus attacks freely, but never into a supporter's swing already in flight.
        if (plan.attack && (enemyArrowInFlight(world, e.id) || world.enemies.some((o) => o.id !== e.id && isBusy(o, cfg)))) plan.attack = null;
      }
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
      if (atk.projectile) {
        if (!e.swingHit) {
          e.swingHit = true;
          const from = { x: e.pos.x + e.attackDir.x * (e.radius + 4), y: e.pos.y + e.attackDir.y * (e.radius + 4) };
          spawnProjectile(world, 'arrow', e.id, from, e.attackDir, atk.projectile, atk);
          emit(world, { type: 'arrowLoosed', pos: from });
        }
      } else if (!e.swingHit && arcHitsCircle(e.pos, e.attackDir, atk.hitbox, p.pos, playerRadius(world, cfg))) {
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
        // Decide once, early in recovery, whether this becomes a 2-hit string —
        // but never into another enemy's attack or arrow already in flight.
        const othersBusy = !def.swarm && (enemyArrowInFlight(world, e.id) || world.enemies.some((o) => o.id !== e.id && isBusy(o, cfg)));
        if (!othersBusy && nextFloat(world.rng) < atk.chain.chance) startEnemyAttack(world, e, atk.chain.next, cfg);
      }
      break;
    }
  }

  moveBody(world, e, move, cfg, lungeDelta);
}

/** A non-swarm enemy with an attack in flight (swarm lunges run in their own pool). */
function isBusy(o: Enemy, cfg: SimConfig): boolean {
  return (o.phase === 'windup' || o.phase === 'active') && !cfg.enemies[o.type]!.swarm;
}

function swarmAttacking(world: World, cfg: SimConfig): number {
  let n = 0;
  for (const o of world.enemies) if ((o.phase === 'windup' || o.phase === 'active') && cfg.enemies[o.type]!.swarm) n++;
  return n;
}

function holdBackMove(world: World, e: Enemy, def: EnemyDef, cfg: SimConfig): Vec2 {
  const g = cfg.combat.groups;
  const p = world.player.pos;
  const to = { x: p.x - e.pos.x, y: p.y - e.pos.y };
  const d = Math.hypot(to.x, to.y);
  const dir = normalize(to);
  const sp = def.speed * g.holdBackSpeedMul;
  const want = Math.max(g.holdBackDistance, def.preferredRange ?? 0);
  if (d < want - 8) return { x: -dir.x * sp, y: -dir.y * sp };
  if (d > want + 12) return { x: dir.x * sp, y: dir.y * sp };
  // Circle slowly at the edge, direction fixed per enemy so they spread out.
  const side = e.id % 2 === 0 ? 1 : -1;
  return { x: -dir.y * sp * 0.5 * side, y: dir.x * sp * 0.5 * side };
}

function noAttackInFlight(world: World, e: Enemy, key: string, cfg: SimConfig): boolean {
  const atk = cfg.enemies[e.type]!.attacks[key];
  if (!atk) return false;
  if (enemyArrowInFlight(world, e.id)) return false;
  for (const o of world.enemies) {
    if (o.id === e.id) continue;
    if (isBusy(o, cfg)) return false;
    // Don't start if the focus could start its own swing before ours lands.
    if (o.id === world.focusId && o.phase === 'idle' && o.cooldown < atk.windup + atk.active) return false;
  }
  return true;
}

function moveBody(world: World, e: Enemy, vel: Vec2, cfg: SimConfig, extra: Vec2 = { x: 0, y: 0 }): void {
  // Unstick: walking into a wall head-on gets nowhere (no slide), so after a
  // few blocked ticks steer sideways around it — one way, then the other.
  if (e.stuck > 6 && (vel.x !== 0 || vel.y !== 0)) {
    const side = (e.id + Math.floor(e.stuck / 90)) % 2 === 0 ? 1 : -1;
    vel = { x: -vel.y * side, y: vel.x * side };
  }
  const want = Math.hypot(vel.x, vel.y) * SIM_DT;
  const before = { x: e.pos.x, y: e.pos.y };
  const dx = (vel.x + e.knock.x) * SIM_DT + extra.x;
  const dy = (vel.y + e.knock.y) * SIM_DT + extra.y;
  e.knock.x *= cfg.combat.knockbackFriction;
  e.knock.y *= cfg.combat.knockbackFriction;
  if (Math.hypot(e.knock.x, e.knock.y) < 2) e.knock = { x: 0, y: 0 };
  e.vel = { ...vel };
  const r = moveAndSlide(e.pos.x, e.pos.y, dx, dy, e.radius, world.segs);
  e.pos.x = r.x;
  e.pos.y = r.y;
  const moved = Math.hypot(e.pos.x - before.x, e.pos.y - before.y);
  if (want > 0.2 && moved < want * 0.3) e.stuck++;
  else if (e.stuck > 0 && moved >= want * 0.6) e.stuck = e.stuck > 6 ? e.stuck - 1 : 0;
}
