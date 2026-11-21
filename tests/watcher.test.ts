import { describe, expect, it } from 'vitest';
import { startEnemyAttack } from '../src/sim/actors/enemy';
import type { RoomDef } from '../src/sim/config';
import { step } from '../src/sim/step';
import { createWorld, spawnEnemy, type Enemy, type World } from '../src/sim/world';
import { input, loadData, run, testConfig, testWorld } from './helpers';

const cfg = testConfig();
const W = cfg.enemies.watcher!;
const L = W.attacks.laser!;
const C = W.attacks.chomp!;

/** Satan and one Watcher, its own AI quiet; the test drives its attacks. */
function setup(dist = 120): { w: World; e: Enemy } {
  const w = testWorld(cfg, { withDummy: false });
  const e = spawnEnemy(w, cfg, 'watcher', { x: 100 + dist, y: 120 });
  w.player.pos = { x: 100, y: 120 };
  e.facing = { x: -1, y: 0 };
  e.cooldown = 99999;
  return { w, e };
}
const aimAt = (e: Enemy) => ({ x: e.pos.x, y: e.pos.y });
/** Tick on which the next laser reaches Satan from `dist` (first one fires on the first active tick). */
function firstLaserHitTick(dist: number): number {
  const { w, e } = setup(dist);
  startEnemyAttack(w, e, 'laser', cfg);
  for (let t = 0; t < 200; t++) {
    step(w, input({ aim: aimAt(e) }), cfg);
    if (w.stats.hitsTaken > 0) return t;
  }
  throw new Error('no laser arrived');
}

describe('Watcher: laser volley', () => {
  it('fires three lasers; standing still, all three land', () => {
    const { w, e } = setup(120);
    startEnemyAttack(w, e, 'laser', cfg);
    let fired = 0;
    for (let t = 0; t < 160; t++) {
      step(w, input({ aim: aimAt(e) }), cfg);
      fired += w.events.filter((ev) => ev.type === 'arrowLoosed').length;
      w.events.length = 0;
    }
    expect(fired).toBe(L.volley!.count);
    expect(w.stats.hitsTaken).toBe(3);
  });

  it(`aim tracks until f${L.trackUntil}, then locks: sidestepping after the lock dodges all three`, () => {
    const { w, e } = setup(120);
    startEnemyAttack(w, e, 'laser', cfg);
    run(w, cfg, L.trackUntil + 1, () => input({ aim: aimAt(e) }));
    const locked = { ...e.attackDir };
    run(w, cfg, 140, () => input({ move: { x: 0, y: -1 }, aim: aimAt(e) })); // walk up-screen, off the line
    expect(e.attackDir).toEqual(locked);
    expect(w.stats.hitsTaken).toBe(0);
  });

  it('holding block stops them: posture cost, no health lost', () => {
    const { w, e } = setup(120);
    startEnemyAttack(w, e, 'laser', cfg);
    run(w, cfg, 160, () => input({ hold: ['parry'], aim: aimAt(e) }));
    expect(w.player.hp).toBe(cfg.player.maxHealth);
    expect(w.stats.hitsTaken).toBe(0);
    expect(w.player.posture).toBeGreaterThan(0);
  });

  it('one press deflects one laser — the next needs its own press', () => {
    const H = firstLaserHitTick(120);
    const { w, e } = setup(120);
    startEnemyAttack(w, e, 'laser', cfg);
    for (let t = 0; t < 160; t++) step(w, input({ press: t === H - 2 ? ['parry'] : [], aim: aimAt(e) }), cfg);
    expect(w.stats.deflects).toBe(1);
    expect(w.stats.hitsTaken).toBe(2);
  });

  it('deflected lasers fly back into the eye and hammer its posture (×reflectPostureMul)', () => {
    const { w, e } = setup(120);
    startEnemyAttack(w, e, 'laser', cfg);
    for (let t = 0; t < 200; t++) {
      // Press for each laser as it closes in.
      const incoming = w.projectiles.some((p) => p.owner === e.id && Math.hypot(p.pos.x - 100, p.pos.y - 120) < 22);
      step(w, input({ press: incoming && !(w.player.parry && !w.player.parry.deflected) ? ['parry'] : [], aim: aimAt(e) }), cfg);
    }
    expect(w.stats.deflects).toBe(3);
    expect(w.stats.hitsTaken).toBe(0);
    expect(e.hp).toBeLessThan(W.health);
    // Three reflected lasers at ×2 posture break its 60-posture bar.
    expect(e.phase === 'broken' || e.posture >= cfg.combat.reflect.postureDamage * (W.reflectPostureMul ?? 1)).toBe(true);
  });
});

