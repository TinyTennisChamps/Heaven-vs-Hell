import { Container, Graphics } from 'pixi.js';
import { groundToScreen } from '../../core/iso';
import type { InteractableDef } from '../../sim/config';
import type { World } from '../../sim/world';
import { ANGEL, HEAVEN, SATAN } from '../palette';

/**
 * The Gilded Cage's characters and set pieces. Code-drawn placeholders for now;
 * each kind is a named asset slot (`hub/<kind>`) that the hub sprite atlas
 * replaces. Devils are desaturated (never red); only Embers glow ember-orange.
 */
const DEVIL = {
  violet: 0x7d6f8c,
  violetDark: 0x564a63,
  charcoal: 0x4a4650,
  charcoalDark: 0x2f2c34,
  ochre: 0xb8a060,
  ochreDark: 0x86733f,
  teal: 0x6f9490,
  tealDark: 0x4d6b68,
  bone: 0xe6dccb,
  boneDark: 0xb3a78f,
  horn: 0x2a2632,
  eye: 0xf1da94,
} as const;

interface Piece {
  def: InteractableDef;
  g: Graphics;
}

export class HubArt {
  private pieces: Piece[] = [];
  /** Above everything in the world layer: the gold outline and the E prompt. */
  readonly prompt = new Graphics();

  constructor(world: World, entities: Container) {
    for (const def of world.room.interactables ?? []) {
      const g = new Graphics();
      // Gate and Yard sit on the room edge: sort them like doors.
      g.zIndex = def.at[0] + def.at[1] + (def.walkIn ? 0.5 : 0);
      entities.addChild(g);
      this.pieces.push({ def, g });
    }
  }

  draw(world: World): void {
    const t = world.tick;
    for (const { def, g } of this.pieces) {
      g.clear();
      const s = groundToScreen(def.at[0], def.at[1]);
      const x = Math.round(s.x);
      const y = Math.round(s.y);
      switch (def.kind) {
        case 'gate':
          drawGate(g, def, t);
          break;
        case 'yard':
          drawYard(g, def);
          break;
        case 'vael':
          drawVael(g, x, y, t);
          break;
        case 'kesh':
          drawKesh(g, x, y, t);
          break;
        case 'imp':
          drawNib(g, x, y, t);
          break;
        case 'sleeper':
          drawSleeper(g, x, y, t);
          break;
        case 'warden':
          drawWarden(g, x, y, t);
          break;
        case 'codex':
          drawCodex(g, x, y);
          break;
      }
    }
    this.drawPrompt(world);
  }

  /** A soft gold ring at the feet and a little "E" key cap above whoever Satan can talk to. */
  private drawPrompt(world: World): void {
    const g = this.prompt;
    g.clear();
    const id = world.hub?.target;
    const def = id ? world.room.interactables?.find((i) => i.id === id) : undefined;
    if (!def) return;
    const s = groundToScreen(def.at[0], def.at[1]);
    const x = Math.round(s.x);
    const y = Math.round(s.y);
    const pulse = 0.5 + 0.25 * Math.sin(world.tick * 0.15);
    g.ellipse(x, y, 16, 8).stroke({ width: 1, color: HEAVEN.gold2, alpha: pulse });
    const top = y - PROMPT_H[def.kind] - 4 + Math.round(Math.sin(world.tick * 0.1));
    g.roundRect(x - 5, top - 10, 11, 11, 2).fill(HEAVEN.ivory).stroke({ width: 1, color: HEAVEN.gold3 });
    // A 5x7 pixel "E".
    g.rect(x - 2, top - 8, 1, 7).rect(x - 2, top - 8, 5, 1).rect(x - 2, top - 5, 4, 1).rect(x - 2, top - 2, 5, 1).fill(HEAVEN.goldDark);
  }
}

/** Height of each kind above its feet, so the prompt floats over the head. */
const PROMPT_H: Record<InteractableDef['kind'], number> = { vael: 30, kesh: 44, imp: 40, sleeper: 62, warden: 58, codex: 40, gate: 80, yard: 40 };

function shackle(g: Graphics, x: number, y: number): void {
  g.rect(x - 1, y, 3, 2).fill(HEAVEN.gold2).stroke({ width: 1, color: HEAVEN.goldDark, alignment: 1 });
}

