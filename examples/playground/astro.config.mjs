import { defineConfig } from 'astro/config';
import devEdit from 'astro-dev-edit';

// Minimal dev harness for the astro-dev-edit integration.
//
// The integration is dev-only and rides on the data-astro-source-* attributes
// that Astro emits only when the dev toolbar is enabled — so devToolbar stays
// on (it's on by default; left explicit here as a reminder).
export default defineConfig({
  devToolbar: { enabled: true },
  integrations: [
    devEdit({
      // Confine writes to this playground's own source. Defaults would also
      // work, but being explicit documents what the integration touches.
      contentRoots: ['src', 'public'],
      assetDirs: ['src/assets', 'public'],
      // Uploads land beside the existing images (web-servable in prod) rather
      // than in src/assets, so a swapped-in <img src> survives a real build.
      uploadDir: 'public/images',
    }),
  ],
});
