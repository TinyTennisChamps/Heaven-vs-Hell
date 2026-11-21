import { createRng, nextFloat, nextInt, type RngState } from '../../core/rng';
import type { LevelDef, RoomDef, SimConfig } from '../config';
import { maxHp, raging } from '../stats';
import type { Carry, EnemyScale, Pickup, World } from '../world';
import { SECRET_EXIT } from './roomRunner';

const isCombat = (r: RoomDef | undefined) => r?.tier === 'combat' || r?.tier === 'hard';

/**
 * A run through one level: which room Satan is in, what the exit doors lead
 * to, and what carries between rooms. Pure and seeded — same seed, same
 * choices => same rooms.
 *
 * Shape: `combatRooms` combat rooms (no repeats) plus one rest room, then the
 * level's end. The first room comes from `openers`. After each room the exits
 * offer up to two doors; once `restFrom` combat rooms are done, one of them
 * may be the rest room. If the rest was never taken it is the only door
 * before the end. Levels may add fixed set-piece rooms (`fixed`), a secret
 * room behind a cracked wall in one host room, and a `next` level the run
 * continues into after the boss.
 */
export type DoorKind = 'combat' | 'hard' | 'elite' | 'rest' | 'boss' | 'setpiece' | 'secret' | 'end';

export interface DoorOption {
  kind: DoorKind;
  /** Room id (data key under rooms/, e.g. "l1/cloister"); null for 'end'. */
  roomId: string | null;
}

export interface RunState {
  level: string;
  rng: RngState;
  /** Room ids visited so far, including the current one. */
  visited: string[];
  current: string;
  combatDone: number;
  restTaken: boolean;
  /** Where this room's exit doors lead (exit door i -> options[i]). */
  options: DoorOption[];
  carry: Carry;
  /** Seed for the current room's world. */
  roomSeed: number;
  finished: boolean;
  /** The combat room whose cracked rim hides this run's hidden vial (if Satan goes there). */
  hiddenRoom: string | null;
  /** The combat room whose cracked wall hides the door to the level's secret room. */
  secretHost: string | null;
  secretTaken: boolean;
  /** Levels completed this run (their ids). */
  levelsDone: string[];
}

export function startRun(level: LevelDef, rooms: Record<string, RoomDef>, seed: number, carry: Carry): RunState {
  const rng = createRng(seed);
  const opener = level.openers[nextInt(rng, 0, level.openers.length)]!;
  const run: RunState = {
    level: level.id,
    rng,
    visited: [opener],
    current: opener,
    combatDone: 0,
    restTaken: false,
    options: [],
    carry: { ...carry },
    roomSeed: nextInt(rng, 1, 1e9),
    finished: false,
    hiddenRoom: null,
    secretHost: null,
    secretTaken: false,
    levelsDone: [],
  };
  pickHiddenRooms(run, level, rooms);
  run.options = planExits(run, level, rooms);
  return run;
}

function pickHiddenRooms(run: RunState, level: LevelDef, rooms: Record<string, RoomDef>): void {
  const crackRooms = level.pool.filter((id) => rooms[id]?.crack);
  run.hiddenRoom = crackRooms.length ? crackRooms[nextInt(run.rng, 0, crackRooms.length)]! : null;
  const hosts = (level.secretHosts ?? []).filter((id) => rooms[id]?.secret);
  run.secretHost = hosts.length ? hosts[nextInt(run.rng, 0, hosts.length)]! : null;
}

/**
 * What Satan carries through a gate: health plus a small heal (roomHealFrac),
 * pips, the Rage meter (a Rage form in progress is spent) and this run's vials.
 */
export function carryThroughGate(world: World, cfg: SimConfig): Carry {
  const p = world.player;
  const max = maxHp(world, cfg);
  return {
    hp: Math.min(max, p.hp + Math.round(max * cfg.rooms.roomHealFrac)),
    pips: p.pips,
    rage: raging(p) || p.rageTransform > 0 ? 0 : p.rage,
    vials: [...world.vials],
  };
}

