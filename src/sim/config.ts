/**
 * Shapes of the tuning data the sim reads. The objects are owned by the data
 * store and mutated in place on hot reload, so the sim must read fields each
 * tick rather than caching them.
 */
export interface DashTuning {
  distance: number;
  frames: number;
  /** 1-based dash frames that are invulnerable (inclusive). */
  iFrameStart: number;
  iFrameEnd: number;
  endLag: number;
  endLagSpeedMul: number;
  /** Fraction of maxSpeed kept when the dash ends, so it flows into running. */
  exitSpeedMul: number;
  /** Ticks after a dash ends before another dash is allowed (no double-dashing). */
  cooldownFrames: number;
}

export interface PostureTuning {
  max: number;
  /** Ticks without being hit before posture starts draining. */
  regenDelay: number;
  regenPerSec: number;
  /** Regen multiplier at 0 HP (lerps to 1 at full HP) — low health recovers slower. */
  lowHealthMul: number;
}

export interface PlayerTuning {
  /** Ground px per second. */
  maxSpeed: number;
  /** Ticks from standstill to maxSpeed. */
  accelFrames: number;
  /** Ticks from maxSpeed to standstill. */
  decelFrames: number;
  radius: number;
  maxHealth: number;
  posture: PostureTuning & { breakStunFrames: number };
  dash: DashTuning;
  throw: { maxPips: number; hitsPerPip: number; perfectParryPips: number };
}

/** A thrown or shot projectile (Satan's bolt, an archer's arrow). */
export interface ProjectileSpec {
  /** px/s */
  speed: number;
  radius: number;
  lifeFrames: number;
}

export interface FeelTuning {
  inputBufferFrames: number;
  /** Multiplier on screen-vertical movement to offset iso foreshortening. */
  verticalSpeedComp: number;
}

export interface CombatTuning {
  comboResetFrames: number;
  hitFlashFrames: number;
  /** Knockback velocity multiplier per tick. */
  knockbackFriction: number;
  hurtStunFrames: number;
  separationStrength: number;
  /** Fraction of an attack's postureDamage Satan takes when hit unguarded. */
  hitPostureMul: number;
  aimAssist: { coneDeg: number; range: number; maxRotateDeg: number };
  parry: {
    windowFrames: number;
    perfectFrames: number;
    whiffPenaltyFrames: number;
    penalizedWindowFrames: number;
    coneDeg: number;
    selfPostureMul: number;
    perfectSelfPostureMul: number;
    attackerPostureMul: number;
    perfectAttackerPostureMul: number;
    hitstop: number;
    perfectHitstop: number;
    shake: number;
    perfectShake: number;
    moveSpeedMul: number;
    /** Knockback (px/s) applied to the attacker on a deflect / perfect deflect. */
    recoil: number;
    perfectRecoil: number;
  };
  block: { coneDeg: number; postureMul: number; stunFrames: number; dashAfter: number; moveSpeedMul: number; knockback: number; hitstop: number };
  deathblow: { range: number; hitstop: number; slowmoFrames: number; slowmoScale: number; shake: number };
  /** Perfect deflect staggers the attacker; Satan's hits on it are multiplied meanwhile. */
  riposte: { frames: number; healthMul: number; postureMul: number };
  /** Deflected arrows fly back at their archer. */
  reflect: { speedMul: number; perfectSpeedMul: number; healthDamage: number; postureDamage: number; perfectHealthDamage: number; perfectPostureDamage: number };
  /** Sekiro-style lock-on (Q). */
  lockOn: { range: number; breakRange: number; holdToReleaseFrames: number; cameraBias: number };
  /** Group fights: only the focus enemy attacks freely; the rest hold back. */
  groups: { holdBackDistance: number; holdBackSpeedMul: number; supportAttackChance: number; supportCooldownMul: number; swarmMax: number };
  /** While parrying/blocking, turn to face the most imminent attacker within range. */
  autoFace: { enabled: boolean; range: number };
  breakHitstop: number;
  /** Render: how many ticks before an attack lands its "now!" flash starts. */
  telegraph: { flashLeadFrames: number };
}

