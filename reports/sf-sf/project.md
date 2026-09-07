# sf-sf testing orientation

Exploratory browser testing ran on **2026-09-06**; reports completed on **2026-09-07**. The target is [examples/sf-sf](../../examples/sf-sf), the Something Familiar static Astro site. This directory contains this consumer's evidence, separate from the playground and Airbnb reports.

Start with the site's [README](../../examples/sf-sf/README.md), [architecture and conventions](../../examples/sf-sf/CLAUDE.md), [integration documentation](../../examples/sf-sf/docs/integrations.md), and [page/design index](../../examples/sf-sf/docs/figma-frames.md). Its [content configuration](../../examples/sf-sf/src/content.config.ts) defines six collections. For the editing tool, [Architecture](../../docs/ARCHITECTURE.md) indexes the existing feature documentation; the testing method is described in `notes/handoff-astro-testing.md` (local, gitignored).

The tested server remains at **http://localhost:4383/**. Its health endpoint identifies this example's absolute root. Port **4381 belongs to a different checkout**, `/Users/jc/_Web_Sites_/SF-SF-WEBSITE/`, which was not edited. Installed versions were Astro **5.18.2** and local `astro-dev-edit` **0.7.1**. The example defensively imports the old package name, so `node_modules/astro-text-edit` links to the integration repository. Package files and config remain unchanged. See [tests.md](tests.md) for reproducible setup and exact revisions.

Detail pages still emit the old page-source meta name; use **menu → Collections → collection → Items → entry** to reach the entry drawer in this unchanged checkout. This setup issue is documented, not repaired.

- [Initial exploratory plan](initial-plan.md), written before consulting historical integration reports.
- [Bugs found](bugs.md).
- [Executed tests, outcomes, comparisons and restoration](tests.md).
- [Editor-opening triggers for manual verification](editor-opening-triggers.md).
- [Image storage and media roadmap improvements](image-storage-roadmap.md).

All 496 backed-up project files were restored byte-for-byte with original permissions. The example's git status is clean. Dependencies and generated build/cache output remain available; the reports are the only intended durable source additions from this pass.
