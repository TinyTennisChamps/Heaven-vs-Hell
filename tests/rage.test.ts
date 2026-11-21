import { describe, expect, it } from 'vitest';
import { startEnemyAttack } from '../src/sim/actors/enemy';
import type { LevelDef, RoomDef, VialStat } from '../src/sim/config';
import { gainRage, killEnemy } from '../src/sim/combat/damage';
import { findSpot } from '../src/sim/rooms/roomRunner';
import { carryThroughGate, rageCarryOver, roomPickups, startRun } from '../src/sim/rooms/run';
import { maxPosture, modsFromVials } from '../src/sim/stats';
import { step } from '../src/sim/step';
import { createWorld, type World } from '../src/sim/world';
import { input, loadData, run, testConfig, testWorld } from './helpers';

const cfg = testConfig();
const R = cfg.rage;
const level = loadData<LevelDef>('levels/l1');
const rooms: Record<string, RoomDef> = {};
for (const id of [...level.pool, level.rest]) rooms[id] = loadData<RoomDef>(`rooms/${id}`);

/** Satan at full Rage facing a dummy, with the transform done. */
function enraged(only = ['dummy']): World {
  const w = testWorld(cfg, { only });
  w.player.pos = { x: 100, y: 120 };
  for (const e of w.enemies) {
    e.pos = { x: 120, y: 120 };
    e.cooldown = 9999;
  }
  w.player.rage = R.max;
  step(w, input({ press: ['rage'] }), cfg);
  for (let t = 0; t < 120 && w.player.rageForm === 0; t++) step(w, input(), cfg); // transform (+ its hit-stop)
  while (w.hitstop > 0) step(w, input(), cfg);
  expect(w.player.rageForm).toBeGreaterThan(0);
  return w;
}

describe('Rage meter', () => {
  it('fills from kills, deathblows, perfect parries and hits taken', () => {
    const w = testWorld(cfg, { only: ['dummy'] });
    const e = w.enemies[0]!;
    killEnemy(w, e, cfg);
    expect(w.player.rage).toBe(R.gain.kill);
    gainRage(w, R.gain.deathblow, cfg);
    expect(w.player.rage).toBe(R.gain.kill + R.gain.deathblow);
  });

  it('a perfect parry and a hit taken both add Rage', () => {
    const w = testWorld(cfg, { only: ['dummy'] });
    const e = w.enemies[0]!;
    w.player.pos = { x: 100, y: 120 };
    e.pos = { x: 122, y: 120 };
    e.facing = { x: -1, y: 0 };
    const wind = cfg.enemies.dummy!.attacks.swing!.windup;
    startEnemyAttack(w, e, 'swing', cfg);
    for (let t = 0; t < 40; t++) step(w, input({ press: t === wind - 1 ? ['parry'] : [], aim: { ...e.pos } }), cfg);
    expect(w.stats.perfects).toBe(1);
    expect(w.player.rage).toBe(R.gain.perfectParry);
    e.cooldown = 9999;
    startEnemyAttack(w, e, 'swing', cfg);
    run(w, cfg, 40, () => input({ aim: { ...e.pos } }));
    expect(w.stats.hitsTaken).toBe(1);
    expect(w.player.rage).toBe(R.gain.perfectParry + R.gain.hitTaken);
  });

  it('is capped, and the Vial of Wrath scales gains', () => {
    const w = testWorld(cfg, { withDummy: false });
    gainRage(w, 1000, cfg);
    expect(w.player.rage).toBe(R.max);
    const v = createWorld(rooms['l1/cloister']!, cfg, 1, { hp: 100, pips: 5, vials: ['l1_locked'] });
    gainRage(v, 20, cfg);
    expect(v.player.rage).toBeCloseTo(20 * 1.05, 5);
  });
});