export interface CameraTuning {
  followRate: number;
  lookAheadFactor: number;
  lookAheadMax: number;
  roomMargin: number;
  shakeDecay: number;
  shakeMax: number;
}

export interface ArcHitbox {
  radius: number;
  angleDeg: number;
  /** Arc origin pushed forward from the attacker's centre. */
  offset: number;
}

/** Frame data for one player attack. Frames are ticks at 60 Hz. */
export interface AttackDef {
  startup: number;
  active: number;
  recovery: number;
  /** Recovery frame (1-based) from which a buffered press chains the next hit. */
  chainAt: number;
  lunge: { px: number; overFrames: number };
  moveSpeedMul: number;
  hitbox: ArcHitbox;
  healthDamage: number;
  postureDamage: number;
  hitstop: number;
  /** Initial knockback speed (px/s) given to the target. */
  knockback: number;
  shake: number;
  /** If set, the first active frame launches a projectile instead of a melee arc. */
  projectile?: ProjectileSpec;
}

export interface EnemyAttackDef {
  /** AI: preferred max distance to start this attack. */
  range: number;
  windup: number;
  /** Windup frame after which the attack direction is locked. */
  trackUntil: number;
  active: number;
  recovery: number;
  healthDamage: number;
  postureDamage: number;
  knockback: number;
  hitstop: number;
  shake: number;
  hitbox: ArcHitbox;
  /** Unblockable (and undeflectable unless `deflectable`); telegraphed white-gold. */
  judgement?: boolean;
  /** A judgement attack that a timed parry can still deflect (holding block never stops it). */
  deflectable?: boolean;
  lunge?: { px: number; overFrames: number };
  /** Optional follow-up attack started straight from recovery. */
  chain?: { next: string; chance: number };
  /** Extra windup ticks rolled 0..windupJitter per use (a varied delay that catches mashers). */
  windupJitter?: number;
  /** Hitting the attacker during the windup cancels it (stagger) with bonus posture. */
  interruptible?: boolean;
  /**
   * Leap: during the active phase the attacker flies from where it stood to
   * the landing point over `frames` ticks (untouchable in the air), homing on
   * Satan for the first `homeFrac` of the flight; the hitbox strikes on landing.
   */
  leap?: { frames: number; maxDist: number; homeFrac: number; height: number };
  /** Parrying doesn't stagger it (no riposte opening); the string keeps coming. */
  relentless?: boolean;
  /** Movement at the start of the windup: a sidestep (angleDeg ±, randomSide picks the side), a backstep (angle 180) or a pull-back. */
  preStep?: { px: number; angleDeg: number; frames: number; randomSide?: boolean };
  /** A movement-only "attack" (sidestep, wing-dash): no hitbox, never counts as busy. */
  noHit?: boolean;
  /** Super-armour: Satan's hits still hurt and build posture but cause no knockback or flinch. A posture break still ends it. */
  superArmor?: boolean;
  /** Overrides what a deflect does to the attacker: posture added, and a stagger (riposte window) on any deflect. */
  onDeflect?: { posture: number; perfectPosture: number; recoilFrames: number };
  /** Fire `count` projectiles, `interval` ticks apart, starting on the first active tick (aim locked). */
  volley?: { count: number; interval: number };
  /** After this attack (or its string) recovers, it can't be used again for [min, max] ticks. */
  cooldownAfter?: [number, number];
  /** Ranged pool: doesn't gate melee enemies; at most one ranged-pool attack is telegraphed in a room at once. */
  rangedPool?: boolean;
  /** Visual kind of the projectile (default 'arrow'). */
  projectileKind?: 'arrow' | 'laser';
  /** On the first active tick, call in reinforcements instead of striking. */
  summon?: { type: string; count: number; spread: number; maxAlive: number };
  /** If set, the first active frame fires this projectile instead of a melee arc. */
  projectile?: ProjectileSpec;
}

