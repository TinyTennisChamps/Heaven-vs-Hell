/**
 * Generates Satan's placeholder sprite atlas in Aseprite JSON-array format.
 *   npm run sprites   ->  public/sprites/satan.png, satan_flash.png, satan.json
 *
 * Structure follows the skull-knight reference: anticipation frames, ONE strike
 * frame carrying the smear, then follow-through/recovery frames. Heavy slash3
 * borrows Hero Knight's held overhead wind-up. Three facings are drawn
 * (down, up, right); left is right mirrored at render time.
 *
 * Replace with real Aseprite exports by keeping the same tag names.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Canvas, writePng } from './raster';

// --- Palette (Visual Direction PDF, "Satan only") ---
const C = {
  hellfire: 0xff4a3d,
  crimson: 0xd3122a,
  blood: 0x8a0a1e,
  lava: 0x4a0612,
  ember: 0xff8a3d,
  outline: 0x1a0e14,
  cloak: 0x2e1c26,
  cloakHi: 0x4a3040,
  horn: 0x483a48,
  eye: 0xffe9a8,
  steel: 0x1a0e14,
  steelHi: 0x6a5a6a,
};

const FW = 64;
const FH = 64;
/** Feet anchor inside each frame. */
const FOOT_X = 32;
const FOOT_Y = 56;

type Dir = 'down' | 'up' | 'right';
const FACE: Record<Dir, number> = { right: 0, down: 90, up: -90 };
const REST: Record<Dir, number> = { right: 115, down: 75, up: 105 };

interface Pose {
  bob?: number; // + = lower
  crouch?: number; // + = lower upper body
  lean?: number; // toward facing (px)
  flare?: number; // 0..1 cape/wings spread
  blade: number; // absolute screen angle in degrees (0 = right, 90 = down)
  reach?: number; // hand distance from shoulder
  handUp?: number; // raise the shoulder/hand (overhead)
  trailFrom?: number; // draw a smear from this blade angle to `blade`
  stride?: number; // -1..1 leg phase
  glint?: boolean;
  tremble?: number;
  /** Hellfire orb in the off hand: 'back' (wind-up) or 'fwd' (release). */
  orb?: 'back' | 'fwd';
}

const rad = (d: number) => (d * Math.PI) / 180;
const dirv = (d: number) => ({ x: Math.cos(rad(d)), y: Math.sin(rad(d)) });

