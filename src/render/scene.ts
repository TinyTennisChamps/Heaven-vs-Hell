import { Container, Graphics, Sprite as PixiSprite } from 'pixi.js';
import { loopFrame, type Atlas } from './atlas';
import { pickPlayerAnim, type AnimConfig } from './animSync';
import { VIEW_H, VIEW_W } from '../core/constants';
import { GROUND_TILE, groundToScreen } from '../core/iso';
import { DEG, angleOf, lerp, type Vec2 } from '../core/math';
import { attackDef, attackPhase } from '../sim/actors/player';
import type { ArcHitbox, SimConfig } from '../sim/config';
import { pointInPolygon } from '../sim/physics/collide';
import type { Enemy, World } from '../sim/world';
import { ANGEL, HEAVEN, JUDGEMENT, SATAN } from './palette';
import { Particles } from './particles';
import { Sparks } from './sparks';
import { drawDominion, drawDummy, type DominionPose } from './sprites/placeholders';
import { enemyAttack } from '../sim/actors/enemy';
import { shieldUp } from '../sim/combat/damage';

interface Sprite {
  root: Container;
  body: Graphics;
  key: string;
}

const PILLAR_H = 30;
const LIP_H = 8;

/** Projects a ground-space polygon to a flat screen point list. */
function proj(points: ReadonlyArray<Vec2 | readonly [number, number]>, lift = 0): number[] {
  const out: number[] = [];
  for (const p of points) {
    const gx = Array.isArray(p) ? (p as readonly number[])[0]! : (p as Vec2).x;
    const gy = Array.isArray(p) ? (p as readonly number[])[1]! : (p as Vec2).y;
    const s = groundToScreen(gx, gy);
    out.push(s.x, s.y - lift);
  }
  return out;
}

function groundCircle(c: Vec2, r: number, n = 18): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) pts.push({ x: c.x + Math.cos((i / n) * Math.PI * 2) * r, y: c.y + Math.sin((i / n) * Math.PI * 2) * r });
  return pts;
}

/** Ground-space ring sector for slash arcs / telegraphs. */
function arcPoly(origin: Vec2, dir: Vec2, box: ArcHitbox, from: number, to: number, inner = 0.35): Vec2[] {
  const o = { x: origin.x + dir.x * box.offset, y: origin.y + dir.y * box.offset };
  const a0 = angleOf(dir) - (box.angleDeg / 2) * DEG;
  const span = box.angleDeg * DEG;
  const pts: Vec2[] = [];
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const a = a0 + span * lerp(from, to, i / n);
    pts.push({ x: o.x + Math.cos(a) * box.radius, y: o.y + Math.sin(a) * box.radius });
  }
  for (let i = n; i >= 0; i--) {
    const a = a0 + span * lerp(from, to, i / n);
    pts.push({ x: o.x + Math.cos(a) * box.radius * inner, y: o.y + Math.sin(a) * box.radius * inner });
  }
  return pts;
}

export class Scene {
  readonly root = new Container();
  private worldLayer = new Container();
  private floor = new Graphics();
  private shadows = new Graphics();
  private telegraphs = new Graphics();
  private entities = new Container();
  private fx = new Graphics();
  private debugG = new Graphics();
  private hud = new Graphics();
  private cursorG = new Graphics();
  readonly particles = new Particles();
  readonly sparks = new Sparks();
  private screenFlash = new Graphics();
  private player: PixiSprite;
  private enemySprites = new Map<number, Sprite>();

  constructor(
    world: World,
    private satan: Atlas,
    private anim: AnimConfig,
  ) {
    this.entities.sortableChildren = true;
    this.worldLayer.addChild(this.floor, this.shadows, this.telegraphs, this.entities, this.fx, this.particles.g, this.sparks.g, this.debugG);
    this.screenFlash.rect(0, 0, VIEW_W, VIEW_H).fill(0xffffff);
    this.screenFlash.alpha = 0;
    this.root.addChild(this.worldLayer, this.screenFlash, this.hud, this.cursorG);
    this.drawRoom(world);
    this.player = new PixiSprite();
    this.player.anchor.set(satan.pivot.x / satan.frameW, satan.pivot.y / satan.frameH);
    this.entities.addChild(this.player);
    this.drawCursor();
  }

  private makeSprite(): Sprite {
    const root = new Container();
    const body = new Graphics();
    root.addChild(body);
    this.entities.addChild(root);
    return { root, body, key: '' };
  }

