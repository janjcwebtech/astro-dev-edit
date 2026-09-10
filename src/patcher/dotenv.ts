/**
 * `.env` document patching — pure string-in/string-out, like the frontmatter
 * patcher, and deliberately NOT a registry `Patcher`: that interface is
 * loc-based (classify/apply against a source annotation), while this targets a
 * named variable. The caller owns all filesystem access.
 *
 * This exists because the Unsplash access key must not live in
 * `.astro-dev-edit.json`. That file sits in the directory Vite serves; a `.env`
 * file is one Vite already refuses to serve, and one every project's ignore
 * rules already expect to hold a secret.
 *
 * **Values are validated, not escaped.** dotenv gives `"`, `'`, `` ` ``, `#`
 * and whitespace their own meanings, and Vite runs dotenv-expand over what it
 * parses, so `$` interpolates. A value needing any of that would not read back
 * as it was written — and quoting it would be this module guessing at intent.
 * Anything outside {@link ENV_VALUE_RE} is refused instead.
 *
 * Everything is done by line slicing, never by re-serializing the document:
 * comments, blank lines, ordering and the quoting style of untouched lines
 * survive exactly. Line *endings* are the one normalization — the document's
 * dominant ending is applied throughout, so a mixed-ending file comes out
 * consistent rather than gaining a third style.
 */

/**
 * What a value may contain. Wide enough for every access-key format in play
 * (Unsplash's are URL-safe base64) and narrow enough that no dotenv
 * metacharacter can reach the file.
 */
export const ENV_VALUE_RE = /^[A-Za-z0-9_-]+$/;

/** Conventional shell variable naming. Ours is a constant; assert anyway. */
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]*$/;

/** Shown to the user when a save is refused, so it says what to do. */
const VALUE_REFUSAL =
  'An access key may contain only letters, digits, hyphens and underscores. ' +
  'Check for a stray space or quotation mark in what you pasted.';

export type EnvPatchAction = 'created' | 'updated' | 'appended' | 'removed' | 'unchanged';

export type EnvPatchResult =
  | { ok: true; text: string; action: EnvPatchAction }
  | { ok: false; reason: string };

/** An uncommented `NAME=` assignment, allowing indentation and a `export `
 *  prefix (dotenv accepts both). A `#` before it makes the line a comment. */
function assignmentRe(name: string): RegExp {
  return new RegExp(`^(\\s*)(export\\s+)?${name}\\s*=`);
}

/** A commented-out assignment — not a value, but a hint about where the user
 *  expects the variable to live. */
function commentedRe(name: string): RegExp {
  return new RegExp(`^\\s*#\\s*(export\\s+)?${name}\\s*=`);
}

/**
 * Upsert `NAME=value` into a `.env` document, or remove it when `value` is
 * empty. Returns the new text, or a refusal the caller turns into a 422.
 *
 * Where the line lands, in order: an existing assignment is replaced **in
 * place**; failing that, immediately after a commented-out one; failing that,
 * appended. Earlier duplicate assignments are deleted rather than left behind —
 * dotenv is last-wins, so a stale copy of a rotated key would otherwise sit on
 * disk reading as inert while still being a secret.
 */
export function upsertEnvVar(source: string, name: string, value: string): EnvPatchResult {
  if (!ENV_NAME_RE.test(name)) return { ok: false, reason: `not a valid environment variable name: ${name}` };
  const next = value.trim();
  if (next && !ENV_VALUE_RE.test(next)) return { ok: false, reason: VALUE_REFUSAL };

  // Match the document's own line ending rather than imposing one.
  const eol = /\r\n/.test(source) ? '\r\n' : '\n';
  const assignment = assignmentRe(name);
  const commented = commentedRe(name);

  // Split on either ending so a \r never rides along on the line content and
  // double up when the parts are rejoined with `eol`.
  const lines = source === '' ? [] : source.split(/\r?\n/);
  // A trailing newline yields a final empty element; drop it and re-add at the
  // end, so "append" cannot produce a blank line in the middle.
  const trailingNewline = lines.length > 0 && lines[lines.length - 1] === '';
  if (trailingNewline) lines.pop();

  const hits: number[] = [];
  let commentedAt = -1;
  lines.forEach((line, i) => {
    if (assignment.test(line)) hits.push(i);
    else if (commentedAt === -1 && commented.test(line)) commentedAt = i;
  });

  if (!next) {
    if (hits.length === 0) return { ok: true, text: source, action: 'unchanged' };
    const kept = lines.filter((_, i) => !hits.includes(i));
    return { ok: true, text: kept.length === 0 ? '' : kept.join(eol) + eol, action: 'removed' };
  }

  let action: EnvPatchAction;
  if (hits.length > 0) {
    // Rewrite the last (the one dotenv would use) and drop the earlier ones.
    const last = hits[hits.length - 1];
    const [, indent = '', exported = ''] = assignment.exec(lines[last]) ?? [];
    // Any trailing `# comment` described the old value, so it goes with it.
    lines[last] = `${indent}${exported}${name}=${next}`;
    for (const i of hits.slice(0, -1).reverse()) lines.splice(i, 1);
    action = 'updated';
  } else if (commentedAt !== -1) {
    lines.splice(commentedAt + 1, 0, `${name}=${next}`);
    action = 'appended';
  } else if (lines.length === 0) {
    lines.push('# Written by astro-dev-edit. Keep this file out of version control.');
    lines.push(`${name}=${next}`);
    action = 'created';
  } else {
    lines.push(`${name}=${next}`);
    action = 'appended';
  }

  return { ok: true, text: lines.join(eol) + eol, action };
}