describe('Rage form', () => {
  it('R does nothing until the meter is full', () => {
    const w = testWorld(cfg, { withDummy: false });
    w.player.rage = R.max - 1;
    step(w, input({ press: ['rage'] }), cfg);
    run(w, cfg, R.transformFrames + 2);
    expect(w.player.rageForm).toBe(0);
    expect(w.player.rageTransform).toBe(0);
  });

  it('transform is invulnerable, then the form lasts durationFrames and empties the meter', () => {
    const w = testWorld(cfg, { only: ['dummy'] });
    const e = w.enemies[0]!;
    w.player.pos = { x: 100, y: 120 };
    e.pos = { x: 122, y: 120 };
    e.facing = { x: -1, y: 0 };
    w.player.rage = R.max;
    startEnemyAttack(w, e, 'swing', cfg);
    e.phaseFrame = cfg.enemies.dummy!.attacks.swing!.windup - 2; // about to land
    step(w, input({ press: ['rage'] }), cfg);
    run(w, cfg, 8);
    expect(w.stats.hitsTaken).toBe(0); // evaded during the transform
    run(w, cfg, R.transformFrames);
    expect(w.player.rageForm).toBeGreaterThan(R.durationFrames - 20);
    e.cooldown = 99999;
    run(w, cfg, R.durationFrames + 5);
    expect(w.player.rageForm).toBe(0);
    expect(w.player.rage).toBe(0);
  });

  it('slash becomes the claw combo; throw is disabled', () => {
    const w = enraged();
    step(w, input({ press: ['slash'], aim: { x: 130, y: 120 } }), cfg);
    expect(w.player.action?.key).toBe('claw1');
    run(w, cfg, 30);
    const pips = w.player.pips;
    step(w, input({ press: ['throw'], aim: { x: 130, y: 120 } }), cfg);
    run(w, cfg, 10);
    expect(w.player.pips).toBe(pips);
    expect(w.projectiles.length).toBe(0);
  });

  it('hyper armour: half damage, no stagger, the claw keeps going, no posture', () => {
    const w = enraged();
    const e = w.enemies[0]!;
    const hp = w.player.hp;
    step(w, input({ press: ['slash'], aim: { ...e.pos } }), cfg);
    // Force the dummy's swing to land mid-claw.
    startEnemyAttack(w, e, 'swing', cfg);
    e.phaseFrame = cfg.enemies.dummy!.attacks.swing!.windup - 1;
    step(w, input({ aim: { ...e.pos } }), cfg);
    run(w, cfg, 3, () => input({ aim: { ...e.pos } }));
    expect(w.stats.hitsTaken).toBe(1);
    expect(w.player.hp).toBe(hp - Math.round(cfg.enemies.dummy!.attacks.swing!.healthDamage * R.damageTakenMul));
    expect(w.player.hurtStun).toBe(0);
    expect(w.player.posture).toBe(0);
    expect(w.player.action?.key).toBe('claw1');
  });

  it('each kill in Rage extends it and heals', () => {
    const w = enraged();
    w.player.hp = 50;
    const before = w.player.rageForm;
    killEnemy(w, w.enemies[0]!, cfg);
    expect(w.player.rageForm).toBe(before + R.killExtendFrames);
    expect(w.player.hp).toBe(50 + Math.round(cfg.player.maxHealth * 0.1)); // 10% for an ordinary enemy (the dummy)
  });

  it('Rage kill heals scale with the enemy: cherub 3%, Principality 15%, bosses 20% (capped at max)', () => {
    const max = cfg.player.maxHealth;
    for (const [type, pct] of [['cherub', 0.03], ['dominion', 0.1], ['archer', 0.1], ['watcher', 0.1], ['zealot', 0.15], ['gabriel', 0.2], ['raphael', 0.2]] as const) {
      const w = enraged([type]);
      w.player.hp = 40;
      const e = w.enemies[0]!;
      e.segments = 1;
      killEnemy(w, e, cfg);
      expect(w.player.hp, type).toBe(40 + Math.round(max * pct));
    }
    const w = enraged(['raphael']);
    w.player.hp = max - 5;
    w.enemies[0]!.segments = 1;
    killEnemy(w, w.enemies[0]!, cfg);
    expect(w.player.hp).toBe(max);
  });

  it('a boss losing a health segment in Rage also heals its share', () => {
    const w = enraged(['gabriel']);
    const e = w.enemies[0]!;
    expect(e.segments).toBeGreaterThan(1);
    w.player.hp = 40;
    killEnemy(w, e, cfg);
    expect(e.phase).toBe('rally');
    expect(w.player.hp).toBe(40 + Math.round(cfg.player.maxHealth * 0.2));
  });

  it('outside Rage, kills heal nothing', () => {
    const w = testWorld(cfg, { only: ['dummy'] });
    w.player.hp = 40;
    killEnemy(w, w.enemies[0]!, cfg);
    expect(w.player.hp).toBe(40);
  });
});

describe('Rage carry-over', () => {
  it(`never lets a run start able to transform (cap ${R.carryOver.max} < ${R.max})`, () => {
    expect(R.carryOver.max).toBeLessThan(R.max);
    for (const meter of [0, 30, 100]) for (const falls of [1, 3, 20]) expect(rageCarryOver(meter, falls, cfg)).toBeLessThanOrEqual(R.carryOver.max);
    expect(rageCarryOver(40, 2, cfg)).toBe(Math.round(R.carryOver.meterMul * 40 + R.carryOver.perDeath * 2));
  });

  it('the meter and vials go through gates; a Rage form in progress is spent', () => {
    const w = createWorld(rooms['l1/cloister']!, cfg, 1, { hp: 100, pips: 5, rage: 37, vials: ['l1_hidden'] });
    expect(carryThroughGate(w, cfg)).toMatchObject({ rage: 37, vials: ['l1_hidden'] });
    w.player.rageForm = 100;
    expect(carryThroughGate(w, cfg).rage).toBe(0);
  });
});

