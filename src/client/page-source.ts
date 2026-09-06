/**
 * The content file backing a detail page, if the page declares one.
 *
 * Detail routes (e.g. `/area/<slug>/`) render a markdown/MDX entry through a
 * template, so their dynamic text — the title, body prose, etc. — lives in a
 * `.md`/`.mdx` file, not in the `.astro` the source loc points at. Editing that
 * text in place needs expression-following (spec §16.3), which isn't built. As
 * a fast interim (§16.2), a page can opt in by emitting
 *   <meta name="astro-dev-edit:page-source" content="src/content/…/x.mdx">
 * and we surface an "Edit page content" jump-to-source button on the refusal
 * notice, the entry pill, and the copied element context.
 *
 * Its own module rather than a corner of editors/notice.ts: it's a fact about
 * the page, read by three unrelated callers, and it must stay importable
 * without dragging in the overlay's DOM-side modules.
 */
const META = 'astro-dev-edit:page-source';

/** The name this meta carried before the project was renamed in 0.7.0. */
const LEGACY_META = 'astro-text-edit:page-source';

let warnedLegacy = false;

/**
 * A layout still emitting the pre-0.7 name gets one console line saying so.
 *
 * The old name is **not** accepted — there is no migration shim, and quietly
 * honouring it would make the rename meaningless. But the failure it produces
 * on its own is invisible: the entry button hides itself, every entry flow
 * behind it is simply absent, and `/health` still reports the editor as on,
 * because the server knows nothing about a tag only the client reads. That is
 * a one-word fix behind an hour of looking, so it is worth a line.
 */
function warnLegacyMeta(): void {
  if (warnedLegacy) return;
  if (!document.querySelector(`meta[name="${LEGACY_META}"]`)) return;
  warnedLegacy = true;
  console.warn(
    `[astro-dev-edit] This page declares <meta name="${LEGACY_META}">, the name used ` +
      `before 0.7.0. Rename it to "${META}" — until then the entry editor stays hidden ` +
      'on this page.',
  );
}

export function pageSource(): string | null {
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${META}"]`);
  const content = meta?.content?.trim();
  if (!content) {
    warnLegacyMeta();
    return null;
  }
  return content;
}
