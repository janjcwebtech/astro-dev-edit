import { describe, expect, it } from 'vitest';
import { annotateAstroSource } from '../src/server/annotate.ts';
import { applyAstro, classifyAstro } from '../src/patcher/astro.ts';
import { locOf } from './helpers.ts';

const samples = ['Grüße äöü', 'č é', '日本語', '😊', 'Grüße äöü č é 日本語 😊'];

describe('Unicode page content source positions', () => {
  for (const content of samples) {
    for (const separator of ['', '\n', '\r\n']) {
      it(`edits after ${JSON.stringify(content)} with separator ${JSON.stringify(separator)}`, async () => {
        const source = `<p>${content}</p>${separator}<h2>Later heading</h2><footer>Keep me</footer>`;
        const annotated = await annotateAstroSource(source, '/project/page.astro');
        const loc = annotated.match(/<h2 data-astro-source-file="[^"]*" data-astro-source-loc="([^"]*)"/)?.[1];
        expect(loc).toBe(locOf(source, 'Later heading'));
        // Removing annotations must recover the complete original, catching
        // insertion drift even when annotate and patch share the same mistake.
        expect(annotated.replace(/ data-astro-source-file="[^"]*" data-astro-source-loc="[^"]*"/g, '')).toBe(source);
        expect(await classifyAstro(source, loc!, 'h2')).toMatchObject({ kind: 'text' });
        expect(await applyAstro(source, {
          loc: loc!, tag: 'h2', targetType: 'text', original: 'Later heading', newText: 'Updated café 東京 😊',
        })).toEqual({ ok: true, newSource: source.replace('Later heading', 'Updated café 東京 😊') });
      });
    }
    it(`edits Unicode text itself: ${content}`, async () => {
      const source = `<p>Earlier ${content}</p><h2>${content}</h2><footer>Keep me</footer>`;
      expect(await applyAstro(source, {
        loc: locOf(source, `${content}</h2>`), tag: 'h2', targetType: 'text', original: content, newText: 'Changed 😊',
      })).toEqual({ ok: true, newSource: source.replace(`<h2>${content}</h2>`, '<h2>Changed 😊</h2>') });
    });
  }
});
