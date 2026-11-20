import { describe, expect, it } from 'vitest';
import type { ButtonAction } from '../src/input/actions';
import { startEnemyAttack } from '../src/sim/actors/enemy';
import { regenPosture } from '../src/sim/combat/posture';
import type { SimConfig } from '../src/sim/config';
import { step } from '../src/sim/step';
import type { Enemy, World } from '../src/sim/world';
import { input, run, testConfig, testWorld } from './helpers';

const cfg = testConfig();
const P = cfg.combat.parry;

/** Player at a fixed spot, one enemy in front of them, facing them. */
function duel(type: 'dummy' | 'dominion', c: SimConfig = cfg): { w: World; e: Enemy } {
  const w = testWorld(c, { only: [type], dummyAttacks: false });
  const e = w.enemies[0]!;
  w.player.pos = { x: 120, y: 120 };
  e.pos = { x: 142, y: 120 };
  e.facing = { x: -1, y: 0 };
  e.cooldown = 9999;
  return { w, e };
}

const aimAt = (e: Enemy) => ({ x: e.pos.x, y: e.pos.y });

/**
 * Starts `attack` on tick 0 and runs up to 80 ticks. `press` maps tick -> buttons
 * pressed that tick; `hold` buttons are held throughout.
 */
function scenario(attack: string, press: Record<number, ButtonAction[]>, hold: ButtonAction[] = [], type: 'dummy' | 'dominion' = 'dummy', c: SimConfig = cfg) {
  const { w, e } = duel(type, c);
  startEnemyAttack(w, e, attack, c);
  for (let t = 0; t < 80; t++) step(w, input({ press: press[t] ?? [], hold, aim: aimAt(e) }), c);
  return { w, e };
}

/** Tick on which the swing connects when nothing is done. */
function hitTick(attack: string, type: 'dummy' | 'dominion' = 'dummy'): number {
  const { w, e } = duel(type);
  startEnemyAttack(w, e, attack, cfg);
  for (let t = 0; t < 80; t++) {
    step(w, input({ aim: aimAt(e) }), cfg);
    if (w.stats.hitsTaken > 0) return t;
  }
  throw new Error('never hit');
}

describe('deflect (parry)', () => {
  const H = hitTick('swing');

  it('a press 0..perfectFrames-1 ticks before the hit is a PERFECT deflect', () => {
    for (let k = 0; k < P.perfectFrames; k++) {
      const { w } = scenario('swing', { [H - k]: ['parry'] });
      expect(w.stats.hitsTaken, `k=${k}`).toBe(0);
      expect(w.stats.perfects, `k=${k}`).toBe(1);
      expect(w.player.hp).toBe(cfg.player.maxHealth);
    }
  });

  it('a press within the window but after the perfect frames is a normal deflect', () => {
    for (let k = P.perfectFrames; k < P.windowFrames; k++) {
      const { w } = scenario('swing', { [H - k]: ['parry'] });
      expect(w.stats.hitsTaken, `k=${k}`).toBe(0);
      expect(w.stats.deflects, `k=${k}`).toBe(1);
      expect(w.stats.perfects, `k=${k}`).toBe(0);
    }
  });

  it('a press outside the window does nothing — the hit lands', () => {
    const { w } = scenario('swing', { [H - P.windowFrames]: ['parry'] });
    expect(w.stats.hitsTaken).toBe(1);
  });

  it('deflecting deals big posture damage to the attacker and little to Satan', () => {
    const { w, e } = scenario('swing', { [H - 6]: ['parry'] });
    const atk = cfg.enemies.dummy!.attacks.swing!;
    expect(e.posture).toBeGreaterThan(atk.postureDamage * P.attackerPostureMul - 2);
    expect(w.player.posture).toBeLessThanOrEqual(atk.postureDamage * P.selfPostureMul + 1e-9);
  });

  it('a perfect deflect costs Satan no posture', () => {
    const { w } = scenario('swing', { [H - 1]: ['parry'] });
    expect(w.player.posture).toBe(0);
  });
});

