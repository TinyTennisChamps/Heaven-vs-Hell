import { createRng, nextRange, type RngState } from '../core/rng';
import { groundToScreen } from '../core/iso';
import { v2, type Vec2 } from '../core/math';
import { InputBuffer } from '../input/buffer';
import { TALL_WALLS, type RoomDef, type SimConfig } from './config';
import { depenetrate, pointInPolygon, segmentsFromPolygon, type Seg } from './physics/collide';
import { modsFromVials, type Mods } from './stats';
import { makeZones, type Zones } from './rooms/zones';
import { makeNav, type Nav } from './nav';

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
  kind: 'bolt' | 'arrow' | 'laser';
  /** Does this projectile hold other enemies' attacks while in flight? (false for ranged-pool shots) */
  gates: boolean;
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
  /** Decaying count of recent blocks (enemies read it: the Zealot sweeps a turtle). */
  recentBlocks: number;
  /** Health reached 0 (and the world isn't immortal). */
  dead: boolean;
  /** Rage meter, 0..rage.max. Full = R transforms. */
  rage: number;
  /** Rage form ticks remaining (0 = not raging). */
  rageForm: number;
  /** Invulnerable transform ticks remaining. */
  rageTransform: number;
}

/** A vial in the room: behind a cracked rim spot, or in a cage that opens on clear. */
export interface Pickup {
  vialId: string;
  kind: 'crack' | 'cage' | 'drop' | 'secret';
  /** The crack / cage position. */
  at: Vec2;
  /** Where the vial sits once revealed (a crack's vial rolls inward). */
  vialAt: Vec2;
  hits: number;
  open: boolean;
  taken: boolean;
}

export type EnemyPhase = 'idle' | 'windup' | 'active' | 'recover' | 'recoil' | 'broken' | 'down' | 'rally' | 'flinch';

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
  /** Spawn-in ticks remaining (visible, harmless, not thinking). */
  arrive: number;
  /** Ticks the enemy has been pushing into a wall without getting anywhere. */
  stuck: number;
  /** Scaled posture capacity (def.posture.max × level/room scaling). */
  postureMax: number;
  /** Damage multiplier on this enemy's attacks (level/room scaling). */
  dmgMul: number;
  /** Rolled windup length of the current attack (windup + jitter). */
  windupLen: number;
  /** Bosses: health segments left (1 = last). Each one ends in a deathblow/kill. */
  segments: number;
  /** Length of the current recoil (stagger) phase. */
  recoilLen: number;
  /** Ticks Satan has stayed within close range (Watcher bite trigger). */
  closeTicks: number;
  /** Melee hits taken since the last bite (Watcher bite trigger). */
  meleeHits: number;
  /** Ticks of flinch immunity left. */
  flinchImmune: number;
  /** Per-attack cooldowns (cooldownAfter). */
  cds: Record<string, number>;
  /** Side chosen for the current attack's pre-step (±1). */
  stepSide: number;
  /** Leap attacks: take-off point and (homing, then locked) landing point. */
  leapFrom: Vec2;
  leapTo: Vec2;
  spawn: Vec2;
}

export type SimEvent =
  | { type: 'hit'; pos: Vec2; dir: Vec2; strong: boolean; riposte?: boolean }
  | { type: 'playerHit'; pos: Vec2; dir: Vec2 }
  | { type: 'swing'; pos: Vec2; dir: Vec2; step: number }
  | { type: 'dash'; pos: Vec2; dir: Vec2 }
  | { type: 'dashReady'; pos: Vec2 }
  | { type: 'enemyDown'; pos: Vec2 }
  | { type: 'telegraph'; pos: Vec2; judgement: boolean; attack?: string; enemy?: string }
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
  | { type: 'projectileEnd'; pos: Vec2; kind: 'bolt' | 'arrow' | 'laser'; reflected: boolean }
  | { type: 'reflect'; pos: Vec2; perfect: boolean }
  | { type: 'arrowLoosed'; pos: Vec2; kind?: 'arrow' | 'laser' | 'bolt' }
  | { type: 'enemySwing'; pos: Vec2; enemy: string; attack: string }
  | { type: 'lockOn'; pos: Vec2 }
  | { type: 'lockOff'; pos: Vec2 }
  | { type: 'playerDied'; pos: Vec2 }
  | { type: 'spawnIn'; pos: Vec2; swarm: boolean }
  | { type: 'roomCleared'; pos: Vec2 }
  | { type: 'interact'; id: string; kind: string; pos: Vec2 }
  | { type: 'hubExit'; id: string; kind: string; pos: Vec2 }
  | { type: 'restHeal'; pos: Vec2 }
  | { type: 'rageFull'; pos: Vec2 }
  | { type: 'rageStart'; pos: Vec2 }
  | { type: 'rageEnd'; pos: Vec2 }
  | { type: 'crackHit'; pos: Vec2 }
  | { type: 'crackBroken'; pos: Vec2 }
  | { type: 'cageOpen'; pos: Vec2 }
  | { type: 'vialGained'; pos: Vec2; vialId: string }
  | { type: 'bossPhase'; pos: Vec2; phase: number }
  | { type: 'summon'; pos: Vec2 }
  | { type: 'interrupt'; pos: Vec2 }
  | { type: 'leapLand'; pos: Vec2 }
  | { type: 'blockFail'; pos: Vec2 }
  | { type: 'flinch'; pos: Vec2 }
  | { type: 'stagger'; pos: Vec2 }
  | { type: 'bellWarn'; pos: Vec2 }
  | { type: 'bellToll'; pos: Vec2 }
  | { type: 'script'; pos: Vec2; name: string }
  | { type: 'secretOpen'; pos: Vec2 }
  | { type: 'edgeFall'; pos: Vec2 }
  | { type: 'mend'; pos: Vec2 };

