import { SIM_DT } from '../../core/loop';
import { groundToScreen, screenToGround } from '../../core/iso';
import { easeOutQuad, moveToward, normalize, type Vec2 } from '../../core/math';
import type { AttackDef, SimConfig } from '../config';
import { arcHitsCircle, assistAim } from '../combat/hitbox';
import { gainRage, hitEnemy, killEnemy, meleeHitLanded, startHitstop } from '../combat/damage';
import { deflectWindowBonus, maxHp, playerPostureTuning, playerRadius, raging } from '../stats';
import { spawnProjectile } from '../projectiles';
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
  if (p.sinceDash < cfg.player.dash.cooldownFrames) return false; // no double-dashing
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
 * Where the most imminent threat is coming from, within range: enemy attacks
 * (already active first, then the windup closest to completion) and arrows
 * flying at Satan (by time to impact). Ties go to the nearer one.
 */
export function imminentThreat(world: World, cfg: SimConfig): Vec2 | null {
  const p = world.player;
  const range = cfg.combat.autoFace.range;
  let best: Vec2 | null = null;
  let bestScore = Infinity;
  for (const e of world.enemies) {
    if (e.phase !== 'windup' && e.phase !== 'active') continue;
    const atk = e.attack ? cfg.enemies[e.type]!.attacks[e.attack] : undefined;
    if (!atk) continue;
    const d = Math.hypot(e.pos.x - p.pos.x, e.pos.y - p.pos.y);
    if (d > (atk.projectile ? range * 2 : range)) continue;
    // A ranged windup lands later than its windup ends (flight time).
    const flight = atk.projectile ? (d / atk.projectile.speed) * 60 : 0;
    const ticksLeft = (e.phase === 'active' ? 0 : e.windupLen - e.phaseFrame) + flight;
    const score = ticksLeft * 1000 + d;
    if (score < bestScore) {
      best = e.pos;
      bestScore = score;
    }
  }
  for (const pr of world.projectiles) {
    if (pr.owner === 'player') continue;
    const to = { x: p.pos.x - pr.pos.x, y: p.pos.y - pr.pos.y };
    const d = Math.hypot(to.x, to.y);
    const sp = Math.hypot(pr.vel.x, pr.vel.y);
    if (d > range * 2 || sp < 1 || pr.vel.x * to.x + pr.vel.y * to.y <= 0) continue;
    const score = (d / sp) * 60 * 1000 + d;
    if (score < bestScore) {
      best = pr.pos;
      bestScore = score;
    }
  }
  return best;
}

export interface PlayerInput {
  move: Vec2;
  /** Right mouse held (guard). */
  guardHeld: boolean;
  /** Locked on: slashes skip aim-assist (they already point at the target). */
  locked?: boolean;
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

  if (p.dead) {
    // Fallen: no input, no movement.
    p.vel = { x: 0, y: 0 };
    p.knock = { x: 0, y: 0 };
    if (p.hitFlash > 0) p.hitFlash--;
    return;
  }

  if (p.hitFlash > 0) p.hitFlash--;
  if (p.roarCd > 0) p.roarCd--;
  p.recentBlocks *= 0.995; // ~3 s half-life

  // --- Rage: R with a full meter transforms (from anything but death). ---
  if (buf.has('rage')) {
    buf.consume('rage');
    if (!raging(p) && p.rageTransform === 0 && p.rage >= cfg.rage.max) {
      p.action = null;
      p.parry = null;
      p.guarding = false;
      p.dash = null;
      p.hurtStun = 0;
      p.broken = 0;
      p.posture = 0;
      p.blockStun = 0;
      p.rageTransform = cfg.rage.transformFrames;
      startHitstop(world, 6, 3, cfg);
      emit(world, { type: 'rageStart', pos: { ...p.pos } });
    }
  }
  if (p.rageTransform > 0) {
    // Invulnerable transform: Satan holds still while the hellfire takes him.
    p.rageTransform--;
    p.vel = { x: 0, y: 0 };
    p.knock = { x: 0, y: 0 };
    if (p.rageTransform === 0) p.rageForm = cfg.rage.durationFrames;
    return;
  }
  if (p.rageForm > 0) {
    p.rageForm--;
    if (p.rageForm === 0) {
      p.rage = 0;
      emit(world, { type: 'rageEnd', pos: { ...p.pos } });
    }
  }

