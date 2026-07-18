import { defineConfig } from 'astro/config';
import textEdit from 'astro-text-edit';

// Minimal dev harness for the astro-text-edit integration.
//
// The integration is dev-only and rides on the data-astro-source-* attributes
// that Astro emits only when the dev toolbar is enabled — so devToolbar stays
// on (it's on by default; left explicit here as a reminder).
export default defineConfig({
  devToolbar: { enabled: true },
  integrations: [
    textEdit({
      // Confine writes to this playground's own source. Defaults would also
      // work, but being explicit documents what the integration touches.
      contentRoots: ['src', 'public'],
      assetDirs: ['src/assets', 'public'],
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
