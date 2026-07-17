import type { AstroIntegrationLogger } from 'astro';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';

/**
 * Minimal route table + dispatcher for the /__text-edit endpoints. Routes are
 * matched on exact method + pathname (query stripped) — adding an endpoint is
 * one entry in the middleware's table, with body reading, JSON parsing, and
 * error mapping handled once, here.
 */

export const BASE = '/__text-edit';

export interface RouteResult {
  status: number;
  body: unknown;
}

export interface Route {
  method: 'GET' | 'POST';
  /** Exact pathname under BASE, e.g. '/apply'. */
  path: string;
  /** Body size cap; required for POST routes. The body is JSON-parsed. */
  maxBytes?: number;
  /** Warn-log prefix on failure: "<label> failed: <err>". */
  label: string;
  /** Response fallback when a non-Error is thrown; defaults to "<label> failed". */
  fallback?: string;
  /** Handle the request. `body` is the parsed JSON for POST, undefined for GET. */
  handler(body: unknown, req: Connect.IncomingMessage): Promise<RouteResult>;
  /** Override the default 400-with-message error response. */
  onError?(err: unknown): RouteResult;
}

/** Read a request body up to a size cap. */
export function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > maxBytes) {
        rej(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });
}

export function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(payload);
}

/** Match and run the route for a request already known to be under BASE. */
export async function dispatch(
  routes: readonly Route[],
  logger: AstroIntegrationLogger,
  req: Connect.IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = req.url ?? '';
  const pathname = new URL(url, 'http://localhost').pathname;
  const sub = pathname.slice(BASE.length);
  const route = routes.find((r) => r.method === req.method && r.path === sub);
  if (!route) {
    logger.warn(`unhandled text-edit request: ${req.method} ${url}`);
    json(res, 404, { error: 'not implemented' });
    return;
  }

  try {
    let body: unknown;
    if (route.method === 'POST') {
      const buf = await readBody(req, route.maxBytes ?? 64 * 1024);
      body = JSON.parse(buf.toString('utf8'));
    }
    const result = await route.handler(body, req);
    json(res, result.status, result.body);
  } catch (err) {
    logger.warn(`${route.label} failed: ${String(err)}`);
    const mapped = route.onError?.(err) ?? {
      status: 400,
      body: { error: err instanceof Error ? err.message : (route.fallback ?? `${route.label} failed`) },
    };
    json(res, mapped.status, mapped.body);
  }
}