  if (p.comboTimer > 0) p.comboTimer--;
  if (p.hurtStun > 0) p.hurtStun--;
  if (p.dashEndLag > 0) p.dashEndLag--;
  if (!p.dash && p.sinceDash < 9999) {
    p.sinceDash++;
    if (p.sinceDash === cfg.player.dash.cooldownFrames) emit(world, { type: 'dashReady', pos: { ...p.pos } });
  }
  if (p.blockStun > 0) p.blockStun--;
  if (p.parryPenalty > 0) p.parryPenalty--;
  if (p.broken > 0) {
    p.broken--;
    if (p.broken === 0) p.posture = 0;
  } else {
    p.sinceHit++;
    p.posture = regenPosture(p.posture, p.sinceHit, p.hp, maxHp(world, cfg), playerPostureTuning(world, cfg));
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
    p.dash = { frame: 0, dir: { ...dir } };
    p.vel = { x: 0, y: 0 };
    emit(world, { type: 'dash', pos: { ...p.pos }, dir: { ...dir } });
  }
  if (raging(p) && buf.has('parry')) {
    // Rage: RMB is the hellfire roar (parry and block are gone).
    if (p.roarCd === 0 && !p.dash && !locked(p)) {
      buf.consume('parry');
      roar(world, cfg);
    } else if (p.roarCd > 0) buf.consume('parry');
  }
  if (raging(p) && buf.has('throw')) buf.consume('throw'); // no throwing in Rage
  if (!raging(p) && buf.has('parry') && canParry(p, cfg)) {
    buf.consume('parry');
    // Re-pressing during a window that hasn't deflected anything is mashing.
    if (p.parry && !p.parry.deflected) p.parryPenalty = c.parry.whiffPenaltyFrames;
    const window = (p.parryPenalty > 0 ? c.parry.penalizedWindowFrames : c.parry.windowFrames) + deflectWindowBonus(world);
    p.action = null;
    p.parry = { frame: 0, window, deflected: false };
  }
  if (buf.has('throw') && canStartAttack(p, cfg) && !(p.action && p.action.key === 'throw')) {
    buf.consume('throw');
    if (p.pips > 0) {
      p.pips--;
      p.parry = null;
      p.guarding = false;
      p.dashEndLag = 0;
      p.action = { key: 'throw', step: 0, frame: 0, dir: inp.locked ? { ...aimDir } : assistAim(p.pos, aimDir, targets, { ...c.aimAssist, range: 160 }), hitIds: [] };
    } else {
      emit(world, { type: 'noPips', pos: { ...p.pos } });
    }
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
      p.action = { key: `${raging(p) ? 'claw' : 'slash'}${step}`, step, frame: 0, dir: inp.locked ? { ...aimDir } : assistAim(p.pos, aimDir, targets, c.aimAssist), hitIds: [] };
    }
    emit(world, { type: 'swing', pos: { ...p.pos }, dir: { ...p.action.dir }, step: p.action.step });
  }

  // --- Parry window / guard ---
  if (p.parry) {
    p.parry.frame++;
    if (p.parry.frame > p.parry.window) {
      // Holding the button into a block isn't mashing — only a released tap that whiffed is.
      if (!p.parry.deflected && !inp.guardHeld) {
        p.parryPenalty = c.parry.whiffPenaltyFrames;
        emit(world, { type: 'parryWhiff', pos: { ...p.pos } });
      }
      p.parry = null;
    }
  }
  // Block is live the instant RMB is held (no gap after the parry window);
  // during the window a deflect still takes priority.
  p.guarding = inp.guardHeld && !p.dash && !p.action && !locked(p) && !raging(p);
  if (p.parry || p.guarding) {
    // Guard faces the incoming attack, not the cursor: parrying is about timing.
    const threat = c.autoFace.enabled ? imminentThreat(world, cfg) : null;
    if (threat) p.facing = normalize({ x: threat.x - p.pos.x, y: threat.y - p.pos.y });
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
      if (a.frame <= def.startup && a.key !== 'deathblow' && a.key !== 'throw') a.dir = inp.locked ? { ...aimDir } : assistAim(p.pos, aimDir, targets, c.aimAssist);
      p.facing = { ...a.dir };
      speedMul = def.moveSpeedMul;

      const over = Math.max(1, def.lunge.overFrames);
      if (a.frame <= over) {
        const l = def.lunge.px * (easeOutQuad(a.frame / over) - easeOutQuad((a.frame - 1) / over));
        dx += a.dir.x * l;
        dy += a.dir.y * l;
      }

      if (attackPhase(a, def) === 'active') {
        if (def.projectile) {
          if (a.hitIds.length === 0) {
            a.hitIds.push(-1); // launched
            const from = { x: p.pos.x + a.dir.x * 8, y: p.pos.y + a.dir.y * 8 };
            spawnProjectile(world, 'bolt', 'player', from, a.dir, def.projectile, def);
            emit(world, { type: 'throw', pos: from, dir: { ...a.dir } });
          }
        } else if (a.key === 'deathblow') {
          const t = world.enemies.find((e) => e.id === a.targetId);
          if (t && t.phase === 'broken' && !a.hitIds.includes(t.id)) {
            a.hitIds.push(t.id);
            killEnemy(world, t, cfg);
            gainRage(world, cfg.rage.gain.deathblow, cfg);
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
              e.meleeHits++;
              const postureDamage = def.postureDamage * (a.key.startsWith('slash') ? 1 + world.mods.slashPosture : 1);
              if (hitEnemy(world, e, p.pos, a.dir, { ...def, postureDamage, strong: a.step === 3 }, cfg) === 'hit') meleeHitLanded(world, cfg);
            }
          }
          // Cracked rim spots hiding a vial: each swing that reaches one counts once.
          world.pickups.forEach((q, i) => {
            const tag = -10 - i;
            if (q.kind !== 'crack' || q.open || a.hitIds.includes(tag)) return;
            if (!arcHitsCircle(p.pos, a.dir, def.hitbox, q.at, 6)) return;
            a.hitIds.push(tag);
            q.hits++;
            emit(world, { type: 'crackHit', pos: { ...q.at } });
            startHitstop(world, 2, 1, cfg);
            if (q.hits >= cfg.rooms.crackHits) {
              q.open = true;
              emit(world, { type: 'crackBroken', pos: { ...q.at } });
            }
          });
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
    const top = t.maxSpeed * speedMul * intent.speedMul * (raging(p) ? cfg.rage.speedMul : 1);
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

  const r = moveAndSlide(p.pos.x, p.pos.y, dx, dy, playerRadius(world, cfg), world.segs);
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

/** Rage RMB: a hellfire burst around Satan — knocks back, hits posture, ignores shields, burns arrows. */
function roar(world: World, cfg: SimConfig): void {
  const p = world.player;
  const R = cfg.rage.roar;
  p.roarCd = R.cooldownFrames;
  p.action = null;
  for (const e of world.enemies) {
    if (e.phase === 'down' || e.arrive > 0) continue;
    const d = Math.hypot(e.pos.x - p.pos.x, e.pos.y - p.pos.y);
    if (d > R.radius + e.radius) continue;
    const dir = d > 1e-6 ? { x: (e.pos.x - p.pos.x) / d, y: (e.pos.y - p.pos.y) / d } : { x: 1, y: 0 };
    hitEnemy(world, e, p.pos, dir, { ...R, strong: true, ignoreShield: true }, cfg);
  }
  world.projectiles = world.projectiles.filter((pr) => pr.owner === 'player' || Math.hypot(pr.pos.x - p.pos.x, pr.pos.y - p.pos.y) > R.radius);
  startHitstop(world, R.hitstop, R.shake, cfg);
  emit(world, { type: 'roar', pos: { ...p.pos } });
}