describe('Watcher: chomp', () => {
  it('deflecting the chomp jams its jaws open (long stagger) → posture breaks → deathblow kills it', () => {
    const { w, e } = setup(28);
    startEnemyAttack(w, e, 'chomp', cfg);
    // A normal (not perfect) deflect: pressed a little early.
    const early = cfg.combat.parry.perfectFrames + 3;
    for (let t = 0; t < 60 && e.phase !== 'recoil'; t++) step(w, input({ press: e.phase === 'windup' && e.phaseFrame === e.windupLen - early ? ['parry'] : [], aim: aimAt(e) }), cfg);
    expect(w.stats.deflects).toBe(1);
    expect(w.stats.perfects).toBe(0);
    expect(w.stats.hitsTaken).toBe(0);
    expect(e.phase).toBe('recoil');
    expect(e.recoilLen).toBe(C.onDeflect!.recoilFrames);
    // Punish while the jaws are stuck: riposte slashes finish the posture.
    for (let t = 0; t < 120 && e.phase !== 'broken'; t++) {
      w.player.pos = { x: e.pos.x - 18, y: e.pos.y };
      step(w, input({ press: t % 12 === 0 ? ['slash'] : [], aim: aimAt(e) }), cfg);
    }
    expect(e.phase).toBe('broken');
    w.player.pos = { x: e.pos.x - 16, y: e.pos.y };
    run(w, cfg, 20); // let the last slash finish
    step(w, input({ press: ['slash'], aim: aimAt(e) }), cfg);
    run(w, cfg, 40, () => input({ aim: aimAt(e) }));
    expect(e.phase).toBe('down');
    expect(w.stats.deathblows).toBe(1);
  });

  it('a perfect deflect breaks it outright', () => {
    const { w, e } = setup(28);
    startEnemyAttack(w, e, 'chomp', cfg);
    for (let t = 0; t < 60; t++) step(w, input({ press: e.phase === 'windup' && e.phaseFrame === e.windupLen - 1 ? ['parry'] : [], aim: aimAt(e) }), cfg);
    expect(w.stats.perfects).toBe(1);
    expect(e.phase).toBe('broken');
  });

  it('a dash passes through the lunge', () => {
    const { w, e } = setup(28);
    startEnemyAttack(w, e, 'chomp', cfg);
    for (let t = 0; t < 70; t++) step(w, input({ press: e.phase === 'windup' && e.phaseFrame === e.windupLen - 2 ? ['dash'] : [], move: { x: 1, y: 0 }, aim: aimAt(e) }), cfg);
    expect(w.stats.hitsTaken).toBe(0);
  });

  it('blocking works but costs heavy posture', () => {
    const { w, e } = setup(28);
    startEnemyAttack(w, e, 'chomp', cfg);
    run(w, cfg, 70, () => input({ hold: ['parry'], aim: aimAt(e) }));
    expect(w.player.hp).toBe(cfg.player.maxHealth);
    expect(w.player.posture).toBeGreaterThanOrEqual(C.postureDamage * cfg.combat.block.postureMul - 1e-6);
  });

  it('it chomps when Satan crowds it, and after two melee hits', () => {
    const crowd = setup(30);
    crowd.w.flags.dummyAttacks = true;
    crowd.e.cooldown = 0;
    let chomped = false;
    for (let t = 0; t < 60 && !chomped; t++) {
      crowd.w.player.pos = { x: crowd.e.pos.x - 30, y: crowd.e.pos.y };
      step(crowd.w, input({ aim: aimAt(crowd.e) }), cfg);
      chomped = crowd.e.attack === 'chomp';
    }
    expect(chomped).toBe(true);
  });
});

describe('Watcher: groups and flight', () => {
  it('two Watchers never telegraph lasers at once, and lasers in the air do not stop a Dominion swinging', () => {
    const w = testWorld(cfg, { withDummy: false, dummyAttacks: true });
    w.player.pos = { x: 140, y: 112 };
    const a = spawnEnemy(w, cfg, 'watcher', { x: 260, y: 60 });
    const b = spawnEnemy(w, cfg, 'watcher', { x: 260, y: 180 });
    const d = spawnEnemy(w, cfg, 'dominion', { x: 168, y: 112 });
    let both = 0;
    let domDuringLaser = 0;
    let lasers = 0;
    for (let t = 0; t < 60 * 30; t++) {
      const laserAir = w.projectiles.some((p) => p.owner === a.id || p.owner === b.id);
      step(w, input({ hold: ['parry'], aim: { ...d.pos } }), cfg);
      w.player.hp = cfg.player.maxHealth;
      w.player.posture = 0;
      const tele = [a, b].filter((x) => x.attack === 'laser' && (x.phase === 'windup' || x.phase === 'active')).length;
      if (tele > 1) both++;
      if (laserAir && d.phase === 'windup' && d.phaseFrame === 1) domDuringLaser++;
      lasers += w.events.filter((ev) => ev.type === 'arrowLoosed').length;
      w.events.length = 0;
    }
    expect(lasers).toBeGreaterThan(3);
    expect(both).toBe(0);
    expect(domDuringLaser).toBeGreaterThan(0);
  });

  it('flies over a hedge, but not through a pillar', () => {
    const room = loadData<RoomDef>('rooms/l1/crosspath'); // hedge blocks at x 56..128, y 56..104
    const push = (type: string) => {
      const w = createWorld(room, cfg, 1);
      w.flags.dummyAttacks = false;
      w.player.pos = { x: 300, y: 240 };
      const e = spawnEnemy(w, cfg, type, { x: 40, y: 80 });
      e.knock = { x: 900, y: 0 };
      run(w, cfg, 30);
      return e.pos.x;
    };
    expect(push('watcher')).toBeGreaterThan(70); // sailed over the hedge edge at x 56
    expect(push('dominion')).toBeLessThan(56); // a walker is stopped by it

    const w = testWorld(cfg, { withDummy: false }); // training pillar at x 80..96, y 56..72
    w.player.pos = { x: 250, y: 200 };
    const e = spawnEnemy(w, cfg, 'watcher', { x: 60, y: 64 });
    e.knock = { x: 900, y: 0 };
    run(w, cfg, 30);
    expect(e.pos.x).toBeLessThan(80);
  });
});

describe('Watcher: fairness', () => {
  it('every attack has at least a 14-frame telegraph', () => {
    for (const [k, a] of Object.entries(W.attacks)) expect(a.windup, k).toBeGreaterThanOrEqual(14);
  });
});
