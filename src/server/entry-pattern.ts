/**
 * The glob loader's `pattern`, as a predicate over directory-relative entry
 * paths.
 *
 * Two jobs, and the second is the one that is easy to miss:
 *
 *  1. **Which extensions are entries.** Astro's content layer has taken
 *     `.json` and `.yml` entries since 5.0; the pattern is where a project says
 *     so, and a hardcoded markdown list makes every data collection read as
 *     empty.
 *  2. **Which files under the base are entries.** A `base` broader than the
 *     collection is correct precisely because the pattern narrows it —
 *     `glob({ pattern: 'settings.yml', base: './src/content' })` names one
 *     file while its base holds every other collection. Honouring the base and
 *     ignoring the pattern hands that collection everything beneath it.
 *
 * **Not a general glob engine, and deliberately not a dependency.** It compiles
 * the subset real content configs are written in and refuses the rest, which is
 * the same stance `patcher/content-config.ts` takes toward the config text: a
 * pattern that cannot be proven yields null, and the caller falls back to
 * matching on extension alone — the behaviour every collection had before.
 * Over-matching is the failure that costs, not under-matching.
 *
 * Supported: `**` (any depth, including none), `*` (within one segment), `?`
 * (one character), `{a,b}` alternation over literal text, and literal segments.
 * A leading `./` is trimmed. Anything else — `[a-z]` classes, `!(…)` and the
 * other extglobs, a `..` segment, an absolute path — refuses.
 */

/** Metacharacters this compiler does not claim to understand. */
const UNSUPPORTED = /[[\]()!+@]/;

/** A `{a,b}` group's body, which may not nest or contain another glob. */
const BRACE_BODY = /^[^{}]*$/;

function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One pattern as a regex source, or null when it uses something unsupported.
 *
 * `**` is compiled two ways depending on where it sits, and the difference
 * matters: `**​/*.md` must match `one.md` at the top level as well as
 * `a/b/one.md`, so a `**​/` prefix contributes an optional group rather than a
 * mandatory one. A bare `**` at the end matches everything below.
 */
function compileOne(pattern: string): string | null {
  const p = pattern.replace(/^\.\//, '');
  if (p === '' || p.startsWith('/') || p.split('/').includes('..')) return null;

  let out = '';
  let i = 0;
  while (i < p.length) {
    const ch = p[i];

    if (ch === '{') {
      const close = p.indexOf('}', i);
      if (close === -1) return null;
      const body = p.slice(i + 1, close);
      if (!BRACE_BODY.test(body) || UNSUPPORTED.test(body) || body.includes('/')) return null;
      const alts = body.split(',');
      if (alts.length === 0 || alts.some((a) => a === '')) return null;
      out += `(?:${alts.map(escapeLiteral).join('|')})`;
      i = close + 1;
      continue;
    }

    if (UNSUPPORTED.test(ch) || ch === '}') return null;

    if (ch === '*') {
      // `**/` — any number of leading directories, none included.
      if (p[i + 1] === '*' && p[i + 2] === '/') {
        out += '(?:[^/]+/)*';
        i += 3;
        continue;
      }
      // `**` at the end — everything below this point.
      if (p[i + 1] === '*' && i + 2 === p.length) {
        out += '.*';
        i += 2;
        continue;
      }
      // A `**` anywhere else is not a shape this compiler claims.
      if (p[i + 1] === '*') return null;
      out += '[^/]*';
      i += 1;
      continue;
    }

    if (ch === '?') {
      out += '[^/]';
      i += 1;
      continue;
    }

    out += escapeLiteral(ch);
    i += 1;
  }
  return out;
}

/**
 * A matcher for a collection's patterns, or null when any of them is a shape
 * this compiler does not claim.
 *
 * Null for the whole list rather than for the offending member: a partial
 * pattern set would silently narrow the collection, and an entry the tool
 * cannot see is the bug being fixed, not the fix.
 */
export function compilePattern(patterns: readonly string[] | undefined): ((rel: string) => boolean) | null {
  if (!patterns || patterns.length === 0) return null;
  const sources: string[] = [];
  for (const p of patterns) {
    const compiled = compileOne(p);
    if (compiled === null) return null;
    sources.push(compiled);
  }
  // Case-insensitive, because the extension comparison it replaces was.
  const re = new RegExp(`^(?:${sources.join('|')})$`, 'i');
  return (rel) => re.test(rel.split('\\').join('/').replace(/^\.\//, ''));
}
