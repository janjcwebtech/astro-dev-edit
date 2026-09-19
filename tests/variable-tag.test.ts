import { describe, expect, it, vi } from 'vitest';
import type { VariableTagRequest, VariableTagResponse } from '../src/shared/protocol.ts';
import { createVariableTags } from '../src/client/variable-tag.ts';

/**
 * The client half of issue #82: one answer per unannotated element, shared by
 * the hover pill's dwell and the panel's click. The node test environment has
 * no DOM, so elements are the few members the module reads.
 */

function element(tag: string, attrs: Record<string, string> = {}, children: object[] = []) {
  return {
    tagName: tag.toUpperCase(),
    children,
    hasAttribute: (name: string) => name in attrs,
    getAttribute: (name: string) => attrs[name] ?? null,
  } as unknown as HTMLElement;
}

const inner = element('div', { 'data-atx-file': 'src/NoteCard.astro', 'data-atx-loc': '51:32' });
const image = element('img', { 'data-atx-file': 'node_modules/astro/components/Image.astro', 'data-atx-loc': '1:2' });
const plain = element('span');
const PROOF: VariableTagResponse = { ok: true, child: 1,
  source: { file: 'src/NoteCard.astro', loc: '46:1' }, name: 'Wrapper', tags: ['a', 'article'] };

describe('createVariableTags', () => {
  it('sends the annotated direct children, and keeps the one that proved it', async () => {
    const resolveVariableTag = vi.fn(async (_: VariableTagRequest) => PROOF);
    const tags = createVariableTags({ resolveVariableTag });
    const card = element('a', {}, [image, plain, inner]);
    const answer = await tags.resolve(card);
    expect(resolveVariableTag).toHaveBeenCalledWith({ tag: 'a', children: [
      { file: 'node_modules/astro/components/Image.astro', loc: '1:2', tag: 'img' },
      { file: 'src/NoteCard.astro', loc: '51:32', tag: 'div' },
    ] });
    expect(answer).toEqual({ source: { file: 'src/NoteCard.astro', loc: '46:1' }, name: 'Wrapper',
      tags: ['a', 'article'], carrier: inner });
  });

  it('asks once per element, and answers from memory once settled', async () => {
    const resolveVariableTag = vi.fn(async () => PROOF);
    const tags = createVariableTags({ resolveVariableTag });
    const card = element('a', {}, [image, inner]);
    expect(tags.known(card)).toBeUndefined();
    const [first, second] = await Promise.all([tags.resolve(card), tags.resolve(card)]);
    expect(first).toBe(second);
    expect(tags.known(card)).toBe(first);
    expect(resolveVariableTag).toHaveBeenCalledTimes(1);
  });

  it('remembers a refusal as null, so a hover does not ask again', async () => {
    const resolveVariableTag = vi.fn(async (): Promise<VariableTagResponse> => ({ ok: false, reason: 'not-literal' }));
    const tags = createVariableTags({ resolveVariableTag });
    const card = element('a', {}, [inner]);
    expect(await tags.resolve(card)).toBeNull();
    expect(tags.known(card)).toBeNull();
  });

  it('asks again after a request that failed — that is not a refusal', async () => {
    const resolveVariableTag = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ...PROOF, child: 0 });
    const tags = createVariableTags({ resolveVariableTag });
    const card = element('a', {}, [inner]);
    expect(await tags.resolve(card)).toBeNull();
    expect(tags.known(card)).toBeUndefined();
    expect(await tags.resolve(card)).toMatchObject({ carrier: inner });
  });

  it('asks nothing of an element with no annotated child', async () => {
    const resolveVariableTag = vi.fn();
    expect(await createVariableTags({ resolveVariableTag }).resolve(element('a', {}, [plain]))).toBeNull();
    expect(resolveVariableTag).not.toHaveBeenCalled();
  });

  it('forgets everything on invalidate, even an answer still in flight', async () => {
    let settle!: (value: VariableTagResponse) => void;
    const resolveVariableTag = vi.fn(() => new Promise<VariableTagResponse>(done => { settle = done; }));
    const tags = createVariableTags({ resolveVariableTag });
    const card = element('a', {}, [inner]);
    const stale = tags.resolve(card);
    tags.invalidate();
    settle({ ...PROOF, child: 0 });
    await stale;
    expect(tags.known(card)).toBeUndefined();
  });
});
