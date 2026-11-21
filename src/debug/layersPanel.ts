/**
 * F8: atmosphere layer toggles. Decoration, lighting, parallax and ambient
 * life can be switched off; "hazards" draws the light-pool radii and bell
 * timer; "readability" greys out all decoration so you can check that Satan,
 * enemies and telegraphs still read on their own.
 */
export class LayersPanel {
  readonly flags = { decoration: true, lighting: true, parallax: true, ambient: true, hazards: false, readability: false, hud: true };
  private el: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'layers-panel';
    this.el.hidden = true;
    const title = document.createElement('div');
    title.textContent = 'Layers (F8)';
    this.el.appendChild(title);
    for (const k of Object.keys(this.flags) as (keyof LayersPanel['flags'])[]) {
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = this.flags[k];
      cb.addEventListener('change', () => (this.flags[k] = cb.checked));
      lab.append(cb, ` ${k}`);
      this.el.appendChild(lab);
    }
    root.appendChild(this.el);
  }

  toggle(): void {
    this.el.hidden = !this.el.hidden;
  }
}
