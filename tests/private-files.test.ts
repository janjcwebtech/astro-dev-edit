import { describe, expect, it, vi } from 'vitest';
import type { Connect, Plugin as VitePlugin } from 'vite';
import { createPrivateFilesPlugin, isPrivateFileRequest } from '../src/server/private-files.ts';

/**
 * The dev server used to hand `.astro-dev-edit.json` straight back: it sits in
 * the project root Vite serves, and the integration's own middleware never sees
 * the request. These cases pin every URL spelling that reaches the same file,
 * because the guard matches path segments rather than resolving paths — one
 * missed spelling is the whole hole reopened.
 */

describe('isPrivateFileRequest', () => {
  it('refuses the settings file at the site root', () => {
    expect(isPrivateFileRequest('/.astro-dev-edit.json')).toBe(true);
  });

  it('refuses it under a configured base', () => {
    // This guard runs before Vite's baseMiddleware, so the base is still attached.
    expect(isPrivateFileRequest('/docs/.astro-dev-edit.json')).toBe(true);
  });

  it('refuses the /@fs/ form, posix and windows', () => {
    expect(isPrivateFileRequest('/@fs/Users/x/proj/.astro-dev-edit.json')).toBe(true);
    expect(isPrivateFileRequest('/@fs/C:\\proj\\.astro-dev-edit.json')).toBe(true);
  });

  it('refuses it with any query or fragment Vite would strip', () => {
    expect(isPrivateFileRequest('/.astro-dev-edit.json?raw')).toBe(true);
    expect(isPrivateFileRequest('/.astro-dev-edit.json?import')).toBe(true);
    expect(isPrivateFileRequest('/.astro-dev-edit.json?t=1730000000')).toBe(true);
    expect(isPrivateFileRequest('/.astro-dev-edit.json#frag')).toBe(true);
  });

  it('refuses a percent-encoded spelling', () => {
    expect(isPrivateFileRequest('/%2Eastro-dev-edit.json')).toBe(true);
    expect(isPrivateFileRequest('/%2e%61stro-dev-edit.json')).toBe(true);
  });

  it('refuses a differently-cased spelling, as a case-insensitive fs would serve it', () => {
    expect(isPrivateFileRequest('/.ASTRO-DEV-EDIT.JSON')).toBe(true);
  });

  it('refuses atomicWrite’s mid-write siblings', () => {
    // The doubled dot is real: basename('.env.local') already starts with one,
    // which is also why Vite's own `.env.*` deny does not cover it.
    expect(isPrivateFileRequest('/..astro-dev-edit.json.dev-edit-tmp-99')).toBe(true);
    expect(isPrivateFileRequest('/..env.local.dev-edit-tmp-99')).toBe(true);
    expect(isPrivateFileRequest('/@fs/Users/x/proj/..env.local.dev-edit-tmp-4321')).toBe(true);
  });

  it('still refuses when the URL cannot be decoded', () => {
    // decodeURIComponent throws on %zz; the raw spelling is tested regardless.
    expect(isPrivateFileRequest('/.astro-dev-edit.json?x=%zz')).toBe(true);
    expect(isPrivateFileRequest('/page%zz')).toBe(false);
  });

  it('passes ordinary requests through', () => {
    for (const url of [
      '/',
      '/index.html',
      '/src/pages/index.astro',
      '/@fs/Users/x/proj/src/pages/index.astro',
      '/_astro/index.abc123.js',
      // No leading dot — a different file, and a legitimate one.
      '/astro-dev-edit.json',
      // A prefix match must not be enough.
      '/.astro-dev-edit.json.bak',
      '/.well-known/apple-app-site-association',
    ]) {
      expect(isPrivateFileRequest(url), url).toBe(false);
    }
  });
});

/** Invoke the hook with a stub server. Vite's own hook type is a union of
 *  object/function forms, so it needs a narrowing the test does not benefit
 *  from spelling out twice. */
function callConfigureServer(plugin: VitePlugin, server: { middlewares: { use: unknown } }): unknown {
  const hook = plugin.configureServer as unknown as (this: unknown, s: unknown) => unknown;
  return hook.call(plugin, server);
}

describe('createPrivateFilesPlugin', () => {
  /** Drive the middleware the plugin registers, without a real Vite server. */
  function handle(url: string) {
    const plugin = createPrivateFilesPlugin();
    let handler: Connect.NextHandleFunction | undefined;
    const server = { middlewares: { use: (fn: Connect.NextHandleFunction) => { handler = fn; } } };
    callConfigureServer(plugin, server);
    expect(handler).toBeTypeOf('function');

    const headers: Record<string, string> = {};
    const res = {
      statusCode: 200,
      setHeader: (k: string, v: string) => { headers[k] = v; },
      end: vi.fn(),
    };
    const next = vi.fn();
    handler!({ url } as never, res as never, next);
    return { res, headers, next, body: res.end.mock.calls[0]?.[0] as string | undefined };
  }

  it('registers its middleware from the hook body, not a returned function', () => {
    // A returned function is a *post* hook, running after Vite's static and
    // @fs handlers have already answered. Registering in the body is the fix.
    const plugin = createPrivateFilesPlugin();
    const use = vi.fn();
    const returned = callConfigureServer(plugin, { middlewares: { use } });
    expect(use).toHaveBeenCalledOnce();
    expect(returned).toBeUndefined();
  });

  it('never runs during a build', () => {
    expect(createPrivateFilesPlugin().apply).toBe('serve');
  });

  it('answers 403 without echoing the path or caching', () => {
    const { res, headers, next, body } = handle('/.astro-dev-edit.json');
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
    expect(headers['Cache-Control']).toBe('no-store');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(body).not.toContain('.astro-dev-edit.json');
  });

  it('passes an ordinary request to next()', () => {
    const { res, next } = handle('/src/pages/index.astro');
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });
});
