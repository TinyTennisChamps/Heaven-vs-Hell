import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { groundToScreen } from '../src/core/iso';
import { normalize, type Vec2 } from '../src/core/math';
import type { ButtonAction } from '../src/input/actions';
import type { RoomDef, SimConfig } from '../src/sim/config';
import { inFrontCone, shieldUp } from '../src/sim/combat/damage';
import { step } from '../src/sim/step';
import { createWorld, type World } from '../src/sim/world';
import { input, loadData, testConfig } from './helpers';

/**
 * Difficulty benchmark for the L1 rooms: a "decent player" bot (fights the
 * nearest enemy, deflects most attacks a few frames late or early like a
 * human, dashes out of Judgement, finishes broken enemies) plays each room.
 * The numbers are printed for tuning; the asserts are loose guard rails.
 */
const screenMove = (d: Vec2): Vec2 => {
  const s = groundToScreen(d.x, d.y);
  const l = Math.hypot(s.x, s.y) || 1;
  return { x: s.x / l, y: s.y / l };
};

function decentBot(w: World, cfg: SimConfig, tick: number): { press: ButtonAction[]; hold?: ButtonAction[]; move: Vec2; aim: Vec2 } {
  const p = w.player;
  // Hold block against an incoming arrow (most of the time).
  const arrow = w.projectiles.find((a) => a.owner !== 'player' && Math.hypot(a.pos.x - p.pos.x, a.pos.y - p.pos.y) < 70);
  if (arrow && (arrow.id % 4 !== 0)) return { press: [], hold: ['parry'], move: { x: 0, y: 0 }, aim: { ...arrow.pos } };
  const live = w.enemies.filter((e) => e.phase !== 'down');
  if (!live.length) return { press: [], move: { x: 0, y: 0 }, aim: { x: p.pos.x + 1, y: p.pos.y } };
  // React to the most imminent attack in range.
  for (const e of live) {
    const atk = e.attack ? cfg.enemies[e.type]!.attacks[e.attack] : undefined;
    if (!atk || e.phase !== 'windup') continue;
    const d = Math.hypot(e.pos.x - p.pos.x, e.pos.y - p.pos.y);
    if (d > (atk.projectile ? 200 : atk.hitbox.radius + (atk.lunge?.px ?? 0) + 12)) continue;
    const dir = normalize({ x: e.pos.x - p.pos.x, y: e.pos.y - p.pos.y });
    // Human-ish timing: varies by ±3 frames around "just before impact"; misses ~1 in 5.
    const jitter = ((e.id * 7 + Math.floor(tick / 97)) % 7) - 3;
    const miss = (e.id + Math.floor(tick / 131)) % 5 === 0;
    if (atk.judgement && e.phaseFrame === atk.windup - 3) return { press: ['dash'], move: screenMove({ x: -dir.y, y: dir.x }), aim: { ...e.pos } };
    if (!atk.judgement && !atk.projectile && !miss && e.phaseFrame === atk.windup - 4 + jitter) return { press: ['parry'], move: { x: 0, y: 0 }, aim: { ...e.pos } };
  }
  const t = live.slice().sort((a, b) => Math.hypot(a.pos.x - p.pos.x, a.pos.y - p.pos.y) - Math.hypot(b.pos.x - p.pos.x, b.pos.y - p.pos.y))[0]!;
  const to = { x: t.pos.x - p.pos.x, y: t.pos.y - p.pos.y };
  const dist = Math.hypot(to.x, to.y);
  let dirG = normalize(to);
  // Like a human, walk around cover instead of into it.
  const st = stuckOf(w);
  if (st.n > 6) dirG = { x: -dirG.y, y: dirG.x };
  const move = dist > 18 ? screenMove(dirG) : { x: 0, y: 0 };
  // Don't hack at a raised shield from the front: wait for an opening (recoil, broken, recovery).
  const def = cfg.enemies[t.type]!;
  const walled = def.shieldArcDeg > 0 && shieldUp(t) && inFrontCone(t.pos, t.facing, p.pos, def.shieldArcDeg) && t.phase !== 'recover';
  const press: ButtonAction[] = dist < 30 && tick % 10 === 0 && !walled ? ['slash'] : [];
  if (t.type === 'archer' && dist > 70 && p.pips > 0 && tick % 50 === 0) press.push('throw');
  return { press, move, aim: { ...t.pos } };
}

const stuck = new WeakMap<World, { last: Vec2; n: number }>();
function stuckOf(w: World) {
  let s = stuck.get(w);
  if (!s) stuck.set(w, (s = { last: { ...w.player.pos }, n: 0 }));
  const moved = Math.hypot(w.player.pos.x - s.last.x, w.player.pos.y - s.last.y);
  s.n = moved < 0.4 && !w.player.action && !w.player.parry ? s.n + 1 : Math.max(0, s.n - 1);
  if (s.n > 60) s.n = 0;
  s.last = { ...w.player.pos };
  return s;
}

function playRoom(room: RoomDef, cfg: SimConfig, seed: number) {
  const w = createWorld(room, cfg, seed);
  w.flags.respawn = false;
  w.flags.immortal = true; // measure damage, don't stop at death
  let dmg = 0;
  let last = w.player.hp;
  for (let t = 0; t < 60 * 180; t++) {
    const b = decentBot(w, cfg, t);
    step(w, input(b), cfg);
    const hp = w.player.hp;
    if (hp < last) dmg += last - hp;
    else if (hp > last) dmg += last + (cfg.player.maxHealth - hp); // immortal refill
    last = hp;
    if (w.roomRun.cleared) return { secs: t / 60, dmg };
  }
  return { secs: Infinity, dmg };
}

describe('L1 difficulty (decent-player bot)', () => {
  const cfg: SimConfig = testConfig();
  const dir = path.resolve(__dirname, '../data/rooms/l1');
  const ids = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'rest.json').map((f) => f.replace('.json', ''));
  for (const id of ids) {
    it(`${id}: clearable, and affordable for a decent player`, () => {
      const room = loadData<RoomDef>(`rooms/l1/${id}`);
      const rs = [1, 2, 3, 4, 5, 6].map((s) => playRoom(room, cfg, s));
      const secs = rs.reduce((a, r) => a + r.secs, 0) / rs.length;
      const dmg = rs.reduce((a, r) => a + r.dmg, 0) / rs.length;
      console.log(`[difficulty] ${room.tier} ${id}: ${secs.toFixed(1)}s, ${dmg.toFixed(0)} dmg avg (max ${Math.max(...rs.map((r) => r.dmg))})`);
      expect(rs.every((r) => Number.isFinite(r.secs))).toBe(true);
      // L1 is the gentlest layer: a decent player loses well under half a bar per room.
      expect(dmg).toBeLessThan(cfg.player.maxHealth * (room.tier === 'hard' ? 0.5 : 0.35));
    });
  }
});