/** Shortest signed sweep a -> b in degrees. */
function sweep(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function drawFrame(dir: Dir, p: Pose): Canvas {
  const body = new Canvas(FW, FH);
  const fx = new Canvas(FW, FH);
  const bob = (p.bob ?? 0) + (p.crouch ?? 0);
  const y0 = FOOT_Y; // feet stay planted
  const u = FOOT_Y + bob; // upper-body baseline
  const side = dir === 'right';
  const lean = (p.lean ?? 0) * (side ? 1 : 0);
  const leanY = (p.lean ?? 0) * (dir === 'down' ? 0.5 : dir === 'up' ? -0.5 : 0);
  const tx = FOOT_X + lean + (p.tremble ?? 0);
  const ty = u + leanY;
  const flare = p.flare ?? 0;

  // Sword-arm shoulder and hand.
  const sh = side ? { x: tx + 1, y: ty - 29 - (p.handUp ?? 0) } : { x: tx + 5, y: ty - 29 - (p.handUp ?? 0) };
  const reach = p.reach ?? 5;
  const bd = dirv(p.blade);
  const hand = { x: sh.x + bd.x * reach, y: sh.y + bd.y * reach };
  const BLADE = 17;
  const tip = { x: hand.x + bd.x * BLADE, y: hand.y + bd.y * BLADE };

  const behind = dir === 'up' ? bd.y < 0.35 : side ? bd.x < -0.25 && bd.y < 0.3 : bd.y < -0.55;

  // --- Wings / bat-cloak behind the body ---
  const wing = (sx: number, m: number) => {
    // m = +1 right wing, -1 left wing (screen)
    const s = (v: number) => sx + v * m;
    const top = ty - 31 - flare * 3;
    body.poly(
      [
        [s(0), ty - 29],
        [s(7 + flare * 4), top - 3],
        [s(12 + flare * 5), top + 2],
        [s(11 + flare * 4), ty - 18],
        [s(9 + flare * 3), ty - 14],
        [s(7), ty - 17],
        [s(5), ty - 11],
        [s(2), ty - 15],
      ],
      C.cloak,
    );
    // Blood-red lining along the inner edge, visible when spread.
    body.line(s(3), ty - 26, s(8 + flare * 3), top + 1, C.blood);
    if (flare > 0.3) body.line(s(4), ty - 22, s(9 + flare * 3), ty - 19, C.blood);
    body.set(s(7 + flare * 4), top - 3, C.cloakHi);
  };

  const drawBlade = () => {
    const n = { x: -bd.y, y: bd.x };
    // Obsidian blade (2px wide) with a hellfire edge on the leading side.
    const b0 = { x: hand.x + bd.x * 2, y: hand.y + bd.y * 2 };
    body.line(b0.x, b0.y, tip.x, tip.y, C.steel, 1);
    body.line(b0.x - n.x, b0.y - n.y, tip.x - n.x - bd.x * 2, tip.y - n.y - bd.y * 2, C.steelHi, 1);
    body.line(b0.x + n.x, b0.y + n.y, tip.x + n.x - bd.x, tip.y + n.y - bd.y, C.hellfire, 1);
    body.set(tip.x, tip.y, C.ember);
    // Crossguard and pommel.
    body.line(hand.x + bd.x - n.x * 2, hand.y + bd.y - n.y * 2, hand.x + bd.x + n.x * 2, hand.y + bd.y + n.y * 2, C.horn, 1);
    body.set(hand.x - bd.x * 2, hand.y - bd.y * 2, C.horn);
    if (p.glint) {
      const g = { x: hand.x + bd.x * 8, y: hand.y + bd.y * 8 };
      fx.set(g.x, g.y, 0xffffff);
      fx.set(g.x - 1, g.y, 0xffffff);
      fx.set(g.x + 1, g.y, 0xffffff);
      fx.set(g.x, g.y - 1, 0xffffff);
      fx.set(g.x, g.y + 1, 0xffffff);
      fx.set(g.x - 2, g.y, C.eye);
      fx.set(g.x + 2, g.y, C.eye);
      fx.set(g.x, g.y - 2, C.eye);
      fx.set(g.x, g.y + 2, C.eye);
    }
  };

  const drawArm = () => {
    body.line(sh.x, sh.y, hand.x, hand.y, C.crimson, 2);
    body.rect(Math.round(hand.x) - 1, Math.round(hand.y) - 1, 2, 2, C.blood);
  };

  // Legs/feet under the robe.
  const stride = p.stride ?? 0;
  const drawFeet = () => {
    if (side) {
      body.rect(tx - 3 + Math.round(stride * 3), y0 - 2, 3, 2, C.outline);
      body.rect(tx + 1 - Math.round(stride * 3), y0 - 2, 3, 2, C.outline);
    } else {
      body.rect(tx - 4, y0 - 2 - (stride > 0 ? 1 : 0), 3, 2, C.outline);
      body.rect(tx + 1, y0 - 2 - (stride < 0 ? 1 : 0), 3, 2, C.outline);
    }
  };

  const drawSkirt = () => {
    const hw = side ? 5 : 7;
    const sway = side ? -Math.round(flare * 3) : 0;
    body.poly(
      [
        [tx - hw + 1, ty - 18],
        [tx + hw, ty - 18],
        [tx + hw + 2 + (side ? 0 : 0), y0 - 1],
        [tx + 2, y0 - 3],
        [tx - hw - 2 + sway, y0 - 1],
      ],
      C.cloak,
    );
    if (!side && dir === 'down') {
      body.line(tx - 1, ty - 17, tx - 2, y0 - 3, C.blood);
      body.line(tx + 1, ty - 17, tx + 2, y0 - 3, C.blood);
    }
    if (side) body.line(tx - hw + 1, ty - 16, tx - hw - 1 + sway, y0 - 2, C.blood);
  };

  const drawTorso = () => {
    if (dir === 'up') {
      body.rect(tx - 5, ty - 30, 11, 12, C.blood);
      body.rect(tx - 4, ty - 29, 9, 10, C.crimson);
      body.line(tx, ty - 29, tx, ty - 20, C.blood);
      return;
    }
    // V-shaped torso: broad shoulders tapering to the belt.
    if (!side) {
      body.poly([[tx - 7, ty - 31], [tx + 8, ty - 31], [tx + 6, ty - 18], [tx - 5, ty - 18]], C.crimson);
      body.rect(tx - 7, ty - 31, 3, 3, C.blood); // shoulder caps
      body.rect(tx + 5, ty - 31, 3, 3, C.blood);
      body.line(tx, ty - 27, tx, ty - 20, C.blood);
      body.line(tx - 3, ty - 27, tx - 1, ty - 26, C.blood);
      body.line(tx + 1, ty - 26, tx + 3, ty - 27, C.blood);
      body.set(tx - 2, ty - 23, C.blood);
      body.set(tx + 2, ty - 23, C.blood);
      body.set(tx - 2, ty - 21, C.blood);
      body.set(tx + 2, ty - 21, C.blood);
      body.rect(tx - 4, ty - 31, 9, 1, C.hellfire);
      body.rect(tx - 5, ty - 19, 11, 2, C.horn); // belt
      body.set(tx, ty - 19, C.ember);
    } else {
      body.poly([[tx - 4, ty - 31], [tx + 5, ty - 31], [tx + 4, ty - 18], [tx - 3, ty - 18]], C.crimson);
      body.rect(tx - 4, ty - 31, 4, 3, C.blood); // near shoulder
      body.line(tx + 4, ty - 29, tx + 3, ty - 20, C.blood); // chest edge
      body.set(tx + 2, ty - 25, C.blood);
      body.rect(tx - 3, ty - 31, 7, 1, C.hellfire);
      body.rect(tx - 3, ty - 19, 8, 2, C.horn);
    }
  };

  const drawHead = () => {
    const hx = side ? tx - 2 : tx - 4;
    const hw = side ? 7 : 8;
    const hy = ty - 39;
    body.rect(hx, hy, hw, 8, C.crimson);
    // Round the skull and taper the jaw.
    body.set(hx, hy, -1);
    body.set(hx + hw - 1, hy, -1);
    body.set(hx, hy + 7, -1);
    body.set(hx + hw - 1, hy + 7, -1);
    body.rect(hx + 1, hy + 7, hw - 2, 1, C.blood); // jaw
    body.rect(hx + (side ? 0 : 1), hy + 6, 1, 1, C.blood);
    if (dir === 'down') {
      body.rect(hx + 1, hy + 3, 2, 1, C.eye);
      body.rect(hx + 5, hy + 3, 2, 1, C.eye);
      body.rect(hx + 1, hy + 2, 6, 1, C.blood); // brow
      body.rect(hx + 3, hy + 5, 2, 1, C.lava); // mouth
    } else if (side) {
      body.rect(hx + 4, hy + 3, 2, 1, C.eye);
      body.rect(hx + 3, hy + 2, 4, 1, C.blood);
      body.set(hx + 6, hy + 5, C.lava);
    } else {
      body.rect(hx + 1, hy + 1, 6, 1, C.hellfire);
    }
    // Horns: sweep up and out.
    const horn = (bx: number, m: number) => {
      body.set(bx, hy - 1, C.horn);
      body.set(bx + m, hy - 2, C.horn);
      body.set(bx + m, hy - 3, C.horn);
      body.set(bx + 2 * m, hy - 4, C.horn);
      body.set(bx + 2 * m, hy - 5, C.outline);
      body.set(bx + m, hy - 1, C.horn);
    };
    if (side) {
      horn(hx + 4, 1);
      horn(hx + 1, -1);
    } else {
      horn(hx + 1, -1);
      horn(hx + hw - 2, 1);
    }
  };

  const drawOffArm = () => {
    if (side) return;
    const ox = tx - 7;
    body.rect(ox, ty - 29, 2, 9 - Math.round(flare * 2), C.crimson);
    body.rect(ox, ty - 21 - Math.round(flare * 2), 2, 2, C.blood);
  };

  // ---- Composite in depth order ----
  if (dir === 'up') {
    if (behind) {
      drawArm();
      drawBlade();
    }
    drawFeet();
    drawSkirt();
    drawTorso();
    drawHead();
    wing(tx - 3, -1);
    wing(tx + 3, 1);
    drawOffArm();
    if (!behind) {
      drawArm();
      drawBlade();
    }
  } else {
    if (side) wing(tx - 2, -1);
    else {
      wing(tx - 4, -1);
      wing(tx + 4, 1);
    }
    if (behind) {
      drawArm();
      drawBlade();
    }
    drawFeet();
    drawSkirt();
    drawTorso();
    drawHead();
    drawOffArm();
    if (!behind) {
      drawArm();
      drawBlade();
    }
  }
  body.outline(C.outline);

  // ---- Smear (not outlined): tapered crescent swept by the blade tip ----
  if (p.trailFrom !== undefined) {
    const s = sweep(p.trailFrom, p.blade);
    const steps = Math.max(4, Math.ceil(Math.abs(s) / 6));
    const R = reach + BLADE + 1;
    const outer: [number, number][] = [];
    const inner: [number, number][] = [];
    const mid: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = rad(p.trailFrom + s * t);
      // Fat crescent like the reference: thin tail, swelling toward the blade.
      const thick = 1 + 10 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.05)) * (0.35 + 0.65 * t);
      outer.push([sh.x + Math.cos(a) * (R + 1), sh.y + Math.sin(a) * (R + 1)]);
      inner.push([sh.x + Math.cos(a) * (R + 1 - thick), sh.y + Math.sin(a) * (R + 1 - thick)]);
      mid.push([sh.x + Math.cos(a) * (R - thick * 0.35), sh.y + Math.sin(a) * (R - thick * 0.35)]);
    }
    fx.poly([...outer, ...inner.reverse()], C.blood);
    fx.poly([...outer, ...mid.reverse()], C.hellfire);
    // Bright core along the leading third.
    for (let i = Math.floor(steps * 0.55); i <= steps; i++) {
      const a = rad(p.trailFrom + s * (i / steps));
      fx.set(sh.x + Math.cos(a) * R, sh.y + Math.sin(a) * R, C.ember);
    }
    for (let i = Math.floor(steps * 0.4); i <= steps; i++) {
      const a = rad(p.trailFrom + s * (i / steps));
      fx.set(sh.x + Math.cos(a) * (R + 1), sh.y + Math.sin(a) * (R + 1), C.eye);
    }
  }

  if (p.orb) {
    const f = dirv(FACE[dir]);
    const k = p.orb === 'fwd' ? 10 : -7;
    const ox = Math.round(tx + f.x * k + (dir === 'right' ? 0 : -3));
    const oy = Math.round(ty - 24 + f.y * k * 0.5);
    const r = p.orb === 'fwd' ? 3 : 2;
    fx.poly([[ox - r, oy], [ox, oy - r], [ox + r, oy], [ox, oy + r]], C.hellfire);
    fx.set(ox, oy, C.eye);
    if (p.orb === 'fwd') {
      fx.line(ox - Math.round(f.x * 6), oy - Math.round(f.y * 3), ox - Math.round(f.x * 2), oy - Math.round(f.y * 1), C.ember);
    }
  }

  const out = new Canvas(FW, FH);
  out.blit(body, 0, 0);
  out.blit(fx, 0, 0);
  return out;
}

