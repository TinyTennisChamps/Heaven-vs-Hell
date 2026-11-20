import { Assets, Rectangle, Texture } from 'pixi.js';

/**
 * Loads an Aseprite "JSON (Array)" export plus its PNG. Tags are expected as
 * `<anim>_<down|up|right>`; left is rendered by mirroring right.
 * A `<image>_flash.png` sibling (white silhouette) is used for hit-flash.
 */
export interface AtlasTag {
  frames: Texture[];
  flash: Texture[];
  durations: number[];
  totalMs: number;
}

export interface Atlas {
  tags: Map<string, AtlasTag>;
  pivot: { x: number; y: number };
  frameW: number;
  frameH: number;
}

interface AseJson {
  frames: { filename: string; frame: { x: number; y: number; w: number; h: number }; duration: number }[];
  meta: { image: string; frameTags: { name: string; from: number; to: number }[]; pivot?: { x: number; y: number } };
}

export async function loadAtlas(jsonUrl: string): Promise<Atlas> {
  const json = (await (await fetch(jsonUrl)).json()) as AseJson;
  const base = jsonUrl.slice(0, jsonUrl.lastIndexOf('/') + 1);
  const tex = await Assets.load<Texture>(base + json.meta.image);
  const flashTex = await Assets.load<Texture>(base + json.meta.image.replace(/\.png$/, '_flash.png'));
  tex.source.scaleMode = 'nearest';
  flashTex.source.scaleMode = 'nearest';

  const cut = (t: Texture, f: AseJson['frames'][number]) => new Texture({ source: t.source, frame: new Rectangle(f.frame.x, f.frame.y, f.frame.w, f.frame.h) });
  const tags = new Map<string, AtlasTag>();
  for (const t of json.meta.frameTags) {
    const fr = json.frames.slice(t.from, t.to + 1);
    const durations = fr.map((f) => f.duration);
    tags.set(t.name, {
      frames: fr.map((f) => cut(tex, f)),
      flash: fr.map((f) => cut(flashTex, f)),
      durations,
      totalMs: durations.reduce((a, b) => a + b, 0),
    });
  }
  const f0 = json.frames[0]!.frame;
  return { tags, pivot: json.meta.pivot ?? { x: f0.w / 2, y: f0.h - 4 }, frameW: f0.w, frameH: f0.h };
}

/** Frame index for a time-looped tag at a given clock (ms). */
export function loopFrame(tag: AtlasTag, ms: number): number {
  let t = ms % Math.max(1, tag.totalMs);
  for (let i = 0; i < tag.durations.length; i++) {
    t -= tag.durations[i]!;
    if (t < 0) return i;
  }
  return tag.durations.length - 1;
}
