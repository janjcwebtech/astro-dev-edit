import { describe, expect, it } from 'vitest';
import { z as z3 } from 'zod';
import { z as zodV4 } from 'astro/zod';
import {
  IMAGE_STUB_DESCRIPTION,
  inferFields,
  validateChanges,
  zodToFields,
} from '../src/server/schema-introspect.ts';

/**
 * Every assertion runs against both zod majors from the same source: v3 (Astro
 * 5/6) via the devDependency, v4 (Astro 7) via `astro/zod` — the module a real
 * consuming project loads. Equivalent schemas must produce identical
 * descriptors regardless of major.
 */
const MAJORS = [
  { label: 'zod v3', z: z3 },
  { label: 'zod v4', z: zodV4 as unknown as typeof z3 },
] as const;

function byName(fields: ReturnType<typeof inferFields>, name: string) {
  const f = fields.find((f) => f.name === name);
  if (!f) throw new Error(`field ${name} missing`);
  return f;
}

describe.each(MAJORS)('zodToFields · $label', ({ z }) => {
  it('maps the playground blog schema', () => {
    const fields = zodToFields(
      z.object({
        title: z.string(),
        excerpt: z.string(),
        date: z.coerce.date(),
        readTime: z.string(),
        author: z.string().default('Alex Sand'),
        category: z.enum(['Editing', 'Workflow', 'Astro']).default('Editing'),
        draft: z.boolean().default(false),
        image: z.string(),
      }),
    );
    if (!fields) throw new Error('expected fields');
    expect(fields.map((f) => f.name)).toEqual([
      'title', 'excerpt', 'date', 'readTime', 'author', 'category', 'draft', 'image',
    ]);
    expect(byName(fields, 'title')).toMatchObject({ type: 'text', required: true, source: 'schema' });
    expect(byName(fields, 'date').type).toBe('date');
    expect(byName(fields, 'author')).toMatchObject({ required: false, defaultValue: 'Alex Sand' });
    expect(byName(fields, 'category')).toMatchObject({
      type: 'select',
      options: ['Editing', 'Workflow', 'Astro'],
      defaultValue: 'Editing',
    });
    expect(byName(fields, 'draft')).toMatchObject({ type: 'boolean', required: false });
    expect(byName(fields, 'readTime').label).toBe('Read Time');
  });

  it('maps number, boolean, enum, and string arrays', () => {
    const fields = zodToFields(
      z.object({
        views: z.number(),
        draft: z.boolean().optional(),
        status: z.enum(['live', 'archived']),
        tags: z.array(z.string()).default([]),
      }),
    );
    if (!fields) throw new Error('expected fields');
    expect(byName(fields, 'views').type).toBe('number');
    expect(byName(fields, 'draft')).toMatchObject({ type: 'boolean', required: false });
    expect(byName(fields, 'status')).toMatchObject({ type: 'select', options: ['live', 'archived'] });
    expect(byName(fields, 'tags')).toMatchObject({ type: 'tags', defaultValue: [] });
  });

  it('unwraps chained wrappers and effects', () => {
    const fields = zodToFields(
      z.object({
        a: z.string().optional().default('x'),
        b: z.coerce.date().optional(),
        c: z.string().transform((s) => s.trim()),
        d: z.string().nullable(),
      }),
    );
    if (!fields) throw new Error('expected fields');
    expect(byName(fields, 'a')).toMatchObject({ type: 'text', required: false, defaultValue: 'x' });
    expect(byName(fields, 'b')).toMatchObject({ type: 'date', required: false });
    expect(byName(fields, 'c').type).toBe('text');
    expect(byName(fields, 'd')).toMatchObject({ type: 'text', required: false });
  });

  it('marks the image() stub description as a relative-asset image field', () => {
    const fields = zodToFields(
      z.object({
        cover: z.string().describe(IMAGE_STUB_DESCRIPTION),
        // The shape most real image() fields take — the description sits on the
        // inner schema, so it is only found after unwrapping.
        aside: z.string().describe(IMAGE_STUB_DESCRIPTION).optional(),
        // A plain string path is a web URL, not an image() asset: no assetRef,
        // so the picker keeps its existing behaviour for it.
        hero: z.string(),
      }),
    );
    if (!fields) throw new Error('expected fields');
    expect(byName(fields, 'cover')).toMatchObject({ type: 'image', assetRef: 'relative' });
    expect(byName(fields, 'aside')).toMatchObject({
      type: 'image',
      assetRef: 'relative',
      required: false,
    });
    expect(byName(fields, 'hero').type).toBe('text');
    expect(byName(fields, 'hero').assetRef).toBeUndefined();
  });

  it('unwraps readonly to the terminal type', () => {
    const fields = zodToFields(z.object({ slug: z.string().readonly() }));
    expect(fields && byName(fields, 'slug').type).toBe('text');
  });

  it('degrades unknown shapes to json, never throws', () => {
    const fields = zodToFields(
      z.object({
        meta: z.object({ nested: z.string() }),
        mixed: z.union([z.string(), z.number()]),
      }),
    );
    if (!fields) throw new Error('expected fields');
    expect(byName(fields, 'meta').type).toBe('json');
    expect(byName(fields, 'mixed').type).toBe('json');
  });

  it('returns null for non-object schemas and non-zod values', () => {
    expect(zodToFields(z.string())).toBeNull();
    expect(zodToFields(undefined)).toBeNull();
    expect(zodToFields({ not: 'zod' })).toBeNull();
    expect(zodToFields(() => z.object({}))).toBeNull();
  });
});

