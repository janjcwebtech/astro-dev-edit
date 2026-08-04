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

export const collections = { blog, works };