/** Level/room difficulty applied to enemies as they spawn (bosses use their own data). */
export interface EnemyScale {
  health: number;
  posture: number;
  damage: number;
}

/** Progress through the current room's waves and doors. */
export interface RoomRun {
  /** Index of the next wave to spawn (== waves.length once all have spawned). */
  wave: number;
  /** Ticks until the next wave spawns (counts only while the field is clear). */
  timer: number;
  cleared: boolean;
  /** How many exit doors lead somewhere this run (set by the run layer). */
  exitCount: number;
  /** Exit door Satan walked into, or null. */
  exit: number | null;
  fontUsed: boolean;
  /** The hidden door to the secret room has been broken open. */
  secretOpen: boolean;
  /** Ticks since Satan fell. */
  deadTicks: number;
}

/** What carries from room to room within a run. */
export interface Carry {
  hp: number;
  pips: number;
  rage?: number;
  /** Vials collected this run (ids). */
  vials?: string[];
}

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
  /** Only the tall walls (pillars) + the arena edge: what flying enemies collide with. */
  tallSegs: Seg[];
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
  flags: { dummyAttacks: boolean; respawn: boolean; immortal: boolean };
  roomRun: RoomRun;
  /** This run's vial bonuses (see stats.ts). */
  mods: Mods;
  /** Vials collected this run, including any picked up in this room. */
  vials: string[];
  pickups: Pickup[];
  enemyScale: EnemyScale;
  /** Biome id (decides hazards like sanctified light). */
  biomeId: string;
  zones: Zones;
  /** Walkers' flow field toward Satan (built lazily for rooms with interior walls). */
  nav: Nav | null;
  /** Set-piece script progress and the lighting preset it has switched to. */
  script: { t: number; fired: boolean[]; lighting: string | null; silenced: boolean };
  /** The hub only: the interactable in reach (id) and whether a walk-in exit has fired. */
  hub: { target: string | null; exited: boolean } | null;
  stats: { hitsLanded: number; hitsTaken: number; kills: number; deflects: number; perfects: number; deathblows: number };
}

export function createWorld(room: RoomDef, cfg: SimConfig, seed = 1, carry?: Carry, pickups: Pickup[] = [], scale: EnemyScale = { health: 1, posture: 1, damage: 1 }, biomeId = 'gardens'): World {
  const segs = [...segmentsFromPolygon(room.bounds), ...room.walls.flatMap((w) => segmentsFromPolygon(w))];
  const tallSegs = [...segmentsFromPolygon(room.bounds), ...room.walls.filter((_, i) => TALL_WALLS.includes(room.wallKinds?.[i] ?? 'pillar')).flatMap((w) => segmentsFromPolygon(w))];
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
    tallSegs,
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
      hp: carry ? carry.hp : cfg.player.maxHealth,
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
      recentBlocks: 0,
      pips: carry ? carry.pips : cfg.player.throw.maxPips,
      pipProgress: 0,
      dead: false,
      rage: carry?.rage ?? 0,
      rageForm: 0,
      rageTransform: 0,
    },
    enemies: [],
    projectiles: [],
    nextId: 1,
    focusId: null,
    camera: { pos: { ...camPos }, prevPos: { ...camPos }, shake: 0, shakeOffset: v2() },
    events: [],
    flags: { dummyAttacks: true, respawn: true, immortal: false },
    mods: modsFromVials(carry?.vials ?? [], cfg),
    vials: [...(carry?.vials ?? [])],
    pickups: pickups.map((q) => ({ ...q, at: { ...q.at }, vialAt: { ...q.vialAt } })),
    enemyScale: { ...scale },
    biomeId,
    zones: makeZones(room.zones, cfg.biomes?.[biomeId]),
    nav: null,
    script: { t: 0, fired: [], lighting: room.lighting ?? null, silenced: false },
    hub: room.interactables ? { target: null, exited: false } : null,
    roomRun: { wave: 0, timer: cfg.rooms.firstWaveDelayFrames, cleared: false, exitCount: room.exits?.length ?? 0, exit: null, fontUsed: false, secretOpen: false, deadTicks: 0 },
    stats: { hitsLanded: 0, hitsTaken: 0, kills: 0, deflects: 0, perfects: 0, deathblows: 0 },
  };
  if (room.walls.length) world.nav = makeNav(world);
  for (const s of room.spawns) spawnEnemy(world, cfg, s.type, v2(s.at[0], s.at[1]));
  return world;
}

export function spawnEnemy(world: World, cfg: SimConfig, type: string, at: Vec2): Enemy {
  const d = cfg.enemies[type];
  if (!d) throw new Error(`unknown enemy type ${type}`);
  // Bosses are hand-tuned: level scaling doesn't apply to them.
  const sc = d.boss ? { health: 1, posture: 1, damage: 1 } : world.enemyScale;
  const hp = Math.round(d.health * sc.health);
  const e: Enemy = {
    id: world.nextId++,
    type,
    pos: { ...at },
    prevPos: { ...at },
    vel: v2(),
    knock: v2(),
    facing: v2(-1, 0),
    hp,
    maxHp: hp,
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
    specialCooldown: d.specialDelay ?? 0,
    arrive: 0,
    stuck: 0,
    postureMax: d.posture.max * sc.posture,
    dmgMul: sc.damage,
    windupLen: 0,
    segments: d.segments ?? 1,
    recoilLen: 0,
    closeTicks: 0,
    meleeHits: 0,
    flinchImmune: 0,
    cds: {},
    stepSide: 1,
    leapFrom: { ...at },
    leapTo: { ...at },
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
