import { Container, Graphics, Sprite as PixiSprite } from 'pixi.js';
import { loopFrame, type Atlas } from './atlas';
import { pickPlayerAnim, type AnimConfig } from './animSync';
import { VIEW_H, VIEW_W } from '../core/constants';
import { groundToScreen } from '../core/iso';
import { lerp, type Vec2 } from '../core/math';
import { arcPoly, groundCircle, proj } from './biome/geom';
import { attackDef, attackPhase } from '../sim/actors/player';
import type { SimConfig } from '../sim/config';
import type { Enemy, World } from '../sim/world';
import { ANGEL, GARDEN, HEAVEN, JUDGEMENT, SATAN } from './palette';
import { Particles } from './particles';
import { Sparks } from './sparks';
import { drawArcher, drawCherub, drawDominion, drawDummy, drawGabriel, drawRaphael, drawWatcher, drawZealot, type ArcherPose, type CherubPose, type DominionPose, type GabrielPose, type RaphaelPose, type WatcherPose, type ZealotPose } from './sprites/placeholders';
import type { DoorKind } from '../sim/rooms/run';
import type { BiomeDef } from '../sim/config';
import { ColorMatrixFilter, type Renderer } from 'pixi.js';
import { RoomArt } from './biome/roomArt';
import { Lighting } from './biome/lighting';
import { Parallax } from './biome/parallax';
import { Ambient } from './biome/ambient';
import { Grade } from './biome/grade';
import { hex } from './biome/geom';
import { maxHp, maxPips, maxPosture, playerRadius } from '../sim/stats';
import { enemyAttack } from '../sim/actors/enemy';
import { shieldUp } from '../sim/combat/damage';

interface Sprite {
  root: Container;
  body: Graphics;
  key: string;
}

const DOOR_H = 26;
const DOOR_HALF = 11;

interface DoorSprite {
  g: Graphics;
  /** Exit index, or -1 for the entry door (always shut behind Satan). */
  exit: number;
  at: Vec2;
  /** Ground tangent along the room edge. */
  tan: Vec2;
}

export class Scene {
  readonly root = new Container();
  private worldLayer = new Container();
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
  /** Seconds left of the "no pips" HUD blink. */
  noPipsFlash = 0;
  private player: PixiSprite;
  private enemySprites = new Map<number, Sprite>();
  private doors: DoorSprite[] = [];
  private clouds = new Graphics();
  private fontG = new Graphics();
  /** Where each exit door leads (icons above them); null hides icons (training). */
  doorKinds: DoorKind[] | null = null;
  private roarRings: { pos: Vec2; age: number }[] = [];

  /** Expanding hellfire ring for the Rage roar (ground position). */
  roarRing(pos: Vec2): void {
    this.roarRings.push({ pos: { ...pos }, age: 0 });
  }

  /** Debug layer toggles (F8). Gameplay layers can't be switched off. */
  layers = { decoration: true, lighting: true, parallax: true, ambient: true, hazards: false, readability: false, hud: true };
  /** Real seconds since the last render (ambient life). */
  frameDt = 1 / 60;
  /** Combat rooms already cleared in this level (the descent darkens the light). */
  depth = 0;
  readonly art: RoomArt;
  readonly lighting: Lighting;
  readonly parallax: Parallax;
  readonly ambient: Ambient;
  private grade = new Grade();
  private greyFilter = new ColorMatrixFilter();
  private shadeKey = '';

