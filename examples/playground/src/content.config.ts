import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Real Astro 5 content collection. Markdown bodies live in src/content/blog/,
// so the integration sees genuine .md targets (frontmatter + body) alongside
// the .astro literals — a fuller test surface than a hardcoded array. The
// field types are chosen to exercise the entry drawer's widgets: strings,
// a date, an enum (→ select), a boolean, and an image path.
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    excerpt: z.string(),
    date: z.coerce.date(),
    readTime: z.string(),
    author: z.string().default('Alex Sand'),
    category: z.enum(['Editing', 'Workflow', 'Astro']).default('Editing'),
    draft: z.boolean().default(false),
    image: z.string(),
  }),
});

// Second collection, deliberately schema-shaped differently from `blog`: it
// uses a *function* schema so it receives Astro's `image()` helper. Those values
// are paths relative to this file, not web URLs, and the integration has to
// preview and write them in that shape — including through `.optional()`, which
// is where the describe() marker hides one level down. `cover` also points into
// a nested asset directory, so the relative maths gets more than one `../`.
const works = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/works' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      summary: z.string(),
      client: z.string().default('Self-directed'),
      year: z.number(),
      cover: image(),
      thumbnail: image().optional(),
      published: z.boolean().default(true),
    }),
});

// Third collection, and the deliberately *un-touched* one. `blog` has field
// overrides in astro.config.mjs and `works` still emits the page-source meta
// tag; this one has neither — no integration config, no meta tag, nothing in
// .astro-dev-edit.json. It is the fresh-install fixture: everything the entry
// drawer offers here has to come from this schema and from auto-detection
// alone. Keep it that way, or the fixture stops being one.
//
// The field types are the plain zod terminals on purpose (no image() helper,
// no .optional()) so a failure here is a failure of detection, not of a widget.
const events = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/events' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    date: z.coerce.date(),
    location: z.string(),
    format: z.enum(['Workshop', 'Talk', 'Meetup']).default('Talk'),
    seats: z.number().default(40),
    soldOut: z.boolean().default(false),
  }),
});

export const collections = { blog, works, events };
