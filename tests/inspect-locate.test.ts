import { describe, expect, it } from 'vitest';
import { locateSelector } from '../src/server/inspect-locate.ts';

/**
 * Characterizes the CSS inspector's best-effort selector→line resolver: the
 * first place a class/id token is used as a selector, confined to <style> blocks
 * for .astro so markup class attributes don't get matched. A miss is null.
 */

const CSS = `:root {
  --ink: #111;
}

.hero-title {
  font-size: 3rem;
  color: var(--ink);
}

.hero-titles {
  font-size: 1rem;
}

#masthead {
  position: sticky;
}
`;

describe('locateSelector — plain .css', () => {
  it('finds a class selector line', () => {
    expect(locateSelector(CSS, '.hero-title', false)).toEqual({ line: 5, col: 1 });
  });

  it('finds an id selector line', () => {
    expect(locateSelector(CSS, '#masthead', false)).toEqual({ line: 14, col: 1 });
  });

  it('does not match a longer name that shares the prefix', () => {
    // ".accent" is absent even though ".hero-title" would substring-collide if
    // we searched without a token boundary.
    expect(locateSelector(CSS, '.accent', false)).toBeNull();
  });

  it('returns null when the selector is absent', () => {
    expect(locateSelector(CSS, '.nope', false)).toBeNull();
  });
});

const ASTRO = `---
const cls = 'hero-title';
---
<h1 class="hero-title accent">Hi</h1>
<p class="accent">Body</p>

<style>
  .hero-title {
    font-size: 3rem;
  }
  .accent {
    color: rebeccapurple;
  }
</style>
`;

describe('locateSelector — .astro (<style>-confined)', () => {
  it('finds the selector inside the <style> block, not the markup class attr', () => {
    // The `.hero-title` class attribute is on line 4; the selector is line 8.
    expect(locateSelector(ASTRO, '.hero-title', true)).toEqual({ line: 8, col: 3 });
  });

  it('finds a second selector in the same <style> block', () => {
    expect(locateSelector(ASTRO, '.accent', true)).toEqual({ line: 11, col: 3 });
  });

  it('returns null for a class that only appears in markup, never as a rule', () => {
    // No `.missing` rule exists; a markup-only class must not resolve.
    expect(locateSelector('<p class="missing"></p><style>.other{}</style>', '.missing', true)).toBeNull();
  });
});
