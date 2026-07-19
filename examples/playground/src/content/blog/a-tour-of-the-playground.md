---
title: A tour of this playground
excerpt: Every section of this site exists to exercise a different kind of edit. A short guide to what to click and what to expect.
date: 2026-03-18
readTime: 3 min
category: Workflow
image: /images/article-tour.svg
---

This site is a test fixture wearing a nice outfit. If you are trying the editor, here is where everything is.

## Start with the obvious text

The home page hero, this article's intro on the listing page, and the footer line are all literal text in templates. Click them in edit mode and they should open for editing directly.

## Then try what should refuse

The benefit cards on the home page are rendered from an array, and every article title you see on the listing comes from frontmatter. Clicking those should get you a polite refusal and a pointer to the source. That refusal is a feature working, not failing.

## Entries are forms

Open any article and edit the page content: the fields you see come from the collection schema in `content.config.ts`. A date renders as a date picker, the category as a dropdown, the draft flag as a toggle. The body is this very markdown.

```yaml
title: A tour of this playground
category: Workflow
draft: false
```

## Break things freely

Edits land in the playground's own files, nowhere else. When you are done experimenting, `git status` shows the damage and `git checkout` undoes it.
