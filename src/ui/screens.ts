/**
 * DOM screens laid over the canvas: title menu, Fallen, Level cleared, the
 * room HUD label, the tutorial prompt line and the room-to-room fade.
 * Plain DOM keeps the text crisp at any scale; the art behind is Pixi.
 */
export type ScreenAction = 'begin' | 'training' | 'title' | 'tutorial';

export class Screens {
  readonly hud: HTMLDivElement;
  readonly prompt: HTMLDivElement;
  onAction: (a: ScreenAction) => void = () => {};
  private title: HTMLDivElement;
  private fallen: HTMLDivElement;
  private cleared: HTMLDivElement;
  private fader: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.title = this.panel(root, 'screen title-screen');
    this.fallen = this.panel(root, 'screen end-screen fallen');
    this.cleared = this.panel(root, 'screen end-screen cleared');
    this.hud = this.panel(root, 'room-hud');
    this.prompt = this.panel(root, 'tutorial-prompt');
    this.fader = this.panel(root, 'fader');
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

  showTitle(info: { runs: number; deaths: number; tutorialDone: boolean }): void {
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
    p.textContent = `${info.rooms} rooms · ${info.hp}/${info.max} health left. The Herald Gabriel waits beyond the gate (coming in M7).`;
    const menu = document.createElement('div');
    menu.className = 'menu';
    this.button(menu, 'Title', 'title', true);
    c.append(h, p, menu);
    c.hidden = false;
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
