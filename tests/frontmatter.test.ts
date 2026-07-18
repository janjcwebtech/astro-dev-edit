import { describe, expect, it } from 'vitest';
import {
  applyEntryChanges,
  parseEntry,
  serializeEntry,
} from '../src/patcher/frontmatter.ts';

const SAMPLE = `---
title: Should you enable WordPress auto-updates?
excerpt: Auto-updates trade a little control for a lot of protection.
date: 2026-06-11
readTime: 4 min
# editorial note: keep the author in sync with the byline
author: Jan Cerny
category: Security
image: /images/article-wordpress.webp
---

Auto-updates are one of the most argued-about settings.

## The case for turning them on

Body text here.
`;

describe('parseEntry', () => {
  it('splits fences, data, and body', () => {
    const p = parseEntry(SAMPLE);
    expect(p.hasFrontmatter).toBe(true);
    expect(p.data.title).toBe('Should you enable WordPress auto-updates?');
    expect(p.data.date).toBe('2026-06-11'); // core schema: date stays a string
    expect(p.body.startsWith('Auto-updates are one of')).toBe(true);
    expect(p.bodyGap).toBe('\n');
    expect(p.eol).toBe('\n');
  });

  it('handles a file with no frontmatter', () => {
    const p = parseEntry('Just a body\n');
    expect(p.hasFrontmatter).toBe(false);
    expect(p.data).toEqual({});
    expect(p.body).toBe('Just a body\n');
  });

  it('handles an unterminated fence as body', () => {
    const p = parseEntry('---\ntitle: x\nno close');
    expect(p.hasFrontmatter).toBe(false);
    expect(p.body).toContain('title: x');
  });

  it('accepts the ... closing fence', () => {
    const p = parseEntry('---\ntitle: x\n...\nBody\n');
    expect(p.hasFrontmatter).toBe(true);
    expect(p.data.title).toBe('x');
    expect(p.body).toBe('Body\n');
  });

  it('records CRLF and BOM', () => {
    const p = parseEntry('﻿---\r\ntitle: x\r\n---\r\nBody\r\n');
    expect(p.eol).toBe('\r\n');
    expect(p.bom).toBe('﻿');
    expect(p.data.title).toBe('x');
    expect(p.body).toBe('Body\n');
  });

  it('reports invalid YAML without losing the body', () => {
    const p = parseEntry('---\ntitle: [unclosed\n---\nBody\n');
    expect(p.yamlError).toBeTruthy();
    expect(p.body).toBe('Body\n');
  });
});

describe('applyEntryChanges', () => {
  it('patches one key, preserving comments, order, and untouched lines', () => {
    const r = applyEntryChanges(SAMPLE, { frontmatter: { title: 'New title' } });
    if (!r.ok) throw new Error(r.error);
    expect(r.newSource).toContain('title: New title');
    // comment survives
    expect(r.newSource).toContain('# editorial note: keep the author in sync');
    // untouched keys byte-identical
    expect(r.newSource).toContain('excerpt: Auto-updates trade a little control');
    expect(r.newSource).toContain('image: /images/article-wordpress.webp');
    // order: title still before excerpt
    expect(r.newSource.indexOf('title:')).toBeLessThan(r.newSource.indexOf('excerpt:'));
    // body untouched
    expect(r.newSource).toContain('## The case for turning them on');
  });

  it('writes a date value as an unquoted plain scalar', () => {
    const r = applyEntryChanges(SAMPLE, { frontmatter: { date: '2026-07-18' } });
    if (!r.ok) throw new Error(r.error);
    expect(r.newSource).toContain('date: 2026-07-18');
    expect(r.newSource).not.toContain("date: '2026-07-18'");
  });

  it('appends a new key at the end of the mapping', () => {
    const r = applyEntryChanges(SAMPLE, { frontmatter: { draft: true } });
    if (!r.ok) throw new Error(r.error);
    const fm = r.newSource.split('---')[1];
    expect(fm).toContain('draft: true');
    expect(fm.indexOf('image:')).toBeLessThan(fm.indexOf('draft:'));
  });

  it('deletes a key on null', () => {
    const r = applyEntryChanges(SAMPLE, { frontmatter: { category: null } });
    if (!r.ok) throw new Error(r.error);
    expect(r.newSource).not.toContain('category:');
    expect(r.newSource).toContain('author: Jan Cerny');
  });

  it('leaves frontmatter byte-identical on a body-only change', () => {
    const r = applyEntryChanges(SAMPLE, { body: 'Replaced body.\n' });
    if (!r.ok) throw new Error(r.error);
    const originalFm = SAMPLE.split('---\n')[1];
    const newFm = r.newSource.split('---\n')[1];
    expect(newFm).toBe(originalFm);
    expect(r.newSource.endsWith('---\n\nReplaced body.\n')).toBe(true);
  });

  it('round-trips a CRLF file as CRLF', () => {
    const src = '---\r\ntitle: x\r\nkeep: y\r\n---\r\n\r\nBody\r\n';
    const r = applyEntryChanges(src, { frontmatter: { title: 'z' } });
    if (!r.ok) throw new Error(r.error);
    expect(r.newSource).toBe('---\r\ntitle: z\r\nkeep: y\r\n---\r\n\r\nBody\r\n');
  });

  it('creates a fence on a file that had none', () => {
    const r = applyEntryChanges('Plain body\n', { frontmatter: { title: 'x' } });
    if (!r.ok) throw new Error(r.error);
    expect(r.newSource).toBe('---\ntitle: x\n---\n\nPlain body\n');
  });

  it('preserves quoted strings on untouched keys', () => {
    const src = `---\ntitle: 'Has: a colon'\nother: plain\n---\nBody\n`;
    const r = applyEntryChanges(src, { frontmatter: { other: 'changed' } });
    if (!r.ok) throw new Error(r.error);
    expect(r.newSource).toContain(`title: 'Has: a colon'`);
  });

  it('never re-wraps long untouched scalars (lineWidth stays off)', () => {
    const long =
      'Auto-updates trade a little control for a lot of protection. Here is when to switch them on, and when a staging step earns its keep.';
    const src = `---\ntitle: x\nexcerpt: ${long}\n---\nBody\n`;
    const r = applyEntryChanges(src, { frontmatter: { title: 'y' } });
    if (!r.ok) throw new Error(r.error);
    expect(r.newSource).toContain(`excerpt: ${long}\n`);
  });

  it('writes tags arrays', () => {
    const r = applyEntryChanges(SAMPLE, { frontmatter: { tags: ['a', 'b'] } });
    if (!r.ok) throw new Error(r.error);
    expect(r.newSource).toMatch(/tags:\n\s+- a\n\s+- b/);
  });

  it('refuses frontmatter changes when the YAML is invalid', () => {
    const r = applyEntryChanges('---\ntitle: [unclosed\n---\nBody\n', {
      frontmatter: { title: 'x' },
    });
    expect(r.ok).toBe(false);
  });

  it('refuses an empty change set', () => {
    expect(applyEntryChanges(SAMPLE, {}).ok).toBe(false);
  });
});

describe('serializeEntry', () => {
  it('builds a complete new entry', () => {
    const s = serializeEntry({ title: 'New post', date: '2026-07-18' }, '# Hello\n');
    expect(s).toBe('---\ntitle: New post\ndate: 2026-07-18\n---\n\n# Hello\n');
    // and it round-trips
    const p = parseEntry(s);
    expect(p.data).toEqual({ title: 'New post', date: '2026-07-18' });
    expect(p.body).toBe('# Hello\n');
  });
});
