import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import devEdit from '../../../src/index.ts';

export default defineConfig({
  devToolbar: { enabled: true },
  integrations: [devEdit({ composition: true, entryEditor: false, uploadDir: 'public/uploads',
    contentRoots: ['src', ...readdirSync(new URL('.', import.meta.url)).filter(file => file.endsWith('.astro'))] })],
  vite: {
    resolve: { alias: { '@fixture': fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '') } },
  },
});
