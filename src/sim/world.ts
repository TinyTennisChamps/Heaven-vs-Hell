import { createRng, nextRange, type RngState } from '../core/rng';
import { groundToScreen } from '../core/iso';
import { v2, type Vec2 } from '../core/math';
import { InputBuffer } from '../input/buffer';
import type { RoomDef, SimConfig } from './config';
import { depenetrate, pointInPolygon, segmentsFromPolygon, type Seg } from './physics/collide';

export interface AttackState {
  /** Key into the attack data ("slash1".."slash3", "deathblow"). */
  key: string;
  /** Combo step 1..3 (0 for non-combo attacks like deathblow). */
  step: number;
  /** 1-based tick within the attack. 0 = just started, not yet advanced. */
  frame: number;
  /** Ground-space unit direction; steers during startup, locked after. */
  dir: Vec2;
  /** Enemy ids already hit by this swing. */
  hitIds: number[];
  /** Deathblow target. */
  targetId?: number;
}

export interface Projectile {
  id: number;
  kind: 'bolt' | 'arrow';
  /** 'player' or the id of the enemy that fired it. A reflected arrow becomes Satan's. */
  owner: 'player' | number;
  /** Enemy that originally shot it (reflections fly back at them). */
  shooter: number | null;
  pos: Vec2;
  prevPos: Vec2;
  vel: Vec2;
  radius: number;
  life: number;
  healthDamage: number;
  postureDamage: number;
  knockback: number;
  hitstop: number;
  shake: number;
  reflected: boolean;
  perfect: boolean;
}

export interface DashState {
  frame: number;
  dir: Vec2;
}

export interface ParryState {
  /** 1-based tick since the press. */
  frame: number;
  /** Deflect window length for this attempt (shrinks after a whiff). */
  window: number;
  deflected: boolean;
}

export interface PlayerState {
  pos: Vec2;
  /** Position at the start of the last tick, for render interpolation. */
  prevPos: Vec2;
  vel: Vec2;
  /** Knockback velocity (px/s), decays by friction each tick. */
  knock: Vec2;
  facing: Vec2;
  hp: number;
  posture: number;
  /** Ticks since Satan last took posture damage. */
  sinceHit: number;
  action: AttackState | null;
  dash: DashState | null;
  dashEndLag: number;
  /** Ticks since the last dash ended (dash cooldown). */
  sinceDash: number;
  lastStep: number;
  comboTimer: number;
  hurtStun: number;
  hitFlash: number;
  parry: ParryState | null;
  /** While > 0 the next parry gets the shortened window (anti-mash). */
  parryPenalty: number;
  guarding: boolean;
  blockStun: number;
  /** Posture-broken stagger ticks remaining. */
  broken: number;
  /** Throw pips (E). */
  pips: number;
  /** Melee hits landed toward the next pip refill. */
  pipProgress: number;
  /** Locked-on enemy id (Q), or null. */
  lockId: number | null;
  /** Ticks Q has been held since a press while locked (-1 = not measuring). */
  lockHold: number;
}

export type EnemyPhase = 'idle' | 'windup' | 'active' | 'recover' | 'recoil' | 'broken' | 'down';

export interface Enemy {
  id: number;
  type: string;
  pos: Vec2;
  prevPos: Vec2;
  vel: Vec2;
  knock: Vec2;
  facing: Vec2;
  hp: number;
  maxHp: number;
  posture: number;
  sinceHit: number;
  radius: number;
  phase: EnemyPhase;
  phaseFrame: number;
  /** Current attack key while in windup/active/recover. */
  attack: string | null;
  /** Locked direction of the current attack. */
  attackDir: Vec2;
  swingHit: boolean;
  cooldown: number;
  hitFlash: number;
  /** Hits absorbed by the shield since the last counter. */
  blockedHits: number;
  /** Shield flash timer (render). */
  shieldFlash: number;
  /** A non-focus enemy that has been given its turn to step in and attack. */
  engage: boolean;
  /** Consecutive ticks Satan has spent behind this enemy's shield, nearby. */
  flankTicks: number;
  /** Cooldown for special moves (e.g. the flank spin). */
  specialCooldown: number;
  spawn: Vec2;
}