describe('Rage Vials', () => {
  const V = cfg.vials;

  it(`budget: one vial per stat, and no stat above +${V.maxPerStat * 100}%`, () => {
    const stats = V.vials.map((v) => v.stat);
    expect(new Set(stats).size).toBe(stats.length); // no stacking the same stat
    const base: Record<VialStat, number> = {
      maxPosture: 1, rageGain: 1, slashPosture: 1, maxHealth: 1, postureRegen: 1,
      deflectFrames: cfg.combat.parry.windowFrames,
      pips: cfg.player.throw.maxPips,
    };
    const all = modsFromVials(V.vials.map((v) => v.id), cfg);
    for (const k of Object.keys(all) as VialStat[]) expect(all[k] / base[k], k).toBeLessThanOrEqual(V.maxPerStat + 1e-9);
    expect(V.vials.filter((v) => v.level === 'l1').length).toBe(3);
    expect(V.vials.filter((v) => v.level === 'l2').length).toBe(4);
  });

  it('a vial changes the stat it names (Vial of the Unbowed: +5% max posture)', () => {
    const w = createWorld(rooms['l1/cloister']!, cfg, 1, { hp: 100, pips: 5, vials: ['l1_hidden'] });
    expect(maxPosture(w, cfg)).toBeCloseTo(cfg.player.posture.max * 1.05, 5);
  });

  it('every run hides the hidden vial in one combat room with a crack; hard rooms cage the locked one', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const r = startRun(level, rooms, seed, { hp: 100, pips: 5 });
      expect(level.pool).toContain(r.hiddenRoom);
      for (const id of level.pool) {
        const ps = roomPickups(r, rooms[id]!, cfg);
        expect(ps.some((q) => q.kind === 'crack')).toBe(id === r.hiddenRoom);
        expect(ps.some((q) => q.kind === 'cage')).toBe(rooms[id]!.tier === 'hard');
      }
      expect(roomPickups(r, rooms[level.rest]!, cfg)).toEqual([]);
      // Once collected, it's gone for the rest of the run.
      r.carry.vials = ['l1_locked', 'l1_hidden'];
      for (const id of level.pool) expect(roomPickups(r, rooms[id]!, cfg)).toEqual([]);
    }
  });

  function pickupWorld(kind: 'crack' | 'cage'): World {
    const id = kind === 'crack' ? 'l1/cloister' : 'l1/terrace';
    const r = startRun(level, rooms, 1, { hp: 100, pips: 5 });
    r.hiddenRoom = 'l1/cloister';
    const w = createWorld(rooms[id]!, cfg, 1, r.carry, roomPickups(r, rooms[id]!, cfg));
    w.flags.dummyAttacks = false;
    return w;
  }

  it(`a cracked rim breaks after ${cfg.rooms.crackHits} slashes and its vial can be picked up`, () => {
    const w = pickupWorld('crack');
    const q = w.pickups[0]!;
    w.player.pos = findSpot(w, q.at.x + 14, q.at.y, cfg.player.radius)!;
    for (let i = 0; i < cfg.rooms.crackHits; i++) {
      expect(q.open).toBe(false);
      step(w, input({ press: ['slash'], aim: { ...q.at } }), cfg);
      run(w, cfg, 30, () => input({ aim: { ...q.at } }));
    }
    expect(q.open).toBe(true);
    w.player.pos = { ...findSpot(w, q.vialAt.x, q.vialAt.y, cfg.player.radius)! };
    run(w, cfg, 2);
    expect(q.taken).toBe(true);
    expect(w.vials).toEqual(['l1_hidden']);
    expect(maxPosture(w, cfg)).toBeCloseTo(cfg.player.posture.max * 1.05, 5);
  });

  it('a cage stays shut until the room is cleared', () => {
    const w = pickupWorld('cage');
    const q = w.pickups[0]!;
    w.player.pos = { ...findSpot(w, q.vialAt.x, q.vialAt.y, cfg.player.radius)! };
    run(w, cfg, cfg.rooms.firstWaveDelayFrames + 5);
    expect(q.open).toBe(false);
    expect(q.taken).toBe(false);
    for (let guard = 0; guard < 20 && !w.roomRun.cleared; guard++) {
      for (const e of w.enemies) if (e.phase !== 'down') killEnemy(w, e, cfg);
      w.player.pos = { ...findSpot(w, q.vialAt.x, q.vialAt.y, cfg.player.radius)! };
      run(w, cfg, cfg.rooms.waveDelayFrames + 5);
    }
    expect(q.open).toBe(true);
    expect(q.taken).toBe(true);
    expect(w.vials).toEqual(['l1_locked']);
  });
});

