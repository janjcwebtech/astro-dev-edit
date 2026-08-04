/**
 * zod-major adapter for schema introspection.
 *
 * Astro 5/6 ship zod v3; Astro 7 ships zod v4 (`astro/zod` re-exports
 * `zod/v4`), which renamed every internal this introspector reads:
 *
 * - `_def.typeName` (`'ZodString'`) → `_def.type` (`'string'`)
 * - enum values `_def.values` (array) → `_def.entries` (object map)
 * - array element `_def.type` → `_def.element` — in v4 `_def.type` is the
 *   *string* `'array'`, so reading it as a schema silently yields nothing
 * - literal `_def.value` → `_def.values[0]` (an array)
 * - `.describe()` writes into `z.globalRegistry`, so `_def.description` is
 *   empty and only the `.description` getter answers
 * - `.brand()` / `.refine()` no longer wrap at all (the kind stays `'string'`),
 *   while `.transform()` produces `pipe{in, out}` whose `out` is a `transform`
 *   node no widget can render — v4 follows `in`, the shape a form must produce.
 *   v3's `ZodPipeline` keeps following `out`, unchanged.
 *
 * Both majors are read **duck-typed** — we never import zod, so there is no
 * dual-instance hazard and no peer dependency on it. Anything unrecognized
 * yields `null` and the caller degrades to value inference rather than erroring.
 */

export interface ZodNode {
  _def?: Record<string, unknown> & { typeName?: unknown; type?: unknown };
  /** Getter on both majors; v4's reads from the global metadata registry. */
  description?: string;
  /** Enum options getter, present on both majors. */
  options?: unknown;
  /** Array element getter, present on both majors. */
  element?: unknown;
  safeParse?: (v: unknown) => { success: boolean; error?: { issues?: { message: string }[] } };
}

export interface Unwrapped {
  /** The terminal schema, with every wrapper peeled off. */
  inner: ZodNode;
  /** False when a wrapper made the field optional (optional/nullable/default/catch). */
  required: boolean;
  /** Resolved schema default, when one was declared. */
  defaultValue: unknown;
}

export interface ZodAdapter {
  major: 3 | 4;
  /** Kind of a node, normalized lowercase: `'string'`, `'object'`, `'optional'`… */
  kind(node: ZodNode): string | null;
  /** Peel wrapper types down to the terminal one. */
  unwrap(node: ZodNode): Unwrapped;
  /** The node's `.describe()` text, if any. Read *after* unwrapping. */
  description(node: ZodNode): string | undefined;
  /** All-string enum values, or null when the enum isn't all strings. */
  enumOptions(node: ZodNode): string[] | null;
  /** An array's element schema. */
  arrayElement(node: ZodNode): ZodNode | null;
  /** A literal's value. */
  literalValue(node: ZodNode): unknown;
  /** An object schema's shape record. */
  shape(node: ZodNode): Record<string, ZodNode> | null;
}

/** A wrapper kind, and which `_def` key holds the schema it wraps. */
interface Wrapper {
  key: string;
  /** This wrapper makes the field optional. */
  optional?: true;
  /** This wrapper makes the field required again, overriding inner optionality. */
  pins?: true;
}

const V3_WRAPPERS: Record<string, Wrapper> = {
  default: { key: 'innerType', optional: true },
  optional: { key: 'innerType', optional: true },
  nullable: { key: 'innerType', optional: true },
  catch: { key: 'innerType', optional: true },
  effects: { key: 'schema' },
  // `ZodBranded` holds its inner schema on `_def.type`; `ZodReadonly` on
  // `_def.innerType`. They are not interchangeable — reading `type` for
  // readonly silently fails to unwrap and the field degrades to `json`.
  branded: { key: 'type' },
  readonly: { key: 'innerType' },
  pipeline: { key: 'out' },
};

const V4_WRAPPERS: Record<string, Wrapper> = {
  default: { key: 'innerType', optional: true },
  prefault: { key: 'innerType', optional: true },
  optional: { key: 'innerType', optional: true },
  nullable: { key: 'innerType', optional: true },
  catch: { key: 'innerType', optional: true },
  readonly: { key: 'innerType' },
  nonoptional: { key: 'innerType', pins: true },
  pipe: { key: 'in' },
};

/** Kinds whose `_def.defaultValue` supplies the field's default. */
const DEFAULT_KINDS = new Set(['default', 'prefault']);

