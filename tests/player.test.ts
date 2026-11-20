import { describe, expect, it } from 'vitest';
import { isPlayerInvulnerable, moveIntent } from '../src/sim/actors/player';
import { step } from '../src/sim/step';
import { input, run, testConfig, testWorld } from './helpers';

const cfg = testConfig();

describe('movement', () => {
  it('accelerates to top speed in accelFrames and stops in decelFrames (no instant velocity)', () => {
    const w = testWorld(cfg, { withDummy: false });
    const right = () => input({ move: { x: 1, y: 0 } });
    step(w, right(), cfg);
    const v1 = Math.hypot(w.player.vel.x, w.player.vel.y);
    expect(v1).toBeGreaterThan(0);
    expect(v1).toBeLessThan(cfg.player.maxSpeed);
    run(w, cfg, cfg.player.accelFrames - 1, right);
    expect(Math.hypot(w.player.vel.x, w.player.vel.y)).toBeCloseTo(cfg.player.maxSpeed, 5);
    run(w, cfg, cfg.player.decelFrames);
    expect(Math.hypot(w.player.vel.x, w.player.vel.y)).toBe(0);
  });

  it('W is straight up the screen and diagonals are normalised', () => {
    const up = moveIntent({ x: 0, y: -1 }, 1).dir;
    expect(up.x).toBeCloseTo(up.y, 9); // ground (-1,-1)/√2 projects to screen (0,-k)
    expect(up.x).toBeLessThan(0);
    const diag = moveIntent({ x: 1, y: 1 }, 1).dir;
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(1, 9);
  });
});

