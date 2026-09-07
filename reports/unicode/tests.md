# Unicode source-position checks — 2026-09-07

Result: no reproduction of the competitor's UTF-8 byte-offset bug.

Environment: local playground, Astro 7.1.1, @astrojs/compiler 2.13.1, current working-tree integration, browser at http://localhost:4390/unicode-check. Temporary page used the playground's Base layout. Unicode appeared only in page copy and a frontmatter string rendered as a heading.

## Browser checks

Each save used actual editor clicks and text entry, followed by inspection of the source file. The final rendered content was also inspected. Only the intended text/string changed at each step; the introduction, closing sentinel, and surrounding markup remained intact. Final source evidence: [after.astro.txt](after.astro.txt).

| Case | Action | Result |
| --- | --- | --- |
| Same-line offset | After `<p>Grüße äöü č é 日本語 😊</p>`, edit the h2 on the same source line to `Updated café 東京 😊` | Pass |
| Later-line offset | Edit a subsequent paragraph to `Later paragraph edited`, after the preceding save/reload | Pass |
| Unicode text bounds | Replace `Café in 東京 😊` with `Příliš žluťoučký — 京都 😊` | Pass |
| Expression content | Use the text popup to change rendered `Bienvenue à Montréal 😊` to `Bonjour à tous 日本語 😊` | Pass; only the frontmatter literal changed |
| Formatted content | Use the markup popup to replace `Grüße <strong>日本語 😊</strong> café` with `Grüße <strong>京都 😊</strong> č café` | Pass; formatting preserved |

## Automated checks and cause

Added `tests/unicode-editing.test.ts`: 20 passing cases spanning German accents, Czech/French accents, Japanese, emoji, and their combination. Checks cover same-line, LF, and CRLF separation, annotation locations against independently computed JS positions, exact source preservation, classification, replacement after Unicode, and replacement of Unicode itself.

`npm test`: 30 files, 655 tests passed. `npm run typecheck`: passed.

Both `src/server/annotate.ts` and `src/patcher/astro.ts` already derive JS indexes from compiler line/column positions; neither uses compiler byte offsets. A direct parse confirmed that byte offsets diverge while columns match UTF-16 positions in the tested compiler. No production fix was needed.

## Limits and cleanup

This verifies the installed Astro 7 playground and compiler version, not a browser/version matrix. Image attributes and unrelated configuration inputs were outside this content-focused run.

Automation initially looked for `contenteditable=true`; the text editor uses `plaintext-only`, while expression editing uses a popup. Correcting those selectors allowed saves to complete. Missing source attributes in the live DOM were not a product failure: the editor consumes them into its source mapping.

The temporary playground route was removed after testing. Existing user changes were preserved. Retained changes are the regression test and this evidence directory.
