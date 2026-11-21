/**
 * DOM screens laid over the canvas: title menu, Fallen, Level cleared, the
 * room HUD label, the tutorial prompt line and the room-to-room fade.
 * Plain DOM keeps the text crisp at any scale; the art behind is Pixi.
 */
export type ScreenAction = 'begin' | 'training' | 'title' | 'tutorial' | 'gallery';

export class Screens {
  readonly hud: HTMLDivElement;
  readonly prompt: HTMLDivElement;
  onAction: (a: ScreenAction, arg?: string) => void = () => {};
  private card: HTMLDivElement;
  private title: HTMLDivElement;
  private fallen: HTMLDivElement;
  private cleared: HTMLDivElement;
  private fader: HTMLDivElement;
  private toastEl: HTMLDivElement;
  private boss: HTMLDivElement;
  private bossName: HTMLDivElement;
  private bossHp: HTMLDivElement;
  private bossPosture: HTMLDivElement;
  private bossSegs: HTMLDivElement;
  private toastTimer = 0;

  constructor(root: HTMLElement) {
    this.title = this.panel(root, 'screen title-screen');
    this.fallen = this.panel(root, 'screen end-screen fallen');
    this.cleared = this.panel(root, 'screen end-screen cleared');
    this.hud = this.panel(root, 'room-hud');
    this.prompt = this.panel(root, 'tutorial-prompt');
    this.fader = this.panel(root, 'fader');
    this.card = this.panel(root, 'title-card');
    this.card.hidden = true;
    this.toastEl = this.panel(root, 'toast');
    this.toastEl.hidden = true;
    // Boss bar: name, health (with segment pips), centre-fill posture.
    this.boss = this.panel(root, 'boss-bar');
    this.bossName = document.createElement('div');
    this.bossName.className = 'boss-name';
    this.bossSegs = document.createElement('div');
    this.bossSegs.className = 'boss-segs';
    const hp = document.createElement('div');
    hp.className = 'boss-hp';
    this.bossHp = document.createElement('div');
    hp.appendChild(this.bossHp);
    const po = document.createElement('div');
    po.className = 'boss-posture';
    this.bossPosture = document.createElement('div');
    po.appendChild(this.bossPosture);
    const head = document.createElement('div');
    head.className = 'boss-head';
    head.append(this.bossName, this.bossSegs);
    this.boss.append(head, hp, po);
    this.boss.hidden = true;
    this.fader.hidden = false;
    this.hideAll();
    this.hud.hidden = true;
  }

  private panel(root: HTMLElement, cls: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = cls;
    root.appendChild(d);
    return d;
  }

  private button(parent: HTMLElement, label: string, a: ScreenAction, primary = false): void {
    const b = document.createElement('button');
    b.textContent = label;
    if (primary) b.className = 'primary';
    b.addEventListener('click', () => this.onAction(a));
    parent.appendChild(b);
  }

  get anyOpen(): boolean {
    return !this.title.hidden || !this.fallen.hidden || !this.cleared.hidden;
  }

  get fallenOpen(): boolean {
    return !this.fallen.hidden;
  }

  hideAll(): void {
    this.title.hidden = true;
    this.fallen.hidden = true;
    this.cleared.hidden = true;
    this.prompt.hidden = true;
  }

