import { Container, Graphics } from 'pixi.js';
import { GROUND_TILE, groundToScreen } from '../../core/iso';
import type { Vec2 } from '../../core/math';
import { TALL_WALLS, type BiomeDef, type PropDef, type WallKind } from '../../sim/config';
import { pointInPolygon } from '../../sim/physics/collide';
import type { World } from '../../sim/world';
import { decoRng, hex, proj } from './geom';

/**
 * Everything that dresses a room, driven by its biome: the floor and its edge
 * (a gold lip over clouds outdoors; back walls with stained glass indoors),
 * walls by kind, and props (braziers, candelabras, windows, frieze eyes,
 * banners). Walls and props join the depth-sorted entity layer; tall ones fade
 * when something stands behind them so they never hide gameplay.
 * Also reports this frame's light sources for the lighting pass.
 *
 * Asset slots (placeholders drawn here until real sprites exist):
 * floor_<biome>, lip_<biome>, backwall_<biome>, window_<glass>, column,
 * pew, altar, apse, pillar, hedge, fountain, brazier, candelabra, eyes, banner.
 */
const WALL_H: Record<WallKind, number> = { pillar: 30, hedge: 10, fountain: 7, column: 52, pew: 9, altar: 11, apse: 44 };
const LIP_H = 8;
const BACK_WALL_H = 70;

export interface LightSource {
  /** Screen position (world layer coordinates). */
  x: number;
  y: number;
  radius: number;
  color: number;
  alpha: number;
}

interface Tall {
  g: Graphics;
  box: { minX: number; maxX: number; minY: number; maxY: number };
  z: number;
}

export class RoomArt {
  /** Background layer (back walls, floor) — under everything. */
  readonly floor = new Graphics();
  /** Light shafts and zone pools: additive, over the floor, under entities. */
  readonly shafts = new Graphics();
  /** Per-frame bits: flames, eyes, banners. Over entities (thin, small). */
  readonly dyn = new Graphics();
  private talls: Tall[] = [];
  /** Walls and props in the entity layer (shaded to match the room's light). */
  private statics: Graphics[] = [];
  private flames: { at: Vec2; lift: number; size: number }[] = [];
  private eyes: Vec2[] = [];
  private banners: Vec2[] = [];
  private windowShafts: { pts: number[]; color: number; floor: Vec2 }[] = [];
  /** Indoor front edges: a low marble balustrade (drawn over the floor edge, in front of everything near it). */
  private balustrades: [Vec2, Vec2][] = [];
  private col: (k: string, fb?: number) => number;

  constructor(
    private world: World,
    private biome: BiomeDef,
    entities: Container,
  ) {
    const all = { ...biome.palette, ...biome.accents };
    this.col = (k, fb = 0xff00ff) => hex(all[k], fb);
    this.drawFloor();
    this.drawWalls(entities);
    this.drawBalustrades(entities);
    for (const p of world.room.props ?? []) this.addProp(p, entities);
    this.shafts.blendMode = 'add';
  }

  // ------------------------------------------------------------------ static

