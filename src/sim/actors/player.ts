import { SIM_DT } from '../../core/loop';
import { groundToScreen, screenToGround } from '../../core/iso';
import { easeOutQuad, moveToward, normalize, type Vec2 } from '../../core/math';
import type { AttackDef, SimConfig } from '../config';
import { arcHitsCircle, assistAim } from '../combat/hitbox';
import { hitEnemy, killEnemy, startHitstop } from '../combat/damage';
import { regenPosture } from '../combat/posture';
import { moveAndSlide } from '../physics/collide';
import { emit, type AttackState, type Enemy, type PlayerState, type World } from '../world';

export { isPlayerInvulnerable } from '../combat/damage';

export function attackDef(cfg: SimConfig, key: string): AttackDef {
  const d = cfg.attacks[key];
  if (!d) throw new Error(`missing attack ${key}`);
  return d;
}

export type AttackPhase = 'startup' | 'active' | 'recovery';

export function attackPhase(a: AttackState, d: AttackDef): AttackPhase {
  if (a.frame <= d.startup) return 'startup';
  if (a.frame <= d.startup + d.active) return 'active';
  return 'recovery';
}

/**
 * Screen-aligned WASD -> ground-plane unit direction (W = up the screen).
 * Also returns a speed multiplier so screen-vertical motion can be compensated
 * for iso foreshortening (feel.verticalSpeedComp, 1 = physically flat plane).
 */
export function moveIntent(move: Vec2, verticalComp: number): { dir: Vec2; speedMul: number } {
  if (move.x === 0 && move.y === 0) return { dir: { x: 0, y: 0 }, speedMul: 1 };
  const dir = normalize(screenToGround(move.x, move.y));
  const s = groundToScreen(dir.x, dir.y);
  const vertFrac = Math.abs(s.y) / (Math.hypot(s.x, s.y) || 1);
  return { dir, speedMul: 1 + (verticalComp - 1) * vertFrac };
}

/**
 * Cancel checks look at the frame about to run this tick (frame + 1), so a
 * buffered input fires on the very first recovery frame, not one tick late.
 */
function inRecoveryNext(p: PlayerState, cfg: SimConfig): boolean {
  if (!p.action) return true;
  const d = attackDef(cfg, p.action.key);
  return p.action.frame + 1 - d.startup - d.active >= 1;
}

function locked(p: PlayerState): boolean {
  return p.hurtStun > 0 || p.broken > 0;
}

function canDash(p: PlayerState, cfg: SimConfig): boolean {
  if (p.dash || p.dashEndLag > 0 || locked(p)) return false;
  const b = cfg.combat.block;
  if (p.blockStun > Math.max(0, b.stunFrames - b.dashAfter)) return false;
  return inRecoveryNext(p, cfg);
}

function canParry(p: PlayerState, cfg: SimConfig): boolean {
  if (p.dash || locked(p)) return false;
  return inRecoveryNext(p, cfg);
}

function canStartAttack(p: PlayerState, cfg: SimConfig): boolean {
  if (p.dash || locked(p) || p.blockStun > 0) return false;
  if (p.parry && p.parry.frame < p.parry.window) return false;
  if (!p.action) return true;
  const d = attackDef(cfg, p.action.key);
  return p.action.frame + 1 - d.startup - d.active >= d.chainAt;
}

