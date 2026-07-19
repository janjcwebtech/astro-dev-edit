---
title: Where an Astro site keeps its words
excerpt: Templates, markdown, and content collections each hold a different kind of text. Knowing which is which explains what a visual editor can and cannot touch.
date: 2026-05-02
readTime: 5 min
author: Priya Nair
category: Astro
image: /images/article-astro.svg
---

An [Astro](https://astro.build) site spreads its content across a few homes, and each one behaves differently when you try to edit it.

## Literal text in templates

Some words live directly in `.astro` files: a hero heading, a button label, a footer line. These are the easiest case: the text on the page corresponds one-to-one with text in a file, so an in-place edit is unambiguous.

## Markdown entries

Long-form writing usually lives in a content collection: a folder of markdown files with typed frontmatter. The body is prose; the frontmatter is structured data with a schema behind it.

![A rendered preview and its source, side by side](/images/workflow.svg)

That schema is a quiet superpower. Because the collection declares its fields and types, an editing tool can render a real form, with date pickers for dates and dropdowns for enums, instead of asking you to write YAML by hand.

## Expressions and loops

The rest of the page is *derived*: titles pulled from frontmatter, cards rendered in a loop, values computed in the component script. The rendered result looks like ordinary text, but there is no single place in the source where that exact sentence exists.

> The page shows you one rendering. The source holds the rule that produced it. Editing the rendering cannot change the rule.

This is why a trustworthy editor treats derived text as read-only and points you at the source instead. It is not a limitation so much as an honest map of where your words actually live.
