import { describe, expect, it } from 'vitest';
import { startEnemyAttack } from '../src/sim/actors/enemy';
import { hitEnemy } from '../src/sim/combat/damage';
import { step } from '../src/sim/step';
import { spawnEnemy, type Enemy, type World } from '../src/sim/world';
import { input, run, testConfig, testWorld } from './helpers';

const cfg = testConfig();
const Z = cfg.enemies.zealot!;
const A = Z.attacks;

/** Satan and the Zealot face to face; her own AI is quiet, the test drives her. */
function duel(dist = 26): { w: World; e: Enemy } {
  const w = testWorld(cfg, { withDummy: false });
  const e = spawnEnemy(w, cfg, 'zealot', { x: 100 + dist, y: 120 });
  w.player.pos = { x: 100, y: 120 };
  e.facing = { x: -1, y: 0 };
  e.cooldown = 99999;
  return { w, e };
}
const at = (e: Enemy) => ({ x: e.pos.x, y: e.pos.y });
/** Keys of attacks started over the next `ticks`, while `press` decides inputs each tick. */
function playString(w: World, e: Enemy, ticks: number, press: (w: World, e: Enemy) => ('parry' | 'slash' | 'dash')[] = () => [], keep = true): string[] {
  const seen: string[] = [];
  let last = '';
  for (let t = 0; t < ticks; t++) {
    step(w, input({ press: press(w, e), aim: at(e) }), cfg);
    const cur = e.phase === 'windup' && e.attack ? e.attack : '';
    if (cur && cur !== last) seen.push(cur);
    last = cur || (e.phase === 'windup' ? last : '');
    if (keep && e.phase !== 'broken') w.player.pos = { x: e.pos.x - 26, y: e.pos.y }; // stay in her reach
    w.player.hp = cfg.player.maxHealth;
  }
  return seen;
}
const parryEachHit = (_w: World, e: Enemy) => (e.phase === 'windup' && e.phaseFrame === e.windupLen - 1 ? ['parry' as const] : []);

describe('Zealot: the Flurry', () => {
  it('five hits with the rhythm 16 / 8 / 8 / 10 / 14 — the last one slower', () => {
    expect([1, 2, 3, 4, 5].map((i) => A[`flurry${i}`]!.windup)).toEqual([16, 8, 8, 10, 14]);
    const { w, e } = duel();
    startEnemyAttack(w, e, 'flurry1', cfg);
    const seen = playString(w, e, 200);
    expect(seen.slice(0, 5)).toEqual(['flurry1', 'flurry2', 'flurry3', 'flurry4', 'flurry5']);
    expect(w.stats.hitsTaken).toBe(5);
  });

  it("super-armour: slashing her mid-Flurry doesn't stop the combo or knock her back", () => {
    const { w, e } = duel();
    startEnemyAttack(w, e, 'flurry1', cfg);
    run(w, cfg, 20, () => input({ aim: at(e) }));
    const before = e.attack;
    hitEnemy(w, e, w.player.pos, { x: 1, y: 0 }, cfg.attacks.slash3!, cfg);
    expect(e.knock).toEqual({ x: 0, y: 0 });
    expect(e.phase).not.toBe('flinch');
    expect(e.attack).toBe(before);
    expect(e.hp).toBe(Z.health - cfg.attacks.slash3!.healthDamage); // damage still lands
    const seen = playString(w, e, 200);
    expect(seen).toContain('flurry5');
  });

  it('parrying hit by hit breaks her posture within 3–4 hits, and the break ends the combo', () => {
    const { w, e } = duel();
    startEnemyAttack(w, e, 'flurry1', cfg);
    const seen = playString(w, e, 200, parryEachHit);
    expect(w.stats.hitsTaken).toBe(0);
    expect(w.stats.deflects).toBeGreaterThanOrEqual(3);
    expect(w.stats.deflects).toBeLessThanOrEqual(4);
    expect(e.phase).toBe('broken');
    expect(seen).not.toContain('flurry5');
  });

  it('one parry press only covers one hit (the rhythm matters)', () => {
    const { w, e } = duel();
    startEnemyAttack(w, e, 'flurry1', cfg);
    let pressed = false;
    playString(w, e, 200, (_w, z) => {
      if (!pressed && z.attack === 'flurry1' && z.phase === 'windup' && z.phaseFrame === z.windupLen - 1) {
        pressed = true;
        return ['parry'];
      }
      return [];
    });
    expect(w.stats.deflects).toBe(1);
    expect(w.stats.hitsTaken).toBe(4);
  });

  it('a dash passes through any single hit (earlier hits blocked)', () => {
    for (const k of [1, 3, 5]) {
      const { w, e } = duel();
      startEnemyAttack(w, e, 'flurry1', cfg);
      let dashed = false;
      for (let t = 0; t < 200; t++) {
        const target = e.attack === `flurry${k}`;
        const dash = !dashed && target && e.phase === 'windup' && e.phaseFrame >= e.windupLen - 3;
        if (dash && w.player.blockStun === 0) dashed = true;
        step(w, input({ press: dash ? ['dash'] : [], hold: dash ? [] : ['parry'], move: dash ? { x: 0, y: 1 } : undefined, aim: at(e) }), cfg);
        if (!w.player.dash && !dashed) w.player.pos = { x: e.pos.x - 26, y: e.pos.y };
      }
      expect(dashed, `hit ${k}`).toBe(true);
      expect(w.stats.hitsTaken, `hit ${k}`).toBe(0);
    }
  });
});

