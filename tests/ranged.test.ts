import { describe, expect, it } from 'vitest';
import { startEnemyAttack } from '../src/sim/actors/enemy';
import { step } from '../src/sim/step';
import type { Enemy, World } from '../src/sim/world';
import { input, run, testConfig, testWorld } from './helpers';

const cfg = testConfig();
const T = cfg.player.throw;

function setup(type: string, dist = 60): { w: World; e: Enemy } {
  const w = testWorld(cfg, { only: [type] });
  const e = w.enemies[0]!;
  w.player.pos = { x: 100, y: 120 };
  e.pos = { x: 100 + dist, y: 120 };
  e.facing = { x: -1, y: 0 };
  e.cooldown = 9999;
  return { w, e };
}
const at = (e: Enemy) => ({ x: e.pos.x, y: e.pos.y });

describe('throw (E) and pips', () => {
  it('a throw costs one pip and its bolt hits an enemy at range', () => {
    const { w, e } = setup('dummy', 80);
    step(w, input({ press: ['throw'], aim: at(e) }), cfg);
    expect(w.player.pips).toBe(T.maxPips - 1);
    run(w, cfg, 40, () => input({ aim: at(e) }));
    expect(e.hp).toBe(cfg.enemies.dummy!.health - cfg.attacks.throw!.healthDamage);
    expect(w.projectiles.length).toBe(0);
  });

  it('with no pips, E does nothing', () => {
    const { w, e } = setup('dummy', 80);
    w.player.pips = 0;
    step(w, input({ press: ['throw'], aim: at(e) }), cfg);
    run(w, cfg, 40, () => input({ aim: at(e) }));
    expect(w.player.action).toBeNull();
    expect(e.hp).toBe(cfg.enemies.dummy!.health);
  });

  it(`every ${T.hitsPerPip} melee hits refill a pip, capped at ${T.maxPips}`, () => {
    const { w, e } = setup('dummy', 18);
    w.player.pips = 2;
    for (let n = 0; n < T.hitsPerPip; n++) {
      step(w, input({ press: ['slash'], aim: at(e) }), cfg);
      run(w, cfg, 30, () => input({ aim: at(e) }));
    }
    expect(w.player.pips).toBe(3);
    w.player.pips = T.maxPips;
    for (let n = 0; n < T.hitsPerPip; n++) {
      step(w, input({ press: ['slash'], aim: at(e) }), cfg);
      run(w, cfg, 30, () => input({ aim: at(e) }));
    }
    expect(w.player.pips).toBe(T.maxPips);
  });

  it('a perfect parry refills a pip', () => {
    const { w, e } = setup('dummy', 22);
    w.player.pips = 1;
    startEnemyAttack(w, e, 'swing', cfg);
    const windup = cfg.enemies.dummy!.attacks.swing!.windup;
    for (let t = 0; t < 60; t++) step(w, input({ press: t === windup - 1 ? ['parry'] : [], aim: at(e) }), cfg);
    expect(w.stats.perfects).toBe(1);
    expect(w.player.pips).toBe(1 + T.perfectParryPips);
  });

  it("the Dominion's shield stops a bolt from the front but not from behind", () => {
    const front = setup('dominion', 80);
    step(front.w, input({ press: ['throw'], aim: at(front.e) }), cfg);
    run(front.w, cfg, 40, () => input({ aim: at(front.e) }));
    expect(front.e.hp).toBe(cfg.enemies.dominion!.health);
    expect(front.e.blockedHits).toBe(1);

    const back = setup('dominion', 80);
    back.e.facing = { x: 1, y: 0 };
    cfg.enemies.dominion!.flankTurnRateDeg = 0; // hold it facing away while the bolt flies
    cfg.enemies.dominion!.turnRateDeg = 0;
    step(back.w, input({ press: ['throw'], aim: at(back.e) }), cfg);
    run(back.w, cfg, 40, () => input({ aim: at(back.e) }));
    expect(back.e.hp).toBe(cfg.enemies.dominion!.health - cfg.attacks.throw!.healthDamage);
    Object.assign(cfg.enemies.dominion!, testConfig().enemies.dominion!); // restore for later tests
  });

  it('bolts deal bonus posture damage to archers', () => {
    const { w, e } = setup('archer', 80);
    step(w, input({ press: ['throw'], aim: at(e) }), cfg);
    run(w, cfg, 40, () => input({ aim: at(e) }));
    expect(e.posture).toBeCloseTo(cfg.attacks.throw!.postureDamage * (cfg.enemies.archer!.throwPostureMul ?? 1), 5);
  });

  it('bolts are stopped by pillars', () => {
    const w = testWorld(cfg, { only: ['dummy'] });
    const e = w.enemies[0]!;
    e.cooldown = 9999;
    w.player.pos = { x: 60, y: 64 }; // pillar at x 80..96, y 56..72
    e.pos = { x: 130, y: 64 };
    step(w, input({ press: ['throw'], aim: at(e) }), cfg);
    run(w, cfg, 40, () => input({ aim: at(e) }));
    expect(e.hp).toBe(cfg.enemies.dummy!.health);
  });
});