  constructor(
    world: World,
    private satan: Atlas,
    private anim: AnimConfig,
    readonly biome: BiomeDef,
    renderer: Renderer,
  ) {
    this.entities.sortableChildren = true;
    this.art = new RoomArt(world, biome, this.entities);
    this.lighting = new Lighting(renderer);
    this.parallax = new Parallax(biome);
    this.ambient = new Ambient(biome);
    this.greyFilter.desaturate();
    this.worldLayer.addChild(this.clouds, this.art.floor, this.art.shafts, this.lighting.dark, this.lighting.glow, this.fontG, this.shadows, this.telegraphs, this.entities, this.art.dyn, this.fx, this.ambient.g, this.particles.g, this.sparks.g, this.debugG);
    this.screenFlash.rect(0, 0, VIEW_W, VIEW_H).fill(0xffffff);
    this.screenFlash.alpha = 0;
    this.root.addChild(this.parallax.root, this.worldLayer, this.screenFlash, this.grade.root, this.hud, this.cursorG);
    if (!biome.indoor) this.drawClouds(world);
    this.makeDoors(world);
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

  /** Clouds drifting below and around the floating platform. */
  private drawClouds(world: World): void {
    const g = this.clouds;
    const b = world.screenBox;
    let seed = world.room.id.length * 31 + 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed % 1000) / 1000;
    };
    for (let i = 0; i < 16; i++) {
      // Around the rim, biased below (we look down at the platform).
      const a = rnd() * Math.PI * 2;
      const cx = (b.minX + b.maxX) / 2 + Math.cos(a) * ((b.maxX - b.minX) / 2 + 20 + rnd() * 50);
      const cy = (b.minY + b.maxY) / 2 + Math.sin(a) * ((b.maxY - b.minY) / 2 + 10 + rnd() * 40) + 30;
      const n = 3 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const r = 8 + rnd() * 10;
        const ox = (k - n / 2) * r * 0.9;
        g.ellipse(Math.round(cx + ox), Math.round(cy + 2), r, r * 0.55).fill(GARDEN.cloudShade);
        g.ellipse(Math.round(cx + ox), Math.round(cy), r, r * 0.55).fill(GARDEN.cloud);
      }
    }
  }

  private makeDoors(world: World): void {
    const r = world.room;
    const xs = r.bounds.map((p) => p[0]);
    const tanOf = (at: [number, number]): Vec2 => (at[0] <= Math.min(...xs) || at[0] >= Math.max(...xs) ? { x: 0, y: 1 } : { x: 1, y: 0 });
    const add = (at: [number, number], exit: number) => {
      const g = new Graphics();
      g.zIndex = at[0] + at[1] + 0.5;
      this.entities.addChild(g);
      this.doors.push({ g, exit, at: { x: at[0], y: at[1] }, tan: tanOf(at) });
    };
    if (r.entry) add(r.entry.at, -1);
    (r.exits ?? []).forEach((d, i) => add(d.at, i));
  }

  /** Gate on the platform edge: gold posts + lintel; bars while shut, a glow when open. Icon above where it leads. */
  private drawDoors(world: World): void {
    const rr = world.roomRun;
    for (const d of this.doors) {
      const g = d.g;
      g.clear();
      const used = d.exit >= 0 && d.exit < rr.exitCount;
      if (d.exit >= 0 && !used) continue; // this way doesn't go anywhere this run
      const open = d.exit >= 0 && rr.cleared;
      const a = groundToScreen(d.at.x - d.tan.x * DOOR_HALF, d.at.y - d.tan.y * DOOR_HALF);
      const b = groundToScreen(d.at.x + d.tan.x * DOOR_HALF, d.at.y + d.tan.y * DOOR_HALF);
      const H = DOOR_H;
      if (open) {
        const pulse = 0.55 + 0.2 * Math.sin(world.tick * 0.12);
        // A shaft of light rising from an open gate, so it reads from across the room.
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        g.poly([mx - 9, my - H, mx + 9, my - H, mx + 5, my - H - 70, mx - 5, my - H - 70]).fill({ color: HEAVEN.gold1, alpha: 0.25 + 0.15 * pulse });
        g.poly([a.x, a.y, b.x, b.y, b.x, b.y - H, a.x, a.y - H]).stroke({ width: 2, color: HEAVEN.gold2 });
        g.poly([a.x, a.y, b.x, b.y, b.x, b.y - H, a.x, a.y - H]).fill({ color: HEAVEN.gold1, alpha: pulse });
        g.poly([a.x, a.y - H + 4, b.x, b.y - H + 4, b.x, b.y - 2, a.x, a.y - 2]).fill({ color: 0xffffff, alpha: pulse * 0.8 });
      } else {
        g.poly([a.x, a.y, b.x, b.y, b.x, b.y - H, a.x, a.y - H]).fill({ color: ANGEL.void, alpha: 0.25 });
        for (let k = 1; k < 5; k++) {
          const t = k / 5;
          const x = a.x + (b.x - a.x) * t;
          const y = a.y + (b.y - a.y) * t;
          g.moveTo(Math.round(x), Math.round(y)).lineTo(Math.round(x), Math.round(y - H)).stroke({ width: 1, color: HEAVEN.gold3 });
        }
      }
      for (const p of [a, b]) g.rect(Math.round(p.x) - 1, Math.round(p.y - H - 2), 3, H + 2).fill(HEAVEN.gold2).stroke({ width: 1, color: HEAVEN.goldDark, alignment: 1 });
      g.moveTo(a.x, a.y - H - 2).lineTo(b.x, b.y - H - 2).stroke({ width: 2, color: HEAVEN.gold2 });
      const kind = d.exit >= 0 ? this.doorKinds?.[d.exit] : undefined;
      if (kind) {
        const m = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2 - H - 12) };
        const bob = open ? Math.round(Math.sin(world.tick * 0.08) * 1.5) : 0;
        doorIcon(g, kind, m.x, m.y + bob, open);
      }
    }
  }

  /** Hidden-vial cracks (with a red glint), vial cages and revealed vials. */
  private drawPickups(world: World): void {
    const g = this.fx;
    for (const q of world.pickups) {
      if (q.kind === 'drop') {
        // A boss's vial appears only once the boss has fallen.
        if (q.open && !q.taken) this.vial(world, q.vialAt, true);
        continue;
      }
      const c = groundToScreen(q.at.x, q.at.y);
      const cx = Math.round(c.x);
      const cy = Math.round(c.y);
      if (q.kind === 'secret') {
        // A cracked stretch of wall with a cold draught drifting out of it (the hint),
        // and once broken, a dark doorway with an eye above it.
        const wy = cy - 18;
        if (!q.open) {
          const lines: [number, number, number, number][] = [[-5, -6, 0, 0], [0, 0, 4, -8], [0, 0, -2, 8], [-6, 4, -1, 2], [3, 2, 7, 6]];
          for (let i = 0; i < 2 + q.hits * 2 && i < lines.length; i++) {
            const [a, b, d, e] = lines[i]!;
            g.moveTo(cx + a, wy + b).lineTo(cx + d, wy + e).stroke({ width: 1, color: HEAVEN.stoneDark });
          }
          for (let k = 0; k < 3; k++) {
            const t = ((world.tick * 0.6 + k * 20) % 60) / 60;
            g.rect(Math.round(cx + 2 + t * 22), Math.round(wy + (k - 1) * 4 + t * 6), 2, 1).fill({ color: ANGEL.pearl, alpha: 0.5 * (1 - t) });
          }
        } else {
          g.poly([cx - 7, cy, cx + 7, cy, cx + 7, cy - 18, cx, cy - 25, cx - 7, cy - 18]).fill(ANGEL.void).stroke({ width: 1, color: HEAVEN.gold3 });
          if (world.roomRun.cleared) doorIcon(g, 'secret', cx, cy - 38, true);
        }
        continue;
      }
      if (q.kind === 'crack') {
        if (!q.open) {
          // Cracked marble on the rim; more cracks per hit.
          const lines: [number, number, number, number][] = [[-6, -1, 0, 1], [0, 1, 5, -1], [-2, 0, -4, 4], [2, 0, 4, 3], [-8, 2, -3, 3], [4, -2, 8, 1]];
          for (let i = 0; i < 2 + q.hits * 2 && i < lines.length; i++) {
            const [a, b, d, e] = lines[i]!;
            g.moveTo(cx + a, cy + b).lineTo(cx + d, cy + e).stroke({ width: 1, color: HEAVEN.stoneDark });
          }
          // The red glint: a brief sparkle every ~1.5 s (red = Satan's item).
          const t = world.tick % 90;
          if (t < 10) {
            const k = t < 5 ? t : 10 - t;
            g.rect(cx - k, cy - 1, 2 * k + 1, 1).rect(cx, cy - 1 - k, 1, 2 * k + 1).fill({ color: SATAN.hellfire, alpha: 0.9 });
            g.rect(cx, cy - 1, 1, 1).fill(0xffffff);
          }
        } else {
          g.rect(cx - 5, cy - 1, 3, 2).rect(cx + 2, cy, 3, 2).rect(cx - 1, cy + 1, 2, 1).fill(HEAVEN.stone);
        }
      } else if (!q.open) {
        // Gold cage: bars around the vial, a cap on top.
        this.vial(world, q.vialAt, false);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const bx = Math.round(cx + Math.cos(a) * 8);
          const by = Math.round(cy + Math.sin(a) * 4);
          g.rect(bx, by - 20, 1, 20).fill(HEAVEN.gold2);
        }
        g.ellipse(cx, cy - 20, 8, 4).stroke({ width: 1, color: HEAVEN.gold3 }).fill({ color: HEAVEN.gold2, alpha: 0.6 });
        g.ellipse(cx, cy, 8, 4).stroke({ width: 1, color: HEAVEN.gold3 });
        continue;
      } else {
        g.ellipse(cx, cy, 8, 4).stroke({ width: 1, color: HEAVEN.gold3 });
      }
      if (q.open && !q.taken) this.vial(world, q.vialAt, true);
    }
  }

  /** A Rage Vial: a red flask with an ember glow, bobbing when free. */
  private vial(world: World, at: Vec2, free: boolean): void {
    const g = this.fx;
    const s = groundToScreen(at.x, at.y);
    const bob = free ? Math.round(Math.sin(world.tick * 0.1) * 1.5) : 0;
    const x = Math.round(s.x);
    const y = Math.round(s.y) - 10 + bob;
    if (free) g.ellipse(x, Math.round(s.y), 5, 2.5).fill({ color: SATAN.hellfire, alpha: 0.35 });
    g.rect(x - 1, y - 6, 3, 2).fill(HEAVEN.gold2);
    g.rect(x - 1, y - 4, 3, 2).fill(SATAN.cloak2);
    g.circle(x, y + 1, 4).fill(SATAN.crimson).stroke({ width: 1, color: SATAN.cloak, alignment: 1 });
    g.rect(x - 1, y - 1, 1, 2).fill(SATAN.eyeGlow);
    g.rect(x - 2, y + 2, 5, 1).fill(SATAN.hellfire);
  }

  /** The rest font glows until used. */
  private drawFont(world: World): void {
    const g = this.fontG;
    g.clear();
    const f = world.room.font;
    if (!f) return;
    const s = groundToScreen(f[0], f[1]);
    if (!world.roomRun.fontUsed) {
      const k = 0.5 + 0.5 * Math.sin(world.tick * 0.07);
      g.ellipse(Math.round(s.x), Math.round(s.y), 26 + k * 3, 13 + k * 1.5).fill({ color: HEAVEN.gold1, alpha: 0.35 + 0.15 * k });
      g.rect(Math.round(s.x) - 4, Math.round(s.y) - 70, 9, 70).fill({ color: HEAVEN.gold1, alpha: 0.18 + 0.1 * k });
    }
  }

  /** A brief light where something happened (hits, parries, the roar). Ground position. */
  lightFlash(pos: Vec2, color: number, strong = false): void {
    const L = this.biome.lighting.flash;
    const s = groundToScreen(pos.x, pos.y);
    this.lighting.flash(s.x, s.y - 8, color, L.radius * (strong ? 1.4 : 1), L.alpha * (strong ? 1.3 : 1), L.frames);
  }

  /** Budget readouts for the debug overlay. */
  get budgets() {
    return { lights: this.lighting.count, ambient: this.ambient.count, particles: this.particles.count };
  }

  /** Lighting, parallax, ambient life and the grade for this frame. */
  private renderAtmosphere(world: World, camX: number, camY: number): void {
    const B = this.biome.lighting;
    const preset = world.script.lighting ? B.presets?.[world.script.lighting] : undefined;
    const darkness = hex(preset?.darkness ?? B.darkness);
    const descend = Math.min(0.25, this.depth * B.descendDarken);
    const darkAlpha = Math.min(0.9, (preset?.darknessAlpha ?? B.darknessAlpha) + (B.darknessAlpha > 0 ? descend : 0));
    const shaftsOff = !!preset?.shaftsOff;
    const grade = preset?.grade ?? B.grade;

    this.parallax.update(camX, camY);
    this.parallax.root.visible = this.layers.parallax;
    const zt = this.biome.hazards?.zones;
    const warn = !!zt && !world.zones.silenced && world.zones.timer <= zt.warnFrames;
    this.art.update(world, world.tick, { shaftsOff, zones: true, warn, hazards: this.layers.hazards });
    this.hud.visible = this.layers.hud;

    // Walls and props share the room's shade (gameplay bodies stay full-bright).
    const key = `${darkness}${darkAlpha.toFixed(2)}${this.layers.lighting}`;
    if (key !== this.shadeKey) {
      this.shadeKey = key;
      this.art.setShade(darkness, this.layers.lighting ? darkAlpha * 0.55 : 0);
    }

    const p = world.player;
    const ps = groundToScreen(p.pos.x, p.pos.y);
    const satanLight = { x: ps.x, y: ps.y - 4, radius: B.satanLight.radius, color: 0xffe9c8, alpha: B.satanLight.alpha + (darkAlpha > 0.5 ? 0.25 : 0) };
    this.lighting.render([satanLight, ...this.art.lights(world, { shaftsOff })], this.worldLayer.position, darkness, darkAlpha, this.layers.lighting);

    const view = { x: -this.worldLayer.position.x, y: -this.worldLayer.position.y, w: VIEW_W, h: VIEW_H };
    this.ambient.update(Math.min(this.frameDt, 0.05), view, this.art.emitPoints(world), this.layers.ambient);
    this.grade.set(hex(grade.color), grade.alpha + descend * 0.3, B.vignette + descend, this.layers.lighting);

    // Decoration toggles and the readability (greyscale decoration) view.
    const deco = this.layers.decoration;
    this.art.floor.visible = deco;
    this.art.dyn.visible = deco;
    this.clouds.visible = deco;
    const grey = this.layers.readability ? [this.greyFilter] : [];
    for (const d of [this.art.floor, this.art.shafts, this.art.dyn, this.parallax.root, this.ambient.g, this.clouds]) d.filters = grey;
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
    this.renderAtmosphere(world, cx, cy);
    this.cursorG.position.set(Math.round(cursor.x), Math.round(cursor.y));
    this.screenFlash.alpha = this.sparks.flash > 0 ? 0.35 : 0;

    this.shadows.clear();
    this.telegraphs.clear();
    this.fx.clear();
    this.drawDoors(world);
    this.drawFont(world);

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
    // Fallen: Satan keels over and dims.
    this.player.rotation = p.dead ? (pick.facing === 'left' ? 1.4 : -1.4) : 0;
    this.player.tint = p.dead ? 0x8a7a80 : 0xffffff;
    // Rage: the transform swells him in white-hot pulses; the form is larger and burns.
    let scale = 1;
    if (p.rageTransform > 0) {
      const k = 1 - p.rageTransform / Math.max(1, cfg.rage.transformFrames);
      scale = 1 + 0.25 * k;
      if (Math.floor(p.rageTransform / 3) % 2 === 0) this.player.texture = tag.flash[fi]!;
    } else if (p.rageForm > 0) {
      scale = 1.25;
      this.player.tint = Math.floor(world.tick / 6) % 2 === 0 ? 0xffb090 : 0xff9070;
      const ending = p.rageForm < 90 && Math.floor(p.rageForm / 5) % 2 === 0; // last 1.5 s flickers
      const auraR = 13 + Math.sin(world.tick * 0.3) * 1.5;
      this.shadows.ellipse(Math.round(ps.x), Math.round(ps.y), auraR * 1.4, auraR * 0.7).fill({ color: SATAN.hellfire, alpha: ending ? 0.15 : 0.35 });
      this.shadows.ellipse(Math.round(ps.x), Math.round(ps.y), auraR, auraR * 0.5).fill({ color: SATAN.ember, alpha: ending ? 0.2 : 0.4 });
      if (world.tick % 3 === 0) this.particles.burst(ps.x + (Math.random() - 0.5) * 14, ps.y - 4 - Math.random() * 20, { count: 1, colors: [SATAN.ember, SATAN.hellfire, SATAN.eyeGlow], speed: 18, life: 0.5, dirX: 0, dirY: -1, spread: 0.8 });
    }
    this.player.scale.set((pick.facing === 'left' ? -1 : 1) * scale, scale);
    this.player.zIndex = pp.x + pp.y;
    this.shadow(pp, 8);
    if (p.dash) {
      // Ember smear behind a dash.
      const back = { x: pp.x - p.dash.dir.x * 10, y: pp.y - p.dash.dir.y * 10 };
      this.fx.poly(proj([...groundCircle(back, 4, 8)])).fill({ color: SATAN.ember, alpha: 0.35 });
    }

    // Ground wake of the slash: the true hitbox shape on the floor (the sprite
    // carries the main smear), then breaking into streaks like the reference.
    if (p.action && p.action.key.startsWith('claw')) {
      // Rage claws: three raking streaks across the hitbox.
      const d = attackDef(cfg, p.action.key);
      const age = p.action.frame - d.startup;
      if (age >= 1 && age <= d.active + 4) {
        const prog = Math.min(1, age / d.active);
        const fade = age > d.active ? 1 - (age - d.active) / 4 : 1;
        const [from, to] = p.action.step === 2 ? [1 - prog, 1] : [0, prog];
        for (const [k, col] of [[0.62, SATAN.crimson], [0.8, SATAN.hellfire], [0.98, SATAN.eyeGlow]] as const) {
          const box = { ...d.hitbox, radius: d.hitbox.radius * k };
          this.fx.poly(proj(arcPoly(p.pos, p.action.dir, box, from, to, 0.9), 3)).fill({ color: col, alpha: 0.85 * fade });
        }
      }
    } else if (p.action && p.action.key !== 'deathblow') {
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
    // Roar rings.
    for (const r of this.roarRings) {
      r.age++;
      const k = r.age / 16;
      const rad = 8 + (cfg.rage.roar.radius - 8) * Math.min(1, k * 1.4);
      this.fx.poly(proj(groundCircle(r.pos, rad, 24), 2)).stroke({ width: 2, color: k < 0.5 ? SATAN.eyeGlow : SATAN.hellfire, alpha: 1 - k });
    }
    this.roarRings = this.roarRings.filter((r) => r.age < 16);
    this.drawPickups(world);

    // Facing marker: a small hellfire arc on the floor where Satan points.
    if (!p.dash && !p.parry && !p.guarding && p.broken === 0 && !p.dead) {
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
      // The last flashLeadFrames of a windup blink white: "it's coming now" —
      // early enough that reacting to it still lands inside the parry window.
      // Ranged windups don't flash (you parry the shot when it arrives, not when it's fired).
      const tele = !!atk && !atk.projectile && !atk.noHit && e.phase === 'windup' && e.phaseFrame > e.windupLen - cfg.combat.telegraph.flashLeadFrames && Math.floor(e.phaseFrame / 3) % 2 === 0;
      const flash = e.hitFlash > 0 || tele;
      // Spawning in: descend from the light and fade up.
      const arriving = e.arrive > 0 ? e.arrive / Math.max(1, cfg.rooms.arriveFrames) : 0;
      s.root.alpha = 1 - arriving * 0.85;
      if (arriving > 0) {
        s.root.position.y -= Math.round(arriving * 30);
        const sp = groundToScreen(ep.x, ep.y);
        this.telegraphs.rect(Math.round(sp.x) - 3, Math.round(sp.y) - 90, 7, 90).fill({ color: HEAVEN.gold1, alpha: 0.35 * arriving });
      }
      if (e.type === 'raphael') {
        const pose = raphaelPose(e);
        const rally = e.phase === 'rally' && Math.floor(e.phaseFrame / 4) % 2 === 0;
        this.redraw(s, `${pose}${flash || rally}${Math.floor(world.tick / 4)}`, () => drawRaphael(s!.body, pose, flash || rally, world.tick));
        if (e.phase === 'rally') {
          const sp = groundToScreen(ep.x, ep.y);
          this.telegraphs.rect(Math.round(sp.x) - 6, Math.round(sp.y) - 120, 13, 120).fill({ color: JUDGEMENT, alpha: 0.35 });
        }
      } else if (e.type === 'zealot') {
        const pose = zealotPose(e);
        const sway = Math.floor(world.tick / 4);
        this.redraw(s, `${pose}${flash}${sway}`, () => drawZealot(s!.body, pose, flash, sway * 4));
      } else if (e.type === 'watcher') {
        const pose = watcherPose(e);
        const lift = pose === 'grounded' ? 0 : Math.round(2 * Math.sin(world.tick * 0.07 + e.id));
        const flap = Math.round(3 * Math.sin(world.tick * 0.12 + e.id));
        const iris = parseInt((cfg.enemies.watcher?.telegraphColor ?? '#ff4a3d').replace('#', ''), 16);
        this.redraw(s, `${pose}${flash}${lift}${flap}${iris}`, () => drawWatcher(s!.body, pose, flash, lift, flap, iris));
      } else if (e.type.startsWith('gabriel')) {
        const pose = gabrielPose(e);
        // Leap: lifted on an arc above his (moving) shadow; a ring marks where he'll land.
        const L = atk?.leap;
        if (L && e.phase === 'active' && e.phaseFrame <= L.frames) {
          const k = e.phaseFrame / L.frames;
          s.root.position.y -= Math.round(Math.sin(Math.PI * k) * L.height);
          const homing = e.phaseFrame <= L.frames * L.homeFrac;
          this.telegraphs.poly(proj(groundCircle(e.leapTo, atk!.hitbox.radius, 24))).fill({ color: ANGEL.lilac, alpha: 0.15 + 0.35 * k });
          this.telegraphs.poly(proj(groundCircle(e.leapTo, atk!.hitbox.radius * (homing ? 1 : 1 - k * 0.5), 24))).stroke({ width: 1, color: ANGEL.angelLine, alpha: 0.8 });
        }
        const rally = e.phase === 'rally' && Math.floor(e.phaseFrame / 4) % 2 === 0;
        this.redraw(s, `${pose}${flash || rally}`, () => drawGabriel(s!.body, pose, flash || rally));
        if (e.phase === 'rally') {
          // Rising light while he rallies into phase two (white-gold, never red).
          const sp = groundToScreen(ep.x, ep.y);
          this.telegraphs.rect(Math.round(sp.x) - 6, Math.round(sp.y) - 120, 13, 120).fill({ color: JUDGEMENT, alpha: 0.35 });
        }
      } else if (e.type === 'cherub') {
        const pose = cherubPose(e);
        const lift = Math.round(2 * Math.sin(world.tick * 0.12 + e.id * 1.7));
        this.redraw(s, `${pose}${flash}${lift}`, () => drawCherub(s!.body, pose, flash, lift));
      } else if (e.type === 'dominion') {
        const pose = dominionPose(e);
        this.redraw(s, `${pose}${flash}${e.shieldFlash > 0}`, () => drawDominion(s!.body, pose, flash, e.shieldFlash > 0));
      } else if (e.type === 'archer') {
        const pose = archerPose(e);
        this.redraw(s, `${pose}${flash}`, () => drawArcher(s!.body, pose, flash));
      } else {
        this.redraw(s, `${flash}`, () => drawDummy(s!.body, flash));
      }
      this.shadow(ep, e.radius);
      this.enemyTelegraph(e, cfg, ep);
      const edef = cfg.enemies[e.type];
      // Cherubs: no bars (one hit kills). Bosses: the big bar at the bottom of the screen.
      if (!edef?.noPosture && !edef?.boss) this.enemyBars(e, ep, e.phase === 'broken' && edef?.flying ? 40 : (edef?.height ?? 40));
      if (world.player.lockId === e.id) this.lockMarker(ep, world.tick);
    }
    for (const [id, s] of this.enemySprites) {
      if (!alive.has(id)) {
        s.root.destroy({ children: true });
        this.enemySprites.delete(id);
      }
    }

    // --- Projectiles ---
    for (const pr of world.projectiles) {
      const gp = { x: lerp(pr.prevPos.x, pr.pos.x, alpha), y: lerp(pr.prevPos.y, pr.pos.y, alpha) };
      const sp = groundToScreen(gp.x, gp.y);
      const v = groundToScreen(pr.vel.x, pr.vel.y);
      const vl = Math.hypot(v.x, v.y) || 1;
      const len = pr.kind === 'bolt' ? 8 : pr.kind === 'laser' ? 26 : 14;
      const tx = (-v.x / vl) * len;
      const ty = (-v.y / vl) * len;
      const x = Math.round(sp.x);
      const y = Math.round(sp.y - (pr.kind === 'laser' ? 28 : 12)); // lasers fly at eye/hand height
      const satans = pr.owner === 'player';
      // Angels' arrows are pale light; anything Satan owns (bolts, reflected arrows) burns red.
      const tail = satans ? (pr.perfect ? SATAN.eyeGlow : SATAN.ember) : pr.kind === 'laser' ? HEAVEN.gold1 : ANGEL.sky2;
      const core = satans ? (pr.kind === 'bolt' ? SATAN.hellfire : pr.perfect ? 0xffffff : SATAN.hellfire) : 0xffffff;
      // Two-tone streak: wide coloured tail with a bright inner line, then a solid head.
      if (pr.kind === 'laser' && !satans) this.fx.moveTo(x, y).lineTo(x + tx, y + ty).stroke({ width: 5, color: ANGEL.sky, alpha: 0.4 }); // pale-blue edge
      this.fx.moveTo(x, y).lineTo(x + tx, y + ty).stroke({ width: 3, color: tail, alpha: 0.55 });
      this.fx.moveTo(x, y).lineTo(x + tx * 0.6, y + ty * 0.6).stroke({ width: 1, color: core, alpha: 0.95 });
      this.fx.rect(x - 1, y - 1, 3, 3).fill(core);
      if (satans) this.fx.rect(x, y, 1, 1).fill(SATAN.eyeGlow);
      this.shadows.ellipse(x, Math.round(sp.y), 2, 1).fill({ color: ANGEL.void, alpha: 0.15 });
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
    const t = e.phase === 'active' ? 1 : e.phaseFrame / Math.max(1, e.windupLen);
    const box = atk.lunge ? { ...atk.hitbox, radius: atk.hitbox.radius + atk.lunge.px } : atk.hitbox;
    if (atk.projectile) {
      // Ranged: a pale line along the shot, brightening as the bow draws.
      if (e.phase === 'windup') {
        const len = Math.min(atk.range, 130);
        const a = groundToScreen(e.pos.x + e.attackDir.x * 8, e.pos.y + e.attackDir.y * 8);
        const b = groundToScreen(e.pos.x + e.attackDir.x * len, e.pos.y + e.attackDir.y * len);
        const locked = e.phaseFrame > atk.trackUntil; // aim is set: sidestep now
        const h = cfg.enemies[e.type]?.height ? 30 : 12;
        this.telegraphs.moveTo(a.x, a.y - h).lineTo(b.x, b.y - h).stroke({ width: locked ? 2 : 1, color: locked ? 0xffffff : ANGEL.lilac, alpha: locked ? 0.85 : 0.15 + 0.5 * t });
      }
      return;
    }
    // Leap: the landing ring is drawn during the flight (see the Gabriel branch); nothing at his feet.
    if (atk.leap) return;
    // Movement-only moves (sidestep, wing-dash) aren't attacks: no telegraph.
    if (atk.noHit) return;
    if (atk.selfHeal) {
      // Mending Rite: a ring of rising healing light around him — strike him to cut it short.
      const k = e.phaseFrame / Math.max(1, e.windupLen);
      this.telegraphs.poly(proj(groundCircle(e.pos, 18 + 10 * k, 20))).stroke({ width: 1, color: ANGEL.glassTeal, alpha: 0.8 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + e.phaseFrame * 0.05;
        const gp = groundToScreen(e.pos.x + Math.cos(a) * 20, e.pos.y + Math.sin(a) * 20);
        const h = (e.phaseFrame * 1.5 + i * 9) % 40;
        this.telegraphs.rect(Math.round(gp.x), Math.round(gp.y - h), 1, 3).fill({ color: 0xffffff, alpha: 0.8 });
      }
      return;
    }
    if (atk.summon) {
      // Horn Call: rings spilling from the trumpet; strike him to cut it short.
      const sp = groundToScreen(ep.x, ep.y);
      for (let k = 0; k < 3; k++) {
        const rr = ((e.phaseFrame * 0.6 + k * 8) % 24) + 4;
        this.telegraphs.ellipse(Math.round(sp.x + 14), Math.round(sp.y - 38), rr, rr * 0.6).stroke({ width: 1, color: HEAVEN.gold1, alpha: 1 - rr / 28 });
      }
      return;
    }
    if (atk.judgement && atk.hitbox.angleDeg >= 360) {
      // Annunciation: a ring of white-gold on the floor, filling toward the strike.
      this.telegraphs.poly(proj(groundCircle(e.pos, atk.hitbox.radius, 32))).fill({ color: JUDGEMENT, alpha: 0.12 + 0.35 * t });
      this.telegraphs.poly(proj(groundCircle(e.pos, atk.hitbox.radius, 32))).stroke({ width: 2, color: HEAVEN.gold2, alpha: 0.9 });
      this.telegraphs.poly(proj(groundCircle(e.pos, atk.hitbox.radius * Math.max(0.05, t), 32))).stroke({ width: 1, color: HEAVEN.gold3, alpha: 0.9 });
      const sp = groundToScreen(ep.x, ep.y);
      if (e.phase === 'active' || Math.floor(e.phaseFrame / 4) % 2 === 0) this.glyph(sp.x, sp.y - 70);
      if (e.phase === 'active') this.fx.poly(proj(groundCircle(e.pos, atk.hitbox.radius, 32), 2)).fill({ color: JUDGEMENT, alpha: 0.8 });
      return;
    }
    if (atk.judgement && atk.hitbox.angleDeg > 90) {
      // A wide Judgement (the Zealot's Sweep): a white-gold crescent filling in, plus the glyph.
      this.telegraphs.poly(proj(arcPoly(e.pos, e.attackDir, atk.hitbox, 0, 1, 0.55))).fill({ color: JUDGEMENT, alpha: 0.15 + 0.45 * t });
      this.telegraphs.poly(proj(arcPoly(e.pos, e.attackDir, atk.hitbox, 0, 1, 0.55))).stroke({ width: 1, color: HEAVEN.gold2, alpha: 0.9 });
      const sp = groundToScreen(ep.x, ep.y);
      if (e.phase === 'active' || Math.floor(e.phaseFrame / 4) % 2 === 0) this.glyph(sp.x, sp.y - 66);
      if (e.phase === 'active') this.fx.poly(proj(arcPoly(e.pos, e.attackDir, atk.hitbox, 0, 1, 0.75), 4)).fill({ color: JUDGEMENT, alpha: 0.85 });
      return;
    }
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

  /** Lock-on marker (Sekiro's dot): hellfire dot on the chest + closing brackets. */
  private lockMarker(ground: Vec2, tick: number): void {
    const sp = groundToScreen(ground.x, ground.y);
    const x = Math.round(sp.x);
    const y = Math.round(sp.y - 17);
    const g = this.fx;
    g.rect(x - 2, y - 2, 5, 5).fill(SATAN.cloak);
    g.rect(x - 1, y - 1, 3, 3).fill(SATAN.hellfire);
    g.rect(x, y, 1, 1).fill(SATAN.eyeGlow);
    const b = 14 + (Math.floor(tick / 8) % 2); // brackets breathe 1px
    const L = 4;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const cx = x + sx * b;
      const cy = y + sy * (b + 2);
      g.rect(sx < 0 ? cx : cx - L + 1, cy, L, 1).fill(SATAN.hellfire);
      g.rect(cx, sy < 0 ? cy : cy - L + 1, 1, L).fill(SATAN.hellfire);
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

  private enemyBars(e: Enemy, ground: Vec2, height = 40): void {
    const sp = groundToScreen(ground.x, ground.y);
    const w = 22;
    const x = Math.round(sp.x - w / 2);
    const y = Math.round(sp.y - height);
    // Health: pearl. Posture: centre-fill gold, white when nearly broken.
    this.fx.rect(x - 1, y - 1, w + 2, 7).fill(ANGEL.void);
    this.fx.rect(x, y, Math.round((w * e.hp) / e.maxHp), 2).fill(ANGEL.pearl);
    const pf = Math.min(1, e.posture / e.postureMax);
    const pw = Math.round(w * pf);
    if (pw > 0) this.fx.rect(x + Math.round((w - pw) / 2), y + 3, pw, 2).fill(pf > 0.8 ? 0xffffff : HEAVEN.gold2);
    if (e.phase === 'recoil') {
      // Riposte opening: pulsing hellfire ring at the feet (red = Satan's opening).
      const k = (e.phaseFrame % 10) / 10;
      const rr = 10 + 4 * k;
      this.fx.ellipse(Math.round(sp.x), Math.round(sp.y), rr, rr * 0.5).stroke({ width: 1, color: SATAN.hellfire, alpha: 1 - k * 0.6 });
      this.fx.ellipse(Math.round(sp.x), Math.round(sp.y), 9, 4.5).stroke({ width: 1, color: SATAN.ember, alpha: 0.8 });
    }
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
    const hpMax = maxHp(world, cfg);
    g.rect(x, y, Math.round((w * p.hp) / hpMax), 5).fill(SATAN.crimson);
    g.rect(x, y, Math.round((w * p.hp) / hpMax), 1).fill(SATAN.hellfire);
    // Rage meter under the pips: embers filling; full = pulsing hellfire with an R; in form = draining.
    {
      const ry = y + 16;
      const R = cfg.rage;
      const inForm = p.rageForm > 0 || p.rageTransform > 0;
      const frac = inForm ? (p.rageTransform > 0 ? 1 : Math.min(1, p.rageForm / R.durationFrames)) : Math.min(1, p.rage / R.max);
      const full = !inForm && p.rage >= R.max;
      g.rect(x - 2, ry - 2, w + 4, 7).fill(SATAN.cloak);
      g.rect(x, ry, w, 3).fill(SATAN.cloak2);
      const pulse = Math.floor(world.tick / 8) % 2 === 0;
      // Distinct from the crimson HP bar: ember while charging, white-gold burning down in form.
      const col = inForm ? (pulse ? SATAN.eyeGlow : 0xffffff) : full ? (pulse ? SATAN.hellfire : SATAN.eyeGlow) : SATAN.ember;
      if (frac > 0) g.rect(x, ry, Math.max(1, Math.round(w * frac)), 3).fill(col);
      if (full) {
        // A tiny pixel "R": the key to press.
        const rx = x + w + 6;
        const r0 = ry - 2;
        g.rect(rx - 1, r0 - 1, 7, 9).fill(SATAN.cloak);
        g.rect(rx, r0, 1, 7).rect(rx + 1, r0, 3, 1).rect(rx + 4, r0 + 1, 1, 2).rect(rx + 1, r0 + 3, 3, 1).rect(rx + 3, r0 + 4, 1, 1).rect(rx + 4, r0 + 5, 1, 2).fill(pulse ? SATAN.hellfire : SATAN.eyeGlow);
      }
    }
    // Vials collected this run: little red flasks after the pips.
    world.vials.forEach((_, i) => {
      const vx = x + 26 + maxPips(world, cfg) * 8 + 4 + i * 7;
      const vy = y + 10;
      g.rect(vx, vy - 3, 2, 2).fill(HEAVEN.gold2);
      g.rect(vx - 1, vy - 1, 4, 4).fill(SATAN.crimson).stroke({ width: 1, color: SATAN.cloak, alignment: 1 });
      g.rect(vx, vy, 1, 1).fill(SATAN.eyeGlow);
    });
    for (let i = 0; i < 3; i++) {
      const lit = p.action ? i < p.action.step : p.comboTimer > 0 && i < p.lastStep;
      g.rect(x + i * 6, y + 9, 4, 2).fill(lit ? SATAN.ember : SATAN.cloak2);
    }
    // Throw pips (E): little hellfire diamonds under the health bar.
    const blink = this.noPipsFlash > 0 && Math.floor(this.noPipsFlash * 20) % 2 === 0;
    const pipsMax = maxPips(world, cfg);
    for (let i = 0; i < pipsMax; i++) {
      const px = x + 26 + i * 8;
      const py = y + 10;
      const full = i < p.pips;
      g.poly([px, py - 3, px + 3, py, px, py + 3, px - 3, py]).fill(blink ? 0xffffff : full ? SATAN.hellfire : SATAN.cloak2).stroke({ width: 1, color: SATAN.cloak });
    }
    // Satan's posture: bottom centre, fills from the centre outward (HUD mock).
    const pw = 140;
    const px = Math.round(VIEW_W / 2 - pw / 2);
    const py = VIEW_H - 14;
    const frac = Math.min(1, p.posture / maxPosture(world, cfg));
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
    g.poly(proj(groundCircle(p.pos, playerRadius(world, cfg)))).stroke({ width: 1, color: p.dash && p.dash.frame >= cfg.player.dash.iFrameStart && p.dash.frame <= cfg.player.dash.iFrameEnd ? 0xffff00 : 0x00ff66 });
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

/**
 * Door icon on a dark plate: one sword = combat, crossed swords = hard,
 * a chalice = rest, a horn = the level's end (the herald). No red: these are Heaven's doors.
 */
function doorIcon(g: Graphics, kind: DoorKind, x: number, y: number, open: boolean): void {
  const ink = open ? HEAVEN.gold1 : HEAVEN.gold2;
  g.rect(x - 7, y - 7, 15, 15).fill(ANGEL.void).stroke({ width: 1, color: open ? HEAVEN.gold1 : HEAVEN.gold3, alignment: 1 });
  const px = (dx: number, dy: number, w = 1, h = 1) => g.rect(x + dx, y + dy, w, h).fill(ink);
  switch (kind) {
    case 'combat':
      px(0, -5, 1, 8); // blade
      px(-2, 2, 5, 1); // guard
      px(0, 3, 1, 2); // grip
      break;
    case 'hard':
      for (let i = 0; i < 9; i++) {
        px(-4 + i, -4 + i);
        px(4 - i, -4 + i);
      }
      px(-4, 2, 3, 1);
      px(2, 2, 3, 1);
      break;
    case 'elite':
      // Wings: an elite waits beyond.
      for (let i = 0; i < 4; i++) {
        px(-5 + i, -3 + i, 1, 1);
        px(5 - i, -3 + i, 1, 1);
      }
      px(-1, -1, 3, 4); // body
      px(-5, -3, 2, 1);
      px(4, -3, 2, 1);
      break;
    case 'setpiece':
      // A bell: something is waiting.
      px(-1, -5, 3, 1);
      px(-2, -4, 5, 4);
      px(-3, 0, 7, 2);
      px(0, 3, 1, 2);
      break;
    case 'secret':
      // An eye.
      px(-4, 0, 9, 1);
      px(-3, -1, 7, 1);
      px(-3, 1, 7, 1);
      g.rect(x - 1, y - 1, 3, 3).fill(ANGEL.void);
      break;
    case 'rest':
      px(-4, -4, 9, 1); // rim
      px(-3, -3, 7, 2);
      px(-2, -1, 5, 1);
      px(0, 0, 1, 3); // stem
      px(-2, 3, 5, 1); // foot
      g.rect(x - 2, y - 3, 5, 1).fill(GARDEN.water);
      break;
    case 'end':
      // The way down: a descending arrow.
      px(0, -5, 1, 7);
      px(-3, 0, 7, 1);
      px(-2, 1, 5, 1);
      px(-1, 2, 3, 1);
      px(0, 3, 1, 1);
      break;
    case 'boss':
      // Herald's horn flaring right.
      px(-5, 0, 2, 1);
      px(-3, -1, 4, 2);
      px(1, -2, 2, 4);
      px(3, -3, 2, 6);
      break;
  }
}

function zealotPose(e: Enemy): ZealotPose {
  if (e.phase === 'broken') return 'broken';
  if (e.phase === 'recoil') return 'stagger';
  if (e.phase === 'flinch') return 'flinch';
  const k = e.attack ?? '';
  if (!k) return 'idle';
  if (k === 'sidestep') return 'sidestep';
  if (k === 'wingdash') return 'wingDash';
  if (k === 'sweep') return e.phase === 'windup' ? 'sweepWindup' : 'sweep';
  if (k === 'thrust') return e.phase === 'windup' ? 'glint' : 'thrust';
  if (k === 'flurry1' && e.phase === 'windup') return 'glint';
  // Alternate swings through a string; wind up on the opposite side.
  const n = Number(k.replace(/\D/g, '')) || 1;
  const a = n % 2 === 1;
  if (e.phase === 'windup') return a ? 'slashB' : 'slashA';
  return a ? 'slashA' : 'slashB';
}

function watcherPose(e: Enemy): WatcherPose {
  if (e.phase === 'broken') return 'grounded';
  if (e.phase === 'recoil') return 'jammed';
  if (e.attack === 'chomp') return e.phase === 'windup' ? 'biteWindup' : e.phase === 'active' ? 'bite' : 'idle';
  if (e.attack === 'laser') return e.phase === 'windup' ? 'charge' : e.phase === 'active' ? 'fire' : 'idle';
  return 'idle';
}

function raphaelPose(e: Enemy): RaphaelPose {
  if (e.phase === 'broken') return 'broken';
  if (e.phase === 'rally') return 'rally';
  if (e.phase === 'recoil') return 'recoil';
  const k = e.attack ?? '';
  if (k === 'rite') return e.phase === 'windup' ? 'rite' : 'idle';
  if (k === 'summon') return 'call';
  if (k === 'serpent') return e.phase === 'windup' ? 'sweepWind' : 'serpent';
  if (k === 'cleave') return e.phase === 'windup' ? 'cleaveWind' : e.phase === 'active' || e.phaseFrame < 10 ? 'cleave' : 'idle';
  if (k.startsWith('sweep')) return e.phase === 'windup' ? 'sweepWind' : e.phase === 'active' || e.phaseFrame < 8 ? 'sweep' : 'idle';
  return 'idle';
}

function gabrielPose(e: Enemy): GabrielPose {
  if (e.phase === 'broken') return 'broken';
  if (e.phase === 'rally') return 'rally';
  if (e.phase === 'recoil') return 'recoil';
  const k = e.attack ?? '';
  if (k === 'leap') return e.phase === 'windup' ? 'crouch' : e.phase === 'active' ? 'air' : 'bladeLow';
  if (k.startsWith('beam')) return 'cast';
  if (k.includes('blade')) {
    // Alternate high and low swings through the string; wind up high.
    const n = Number(k.replace(/\D/g, '').slice(-1)) || 1;
    if (e.phase === 'windup') return n % 2 ? 'bladeHigh' : 'bladeLow';
    return n % 2 ? 'bladeLow' : 'bladeHigh';
  }
  if (k.includes('horn')) return e.phase === 'windup' || e.phase === 'active' ? 'horn' : 'idle';
  if (k === 'trumpet') return 'trumpet';
  if (k === 'annunciation') return 'ring';
  if (k === 'charge') return e.phase === 'windup' ? 'drawBack' : 'charge';
  if (k.includes('thrust')) return e.phase === 'windup' ? 'drawBack' : e.phase === 'active' || e.phaseFrame < 8 ? 'thrust' : 'idle';
  return 'idle';
}

function cherubPose(e: Enemy): CherubPose {
  if (e.phase === 'recoil' || e.phase === 'broken') return 'recoil';
  if (e.phase === 'windup') return 'windup';
  if (e.phase === 'active') return 'lunge';
  return 'idle';
}

function archerPose(e: Enemy): ArcherPose {
  if (e.phase === 'broken') return 'broken';
  if (e.phase === 'recoil') return 'recoil';
  if (e.attack === 'bowBash' && (e.phase === 'active' || e.phase === 'recover')) return 'bash';
  if (e.phase === 'windup' && e.attack !== 'bowBash') return 'draw';
  if (e.phase === 'active' || (e.phase === 'recover' && e.phaseFrame < 10)) return 'loose';
  return 'idle';
}

function dominionPose(e: Enemy): DominionPose {
  if (e.phase === 'broken') return 'broken';
  if (e.phase === 'recoil') return 'recoil';
  if ((e.attack === 'bash' || e.attack === 'spin') && (e.phase === 'active' || e.phase === 'recover')) return 'bash';
  if (e.attack === 'judgement' && e.phase === 'active') return 'lunge';
  if (e.phase === 'windup') return e.attack === 'bash' ? 'guard' : 'drawBack';
  if (e.phase === 'active' || (e.phase === 'recover' && e.phaseFrame < 8)) return 'thrust';
  return 'guard';
}
