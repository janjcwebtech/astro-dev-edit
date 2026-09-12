import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  addCollection,
  addField,
  blankNonCode,
  readCollectionBlocks,
  removeField,
  renderZodField,
  setSchemaForm,
  updateField,
  type SchemaField,
} from '../src/patcher/content-config.ts';
import { IMAGE_STUB_DESCRIPTION } from '../src/server/schema-introspect.ts';
import { zodToFields } from '../src/server/schema-introspect.ts';
import type { FieldType } from '../src/shared/protocol.ts';

/**
 * Characterization tests for the content-config patcher — the module that writes
 * a project's own `src/content.config.ts`, and therefore the riskiest one in the
 * repo. Two things are pinned here above all:
 *
 * 1. **Bytes outside the touched span never move.** Comments, key order and
 *    quoting style survive every patch, the same contract `frontmatter.ts` has.
 * 2. **`renderZodField` and `schema-introspect.ts::terminalType` stay in step.**
 *    The round-trip block at the bottom renders every `FieldType`, evaluates it
 *    with the real zod, reads it back through `zodToFields`, and demands the same
 *    type out. That test is what stops the two halves from drifting.
 */

/** Modeled on the playground's config: `blog` is a plain object schema, `works`
 *  a function schema (the only form with `image()` in scope). Inlined rather
 *  than read from the playground so an edit there can't silently change what
 *  these assertions mean — a separate test below reads the real file. */
const FIXTURE = `import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// A leading comment on the collection.
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    // The teaser, shown on the index page.
    excerpt: z.string(),
    date: z.coerce.date(),
    category: z.enum(['Editing', 'Workflow']).default('Editing'),
    draft: z.boolean().default(false),
  }),
});

const works = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/works' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      year: z.number(),
      cover: image(),
      thumbnail: image().optional(),
    }),
});

export const collections = { blog, works };
`;

/** {@link FIXTURE} with `blog`'s first field replaced by a spread — the shape a
 *  project uses to share a block of fields between two collections. Everything
 *  else about the block is unchanged, which is the point: the fields beside the
 *  spread stay patchable. */
const SPREAD_FIXTURE = FIXTURE.replace('title: z.string(),', '...shared,');

const field = (over: Partial<SchemaField> = {}): SchemaField => ({
  name: 'subtitle',
  type: 'text',
  required: false,
  ...over,
});

/** Everything the patch didn't touch must be byte-identical. Compares the two
 *  sources line by line and returns only the lines that differ. */
function lineDiff(before: string, after: string): { removed: string[]; added: string[] } {
  const b = before.split('\n');
  const a = after.split('\n');
  return {
    removed: b.filter((l) => !a.includes(l) || b.filter((x) => x === l).length > a.filter((x) => x === l).length),
    added: a.filter((l) => !b.includes(l) || a.filter((x) => x === l).length > b.filter((x) => x === l).length),
  };
}

describe('blankNonCode', () => {
  it('blanks strings, comments, templates and regexes but keeps offsets', () => {
    const src = "const a = 'x{y}'; // }\nconst b = `t${1}`; const c = /a\\/}/g;";
    const out = blankNonCode(src);
    expect(out.length).toBe(src.length);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out).not.toContain('{');
    expect(out).not.toContain('}');
    expect(out).toContain('const a =');
  });

  it('leaves a division alone', () => {
    const out = blankNonCode('const half = total / 2; const q = a / b;');
    expect(out).toBe('const half = total / 2; const q = a / b;');
  });
});

