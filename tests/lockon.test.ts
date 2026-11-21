import { describe, expect, it } from 'vitest';
import type { ButtonAction } from '../src/input/actions';
import { step } from '../src/sim/step';
import type { World } from '../src/sim/world';
import { input, run, testConfig, testWorld } from './helpers';

const cfg = testConfig();
const L = cfg.combat.lockOn;

/** Player at (100,100); dummy 20px east (nearest), Dominion 50px south. */
function arena(attacks = false): World {
  const w = testWorld(cfg, { only: ['dummy', 'dominion'], dummyAttacks: attacks });
  w.player.pos = { x: 100, y: 100 };
  w.enemies.find((e) => e.type === 'dummy')!.pos = { x: 120, y: 100 };
  w.enemies.find((e) => e.type === 'dominion')!.pos = { x: 100, y: 150 };
  for (const e of w.enemies) e.cooldown = 9999;
  return w;
}
const id = (w: World, type: string) => w.enemies.find((e) => e.type === type)!.id;
const tap = (w: World, extra: ButtonAction[] = []) => {
  step(w, input({ press: ['lock', ...extra], hold: ['lock'] }), cfg);
  step(w, input(), cfg); // released next tick
};

describe('lock-on (Q)', () => {
  it('Q locks the nearest enemy', () => {
    const w = arena();
    step(w, input({ press: ['lock'] }), cfg);
    expect(w.player.lockId).toBe(id(w, 'dummy'));
  });

  it('tapping Q again cycles to the next enemy, then wraps', () => {
    const w = arena();
    step(w, input({ press: ['lock'] }), cfg);
    tap(w);
    expect(w.player.lockId).toBe(id(w, 'dominion'));
    tap(w);
    expect(w.player.lockId).toBe(id(w, 'dummy'));
  });

  it('holding Q releases the lock', () => {
    const w = arena();
    step(w, input({ press: ['lock'] }), cfg);
    step(w, input({ press: ['lock'], hold: ['lock'] }), cfg);
    run(w, cfg, L.holdToReleaseFrames, () => input({ hold: ['lock'] }));
    expect(w.player.lockId).toBeNull();
    step(w, input(), cfg); // releasing after the hold must not re-cycle
    expect(w.player.lockId).toBeNull();
  });

  it('when the target dies the lock jumps to the next nearest enemy', () => {
    const w = arena();
    step(w, input({ press: ['lock'] }), cfg);
    const dummy = w.enemies.find((e) => e.type === 'dummy')!;
    dummy.phase = 'down';
    step(w, input(), cfg);
    expect(w.player.lockId).toBe(id(w, 'dominion'));
  });

  it('full focus: slashes go at the target even if the cursor points elsewhere', () => {
    const w = arena();
    step(w, input({ press: ['lock'] }), cfg);
    tap(w); // lock the Dominion (south, +y)
    step(w, input({ press: ['slash'], aim: { x: 0, y: 100 } }), cfg); // cursor far west
    expect(w.player.action!.dir.y).toBeGreaterThan(0.99);
  });

  it('the lock breaks if the target gets too far away', () => {
    const w = arena();
    step(w, input({ press: ['lock'] }), cfg);
    for (const e of w.enemies) e.pos = { x: e.pos.x + L.breakRange * 2, y: e.pos.y };
    step(w, input(), cfg);
    expect(w.player.lockId).toBeNull();
  });
});

describe('group fights: focus attacks, others hold back', () => {
  it('the focus is the lock target, or the nearest enemy when unlocked', () => {
    const w = arena();
    step(w, input(), cfg);
    expect(w.focusId).toBe(id(w, 'dummy'));
    step(w, input({ press: ['lock'] }), cfg);
    tap(w);
    expect(w.focusId).toBe(id(w, 'dominion'));
  });

  it('two enemies never have attacks in flight at the same time, and the focus attacks most', () => {
    const w = arena(true);
    for (const e of w.enemies) e.cooldown = 0;
    let focusStarts = 0;
    let supportStarts = 0;
    let overlap = 0;
    for (let t = 0; t < 60 * 40; t++) {
      // A defensive player: hold block toward threats so nobody dies and the test runs long.
      const before = new Map(w.enemies.map((e) => [e.id, e.phase]));
      const focusBefore = w.focusId;
      step(w, input({ hold: ['parry'] }), cfg);
      w.player.posture = 0;
      w.player.hp = cfg.player.maxHealth;
      for (const e of w.enemies) {
        if (e.phase === 'windup' && before.get(e.id) !== 'windup') {
          if (e.id === focusBefore) focusStarts++;
          else supportStarts++;
        }
      }
      const busy = w.enemies.filter((e) => e.phase === 'windup' || e.phase === 'active').length;
      if (busy > 1) overlap++;
    }
    expect(overlap).toBe(0);
    expect(focusStarts).toBeGreaterThan(supportStarts * 2);
    expect(supportStarts).toBeGreaterThan(0); // supporters still get a turn sometimes
  });

  it('with lock-on, the locked enemy keeps the focus even when another one is nearer', () => {
    const w = arena(true);
    step(w, input({ press: ['lock'] }), cfg);
    tap(w); // lock the farther Dominion
    run(w, cfg, 300, () => input({ hold: ['parry'] }));
    expect(w.focusId).toBe(id(w, 'dominion'));
  });

  it('non-focus enemies hang back at a distance', () => {
    const w = arena(true);
    const dom = w.enemies.find((e) => e.type === 'dominion')!;
    dom.pos = { x: 100, y: 125 }; // close, but the dummy (20px) is nearer, so it's the focus
    run(w, cfg, 120, () => input({ hold: ['parry'] }));
    const d = Math.hypot(dom.pos.x - w.player.pos.x, dom.pos.y - w.player.pos.y);
    expect(d).toBeGreaterThan(cfg.combat.groups.holdBackDistance - 15);
  });
});

