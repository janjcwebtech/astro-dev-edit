import type { EntryResolveRefusal } from '../shared/protocol.ts';
import * as api from './api.ts';
import { has } from './features.ts';

/**
 * The content file backing a detail page — where the page's real copy lives.
 *
 * Detail routes (e.g. `/area/<slug>/`) render a markdown/MDX entry through a
 * template, so their dynamic text — the title, body prose, etc. — lives in a
 * `.md`/`.mdx` file, not in the `.astro` the source loc points at. Knowing that
 * file is what turns the refusal into an "Edit page content" jump and puts the
 * entry drawer in the admin bar.
 *
 * **Two ways to know it, and the page's own declaration wins.** A layout may
 * emit `<meta name="astro-dev-edit:page-source" content="src/content/…/x.mdx">`,
 * which needs no server round trip and covers data sources the tool cannot walk.
 * Otherwise the server resolves it from the URL — see {@link resolvePageSource}
 * — for every collection whose page editing is switched on. The meta tag is
 * checked first on every call, so a page that declares one behaves exactly as it
 * always has.
 *
 * Its own module rather than a corner of editors/notice.ts: it's a fact about
 * the page, read by four unrelated callers, and it must stay importable without
 * dragging in the overlay's DOM-side modules.
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

function metaSource(): string | null {
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${META}"]`);
  const content = meta?.content?.trim();
  if (!content) {
    warnLegacyMeta();
    return null;
  }
  return content;
}

/** What the server last said about this URL. Null until a resolve has landed. */
export interface PageEntryInfo {
  /** The collection the page renders, when one was identified. Set on a
   *  `not-enabled` refusal too, which is what lets the notice name it. */
  collection: string | null;
  /** The entry that was found, editable or not. */
  entryFile: string | null;
  /** Whether `astro.config.mjs` owns the collection's page-editing switch. */
  pageEditingLocked: boolean;
  refusal: EntryResolveRefusal | null;
}

let resolved: string | null = null;
let info: PageEntryInfo | null = null;

/**
 * Told whenever a resolve lands.
 *
 * This module owns the cached answer, so it is the only thing that knows when
 * the answer changed — and the admin bar's entry button is the thing that has
 * to notice. A subscription here beats every caller of {@link resolvePageSource}
 * remembering to refresh the bar afterwards: the refusal notice re-resolves
 * after switching a collection on, and that path gets the refresh for free.
 */
const listeners = new Set<() => void>();

export function onPageSourceChange(fn: () => void): void {
  listeners.add(fn);
}

/**
 * The backing entry, or null.
 *
 * **Stays synchronous.** Its four callers — the admin bar's visibility
 * predicate, the entry button's click, the refusal notice and the copied
 * element context — all run inside code that cannot await, and the bar
 * re-evaluates them on every `refresh()` anyway. So the async half writes into
 * a cache and this reads it, rather than the callers changing shape.
 */
export function pageSource(): string | null {
  return metaSource() ?? resolved;
}

/** What the last resolve found, for a caller that needs the refusal and not
 *  just the file — the notice's offer to switch a collection on. */
export function pageEntryInfo(): PageEntryInfo | null {
  return info;
}

/**
 * Ask the server which entry backs this URL, and cache the answer.
 *
 * Called at boot, after every HMR update, and after the refusal notice switches
 * a collection on. Every listener is told when it lands, whichever of those it
 * was.
 *
 * Skipped entirely when the page declares a meta tag (it would win regardless)
 * or the entry editor is off. A failed request is a cleared cache, not a thrown
 * error: not knowing the backing entry is the state this feature exists to
 * improve on, and it is a state the overlay already handles everywhere.
 */
export async function resolvePageSource(): Promise<void> {
  resolved = null;
  info = null;
  if (metaSource() === null && has('entryEditor')) {
    try {
      const res = await api.resolveEntry({ pathname: location.pathname });
      resolved = res.file;
      info = {
        collection: res.collection,
        entryFile: res.entryFile,
        pageEditingLocked: res.pageEditingLocked,
        refusal: res.refusal,
      };
    } catch {
      /* no answer is the same as no meta tag: the entry surfaces stay hidden */
    }
  }
  for (const fn of listeners) fn();
}
