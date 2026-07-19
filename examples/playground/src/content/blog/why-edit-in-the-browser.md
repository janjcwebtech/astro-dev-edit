---
title: Why edit in the browser at all?
excerpt: The rendered page already shows your content at its best. Here is the case for making it the place you change that content, too.
date: 2026-06-14
readTime: 4 min
category: Editing
image: /images/article-browser.svg
---

Most website text is written once and then adjusted forever. A heading gets sharpened, a date gets corrected, a sentence gets shortened after someone finally reads it out loud. The writing happens in an editor; the adjusting happens everywhere else.

## The round trip is the real cost

Fixing one word the traditional way means finding the right file, finding the right line, making the change, and checking the page to confirm you changed the thing you meant. None of those steps is hard. Together they are just enough friction that small fixes get postponed, and postponed fixes accumulate.

Editing in the browser removes the whole loop. You are already looking at the sentence, and the fix happens where the problem is visible.

## What it is good at

Visual editing earns its keep on a specific kind of change:

- Correcting typos and wording the moment you notice them
- Tightening headings against the layout they actually live in
- Swapping an image and judging it in context
- Updating frontmatter without hand-editing YAML

## What it should not do

The flip side matters just as much. Text that comes from a template expression, a loop, or a component is **not** safe to rewrite from the page, because the page only shows one rendering of it. A good visual editor knows the difference and says so, instead of guessing.

That split is what makes the whole idea trustworthy: *edit the content, never the code*.