describe('training spawns', () => {
  it('fuzz: spawns always land inside the arena and clear of walls, whatever Satan or the cursor is doing', async () => {
    const { createWorld, spawnEnemyAt, isValidSpot } = await import('../src/sim/world');
    const { trainingRoom } = await import('./helpers');
    const { createRng, nextRange } = await import('../src/core/rng');
    const rng = createRng(99);
    for (let i = 0; i < 600; i++) {
      const w = createWorld(trainingRoom(), cfg, i);
      w.player.pos = { x: nextRange(rng, 7, 281), y: nextRange(rng, 7, 217) };
      const a = nextRange(rng, 0, Math.PI * 2);
      w.player.facing = { x: Math.cos(a), y: Math.sin(a) };
      const type = ['dummy', 'dominion', 'archer'][i % 3]!;
      // Cursor anywhere, including far off the platform (the sky).
      const target = { x: nextRange(rng, -300, 600), y: nextRange(rng, -300, 600) };
      const e = spawnEnemyAt(w, cfg, type, target);
      expect(isValidSpot(w, e.pos.x, e.pos.y, e.radius), `case ${i}: ${type} at ${e.pos.x.toFixed(1)},${e.pos.y.toFixed(1)}`).toBe(true);
    }
  });

  it('fuzz: in long chaotic fights no enemy (or Satan) ever leaves the arena', async () => {
    const { createWorld, spawnEnemyAt } = await import('../src/sim/world');
    const { pointInPolygon } = await import('../src/sim/physics/collide');
    const { trainingRoom } = await import('./helpers');
    const { createRng, nextRange, nextFloat } = await import('../src/core/rng');
    for (const seed of [1, 2, 3]) {
      const w = createWorld(trainingRoom(), cfg, seed);
      w.flags.respawn = true;
      w.flags.dummyAttacks = true;
      for (const t of ['dominion', 'archer', 'dummy']) spawnEnemyAt(w, cfg, t, { x: 140, y: 110 });
      const rng = createRng(seed * 7);
      for (let t = 0; t < 60 * 60; t++) {
        const r = nextFloat(rng);
        const press = (r < 0.06 ? ['slash'] : r < 0.09 ? ['dash'] : r < 0.12 ? ['parry'] : r < 0.13 ? ['throw'] : []) as ('slash' | 'dash' | 'parry' | 'throw')[];
        const tgt = w.enemies[Math.floor(nextFloat(rng) * w.enemies.length)];
        step(w, input({ press, move: { x: Math.sign(nextRange(rng, -1, 1)), y: Math.sign(nextRange(rng, -1, 1)) }, aim: tgt ? tgt.pos : undefined }), cfg);
        w.player.hp = cfg.player.maxHealth;
        for (const b of [w.player, ...w.enemies.filter((e) => e.phase !== 'down')]) {
          expect(pointInPolygon(b.pos.x, b.pos.y, w.room.bounds)).toBe(true);
          for (const wall of w.room.walls) expect(pointInPolygon(b.pos.x, b.pos.y, wall)).toBe(false);
        }
      }
    }
  }, 20_000); // 3 × 60 s of simulated chaos: slow under a parallel run

  it('the training room starts empty', async () => {
    const { createWorld } = await import('../src/sim/world');
    const { trainingRoom } = await import('./helpers');
    expect(createWorld(trainingRoom(), cfg, 1).enemies.length).toBe(0);
  });

  it('spawnEnemyAt places the enemy at the point, or in front of Satan if the point is invalid', async () => {
    const { createWorld, spawnEnemyAt } = await import('../src/sim/world');
    const { pointInPolygon } = await import('../src/sim/physics/collide');
    const { trainingRoom } = await import('./helpers');
    const w = createWorld(trainingRoom(), cfg, 1);
    const a = spawnEnemyAt(w, cfg, 'dominion', { x: 150, y: 120 });
    expect(a.pos).toEqual({ x: 150, y: 120 });
    const b = spawnEnemyAt(w, cfg, 'archer', { x: -500, y: -500 }); // outside the room
    expect(pointInPolygon(b.pos.x, b.pos.y, w.room.bounds)).toBe(true);
    const c = spawnEnemyAt(w, cfg, 'dummy', { x: 88, y: 64 }); // inside a pillar
    for (const wall of w.room.walls) expect(pointInPolygon(c.pos.x, c.pos.y, wall)).toBe(false);
  });
});