// ---- Animation definitions ----
type AnimDef = { name: string; durationMs: number; poses: (dir: Dir) => Pose[] };

const slash = (sign: number, d: Dir): Pose[] => {
  const f = FACE[d];
  const A = (t: number) => f + sign * t;
  return [
    { blade: A(-80), reach: 5, lean: -1 },
    { blade: A(-110), reach: 5, lean: -1, crouch: 1, flare: 0.2 },
    { blade: A(15), reach: 7, lean: 2, crouch: 1, flare: 1, trailFrom: A(-110) },
    { blade: A(70), reach: 6, lean: 2, crouch: 1, flare: 0.6, trailFrom: A(40) },
    { blade: A(85), reach: 5, lean: 1, flare: 0.3 },
    { blade: A(50), reach: 5 },
  ];
};

const ANIMS: AnimDef[] = [
  {
    name: 'idle',
    durationMs: 160,
    poses: (d) => [0, 0, 1, 1].map((bob, i) => ({ blade: REST[d], reach: 4, bob, flare: i === 1 || i === 2 ? 0.15 : 0 })),
  },
  {
    name: 'run',
    durationMs: 90,
    poses: (d) =>
      [1, 0.5, -0.5, -1, -0.5, 0.5].map((stride, i) => ({ blade: REST[d] + (d === 'right' ? 15 : 0), reach: 4, stride, bob: i % 3 === 1 ? -1 : 0, lean: 1, flare: 0.45 })),
  },
  { name: 'slash1', durationMs: 50, poses: (d) => slash(1, d) },
  { name: 'slash2', durationMs: 50, poses: (d) => slash(-1, d) },
  {
    name: 'slash3',
    durationMs: 60,
    poses: (d) => {
      const f = FACE[d];
      const up = -90;
      return [
        { blade: up, reach: 6, handUp: 3, bob: -1, flare: 0.3 },
        { blade: up - 8, reach: 6, handUp: 4, bob: -1, flare: 0.4, tremble: 1 },
        { blade: up - 8, reach: 6, handUp: 4, bob: -1, flare: 0.5 },
        { blade: f + 15, reach: 8, crouch: 3, lean: 3, flare: 1, trailFrom: up - 8 },
        { blade: f + 40, reach: 7, crouch: 3, lean: 3, flare: 0.8 },
        { blade: f + 55, reach: 6, crouch: 2, lean: 2, flare: 0.4 },
        { blade: f + 40, reach: 5, crouch: 1, lean: 1 },
      ];
    },
  },
  {
    name: 'parry',
    durationMs: 50,
    poses: (d) => {
      const g = d === 'right' ? -70 : d === 'down' ? -40 : -140;
      return [
        { blade: g + 30, reach: 3 },
        { blade: g, reach: 3, glint: true, flare: 0.3 },
        { blade: g, reach: 3, flare: 0.2 },
        { blade: g + 20, reach: 3 },
      ];
    },
  },
  {
    name: 'throw',
    durationMs: 50,
    poses: (d) => [
      { blade: REST[d], reach: 4, lean: -1, orb: 'back' },
      { blade: REST[d], reach: 4, lean: -2, flare: 0.3, orb: 'back' },
      { blade: REST[d], reach: 4, lean: 2, flare: 0.6, orb: 'fwd' },
      { blade: REST[d], reach: 4, lean: 1, flare: 0.2 },
    ],
  },
  {
    name: 'block',
    durationMs: 100,
    poses: (d) => [{ blade: d === 'right' ? -70 : d === 'down' ? -40 : -140, reach: 3, crouch: 1 }],
  },
  {
    name: 'dash',
    durationMs: 60,
    poses: (d) => [
      { blade: REST[d] + (d === 'right' ? 45 : 0), reach: 4, crouch: 2, lean: 3, flare: 1, stride: 1 },
      { blade: REST[d] + (d === 'right' ? 45 : 0), reach: 4, crouch: 1, lean: 2, flare: 0.8, stride: -1 },
    ],
  },
  {
    name: 'hurt',
    durationMs: 80,
    poses: (d) => [
      { blade: REST[d] - 20, reach: 4, lean: -2, crouch: 1, flare: 0.5, tremble: -1 },
      { blade: REST[d] - 10, reach: 4, lean: -1, crouch: 1, flare: 0.3 },
    ],
  },
];

