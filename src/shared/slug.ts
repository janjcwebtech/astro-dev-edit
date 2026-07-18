/**
 * Filename-safe slug: lowercase, ascii, hyphen-separated, capped at 120 chars.
 *
 * Shared runtime code (unlike protocol.ts, which is types-only): the client
 * uses it to live-suggest a slug from the title, the server re-runs it as the
 * authority before touching the filesystem. Keeping one implementation means
 * the suggestion the user saw is exactly the filename the server creates.
 */
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}
