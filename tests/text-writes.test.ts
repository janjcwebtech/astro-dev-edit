import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTextWrites } from '../src/server/text-writes.ts';
import { createOptionsResolver } from '../src/server/options.ts';

let root: string;
let target: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'reveal-writes-'));
  target = join(root, 'file.md');
  await writeFile(target, 'title\nbefore\n');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function coordinator(revealWrites = true, wait = vi.fn(async (_ms: number) => {}), launch = vi.fn(async (_spec: string, _onError?: () => void) => {})) {
  const logger = { warn: vi.fn() };
  const writes = createTextWrites({
    root, logger, launch, wait,
    optionsResolver: createOptionsResolver({ root, configOptions: { revealWrites, revealWriteDelayMs: 123 } }),
  });
  return { ...writes, launch, wait, logger };
}

it('opens at the changed line and waits while the original is still on disk', async () => {
  const events: string[] = [];
  const c = coordinator(true, vi.fn(async (ms) => {
    expect(ms).toBe(123);
    expect(await readFile(target, 'utf8')).toBe('title\nbefore\n');
    events.push('wait');
  }), vi.fn(async (spec) => {
    expect(spec).toBe(`${target}:2:1`);
    expect(await readFile(target, 'utf8')).toBe('title\nbefore\n');
    events.push('open');
  }));
  await c.run(() => c.write(target, 'title\nafter\n', 'title\nbefore\n'));
  expect(events).toEqual(['open', 'wait']);
  expect(await readFile(target, 'utf8')).toBe('title\nafter\n');
});

it('does not launch or wait when off, or when contents are unchanged', async () => {
  const off = coordinator(false);
  await off.run(() => off.write(target, 'off'));
  expect(off.launch).not.toHaveBeenCalled();
  expect(off.wait).not.toHaveBeenCalled();
  const on = coordinator();
  await on.run(() => on.write(target, 'off'));
  expect(on.launch).not.toHaveBeenCalled();
  expect(on.wait).not.toHaveBeenCalled();
});

it('creates complete new files before launching and refuses existing creation targets', async () => {
  const created = join(root, 'new.md');
  const c = coordinator(true, undefined, vi.fn(async () => {
    expect(await readFile(created, 'utf8')).toBe('complete');
  }));
  await c.run(() => c.write(created, 'complete', null));
  expect(c.launch).toHaveBeenCalledOnce();
  expect(c.wait).not.toHaveBeenCalled();
  await expect(c.run(() => c.write(created, 'replacement', null))).rejects.toThrow('changed on disk');
});

it('preserves external edits made during the pause', async () => {
  const c = coordinator(true, vi.fn(async () => { await writeFile(target, 'external'); }));
  await expect(c.run(() => c.write(target, 'tool'))).rejects.toThrow('changed on disk');
  expect(await readFile(target, 'utf8')).toBe('external');
});

it('rejects parent symlink swaps during the pause', async () => {
  const dir = join(root, 'content');
  await mkdir(dir);
  target = join(dir, 'file.md');
  await writeFile(target, 'before');
  await mkdir(join(root, 'other'));
  await writeFile(join(root, 'other/file.md'), 'before');
  const c = coordinator(true, vi.fn(async () => {
    await rename(dir, join(root, 'original'));
    await symlink(join(root, 'other'), dir);
  }));
  await expect(c.run(() => c.write(target, 'tool'))).rejects.toThrow('changed on disk');
  expect(await readFile(target, 'utf8')).toBe('before');
});

it.each(['throw', 'callback'])('continues saving after launcher failure: %s', async (kind) => {
  const c = coordinator(true, undefined, vi.fn(async (_spec, onError) => {
    if (kind === 'throw') throw new Error('private launcher details');
    onError?.();
  }));
  await c.run(() => c.write(target, 'saved'));
  expect(await readFile(target, 'utf8')).toBe('saved');
  expect(c.logger.warn).toHaveBeenCalledOnce();
  expect(c.logger.warn.mock.calls[0][0]).not.toContain('private');
});

it('serializes entire operations, including reads, and recovers after failure', async () => {
  const c = coordinator();
  const order: string[] = [];
  const first = c.run(async () => {
    order.push('first');
    await c.write(target, 'first');
    throw new Error('operation failed');
  });
  const second = c.run(async () => {
    order.push('second');
    expect(await readFile(target, 'utf8')).toBe('first');
    await c.write(target, 'second');
  });
  await expect(first).rejects.toThrow('operation failed');
  await second;
  expect(order).toEqual(['first', 'second']);
  expect(await readFile(target, 'utf8')).toBe('second');
});

it('carries the file mode through the seam to disk', async () => {
  // `/settings` is in textMutationPaths, so a key save goes through the
  // injected writer rather than atomicWrite directly — the mode has to survive
  // the trip or `.env.local` lands at the umask.
  const c = coordinator(false);
  const secret = join(root, '.env.local');
  await c.run(() => c.write(secret, 'UNSPLASH_ACCESS_KEY=abc\n', null, 0o600));
  expect(await readFile(secret, 'utf8')).toBe('UNSPLASH_ACCESS_KEY=abc\n');
  if (process.platform !== 'win32') {
    const { stat } = await import('node:fs/promises');
    expect((await stat(secret)).mode & 0o777).toBe(0o600);
  }
});

it('leaves the mode alone when none is asked for', async () => {
  const c = coordinator(false);
  await c.run(() => c.write(target, 'title\nplain\n'));
  if (process.platform !== 'win32') {
    const { stat } = await import('node:fs/promises');
    // Whatever the umask gives; the point is that it is not forced to 0600.
    expect((await stat(target)).mode & 0o777).not.toBe(0o600);
  }
});
