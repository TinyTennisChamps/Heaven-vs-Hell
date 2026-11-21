/**
 * Web Audio playback for the game's sound effects. Files live in
 * public/sfx/*.mp3 (CC0 / CC BY from Openverse — see public/sfx/CREDITS.txt);
 * cues in data/audio/cues.json layer them with per-layer volume, a random
 * pitch range (so repeats never sound identical) and an optional delay.
 * Caps: maxVoices playing at once, and a per-cue cooldown so a swarm of hits
 * can't stack the same sound. The context starts on the first input (browser
 * autoplay rules). Render-side only — the sim never knows about audio.
 */
export interface CueLayer {
  file: string;
  vol: number;
  pitch: [number, number];
  delay: number;
}
export interface CueDef {
  layers?: CueLayer[];
  variants?: CueLayer[][];
}
/** Cue name → cue. The special `_master` entry holds { volume, maxVoices, cooldownMs }. */
export type CueBook = Record<string, CueDef & { volume?: number; maxVoices?: number; cooldownMs?: number }>;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private voices = 0;
  private last = new Map<string, number>();
  muted = false;
  /** Debug: cues actually played (dev checks). */
  played: string[] = [];

  constructor(private book: CueBook) {}

  /** Create the context and decode every file the cue book references. */
  async load(base: string): Promise<void> {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.book['_master']?.volume ?? 0.8;
    this.master.connect(this.ctx.destination);
    const files = new Set<string>();
    for (const [k, c] of Object.entries(this.book)) {
      if (k.startsWith('_')) continue;
      for (const l of [...(c.layers ?? []), ...(c.variants ?? []).flat()]) files.add(l.file);
    }
    await Promise.all(
      [...files].map(async (f) => {
        try {
          const res = await fetch(`${base}sfx/${f}.mp3`);
          const buf = await this.ctx!.decodeAudioData(await res.arrayBuffer());
          this.buffers.set(f, buf);
        } catch {
          /* a missing file just stays silent */
        }
      }),
    );
    // Browsers start audio suspended until the player interacts.
    const unlock = () => void this.ctx?.resume();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  /** Debug: decoded files and context state. */
  get status() {
    return { files: this.buffers.size, state: this.ctx?.state ?? 'none' };
  }

  has(cue: string): boolean {
    return !!this.book[cue] && !cue.startsWith('_');
  }

  /** Play a cue by name (no-op if unknown, muted, over the voice cap or cooling down). */
  play(cue: string, volume = 1): void {
    const c = this.book[cue];
    const ctx = this.ctx;
    if (!c || !ctx || !this.master || this.muted || ctx.state !== 'running') return;
    const m = this.book['_master'];
    const M = { maxVoices: m?.maxVoices ?? 24, cooldownMs: m?.cooldownMs ?? 35 };
    const now = performance.now();
    if (now - (this.last.get(cue) ?? -1e9) < M.cooldownMs) return;
    this.last.set(cue, now);
    if (this.played.length < 500) this.played.push(cue);
    const layers = c.variants?.length ? c.variants[Math.floor(Math.random() * c.variants.length)]! : (c.layers ?? []);
    for (const l of layers) {
      if (this.voices >= M.maxVoices) return;
      const buf = this.buffers.get(l.file);
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = l.pitch[0] + Math.random() * (l.pitch[1] - l.pitch[0]);
      const g = ctx.createGain();
      g.gain.value = l.vol * volume;
      src.connect(g).connect(this.master);
      this.voices++;
      src.onended = () => this.voices--;
      src.start(ctx.currentTime + l.delay / 1000);
    }
  }

  setVolume(v: number): void {
    if (this.master) this.master.gain.value = v;
  }
}