export type SimEvent =
  | { type: 'hit'; pos: Vec2; dir: Vec2; strong: boolean; riposte?: boolean }
  | { type: 'playerHit'; pos: Vec2; dir: Vec2 }
  | { type: 'swing'; pos: Vec2; dir: Vec2; step: number }
  | { type: 'dash'; pos: Vec2; dir: Vec2 }
  | { type: 'dashReady'; pos: Vec2 }
  | { type: 'enemyDown'; pos: Vec2 }
  | { type: 'telegraph'; pos: Vec2; judgement: boolean }
  | { type: 'deflect'; pos: Vec2; dir: Vec2; perfect: boolean }
  | { type: 'block'; pos: Vec2; dir: Vec2 }
  | { type: 'shieldBlock'; pos: Vec2; dir: Vec2 }
  | { type: 'postureBreak'; pos: Vec2 }
  | { type: 'playerBroken'; pos: Vec2 }
  | { type: 'deathblow'; pos: Vec2; dir: Vec2 }
  | { type: 'parryWhiff'; pos: Vec2 }
  | { type: 'riposteOpen'; pos: Vec2 }
  | { type: 'throw'; pos: Vec2; dir: Vec2 }
  | { type: 'noPips'; pos: Vec2 }
  | { type: 'pipGained'; pos: Vec2 }
  | { type: 'projectileEnd'; pos: Vec2; kind: 'bolt' | 'arrow'; reflected: boolean }
  | { type: 'reflect'; pos: Vec2; perfect: boolean }
  | { type: 'arrowLoosed'; pos: Vec2 }
  | { type: 'lockOn'; pos: Vec2 }
  | { type: 'lockOff'; pos: Vec2 };

export interface CameraState {
  /** Camera centre in iso screen space. */
  pos: Vec2;
  prevPos: Vec2;
  shake: number;
  shakeOffset: Vec2;
}

export interface World {
  tick: number;
  rng: RngState;
  room: RoomDef;
  segs: Seg[];
  /** Screen-space bounding box of the room (for camera clamping). */
  screenBox: { minX: number; minY: number; maxX: number; maxY: number };
  buffer: InputBuffer;
  /** Global freeze counter (hit-stop). While > 0 actors and buffer expiry pause. */
  hitstop: number;
  /** Slow-motion ticks remaining and the fractional-tick accumulator. */
  slowmo: number;
  slowScale: number;
  slowAcc: number;
  player: PlayerState;
  enemies: Enemy[];
  projectiles: Projectile[];
  nextId: number;
  /** The enemy allowed to attack freely this tick (lock target, else nearest). */
  focusId: number | null;
  camera: CameraState;
  events: SimEvent[];
  flags: { dummyAttacks: boolean; respawn: boolean };
  stats: { hitsLanded: number; hitsTaken: number; kills: number; deflects: number; perfects: number; deathblows: number };
}

