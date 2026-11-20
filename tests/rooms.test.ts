import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { LevelDef, RoomDef } from '../src/sim/config';
import { killEnemy } from '../src/sim/combat/damage';
import { findSpot } from '../src/sim/rooms/roomRunner';
import { carryThroughGate, startRun, takeExit } from '../src/sim/rooms/run';
import { startEnemyAttack } from '../src/sim/actors/enemy';
import { step } from '../src/sim/step';
import { createWorld, isValidSpot, type World } from '../src/sim/world';
import { input, loadData, run, testConfig, testWorld } from './helpers';

const cfg = testConfig();
const level = loadData<LevelDef>('levels/l1');

function loadRooms(): Record<string, RoomDef> {
  const dir = path.resolve(__dirname, '../data/rooms/l1');
  const out: Record<string, RoomDef> = {};
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) {
    const r = loadData<RoomDef>(`rooms/l1/${f.replace('.json', '')}`);
    out[r.id] = r;
  }
  return out;
}
const rooms = loadRooms();

function roomWorld(id: string, seed = 3): World {
  const w = createWorld(rooms[id]!, cfg, seed);
  return w;
}

/** Kill everything currently up, then tick until the room settles. */
function clearRoom(w: World): void {
  for (let guard = 0; guard < 40 && !w.roomRun.cleared; guard++) {
    for (const e of w.enemies) if (e.phase !== 'down') killEnemy(w, e);
    run(w, cfg, cfg.rooms.waveDelayFrames + cfg.rooms.firstWaveDelayFrames + 2);
  }
}

describe('L1 room data', () => {
  it('the level pool, openers and rest all exist', () => {
    for (const id of [...level.pool, ...level.openers, level.rest]) expect(rooms[id], id).toBeDefined();
    expect(level.pool.length).toBeGreaterThanOrEqual(level.combatRooms + 1);
  });

  for (const id of Object.keys(rooms)) {
    it(`${id}: spawn, waves, doors and font are reachable and inside the arena`, () => {
      const w = roomWorld(id);
      const r = rooms[id]!;
      expect(isValidSpot(w, r.playerSpawn[0], r.playerSpawn[1], cfg.player.radius), 'player spawn').toBe(true);
      for (const wave of r.waves ?? []) for (const s of wave) {
        expect(cfg.enemies[s.type], s.type).toBeDefined();
        expect(findSpot(w, s.at[0], s.at[1], cfg.enemies[s.type]!.radius + 2), `${s.type} at ${s.at}`).not.toBeNull();
      }
      // A door is usable if Satan can stand somewhere inside its trigger radius.
      for (const d of r.exits ?? []) {
        const spot = findSpot(w, d.at[0], d.at[1], cfg.player.radius);
        expect(spot).not.toBeNull();
        expect(Math.hypot(spot!.x - d.at[0], spot!.y - d.at[1])).toBeLessThanOrEqual(cfg.rooms.doorRadius);
      }
      if (r.font) {
        const spot = findSpot(w, r.font[0], r.font[1], cfg.player.radius);
        expect(Math.hypot(spot!.x - r.font[0], spot!.y - r.font[1])).toBeLessThanOrEqual(cfg.rooms.fontRadius);
      }
    });
  }
});