describe('readCollectionBlocks', () => {
  it('reads both schema forms, their fields and their registration', () => {
    const blocks = readCollectionBlocks(FIXTURE);
    expect(blocks.map((b) => b.name)).toEqual(['blog', 'works']);

    const blog = blocks[0];
    expect(blog.schemaForm).toBe('object');
    expect(blog.registered).toBe(true);
    expect(blog.fields.map((f) => f.name)).toEqual([
      'title',
      'excerpt',
      'date',
      'category',
      'draft',
    ]);
    expect(blog.fields[3].expr).toBe("z.enum(['Editing', 'Workflow']).default('Editing')");

    const works = blocks[1];
    expect(works.schemaForm).toBe('function');
    expect(works.fields.map((f) => f.name)).toEqual(['title', 'year', 'cover', 'thumbnail']);
    expect(works.fields[3].expr).toBe('image().optional()');
  });

  it('is not fooled by braces and colons inside strings or comments', () => {
    const src = FIXTURE.replace(
      "title: z.string(),\n    // The teaser",
      "title: z.string().describe('a }: {'), // schema: z.object({\n    // The teaser",
    );
    const blog = readCollectionBlocks(src)[0];
    expect(blog.fields.map((f) => f.name)).toEqual([
      'title',
      'excerpt',
      'date',
      'category',
      'draft',
    ]);
  });

  it('reports an unrecognized schema instead of guessing', () => {
    const helper = `import { defineCollection, z } from 'astro:content';
const posts = defineCollection({ schema: buildSchema() });
export const collections = { posts };
`;
    const block = readCollectionBlocks(helper)[0];
    expect(block.schemaForm).toBeNull();
    expect(block.unrecognized).toMatch(/not a plain z.object/);
  });

  it('reads around a spread instead of refusing the whole block', () => {
    const block = readCollectionBlocks(SPREAD_FIXTURE)[0];
    expect(block.schemaForm).toBe('object');
    expect(block.unrecognized).toBeUndefined();
    // The spread is skipped, the literal entries beside it survive intact.
    expect(block.fields.map((f) => f.name)).toEqual(['excerpt', 'date', 'category', 'draft']);
    expect(block.opaqueEntries).toEqual(['...shared']);
  });

  it('reports a computed key the same way, and both kinds together', () => {
    const computed = FIXTURE.replace('title: z.string(),', '[key]: z.string(),');
    expect(readCollectionBlocks(computed)[0].opaqueEntries).toEqual(['[key]: z.string()']);

    const both = SPREAD_FIXTURE.replace('draft: z.boolean().default(false),', '...(flag ? a : b),');
    const block = readCollectionBlocks(both)[0];
    expect(block.schemaForm).toBe('object');
    expect(block.fields.map((f) => f.name)).toEqual(['excerpt', 'date', 'category']);
    // A conditional spread is no more readable than a plain one, and isn't guessed at.
    expect(block.opaqueEntries).toEqual(['...shared', '...(flag ? a : b)']);
  });

  it('still refuses a schema it cannot anchor on at all', () => {
    const unbalanced = FIXTURE.replace('schema: z.object({', 'schema: z.object({{');
    expect(readCollectionBlocks(unbalanced)[0].schemaForm).toBeNull();
  });

  it('marks a block absent from the registry', () => {
    const orphan = FIXTURE.replace('export const collections = { blog, works };', 'export const collections = { blog };');
    expect(readCollectionBlocks(orphan).map((b) => b.registered)).toEqual([true, false]);
  });

  it('reads the playground config, both forms intact', () => {
    // A drift guard: the real file this designer is verified against.
    const path = fileURLToPath(new URL('../examples/playground/src/content.config.ts', import.meta.url));
    const blocks = readCollectionBlocks(readFileSync(path, 'utf8'));
    expect(blocks.map((b) => [b.name, b.schemaForm])).toEqual([
      ['blog', 'object'],
      ['works', 'function'],
      ['events', 'object'],
    ]);
    expect(blocks.every((b) => b.registered && !b.unrecognized)).toBe(true);
  });
});