  /** A short banner (e.g. a vial pickup) that fades after a few seconds. */
  toast(title: string, line: string): void {
    this.toastEl.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'toast-title';
    t.textContent = title;
    const l = document.createElement('div');
    l.textContent = line;
    this.toastEl.append(t, l);
    this.toastEl.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.hidden = true), 3200);
  }

  /** Room title card: layer and level name on entering a new level, the room name every time. */
  titleCard(layer: string, level: string, room: string, newLevel: boolean): void {
    const c = this.card;
    c.innerHTML = '';
    c.className = `title-card${newLevel ? '' : ' small'}`;
    const a = document.createElement('div');
    a.className = 'layer';
    a.textContent = layer.toUpperCase();
    const b = document.createElement('div');
    b.className = 'level';
    b.textContent = level;
    const r = document.createElement('div');
    r.className = 'room';
    r.textContent = room;
    c.append(a, b, r);
    c.hidden = false;
    // Restart the CSS animation.
    void c.offsetWidth;
  }

  showTitle(info: { runs: number; deaths: number; tutorialDone: boolean; rageCarried: number; rageMax: number; gallery?: string[] }): void {
    this.hideAll();
    const t = this.title;
    t.innerHTML = '';
    const h = document.createElement('h1');
    h.textContent = 'Heaven vs Hell';
    const sub = document.createElement('div');
    sub.className = 'subtitle';
    sub.textContent = 'FIGHT YOUR WAY DOWN';
    const menu = document.createElement('div');
    menu.className = 'menu';
    this.button(menu, 'Begin Descent', 'begin', true);
    this.button(menu, 'Training Court', 'training');
    if (info.tutorialDone) this.button(menu, 'Replay tutorial', 'tutorial');
    const stats = document.createElement('div');
    stats.className = 'meta';
    stats.textContent = info.runs > 0 ? `Runs ${info.runs} · Falls ${info.deaths}` : 'Enter to begin';
    t.append(h, sub, menu, stats);
    if (info.gallery?.length) {
      // Dev: room gallery — jump into any room.
      const g = document.createElement('div');
      g.className = 'gallery';
      for (const id of info.gallery) {
        const b = document.createElement('button');
        b.textContent = id;
        b.addEventListener('click', () => this.onAction('gallery', id));
        g.appendChild(b);
      }
      t.appendChild(g);
    }
    if (info.rageCarried > 0) {
      // PDF title mock: "Rage carried over" panel.
      const r = document.createElement('div');
      r.className = 'rage-carry';
      const lab = document.createElement('div');
      lab.textContent = 'RAGE CARRIED OVER';
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('div');
      fill.style.width = `${Math.round((100 * info.rageCarried) / info.rageMax)}%`;
      bar.appendChild(fill);
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = `${info.rageCarried} / ${info.rageMax} from your last falls`;
      r.append(lab, bar, note);
      t.appendChild(r);
    }
    t.hidden = false;
  }

  showFallen(info: { room: string; roomNo: number; kills: number }): void {
    this.hideAll();
    const f = this.fallen;
    f.innerHTML = '';
    const h = document.createElement('h1');
    h.textContent = 'Fallen';
    const p = document.createElement('p');
    p.textContent = `Struck down in ${info.room} (room ${info.roomNo}) · ${info.kills} angels slain here`;
    const menu = document.createElement('div');
    menu.className = 'menu';
    this.button(menu, 'Descend again', 'begin', true);
    this.button(menu, 'Title', 'title');
    f.append(h, p, menu);
    f.hidden = false;
  }

  showCleared(level: string, info: { rooms: number; hp: number; max: number }): void {
    this.hideAll();
    const c = this.cleared;
    c.innerHTML = '';
    const h = document.createElement('h1');
    h.textContent = `${level} — cleared`;
    const p = document.createElement('p');
    p.textContent = `Gabriel has fallen. ${info.rooms} rooms · ${info.hp}/${info.max} health left. The Gilded Nave lies below (coming in M8).`;
    const menu = document.createElement('div');
    menu.className = 'menu';
    this.button(menu, 'Title', 'title', true);
    c.append(h, p, menu);
    c.hidden = false;
  }

  /** Boss bar state each frame; null hides it. */
  setBoss(b: { title: string; hp: number; maxHp: number; posture: number; postureMax: number; segments: number; segmentsMax: number; broken: boolean } | null): void {
    if (!b) {
      this.boss.hidden = true;
      return;
    }
    this.boss.hidden = false;
    if (this.bossName.textContent !== b.title) this.bossName.textContent = b.title;
    const segs = '◆'.repeat(b.segments) + '◇'.repeat(Math.max(0, b.segmentsMax - b.segments));
    if (this.bossSegs.textContent !== segs) this.bossSegs.textContent = segs;
    this.bossHp.style.width = `${Math.max(0, (100 * b.hp) / b.maxHp).toFixed(1)}%`;
    const pf = Math.min(1, b.posture / b.postureMax);
    this.bossPosture.style.width = `${(100 * pf).toFixed(1)}%`;
    this.bossPosture.className = b.broken ? 'broken' : pf > 0.8 ? 'hot' : '';
  }

  setHud(level: string, room: string, n: number, total: number): void {
    this.hud.textContent = `${level.toUpperCase()} · ${room} · ${n}/${total}`;
  }

  /** Quick fade to black, run `mid` (swap rooms), fade back in. */
  fade(mid: () => void): void {
    this.fader.classList.add('on');
    window.setTimeout(() => {
      mid();
      this.fader.classList.remove('on');
    }, 220);
  }
}