function drawVael(g: Graphics, x: number, y: number, t: number): void {
  // Brazier with holy blue-white fire beside him.
  const bx = x + 14;
  g.rect(bx - 4, y - 10, 9, 3).fill(HEAVEN.gold2);
  g.rect(bx - 1, y - 7, 3, 7).fill(HEAVEN.gold3);
  const f = Math.sin(t * 0.3) * 1.5;
  g.ellipse(bx, y - 14, 4, 5 + f).fill({ color: 0xdff0ff, alpha: 0.9 });
  g.ellipse(bx, y - 13, 2, 3).fill(0xffffff);
  // A small gilded cage of Embers on the other side.
  const cx = x - 15;
  g.rect(cx - 5, y - 12, 11, 12).stroke({ width: 1, color: HEAVEN.gold2 });
  for (let k = 0; k < 4; k++) g.circle(cx - 2 + (k % 2) * 4, y - 8 + Math.floor(k / 2) * 4, 1.2 + 0.4 * Math.sin(t * 0.2 + k)).fill(SATAN.ember);
  // Vael: small, hunched, violet, a crown of uneven horns.
  const breathe = Math.round(Math.sin(t * 0.05));
  g.ellipse(x, y - 9 - breathe, 7, 9).fill(DEVIL.violet).stroke({ width: 1, color: DEVIL.violetDark });
  g.ellipse(x, y - 6, 8, 5).fill(DEVIL.charcoalDark); // shawl
  g.circle(x + 1, y - 19 - breathe, 5).fill(DEVIL.violet).stroke({ width: 1, color: DEVIL.violetDark });
  for (const [hx, hh] of [[-4, 5], [-2, 7], [0, 6], [2, 8], [4, 5], [5, 3]] as const) {
    g.moveTo(x + 1 + hx, y - 22 - breathe).lineTo(x + 1 + hx * 1.3, y - 22 - hh - breathe).stroke({ width: 1, color: DEVIL.bone });
  }
  g.rect(x - 1, y - 20 - breathe, 1, 1).rect(x + 3, y - 20 - breathe, 1, 1).fill(DEVIL.eye);
  shackle(g, x - 6, y - 7);
  shackle(g, x + 5, y - 7);
}

function drawKesh(g: Graphics, x: number, y: number, t: number): void {
  // Anvil with a glowing heat spot.
  const ax = x - 16;
  g.rect(ax - 8, y - 9, 16, 4).fill(DEVIL.charcoalDark);
  g.rect(ax - 4, y - 5, 8, 5).fill(DEVIL.charcoal);
  g.ellipse(ax + 1, y - 9, 3, 1).fill({ color: SATAN.ember, alpha: 0.6 + 0.3 * Math.sin(t * 0.1) });
  // Weapon rack behind.
  g.rect(x + 12, y - 30, 2, 30).rect(x + 22, y - 30, 2, 30).rect(x + 12, y - 30, 12, 2).fill(HEAVEN.stoneDark);
  for (let k = 0; k < 3; k++) g.rect(x + 14 + k * 3, y - 27, 1, 20 - k * 3).fill(SATAN.cloak2);
  // Kesh: broad, charcoal, curled black horns, apron, hammer.
  const breathe = Math.round(Math.sin(t * 0.04));
  g.roundRect(x - 11, y - 30 - breathe, 22, 28, 6).fill(DEVIL.charcoal).stroke({ width: 1, color: DEVIL.charcoalDark });
  g.rect(x - 7, y - 20 - breathe, 14, 18).fill(0x5e5244); // apron
  g.circle(x, y - 34 - breathe, 6).fill(DEVIL.charcoal).stroke({ width: 1, color: DEVIL.charcoalDark });
  g.moveTo(x - 5, y - 37 - breathe).quadraticCurveTo(x - 11, y - 42, x - 7, y - 35).stroke({ width: 2, color: DEVIL.horn });
  g.moveTo(x + 5, y - 37 - breathe).quadraticCurveTo(x + 11, y - 42, x + 7, y - 35).stroke({ width: 2, color: DEVIL.horn });
  g.rect(x - 3, y - 35 - breathe, 1, 1).rect(x + 2, y - 35 - breathe, 1, 1).fill(DEVIL.eye);
  g.roundRect(x - 16, y - 26 - breathe, 6, 14, 3).fill(DEVIL.charcoal); // forearm
  g.rect(x - 15, y - 14 - breathe, 1, 10).fill(DEVIL.boneDark); // hammer haft
  g.rect(x - 18, y - 6 - breathe, 7, 4).fill(DEVIL.horn); // hammer head
  shackle(g, x - 14, y - 16 - breathe);
  shackle(g, x + 11, y - 16 - breathe);
}