// --- accessors that read the same on both majors -----------------------------
// Each tries the public getter first (both majors expose it), then the
// major-specific `_def` keys, guarding shape so v4's `_def.type: 'array'`
// string is never mistaken for a schema.

function description(node: ZodNode): string | undefined {
  const own = node.description;
  if (typeof own === 'string') return own;
  const fromDef = node._def?.description;
  return typeof fromDef === 'string' ? fromDef : undefined;
}

function allStrings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
    ? (value as string[])
    : null;
}

function enumOptions(node: ZodNode): string[] | null {
  const fromGetter = allStrings(node.options);
  if (fromGetter) return fromGetter;
  const def = node._def ?? {};
  const fromValues = allStrings(def.values); // v3
  if (fromValues) return fromValues;
  const entries = def.entries; // v4 — an object map, not an array
  if (entries && typeof entries === 'object') return allStrings(Object.values(entries));
  return null;
}

function arrayElement(node: ZodNode): ZodNode | null {
  const def = node._def ?? {};
  for (const candidate of [node.element, def.element, def.type]) {
    if (candidate && typeof candidate === 'object') return candidate as ZodNode;
  }
  return null;
}

function literalValue(node: ZodNode): unknown {
  const def = node._def ?? {};
  if (def.value !== undefined) return def.value; // v3
  return Array.isArray(def.values) ? def.values[0] : undefined; // v4
}

function shape(node: ZodNode): Record<string, ZodNode> | null {
  try {
    const raw = node._def?.shape;
    const resolved = typeof raw === 'function' ? (raw as () => unknown)() : raw;
    return resolved && typeof resolved === 'object'
      ? (resolved as Record<string, ZodNode>)
      : null;
  } catch {
    return null;
  }
}

/** Peel wrappers using this major's table. Bounded loop: wrapper chains are
 *  short, and 20 guards against a cyclic definition. */
function makeUnwrap(
  wrappers: Record<string, Wrapper>,
  kind: (node: ZodNode) => string | null,
): (node: ZodNode) => Unwrapped {
  return (schema) => {
    let inner = schema;
    let required = true;
    let pinned = false;
    let defaultValue: unknown;
    for (let i = 0; i < 20; i++) {
      const k = kind(inner);
      const wrapper = k ? wrappers[k] : undefined;
      if (!wrapper) break;
      const def = inner._def ?? {};
      if (wrapper.pins) {
        required = true;
        pinned = true;
      } else if (wrapper.optional && !pinned) {
        required = false;
      }
      if (k && DEFAULT_KINDS.has(k)) {
        const declared = def.defaultValue;
        try {
          // v3 stores a thunk; v4 stores the value itself.
          defaultValue = typeof declared === 'function'
            ? (declared as () => unknown)()
            : declared;
        } catch {
          /* a throwing default must never break introspection */
        }
      }
      const next = def[wrapper.key];
      if (!next || typeof next !== 'object') break;
      inner = next as ZodNode;
    }
    return { inner, required, defaultValue };
  };
}

function kindV3(node: ZodNode): string | null {
  const typeName = node._def?.typeName;
  // 'ZodString' → 'string', matching v4's own naming so callers switch once.
  return typeof typeName === 'string' ? typeName.replace(/^Zod/, '').toLowerCase() : null;
}

function kindV4(node: ZodNode): string | null {
  const type = node._def?.type;
  return typeof type === 'string' ? type : null;
}

const V3: ZodAdapter = {
  major: 3,
  kind: kindV3,
  unwrap: makeUnwrap(V3_WRAPPERS, kindV3),
  description,
  enumOptions,
  arrayElement,
  literalValue,
  shape,
};

const V4: ZodAdapter = {
  major: 4,
  kind: kindV4,
  unwrap: makeUnwrap(V4_WRAPPERS, kindV4),
  description,
  enumOptions,
  arrayElement,
  literalValue,
  shape,
};

/**
 * Pick the adapter for whatever zod instance produced this schema, or null when
 * it isn't a recognizable zod schema at all (a function schema the provider
 * couldn't call, a future major, a plain object).
 */
export function adapterFor(schema: unknown): ZodAdapter | null {
  const def = (schema as ZodNode | null | undefined)?._def;
  if (!def) return null;
  if (typeof def.typeName === 'string') return V3;
  if (typeof def.type === 'string') return V4;
  return null;
}
