import { SIM_DT } from '../../core/loop';
import { groundToScreen, screenToGround } from '../../core/iso';
import { easeOutQuad, moveToward, normalize, type Vec2 } from '../../core/math';
import type { AttackDef, SimConfig } from '../config';
import { arcHitsCircle, assistAim } from '../combat/hitbox';
import { hitEnemy } from '../combat/damage';
import { moveAndSlide } from '../physics/collide';
import { emit, type AttackState, type PlayerState, type World } from '../world';

export function attackDef(cfg: SimConfig, step: number): AttackDef {
  const d = cfg.attacks[`slash${step}`];
  if (!d) throw new Error(`missing attack slash${step}`);
  return d;
}

export type AttackPhase = 'startup' | 'active' | 'recovery';

export function attackPhase(a: AttackState, d: AttackDef): AttackPhase {
  if (a.frame <= d.startup) return 'startup';
  if (a.frame <= d.startup + d.active) return 'active';
  return 'recovery';
}

export { isPlayerInvulnerable } from '../combat/damage';

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
function upcomingRecoveryFrame(p: PlayerState, cfg: SimConfig): number {
  if (!p.action) return Infinity;
  const d = attackDef(cfg, p.action.step);
  return p.action.frame + 1 - d.startup - d.active;
}

function canDash(p: PlayerState, cfg: SimConfig): boolean {
  if (p.dash || p.dashEndLag > 0 || p.hurtStun > 0) return false;
  return upcomingRecoveryFrame(p, cfg) >= 1;
}

function canStartAttack(p: PlayerState, cfg: SimConfig): boolean {
  if (p.dash || p.hurtStun > 0) return false;
  if (!p.action) return true;
  return upcomingRecoveryFrame(p, cfg) >= attackDef(cfg, p.action.step).chainAt;
}

/**
 * One tick of player logic: dash/attack starts (from the input buffer), frame
 * data advance, hit detection, movement and collision.
 */
export function updatePlayer(world: World, move: Vec2, aim: Vec2 | null, cfg: SimConfig): void {
  const p = world.player;
  const buf = world.buffer;
  const dashCfg = cfg.player.dash;

  if (p.hitFlash > 0) p.hitFlash--;
  if (p.comboTimer > 0) p.comboTimer--;
  if (p.hurtStun > 0) p.hurtStun--;
  if (p.dashEndLag > 0) p.dashEndLag--;

  const intent = moveIntent(move, cfg.feel.verticalSpeedComp);
  const aimDir = aim ?? p.facing;
  const targets = world.enemies.filter((e) => e.phase !== 'down');

  // --- Starts (buffered). Dash wins over attack when both are queued. ---
  if (buf.has('dash') && canDash(p, cfg)) {
    buf.consume('dash');
    const dir = intent.dir.x !== 0 || intent.dir.y !== 0 ? intent.dir : aimDir;
    p.action = null;
    p.dash = { frame: 0, dir: { ...dir } };
    p.vel = { x: 0, y: 0 };
    emit(world, { type: 'dash', pos: { ...p.pos }, dir: { ...dir } });
  }
  if (buf.has('slash') && canStartAttack(p, cfg)) {
    buf.consume('slash');
    const step = p.action ? (p.action.step % 3) + 1 : p.comboTimer > 0 ? (p.lastStep % 3) + 1 : 1;
    p.action = { step, frame: 0, dir: assistAim(p.pos, aimDir, targets, cfg.combat.aimAssist), hitIds: [] };
    p.dashEndLag = 0;
    emit(world, { type: 'swing', pos: { ...p.pos }, dir: { ...p.action.dir }, step });
  }

  let dx = 0;
  let dy = 0;

  // --- Dash ---
  if (p.dash) {
    const d = p.dash;
    d.frame++;
    const n = Math.max(1, dashCfg.frames);
    const step = dashCfg.distance * (easeOutQuad(d.frame / n) - easeOutQuad((d.frame - 1) / n));
    dx += d.dir.x * step;
    dy += d.dir.y * step;
    p.facing = { ...d.dir };
    if (d.frame >= n) {
      p.dash = null;
      p.dashEndLag = dashCfg.endLag;
      const exit = cfg.player.maxSpeed * dashCfg.exitSpeedMul;
      p.vel = { x: d.dir.x * exit, y: d.dir.y * exit };
    }
  } else {
    // --- Attack frame data ---
    let speedMul = 1;
    const a = p.action;
    if (a) {
      const def = attackDef(cfg, a.step);
      a.frame++;
      if (a.frame <= def.startup) a.dir = assistAim(p.pos, aimDir, targets, cfg.combat.aimAssist);
      p.facing = { ...a.dir };
      speedMul = def.moveSpeedMul;

      const over = Math.max(1, def.lunge.overFrames);
      if (a.frame <= over) {
        const l = def.lunge.px * (easeOutQuad(a.frame / over) - easeOutQuad((a.frame - 1) / over));
        dx += a.dir.x * l;
        dy += a.dir.y * l;
      }

      if (attackPhase(a, def) === 'active') {
        for (const e of targets) {
          if (a.hitIds.includes(e.id)) continue;
          if (arcHitsCircle(p.pos, a.dir, def.hitbox, e.pos, e.radius)) {
            a.hitIds.push(e.id);
            hitEnemy(world, e, a.dir, { ...def, strong: a.step === 3 }, cfg);
          }
        }
      }

      if (a.frame >= def.startup + def.active + def.recovery) {
        p.lastStep = a.step;
        p.comboTimer = cfg.combat.comboResetFrames;
        p.action = null;
      }
    } else if (aim) {
      p.facing = { ...aim };
    }
    if (p.dashEndLag > 0) speedMul = Math.min(speedMul, dashCfg.endLagSpeedMul);

    // --- Locomotion (acceleration-based) ---
    const t = cfg.player;
    const stunned = p.hurtStun > 0;
    const moving = !stunned && (intent.dir.x !== 0 || intent.dir.y !== 0);
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
  p.knock.x *= cfg.combat.knockbackFriction;
  p.knock.y *= cfg.combat.knockbackFriction;
  if (Math.hypot(p.knock.x, p.knock.y) < 2) p.knock = { x: 0, y: 0 };

  const r = moveAndSlide(p.pos.x, p.pos.y, dx, dy, cfg.player.radius, world.segs);
  p.pos.x = r.x;
  p.pos.y = r.y;
  if (r.hit) {
    // Drop the velocity component into the wall so we don't "charge up" against it.
    const vn = p.vel.x * r.nx + p.vel.y * r.ny;
    if (vn < 0) {
      p.vel.x -= vn * r.nx;
      p.vel.y -= vn * r.ny;
    }
  }
}