  private drawRoom(world: World): void {
    const room = world.room;
    const g = this.floor;
    // Gold lip: extrude every bounds edge downward; the floor covers the hidden ones.
    const b = room.bounds;
    for (let i = 0; i < b.length; i++) {
      const p = b[i]!;
      const q = b[(i + 1) % b.length]!;
      const sp = groundToScreen(p[0], p[1]);
      const sq = groundToScreen(q[0], q[1]);
      g.poly([sp.x, sp.y, sq.x, sq.y, sq.x, sq.y + LIP_H, sp.x, sp.y + LIP_H]).fill(HEAVEN.gold3);
      g.poly([sp.x, sp.y + LIP_H - 2, sq.x, sq.y + LIP_H - 2, sq.x, sq.y + LIP_H, sp.x, sp.y + LIP_H]).fill(HEAVEN.goldDark);
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
        const col = (i + j) % 2 === 0 ? HEAVEN.ivory2 : HEAVEN.marble;
        g.poly(proj([[gx, gy], [gx + T, gy], [gx + T, gy + T], [gx, gy + T]])).fill(col);
      }
    }
    // Gold inlay border one tile in.
    const inset = b.map(([x, y]) => [x + (x === Math.min(...xs) ? T : -T), y + (y === Math.min(...ys) ? T : -T)] as const);
    g.poly(proj(inset)).stroke({ width: 1, color: HEAVEN.gold2, alpha: 0.9 });
    // Gold rim along the top edge of the platform.
    g.poly(proj(b)).stroke({ width: 1, color: HEAVEN.gold2 });