  private drawFloor(): void {
    const g = this.floor;
    const room = this.world.room;
    const b = room.bounds;
    const C = this.col;
    const indoor = this.biome.indoor;

    // Edges: back edges (facing away from the camera) get tall walls indoors; front edges a lip.
    for (let i = 0; i < b.length; i++) {
      const p = b[i]!;
      const q = b[(i + 1) % b.length]!;
      const sp = groundToScreen(p[0], p[1]);
      const sq = groundToScreen(q[0], q[1]);
      const n = outward(b, p, q);
      const back = n.x + n.y < 0;
      if (indoor && back) {
        const lit = n.x < n.y; // walls whose normal points -x catch more light
        g.poly([sp.x, sp.y, sq.x, sq.y, sq.x, sq.y - BACK_WALL_H, sp.x, sp.y - BACK_WALL_H]).fill(lit ? C('backWall') : C('backWallShade'));
        // Gilded pilasters every ~48 px and a cornice.
        const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
        for (let d = 24; d < len - 8; d += 48) {
          const t = d / len;
          const s = groundToScreen(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t);
          g.rect(Math.round(s.x) - 1, Math.round(s.y - BACK_WALL_H), 3, BACK_WALL_H).fill({ color: C('wallTrim'), alpha: 0.55 });
        }
        g.moveTo(sp.x, sp.y - BACK_WALL_H).lineTo(sq.x, sq.y - BACK_WALL_H).stroke({ width: 2, color: C('wallTop') });
        g.moveTo(sp.x, sp.y - 2).lineTo(sq.x, sq.y - 2).stroke({ width: 1, color: C('wallTrim') });
      } else if (!back) {
        g.poly([sp.x, sp.y, sq.x, sq.y, sq.x, sq.y + LIP_H, sp.x, sp.y + LIP_H]).fill(C('lip'));
        g.poly([sp.x, sp.y + LIP_H - 2, sq.x, sq.y + LIP_H - 2, sq.x, sq.y + LIP_H, sp.x, sp.y + LIP_H]).fill(C('lipDark'));
        if (indoor) this.balustrades.push([sp, sq]);
      }
    }

    // Checker tiles (16×16 ground → 32×16 diamonds).
    const xs = b.map((p) => p[0]);
    const ys = b.map((p) => p[1]);
    const T = GROUND_TILE;
    for (let gy = Math.min(...ys); gy < Math.max(...ys); gy += T) {
      for (let gx = Math.min(...xs); gx < Math.max(...xs); gx += T) {
        if (!pointInPolygon(gx + T / 2, gy + T / 2, b)) continue;
        const i = Math.round(gx / T);
        const j = Math.round(gy / T);
        g.poly(proj([[gx, gy], [gx + T, gy], [gx + T, gy + T], [gx, gy + T]])).fill((i + j) % 2 === 0 ? C('floorA') : C('floorB'));
      }
    }
    // Gold inlay border one tile in (rectangular rooms), or a gold aisle down the long axis indoors.
    const rect = b.length === 4;
    if (rect) {
      const inset = b.map(([x, y]) => [x + (x === Math.min(...xs) ? T : -T), y + (y === Math.min(...ys) ? T : -T)] as const);
      g.poly(proj(inset)).stroke({ width: 1, color: C('inlay'), alpha: 0.9 });
    }
    if (indoor) {
      // The aisle: twin gold lines along the longer axis, through the middle.
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
      const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      const lines: [number, number, number, number][] = w >= h ? [[Math.min(...xs) + T, cy - 10, Math.max(...xs) - T, cy - 10], [Math.min(...xs) + T, cy + 10, Math.max(...xs) - T, cy + 10]] : [[cx - 10, Math.min(...ys) + T, cx - 10, Math.max(...ys) - T], [cx + 10, Math.min(...ys) + T, cx + 10, Math.max(...ys) - T]];
      for (const [x0, y0, x1, y1] of lines) {
        if (!pointInPolygon(x0, y0, b) || !pointInPolygon(x1, y1, b)) continue;
        const a = groundToScreen(x0, y0);
        const c = groundToScreen(x1, y1);
        g.moveTo(a.x, a.y).lineTo(c.x, c.y).stroke({ width: 1, color: C('inlay'), alpha: 0.7 });
      }
    }
    g.poly(proj(b)).stroke({ width: 1, color: C('rim') });
  }

