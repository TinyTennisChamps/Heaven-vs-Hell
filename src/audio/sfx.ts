/**
 * Sound hooks. Every sim event calls sfx(<event type>); all silent for now.
 * Register real sounds later with setSound(name, play) — no gameplay changes needed.
 */
type Play = () => void;
const sounds = new Map<string, Play>();

export function setSound(name: string, play: Play): void {
  sounds.set(name, play);
}

export function sfx(name: string): void {
  sounds.get(name)?.();
}
