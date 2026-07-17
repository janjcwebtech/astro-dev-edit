/**
 * Shared test helpers.
 *
 * `locOf` computes the "line:col" (1-based, JS string columns) of the first
 * occurrence of `needle` in `source`. Tests use it to derive the
 * data-astro-source-loc an element would be annotated with, per the rules in
 * src/patcher/astro.ts: a text child's own start; an element/expression
 * child's start + 1 (point at the tag name / past the `{`); a childless
 * element's own start + 1 (its tag name).
 */
export function locOf(source: string, needle: string): string {
  const i = source.indexOf(needle);
  if (i < 0) throw new Error(`needle not found in source: ${needle}`);
  const before = source.slice(0, i);
  const lastNl = before.lastIndexOf('\n');
  const line = before.split('\n').length;
  const col = i - lastNl; // lastNl === -1 → i + 1, both 1-based
  return `${line}:${col}`;
}