  private drawWalls(entities: Container): void {
    const room = this.world.room;
    const C = this.col;
    room.walls.forEach((wall, wi) => {
      const kind: WallKind = room.wallKinds?.[wi] ?? 'pillar';
      const H = WALL_H[kind];
      const pc = new Graphics();
      const cx = wall.reduce((s, p) => s + p[0], 0) / wall.length;
      const cy = wall.reduce((s, p) => s + p[1], 0) / wall.length;
      for (let i = 0; i < wall.length; i++) {
        const p = wall[i]!;
        const q = wall[(i + 1) % wall.length]!;
        // Outward ground normal; only faces pointing toward the camera (+gx+gy) are visible.
        let nx = q[1] - p[1];
        let ny = -(q[0] - p[0]);
        const mx = (p[0] + q[0]) / 2 - cx;
        const my = (p[1] + q[1]) / 2 - cy;
        if (nx * mx + ny * my < 0) {
          nx = -nx;
          ny = -ny;
        }
        if (nx + ny <= 0) continue;
        const sp = groundToScreen(p[0], p[1]);
        const sq = groundToScreen(q[0], q[1]);
        const lit = nx > ny;
        const shade =
          kind === 'hedge' ? (lit ? C('hedge') : C('hedgeDark')) : kind === 'pew' ? (lit ? C('pewTop') : C('pewSide')) : kind === 'altar' ? (lit ? C('altar') : C('wallShade')) : kind === 'apse' ? (lit ? C('apse') : C('wallShade')) : lit ? C('wallLit') : C('wallShade');
        pc.poly([sp.x, sp.y, sq.x, sq.y, sq.x, sq.y - H, sp.x, sp.y - H]).fill(shade);
        if (kind !== 'hedge' && kind !== 'pew') pc.moveTo(sp.x, sp.y - 3).lineTo(sq.x, sq.y - 3).stroke({ width: 1, color: C('wallTrim') });
        if (kind === 'column') {
          // Fluting and a gilded capital band.
          for (const t of [0.33, 0.66]) {
            const fx = sp.x + (sq.x - sp.x) * t;
            const fy = sp.y + (sq.y - sp.y) * t;
            pc.moveTo(Math.round(fx), Math.round(fy - 4)).lineTo(Math.round(fx), Math.round(fy - H + 6)).stroke({ width: 1, color: C('wallShade'), alpha: 0.6 });
          }
          pc.poly([sp.x, sp.y - H + 6, sq.x, sq.y - H + 6, sq.x, sq.y - H, sp.x, sp.y - H]).fill(C('wallTop'));
        }
      }
      if (kind === 'hedge') {
        pc.poly(proj(wall, H)).fill(C('hedgeTop')).stroke({ width: 1, color: C('hedgeDark') });
        const xs = wall.map((p) => p[0]);
        const ys = wall.map((p) => p[1]);
        const rnd = decoRng(wi * 97 + 13);
        for (let gx = Math.min(...xs) + 4; gx < Math.max(...xs) - 2; gx += 7) {
          for (let gy = Math.min(...ys) + 3; gy < Math.max(...ys) - 2; gy += 6) {
            if (rnd() > 0.34) continue;
            const s = groundToScreen(gx + rnd() * 3, gy);
            pc.rect(Math.round(s.x), Math.round(s.y - H), 1, 1).fill(C('blossom', 0xffffff));
          }
        }
      } else if (kind === 'fountain') {
        pc.poly(proj(wall, H)).fill(C('basin')).stroke({ width: 1, color: C('wallTrim') });
        const inner = wall.map(([x, y]) => [x + (x < cx ? 3 : -3), y + (y < cy ? 3 : -3)] as const);
        pc.poly(proj(inner, H)).fill(C('water'));
        const c = groundToScreen(cx, cy);
        pc.rect(Math.round(c.x) - 1, Math.round(c.y - H - 10), 3, 10).fill(C('wallLit'));
        pc.rect(Math.round(c.x) - 3, Math.round(c.y - H - 12), 7, 2).fill(C('wallTop'));
      } else if (kind === 'pew') {
        // Seat top and a backrest rail.
        pc.poly(proj(wall, H)).fill(C('pewTop')).stroke({ width: 1, color: C('pewSide') });
        const xs = wall.map((p) => p[0]);
        const ys = wall.map((p) => p[1]);
        const along = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
        const a = along ? groundToScreen(Math.min(...xs), Math.min(...ys)) : groundToScreen(Math.min(...xs), Math.min(...ys));
        const z = along ? groundToScreen(Math.max(...xs), Math.min(...ys)) : groundToScreen(Math.min(...xs), Math.max(...ys));
        pc.moveTo(a.x, a.y - H - 4).lineTo(z.x, z.y - H - 4).stroke({ width: 2, color: C('pewSide') });
      } else if (kind === 'altar') {
        pc.poly(proj(wall, H)).fill(C('altar')).stroke({ width: 1, color: C('wallTrim') });
        const c = groundToScreen(cx, cy);
        pc.rect(Math.round(c.x) - 8, Math.round(c.y - H - 1), 16, 2).fill(C('inlay'));
      } else {
        pc.poly(proj(wall, H)).fill(C('wallTop')).stroke({ width: 1, color: C('wallTrim') });
      }
      pc.zIndex = cx + cy;
      entities.addChild(pc);
      this.statics.push(pc);
      if (TALL_WALLS.includes(kind)) {
        const pts = proj(wall, 0);
        const ptsTop = proj(wall, H);
        const xsS = [...pts.filter((_, i) => i % 2 === 0)];
        const ysS = [...pts.filter((_, i) => i % 2 === 1), ...ptsTop.filter((_, i) => i % 2 === 1)];
        this.talls.push({ g: pc, box: { minX: Math.min(...xsS), maxX: Math.max(...xsS), minY: Math.min(...ysS), maxY: Math.max(...ysS) }, z: cx + cy });
      }
    });
  }

