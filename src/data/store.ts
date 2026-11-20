/**
 * Loads every JSON file under /data and keeps it live.
 *
 * Keys are paths relative to /data without the extension, e.g. "tuning/player".
 * Objects are mutated IN PLACE on hot reload or panel edits, so anything that
 * holds a reference (the sim config) sees new values on its next tick.
 */
type Json = Record<string, unknown>;

const modules = import.meta.glob('/data/**/*.json', { eager: true, import: 'default' }) as Record<string, Json>;

const files = new Map<string, Json>();
for (const [path, data] of Object.entries(modules)) {
  files.set(toKey(path), structuredClone(data));
}

type Listener = (key: string) => void;
const listeners = new Set<Listener>();

function toKey(path: string): string {
  return path.replace(/^\/data\//, '').replace(/\.json$/, '');
}

export function getData<T>(key: string): T {
  const f = files.get(key);
  if (!f) throw new Error(`Missing data file: data/${key}.json`);
  return f as T;
}

export function dataKeys(): string[] {
  return [...files.keys()].sort();
}

export function onDataChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Replace contents of a loaded object while preserving its identity (and nested identities). */
function assignInPlace(target: Json, source: Json): void {
  for (const k of Object.keys(target)) if (!(k in source)) delete target[k];
  for (const [k, v] of Object.entries(source)) {
    const cur = target[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      assignInPlace(cur as Json, v as Json);
    } else {
      target[k] = structuredClone(v);
    }
  }
}

export function replaceData(key: string, data: Json): void {
  const cur = files.get(key);
  if (cur) assignInPlace(cur, data);
  else files.set(key, structuredClone(data));
  for (const l of listeners) l(key);
}

/** Set one value by path inside a file (used by the tuning panel). */
export function setDataValue(key: string, path: (string | number)[], value: unknown): void {
  const root = files.get(key);
  if (!root) return;
  let o: any = root;
  for (let i = 0; i < path.length - 1; i++) o = o[path[i]!];
  o[path[path.length - 1]!] = value;
  for (const l of listeners) l(key);
}

/** Write the current in-memory version of a file back to disk (dev server only). */
export async function saveData(key: string): Promise<boolean> {
  const f = files.get(key);
  if (!f || !import.meta.env.DEV) return false;
  const res = await fetch('/__tuning/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, data: f }),
  });
  return res.ok;
}

if (import.meta.hot) {
  import.meta.hot.on('tuning:update', (msg: { key: string; data: Json }) => {
    replaceData(msg.key, msg.data);
  });
}
