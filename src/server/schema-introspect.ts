import type { FieldDescriptor, FieldType } from '../shared/protocol.ts';
import { adapterFor, type ZodAdapter, type ZodNode } from './zod-adapt.ts';

/**
 * Turn a collection's zod schema into form-field descriptors for the entry
 * panel. Pure and duck-typed: every zod internal is read through
 * `zod-adapt.ts`, which speaks both v3 (Astro 5/6) and v4 (Astro 7) — we never
 * import zod at runtime, so there is no dual-instance hazard. Anything
 * unrecognized degrades to `null` (whole schema) or `json` (single field), never
 * an error; the middleware then falls back to value-based inference.
 */

/** Mark used by the schema-function `image()` stub (see content-config.ts). */
export const IMAGE_STUB_DESCRIPTION = 'atx:image';

interface TerminalDescriptor {
  type: FieldType;
  options?: string[];
  assetRef?: 'relative';
}

function terminalType(a: ZodAdapter, inner: ZodNode): TerminalDescriptor {
  switch (a.kind(inner)) {
    case 'string': {
      // Astro's `image()` is stubbed as a described string (content-config.ts).
      // Its values are paths relative to the *entry file*, not web URLs, so the
      // client needs that flagged to preview and write the right shape.
      return a.description(inner) === IMAGE_STUB_DESCRIPTION
        ? { type: 'image', assetRef: 'relative' }
        : { type: 'text' };
    }
    case 'date':
      return { type: 'date' };
    case 'number':
      return { type: 'number' };
    case 'boolean':
      return { type: 'boolean' };
    case 'enum': {
      const options = a.enumOptions(inner);
      return options ? { type: 'select', options } : { type: 'json' };
    }
    case 'literal':
      return typeof a.literalValue(inner) === 'string' ? { type: 'text' } : { type: 'json' };
    case 'array': {
      const element = a.arrayElement(inner);
      if (!element) return { type: 'json' };
      return a.kind(a.unwrap(element).inner) === 'string' ? { type: 'tags' } : { type: 'json' };
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
 * one (function schemas the provider couldn't call, non-zod, a future major, …).
 */
export function zodToFields(schema: unknown): FieldDescriptor[] | null {
  const a = adapterFor(schema);
  if (!a) return null;
  const root = schema as ZodNode;
  if (a.kind(root) !== 'object') return null;
  const shape = a.shape(root);
  if (!shape) return null;

  const fields: FieldDescriptor[] = [];
  for (const [name, field] of Object.entries(shape)) {
    const { inner, required, defaultValue } = a.unwrap(field);
    const { type, options, assetRef } = terminalType(a, inner);
    fields.push({
      name,
      label: humanize(name),
      type,
      required,
      ...(options ? { options } : {}),
      ...(assetRef ? { assetRef } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      present: false, // filled in by the endpoint against the file's data
      source: 'schema',
    });
  }
  return fields;
}

/** The object schema's shape record, or null when unavailable. */
export function shapeOf(schema: unknown): Record<string, unknown> | null {
  const a = adapterFor(schema);
  if (!a) return null;
  const root = schema as ZodNode;
  return a.kind(root) === 'object' ? a.shape(root) : null;
}

/** Our YAML parse keeps dates as strings, but a project's `z.date()` expects a
 *  Date (Astro's own YAML pipeline hands it one) — bridge before validating.
 *  `z.coerce.date()` accepts the string itself, so this is a no-op for it. */
function coerceForField(a: ZodAdapter, field: ZodNode, value: unknown): unknown {
  const { inner } = a.unwrap(field);
  if (a.kind(inner) === 'date' && typeof value === 'string') {
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
  const a = adapterFor(schema);
  const shape = shapeOf(schema);
  const errors: Record<string, string> = {};
  if (!a || !shape) return errors;
  for (const [key, value] of Object.entries(changes)) {
    const field = shape[key] as ZodNode | undefined;
    if (value === null) {
      // Deletion: the well-behaved client only sends null for optional fields,
      // but don't trust it — a required key must not be strippable.
      if (field && a.unwrap(field).required) errors[key] = 'required';
      continue;
    }
    if (!field?.safeParse) continue;
    const result = field.safeParse(coerceForField(a, field, value));
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
  const a = adapterFor(schema);
  const shape = shapeOf(schema);
  const errors: Record<string, string> = {};
  if (!a || !shape) return errors;
  for (const [key, field] of Object.entries(shape) as [string, ZodNode][]) {
    if (!field?.safeParse) continue;
    const has = key in values && values[key] !== undefined && values[key] !== '';
    const result = field.safeParse(has ? coerceForField(a, field, values[key]) : undefined);
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