export interface EnemyDef {
  health: number;
  radius: number;
  speed: number;
  turnRateDeg: number;
  attackRange: number;
  cooldownMin: number;
  cooldownMax: number;
  respawnFrames: number;
  brokenFrames: number;
  /** Frontal arc where Satan's hits are absorbed by a shield (0 = no shield). */
  shieldArcDeg: number;
  shieldPostureMul: number;
  counterAfterBlocks?: number;
  judgementChance?: number;
  /** Ranged enemies: distance they try to keep from Satan. */
  preferredRange?: number;
  /** Posture multiplier for Satan's thrown bolts (archers, ophans take extra). */
  throwPostureMul?: number;
  /** Shielded enemies turn faster when Satan is outside the shield arc. */
  flankTurnRateDeg?: number;
  /** Flanking punish: after Satan spends `afterFrames` behind the shield within `range`, spin (once per cooldown). */
  flankSpin?: { afterFrames: number; range: number; cooldownFrames: number };
  posture: PostureTuning;
  /** Elites (one per room) are preferred as the focus when Satan isn't locked on. */
  elite?: boolean;
  /** Flies over low cover (hedges, fountains); still blocked by pillars and the arena edge. */
  flying?: boolean;
  /** A short hit-reaction when not in super-armour, then immunity so it can't be stun-locked. */
  flinchFrames?: number;
  flinchImmuneFrames?: number;
  /** Posture multiplier for its own projectiles deflected back into it. */
  reflectPostureMul?: number;
  /** Knockback taken multiplier (light floaters). */
  knockbackMul?: number;
  /** Render: telegraph colour (e.g. the Watcher's iris), CSS hex. */
  telegraphColor?: string;
  /** Name shown in the Training Court and debug overlay. */
  displayName?: string;
  /** Sprite height (px), for health bars and markers above it. */
  height?: number;
  /** Per-type AI tuning values (ranges, trigger counts, weights). */
  ai?: Record<string, number>;
  /** Bosses: hand-tuned (no level scaling), a big HUD bar, and `segments` health bars. */
  boss?: boolean;
  /** Display name for the boss bar. */
  title?: string;
  segments?: number;
  /** Bosses: ticks the rally between segments lasts. */
  rallyFrames?: number;
  /** Ticks before the first special move (e.g. Gabriel's first Horn Call). */
  specialDelay?: number;
  /** Gabriel: Horn Call cooldown [phase 1, phase 2] in ticks. */
  hornEveryFrames?: [number, number];
  /** Swarmers (cherubs) ignore the focus/hold-back rule and use their own pool (combat.groups.swarmMax). */
  swarm?: boolean;
  /** No posture bar: every hit just deals damage (cherubs die in one hit). */
  noPosture?: boolean;
  /** Swarmers: distance they circle at before lunging. */
  orbitRange?: number;
  attacks: Record<string, EnemyAttackDef>;
}

export interface SimConfig {
  player: PlayerTuning;
  feel: FeelTuning;
  combat: CombatTuning;
  camera: CameraTuning;
  attacks: Record<string, AttackDef>;
  enemies: Record<string, EnemyDef>;
  rooms: RoomTuning;
  rage: RageTuning;
  vials: VialsData;
}

export type WallKind = 'pillar' | 'hedge' | 'fountain';

/** A group of enemies in a wave. `count` > 1 scatters them in a ring of `spread` px around `at`. */
export interface WaveSpawn {
  type: string;
  at: [number, number];
  count?: number;
  spread?: number;
}

export interface DoorDef {
  /** Ground point on the room's edge. */
  at: [number, number];
}

