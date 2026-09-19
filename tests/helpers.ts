import { createOptionsResolver, type OptionsResolver, type DevEditOptions } from '../src/server/options.ts';
import type { UsageLink } from '../src/shared/protocol.ts';

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

/**
 * An {@link OptionsResolver} for a test's temp project.
 *
 * Deliberately the **real** resolver rather than a hand-written stub: options
 * now decide write confinement and feature gating, so a suite that asserts a
 * refusal must exercise the same precedence chain production does. Anything
 * passed here arrives as config-level, which is also what makes it `locked` —
 * so a test that wants the *file* layer writes `.astro-dev-edit.json` into
 * `root` and passes nothing here.
 */
export function stubOptions(
  root: string,
  configOptions: DevEditOptions = {},
): OptionsResolver {
  return createOptionsResolver({ root, configOptions });
}


/**
 * How two `data-atx-chain` values relate — the oracle the composition tests
 * read the chain encoding through. Test-only: no production code asks this
 * question, so it does not ship.
 *
 * Pure and lexical; both chains must already be valid. Equal chains identify a
 * shared usage site, not a unique rendered instance.
 */
export function compositionRelation(child: string, ancestor: string, links: readonly UsageLink[] = []): 'slot' | 'same-site' | 'component' | 'unrelated' {
  const parse = (chain: string): string[] | null => chain === '!' ? []
    : /^(?:\.[\w-]{8})+$/.test(chain) ? chain.slice(1).split('.') : null;
  const a = parse(child), b = parse(ancestor);
  if (!a || !b) return 'unrelated';
  const prefix = (x: string[], y: string[]) => x.every((id, i) => id === y[i]);
  if (a.length === b.length && prefix(a, b)) return 'same-site';
  if (a.length < b.length && prefix(a, b)) return 'slot';
  if (a.length > b.length && prefix(b, a)) return 'component';
  // A component supplied through a slot has a DIVERGENT chain: Page→Label
  // inside Page→Card. Only the caller's actual slot range proves this edge.
  const divergence = a.findIndex((id, i) => id !== b[i]);
  const supplied = links.find(link => link.id === a[divergence]);
  const receiver = links.find(link => link.id === b[divergence]);
  if (supplied && receiver && supplied.file === receiver.file &&
    receiver.slots.some(slot => supplied.offset >= slot.start && supplied.offset < slot.end)) return 'slot';
  return 'unrelated';
}
