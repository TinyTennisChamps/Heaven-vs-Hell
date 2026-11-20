import { createRng, nextFloat, nextInt, type RngState } from '../../core/rng';
import type { LevelDef, RoomDef } from '../config';
import type { Carry } from '../world';

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
  };
  run.options = planExits(run, level, rooms);
  return run;
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
