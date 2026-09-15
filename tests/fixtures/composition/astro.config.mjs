import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import { createCompositionPlugin } from '../../../src/server/composition-plugin.ts';

export default defineConfig({
  devToolbar: { enabled: true },
  vite: {
    resolve: { alias: { '@fixture': fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '') } },
    plugins: [createCompositionPlugin(fileURLToPath(new URL('.', import.meta.url)))],
  },
});
