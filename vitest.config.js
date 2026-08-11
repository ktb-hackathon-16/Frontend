import path from 'node:path';
import os from 'node:os';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { transformWithOxc } from 'vite';

const availableWorkers = os.availableParallelism?.() || os.cpus().length || 2;
const defaultMaxWorkers = Math.max(1, Math.floor(availableWorkers / 2));
const maxWorkers = Number(process.env.VITEST_MAX_WORKERS || defaultMaxWorkers);

export default defineConfig({
  plugins: [
    {
      name: 'load-js-files-as-jsx',
      enforce: 'pre',
      async transform(code, id) {
        if (!id.match(/\/(components|features|hooks|lib|pages)\/.*\.js$/)) {
          return null;
        }

        return transformWithOxc(code, id, {
          lang: 'jsx',
          jsx: {
            runtime: 'automatic',
          },
        });
      },
    },
    react({ include: /\.(js|jsx|mjs|ts|tsx)$/ }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.js'],
    maxWorkers,
  },
});