    // Pillars: extruded prisms, depth-sorted with entities.
    for (const wall of room.walls) {
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
        // East-facing faces catch the light; south-facing ones sit in shade.
        const shade = nx > ny ? HEAVEN.marble : HEAVEN.stone;
        pc.poly([sp.x, sp.y, sq.x, sq.y, sq.x, sq.y - PILLAR_H, sp.x, sp.y - PILLAR_H]).fill(shade);
        pc.moveTo(sp.x, sp.y - 3).lineTo(sq.x, sq.y - 3).stroke({ width: 1, color: HEAVEN.gold3 });
      }
      pc.poly(proj(wall, PILLAR_H)).fill(HEAVEN.gold2).stroke({ width: 1, color: HEAVEN.gold3 });
      pc.zIndex = cx + cy;
      this.entities.addChild(pc);
    }
  }

  private drawCursor(): void {
    const g = this.cursorG;
    g.rect(-3, 0, 2, 1).rect(2, 0, 2, 1).rect(0, -3, 1, 2).rect(0, 2, 1, 2).fill(SATAN.cloak);
    g.rect(0, 0, 1, 1).fill(SATAN.hellfire);
  }

  render(world: World, alpha: number, cursor: Vec2, cfg: SimConfig, debug: boolean): void {
    const cam = world.camera;
    const cx = lerp(cam.prevPos.x, cam.pos.x, alpha) + cam.shakeOffset.x;
    const cy = lerp(cam.prevPos.y, cam.pos.y, alpha) + cam.shakeOffset.y;
    this.worldLayer.position.set(Math.round(VIEW_W / 2 - cx), Math.round(VIEW_H / 2 - cy));
    this.cursorG.position.set(Math.round(cursor.x), Math.round(cursor.y));
    this.screenFlash.alpha = this.sparks.flash > 0 ? 0.35 : 0;

    this.shadows.clear();
    this.telegraphs.clear();
    this.fx.clear();

    // --- Player ---
    const p = world.player;
    const pp = { x: lerp(p.prevPos.x, p.pos.x, alpha), y: lerp(p.prevPos.y, p.pos.y, alpha) };
    const pick = pickPlayerAnim(p, cfg, this.anim);
    const dirTag = pick.facing === 'left' ? 'right' : pick.facing;
    const tag = this.satan.tags.get(`${pick.tag}_${dirTag}`) ?? this.satan.tags.get(`idle_${dirTag}`)!;
    const fi = pick.frame >= 0 ? Math.min(pick.frame, tag.frames.length - 1) : loopFrame(tag, (world.tick * 1000) / 60);
    this.player.texture = p.hitFlash > 0 ? tag.flash[fi]! : tag.frames[fi]!;
    const ps = groundToScreen(pp.x, pp.y);
    this.player.position.set(Math.round(ps.x), Math.round(ps.y));
    this.player.scale.x = pick.facing === 'left' ? -1 : 1;
    this.player.zIndex = pp.x + pp.y;
    this.shadow(pp, 8);
    if (p.dash) {
      // Ember smear behind a dash.
      const back = { x: pp.x - p.dash.dir.x * 10, y: pp.y - p.dash.dir.y * 10 };
      this.fx.poly(proj([...groundCircle(back, 4, 8)])).fill({ color: SATAN.ember, alpha: 0.35 });
    }

    // Ground wake of the slash: the true hitbox shape on the floor (the sprite
    // carries the main smear), then breaking into streaks like the reference.
    if (p.action && p.action.key !== 'deathblow') {
      const d = attackDef(cfg, p.action.key);
      const age = p.action.frame - d.startup;
      if (age >= 1 && age <= d.active) {
        const prog = Math.min(1, age / d.active);
        const [from, to] = p.action.step === 2 ? [1 - prog, 1] : [0, prog];
        this.fx.poly(proj(arcPoly(p.pos, p.action.dir, d.hitbox, from, to, 0.8), 2)).fill({ color: SATAN.hellfire, alpha: 0.55 });
        this.fx.poly(proj(arcPoly(p.pos, p.action.dir, { ...d.hitbox, radius: d.hitbox.radius + 1 }, from, to, 0.94), 2)).fill({ color: SATAN.eyeGlow, alpha: 0.8 });
      } else if (age > d.active && age <= d.active + 5) {
        const k = (age - d.active) / 5;
        const box = { ...d.hitbox, radius: d.hitbox.radius + 3 * k };
        for (const [a, b] of [[0.1, 0.22], [0.42, 0.55], [0.75, 0.86]] as const) {
          this.fx.poly(proj(arcPoly(p.pos, p.action.dir, box, a + k * 0.05, b, 0.93), 2 + 4 * k)).fill({ color: SATAN.ember, alpha: 0.8 * (1 - k) });
        }
      }
    }
    // Facing marker: a small hellfire arc on the floor where Satan points.
    if (!p.dash && !p.parry && !p.guarding && p.broken === 0) {
      this.fx.poly(proj(arcPoly(pp, p.facing, { radius: 14, angleDeg: 50, offset: 0 }, 0, 1, 0.7))).fill({ color: SATAN.hellfire, alpha: 0.75 });
    }
    // Guard read: a thin hellfire arc while parry window is open, dim while blocking.
    if (p.parry || p.guarding) {
      const box = { radius: 12, angleDeg: p.parry ? cfg.combat.parry.coneDeg : cfg.combat.block.coneDeg, offset: 0 };
      const open = p.parry && p.parry.frame <= p.parry.window;
      this.fx.poly(proj(arcPoly(pp, p.facing, box, 0, 1, 0.82), 2)).fill({ color: open ? SATAN.hellfire : SATAN.blood, alpha: open ? 0.8 : 0.45 });
    }

    // --- Enemies ---
    const alive = new Set<number>();
    for (const e of world.enemies) {
      alive.add(e.id);
      let s = this.enemySprites.get(e.id);
      if (!s) {
        s = this.makeSprite();
        this.enemySprites.set(e.id, s);
      }
      const ep = { x: lerp(e.prevPos.x, e.pos.x, alpha), y: lerp(e.prevPos.y, e.pos.y, alpha) };
      s.root.visible = e.phase !== 'down';
      if (!s.root.visible) continue;
      const atk = enemyAttack(cfg, e);
      const faceDir = e.phase === 'windup' || e.phase === 'active' ? e.attackDir : e.facing;
      this.place(s, ep, groundToScreen(faceDir.x, faceDir.y).x < 0);
      // Last 10 windup frames blink white: "it's coming now".
      const tele = !!atk && e.phase === 'windup' && e.phaseFrame > atk.windup - 10 && Math.floor(e.phaseFrame / 3) % 2 === 0;
      const flash = e.hitFlash > 0 || tele;
      if (e.type === 'dominion') {
        const pose = dominionPose(e);
        this.redraw(s, `${pose}${flash}${e.shieldFlash > 0}`, () => drawDominion(s!.body, pose, flash, e.shieldFlash > 0));
      } else {
        this.redraw(s, `${flash}`, () => drawDummy(s!.body, flash));
      }
      this.shadow(ep, e.radius);
      this.enemyTelegraph(e, cfg, ep);
      this.enemyBars(e, ep, cfg);
    }
    for (const [id, s] of this.enemySprites) {
      if (!alive.has(id)) {
        s.root.destroy({ children: true });
        this.enemySprites.delete(id);
      }
    }

    // --- HUD ---
    this.drawHud(world, cfg);

    // --- Debug ---
    this.debugG.clear();
    if (debug) this.drawDebug(world, cfg);
  }

  private place(s: Sprite, ground: Vec2, faceLeft: boolean): void {
    const sp = groundToScreen(ground.x, ground.y);
    s.root.position.set(Math.round(sp.x), Math.round(sp.y));
    s.root.scale.x = faceLeft ? -1 : 1;
    s.root.zIndex = ground.x + ground.y;
  }

  private redraw(s: Sprite, key: string, draw: () => void): void {
    if (s.key === key) return;
    s.key = key;
    draw();
  }

  private shadow(ground: Vec2, r: number): void {
    const sp = groundToScreen(ground.x, ground.y);
    this.shadows.ellipse(Math.round(sp.x), Math.round(sp.y), r, r / 2).fill({ color: ANGEL.void, alpha: 0.18 });
  }

  private enemyTelegraph(e: Enemy, cfg: SimConfig, ep: Vec2): void {
    const atk = enemyAttack(cfg, e);
    if (!atk || (e.phase !== 'windup' && e.phase !== 'active')) return;
    const t = e.phase === 'active' ? 1 : e.phaseFrame / atk.windup;
    const box = atk.lunge ? { ...atk.hitbox, radius: atk.hitbox.radius + atk.lunge.px } : atk.hitbox;
    if (atk.judgement) {
      // Judgement: white-gold, never red. Unblockable — dash through or away.
      this.telegraphs.poly(proj(arcPoly(e.pos, e.attackDir, { radius: box.radius, angleDeg: 26, offset: 0 }, 0, 1, 0.1))).fill({ color: JUDGEMENT, alpha: 0.25 + 0.45 * t });
      const sp = groundToScreen(ep.x, ep.y);
      const blink = e.phase === 'active' || Math.floor(e.phaseFrame / 4) % 2 === 0;
      if (blink) this.glyph(sp.x, sp.y - 46);
    } else {
      // Ground marker growing toward the strike: pale lilac, never red.
      this.telegraphs.poly(proj(arcPoly(e.pos, e.attackDir, box, 0, 1, 0.2))).fill({ color: ANGEL.lilac, alpha: 0.1 + 0.3 * t });
      this.telegraphs.poly(proj(arcPoly(e.pos, e.attackDir, box, 0, 1, 0.2))).stroke({ width: 1, color: ANGEL.angelLine, alpha: 0.3 + 0.5 * t });
    }
    if (e.phase === 'active') {
      this.fx.poly(proj(arcPoly(e.pos, e.attackDir, atk.hitbox, 0, 1, 0.75), 12)).fill({ color: atk.judgement ? JUDGEMENT : 0xffffff, alpha: 0.9 });
    }
  }

  /** White-gold sigil: a diamond with rays. */
  private glyph(x: number, y: number): void {
    const g = this.fx;
    x = Math.round(x);
    y = Math.round(y);
    g.poly([x, y - 5, x + 4, y, x, y + 5, x - 4, y]).fill(JUDGEMENT).stroke({ width: 1, color: HEAVEN.gold3 });
    g.rect(x, y - 8, 1, 2).rect(x, y + 7, 1, 2).rect(x - 7, y, 2, 1).rect(x + 6, y, 2, 1).fill(JUDGEMENT);
    g.rect(x, y - 1, 1, 3).fill(HEAVEN.gold3);
  }

  private enemyBars(e: Enemy, ground: Vec2, cfg: SimConfig): void {
    const sp = groundToScreen(ground.x, ground.y);
    const w = 22;
    const x = Math.round(sp.x - w / 2);
    const y = Math.round(sp.y - 40);
    const def = cfg.enemies[e.type]!;
    // Health: pearl. Posture: centre-fill gold, white when nearly broken.
    this.fx.rect(x - 1, y - 1, w + 2, 7).fill(ANGEL.void);
    this.fx.rect(x, y, Math.round((w * e.hp) / e.maxHp), 2).fill(ANGEL.pearl);
    const pf = Math.min(1, e.posture / def.posture.max);
    const pw = Math.round(w * pf);
    if (pw > 0) this.fx.rect(x + Math.round((w - pw) / 2), y + 3, pw, 2).fill(pf > 0.8 ? 0xffffff : HEAVEN.gold2);
    if (e.phase === 'broken') {
      // Deathblow opening: the red diamond (red = Satan's opening).
      const bx = Math.round(sp.x);
      const by = y - 8;
      const pulse = Math.floor(e.phaseFrame / 6) % 2 === 0 ? 1 : 0;
      this.fx.poly([bx, by - 4 - pulse, bx + 4 + pulse, by, bx, by + 4 + pulse, bx - 4 - pulse, by]).fill(SATAN.crimson).stroke({ width: 1, color: SATAN.cloak });
      this.fx.rect(bx - 1, by - 1, 2, 2).fill(SATAN.hellfire);
    }
  }

  private drawHud(world: World, cfg: SimConfig): void {
    const g = this.hud;
    g.clear();
    const p = world.player;
    const x = 8;
    const y = 8;
    const w = 96;
    g.rect(x - 2, y - 2, w + 4, 9).fill(SATAN.cloak);
    g.rect(x, y, w, 5).fill(SATAN.lava);
    g.rect(x, y, Math.round((w * p.hp) / cfg.player.maxHealth), 5).fill(SATAN.crimson);
    g.rect(x, y, Math.round((w * p.hp) / cfg.player.maxHealth), 1).fill(SATAN.hellfire);
    for (let i = 0; i < 3; i++) {
      const lit = p.action ? i < p.action.step : p.comboTimer > 0 && i < p.lastStep;
      g.rect(x + i * 6, y + 9, 4, 2).fill(lit ? SATAN.ember : SATAN.cloak2);
    }
    // Satan's posture: bottom centre, fills from the centre outward (HUD mock).
    const pw = 140;
    const px = Math.round(VIEW_W / 2 - pw / 2);
    const py = VIEW_H - 14;
    const frac = Math.min(1, p.posture / cfg.player.posture.max);
    g.rect(px - 2, py - 2, pw + 4, 7).fill(SATAN.cloak);
    g.rect(px, py, pw, 3).fill(SATAN.cloak2);
    const fw = Math.round(pw * frac);
    if (fw > 0) g.rect(px + Math.round((pw - fw) / 2), py, fw, 3).fill(p.broken > 0 ? 0xffffff : frac > 0.75 ? SATAN.hellfire : SATAN.ember);
    g.rect(Math.round(VIEW_W / 2), py - 3, 1, 9).fill(HEAVEN.gold2);
  }

  private drawDebug(world: World, cfg: SimConfig): void {
    const g = this.debugG;
    for (const s of world.segs) {
      const a = groundToScreen(s.ax, s.ay);
      const b = groundToScreen(s.bx, s.by);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    g.stroke({ width: 1, color: 0x00c0ff, alpha: 0.8 });
    const p = world.player;
    g.poly(proj(groundCircle(p.pos, cfg.player.radius))).stroke({ width: 1, color: p.dash && p.dash.frame >= cfg.player.dash.iFrameStart && p.dash.frame <= cfg.player.dash.iFrameEnd ? 0xffff00 : 0x00ff66 });
    if (p.action) {
      const d = attackDef(cfg, p.action.key);
      if (attackPhase(p.action, d) === 'active') g.poly(proj(arcPoly(p.pos, p.action.dir, d.hitbox, 0, 1, 0))).stroke({ width: 1, color: 0xff00ff });
    }
    for (const e of world.enemies) {
      if (e.phase === 'down') continue;
      g.poly(proj(groundCircle(e.pos, e.radius))).stroke({ width: 1, color: 0x00ff66 });
      const def = cfg.enemies[e.type]!;
      if (def.shieldArcDeg > 0 && shieldUp(e)) g.poly(proj(arcPoly(e.pos, e.facing, { radius: e.radius + 4, angleDeg: def.shieldArcDeg, offset: 0 }, 0, 1, 0.7))).stroke({ width: 1, color: 0x00c0ff });
      const atk = enemyAttack(cfg, e);
      if (atk && e.phase === 'active') g.poly(proj(arcPoly(e.pos, e.attackDir, atk.hitbox, 0, 1, 0))).stroke({ width: 1, color: 0xff00ff });
    }
  }
}

function dominionPose(e: Enemy): DominionPose {
  if (e.phase === 'broken') return 'broken';
  if (e.attack === 'bash' && (e.phase === 'active' || e.phase === 'recover')) return 'bash';
  if (e.attack === 'judgement' && e.phase === 'active') return 'lunge';
  if (e.phase === 'windup') return e.attack === 'bash' ? 'guard' : 'drawBack';
  if (e.phase === 'active' || (e.phase === 'recover' && e.phaseFrame < 8)) return 'thrust';
  return 'guard';
}
