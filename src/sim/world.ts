import { createRng, type RngState } from '../core/rng';
import { groundToScreen } from '../core/iso';
import { v2, type Vec2 } from '../core/math';
import { InputBuffer } from '../input/buffer';
import type { RoomDef, SimConfig } from './config';
import { segmentsFromPolygon, type Seg } from './physics/collide';

export interface AttackState {
  /** Combo step 1..3 (keys "slash1".."slash3" in the attack data). */
  step: number;
  /** 1-based tick within the attack. 0 = just started, not yet advanced. */
  frame: number;
  /** Ground-space unit direction; steers during startup, locked after. */
  dir: Vec2;
  /** Enemy ids already hit by this swing. */
  hitIds: number[];
}

export interface DashState {
  frame: number;
  dir: Vec2;
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
  action: AttackState | null;
  dash: DashState | null;
  dashEndLag: number;
  lastStep: number;
  comboTimer: number;
  hurtStun: number;
  hitFlash: number;
}

export type DummyPhase = 'idle' | 'windup' | 'swing' | 'recover' | 'down';

export interface Enemy {
  id: number;
  type: 'dummy';
  pos: Vec2;
  prevPos: Vec2;
  vel: Vec2;
  knock: Vec2;
  facing: Vec2;
  hp: number;
  maxHp: number;
  radius: number;
  phase: DummyPhase;
  phaseFrame: number;
  swingHit: boolean;
  cooldown: number;
  hitFlash: number;
  spawn: Vec2;
}

export type SimEvent =
  | { type: 'hit'; pos: Vec2; dir: Vec2; strong: boolean }
  | { type: 'playerHit'; pos: Vec2; dir: Vec2 }
  | { type: 'swing'; pos: Vec2; dir: Vec2; step: number }
  | { type: 'dash'; pos: Vec2; dir: Vec2 }
  | { type: 'enemyDown'; pos: Vec2 }
  | { type: 'telegraph'; pos: Vec2 };

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
  player: PlayerState;
  enemies: Enemy[];
  nextId: number;
  camera: CameraState;
  events: SimEvent[];
  flags: { dummyAttacks: boolean };
  stats: { hitsLanded: number; hitsTaken: number; kills: number };
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
    player: {
      pos: { ...spawn },
      prevPos: { ...spawn },
      vel: v2(),
      knock: v2(),
      facing: v2(1, 0),
      hp: cfg.player.maxHealth,
      action: null,
      dash: null,
      dashEndLag: 0,
      lastStep: 0,
      comboTimer: 0,
      hurtStun: 0,
      hitFlash: 0,
    },
    enemies: [],
    nextId: 1,
    camera: { pos: { ...camPos }, prevPos: { ...camPos }, shake: 0, shakeOffset: v2() },
    events: [],
    flags: { dummyAttacks: true },
    stats: { hitsLanded: 0, hitsTaken: 0, kills: 0 },
  };
  for (const [x, y] of room.dummySpawns) spawnDummy(world, cfg, v2(x, y));
  return world;
}

export function spawnDummy(world: World, cfg: SimConfig, at: Vec2): Enemy {
  const d = cfg.dummy;
  const e: Enemy = {
    id: world.nextId++,
    type: 'dummy',
    pos: { ...at },
    prevPos: { ...at },
    vel: v2(),
    knock: v2(),
    facing: v2(-1, 0),
    hp: d.health,
    maxHp: d.health,
    radius: d.radius,
    phase: 'idle',
    phaseFrame: 0,
    swingHit: false,
    cooldown: d.attackCooldown,
    hitFlash: 0,
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