describe('anti-mash', () => {
  const H = hitTick('swing');

  it('after a whiffed parry, a re-press within whiffPenaltyFrames gets the short window', () => {
    // Whiff early; its window ends at H-15; the 20-frame penalty covers the read at H-6.
    expect(H).toBeGreaterThanOrEqual(24);
    const control = scenario('swing', { [H - 6]: ['parry'] }).w;
    expect(control.stats.deflects).toBe(1);
    const mashed = scenario('swing', { [H - 24]: ['parry'], [H - 6]: ['parry'] }).w;
    expect(mashed.stats.deflects).toBe(0); // 6 > penalized window of 5
    expect(mashed.stats.hitsTaken).toBe(1);
  });

  it('a penalised press still deflects if it is precise (inside the short window)', () => {
    const { w } = scenario('swing', { [H - 24]: ['parry'], [H - 2]: ['parry'] });
    expect(w.stats.deflects).toBe(1);
  });

  it('mashing every few frames never finds the full window', () => {
    const press: Record<number, ButtonAction[]> = {};
    for (let t = 0; t < 60; t += 3) press[t] = ['parry'];
    let deflectsAtFullWindowOnly = 0;
    // The only way to deflect while mashing is to happen to land inside the
    // short window; check that the window really is short while mashing.
    const { w } = duel('dummy');
    for (let t = 0; t < 60; t++) {
      step(w, input({ press: press[t] ?? [] }), cfg);
      if (w.player.parry && t > 12 && w.player.parry.window === P.windowFrames) deflectsAtFullWindowOnly++;
    }
    expect(deflectsAtFullWindowOnly).toBe(0);
  });

  it('a successful deflect clears the penalty, so chained deflects keep the full window', () => {
    const { w, e } = duel('dummy');
    startEnemyAttack(w, e, 'swing', cfg);
    const H = hitTick('swing');
    for (let t = 0; t <= H; t++) step(w, input({ press: t === H - 2 ? ['parry'] : [], aim: aimAt(e) }), cfg);
    run(w, cfg, 12, () => input({ aim: aimAt(e) }));
    expect(w.stats.deflects).toBe(1);
    expect(w.player.parryPenalty).toBe(0);
  });
});

describe('block', () => {
  it('holding guard from the front blocks: no health loss, posture goes up', () => {
    const { w } = scenario('swing', {}, ['parry']);
    expect(w.stats.hitsTaken).toBe(0);
    expect(w.player.hp).toBe(cfg.player.maxHealth);
    const atk = cfg.enemies.dummy!.attacks.swing!;
    expect(w.player.posture).toBeGreaterThan(atk.postureDamage * cfg.combat.block.postureMul * 0.5);
  });

  it('guarding with your back to the attacker fails', () => {
    const { w, e } = duel('dummy');
    startEnemyAttack(w, e, 'swing', cfg);
    const away = { x: w.player.pos.x - 50, y: w.player.pos.y };
    for (let t = 0; t < 80; t++) step(w, input({ hold: ['parry'], aim: away }), cfg);
    expect(w.stats.hitsTaken).toBe(1);
  });
});

describe('judgement attacks', () => {
  it('cannot be blocked or deflected', () => {
    const H = hitTick('judgement', 'dominion');
    const blocked = scenario('judgement', {}, ['parry'], 'dominion').w;
    expect(blocked.stats.hitsTaken).toBe(1);
    const parried = scenario('judgement', { [H - 1]: ['parry'] }, [], 'dominion').w;
    expect(parried.stats.hitsTaken).toBe(1);
  });

  it('can be dashed through', () => {
    const H = hitTick('judgement', 'dominion');
    const { w } = duel('dominion');
    const e = w.enemies[0]!;
    startEnemyAttack(w, e, 'judgement', cfg);
    for (let t = 0; t < 80; t++) step(w, input({ press: t === H - 3 ? ['dash'] : [], move: { x: 0, y: 1 }, aim: aimAt(e) }), cfg);
    expect(w.stats.hitsTaken).toBe(0);
  });
});

describe('posture', () => {
  const t = cfg.player.posture;

  it('does not recover until regenDelay ticks without a hit, then drains', () => {
    expect(regenPosture(50, t.regenDelay - 1, 100, 100, t)).toBe(50);
    expect(regenPosture(50, t.regenDelay, 100, 100, t)).toBeLessThan(50);
  });

  it('recovers more slowly at low health', () => {
    const full = 50 - regenPosture(50, 999, 100, 100, t);
    const low = 50 - regenPosture(50, 999, 10, 100, t);
    expect(low).toBeLessThan(full);
    expect(low / full).toBeCloseTo(t.lowHealthMul + (1 - t.lowHealthMul) * 0.1, 5);
  });

  it("Satan's posture filling up breaks him: long stagger, no actions", () => {
    const { w, e } = duel('dummy');
    w.player.posture = cfg.player.posture.max - 1;
    startEnemyAttack(w, e, 'swing', cfg);
    for (let t = 0; t < 40; t++) step(w, input({ hold: ['parry'], aim: aimAt(e) }), cfg);
    expect(w.player.broken).toBeGreaterThan(0);
    step(w, input({ press: ['slash'], aim: aimAt(e) }), cfg);
    expect(w.player.action).toBeNull();
    run(w, cfg, cfg.player.posture.breakStunFrames + 5);
    expect(w.player.broken).toBe(0);
    expect(w.player.posture).toBe(0);
  });
});

