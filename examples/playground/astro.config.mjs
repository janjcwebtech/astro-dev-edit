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
      // Turn the Unsplash photo source on in the media picker. No key here on
      // purpose: this file is committed and is read by `astro build`. Add one
      // from the overlay's Settings panel (admin bar → Settings), which writes
      // UNSPLASH_ACCESS_KEY into this directory's gitignored .env.local.
      unsplash: {},
      // Entry-editor field tweaks: the schema drives everything else; these
      // just pick nicer widgets than the plain-string default.
      entryEditor: {
        collections: {
          blog: {
            fields: {
              excerpt: { widget: 'textarea' },
              image: { widget: 'image' },
            },
          },
        },
      },
    }),
  ],
});
