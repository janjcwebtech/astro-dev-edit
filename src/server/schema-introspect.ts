import type { FieldDescriptor, FieldType } from '../shared/protocol.ts';

/**
 * Turn a collection's zod schema into form-field descriptors for the entry
 * panel. Pure and duck-typed: it reads `_def.typeName` off whatever zod v3
 * instance the project's own content config produced — we never import zod at
 * runtime, so there is no dual-instance hazard. Anything unrecognized degrades
 * to `null` (whole schema) or `json` (single field), never an error; the
 * middleware then falls back to value-based inference.
 */

interface ZodLike {
  _def?: Record<string, unknown> & { typeName?: string };
  safeParse?: (v: unknown) => { success: boolean; error?: { issues?: { message: string }[] } };
}

/** Mark used by the schema-function `image()` stub (see content-config.ts). */
export const IMAGE_STUB_DESCRIPTION = 'atx:image';

interface Unwrapped {
  inner: ZodLike;
  required: boolean;
  defaultValue: unknown;
}

/** Peel wrapper types (default/optional/effects/…) down to the terminal type. */
function unwrap(schema: ZodLike): Unwrapped {
  let inner = schema;
  let required = true;
  let defaultValue: unknown;
  // Bounded loop: wrapper chains are short; 20 guards against cyclic defs.
  for (let i = 0; i < 20; i++) {
    const def = inner._def;
    if (!def?.typeName) break;
    switch (def.typeName) {
      case 'ZodDefault': {
        required = false;
        const dv = def.defaultValue;
        try {
          defaultValue = typeof dv === 'function' ? (dv as () => unknown)() : dv;
        } catch {
          /* defaults must never break introspection */
        }
        inner = def.innerType as ZodLike;
        continue;
      }
      case 'ZodOptional':
      case 'ZodNullable':
        required = false;
        inner = def.innerType as ZodLike;
        continue;
      case 'ZodEffects':
        inner = def.schema as ZodLike;
        continue;
      case 'ZodCatch':
        required = false;
        inner = def.innerType as ZodLike;
        continue;
      case 'ZodBranded':
      case 'ZodReadonly':
        inner = def.type as ZodLike;
        continue;
      case 'ZodPipeline':
        inner = def.out as ZodLike;
        continue;
      default:
        return { inner, required, defaultValue };
    }
  }
  return { inner, required, defaultValue };
}

function terminalType(inner: ZodLike): { type: FieldType; options?: string[] } {
  const def = inner._def;
  switch (def?.typeName) {
    case 'ZodString':
      return { type: (def.description === IMAGE_STUB_DESCRIPTION ? 'image' : 'text') };
    case 'ZodDate':
      return { type: 'date' };
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodEnum': {
      const values = def.values;
      if (Array.isArray(values) && values.every((v) => typeof v === 'string')) {
        return { type: 'select', options: values as string[] };
      }
      return { type: 'json' };
    }
    case 'ZodLiteral':
      return typeof def.value === 'string' ? { type: 'text' } : { type: 'json' };
    case 'ZodArray': {
      const el = unwrap(def.type as ZodLike);
      return el.inner._def?.typeName === 'ZodString' ? { type: 'tags' } : { type: 'json' };
    }
    default:
      return { type: 'json' };
  }
}

function humanize(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Field descriptors from a zod object schema, or null when the value isn't
 * one (function schemas the provider couldn't call, zod v4, non-zod, …).
 */
export function zodToFields(schema: unknown): FieldDescriptor[] | null {
  const zs = schema as ZodLike | null | undefined;
  if (!zs || zs._def?.typeName !== 'ZodObject') return null;
  let shape: Record<string, ZodLike>;
  try {
    const rawShape = zs._def.shape;
    shape = (typeof rawShape === 'function' ? rawShape() : rawShape) as Record<string, ZodLike>;
  } catch {
    return null;
  }
  if (!shape || typeof shape !== 'object') return null;

  const fields: FieldDescriptor[] = [];
  for (const [name, field] of Object.entries(shape)) {
    const { inner, required, defaultValue } = unwrap(field);
    const { type, options } = terminalType(inner);
    fields.push({
      name,
      label: humanize(name),
      type,
      required,
      ...(options ? { options } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      present: false, // filled in by the endpoint against the file's data
      source: 'schema',
    });
  }
  return fields;
}

/** The object schema's shape record, or null when unavailable. */
export function shapeOf(schema: unknown): Record<string, unknown> | null {
  const zs = schema as ZodLike | null | undefined;
  if (!zs || zs._def?.typeName !== 'ZodObject') return null;
  try {
    const raw = zs._def.shape;
    const shape = (typeof raw === 'function' ? raw() : raw) as Record<string, unknown>;
    return shape && typeof shape === 'object' ? shape : null;
  } catch {
    return null;
  }
}

/** Our YAML parse keeps dates as strings, but a project's `z.date()` expects a
 *  Date (Astro's own YAML pipeline hands it one) — bridge before validating. */
function coerceForField(field: ZodLike, value: unknown): unknown {
  const { inner } = unwrap(field);
  if (inner._def?.typeName === 'ZodDate' && typeof value === 'string') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return value;
}

/**
 * Validate changed frontmatter keys against the schema, per key. Returns a
 * field→message map (empty when everything passes). Keys the schema doesn't
 * know are allowed through — they're the user's extra data.
 */
export function validateChanges(
  schema: unknown,
  changes: Record<string, unknown>,
): Record<string, string> {
  const shape = shapeOf(schema);
  const errors: Record<string, string> = {};
  if (!shape) return errors;
  for (const [key, value] of Object.entries(changes)) {
    const field = shape[key] as ZodLike | undefined;
    if (value === null) {
      // Deletion: the well-behaved client only sends null for optional fields,
      // but don't trust it — a required key must not be strippable.
      if (field && unwrap(field).required) errors[key] = 'required';
      continue;
    }
    if (!field?.safeParse) continue;
    const result = field.safeParse(coerceForField(field, value));
    if (!result.success) {
      errors[key] = result.error?.issues?.[0]?.message ?? 'invalid value';
    }
  }
  return errors;
}

/** Validate a complete frontmatter object (for /entry/create). */
export function validateFull(
  schema: unknown,
  values: Record<string, unknown>,
): Record<string, string> {
  const shape = shapeOf(schema);
  const errors: Record<string, string> = {};
  if (!shape) return errors;
  for (const [key, field] of Object.entries(shape) as [string, ZodLike][]) {
    if (!field?.safeParse) continue;
    const has = key in values && values[key] !== undefined && values[key] !== '';
    const result = field.safeParse(has ? coerceForField(field, values[key]) : undefined);
    if (!result.success) {
      errors[key] = has
        ? (result.error?.issues?.[0]?.message ?? 'invalid value')
        : 'required';
    }
  }
  return errors;
}

/** Fallback when no schema is resolvable: infer field types from the values
 *  actually present in the entry's frontmatter. Everything is optional. */
export function inferFields(data: Record<string, unknown>): FieldDescriptor[] {
  return Object.entries(data).map(([name, value]) => ({
    name,
    label: humanize(name),
    type: inferType(value),
    required: false,
    present: true,
    source: 'inferred' as const,
  }));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function inferType(value: unknown): FieldType {
  switch (typeof value) {
    case 'string':
      if (DATE_RE.test(value)) return 'date';
      return value.includes('\n') || value.length > 90 ? 'textarea' : 'text';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return 'tags';
      if (value instanceof Date) return 'date';
      return 'json';
  }
}
