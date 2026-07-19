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

export const collections = { blog };