/** The vials this room offers in this run: the hidden one behind its crack, the locked one in a hard room's cage. */
export function roomPickups(run: RunState, room: RoomDef, cfg: SimConfig): Pickup[] {
  const have = run.carry.vials ?? [];
  const next = (source: 'hidden' | 'locked' | 'boss' | 'secret') => cfg.vials.vials.find((v) => v.level === run.level && v.source === source && !have.includes(v.id));
  const out: Pickup[] = [];
  const hidden = next('hidden');
  if (room.crack && room.id === run.hiddenRoom && hidden) {
    // The vial rolls a little inward from the broken rim.
    const xs = room.bounds.map((b) => b[0]);
    const ys = room.bounds.map((b) => b[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const dx = cx - room.crack[0];
    const dy = cy - room.crack[1];
    const l = Math.hypot(dx, dy) || 1;
    const at = { x: room.crack[0], y: room.crack[1] };
    out.push({ vialId: hidden.id, kind: 'crack', at, vialAt: { x: at.x + (dx / l) * 16, y: at.y + (dy / l) * 16 }, hits: 0, open: false, taken: false });
  }
  // The secret room's own vial, waiting in the open.
  if (room.vial && !have.includes(room.vial.id)) {
    const at = { x: room.vial.at[0], y: room.vial.at[1] };
    out.push({ vialId: room.vial.id, kind: 'drop', at, vialAt: { ...at }, hits: 0, open: true, taken: false });
  }
  // The cracked wall hiding the secret door (only in this run's host room).
  if (room.secret && room.id === run.secretHost && !run.secretTaken) {
    const at = { x: room.secret.crack[0], y: room.secret.crack[1] };
    out.push({ vialId: '', kind: 'secret', at, vialAt: { ...at }, hits: 0, open: false, taken: false });
  }
  const drop = next('boss');
  if (room.tier === 'boss' && drop) {
    // Dropped where the boss falls (the runner moves it there on clear).
    const at = { x: room.playerSpawn[0], y: room.playerSpawn[1] };
    out.push({ vialId: drop.id, kind: 'drop', at, vialAt: { ...at }, hits: 0, open: false, taken: false });
  }
  const locked = next('locked');
  if (room.cage && room.tier === 'hard' && locked) {
    const at = { x: room.cage[0], y: room.cage[1] };
    out.push({ vialId: locked.id, kind: 'cage', at, vialAt: { ...at }, hits: 0, open: false, taken: false });
  }
  return out;
}

/**
 * Enemy toughness for a room: the level's multipliers, ramped by how many
 * combat rooms this run has already cleared (bosses ignore scaling).
 */
export function roomScale(run: RunState, level: LevelDef, room: RoomDef): EnemyScale {
  const s = level.scaling;
  const f = isCombat(room) || room.tier === 'setpiece' ? 1 + level.rampPerRoom * run.combatDone : 1;
  return { health: s.health * f, posture: s.posture * f, damage: s.damage * f };
}

/** Rage a new run starts with after a fall: capped so you can never begin able to transform. */
export function rageCarryOver(rageAtFall: number, fallsInARow: number, cfg: SimConfig): number {
  const c = cfg.rage.carryOver;
  return Math.min(c.max, Math.round(c.meterMul * rageAtFall + c.perDeath * fallsInARow));
}

/**
 * The current room is cleared and Satan took exit `i` (or the hidden door,
 * SECRET_EXIT), carrying `carry` forward. With `levels`, the end of a level
 * that has a `next` continues the run there instead of finishing it.
 */
export function takeExit(run: RunState, i: number, level: LevelDef, rooms: Record<string, RoomDef>, carry: Carry, levels?: Record<string, LevelDef>): DoorOption {
  const was = rooms[run.current];
  if (isCombat(was)) run.combatDone++;
  run.carry = { ...carry };
  if (i === SECRET_EXIT && level.secret && rooms[level.secret]) {
    // Through the hidden door; on the far side the same choices wait.
    const onward = run.options;
    run.secretTaken = true;
    run.current = level.secret;
    run.visited.push(level.secret);
    run.roomSeed = nextInt(run.rng, 1, 1e9);
    run.options = onward;
    return { kind: 'secret', roomId: level.secret };
  }
  const opt = run.options[i] ?? run.options[0]!;
  if (opt.kind === 'end' || !opt.roomId) {
    const next = level.next ? levels?.[level.next] : undefined;
    if (next) {
      // Down to the next layer: a fresh level, same run (health, vials and Rage carry on).
      run.levelsDone.push(level.id);
      run.level = next.id;
      run.combatDone = 0;
      run.restTaken = false;
      run.secretTaken = false;
      const opener = next.openers[nextInt(run.rng, 0, next.openers.length)]!;
      run.current = opener;
      run.visited.push(opener);
      run.roomSeed = nextInt(run.rng, 1, 1e9);
      pickHiddenRooms(run, next, rooms);
      run.options = planExits(run, next, rooms);
      return { kind: 'end', roomId: opener };
    }
    run.finished = true;
    run.options = [];
    return opt;
  }
  if (opt.kind === 'rest') run.restTaken = true;
  run.current = opt.roomId;
  run.visited.push(opt.roomId);
  run.roomSeed = nextInt(run.rng, 1, 1e9);
  run.options = planExits(run, level, rooms);
  return opt;
}

/** Combat rooms finished once the current room is cleared. */
function doneAfterCurrent(run: RunState, rooms: Record<string, RoomDef>): number {
  return run.combatDone + (isCombat(rooms[run.current]) ? 1 : 0);
}

function planExits(run: RunState, level: LevelDef, rooms: Record<string, RoomDef>): DoorOption[] {
  const done = doneAfterCurrent(run, rooms);
  const left = level.combatRooms - done;
  const restDoor: DoorOption = { kind: 'rest', roomId: level.rest };
  if (rooms[run.current]?.tier === 'boss') return [{ kind: 'end', roomId: null }];
  // A fixed set-piece takes over once its slot comes up.
  const fixed = level.fixed?.find((f) => f.afterCombat <= done && !run.visited.includes(f.room));
  if (fixed) return [{ kind: 'setpiece', roomId: fixed.room }];
  if (left <= 0) return run.restTaken ? [{ kind: 'boss', roomId: level.boss }] : [restDoor];

  const fresh = level.pool.filter((id) => !run.visited.includes(id));
  shuffle(run.rng, fresh);
  const kindOf = (r: RoomDef | undefined): DoorKind => (r?.elite ? 'elite' : r?.tier === 'hard' ? 'hard' : 'combat');
  const picks: DoorOption[] = fresh.slice(0, 2).map((id) => ({ kind: kindOf(rooms[id]), roomId: id }));
  const restOffered = !run.restTaken && done >= level.restFrom && rooms[run.current]?.tier !== 'rest';
  if (restOffered) {
    if (picks.length >= 2) picks[1] = restDoor;
    else picks.push(restDoor);
  }
  return picks.length ? picks : [{ kind: 'end', roomId: null }];
}

function shuffle<T>(rng: RngState, a: T[]): void {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(nextFloat(rng) * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
}