describe('room runner', () => {
  it('waves arrive one after another, then the exits unlock', () => {
    const w = roomWorld('l1/cloister');
    const waves = rooms['l1/cloister']!.waves!;
    run(w, cfg, cfg.rooms.firstWaveDelayFrames + 2);
    expect(w.enemies.length).toBe(waves[0]!.reduce((n, s) => n + (s.count ?? 1), 0));
    expect(w.enemies.every((e) => e.arrive > 0)).toBe(true); // spawning in, harmless
    expect(w.roomRun.cleared).toBe(false);
    clearRoom(w);
    expect(w.roomRun.wave).toBe(waves.length);
    expect(w.roomRun.cleared).toBe(true);
  });

  it('exit doors only work once the room is cleared', () => {
    const w = roomWorld('l1/cloister');
    const d = rooms['l1/cloister']!.exits![0]!.at;
    const spot = findSpot(w, d[0], d[1], cfg.player.radius)!;
    run(w, cfg, cfg.rooms.firstWaveDelayFrames + 2);
    w.player.pos = { ...spot };
    run(w, cfg, 5);
    expect(w.roomRun.exit).toBeNull();
    clearRoom(w);
    w.player.pos = { ...spot };
    run(w, cfg, 2);
    expect(w.roomRun.exit).toBe(0);
  });

  it('a second exit door is shut when the run only offers one way on', () => {
    const w = roomWorld('l1/cloister');
    w.roomRun.exitCount = 1;
    clearRoom(w);
    const d = rooms['l1/cloister']!.exits![1]!.at;
    w.player.pos = { ...findSpot(w, d[0], d[1], cfg.player.radius)! };
    run(w, cfg, 3);
    expect(w.roomRun.exit).toBeNull();
  });

  it('the rest font heals 40% once and refills throw pips', () => {
    const w = createWorld(rooms['l1/rest']!, cfg, 1, { hp: 20, pips: 0 });
    const f = rooms['l1/rest']!.font!;
    w.player.pos = { ...findSpot(w, f[0], f[1], cfg.player.radius)! };
    run(w, cfg, 3);
    expect(w.player.hp).toBe(20 + Math.round(cfg.player.maxHealth * cfg.rooms.restHealFrac));
    expect(w.player.pips).toBe(cfg.player.throw.maxPips);
    w.player.hp = 10;
    run(w, cfg, 3);
    expect(w.player.hp).toBe(10);
    expect(w.roomRun.cleared).toBe(true); // nothing to fight, doors open
  });
});

describe('gate heal', () => {
  it('going through a gate heals a little (roomHealFrac), capped at max, pips unchanged', () => {
    const heal = Math.round(cfg.player.maxHealth * cfg.rooms.roomHealFrac);
    expect(heal).toBeGreaterThan(0);
    expect(carryThroughGate(40, 2, cfg)).toEqual({ hp: 40 + heal, pips: 2 });
    expect(carryThroughGate(cfg.player.maxHealth - 1, 5, cfg).hp).toBe(cfg.player.maxHealth);
  });

  it('the next room starts with the healed health', () => {
    const r = startRun(level, rooms, 4, { hp: 100, pips: 5 });
    takeExit(r, 0, level, rooms, carryThroughGate(30, 3, cfg));
    const w = createWorld(rooms[r.current]!, cfg, r.roomSeed, r.carry);
    expect(w.player.hp).toBe(30 + Math.round(cfg.player.maxHealth * cfg.rooms.roomHealFrac));
  });
});

describe('run planner', () => {
  function playRun(seed: number, pick: (n: number, t: number) => number) {
    const r = startRun(level, rooms, seed, { hp: 100, pips: 5 });
    const order: string[] = [r.current];
    for (let t = 0; t < 20 && !r.finished; t++) {
      takeExit(r, pick(r.options.length, t), level, rooms, r.carry);
      if (!r.finished) order.push(r.current);
    }
    return { r, order };
  }

  it(`every run is ${level.combatRooms} combat rooms + the rest room, no repeats, whatever doors you pick`, () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { r, order } = playRun(seed, (n, t) => (seed + t) % n);
      expect(r.finished).toBe(true);
      expect(level.openers).toContain(order[0]);
      expect(order.filter((id) => id === level.rest).length).toBe(1);
      const combat = order.filter((id) => id !== level.rest);
      expect(combat.length).toBe(level.combatRooms);
      expect(new Set(combat).size).toBe(combat.length);
    }
  });

  it(`the rest door is never offered before ${level.restFrom} rooms are cleared, and two doors are offered where possible`, () => {
    const r = startRun(level, rooms, 9, { hp: 100, pips: 5 });
    expect(r.options.length).toBe(2);
    expect(r.options.some((o) => o.kind === 'rest')).toBe(false);
    takeExit(r, 0, level, rooms, r.carry);
    expect(r.options.some((o) => o.kind === 'rest')).toBe(true);
  });

  it('is deterministic for a seed', () => {
    expect(playRun(42, () => 0).order).toEqual(playRun(42, () => 0).order);
  });
});

