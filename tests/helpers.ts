import fs from 'node:fs';
import path from 'node:path';
import type { SimConfig } from '../src/sim/config';

/** Load a data file straight from disk (tests run in node, not through Vite). */
export function loadData<T>(key: string): T {
  const file = path.resolve(__dirname, '../data', key + '.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

export function testConfig(): SimConfig {
  return {
    player: loadData('tuning/player'),
    feel: loadData('tuning/feel'),
  };
}