describe('blocking and parrying in Rage', () => {
  it('holding RMB in Rage blocks a hit from the front: no damage, normal posture cost', () => {
    const w = enraged();
    const e = w.enemies[0]!;
    e.facing = { x: -1, y: 0 };
    const hp = w.player.hp;
    run(w, cfg, 20, () => input({ hold: ['parry'], aim: { ...e.pos } })); // past the deflect window: now just blocking
    w.player.posture = 0;
    startEnemyAttack(w, e, 'swing', cfg);
    run(w, cfg, 60, () => input({ hold: ['parry'], aim: { ...e.pos } }));
    expect(w.player.hp).toBe(hp);
    expect(w.stats.hitsTaken).toBe(0);
    expect(w.player.posture).toBeGreaterThan(0);
  });

  it('without the block, Rage hyper armour still applies', () => {
    const w = enraged();
    const e = w.enemies[0]!;
    e.facing = { x: -1, y: 0 };
    const hp = w.player.hp;
    startEnemyAttack(w, e, 'swing', cfg);
    run(w, cfg, 60, () => input({ aim: { ...e.pos } }));
    expect(w.player.hp).toBe(hp - Math.round(cfg.enemies.dummy!.attacks.swing!.healthDamage * R.damageTakenMul));
  });

  it('a perfect parry works in Rage: no damage, the attacker recoils', () => {
    const w = enraged();
    const e = w.enemies[0]!;
    e.facing = { x: -1, y: 0 };
    const hp = w.player.hp;
    const wind = cfg.enemies.dummy!.attacks.swing!.windup;
    startEnemyAttack(w, e, 'swing', cfg);
    let recoiled = false;
    for (let t = 0; t < 40; t++) {
      step(w, input({ press: t === wind - 1 ? ['parry'] : [], aim: { ...e.pos } }), cfg);
      if (e.phase === 'recoil') recoiled = true;
    }
    expect(w.stats.deflects).toBe(1);
    expect(w.stats.perfects).toBe(1);
    expect(recoiled).toBe(true);
    expect(w.player.hp).toBe(hp);
    expect(w.stats.hitsTaken).toBe(0);
  });

  it('a late (non-perfect) deflect also works in Rage', () => {
    const w = enraged();
    const e = w.enemies[0]!;
    e.facing = { x: -1, y: 0 };
    const hp = w.player.hp;
    const wind = cfg.enemies.dummy!.attacks.swing!.windup;
    startEnemyAttack(w, e, 'swing', cfg);
    const pressAt = wind - cfg.combat.parry.perfectFrames - 2;
    for (let t = 0; t < 40; t++) step(w, input({ press: t === pressAt ? ['parry'] : [], aim: { ...e.pos } }), cfg);
    expect(w.stats.deflects).toBe(1);
    expect(w.stats.perfects).toBe(0);
    expect(w.player.hp).toBe(hp);
  });

  it('an arrow tapped in Rage is deflected back at the archer', () => {
    const shoot = (pressAt: number) => {
      const w = enraged(['archer']);
      const e = w.enemies[0]!;
      e.pos = { x: 190, y: 120 };
      e.facing = { x: -1, y: 0 };
      const hp = w.player.hp;
      startEnemyAttack(w, e, 'shot', cfg);
      let hitAt = -1;
      for (let t = 0; t < 160; t++) {
        step(w, input({ press: t === pressAt ? ['parry'] : [], aim: { ...e.pos } }), cfg);
        if (hitAt < 0 && w.player.hp < hp) hitAt = t;
      }
      return { w, e, hitAt };
    };
    const dry = shoot(-1);
    expect(dry.hitAt).toBeGreaterThan(0); // hyper armour took it
    const { w, e } = shoot(dry.hitAt - 1);
    expect(w.stats.deflects).toBe(1);
    expect(e.hp).toBeLessThan(cfg.enemies.archer!.health);
  });

  it('a Judgement attack still goes through a Rage parry (hyper armour takes it)', () => {
    // The Principality's Sweep: a true unblockable (the Dominion's charge is deflectable by design).
    const w = enraged(['zealot']);
    const e = w.enemies[0]!;
    e.facing = { x: -1, y: 0 };
    const hp = w.player.hp;
    const wind = cfg.enemies.zealot!.attacks.sweep!.windup;
    startEnemyAttack(w, e, 'sweep', cfg);
    for (let t = 0; t < 60; t++) step(w, input({ press: t === wind - 1 ? ['parry'] : [], aim: { ...e.pos } }), cfg);
    expect(w.stats.deflects).toBe(0);
    expect(w.player.hp).toBeLessThan(hp);
    expect(w.player.hurtStun).toBe(0);
  });
});