describe('cherubs', () => {
  const C = cfg.enemies.cherub!;

  it('die to a single slash and have no posture', () => {
    const w = testWorld(cfg, { only: ['cherub'] });
    const e = w.enemies[0]!;
    w.player.pos = { x: 100, y: 120 };
    e.pos = { x: 116, y: 120 };
    e.cooldown = 9999;
    step(w, input({ press: ['slash'], aim: { ...e.pos } }), cfg);
    run(w, cfg, 20, () => input({ aim: { ...e.pos } }));
    expect(e.phase).toBe('down');
  });

  it(`a cloud never has more than swarmMax (${cfg.combat.groups.swarmMax}) lunging at once — and doesn't stop the Dominion attacking`, () => {
    const room = { ...rooms['l1/cloister']!, waves: [[{ type: 'cherub', at: [150, 130] as [number, number], count: 10, spread: 30 }, { type: 'dominion', at: [140, 110] as [number, number] }]] };
    const w = createWorld(room, cfg, 5);
    w.flags.immortal = true;
    let maxAt = 0;
    let domAttacks = 0;
    let cherubAttacks = 0;
    for (let t = 0; t < 60 * 25; t++) {
      step(w, input({}), cfg);
      w.player.posture = 0;
      let n = 0;
      for (const e of w.enemies) {
        if (e.type === 'cherub' && (e.phase === 'windup' || e.phase === 'active')) n++;
        if (e.phase === 'windup' && e.phaseFrame === 1) e.type === 'dominion' ? domAttacks++ : cherubAttacks++;
      }
      maxAt = Math.max(maxAt, n);
    }
    expect(maxAt).toBeLessThanOrEqual(cfg.combat.groups.swarmMax);
    expect(maxAt).toBeGreaterThan(1); // it really is a swarm
    expect(cherubAttacks).toBeGreaterThan(10);
    expect(domAttacks).toBeGreaterThan(0);
  });

  it('a lunge can be deflected', () => {
    const w = testWorld(cfg, { only: ['cherub'] });
    const e = w.enemies[0]!;
    w.player.pos = { x: 100, y: 120 };
    e.pos = { x: 130, y: 120 };
    e.facing = { x: -1, y: 0 };
    startEnemyAttack(w, e, 'lunge', cfg);
    const wind = C.attacks.lunge!.windup;
    for (let t = 0; t < 60; t++) step(w, input({ press: t === wind - 2 ? ['parry'] : [], aim: { ...e.pos } }), cfg);
    expect(w.stats.deflects).toBe(1);
    expect(w.player.hp).toBe(cfg.player.maxHealth);
  });
});

describe('death', () => {
  it('at 0 health Satan falls, stops acting, and takes no more hits', () => {
    const w = testWorld(cfg, { only: ['dummy'], immortal: false, dummyAttacks: true });
    const e = w.enemies[0]!;
    w.player.pos = { x: 100, y: 120 };
    e.pos = { x: 118, y: 120 };
    w.player.hp = 1;
    run(w, cfg, 300);
    expect(w.player.dead).toBe(true);
    expect(w.player.hp).toBe(0);
    const hits = w.stats.hitsTaken;
    const pos = { ...w.player.pos };
    run(w, cfg, 200, () => input({ press: ['dash'], move: { x: 1, y: 0 } }));
    expect(w.stats.hitsTaken).toBe(hits);
    expect(w.player.pos).toEqual(pos);
    expect(w.roomRun.deadTicks).toBeGreaterThan(cfg.rooms.deathFrames);
  });

  it('training (immortal) refills instead', () => {
    const w = testWorld(cfg, { only: ['dummy'], dummyAttacks: true });
    w.enemies[0]!.pos = { x: 118, y: 120 };
    w.player.pos = { x: 100, y: 120 };
    w.player.hp = 1;
    run(w, cfg, 300);
    expect(w.player.dead).toBe(false);
  });
});
