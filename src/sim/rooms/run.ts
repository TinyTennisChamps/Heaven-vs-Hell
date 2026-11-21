import { createRng, nextFloat, nextInt, type RngState } from '../../core/rng';
import type { LevelDef, RoomDef, SimConfig } from '../config';
import { maxHp, raging } from '../stats';
import type { Carry, Pickup, World } from '../world';

/**
 * A run through one level: which room Satan is in, what the exit doors lead
 * to, and what carries between rooms. Pure and seeded — same seed, same
 * choices => same rooms.
 *
 * Shape: `combatRooms` combat rooms (no repeats) plus one rest room, then the
 * level's end. The first room comes from `openers`. After each room the exits
 * offer up to two doors; once `restFrom` combat rooms are done, one of them
 * may be the rest room. If the rest was never taken it is the only door
 * before the end.
 */
export type DoorKind = 'combat' | 'hard' | 'rest' | 'end';

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
  };
  const crackRooms = level.pool.filter((id) => rooms[id]?.crack);
  run.hiddenRoom = crackRooms.length ? crackRooms[nextInt(rng, 0, crackRooms.length)]! : null;
  run.options = planExits(run, level, rooms);
  return run;
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
  const next = (source: 'hidden' | 'locked') => cfg.vials.vials.find((v) => v.level === run.level && v.source === source && !have.includes(v.id));
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
  const locked = next('locked');
  if (room.cage && room.tier === 'hard' && locked) {
    const at = { x: room.cage[0], y: room.cage[1] };
    out.push({ vialId: locked.id, kind: 'cage', at, vialAt: { ...at }, hits: 0, open: false, taken: false });
  }
  return out;
}

/** Rage a new run starts with after a fall: capped so you can never begin able to transform. */
export function rageCarryOver(rageAtFall: number, fallsInARow: number, cfg: SimConfig): number {
  const c = cfg.rage.carryOver;
  return Math.min(c.max, Math.round(c.meterMul * rageAtFall + c.perDeath * fallsInARow));
}

/** The current room is cleared and Satan took exit `i`, carrying `carry` forward. */
export function takeExit(run: RunState, i: number, level: LevelDef, rooms: Record<string, RoomDef>, carry: Carry): DoorOption {
  const opt = run.options[i] ?? run.options[0]!;
  const was = rooms[run.current];
  if (was && was.tier !== 'rest') run.combatDone++;
  run.carry = { ...carry };
  if (opt.kind === 'end' || !opt.roomId) {
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
  return run.combatDone + (rooms[run.current]?.tier === 'rest' ? 0 : 1);
}

function planExits(run: RunState, level: LevelDef, rooms: Record<string, RoomDef>): DoorOption[] {
  const done = doneAfterCurrent(run, rooms);
  const left = level.combatRooms - done;
  const restDoor: DoorOption = { kind: 'rest', roomId: level.rest };
  if (left <= 0) return run.restTaken ? [{ kind: 'end', roomId: null }] : [restDoor];

  const fresh = level.pool.filter((id) => !run.visited.includes(id));
  shuffle(run.rng, fresh);
  const picks: DoorOption[] = fresh.slice(0, 2).map((id) => ({ kind: rooms[id]?.tier === 'hard' ? 'hard' : 'combat', roomId: id }));
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