function drawNib(g: Graphics, x: number, y: number, t: number): void {
  // Broken pillar perch.
  g.rect(x - 6, y - 22, 12, 22).fill(HEAVEN.marble).stroke({ width: 1, color: HEAVEN.stoneDark });
  g.poly([x - 6, y - 22, x - 2, y - 26, x + 3, y - 23, x + 6, y - 25, x + 6, y - 22]).fill(HEAVEN.marble);
  // Nib: tiny ochre imp, big ears, glancing about.
  const look = Math.sin(t * 0.07) > 0 ? 1 : -1;
  const hop = t % 90 < 6 ? -2 : 0;
  const by = y - 26 + hop;
  g.ellipse(x, by - 4, 4, 5).fill(DEVIL.ochre).stroke({ width: 1, color: DEVIL.ochreDark });
  g.circle(x + look, by - 11, 4).fill(DEVIL.ochre).stroke({ width: 1, color: DEVIL.ochreDark });
  g.poly([x - 3 + look, by - 12, x - 9 + look, by - 15, x - 4 + look, by - 9]).fill(DEVIL.ochreDark);
  g.poly([x + 3 + look, by - 12, x + 9 + look, by - 15, x + 4 + look, by - 9]).fill(DEVIL.ochreDark);
  g.rect(x - 2 + look, by - 16, 1, 2).rect(x + 2 + look, by - 16, 1, 2).fill(DEVIL.horn);
  g.rect(x - 1 + look * 2, by - 11, 1, 1).rect(x + 2 + look * 2, by - 11, 1, 1).fill(DEVIL.eye);
  shackle(g, x + 2, by);
}

function drawSleeper(g: Graphics, x: number, y: number, t: number): void {
  const sway = Math.round(Math.sin(t * 0.02) * 1.5);
  const top = y - 70;
  g.moveTo(x, top - 30).lineTo(x + sway, top).stroke({ width: 1, color: HEAVEN.gold3 });
  const cx = x + sway;
  const cy = top + 4;
  // Cage: domed top, bars, a floor plate.
  g.ellipse(cx, cy, 12, 4).stroke({ width: 1, color: HEAVEN.gold2 });
  for (let k = -2; k <= 2; k++) g.rect(cx + k * 5, cy, 1, 30).fill(HEAVEN.gold2);
  g.ellipse(cx, cy + 30, 12, 4).fill(HEAVEN.gold3);
  // The Sleeper, curled up, breathing slowly.
  const b = Math.sin(t * 0.03) * 0.8;
  g.ellipse(cx, cy + 24, 9, 6 + b).fill(DEVIL.teal).stroke({ width: 1, color: DEVIL.tealDark });
  g.circle(cx - 6, cy + 20, 4).fill(DEVIL.teal).stroke({ width: 1, color: DEVIL.tealDark });
  g.moveTo(cx - 8, cy + 17).quadraticCurveTo(cx - 14, cy + 20, cx - 12, cy + 27).stroke({ width: 1, color: DEVIL.bone });
  shackle(g, cx + 4, cy + 26);
  // Shadow of the cage on the floor far below.
  g.ellipse(x, y, 12, 5).fill({ color: ANGEL.void, alpha: 0.12 });
  if (Math.floor(t / 80) % 3 === 0) g.rect(cx + 6, cy + 10 - ((t % 80) >> 4), 2, 1).fill({ color: DEVIL.bone, alpha: 0.7 }); // "z"
}

function drawWarden(g: Graphics, x: number, y: number, t: number): void {
  // Perch.
  g.rect(x - 7, y - 8, 14, 8).fill(HEAVEN.marble).stroke({ width: 1, color: HEAVEN.stoneDark });
  const by = y - 8;
  // Folded wings, robe, spear, and a smooth, faceless head.
  const flutter = Math.round(Math.sin(t * 0.04) * 0.6);
  g.poly([x - 4, by - 36, x - 11 - flutter, by - 30, x - 9, by - 8, x - 4, by - 10]).fill(ANGEL.pearl2).stroke({ width: 1, color: ANGEL.angelLine });
  g.poly([x + 4, by - 36, x + 11 + flutter, by - 30, x + 9, by - 8, x + 4, by - 10]).fill(ANGEL.pearl2).stroke({ width: 1, color: ANGEL.angelLine });
  g.roundRect(x - 5, by - 36, 10, 36, 3).fill(ANGEL.white).stroke({ width: 1, color: ANGEL.angelLine });
  g.rect(x - 5, by - 22, 10, 2).fill(HEAVEN.gold2);
  g.ellipse(x, by - 41, 4, 5).fill(ANGEL.pearl).stroke({ width: 1, color: ANGEL.angelLine });
  g.rect(x + 7, by - 52, 1, 52).fill(HEAVEN.gold3);
  g.poly([x + 7, by - 58, x + 9, by - 52, x + 5, by - 52]).fill(HEAVEN.gold1);
}