describe('dash', () => {
  it('travels ~distance over `frames` ticks, ease-out, with i-frames on 2..9', () => {
    const w = testWorld(cfg, { withDummy: false });
    w.player.pos = { x: 60, y: 120 };
    const start = { ...w.player.pos };
    step(w, input({ press: ['dash'], move: { x: 1, y: 0 } }), cfg);
    const steps: number[] = [];
    let last = { ...start };
    const inv: boolean[] = [isPlayerInvulnerable(w.player, cfg)];
    steps.push(Math.hypot(w.player.pos.x - last.x, w.player.pos.y - last.y));
    last = { ...w.player.pos };
    for (let i = 1; i < cfg.player.dash.frames; i++) {
      step(w, input({ move: { x: 1, y: 0 } }), cfg);
      inv.push(isPlayerInvulnerable(w.player, cfg));
      steps.push(Math.hypot(w.player.pos.x - last.x, w.player.pos.y - last.y));
      last = { ...w.player.pos };
    }
    const total = Math.hypot(w.player.pos.x - start.x, w.player.pos.y - start.y);
    expect(total).toBeCloseTo(cfg.player.dash.distance, 0);
    expect(steps[0]!).toBeGreaterThan(steps[steps.length - 1]!); // ease-out
    // Frame N (1-based) is invulnerable iff 2 <= N <= 9.
    expect(inv.map((v, i) => (v ? i + 1 : 0)).filter(Boolean)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(w.player.dash).toBeNull();
  });

  it('cancels out of attack recovery but not out of startup', () => {
    const w = testWorld(cfg, { withDummy: false });
    const aim = { x: 300, y: 150 };
    step(w, input({ press: ['slash'], aim }), cfg);
    step(w, input({ press: ['dash'], aim }), cfg); // startup: buffered, not yet allowed
    expect(w.player.action).not.toBeNull();
    expect(w.player.dash).toBeNull();
    // Buffer is 8 frames; slash1 recovery starts at frame 9 → the buffered dash fires then.
    run(w, cfg, 7, () => input({ aim }));
    expect(w.player.dash).not.toBeNull();
    expect(w.player.action).toBeNull();
  });
});

describe('slash frame data', () => {
  it('hits exactly on the first active frame, once per swing', () => {
    const w = testWorld(cfg);
    const e = w.enemies[0]!;
    w.player.pos = { x: e.pos.x - 18, y: e.pos.y };
    const aim = { x: e.pos.x + 50, y: e.pos.y };
    const hp0 = e.hp;
    const d = cfg.attacks.slash1!;
    step(w, input({ press: ['slash'], aim }), cfg);
    let hitFrame = -1;
    for (let i = 0; i < 40 && hitFrame < 0; i++) {
      if (e.hp < hp0) hitFrame = w.player.action ? w.player.action.frame : -2;
      else step(w, input({ aim }), cfg);
    }
    expect(hitFrame).toBe(d.startup + 1);
    expect(e.hp).toBe(hp0 - d.healthDamage);
    // Hit-stop holds the attack frame still.
    expect(w.hitstop).toBe(d.hitstop);
    const f = w.player.action!.frame;
    run(w, cfg, d.hitstop, () => input({ aim }));
    expect(w.player.action!.frame).toBe(f);
    // Remaining active frames don't double-hit.
    run(w, cfg, 20, () => input({ aim }));
    expect(e.hp).toBe(hp0 - d.healthDamage);
  });

  it('a press buffered during active frames chains into hit 2 at chainAt', () => {
    const w = testWorld(cfg, { withDummy: false });
    const aim = { x: 300, y: 150 };
    const d = cfg.attacks.slash1!;
    step(w, input({ press: ['slash'], aim }), cfg);
    run(w, cfg, d.startup, () => input({ aim })); // now in active
    step(w, input({ press: ['slash'], aim }), cfg);
    let chainedAt = -1;
    for (let i = 0; i < 30; i++) {
      const prev = w.player.action;
      const prevFrame = prev?.frame ?? -1;
      step(w, input({ aim }), cfg);
      if (w.player.action?.step === 2) {
        chainedAt = prevFrame - d.startup - d.active + 1;
        break;
      }
    }
    expect(chainedAt).toBe(d.chainAt);
  });

  it('a press made too early is dropped (buffer expires) — no surprise attacks', () => {
    const w = testWorld(cfg, { withDummy: false });
    const aim = { x: 300, y: 150 };
    step(w, input({ press: ['slash'], aim }), cfg);
    step(w, input({ press: ['slash'], aim }), cfg); // frame 2: far before chain window
    run(w, cfg, 40, () => input({ aim }));
    expect(w.player.lastStep).toBe(1);
  });

  it('three presses in rhythm produce the full 1-2-3 combo', () => {
    const w = testWorld(cfg, { withDummy: false });
    const aim = { x: 300, y: 150 };
    const seen = new Set<number>();
    for (let t = 0; t < 120; t++) {
      const press = t % 12 === 0 && t < 36 ? (['slash'] as const) : [];
      step(w, input({ press: [...press], aim }), cfg);
      if (w.player.action) seen.add(w.player.action.step);
    }
    expect([...seen]).toEqual([1, 2, 3]);
  });
});

describe('dummy fights back', () => {
  it('hurts the player unless they dash through the swing', () => {
    const w = testWorld(cfg, { dummyAttacks: true });
    const e = w.enemies[0]!;
    w.player.pos = { x: e.pos.x - 20, y: e.pos.y };
    run(w, cfg, 120);
    expect(w.stats.hitsTaken).toBeGreaterThan(0);

    const w2 = testWorld(cfg, { dummyAttacks: true });
    const e2 = w2.enemies[0]!;
    w2.player.pos = { x: e2.pos.x - 20, y: e2.pos.y };
    // Dash when the swing goes active.
    for (let t = 0; t < 120; t++) {
      const swingSoon = e2.phase === 'windup' && e2.phaseFrame === cfg.dummy.swing.windup - 2;
      step(w2, swingSoon ? input({ press: ['dash'], move: { x: 0, y: 1 } }) : input(), cfg);
      if (w2.stats.hitsTaken > 0) break;
      if (e2.phase === 'recover') break;
    }
    expect(w2.stats.hitsTaken).toBe(0);
  });
});