export interface RoomDef {
  id: string;
  name: string;
  /** 'combat' | 'hard' | 'rest' | 'boss' | 'training' — shown on door icons. */
  tier?: 'combat' | 'hard' | 'rest' | 'boss' | 'training';
  bounds: [number, number][];
  walls: [number, number][][];
  /** Visual kind per wall (parallel to `walls`), default 'pillar'. */
  wallKinds?: WallKind[];
  playerSpawn: [number, number];
  /** Enemies present from the start (training / tests). */
  spawns: { type: string; at: [number, number] }[];
  /** Waves: each starts when the previous one is fully down. */
  waves?: WaveSpawn[][];
  /** Entry door (behind Satan) and exit doors (up to 2). */
  entry?: DoorDef;
  exits?: DoorDef[];
  /** Rest room: the font that heals once when Satan reaches it. */
  font?: [number, number];
  /** Cracked rim spot that can hide this run's hidden vial (slash it open). */
  crack?: [number, number];
  /** Hard rooms: where the locked vial cage stands (opens on clear). */
  cage?: [number, number];
}

export type VialStat = 'maxPosture' | 'rageGain' | 'slashPosture' | 'deflectFrames' | 'maxHealth' | 'pips' | 'postureRegen';

export interface VialDef {
  id: string;
  level: string;
  source: 'hidden' | 'locked' | 'boss';
  name: string;
  stat: VialStat;
  /** Fraction (0.05 = +5%) for multiplier stats; whole units for deflectFrames / pips. */
  amount: number;
  text: string;
}

export interface VialsData {
  vials: VialDef[];
  /** Budget: no stat may exceed +20% from vials. */
  maxPerStat: number;
}

export interface RageTuning {
  max: number;
  gain: { kill: number; deathblow: number; perfectParry: number; hitTaken: number };
  /** Invulnerable transform before the form starts. */
  transformFrames: number;
  durationFrames: number;
  /** Each kill in Rage adds this many ticks and heals `killHeal`. */
  killExtendFrames: number;
  killHeal: number;
  /** Hyper armour: incoming health damage multiplier; no stagger, no posture. */
  damageTakenMul: number;
  radiusMul: number;
  speedMul: number;
  /** RMB in Rage: a burst around Satan. */
  roar: { cooldownFrames: number; radius: number; healthDamage: number; postureDamage: number; knockback: number; hitstop: number; shake: number };
  /** Next run starts with min(max, meterMul * meter at death + perDeath * deaths in a row). */
  carryOver: { max: number; meterMul: number; perDeath: number };
}

export interface RoomTuning {
  /** Ticks between one wave going down and the next appearing. */
  waveDelayFrames: number;
  /** Ticks after entering before the first wave appears. */
  firstWaveDelayFrames: number;
  /** Spawn-in: enemies are visible but harmless for this many ticks. */
  arriveFrames: number;
  doorRadius: number;
  fontRadius: number;
  /** Rest font heal, fraction of max health. */
  restHealFrac: number;
  /** Heal on walking through a gate into the next room, fraction of max health. */
  roomHealFrac: number;
  /** Ticks after Satan falls before the run can end. */
  deathFrames: number;
  /** Slashes that break a cracked rim spot open. */
  crackHits: number;
  /** Distance at which Satan picks up a revealed vial. */
  pickupRadius: number;
}

/** A level: a pool of combat rooms, how many a run visits, the rest room and the end. */
export interface LevelDef {
  id: string;
  name: string;
  pool: string[];
  combatRooms: number;
  /** Earliest combat-room count after which the rest room may be offered. */
  restFrom: number;
  rest: string;
  /** The first room is always drawn from these (gentle start + tutorial). */
  openers: string[];
  /** The level's boss arena, entered after the combat rooms and the rest. */
  boss: string;
  /** Enemy multipliers for this level (bosses excepted). */
  scaling: { health: number; posture: number; damage: number };
  /** Each combat room already cleared this run makes enemies this much tougher (all three stats). */
  rampPerRoom: number;
}
