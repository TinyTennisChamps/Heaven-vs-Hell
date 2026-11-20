import { defineConfig } from 'vitest/config';
import { tuningPlugin } from './vite-plugin-tuning';

export default defineConfig({
  plugins: [tuningPlugin()],
  server: { port: 5173, open: false },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