// ---- Pack atlas ----
const DIRS: Dir[] = ['down', 'up', 'right'];
const frames: { name: string; canvas: Canvas; dur: number }[] = [];
const tags: { name: string; from: number; to: number; direction: string }[] = [];
for (const a of ANIMS) {
  for (const d of DIRS) {
    const from = frames.length;
    a.poses(d).forEach((p, i) => frames.push({ name: `${a.name}_${d} ${i}`, canvas: drawFrame(d, p), dur: a.durationMs }));
    tags.push({ name: `${a.name}_${d}`, from, to: frames.length - 1, direction: 'forward' });
  }
}

const COLS = 12;
const rows = Math.ceil(frames.length / COLS);
const atlas = new Canvas(COLS * FW, rows * FH);
const json = {
  frames: frames.map((f, i) => {
    const x = (i % COLS) * FW;
    const y = Math.floor(i / COLS) * FH;
    atlas.blit(f.canvas, x, y);
    return { filename: f.name, frame: { x, y, w: FW, h: FH }, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: FW, h: FH }, sourceSize: { w: FW, h: FH }, duration: f.dur };
  }),
  meta: {
    app: 'heaven-vs-hell/tools/sprites/genSatan.ts',
    image: 'satan.png',
    format: 'RGBA8888',
    size: { w: atlas.w, h: atlas.h },
    scale: '1',
    frameTags: tags,
    pivot: { x: FOOT_X, y: FOOT_Y },
  },
};

