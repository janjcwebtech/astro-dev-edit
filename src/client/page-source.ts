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
export function pageSource(): string | null {
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="astro-dev-edit:page-source"]',
  );
  const content = meta?.content?.trim();
  return content ? content : null;
}
