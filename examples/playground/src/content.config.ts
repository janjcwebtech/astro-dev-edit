import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Real Astro 5 content collection. Markdown bodies live in src/content/blog/,
// so the integration sees genuine .md targets (frontmatter + body) alongside
// the .astro literals — a fuller test surface than a hardcoded array.
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    excerpt: z.string(),
    date: z.coerce.date(),
    readTime: z.string(),
    author: z.string().default('Jan Cerny'),
    category: z.string().default('Article'),
    image: z.string(),
  }),
});

export const collections = { blog };
