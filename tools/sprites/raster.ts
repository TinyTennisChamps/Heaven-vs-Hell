import fs from 'node:fs';
import zlib from 'node:zlib';

/** Tiny indexed-colour pixel canvas for generating sprite art in code. -1 = transparent. */
export class Canvas {
  readonly px: Int32Array;

  constructor(readonly w: number, readonly h: number) {
    this.px = new Int32Array(w * h).fill(-1);
  }

  get(x: number, y: number): number {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return this.px[y * this.w + x]!;
  }

  set(x: number, y: number, c: number): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }

  rect(x: number, y: number, w: number, h: number, c: number): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  /** Bresenham line with a square brush of size `thick`. */
  line(x0: number, y0: number, x1: number, y1: number, c: number, thick = 1): void {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      for (let j = 0; j < thick; j++) for (let i = 0; i < thick; i++) this.set(x0 + i, y0 + j, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /** Scanline polygon fill sampled at pixel centres. */
  poly(pts: ReadonlyArray<readonly [number, number]>, c: number): void {
    const ys = pts.map((p) => p[1]);
    const y0 = Math.floor(Math.min(...ys));
    const y1 = Math.ceil(Math.max(...ys));
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        if (a[1] <= sy !== b[1] <= sy) xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.ceil(xs[k]! - 0.5); x <= Math.floor(xs[k + 1]! - 0.5); x++) this.set(x, y, c);
      }
    }
  }

  /** Paint `c` on every empty pixel that touches a filled one (4-neighbour). */
  outline(c: number): void {
    const src = this.px.slice();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (src[y * this.w + x] !== -1) continue;
        const n = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < this.w && yy < this.h && src[yy * this.w + xx] !== -1;
        if (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1)) this.px[y * this.w + x] = c;
      }
    }
  }

  /** Copy non-transparent pixels of `src` onto this canvas, optionally mirrored. */
  blit(src: Canvas, dx: number, dy: number, mirror = false): void {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const c = src.px[y * src.w + x]!;
        if (c !== -1) this.set(dx + (mirror ? src.w - 1 - x : x), dy + y, c);
      }
    }
  }
}

export function writePng(path: string, c: Canvas, map: (col: number) => number = (v) => v): void {
  const raw = Buffer.alloc((c.w * 4 + 1) * c.h);
  for (let y = 0; y < c.h; y++) {
    raw[y * (c.w * 4 + 1)] = 0;
    for (let x = 0; x < c.w; x++) {
      const v = c.px[y * c.w + x]!;
      const o = y * (c.w * 4 + 1) + 1 + x * 4;
      if (v === -1) continue;
      const m = map(v);
      raw[o] = (m >> 16) & 255;
      raw[o + 1] = (m >> 8) & 255;
      raw[o + 2] = m & 255;
      raw[o + 3] = 255;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.w, 0);
  ihdr.writeUInt32BE(c.h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  fs.writeFileSync(path, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
}