const outDir = path.resolve(import.meta.dirname ?? __dirname, '../../public/sprites');
fs.mkdirSync(outDir, { recursive: true });
writePng(path.join(outDir, 'satan.png'), atlas);
writePng(path.join(outDir, 'satan_flash.png'), atlas, () => 0xffffff);
fs.writeFileSync(path.join(outDir, 'satan.json'), JSON.stringify(json, null, 1) + '\n');
console.log(`satan atlas: ${frames.length} frames, ${tags.length} tags, ${atlas.w}x${atlas.h}`);

// Preview sheet for humans: each tag on its own row at 4x.
if (process.argv.includes('--preview')) {
  const Z = 4;
  const onlyIdx = process.argv.indexOf('--only');
  const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1]!.split(',') : null;
  const shown = only ? tags.filter((t) => only.includes(t.name)) : tags;
  const maxLen = Math.max(...shown.map((t) => t.to - t.from + 1));
  const prev = new Canvas(maxLen * FW * Z, shown.length * FH * Z);
  shown.forEach((t, row) => {
    for (let i = t.from; i <= t.to; i++) {
      const f = frames[i]!.canvas;
      for (let y = 0; y < FH; y++)
        for (let x = 0; x < FW; x++) {
          const c = f.px[y * FW + x]!;
          const bg = ((x >> 2) + (y >> 2)) % 2 ? 0xe3d9c2 : 0xf4eedf;
          prev.rect(((i - t.from) * FW + x) * Z, (row * FH + y) * Z, Z, Z, c === -1 ? bg : c);
        }
    }
  });
  const pv = process.argv[process.argv.indexOf('--preview') + 1]!;
  writePng(pv, prev);
  console.log('preview ->', pv);
}
