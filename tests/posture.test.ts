import { describe, expect, it } from 'vitest';
import type { ButtonAction } from '../src/input/actions';
import { startEnemyAttack } from '../src/sim/actors/enemy';
import { regenPosture } from '../src/sim/combat/posture';
import { isPlayerInvulnerable } from '../src/sim/combat/damage';
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
  /** Idle `lead` ticks first so presses can happen well before the swing; presses are relative to the hit. */
  function mashScenario(pressesBeforeHit: number[]) {
    const H0 = hitTick('swing');
    const lead = 60;
    const { w, e } = duel('dummy');
    const H = lead + H0;
    for (let t = 0; t < lead + 80; t++) {
      if (t === lead) startEnemyAttack(w, e, 'swing', cfg);
      const press = pressesBeforeHit.some((k) => t === H - k + (t >= lead ? 0 : 0)) ? (['parry'] as const) : [];
      step(w, input({ press: [...press], aim: aimAt(e) }), cfg);
    }
    return w;
  }
  const late = P.penalizedWindowFrames + 2; // inside the full window, outside the short one
  const whiff = late + P.windowFrames + 4; // its window ends ~4 ticks before the real read

  it('after a whiffed parry, a re-press within whiffPenaltyFrames gets the short window', () => {
    expect(late).toBeLessThan(P.windowFrames);
    expect(whiff - P.windowFrames - late).toBeLessThan(P.whiffPenaltyFrames);
    expect(mashScenario([late]).stats.deflects).toBe(1); // control: no whiff -> deflects
    const mashed = mashScenario([whiff, late]);
    expect(mashed.stats.deflects).toBe(0);
    expect(mashed.stats.hitsTaken).toBe(1);
  });

  it('a penalised press still deflects if it is precise (inside the short window)', () => {
    expect(mashScenario([whiff, 2]).stats.deflects).toBe(1);
  });

  it('mashing every few frames never finds the full window', () => {
    const { w } = duel('dummy');
    let fullWindowWhileMashing = 0;
    for (let t = 0; t < 60; t++) {
      step(w, input({ press: t % 3 === 0 ? ['parry'] : [] }), cfg);
      if (w.player.parry && t > P.windowFrames + 2 && w.player.parry.window === P.windowFrames) fullWindowWhileMashing++;
    }
    expect(fullWindowWhileMashing).toBe(0);
  });

  it('a successful deflect clears the penalty', () => {
    const w = mashScenario([2]);
    run(w, cfg, 12);
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

  it('auto-face: guarding turns Satan toward the incoming attack even if the cursor points away', () => {
    const { w, e } = duel('dummy');
    startEnemyAttack(w, e, 'swing', cfg);
    const away = { x: w.player.pos.x - 50, y: w.player.pos.y };
    for (let t = 0; t < 80; t++) step(w, input({ hold: ['parry'], aim: away }), cfg);
    expect(w.stats.hitsTaken).toBe(0);
  });

  it('with auto-face off, guarding with your back to the attacker fails', () => {
    const c: SimConfig = { ...cfg, combat: { ...cfg.combat, autoFace: { ...cfg.combat.autoFace, enabled: false } } };
    const { w, e } = duel('dummy', c);
    startEnemyAttack(w, e, 'swing', c);
    const away = { x: w.player.pos.x - 50, y: w.player.pos.y };
    for (let t = 0; t < 80; t++) step(w, input({ hold: ['parry'], aim: away }), c);
    expect(w.stats.hitsTaken).toBe(1);
  });

  it('auto-face picks the attack that lands soonest, not just the nearest enemy', () => {
    const w = testWorld(cfg, { only: ['dummy', 'dominion'] });
    const [dummy, dom] = [w.enemies.find((x) => x.type === 'dummy')!, w.enemies.find((x) => x.type === 'dominion')!];
    w.player.pos = { x: 120, y: 120 };
    dummy.pos = { x: 140, y: 120 }; // nearer, but only just started winding up
    dom.pos = { x: 120, y: 150 }; // farther, about to strike
    dummy.cooldown = dom.cooldown = 9999;
    startEnemyAttack(w, dummy, 'swing', cfg);
    startEnemyAttack(w, dom, 'thrust', cfg);
    dom.phaseFrame = cfg.enemies.dominion!.attacks.thrust!.windup - 3;
    step(w, input({ hold: ['parry'] }), cfg);
    expect(w.player.facing.y).toBeGreaterThan(0.9); // facing the Dominion (+y)
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
    for (let t = 0; t < 80 && e.phase !== 'recover'; t++) step(w, input({ hold: ['parry'], aim: aimAt(e) }), cfg);
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

describe('riposte (perfect-parry reward)', () => {
  it('a perfect deflect staggers the attacker; a normal deflect does not', () => {
    const H = hitTickFor('swing');
    const perfect = scenarioFor('swing', H - 1);
    expect(perfect.e.phase === 'recoil' || perfect.sawRecoil).toBe(true);
    const normal = scenarioFor('swing', H - P.perfectFrames); // first non-perfect frame
    expect(normal.w.stats.deflects).toBe(1);
    expect(normal.sawRecoil).toBe(false);
  });

  it('slashes during the stagger bypass the shield and deal multiplied posture and health', () => {
    const { w, e } = duel('dominion');
    e.phase = 'recoil';
    e.phaseFrame = 0;
    step(w, input({ press: ['slash'], aim: aimAt(e) }), cfg);
    run(w, cfg, 8, () => input({ aim: aimAt(e) }));
    const d = cfg.attacks.slash1!;
    const r = cfg.combat.riposte;
    expect(e.hp).toBe(cfg.enemies.dominion!.health - d.healthDamage * r.healthMul);
    expect(e.posture).toBeCloseTo(d.postureDamage * r.postureMul, 5);
  });

  it('the stagger ends after riposte.frames and the enemy recovers', () => {
    const { w, e } = duel('dominion');
    e.phase = 'recoil';
    e.phaseFrame = 0;
    run(w, cfg, cfg.combat.riposte.frames + 1);
    expect(e.phase).toBe('idle');
  });

  function hitTickFor(attack: string): number {
    const { w, e } = duel('dummy');
    startEnemyAttack(w, e, attack, cfg);
    for (let t = 0; t < 80; t++) {
      step(w, input({ aim: aimAt(e) }), cfg);
      if (w.stats.hitsTaken > 0) return t;
    }
    throw new Error('never hit');
  }
  function scenarioFor(attack: string, pressAt: number) {
    const { w, e } = duel('dummy');
    startEnemyAttack(w, e, attack, cfg);
    let sawRecoil = false;
    for (let t = 0; t < 80; t++) {
      step(w, input({ press: t === pressAt ? ['parry'] : [], aim: aimAt(e) }), cfg);
      if (e.phase === 'recoil') sawRecoil = true;
    }
    return { w, e, sawRecoil };
  }
});

describe('dash cooldown (no double-dashing)', () => {
  const D = cfg.player.dash;

  it('a second dash pressed right after the first does not happen', () => {
    const w = testWorld(cfg, { withDummy: false });
    w.player.pos = { x: 60, y: 100 };
    step(w, input({ press: ['dash'], move: { x: 1, y: 0 } }), cfg);
    run(w, cfg, D.frames + D.endLag, () => input({ move: { x: 1, y: 0 } }));
    step(w, input({ press: ['dash'], move: { x: 0, y: 1 } }), cfg);
    expect(w.player.dash).toBeNull();
    // ...and that early press is not saved up to fire much later.
    run(w, cfg, D.cooldownFrames + 10);
    expect(w.player.dash).toBeNull();
  });

  it('after the cooldown, dashing works again (with full i-frames)', () => {
    const w = testWorld(cfg, { withDummy: false });
    w.player.pos = { x: 60, y: 100 };
    step(w, input({ press: ['dash'], move: { x: 1, y: 0 } }), cfg);
    run(w, cfg, D.frames + D.cooldownFrames);
    step(w, input({ press: ['dash'], move: { x: 0, y: 1 } }), cfg);
    expect(w.player.dash).not.toBeNull();
    step(w, input(), cfg);
    expect(isPlayerInvulnerable(w.player, cfg)).toBe(true);
  });

  it('a press made just before the cooldown ends is buffered and fires on the first ready tick', () => {
    const w = testWorld(cfg, { withDummy: false });
    w.player.pos = { x: 60, y: 100 };
    step(w, input({ press: ['dash'], move: { x: 1, y: 0 } }), cfg);
    run(w, cfg, D.frames - 1);
    expect(w.player.dash).toBeNull();
    run(w, cfg, D.cooldownFrames - 4);
    step(w, input({ press: ['dash'], move: { x: 0, y: 1 } }), cfg); // 3 ticks early
    let fired = -1;
    for (let t = 0; t < 10 && fired < 0; t++) {
      step(w, input({ move: { x: 0, y: 1 } }), cfg);
      if (w.player.dash) fired = t;
    }
    expect(fired).toBeGreaterThanOrEqual(0);
    expect(fired).toBeLessThanOrEqual(3);
  });
});

describe('block responsiveness and the hold-vs-mash rule', () => {
  it('block is live on the very first tick RMB is held (no delay after the parry window)', () => {
    const { w, e } = duel('dummy');
    step(w, input({ press: ['parry'], hold: ['parry'], aim: aimAt(e) }), cfg);
    expect(w.player.guarding).toBe(true);
  });

  it('holding RMB into a block does not count as a whiffed parry', () => {
    const { w, e } = duel('dummy');
    step(w, input({ press: ['parry'], hold: ['parry'], aim: aimAt(e) }), cfg);
    run(w, cfg, P.windowFrames + 5, () => input({ hold: ['parry'], aim: aimAt(e) }));
    expect(w.player.parryPenalty).toBe(0);
  });

  it('a released tap that whiffs still gets the anti-mash penalty', () => {
    const { w, e } = duel('dummy');
    step(w, input({ press: ['parry'], aim: aimAt(e) }), cfg);
    run(w, cfg, P.windowFrames + 1, () => input({ aim: aimAt(e) }));
    expect(w.player.parryPenalty).toBeGreaterThan(0);
  });

  it('reacting to the "now" flash (with human reaction time) still lands a deflect', () => {
    const lead = cfg.combat.telegraph.flashLeadFrames;
    const reaction = 12; // ~200 ms
    const H = hitTick('swing');
    const { w } = scenario('swing', { [H - lead + reaction]: ['parry'] });
    expect(w.stats.deflects).toBe(1);
  });

  it('every Dominion attack that can be parried flashes early enough to react to', () => {
    for (const [k, atk] of Object.entries(cfg.enemies.dominion!.attacks)) {
      if (atk.judgement) continue;
      // Reaction window = time between flash start and the hit, must exceed ~200 ms.
      expect(Math.min(atk.windup, cfg.combat.telegraph.flashLeadFrames), k).toBeGreaterThanOrEqual(15);
    }
  });
});

describe('Dominion flanking punish', () => {
  it('lingering behind the shield triggers a fast pivot and a shield-spin', () => {
    const { w, e } = duel('dominion');
    w.flags.dummyAttacks = true;
    e.facing = { x: 1, y: 0 }; // facing away: Satan is behind it
    e.cooldown = 9999;
    let spun = false;
    for (let t = 0; t < 60 && !spun; t++) {
      step(w, input({ aim: aimAt(e) }), cfg);
      if (e.attack === 'spin') spun = true;
    }
    expect(spun).toBe(true);
  });

  it('the spin hits all around, but can be parried', () => {
    const { w, e } = duel('dominion');
    startEnemyAttack(w, e, 'spin', cfg);
    const windup = cfg.enemies.dominion!.attacks.spin!.windup;
    for (let t = 0; t < 60; t++) step(w, input({ press: t === windup - 2 ? ['parry'] : [], aim: aimAt(e) }), cfg);
    expect(w.stats.deflects).toBe(1);
    expect(w.stats.hitsTaken).toBe(0);
  });

  it('standing in front of the shield never triggers the spin', () => {
    const { w, e } = duel('dominion');
    w.flags.dummyAttacks = true;
    e.cooldown = 9999;
    for (let t = 0; t < 120; t++) step(w, input({ aim: aimAt(e) }), cfg);
    expect(e.attack === 'spin').toBe(false);
  });
});
