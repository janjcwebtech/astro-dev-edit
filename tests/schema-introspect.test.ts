import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  IMAGE_STUB_DESCRIPTION,
  inferFields,
  validateChanges,
  zodToFields,
} from '../src/server/schema-introspect.ts';

function byName(fields: ReturnType<typeof inferFields>, name: string) {
  const f = fields.find((f) => f.name === name);
  if (!f) throw new Error(`field ${name} missing`);
  return f;
}

describe('zodToFields', () => {
  it('maps the playground blog schema', () => {
    const fields = zodToFields(
      z.object({
        title: z.string(),
        excerpt: z.string(),
        date: z.coerce.date(),
        readTime: z.string(),
        author: z.string().default('Jan Cerny'),
        category: z.string().default('Article'),
        image: z.string(),
      }),
    );
    if (!fields) throw new Error('expected fields');
    expect(fields.map((f) => f.name)).toEqual([
      'title', 'excerpt', 'date', 'readTime', 'author', 'category', 'image',
    ]);
    expect(byName(fields, 'title')).toMatchObject({ type: 'text', required: true, source: 'schema' });
    expect(byName(fields, 'date').type).toBe('date');
    expect(byName(fields, 'author')).toMatchObject({ required: false, defaultValue: 'Jan Cerny' });
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

  it('marks the image() stub description as an image field', () => {
    const fields = zodToFields(
      z.object({ cover: z.string().describe(IMAGE_STUB_DESCRIPTION) }),
    );
    expect(fields && byName(fields, 'cover').type).toBe('image');
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

describe('validateChanges', () => {
  const schema = z.object({
    title: z.string(),
    draft: z.boolean().optional(),
    author: z.string().default('Jan Cerny'),
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