/** Nearest posture-broken enemy within deathblow reach. */
function deathblowTarget(world: World, cfg: SimConfig): Enemy | null {
  const p = world.player;
  let best: Enemy | null = null;
  let bestD = Infinity;
  for (const e of world.enemies) {
    if (e.phase !== 'broken') continue;
    const d = Math.hypot(e.pos.x - p.pos.x, e.pos.y - p.pos.y) - e.radius;
    if (d <= cfg.combat.deathblow.range && d < bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/**
 * The enemy whose attack will land soonest, within range: anything already
 * active first, then the windup closest to completion; ties go to the nearer one.
 */
export function imminentThreat(world: World, cfg: SimConfig): Enemy | null {
  const p = world.player;
  let best: Enemy | null = null;
  let bestScore = Infinity;
  for (const e of world.enemies) {
    if (e.phase !== 'windup' && e.phase !== 'active') continue;
    const atk = e.attack ? cfg.enemies[e.type]!.attacks[e.attack] : undefined;
    if (!atk) continue;
    const d = Math.hypot(e.pos.x - p.pos.x, e.pos.y - p.pos.y);
    if (d > cfg.combat.autoFace.range) continue;
    const ticksLeft = e.phase === 'active' ? 0 : atk.windup - e.phaseFrame;
    const score = ticksLeft * 1000 + d;
    if (score < bestScore) {
      best = e;
      bestScore = score;
    }
  }
  return best;
}

export interface PlayerInput {
  move: Vec2;
  /** Right mouse held (guard). */
  guardHeld: boolean;
}

/**
 * One tick of player logic: buffered starts (dash > parry > attack/deathblow),
 * parry/guard state, frame data, hit detection, posture, movement and collision.
 */
export function updatePlayer(world: World, inp: PlayerInput, aim: Vec2 | null, cfg: SimConfig): void {
  const p = world.player;
  const buf = world.buffer;
  const dashCfg = cfg.player.dash;
  const c = cfg.combat;

  if (p.hitFlash > 0) p.hitFlash--;
  if (p.comboTimer > 0) p.comboTimer--;
  if (p.hurtStun > 0) p.hurtStun--;
  if (p.dashEndLag > 0) p.dashEndLag--;
  if (!p.dash && p.sinceDash < 9999) p.sinceDash++;
  if (p.blockStun > 0) p.blockStun--;
  if (p.parryPenalty > 0) p.parryPenalty--;
  if (p.broken > 0) {
    p.broken--;
    if (p.broken === 0) p.posture = 0;
  } else {
    p.sinceHit++;
    p.posture = regenPosture(p.posture, p.sinceHit, p.hp, cfg.player.maxHealth, cfg.player.posture);
  }

  const intent = moveIntent(inp.move, cfg.feel.verticalSpeedComp);
  const aimDir = aim ?? p.facing;
  const targets = world.enemies.filter((e) => e.phase !== 'down');

  // --- Starts (buffered). Priority: dash > parry > attack. ---
  if (buf.has('dash') && canDash(p, cfg)) {
    buf.consume('dash');
    const dir = intent.dir.x !== 0 || intent.dir.y !== 0 ? intent.dir : aimDir;
    p.action = null;
    p.parry = null;
    p.guarding = false;
    // Anti-spam: chaining dashes back-to-back loses the i-frames.
    const iframes = p.sinceDash > dashCfg.spamWindowFrames;
    p.dash = { frame: 0, dir: { ...dir }, iframes };
    p.vel = { x: 0, y: 0 };
    emit(world, { type: 'dash', pos: { ...p.pos }, dir: { ...dir }, tired: !iframes });
  }
  if (buf.has('parry') && canParry(p, cfg)) {
    buf.consume('parry');
    // Re-pressing during a window that hasn't deflected anything is mashing.
    if (p.parry && !p.parry.deflected) p.parryPenalty = c.parry.whiffPenaltyFrames;
    const window = p.parryPenalty > 0 ? c.parry.penalizedWindowFrames : c.parry.windowFrames;
    p.action = null;
    p.parry = { frame: 0, window, deflected: false };
  }
  if (buf.has('slash') && canStartAttack(p, cfg)) {
    buf.consume('slash');
    p.parry = null;
    p.guarding = false;
    p.dashEndLag = 0;
    const target = deathblowTarget(world, cfg);
    if (target) {
      const dir = normalize({ x: target.pos.x - p.pos.x, y: target.pos.y - p.pos.y });
      p.action = { key: 'deathblow', step: 0, frame: 0, dir, hitIds: [], targetId: target.id };
    } else {
      const step = p.action && p.action.step > 0 ? (p.action.step % 3) + 1 : p.comboTimer > 0 ? (p.lastStep % 3) + 1 : 1;
      p.action = { key: `slash${step}`, step, frame: 0, dir: assistAim(p.pos, aimDir, targets, c.aimAssist), hitIds: [] };
    }
    emit(world, { type: 'swing', pos: { ...p.pos }, dir: { ...p.action.dir }, step: p.action.step });
  }

  // --- Parry window / guard ---
  if (p.parry) {
    p.parry.frame++;
    if (p.parry.frame > p.parry.window) {
      if (!p.parry.deflected) {
        p.parryPenalty = c.parry.whiffPenaltyFrames;
        emit(world, { type: 'parryWhiff', pos: { ...p.pos } });
      }
      p.parry = null;
    }
  }
  p.guarding = inp.guardHeld && !p.parry && !p.dash && !p.action && !locked(p);
  if (p.parry || p.guarding) {
    // Guard faces the incoming attack, not the cursor: parrying is about timing.
    const threat = c.autoFace.enabled ? imminentThreat(world, cfg) : null;
    if (threat) p.facing = normalize({ x: threat.pos.x - p.pos.x, y: threat.pos.y - p.pos.y });
    else if (aim) p.facing = { ...aim };
  }

  let dx = 0;
  let dy = 0;

  if (p.dash) {
    const d = p.dash;
    d.frame++;
    const n = Math.max(1, dashCfg.frames);
    const s = dashCfg.distance * (easeOutQuad(d.frame / n) - easeOutQuad((d.frame - 1) / n));
    dx += d.dir.x * s;
    dy += d.dir.y * s;
    p.facing = { ...d.dir };
    if (d.frame >= n) {
      p.dash = null;
      p.sinceDash = 0;
      p.dashEndLag = dashCfg.endLag;
      const exit = cfg.player.maxSpeed * dashCfg.exitSpeedMul;
      p.vel = { x: d.dir.x * exit, y: d.dir.y * exit };
    }
  } else {
    let speedMul = 1;
    const a = p.action;
    if (a) {
      const def = attackDef(cfg, a.key);
      a.frame++;
      if (a.frame <= def.startup && a.key !== 'deathblow') a.dir = assistAim(p.pos, aimDir, targets, c.aimAssist);
      p.facing = { ...a.dir };
      speedMul = def.moveSpeedMul;

      const over = Math.max(1, def.lunge.overFrames);
      if (a.frame <= over) {
        const l = def.lunge.px * (easeOutQuad(a.frame / over) - easeOutQuad((a.frame - 1) / over));
        dx += a.dir.x * l;
        dy += a.dir.y * l;
      }

      if (attackPhase(a, def) === 'active') {
        if (a.key === 'deathblow') {
          const t = world.enemies.find((e) => e.id === a.targetId);
          if (t && t.phase === 'broken' && !a.hitIds.includes(t.id)) {
            a.hitIds.push(t.id);
            killEnemy(world, t);
            world.stats.deathblows++;
            t.knock = { x: a.dir.x * def.knockback, y: a.dir.y * def.knockback };
            startHitstop(world, c.deathblow.hitstop, c.deathblow.shake, cfg);
            world.slowmo = c.deathblow.slowmoFrames;
            world.slowScale = c.deathblow.slowmoScale;
            emit(world, { type: 'deathblow', pos: { ...t.pos }, dir: { ...a.dir } });
          }
        } else {
          for (const e of targets) {
            if (a.hitIds.includes(e.id) || e.phase === 'down') continue;
            if (arcHitsCircle(p.pos, a.dir, def.hitbox, e.pos, e.radius)) {
              a.hitIds.push(e.id);
              hitEnemy(world, e, p.pos, a.dir, { ...def, strong: a.step === 3 }, cfg);
            }
          }
        }
      }

      if (a.frame >= def.startup + def.active + def.recovery) {
        if (a.step > 0) {
          p.lastStep = a.step;
          p.comboTimer = c.comboResetFrames;
        }
        p.action = null;
      }
    } else if (aim && !p.guarding && !p.parry) {
      p.facing = { ...aim };
    }
    if (p.parry) speedMul = Math.min(speedMul, c.parry.moveSpeedMul);
    if (p.guarding) speedMul = Math.min(speedMul, c.block.moveSpeedMul);
    if (p.blockStun > 0) speedMul = Math.min(speedMul, 0.3);
    if (p.dashEndLag > 0) speedMul = Math.min(speedMul, dashCfg.endLagSpeedMul);

    // --- Locomotion (acceleration-based) ---
    const t = cfg.player;
    const moving = !locked(p) && (intent.dir.x !== 0 || intent.dir.y !== 0);
    const top = t.maxSpeed * speedMul * intent.speedMul;
    const target = moving ? { x: intent.dir.x * top, y: intent.dir.y * top } : { x: 0, y: 0 };
    const rate = moving ? t.maxSpeed / Math.max(1, t.accelFrames) : t.maxSpeed / Math.max(1, t.decelFrames);
    p.vel = moveToward(p.vel, target, rate);
    dx += p.vel.x * SIM_DT;
    dy += p.vel.y * SIM_DT;
  }

  // --- Knockback ---
  dx += p.knock.x * SIM_DT;
  dy += p.knock.y * SIM_DT;
  p.knock.x *= c.knockbackFriction;
  p.knock.y *= c.knockbackFriction;
  if (Math.hypot(p.knock.x, p.knock.y) < 2) p.knock = { x: 0, y: 0 };

  const r = moveAndSlide(p.pos.x, p.pos.y, dx, dy, cfg.player.radius, world.segs);
  p.pos.x = r.x;
  p.pos.y = r.y;
  if (r.hit) {
    const vn = p.vel.x * r.nx + p.vel.y * r.ny;
    if (vn < 0) {
      p.vel.x -= vn * r.nx;
      p.vel.y -= vn * r.ny;
    }
  }
}
