import { describe, expect, it } from 'vitest';
import { z as z3 } from 'zod';
import { z as zodV4 } from 'astro/zod';
import { adapterFor, type ZodNode } from '../src/server/zod-adapt.ts';

/**
 * The accessor tables, pinned against both zod majors that reach us in the
 * wild: v3 from this repo's devDependency (what Astro 5/6 carry) and v4 via
 * `astro/zod` — the exact module a consuming Astro 7 project loads, so this
 * suite breaks if zod's internals move again.
 *
 * `z4` is typed as v3 because the API surface used here is identical across
 * majors; only the internals under test differ. `node()` launders zod's own
 * typed `_def` into the duck-typed shape the adapter reads — the adapter never
 * imports zod, so the two type worlds don't overlap by design.
 */
const z4 = zodV4 as unknown as typeof z3;
const node = (schema: unknown): ZodNode => schema as ZodNode;

const MAJORS = [
  { label: 'v3 (zod devDependency)', z: z3, major: 3 },
  { label: 'v4 (astro/zod)', z: z4, major: 4 },
] as const;

function adapt(schema: unknown) {
  const a = adapterFor(schema);
  if (!a) throw new Error('expected an adapter');
  return a;
}

describe.each(MAJORS)('zod-adapt · $label', ({ z, major }) => {
  it('detects the major from the schema itself', () => {
    expect(adapt(z.object({})).major).toBe(major);
  });

  it('normalizes terminal kinds to lowercase names', () => {
    const a = adapt(z.object({}));
    expect(a.kind(node(z.object({})))).toBe('object');
    expect(a.kind(node(z.string()))).toBe('string');
    expect(a.kind(node(z.number()))).toBe('number');
    expect(a.kind(node(z.boolean()))).toBe('boolean');
    expect(a.kind(node(z.date()))).toBe('date');
    expect(a.kind(node(z.coerce.date()))).toBe('date');
    expect(a.kind(node(z.enum(['a'])))).toBe('enum');
    expect(a.kind(node(z.array(z.string())))).toBe('array');
    expect(a.kind(node(z.literal('x')))).toBe('literal');
  });

  it('peels optional / nullable / catch / readonly to the terminal type', () => {
    const a = adapt(z.object({}));
    for (const schema of [
      z.string().optional(),
      z.string().nullable(),
      z.string().catch('x'),
      z.string().readonly(),
    ]) {
      expect(a.kind(a.unwrap(node(schema)).inner)).toBe('string');
    }
  });

  it('reports optionality and resolves the declared default', () => {
    const a = adapt(z.object({}));
    expect(a.unwrap(node(z.string())).required).toBe(true);
    expect(a.unwrap(node(z.string().optional())).required).toBe(false);
    expect(a.unwrap(node(z.string().nullable())).required).toBe(false);
    // v3 stores a thunk, v4 the raw value — both must resolve to the value.
    expect(a.unwrap(node(z.string().default('hi')))).toMatchObject({
      required: false,
      defaultValue: 'hi',
    });
    expect(a.unwrap(node(z.array(z.string()).default([]))).defaultValue).toEqual([]);
  });

  it('survives a chained wrapper stack', () => {
    const a = adapt(z.object({}));
    const { inner, required, defaultValue } = a.unwrap(node(z.string().optional().default('x')));
    expect(a.kind(inner)).toBe('string');
    expect(required).toBe(false);
    expect(defaultValue).toBe('x');
  });

  it('reads .describe() text after unwrapping', () => {
    const a = adapt(z.object({}));
    const described = z.string().describe('atx:image');
    expect(a.description(node(described))).toBe('atx:image');
    // The wrapper carries nothing — the description sits on the inner schema,
    // which is the shape most real image() fields take.
    expect(a.description(a.unwrap(node(described.optional())).inner)).toBe('atx:image');
    expect(a.description(node(z.string()))).toBeUndefined();
  });

  it('reads enum options', () => {
    const a = adapt(z.object({}));
    expect(a.enumOptions(node(z.enum(['live', 'archived'])))).toEqual(['live', 'archived']);
    expect(a.enumOptions(node(z.string()))).toBeNull();
  });

  it('reads an array element', () => {
    const a = adapt(z.object({}));
    const element = a.arrayElement(node(z.array(z.number())));
    expect(element && a.kind(element)).toBe('number');
  });

  it('reads a literal value', () => {
    const a = adapt(z.object({}));
    expect(a.literalValue(node(z.literal('lit')))).toBe('lit');
    expect(a.literalValue(node(z.literal(7)))).toBe(7);
  });

  it('reads an object shape', () => {
    const a = adapt(z.object({}));
    const shape = a.shape(node(z.object({ a: z.string(), b: z.number() })));
    expect(shape && Object.keys(shape)).toEqual(['a', 'b']);
    expect(a.shape(node(z.string()))).toBeNull();
  });

  it('unwraps a transform back to the shape a form must produce', () => {
    const a = adapt(z.object({}));
    expect(a.kind(a.unwrap(node(z.string().transform((s) => s.trim()))).inner)).toBe('string');
  });

  it('sees through refine and brand', () => {
    const a = adapt(z.object({}));
    expect(a.kind(a.unwrap(node(z.string().refine(() => true))).inner)).toBe('string');
    expect(a.kind(a.unwrap(node(z.string().brand<'B'>())).inner)).toBe('string');
  });
});

describe('zod-adapt · v4-only shapes', () => {
  const a = adapt(z4.object({}));
  // .nonoptional() has no v3 counterpart, so it isn't in the shared typing.
  const v4 = zodV4 as unknown as { string(): { optional(): { nonoptional(): unknown } } };

  it('treats nonoptional as required again, overriding inner optionality', () => {
    expect(a.unwrap(node(v4.string().optional().nonoptional())).required).toBe(true);
  });

  it('follows a pipe input rather than its transform output', () => {
    // `.transform()` yields pipe{in: string, out: transform}; following `out`
    // lands on a node no widget can render.
    const piped = node(z4.string().transform((s) => s.trim()));
    expect(a.kind(piped)).toBe('pipe');
    expect(a.kind(a.unwrap(piped).inner)).toBe('string');
  });
});

describe('adapterFor', () => {
  it('returns null for anything that is not a recognizable zod schema', () => {
    expect(adapterFor(undefined)).toBeNull();
    expect(adapterFor(null)).toBeNull();
    expect(adapterFor({ not: 'zod' })).toBeNull();
    expect(adapterFor(() => z3.object({}))).toBeNull();
    // A future major with an unfamiliar _def must degrade, not guess.
    expect(adapterFor({ _def: { flavour: 'v5' } })).toBeNull();
  });
});