describe('addField', () => {
  it('inserts one line into a plain object schema and touches nothing else', () => {
    const r = addField(FIXTURE, 'blog', field());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const diff = lineDiff(FIXTURE, r.newSource);
    expect(diff.removed).toEqual([]);
    expect(diff.added).toEqual(['    subtitle: z.string().optional(),']);
    // The comment above `excerpt` and the quoting of the enum are untouched.
    expect(r.newSource).toContain('    // The teaser, shown on the index page.');
    expect(r.newSource).toContain("z.enum(['Editing', 'Workflow'])");
  });

  it('matches the deeper indentation of a function schema', () => {
    const r = addField(FIXTURE, 'works', field({ name: 'client', required: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(lineDiff(FIXTURE, r.newSource).added).toEqual(['      client: z.string(),']);
  });

  it('adds image() to a function schema', () => {
    const r = addField(FIXTURE, 'works', field({ name: 'hero', type: 'image', required: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newSource).toContain('      hero: image(),');
  });

  it('refuses image() on a plain object schema and says what to change', () => {
    const r = addField(FIXTURE, 'blog', field({ name: 'hero', type: 'image' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('unsupported');
    expect(r.error).toMatch(/\(\{ image \}\) => z\.object/);
  });

  it('refuses a duplicate, an unknown collection and an unrecognized schema', () => {
    const dup = addField(FIXTURE, 'blog', field({ name: 'title' }));
    expect(dup.ok === false && dup.code).toBe('exists');
    const gone = addField(FIXTURE, 'notes', field());
    expect(gone.ok === false && gone.code).toBe('missing');
    const helper = addField(
      FIXTURE.replace('schema: z.object({', 'schema: buildSchema({'),
      'blog',
      field(),
    );
    expect(helper.ok === false && helper.code).toBe('unrecognized');
  });

  it('appends past a spread, which is what makes the new field win', () => {
    const r = addField(SPREAD_FIXTURE, 'blog', field());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(lineDiff(SPREAD_FIXTURE, r.newSource).added).toEqual([
      '    subtitle: z.string().optional(),',
    ]);
    expect(r.newSource).toContain('    ...shared,');
  });

  it('keeps a single-line schema on one line', () => {
    const src = `import { defineCollection, z } from 'astro:content';
const tags = defineCollection({ schema: z.object({ name: z.string() }) });
export const collections = { tags };
`;
    const r = addField(src, 'tags', field({ name: 'slug', required: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newSource).toContain('z.object({ name: z.string(), slug: z.string() })');
  });

  it('fills an empty schema', () => {
    const src = `import { defineCollection, z } from 'astro:content';
const tags = defineCollection({
  schema: z.object({}),
});
export const collections = { tags };
`;
    const r = addField(src, 'tags', field({ name: 'name', required: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newSource).toContain('z.object({ name: z.string() })');
  });

  it('supplies the missing comma when the last field has none', () => {
    const src = FIXTURE.replace('draft: z.boolean().default(false),', 'draft: z.boolean().default(false)');
    const r = addField(src, 'blog', field());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newSource).toContain('draft: z.boolean().default(false),\n    subtitle:');
  });
});

describe('updateField', () => {
  it('replaces only the expression, keeping the key and its comment', () => {
    const r = updateField(FIXTURE, 'blog', field({ name: 'excerpt', type: 'textarea', required: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const diff = lineDiff(FIXTURE, r.newSource);
    expect(diff.removed).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(r.newSource).toContain('    // The teaser, shown on the index page.\n    excerpt: z.string(),');
  });

  it('retypes a string to a number', () => {
    const r = updateField(FIXTURE, 'blog', field({ name: 'title', type: 'number', required: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newSource).toContain('title: z.number(),');
  });

  it('rewrites an enum\'s options', () => {
    const r = updateField(
      FIXTURE,
      'blog',
      field({ name: 'category', type: 'select', required: true, options: ['Editing', 'Astro'] }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newSource).toContain("category: z.enum(['Editing', 'Astro']),");
  });

  it('leaves a trailing same-line comment alone', () => {
    const src = FIXTURE.replace('date: z.coerce.date(),', 'date: z.coerce.date(), // published');
    const r = updateField(src, 'blog', field({ name: 'date', type: 'date', required: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newSource).toContain('date: z.coerce.date(), // published');
  });

  it('refuses an unknown field', () => {
    const r = updateField(FIXTURE, 'blog', field({ name: 'nope' }));
    expect(r.ok === false && r.code).toBe('missing');
  });

  it('retypes a field written beside a spread', () => {
    const r = updateField(SPREAD_FIXTURE, 'blog', field({ name: 'draft', type: 'text' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newSource).toContain('    draft: z.string().optional(),');
    expect(r.newSource).toContain('    ...shared,');
  });

  it('refuses a field the spread brings in, and says where to change it', () => {
    const r = updateField(SPREAD_FIXTURE, 'blog', field({ name: 'title' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('missing');
    expect(r.error).toContain('...shared');
    expect(r.error).toMatch(/where it is declared/);
  });
});

describe('removeField', () => {
  it('removes the field\'s own line and nothing else', () => {
    const r = removeField(FIXTURE, 'blog', 'date');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const diff = lineDiff(FIXTURE, r.newSource);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(['    date: z.coerce.date(),']);
  });

  it('leaves a comment above the removed field in place, visible in the diff', () => {
    const r = removeField(FIXTURE, 'blog', 'excerpt');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newSource).toContain('    // The teaser, shown on the index page.\n    date:');
  });

  it('removes the last field without leaving a dangling comma', () => {
    const src = FIXTURE.replace('draft: z.boolean().default(false),', 'draft: z.boolean().default(false)');
    const r = removeField(src, 'blog', 'draft');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newSource).toContain("category: z.enum(['Editing', 'Workflow']).default('Editing')\n  }),");
  });

  it('empties a schema down to z.object({})', () => {
    const src = `import { defineCollection, z } from 'astro:content';
const tags = defineCollection({
  schema: z.object({
    name: z.string(),
  }),
});
export const collections = { tags };
`;
    const r = removeField(src, 'tags', 'name');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newSource).toContain('schema: z.object({\n  }),');
  });

  it('refuses an unknown field', () => {
    const r = removeField(FIXTURE, 'blog', 'nope');
    expect(r.ok === false && r.code).toBe('missing');
  });

  it('removes the entry after a spread, taking its comma and not the spread\'s', () => {
    const r = removeField(SPREAD_FIXTURE, 'blog', 'excerpt');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const diff = lineDiff(SPREAD_FIXTURE, r.newSource);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(['    excerpt: z.string(),']);
    expect(r.newSource).toContain('    ...shared,\n    // The teaser');
  });

  it('removes the last entry after a spread without a dangling comma', () => {
    const src = SPREAD_FIXTURE.replace(
      'draft: z.boolean().default(false),',
      'draft: z.boolean().default(false)',
    );
    const r = removeField(src, 'blog', 'draft');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newSource).toContain("category: z.enum(['Editing', 'Workflow']).default('Editing')\n  }),");
  });

  it('leaves a schema that is nothing but a spread', () => {
    const src = `import { defineCollection, z } from 'astro:content';
const tags = defineCollection({
  schema: z.object({
    ...shared,
    name: z.string(),
  }),
});
export const collections = { tags };
`;
    const r = removeField(src, 'tags', 'name');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newSource).toContain('    ...shared,\n  }),');
  });
});

describe('setSchemaForm', () => {
  it('promotes a plain object schema without moving any other line', () => {
    const r = setSchemaForm(FIXTURE, 'blog', 'function');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const diff = lineDiff(FIXTURE, r.newSource);
    expect(diff.removed).toEqual(['  schema: z.object({']);
    expect(diff.added).toEqual(['  schema: ({ image }) => z.object({']);
    // The field list, its comment and its indentation are untouched.
    expect(r.newSource).toContain('    // The teaser, shown on the index page.');
    expect(r.newSource).toContain('    title: z.string(),');
  });

  it('makes image() renderable where it was refused before', () => {
    const before = addField(FIXTURE, 'blog', field({ name: 'cover', type: 'image' }));
    expect(before.ok).toBe(false);

    const promoted = setSchemaForm(FIXTURE, 'blog', 'function');
    expect(promoted.ok).toBe(true);
    if (!promoted.ok) return;
    const after = addField(promoted.newSource, 'blog', field({ name: 'cover', type: 'image' }));
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.newSource).toContain('cover: image().optional(),');
  });

  it('demotes a function schema that holds no image() field', () => {
    // The image() fields have to go first — that is the guard below.
    let src = FIXTURE;
    for (const name of ['cover', 'thumbnail']) {
      const step = removeField(src, 'works', name);
      expect(step.ok).toBe(true);
      if (!step.ok) return;
      src = step.newSource;
    }
    const r = setSchemaForm(src, 'works', 'object');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newSource).toContain('schema: z.object({');
    expect(r.newSource).not.toContain('({ image })');
  });

  it('refuses to demote while a field still uses image(), naming the fields', () => {
    const r = setSchemaForm(FIXTURE, 'works', 'object');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('unsupported');
    expect(r.error).toContain('cover, thumbnail');
    expect(r.error).toContain('image()');
  });

  it('promotes a schema holding a spread, which is safe in that direction', () => {
    const r = setSchemaForm(SPREAD_FIXTURE, 'blog', 'function');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newSource).toContain('  schema: ({ image }) => z.object({');
    expect(r.newSource).toContain('    ...shared,');
  });

  it('refuses to demote a schema holding a spread, since image() could be in it', () => {
    const up = setSchemaForm(SPREAD_FIXTURE, 'blog', 'function');
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    const down = setSchemaForm(up.newSource, 'blog', 'object');
    expect(down.ok).toBe(false);
    if (down.ok) return;
    expect(down.code).toBe('unsupported');
    expect(down.error).toContain('...shared');
  });

  it('is a no-op when the form already matches', () => {
    const r = setSchemaForm(FIXTURE, 'blog', 'object');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newSource).toBe(FIXTURE);
  });

  it('round-trips: promote then demote returns the original bytes', () => {
    const up = setSchemaForm(FIXTURE, 'blog', 'function');
    expect(up.ok).toBe(true);
    if (!up.ok) return;
    const down = setSchemaForm(up.newSource, 'blog', 'object');
    expect(down.ok).toBe(true);
    if (!down.ok) return;
    expect(down.newSource).toBe(FIXTURE);
  });

  it('refuses a collection it cannot read, and one that is not there', () => {
    const helper = `import { defineCollection, z } from 'astro:content';
const posts = defineCollection({ schema: buildSchema() });
export const collections = { posts };
`;
    const unreadable = setSchemaForm(helper, 'posts', 'function');
    expect(unreadable.ok).toBe(false);
    if (unreadable.ok) return;
    expect(unreadable.code).toBe('unrecognized');

    const missing = setSchemaForm(FIXTURE, 'nope', 'function');
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.code).toBe('missing');
  });
});

describe('addCollection', () => {
  it('appends a block and registers the name', () => {
    const r = addCollection(FIXTURE, {
      name: 'notes',
      dir: 'src/content/notes',
      fields: [
        { name: 'title', type: 'text', required: true },
        { name: 'pinned', type: 'boolean', required: false, defaultValue: false },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newSource).toContain(
      "const notes = defineCollection({\n" +
        "  loader: glob({ pattern: '**/*.md', base: './src/content/notes' }),\n" +
        '  schema: z.object({\n' +
        '    title: z.string(),\n' +
        '    pinned: z.boolean().default(false),\n' +
        '  }),\n' +
        '});\n',
    );
    expect(r.newSource).toContain('export const collections = { blog, works, notes };');
    // Both existing blocks survive untouched.
    expect(readCollectionBlocks(r.newSource).map((b) => b.name)).toEqual(['blog', 'works', 'notes']);
  });

  it('uses the function schema form when a field needs image()', () => {
    const r = addCollection(FIXTURE, {
      name: 'gallery',
      dir: 'src/content/gallery',
      fields: [{ name: 'cover', type: 'image', required: true }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newSource).toContain('  schema: ({ image }) =>\n    z.object({\n      cover: image(),\n    }),');
    expect(readCollectionBlocks(r.newSource)[2].schemaForm).toBe('function');
  });

  it('adds the glob import when the config lacks one', () => {
    const src = `import { defineCollection, z } from 'astro:content';

export const collections = {};
`;
    const r = addCollection(src, { name: 'notes', dir: 'src/content/notes', fields: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newSource).toContain("import { glob } from 'astro/loaders';");
    expect(r.newSource).toContain('export const collections = { notes };');
  });

  it('registers into a multiline registry', () => {
    const src = FIXTURE.replace(
      'export const collections = { blog, works };',
      'export const collections = {\n  blog,\n  works,\n};',
    );
    const r = addCollection(src, { name: 'notes', dir: 'src/content/notes', fields: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newSource).toContain('export const collections = {\n  blog,\n  works,\n  notes,\n};');
  });

  it('refuses a duplicate name, a missing registry and a config that imports nothing', () => {
    const dup = addCollection(FIXTURE, { name: 'blog', dir: 'src/content/blog', fields: [] });
    expect(dup.ok === false && dup.code).toBe('exists');

    const noRegistry = addCollection(
      "import { defineCollection, z } from 'astro:content';\n",
      { name: 'notes', dir: 'src/content/notes', fields: [] },
    );
    expect(noRegistry.ok === false && noRegistry.code).toBe('missing');

    const noImport = addCollection('export const collections = {};\n', {
      name: 'notes',
      dir: 'src/content/notes',
      fields: [],
    });
    expect(noImport.ok === false && noImport.code).toBe('unrecognized');
  });

  it('refuses a name that is not a plain identifier', () => {
    const r = addCollection(FIXTURE, { name: 'my notes', dir: 'src/content/x', fields: [] });
    expect(r.ok === false && r.code).toBe('unsupported');
  });
});

describe('renderZodField ↔ terminalType round trip', () => {
  /** Evaluate a rendered expression with the real zod, using the same `image()`
   *  stub `content-config.ts` hands a function schema. */
  function evaluate(expr: string): unknown {
    const image = (): unknown => z.string().describe(IMAGE_STUB_DESCRIPTION);
    return new Function('z', 'image', `return ${expr};`)(z, image);
  }

  /** Every type the designer can write, with what `zodToFields` must read back.
   *  `textarea` is widget-only — it is stored as a plain string in the schema and
   *  carries its widget in the settings file, so `text` coming back is correct. */
  const CASES: { field: SchemaField; readsBackAs: FieldType }[] = [
    { field: field({ type: 'text', required: true }), readsBackAs: 'text' },
    { field: field({ type: 'textarea', required: true }), readsBackAs: 'text' },
    { field: field({ type: 'date', required: true }), readsBackAs: 'date' },
    { field: field({ type: 'number', required: true }), readsBackAs: 'number' },
    { field: field({ type: 'boolean', required: true }), readsBackAs: 'boolean' },
    { field: field({ type: 'tags', required: true }), readsBackAs: 'tags' },
    { field: field({ type: 'select', required: true, options: ['a', 'b'] }), readsBackAs: 'select' },
    { field: field({ type: 'image', required: true }), readsBackAs: 'image' },
  ];

  for (const { field: f, readsBackAs } of CASES) {
    it(`${f.type} survives render → zod → zodToFields`, () => {
      const rendered = renderZodField(f, 'function');
      expect(rendered.ok).toBe(true);
      if (!rendered.ok) return;
      const schema = z.object({ [f.name]: evaluate(rendered.expr) as z.ZodTypeAny });
      const back = zodToFields(schema);
      expect(back).not.toBeNull();
      expect(back![0].type).toBe(readsBackAs);
      expect(back![0].required).toBe(true);
    });
  }

  it('optional and default survive the round trip', () => {
    const opt = renderZodField(field({ type: 'text', required: false }), 'object');
    expect(opt.ok && opt.expr).toBe('z.string().optional()');
    const def = renderZodField(
      field({ type: 'select', required: false, options: ['a', 'b'], defaultValue: 'b' }),
      'object',
    );
    expect(def.ok && def.expr).toBe("z.enum(['a', 'b']).default('b')");
    if (!def.ok) return;
    const back = zodToFields(z.object({ subtitle: evaluate(def.expr) as z.ZodTypeAny }));
    expect(back![0]).toMatchObject({ type: 'select', required: false, defaultValue: 'b' });
  });

  it('renders the enum options and tag defaults it is given', () => {
    const enumField = renderZodField(
      field({ type: 'select', required: true, options: ["it's", 'b'] }),
      'object',
    );
    expect(enumField.ok && enumField.expr).toBe("z.enum(['it\\'s', 'b'])");
    const tags = renderZodField(
      field({ type: 'tags', required: false, defaultValue: ['a', 'b'] }),
      'object',
    );
    expect(tags.ok && tags.expr).toBe("z.array(z.string()).default(['a', 'b'])");
  });

  it('refuses json, an empty select, and a date default', () => {
    expect(renderZodField(field({ type: 'json' }), 'function').ok).toBe(false);
    expect(renderZodField(field({ type: 'select', options: [] }), 'object').ok).toBe(false);
    expect(renderZodField(field({ type: 'date', defaultValue: '2026-01-01' }), 'object').ok).toBe(false);
  });
});