export function createWorld(room: RoomDef, cfg: SimConfig, seed = 1): World {
  const segs = [...segmentsFromPolygon(room.bounds), ...room.walls.flatMap((w) => segmentsFromPolygon(w))];
  const pts = room.bounds.map(([x, y]) => groundToScreen(x, y));
  const screenBox = {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
  const spawn = v2(room.playerSpawn[0], room.playerSpawn[1]);
  const camPos = groundToScreen(spawn.x, spawn.y);

  const world: World = {
    tick: 0,
    rng: createRng(seed),
    room,
    segs,
    screenBox,
    buffer: new InputBuffer({}, cfg.feel.inputBufferFrames),
    hitstop: 0,
    slowmo: 0,
    slowScale: 1,
    slowAcc: 0,
    player: {
      pos: { ...spawn },
      prevPos: { ...spawn },
      vel: v2(),
      knock: v2(),
      facing: v2(1, 0),
      hp: cfg.player.maxHealth,
      posture: 0,
      sinceHit: 999,
      action: null,
      dash: null,
      dashEndLag: 0,
      sinceDash: 999,
      lastStep: 0,
      comboTimer: 0,
      hurtStun: 0,
      hitFlash: 0,
      parry: null,
      parryPenalty: 0,
      guarding: false,
      blockStun: 0,
      broken: 0,
      lockId: null,
      lockHold: -1,
      pips: cfg.player.throw.maxPips,
      pipProgress: 0,
    },
    enemies: [],
    projectiles: [],
    nextId: 1,
    focusId: null,
    camera: { pos: { ...camPos }, prevPos: { ...camPos }, shake: 0, shakeOffset: v2() },
    events: [],
    flags: { dummyAttacks: true, respawn: true },
    stats: { hitsLanded: 0, hitsTaken: 0, kills: 0, deflects: 0, perfects: 0, deathblows: 0 },
  };
  for (const s of room.spawns) spawnEnemy(world, cfg, s.type, v2(s.at[0], s.at[1]));
  return world;
}

export function spawnEnemy(world: World, cfg: SimConfig, type: string, at: Vec2): Enemy {
  const d = cfg.enemies[type];
  if (!d) throw new Error(`unknown enemy type ${type}`);
  const e: Enemy = {
    id: world.nextId++,
    type,
    pos: { ...at },
    prevPos: { ...at },
    vel: v2(),
    knock: v2(),
    facing: v2(-1, 0),
    hp: d.health,
    maxHp: d.health,
    posture: 0,
    sinceHit: 999,
    radius: d.radius,
    phase: 'idle',
    phaseFrame: 0,
    attack: null,
    attackDir: v2(-1, 0),
    swingHit: false,
    cooldown: Math.round(nextRange(world.rng, d.cooldownMin, d.cooldownMax)),
    hitFlash: 0,
    blockedHits: 0,
    shieldFlash: 0,
    engage: false,
    flankTicks: 0,
    specialCooldown: 0,
    spawn: { ...at },
  };
  world.enemies.push(e);
  return e;
}

const MAX_EVENTS = 256;
export function emit(world: World, ev: SimEvent): void {
  if (world.events.length >= MAX_EVENTS) world.events.shift();
  world.events.push(ev);
}

/** Is a circle of radius r at (x,y) fully inside the room and clear of every wall? */
export function isValidSpot(world: World, x: number, y: number, r: number): boolean {
  if (!pointInPolygon(x, y, world.room.bounds)) return false;
  if (world.room.walls.some((w) => pointInPolygon(x, y, w))) return false;
  for (const s of world.segs) {
    const ex = s.bx - s.ax;
    const ey = s.by - s.ay;
    const l2 = ex * ex + ey * ey;
    const u = l2 > 1e-12 ? Math.max(0, Math.min(1, ((x - s.ax) * ex + (y - s.ay) * ey) / l2)) : 0;
    if (Math.hypot(x - (s.ax + ex * u), y - (s.ay + ey * u)) < r) return false;
  }
  return true;
}

/**
 * Debug/training spawn. Tries the requested point, then points in front of
 * Satan (closer and closer), then a ring around Satan, then the room centre —
 * and only ever accepts a spot verifiably inside the arena and clear of walls.
 */
export function spawnEnemyAt(world: World, cfg: SimConfig, type: string, at: Vec2): Enemy {
  const r = (cfg.enemies[type]?.radius ?? 8) + 2;
  const p = world.player;
  const candidates: Vec2[] = [{ ...at }];
  for (const d of [50, 40, 30, 60, 75]) candidates.push({ x: p.pos.x + p.facing.x * d, y: p.pos.y + p.facing.y * d });
  for (const d of [45, 70, 30]) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      candidates.push({ x: p.pos.x + Math.cos(a) * d, y: p.pos.y + Math.sin(a) * d });
    }
  }
  const b = world.room.bounds;
  candidates.push({ x: b.reduce((s, q) => s + q[0], 0) / b.length, y: b.reduce((s, q) => s + q[1], 0) / b.length });

  let pos = candidates.find((c) => isValidSpot(world, c.x, c.y, r));
  if (!pos) {
    // Last resort: nudge the room centre out of anything it overlaps.
    const c = candidates[candidates.length - 1]!;
    pos = depenetrate(c.x, c.y, r, world.segs);
  }
  const e = spawnEnemy(world, cfg, type, pos);
  e.cooldown = Math.max(e.cooldown, 45); // a beat before it acts
  return e;
}
