import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

/**
 * Dev-only plugin.
 * 1. When a file under /data changes, push its parsed contents to the client
 *    (event "tuning:update") instead of letting Vite reload the page — the game
 *    keeps running and picks up new values on the next tick.
 * 2. POST /__tuning/save writes the tuning panel's values back to /data.
 */
export function tuningPlugin(): Plugin {
  let dataDir = '';
  const KEY_RE = /^[a-z0-9_\-]+(\/[a-z0-9_\-]+)*$/i;

  return {
    name: 'hvh-tuning',
    apply: 'serve',
    configResolved(cfg) {
      dataDir = path.resolve(cfg.root, 'data');
    },
    handleHotUpdate(ctx) {
      const file = path.resolve(ctx.file);
      if (!file.startsWith(dataDir + path.sep) || !file.endsWith('.json')) return;
      try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        const key = path.relative(dataDir, file).split(path.sep).join('/').replace(/\.json$/, '');
        ctx.server.ws.send({ type: 'custom', event: 'tuning:update', data: { key, data } });
      } catch (e) {
        ctx.server.config.logger.warn(`[tuning] ${path.basename(file)} is not valid JSON yet: ${(e as Error).message}`);
      }
      return []; // swallow: no module HMR, no full reload
    },
    configureServer(server) {
      server.middlewares.use('/__tuning/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const { key, data } = JSON.parse(body) as { key: string; data: unknown };
            if (typeof key !== 'string' || !KEY_RE.test(key) || typeof data !== 'object' || data === null) {
              throw new Error('bad request');
            }
            const target = path.resolve(dataDir, key + '.json');
            if (!target.startsWith(dataDir + path.sep) || !fs.existsSync(target)) throw new Error('unknown file');
            fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n');
            res.statusCode = 200;
            res.end('ok');
          } catch (e) {
            res.statusCode = 400;
            res.end((e as Error).message);
          }
        });
      });
    },
  };
}
