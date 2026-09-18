import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/** One Markdown-backed collection, so the fixture has a route whose words live
 *  in a `.md` file rather than in the template that renders it. */
export const collections = {
  services: defineCollection({
    loader: glob({ pattern: '**/*.md', base: './src/content/services' }),
    schema: z.object({ title: z.string(), excerpt: z.string() }),
  }),
};
