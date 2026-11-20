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
  breakHitstop: number;
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
  /** Unblockable and undeflectable; telegraphed white-gold. */
  judgement?: boolean;
  lunge?: { px: number; overFrames: number };
  /** Optional follow-up attack started straight from recovery. */
  chain?: { next: string; chance: number };
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
  posture: PostureTuning;
  attacks: Record<string, EnemyAttackDef>;
}

export interface SimConfig {
  player: PlayerTuning;
  feel: FeelTuning;
  combat: CombatTuning;
  camera: CameraTuning;
  attacks: Record<string, AttackDef>;
  enemies: Record<string, EnemyDef>;
}

export interface RoomDef {
  id: string;
  name: string;
  bounds: [number, number][];
  walls: [number, number][][];
  playerSpawn: [number, number];
  spawns: { type: string; at: [number, number] }[];
}