  private drawBalustrades(entities: Container): void {
    const C = this.col;
    for (const [a, b] of this.balustrades) {
      const g = new Graphics();
      const H = 7;
      g.poly([a.x, a.y, b.x, b.y, b.x, b.y - H, a.x, a.y - H]).fill({ color: C('wallLit'), alpha: 0.85 });
      // Balusters.
      const n = Math.max(2, Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / 6));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const x = Math.round(a.x + (b.x - a.x) * t);
        const y = Math.round(a.y + (b.y - a.y) * t);
        g.rect(x, y - H + 2, 1, H - 2).fill({ color: C('wallShade'), alpha: 0.9 });
      }
      g.moveTo(a.x, a.y - H).lineTo(b.x, b.y - H).stroke({ width: 1, color: C('wallTop') });
      // In front of anything standing just inside the edge.
      g.zIndex = 1e6;
      entities.addChild(g);
      this.statics.push(g);
    }
  }

  private addProp(p: PropDef, entities: Container): void {
    const C = this.col;
    const at = { x: p.at[0], y: p.at[1] };
    const s = groundToScreen(at.x, at.y);
    const g = new Graphics();
    switch (p.kind) {
      case 'brazier':
        // A gilded bowl on a stand; the white-blue flame is animated in update().
        g.rect(Math.round(s.x) - 1, Math.round(s.y) - 12, 3, 12).fill(C('wallTrim'));
        g.ellipse(Math.round(s.x), Math.round(s.y) - 13, 6, 2.5).fill(C('wallTop')).stroke({ width: 1, color: C('wallTrim') });
        g.ellipse(Math.round(s.x), Math.round(s.y), 5, 2).fill({ color: C('lipDark'), alpha: 0.4 });
        this.flames.push({ at, lift: 15, size: 4 });
        break;
      case 'candelabra':
        g.rect(Math.round(s.x), Math.round(s.y) - 16, 1, 16).fill(C('wallTrim'));
        g.rect(Math.round(s.x) - 5, Math.round(s.y) - 16, 11, 1).fill(C('wallTrim'));
        for (const dx of [-5, 0, 5]) {
          g.rect(Math.round(s.x) + dx, Math.round(s.y) - 19, 1, 3).fill(C('basin', 0xffffff));
          this.flames.push({ at: { x: at.x + dx / 2, y: at.y - dx / 2 }, lift: 21, size: 1.5 });
        }
        break;
      case 'window': {
        // An arched stained-glass window on a back wall, and the shaft of coloured light it throws.
        const glass = C(p.glass ?? 'glassBlue');
        const w = 12;
        const top = s.y - BACK_WALL_H + 10;
        const bot = s.y - 16;
        const x = Math.round(s.x);
        this.floor.rect(x - w / 2, top + 6, w, bot - top - 6).fill({ color: glass, alpha: 0.85 });
        this.floor.ellipse(x, top + 6, w / 2, 6).fill({ color: glass, alpha: 0.85 });
        // Lead lines.
        this.floor.moveTo(x, top).lineTo(x, bot).stroke({ width: 1, color: C('wallTrim') });
        this.floor.moveTo(x - w / 2, (top + bot) / 2).lineTo(x + w / 2, (top + bot) / 2).stroke({ width: 1, color: C('wallTrim') });
        this.floor.rect(x - w / 2, top + 6, w, bot - top - 6).stroke({ width: 1, color: C('wallTrim') });
        // Shaft: from the window down and into the room (toward +gx+gy).
        const inward = p.wall === 'w' ? { x: 1, y: 0 } : { x: 0, y: 1 };
        const fl = { x: at.x + inward.x * 64, y: at.y + inward.y * 64 };
        const f = groundToScreen(fl.x, fl.y);
        const side = p.wall === 'w' ? { x: 0, y: 9 } : { x: 9, y: 0 };
        const fa = groundToScreen(fl.x - side.x, fl.y - side.y);
        const fb = groundToScreen(fl.x + side.x, fl.y + side.y);
        this.windowShafts.push({ pts: [x - w / 2, top + 8, x + w / 2, top + 8, fb.x, fb.y, fa.x, fa.y], color: glass, floor: { x: f.x, y: f.y } });
        return;
      }
      case 'eyes':
        // A carved frieze eye on the back wall; its pupil tracks Satan (update()).
        this.eyes.push({ x: s.x, y: s.y - BACK_WALL_H + 8 });
        return;
      case 'banner':
        this.banners.push({ x: s.x, y: s.y - BACK_WALL_H + 4 });
        return;
      default:
        return;
    }
    g.zIndex = at.x + at.y;
    entities.addChild(g);
    this.statics.push(g);
  }

  /** Darken walls and props toward the room's darkness colour (Satan and enemies are never shaded). */
  setShade(darkness: number, amount: number): void {
    const mix = (a: number, b: number, k: number) => Math.round(a + (b - a) * k);
    const r = mix(255, (darkness >> 16) & 255, amount);
    const g = mix(255, (darkness >> 8) & 255, amount);
    const b = mix(255, darkness & 255, amount);
    const tint = (r << 16) | (g << 8) | b;
    for (const s of this.statics) s.tint = tint;
  }

  /** Where ambient life emits from: flames (smoke) and light pools (motes). */
  emitPoints(world: World): { flames: { x: number; y: number }[]; pools: { x: number; y: number }[] } {
    const flames = this.flames.map((f) => {
      const s = groundToScreen(f.at.x, f.at.y);
      return { x: s.x, y: s.y - f.lift };
    });
    const pools = [...this.windowShafts.map((w) => w.floor), ...world.zones.list.map((z) => groundToScreen(z.pos.x, z.pos.y))];
    return { flames, pools };
  }

  // ------------------------------------------------------------------ per frame

  /** Animate flames, eyes and banners; fade tall walls something stands behind; draw shafts and zones. */
  update(world: World, tick: number, opts: { shaftsOff: boolean; zones: boolean; warn?: boolean; hazards?: boolean }): void {
    const C = this.col;
    const d = this.dyn;
    d.clear();
    const flick = (i: number) => Math.sin(tick * 0.4 + i * 1.7) + Math.sin(tick * 0.23 + i * 2.9);
    this.flames.forEach((f, i) => {
      const s = groundToScreen(f.at.x, f.at.y);
      const h = Math.round(f.size * 2 + flick(i));
      const x = Math.round(s.x);
      const y = Math.round(s.y - f.lift);
      d.poly([x - f.size, y, x + f.size, y, x, y - h - f.size * 2]).fill({ color: C('flame'), alpha: 0.85 });
      d.rect(x, y - h, 1, h).fill(C('flameCore', 0xffffff));
    });
    // Frieze eyes: almond shapes on the wall, pupils turned toward Satan.
    const ps = groundToScreen(world.player.pos.x, world.player.pos.y);
    for (const e of this.eyes) {
      d.ellipse(Math.round(e.x), Math.round(e.y), 5, 2.5).fill(C('eye')).stroke({ width: 1, color: C('wallTrim') });
      const dx = Math.max(-2, Math.min(2, (ps.x - e.x) / 60));
      const dy = Math.max(-1, Math.min(1, (ps.y - e.y) / 80));
      d.rect(Math.round(e.x + dx), Math.round(e.y + dy) - 1, 1, 2).fill(C('pupil'));
    }
    // Banners sway.
    this.banners.forEach((b, i) => {
      const sw = Math.round(Math.sin(tick * 0.05 + i) * 2);
      d.poly([b.x - 4, b.y, b.x + 4, b.y, b.x + 4 + sw, b.y + 18, b.x + sw, b.y + 22, b.x - 4 + sw, b.y + 18]).fill({ color: C('glassLilac', 0xbba8e0), alpha: 0.7 });
      d.rect(Math.round(b.x) - 5, Math.round(b.y), 10, 1).fill(C('wallTrim'));
    });

    // Tall walls fade when Satan or an enemy is behind them.
    const bodies: { x: number; y: number; z: number }[] = [{ ...ps, z: world.player.pos.x + world.player.pos.y }];
    for (const e of world.enemies) if (e.phase !== 'down') {
      const s = groundToScreen(e.pos.x, e.pos.y);
      bodies.push({ x: s.x, y: s.y, z: e.pos.x + e.pos.y });
    }
    for (const t of this.talls) {
      const hidden = bodies.some((b) => b.z < t.z && b.x > t.box.minX - 4 && b.x < t.box.maxX + 4 && b.y > t.box.minY && b.y - 30 < t.box.maxY);
      t.g.alpha += ((hidden ? 0.4 : 1) - t.g.alpha) * 0.25;
    }

    // Light shafts from the windows (additive), dimmed by set-pieces.
    const sh = this.shafts;
    sh.clear();
    if (!opts.shaftsOff) for (const w of this.windowShafts) sh.poly(w.pts).fill({ color: w.color, alpha: 0.14 });
    // Sanctified light pools.
    if (opts.zones) {
      const Z = world.zones;
      for (const z of Z.list) {
        const s = groundToScreen(z.pos.x, z.pos.y);
        const k = z.intensity;
        if (k <= 0.02) continue;
        const color = C(z.glass ?? 'glassGold', 0xf1da94);
        for (const [rm, a] of [[1, 0.1], [0.72, 0.1], [0.45, 0.12]] as const) sh.ellipse(Math.round(s.x), Math.round(s.y), z.radius * rm * 1.414, z.radius * rm * 0.707).fill({ color, alpha: a * k });
        // The edge of the sanctified pool, breathing: this one is a gameplay zone.
        // Before a toll (the warning bell) the edge flickers fast: the light is about to move.
        const pulse = opts.warn ? (Math.floor(tick / 5) % 2 === 0 ? 1 : 0.3) : 0.5 + 0.25 * Math.sin(tick * 0.08);
        sh.ellipse(Math.round(s.x), Math.round(s.y), z.radius * 1.414, z.radius * 0.707).stroke({ width: opts.warn ? 2 : 1, color: C('inlay'), alpha: pulse * k });
        if (opts.hazards) {
          // Hazard view: the pool's route through its anchors.
          for (let a = 0; a < z.anchors.length; a++) {
            const p0 = groundToScreen(z.anchors[a]!.x, z.anchors[a]!.y);
            const p1 = groundToScreen(z.anchors[(a + 1) % z.anchors.length]!.x, z.anchors[(a + 1) % z.anchors.length]!.y);
            sh.moveTo(p0.x, p0.y).lineTo(p1.x, p1.y).stroke({ width: 1, color: 0x00c0ff, alpha: 0.8 });
          }
        }
        // A shaft from above down onto the pool.
        sh.poly([s.x - z.radius * 0.5, s.y - 140, s.x + z.radius * 0.5, s.y - 140, s.x + z.radius * 1.1, s.y, s.x - z.radius * 1.1, s.y]).fill({ color, alpha: 0.06 * k });
      }
    }
  }

  /** Light sources this frame, in world-layer screen coordinates. */
  lights(world: World, opts: { shaftsOff: boolean }): LightSource[] {
    const out: LightSource[] = [];
    this.flames.forEach((f, i) => {
      const s = groundToScreen(f.at.x, f.at.y);
      out.push({ x: s.x, y: s.y - f.lift, radius: f.size > 2 ? 46 + Math.sin(world.tick * 0.3 + i) * 2 : 20, color: this.col('flame'), alpha: 0.9 });
    });
    if (!opts.shaftsOff) for (const w of this.windowShafts) out.push({ x: w.floor.x, y: w.floor.y, radius: 24, color: w.color, alpha: 0.45 });
    for (const z of world.zones.list) {
      if (z.intensity <= 0.05) continue;
      const s = groundToScreen(z.pos.x, z.pos.y);
      out.push({ x: s.x, y: s.y, radius: z.radius * 1.6, color: this.col(z.glass ?? 'glassGold', 0xf1da94), alpha: 0.9 * z.intensity });
    }
    return out;
  }
}

/** Outward normal of a polygon edge (robust for concave polygons). */
function outward(poly: [number, number][], p: [number, number], q: [number, number]): Vec2 {
  let nx = q[1] - p[1];
  let ny = -(q[0] - p[0]);
  const l = Math.hypot(nx, ny) || 1;
  nx /= l;
  ny /= l;
  const mx = (p[0] + q[0]) / 2;
  const my = (p[1] + q[1]) / 2;
  if (pointInPolygon(mx + nx * 2, my + ny * 2, poly)) {
    nx = -nx;
    ny = -ny;
  }
  return { x: nx, y: ny };
}