describe('posture break and deathblow', () => {
  it('filling an enemy posture breaks it; a slash in range then performs a deathblow', () => {
    const { w, e } = duel('dummy');
    e.posture = cfg.enemies.dummy!.posture.max - 1;
    step(w, input({ press: ['slash'], aim: aimAt(e) }), cfg);
    run(w, cfg, 30, () => input({ aim: aimAt(e) }));
    expect(e.phase).toBe('broken');
    const hp = e.hp;
    expect(hp).toBeGreaterThan(0);
    step(w, input({ press: ['slash'], aim: aimAt(e) }), cfg);
    expect(w.player.action?.key).toBe('deathblow');
    run(w, cfg, 60, () => input({ aim: aimAt(e) }));
    expect(e.phase).toBe('down');
    expect(w.stats.deathblows).toBe(1);
  });

  it('the deathblow triggers hit-stop then slow motion', () => {
    const { w, e } = duel('dummy');
    e.phase = 'broken';
    e.phaseFrame = 0;
    step(w, input({ press: ['slash'], aim: aimAt(e) }), cfg);
    let sawSlowmo = false;
    for (let t = 0; t < 40; t++) {
      step(w, input({ aim: aimAt(e) }), cfg);
      if (w.slowmo > 0) sawSlowmo = true;
    }
    expect(sawSlowmo).toBe(true);
  });

  it('a broken enemy that is left alone recovers', () => {
    const { w, e } = duel('dummy');
    e.phase = 'broken';
    e.phaseFrame = 0;
    run(w, cfg, cfg.enemies.dummy!.brokenFrames + 2);
    expect(e.phase).toBe('idle');
  });
});

describe('Dominion shield', () => {
  it('frontal slashes are absorbed by the shield: no health loss, posture rises', () => {
    const { w, e } = duel('dominion');
    step(w, input({ press: ['slash'], aim: aimAt(e) }), cfg);
    run(w, cfg, 25, () => input({ aim: aimAt(e) }));
    expect(e.hp).toBe(cfg.enemies.dominion!.health);
    expect(e.posture).toBeGreaterThan(0);
    expect(e.blockedHits).toBe(1);
  });

  it('slashes from behind land for full damage', () => {
    const { w, e } = duel('dominion');
    e.facing = { x: 1, y: 0 }; // turned away from Satan
    step(w, input({ press: ['slash'], aim: aimAt(e) }), cfg);
    run(w, cfg, 25, () => input({ aim: aimAt(e) }));
    expect(e.hp).toBe(cfg.enemies.dominion!.health - cfg.attacks.slash1!.healthDamage);
  });

  it('the shield is down during its attack recovery (the punish window)', () => {
    const { w, e } = duel('dominion');
    startEnemyAttack(w, e, 'bash', cfg);
    // Let the bash play out against a blocking Satan, then punish in recovery.
    for (let t = 0; t < 26; t++) step(w, input({ hold: ['parry'], aim: aimAt(e) }), cfg);
    expect(e.phase).toBe('recover');
    step(w, input({ press: ['slash'], aim: aimAt(e) }), cfg);
    run(w, cfg, 12, () => input({ aim: aimAt(e) }));
    expect(e.hp).toBeLessThan(cfg.enemies.dominion!.health);
  });

  it('three deflected thrusts break the Dominion', () => {
    const { w, e } = duel('dominion');
    const H = hitTick('thrust', 'dominion');
    for (let n = 0; n < 3 && e.phase !== 'broken'; n++) {
      e.posture = Math.max(e.posture, 0);
      startEnemyAttack(w, e, 'thrust', cfg);
      for (let t = 0; t < 60; t++) {
        step(w, input({ press: t === H - 1 ? ['parry'] : [], aim: aimAt(e) }), cfg);
        if ((e.phase as string) === 'broken') break;
        if (e.attack === 'thrust2') e.attack = null; // isolate single thrusts
      }
      e.phase = (e.phase as string) === 'broken' ? 'broken' : 'idle';
      e.cooldown = 9999;
    }
    expect(e.phase).toBe('broken');
  });
});
