import { createHash } from 'node:crypto';

/** Server-only; the transform and index use exactly the same source coordinates. */
export function usageId(rootRelativeFile: string, loc: string): string {
  return createHash('sha1')
    .update(rootRelativeFile.replaceAll('\\', '/') + '\0' + loc)
    .digest('base64url').slice(0, 8);
}