describe('Zealot: the Sweep (Judgement)', () => {
  const sweep = (act: 'hold' | 'parry' | 'dash') => {
    const { w, e } = duel(30);
    startEnemyAttack(w, e, 'sweep', cfg);
    let blockFail = false;
    for (let t = 0; t < 80; t++) {
      const now = e.phase === 'windup' && e.phaseFrame === e.windupLen - (act === 'dash' ? 2 : 1);
      step(w, input({ press: now && act !== 'hold' ? [act] : [], hold: act === 'hold' ? ['parry'] : [], move: act === 'dash' && now ? { x: 0, y: 1 } : undefined, aim: at(e) }), cfg);
      blockFail ||= w.events.some((ev) => ev.type === 'blockFail');
    }
    return { taken: w.stats.hitsTaken, blockFail };
  };
  it("can't be blocked — and blocking visibly fails", () => {
    const r = sweep('hold');
    expect(r.taken).toBe(1);
    expect(r.blockFail).toBe(true);
  });
  it("can't be parried", () => expect(sweep('parry').taken).toBe(1));
  it('can be dashed through', () => expect(sweep('dash').taken).toBe(0));
  it('has a long telegraph and a long recovery (the punish window)', () => {
    expect(A.sweep!.windup).toBeGreaterThanOrEqual(24);
    expect(A.sweep!.recovery).toBeGreaterThanOrEqual(30);
  });
});

describe('Zealot: moves, flinch and fairness', () => {
  it('the cross-step sidesteps between hits, so each hit comes from a new angle', () => {
    const { w, e } = duel(28);
    startEnemyAttack(w, e, 'cross1', cfg);
    const dirs: number[] = [];
    const done = new Set<string>();
    for (let t = 0; t < 160; t++) {
      step(w, input({ aim: at(e) }), cfg);
      w.player.hp = cfg.player.maxHealth;
      if (e.phase === 'active' && e.attack && !done.has(e.attack)) {
        done.add(e.attack);
        dirs.push(Math.atan2(e.pos.y - 120, e.pos.x - 100));
      }
    }
    expect(dirs.length).toBe(3);
    expect(Math.abs(dirs[1]! - dirs[0]!) + Math.abs(dirs[2]! - dirs[1]!)).toBeGreaterThan(0.2);
  });

  it('the thrust dash closes ~90 px and can be parried', () => {
    const { w, e } = duel(100);
    startEnemyAttack(w, e, 'thrust', cfg);
    // It connects a few frames into the lunge: press as she launches.
    for (let t = 0; t < 60; t++) step(w, input({ press: e.attack === 'thrust' && e.phase === 'active' && e.phaseFrame === 1 ? ['parry'] : [], aim: at(e) }), cfg);
    expect(w.stats.deflects).toBe(1);
    expect(Math.hypot(e.pos.x - 100, e.pos.y - 120)).toBeLessThan(60);
  });

  it("flinches briefly out of super-armour, then can't be stun-locked", () => {
    const { w, e } = duel(30);
    e.phase = 'idle';
    hitEnemy(w, e, w.player.pos, { x: 1, y: 0 }, cfg.attacks.slash1!, cfg);
    expect(e.phase).toBe('flinch');
    run(w, cfg, Z.flinchFrames! + 12); // + the hit-stop
    expect(e.phase).toBe('idle');
    hitEnemy(w, e, w.player.pos, { x: 1, y: 0 }, cfg.attacks.slash1!, cfg);
    expect(e.phase).toBe('idle'); // immune for a while
  });

  it('as an elite she takes the duel: with a Dominion present only one of them attacks at a time', () => {
    const w = testWorld(cfg, { withDummy: false, dummyAttacks: true });
    w.player.pos = { x: 140, y: 112 };
    const z = spawnEnemy(w, cfg, 'zealot', { x: 175, y: 112 });
    const d = spawnEnemy(w, cfg, 'dominion', { x: 140, y: 150 });
    let focusZ = 0;
    let overlap = 0;
    let zAttacks = 0;
    for (let t = 0; t < 60 * 30; t++) {
      step(w, input({ hold: ['parry'], aim: { ...z.pos } }), cfg);
      w.player.hp = cfg.player.maxHealth;
      w.player.posture = 0;
      if (w.focusId === z.id) focusZ++;
      const zBusy = (z.phase === 'windup' || z.phase === 'active') && !cfg.enemies.zealot!.attacks[z.attack ?? '']?.noHit;
      const dBusy = d.phase === 'windup' || d.phase === 'active';
      if (zBusy && dBusy) overlap++;
      if (z.phase === 'windup' && z.phaseFrame === 1 && !cfg.enemies.zealot!.attacks[z.attack ?? '']?.noHit) zAttacks++;
    }
    expect(zAttacks).toBeGreaterThan(5);
    expect(focusZ).toBeGreaterThan(60 * 25);
    expect(overlap).toBe(0);
  });

  it('fairness: every attack a string starts with has ≥14 frames of telegraph; unparryable ones ≥24', () => {
    const chained = new Set(Object.values(A).map((a) => a.chain?.next).filter(Boolean));
    for (const [k, a] of Object.entries(A)) {
      if (a.noHit || chained.has(k)) continue;
      expect(a.windup, k).toBeGreaterThanOrEqual(14);
      if (a.judgement && !a.deflectable) expect(a.windup, k).toBeGreaterThanOrEqual(24);
    }
  });

  it('she is fast (≈190 px/s) and only acts within 200 px', () => {
    expect(Z.speed).toBeGreaterThanOrEqual(180);
    expect(Z.ai!.maxAttackDist).toBeLessThanOrEqual(200);
  });
});