describe.each(MAJORS)('validateChanges · $label', ({ z }) => {
  const schema = z.object({
    title: z.string(),
    draft: z.boolean().optional(),
    author: z.string().default('Alex Sand'),
  });

  it('allows null-deletion of optional and defaulted keys', () => {
    expect(validateChanges(schema, { draft: null, author: null })).toEqual({});
  });

  it('refuses null-deletion of a required key', () => {
    expect(validateChanges(schema, { title: null })).toEqual({ title: 'required' });
  });

  it('allows null for keys the schema does not know', () => {
    expect(validateChanges(schema, { extra: null })).toEqual({});
  });

  it('accepts a valid change', () => {
    expect(validateChanges(schema, { title: 'New title', draft: true })).toEqual({});
  });

  it('rejects a value of the wrong type', () => {
    const errors = validateChanges(schema, { title: 42, draft: 'yes' });
    expect(Object.keys(errors).sort()).toEqual(['draft', 'title']);
  });

  it('rejects blanking a required field', () => {
    expect(validateChanges(z.object({ title: z.string().min(1) }), { title: '' })).toMatchObject({
      title: expect.any(String),
    });
  });

  it('bridges a YAML date string to a Date for z.date()', () => {
    expect(validateChanges(z.object({ when: z.date() }), { when: '2026-06-11' })).toEqual({});
  });
});

describe('inferFields', () => {
  it('infers types from frontmatter values', () => {
    const fields = inferFields({
      title: 'Short',
      excerpt: 'A sentence that is quite long and rambles on well past the ninety character mark to become a textarea.',
      date: '2026-06-11',
      views: 42,
      draft: false,
      tags: ['a', 'b'],
      meta: { x: 1 },
    });
    expect(byName(fields, 'title').type).toBe('text');
    expect(byName(fields, 'excerpt').type).toBe('textarea');
    expect(byName(fields, 'date').type).toBe('date');
    expect(byName(fields, 'views').type).toBe('number');
    expect(byName(fields, 'draft').type).toBe('boolean');
    expect(byName(fields, 'tags').type).toBe('tags');
    expect(byName(fields, 'meta').type).toBe('json');
    expect(fields.every((f) => f.source === 'inferred' && !f.required && f.present)).toBe(true);
  });
});
