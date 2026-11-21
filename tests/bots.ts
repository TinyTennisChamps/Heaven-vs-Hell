import { groundToScreen } from '../src/core/iso';
import { normalize, type Vec2 } from '../src/core/math';
import type { ButtonAction } from '../src/input/actions';
import type { RoomDef, SimConfig } from '../src/sim/config';
import { inFrontCone, shieldUp } from '../src/sim/combat/damage';
import { step } from '../src/sim/step';
import { createWorld, type EnemyScale, type World } from '../src/sim/world';
import { input } from './helpers';

/**
 * A "decent player" bot: fights the nearest enemy, deflects most attacks a
 * few frames late or early like a human (misses ~1 in 5), blocks most
 * arrows, dashes out of Judgement, doesn't hack at raised shields, walks
 * around cover. Used by the difficulty and boss benchmarks.
 */
const screenMove = (d: Vec2): Vec2 => {
  const s = groundToScreen(d.x, d.y);
  const l = Math.hypot(s.x, s.y) || 1;
  return { x: s.x / l, y: s.y / l };
};

export function decentBot(w: World, cfg: SimConfig, tick: number): { press: ButtonAction[]; hold?: ButtonAction[]; move: Vec2; aim: Vec2 } {
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
    // Human-ish timing: varies by ±6 frames around "6 frames before impact" — about half
    // the deflects are perfect, the rest normal — and misses ~1 in 5.
    const jitter = ((e.id * 7 + Math.floor(tick / 97)) % 13) - 6;
    const miss = (e.id + Math.floor(tick / 131)) % 5 === 0;
    if (atk.judgement && e.phaseFrame === e.windupLen - 3) return { press: ['dash'], move: screenMove({ x: -dir.y, y: dir.x }), aim: { ...e.pos } };
    if (!atk.judgement && !atk.projectile && !miss && e.phaseFrame === e.windupLen - 6 + jitter) return { press: ['parry'], move: { x: 0, y: 0 }, aim: { ...e.pos } };
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

export function playRoom(room: RoomDef, cfg: SimConfig, seed: number, scale?: EnemyScale) {
  const w = createWorld(room, cfg, seed, undefined, [], scale);
  w.flags.respawn = false;
  w.flags.immortal = true; // measure damage, don't stop at death
  let dmg = 0;
  let last = w.player.hp;
  for (let t = 0; t < 60 * 240; t++) {
    const b = decentBot(w, cfg, t);
    step(w, input(b), cfg);
    const hp = w.player.hp;
    if (hp < last) dmg += last - hp;
    else if (hp > last) dmg += last + (cfg.player.maxHealth - hp); // immortal refill
    last = hp;
    if (w.roomRun.cleared) return { secs: t / 60, dmg, w };
  }
  return { secs: Infinity, dmg, w };
}

