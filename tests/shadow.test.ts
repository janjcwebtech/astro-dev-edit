import { describe, expect, it } from 'vitest';
import { isDetached } from '../src/client/shadow.ts';

/**
 * The decision behind surviving a `<ClientRouter />` navigation (issue #77).
 *
 * There is no jsdom in this suite, so the DOM half — re-appending the host to
 * the incoming body — is pinned by the manual checklist in
 * `internal-documentation/VERIFICATION.md`. What is pinned here is the part
 * that got it wrong: `root` stayed non-null after the swap, so nothing ever
 * asked whether the host was still in the document.
 */
describe('overlay host lifetime', () => {
  const connected = { isConnected: true };
  const gone = { isConnected: false };
  const root = {};

  it('reports a mounted host that left with the old body', () => {
    expect(isDetached(gone, root)).toBe(true);
  });

  it('leaves a live host alone, so an ordinary call never re-appends', () => {
    expect(isDetached(connected, root)).toBe(false);
  });

  it('never claims a host that was never created is detached', () => {
    // A cold page builds one from scratch; "put it back" would have nothing
    // to put, and `reattachOverlay` must not report that it acted.
    expect(isDetached(null, null)).toBe(false);
    expect(isDetached(null, root)).toBe(false);
  });

  it('treats a host with no shadow root as nothing to re-attach', () => {
    // Half-built is not a state `ensure()` can leave behind, but the predicate
    // must not invent a repair for it either.
    expect(isDetached(gone, null)).toBe(false);
  });
});
