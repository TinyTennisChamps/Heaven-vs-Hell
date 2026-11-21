import { VIEW_H, VIEW_W } from '../core/constants';
import { screenToGround } from '../core/iso';
import { normalize, type Vec2 } from '../core/math';
import type { InputFrame } from '../input/actions';
import type { SimConfig } from './config';
import { updateEnemy } from './actors/enemy';
import { updatePlayer } from './actors/player';
import { ENEMY_THINK } from './registry';
import { lockTarget, updateLock } from './lockon';
import { updateProjectiles } from './projectiles';
import { updateCamera, updateShake } from './camera';
import { moveAndSlide } from './physics/collide';
import { updateRoom } from './rooms/roomRunner';
import { playerRadius } from './stats';
import { airborne } from './combat/damage';
import type { World } from './world';

/**
 * Advance the world one fixed tick (1/60 s). Deterministic: same world + same
 * inputs + same config => same result. Never touches the DOM, Pixi or a clock.
 */
export function step(world: World, input: InputFrame, cfg: SimConfig): void {
  const p = world.player;
  p.prevPos = { ...p.pos };
  for (const e of world.enemies) e.prevPos = { ...e.pos };
  world.camera.prevPos = { ...world.camera.pos };

  world.buffer.setWindowDefault(cfg.feel.inputBufferFrames);
  for (const a of input.pressed) if (a !== 'lock') world.buffer.press(a);

  updateShake(world, cfg);

  // Hit-stop: everything holds, presses keep buffering and don't expire.
  if (world.hitstop > 0) {
    world.hitstop--;
    world.buffer.tick(true);
    world.tick++;
    return;
  }

  // Slow motion (deathblow): only a fraction of ticks advance the game.
  if (world.slowmo > 0) {
    world.slowmo--;
    world.slowAcc += world.slowScale;
    if (world.slowAcc < 1) {
      world.buffer.tick(true);
      world.tick++;
      return;
    }
    world.slowAcc -= 1;
  } else {
    world.slowAcc = 0;
  }

  updateLock(world, input, cfg);
  updatePlayer(world, { move: input.move, guardHeld: input.held.parry, locked: !!lockTarget(world) }, resolveAim(world, input), cfg);
  for (const e of world.enemies) {
    const think = ENEMY_THINK[e.type];
    if (think) updateEnemy(world, e, cfg, think);
  }
  updateProjectiles(world, cfg);
  updateRoom(world, cfg);
  separate(world, cfg);
  updateCamera(world, input.aimScreen, cfg);

  world.buffer.tick(false);
  world.tick++;
}

/** Ground-space unit vector from the player to the cursor (null if the cursor is on the player). */
function resolveAim(world: World, input: InputFrame): Vec2 | null {
  const p = world.player.pos;
  let target: Vec2;
  const lock = lockTarget(world);
  if (lock) {
    // Full focus: everything aims at the lock target, the cursor is ignored.
    target = lock.pos;
  } else if (input.aimGround) {
    target = input.aimGround;
  } else {
    const c = world.camera.pos;
    target = screenToGround(c.x + input.aimScreen.x - VIEW_W / 2, c.y + input.aimScreen.y - VIEW_H / 2 + 10);
  }
  const d = normalize({ x: target.x - p.x, y: target.y - p.y });
  return d.x === 0 && d.y === 0 ? null : d;
}

/** Soft push-apart between bodies. Skipped for the player while dashing (dash passes through). */
function separate(world: World, cfg: SimConfig): void {
  const k = cfg.combat.separationStrength;
  const p = world.player;
  const bodies: { pos: Vec2; r: number; ghost: boolean }[] = [
    { pos: p.pos, r: playerRadius(world, cfg), ghost: !!p.dash || !!(p.action && p.action.key === 'deathblow') },
    ...world.enemies.filter((e) => e.phase !== 'down').map((e) => ({ pos: e.pos, r: e.radius, ghost: airborne(e, cfg) })),
  ];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]!;
      const b = bodies[j]!;
      if (a.ghost || b.ghost) continue;
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const d = Math.hypot(dx, dy);
      const overlap = a.r + b.r - d;
      if (overlap <= 0) continue;
      const nx = d > 1e-6 ? dx / d : 1;
      const ny = d > 1e-6 ? dy / d : 0;
      const push = overlap * k * 0.5;
      const ra = moveAndSlide(a.pos.x, a.pos.y, -nx * push, -ny * push, a.r, world.segs);
      const rb = moveAndSlide(b.pos.x, b.pos.y, nx * push, ny * push, b.r, world.segs);
      a.pos.x = ra.x;
      a.pos.y = ra.y;
      b.pos.x = rb.x;
      b.pos.y = rb.y;
    }
  }
}
