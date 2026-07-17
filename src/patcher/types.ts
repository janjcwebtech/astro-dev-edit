import type { ClassifyResult, RefusalCode, TargetType } from '../shared/protocol.ts';

/**
 * The interface every source patcher implements. Patchers are pure
 * string-in/string-out — no fs access; the middleware reads and writes files.
 * Adding support for a new file type = one implementation + one entry in
 * registry.ts.
 */
export interface Patcher {
  /** Lowercased extensions this patcher handles, with the dot: ['.astro']. */
  extensions: readonly string[];
  /** Classify the element at a source location (AST truth). */
  classify(source: string, req: { loc: string; tag: string }): Promise<ClassifyResult>;
  /** Verify-then-patch. Never writes; returns the new source or a refusal. */
  apply(source: string, req: PatchRequest): Promise<ApplyResult>;
}

export interface PatchRequest {
  /** "line:col" from data-astro-source-loc. */
  loc: string;
  /** Lowercased tag name of the clicked element. */
  tag: string;
  targetType: TargetType;
  /** Rendered text / attr value the client saw. */
  original: string;
  newText: string;
}

/** Server-internal result — `newSource` never crosses the wire. */
export type ApplyResult =
  | { ok: true; newSource: string }
  | { ok: false; code: RefusalCode; error: string };
