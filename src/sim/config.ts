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
  dash: DashTuning;
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
  aimAssist: { coneDeg: number; range: number; maxRotateDeg: number };
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
}

export interface DummyDef {
  health: number;
  radius: number;
  speed: number;
  attackRange: number;
  attackCooldown: number;
  respawnFrames: number;
  swing: {
    windup: number;
    /** Windup frame after which the swing direction is locked. */
    trackUntil: number;
    active: number;
    recovery: number;
    damage: number;
    knockback: number;
    hitstop: number;
    shake: number;
    hitbox: ArcHitbox;
  };
}

export interface SimConfig {
  player: PlayerTuning;
  feel: FeelTuning;
  combat: CombatTuning;
  camera: CameraTuning;
  attacks: Record<string, AttackDef>;
  dummy: DummyDef;
}

export interface RoomDef {
  id: string;
  name: string;
  bounds: [number, number][];
  walls: [number, number][][];
  playerSpawn: [number, number];
  dummySpawns: [number, number][];
}
