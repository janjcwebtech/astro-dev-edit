/**
 * The content file backing a detail page — where the page's real copy lives.
 *
 * Detail routes (e.g. `/area/<slug>/`) render a markdown/MDX entry through a
 * template, so their dynamic text — the title, body prose, etc. — lives in a
 * `.md`/`.mdx` file, not in the `.astro` the source loc points at. Knowing that
 * file is what lets a value point at the source it is actually written in.
 *
 * **The page declares it.** A layout emits
 * `<meta name="astro-dev-edit:page-source" content="src/content/…/x.mdx">`,
 * which needs no server round trip and covers data sources the tool cannot
 * walk. Nothing here guesses a backing file from the URL: an unresolved
 * relationship is named as unresolved rather than inferred.
 *
 * Its own module rather than a corner of a panel: it's a fact about the page,
 * read by unrelated callers, and it must stay importable without dragging in
 * the overlay's DOM-side modules.
 */
const META = 'astro-dev-edit:page-source';

/**
 * The extensions that make a declared backing file **Markdown-backed**.
 *
 * The declaration is deliberately wider than Markdown — it covers data sources
 * the tool cannot walk — so the inspector asks this before deciding a value's
 * words live in an entry rather than in the template. A `.json` backing file is
 * a real declaration and is not this.
 */
const MARKDOWN = /\.(md|mdx|markdown)$/i;

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
      `before 0.7.0. Rename it to "${META}" — until then this page declares no ` +
      'backing source file.',
  );
}

function metaSource(): string | null {
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${META}"]`);
  const content = meta?.content?.trim();
  if (!content) {
    warnLegacyMeta();
    return null;
  }
  return content;
}


/** Told whenever the page's declaration may have changed, so a surface showing
 *  the backing file repaints without each caller of {@link resolvePageSource}
 *  remembering to refresh it. */
const listeners = new Set<() => void>();

export function onPageSourceChange(fn: () => void): void {
  listeners.add(fn);
}

/** The declared backing file, or null. Synchronous: its callers — the
 *  inspector's route anchor and the copied element context among them — run
 *  inside code that cannot await. */
export function pageSource(): string | null {
  return metaSource();
}

/**
 * The declared backing file when it is a Markdown entry, or null.
 *
 * The one question the inspector asks before it says a value is written in a
 * `.md` file, and the only thing that makes that claim honest: the page — its
 * own template, rendering its own entry — is what declared it. Nothing here
 * derives a file from the URL, and nothing guesses which line of it a rendered
 * paragraph came from.
 */
export function markdownSource(): string | null {
  const file = metaSource();
  return file && MARKDOWN.test(file) ? file : null;
}

/**
 * Re-read the page's declaration and tell every listener.
 *
 * Called at boot and after every HMR update: a navigation or a template change
 * can add or remove the meta tag, and the cached answer has to follow.
 */
export async function resolvePageSource(): Promise<void> {
  for (const fn of listeners) fn();
}