function drawCodex(g: Graphics, x: number, y: number): void {
  // A tall marble shelf of old books, a chained tome on a lectern in front.
  g.rect(x - 16, y - 40, 32, 34).fill(HEAVEN.marble).stroke({ width: 1, color: HEAVEN.stoneDark });
  const spines = [0x6b6585, 0x7a5e2a, 0x9ea4b4, 0x564a63, 0x9b8f78, 0x4d6b68];
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < 6; k++) g.rect(x - 14 + k * 5, y - 38 + row * 11, 4, 9 - ((k + row) % 3)).fill(spines[(k + row * 2) % spines.length]!);
  }
  g.rect(x - 2, y - 12, 4, 12).fill(HEAVEN.stone);
  g.poly([x - 8, y - 14, x + 8, y - 14, x + 6, y - 10, x - 6, y - 10]).fill(0x7a5e2a);
  g.moveTo(x - 6, y - 11).lineTo(x - 10, y - 2).stroke({ width: 1, color: HEAVEN.gold2 });
}

/** The Gate Down: a huge gilded gate on the room's back edge, a red glow far below through the bars. */
function drawGate(g: Graphics, def: InteractableDef, t: number): void {
  const half = 26;
  const H = 78;
  const a = groundToScreen(0, def.at[1] - half);
  const b = groundToScreen(0, def.at[1] + half);
  // Through the opening: sky, then far below Satan's hell (the one red allowed: his home).
  g.poly([a.x, a.y, b.x, b.y, b.x, b.y - H, a.x, a.y - H]).fill({ color: ANGEL.sky2, alpha: 0.9 });
  const glow = 0.25 + 0.1 * Math.sin(t * 0.05);
  g.poly([a.x, a.y, b.x, b.y, b.x, b.y - 16, a.x, a.y - 16]).fill({ color: SATAN.blood, alpha: glow });
  g.poly([a.x, a.y, b.x, b.y, b.x, b.y - 6, a.x, a.y - 6]).fill({ color: SATAN.hellfire, alpha: glow * 0.6 });
  // Bars.
  for (let k = 1; k < 10; k++) {
    const q = k / 10;
    const px = a.x + (b.x - a.x) * q;
    const py = a.y + (b.y - a.y) * q;
    g.rect(Math.round(px), Math.round(py - H), 1, H - 10).fill(HEAVEN.gold2);
  }
  // Posts, lintel and an arch crest.
  for (const p of [a, b]) g.rect(Math.round(p.x) - 2, Math.round(p.y - H - 6), 5, H + 6).fill(HEAVEN.gold2).stroke({ width: 1, color: HEAVEN.goldDark, alignment: 1 });
  g.moveTo(a.x, a.y - H - 6).lineTo(b.x, b.y - H - 6).stroke({ width: 3, color: HEAVEN.gold2 });
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - H - 6 };
  g.moveTo(a.x, a.y - H - 6).quadraticCurveTo(m.x, m.y - 26, b.x, b.y - H - 6).stroke({ width: 2, color: HEAVEN.gold3 });
  g.circle(Math.round(m.x), Math.round(m.y - 14), 4).fill(HEAVEN.gold1).stroke({ width: 1, color: HEAVEN.gold3 });
}

/** The Yard: an archway on the front edge leading to the training ground. */
function drawYard(g: Graphics, def: InteractableDef): void {
  const half = 13;
  const H = 34;
  const gy = def.at[1] + 4;
  const a = groundToScreen(def.at[0] - half, gy);
  const b = groundToScreen(def.at[0] + half, gy);
  g.poly([a.x, a.y, b.x, b.y, b.x, b.y - H, a.x, a.y - H]).fill({ color: HEAVEN.sage, alpha: 0.7 });
  for (const p of [a, b]) g.rect(Math.round(p.x) - 2, Math.round(p.y - H), 4, H).fill(HEAVEN.marble).stroke({ width: 1, color: HEAVEN.stoneDark, alignment: 1 });
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - H };
  g.moveTo(a.x, a.y - H).quadraticCurveTo(m.x, m.y - 12, b.x, b.y - H).stroke({ width: 3, color: HEAVEN.marble });
  // A worn practice dummy glimpsed through it.
  g.rect(Math.round(m.x) - 1, Math.round(m.y + 14), 2, 16).fill(HEAVEN.goldDark);
  g.rect(Math.round(m.x) - 5, Math.round(m.y + 18), 10, 2).fill(HEAVEN.goldDark);
  g.circle(Math.round(m.x), Math.round(m.y + 12), 3).fill(HEAVEN.stone);
}
