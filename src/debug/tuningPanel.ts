import { dataKeys, getData, onDataChanged, saveData, setDataValue } from '../data/store';

/**
 * Live tuning panel (F1). Auto-generates inputs for every number/boolean in the
 * selected data file. Edits apply instantly (the sim reads the same objects);
 * "Save" writes the file back to /data via the dev server.
 */
export class TuningPanel {
  readonly el: HTMLDivElement;
  private body: HTMLDivElement;
  private select: HTMLSelectElement;
  private status: HTMLSpanElement;
  private current = '';
  private editing = false;

  constructor(parent: HTMLElement, filter: (key: string) => boolean = (k) => k.startsWith('tuning/') || k.startsWith('attacks/') || k.startsWith('enemies/')) {
    this.el = document.createElement('div');
    this.el.className = 'tuning-panel';
    this.el.hidden = true;

    const head = document.createElement('div');
    head.className = 'tp-head';
    this.select = document.createElement('select');
    for (const k of dataKeys().filter(filter)) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = k;
      this.select.appendChild(o);
    }
    this.select.addEventListener('change', () => this.show(this.select.value));
    const save = document.createElement('button');
    save.textContent = 'Save';
    save.addEventListener('click', async () => {
      const ok = await saveData(this.current);
      this.flash(ok ? 'saved' : 'save failed (dev server only)');
    });
    this.status = document.createElement('span');
    this.status.className = 'tp-status';
    head.append(this.select, save, this.status);

    this.body = document.createElement('div');
    this.body.className = 'tp-body';
    this.el.append(head, this.body);
    parent.appendChild(this.el);

    onDataChanged((key) => {
      if (key === this.current && !this.editing) {
        this.show(key);
        this.flash('reloaded');
      }
    });
    if (this.select.value) this.show(this.select.value);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  set visible(v: boolean) {
    this.el.hidden = !v;
  }

  private flash(msg: string): void {
    this.status.textContent = msg;
    setTimeout(() => {
      if (this.status.textContent === msg) this.status.textContent = '';
    }, 1500);
  }

  private show(key: string): void {
    this.current = key;
    this.body.replaceChildren();
    this.walk(key, getData<Record<string, unknown>>(key), [], 0);
  }

  private walk(key: string, obj: Record<string, unknown> | unknown[], path: (string | number)[], depth: number): void {
    for (const [k, v] of Object.entries(obj)) {
      const p = [...path, Array.isArray(obj) ? Number(k) : k];
      if (typeof v === 'number' || typeof v === 'boolean') {
        this.body.appendChild(this.row(key, p, v, depth));
      } else if (v && typeof v === 'object') {
        const h = document.createElement('div');
        h.className = 'tp-group';
        h.style.paddingLeft = `${depth * 10}px`;
        h.textContent = String(k);
        this.body.appendChild(h);
        this.walk(key, v as Record<string, unknown>, p, depth + 1);
      }
    }
  }

  private row(key: string, path: (string | number)[], value: number | boolean, depth: number): HTMLElement {
    const row = document.createElement('label');
    row.className = 'tp-row';
    row.style.paddingLeft = `${depth * 10}px`;
    const name = document.createElement('span');
    name.textContent = String(path[path.length - 1]);
    const input = document.createElement('input');
    if (typeof value === 'boolean') {
      input.type = 'checkbox';
      input.checked = value;
      input.addEventListener('change', () => setDataValue(key, path, input.checked));
    } else {
      input.type = 'number';
      input.value = String(value);
      input.step = Number.isInteger(value) ? '1' : '0.01';
      input.addEventListener('input', () => {
        const n = Number(input.value);
        if (!Number.isFinite(n)) return;
        this.editing = true;
        setDataValue(key, path, n);
        this.editing = false;
      });
    }
    row.append(name, input);
    return row;
  }
}