describe('Choir Archer arrows', () => {
  /** Tick on which the arrow reaches Satan if nothing is done. */
  function arrowHitTick(dist: number): number {
    const { w, e } = setup('archer', dist);
    startEnemyAttack(w, e, 'shot', cfg);
    for (let t = 0; t < 120; t++) {
      step(w, input({ aim: at(e) }), cfg);
      if (w.stats.hitsTaken > 0) return t;
    }
    throw new Error('arrow never arrived');
  }

  it('an arrow travels and hits Satan when unguarded', () => {
    const H = arrowHitTick(90);
    expect(H).toBeGreaterThan(cfg.enemies.archer!.attacks.shot!.windup); // it takes flight time
  });

  it('blocking stops the arrow', () => {
    const { w, e } = setup('archer', 90);
    startEnemyAttack(w, e, 'shot', cfg);
    run(w, cfg, 100, () => input({ hold: ['parry'], aim: at(e) }));
    expect(w.stats.hitsTaken).toBe(0);
    expect(w.player.hp).toBe(cfg.player.maxHealth);
  });

  it('any deflect sends the arrow back into the archer; a perfect one hits harder', () => {
    const H = arrowHitTick(90);
    const result = (pressAt: number) => {
      const { w, e } = setup('archer', 90);
      startEnemyAttack(w, e, 'shot', cfg);
      for (let t = 0; t < 160; t++) step(w, input({ press: t === pressAt ? ['parry'] : [], aim: at(e) }), cfg);
      return { w, e };
    };
    const normal = result(H - cfg.combat.parry.perfectFrames - 1);
    expect(normal.w.stats.deflects).toBe(1);
    expect(normal.w.stats.perfects).toBe(0);
    expect(normal.e.hp).toBe(cfg.enemies.archer!.health - cfg.combat.reflect.healthDamage);

    const perfect = result(H - 1);
    expect(perfect.w.stats.perfects).toBe(1);
    expect(perfect.e.hp).toBe(cfg.enemies.archer!.health - cfg.combat.reflect.perfectHealthDamage);
    expect(perfect.e.posture).toBeGreaterThan(normal.e.posture);
  });

  it('dashing passes through arrows', () => {
    const H = arrowHitTick(90);
    const { w, e } = setup('archer', 90);
    startEnemyAttack(w, e, 'shot', cfg);
    for (let t = 0; t < 120; t++) step(w, input({ press: t === H - 3 ? ['dash'] : [], move: { x: 0, y: 1 }, aim: at(e) }), cfg);
    expect(w.stats.hitsTaken).toBe(0);
  });

  it('guard auto-faces an incoming arrow', () => {
    const { w, e } = setup('archer', 90);
    startEnemyAttack(w, e, 'shot', cfg);
    run(w, cfg, cfg.enemies.archer!.attacks.shot!.windup + 4);
    expect(w.projectiles.length).toBe(1);
    step(w, input({ hold: ['parry'], aim: { x: 0, y: 120 } }), cfg); // cursor points away (west)
    expect(w.player.facing.x).toBeGreaterThan(0.9); // turned east, toward the arrow
  });

  it('an arrow in the air counts as an attack in flight (no Dominion swing lands with it)', () => {
    const w = testWorld(cfg, { only: ['dominion', 'archer'], dummyAttacks: true });
    w.player.pos = { x: 100, y: 120 };
    const dom = w.enemies.find((x) => x.type === 'dominion')!;
    const arc = w.enemies.find((x) => x.type === 'archer')!;
    dom.pos = { x: 125, y: 120 };
    arc.pos = { x: 100, y: 210 };
    let overlap = 0;
    let arrows = 0;
    for (let t = 0; t < 60 * 30; t++) {
      // Arrows in the air *before* this tick, by shooter.
      const flying = w.projectiles.filter((p) => p.owner !== 'player').map((p) => p.owner);
      step(w, input({ hold: ['parry'] }), cfg);
      w.player.hp = cfg.player.maxHealth;
      w.player.posture = 0;
      arrows += w.events.filter((ev) => ev.type === 'arrowLoosed').length;
      w.events.length = 0;
      // Violation: an enemy starts an attack while ANOTHER enemy's arrow is in the air.
      for (const e of w.enemies) if (e.phase === 'windup' && e.phaseFrame === 0 && flying.some((o) => o !== e.id)) overlap++;
    }
    expect(arrows).toBeGreaterThan(0); // the archer really did shoot
    expect(overlap).toBe(0);
  });
});