describe('Zealot: parrying beats trading (benchmark)', () => {
  type Style = 'trader' | 'parrier';
  function fight(style: Style, seed: number) {
    const w = testWorld(cfg, { withDummy: false, dummyAttacks: true });
    w.rng.seed = seed * 7919;
    const e = spawnEnemy(w, cfg, 'zealot', { x: 150, y: 112 });
    w.player.pos = { x: 110, y: 112 };
    let dmg = 0;
    let last = w.player.hp;
    for (let t = 0; t < 60 * 90; t++) {
      const d = Math.hypot(e.pos.x - w.player.pos.x, e.pos.y - w.player.pos.y);
      const atk = e.attack ? Z.attacks[e.attack] : undefined;
      const dirTo = { x: (e.pos.x - w.player.pos.x) / (d || 1), y: (e.pos.y - w.player.pos.y) / (d || 1) };
      const toward = { x: dirTo.x - dirTo.y, y: (dirTo.x + dirTo.y) / 2 }; // ground → screen-ish
      let press: ('slash' | 'parry' | 'dash')[] = [];
      let move = d > 24 ? toward : { x: 0, y: 0 };
      if (style === 'trader') {
        if (d < 34 && t % 10 === 0) press = ['slash'];
      } else {
        const threat = atk && !atk.noHit && e.phase === 'windup';
        if (threat && atk!.judgement && e.phaseFrame === e.windupLen - 2) {
          press = ['dash'];
          move = { x: -toward.y, y: toward.x };
        } else if (threat && !atk!.judgement && !(atk!.lunge && atk!.lunge.px > 20) && e.phaseFrame === e.windupLen - 1) press = ['parry'];
        else if (threat && atk!.lunge && atk!.lunge.px > 20 && e.phase === 'windup' && e.phaseFrame === e.windupLen) press = ['parry'];
        else if (atk?.lunge && atk.lunge.px > 20 && e.phase === 'active' && e.phaseFrame === 1) press = ['parry'];
        else if (d < 34 && t % 10 === 0 && (e.phase === 'broken' || e.phase === 'recover' || e.phase === 'flinch' || (e.phase === 'idle' && e.cooldown > 20))) press = ['slash'];
      }
      step(w, input({ press, move, aim: { ...e.pos } }), cfg);
      if (w.player.hp < last) {
        dmg += last - w.player.hp;
        if (process.env.Z_DEBUG) console.log('[zhit]', style, e.attack, e.phase, e.phaseFrame);
      }
      if (w.player.hp > last) dmg += last + (cfg.player.maxHealth - w.player.hp);
      last = w.player.hp;
      if (e.phase === 'down') return { secs: t / 60, dmg };
    }
    return { secs: 90, dmg };
  }
  it('the parrier kills her about as fast or faster, taking far less damage', () => {
    const avg = (s: Style) => {
      const rs = [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => fight(s, seed));
      return { secs: rs.reduce((a, r) => a + r.secs, 0) / rs.length, dmg: rs.reduce((a, r) => a + r.dmg, 0) / rs.length };
    };
    const tr = avg('trader');
    const pa = avg('parrier');
    console.log(`[zealot] trader ${tr.secs.toFixed(1)}s ${tr.dmg.toFixed(0)} dmg | parrier ${pa.secs.toFixed(1)}s ${pa.dmg.toFixed(0)} dmg`);
    expect(pa.dmg).toBeLessThan(tr.dmg * 0.5);
    expect(pa.secs).toBeLessThanOrEqual(tr.secs * 1.15);
  });
});
