# sf-sf initial exploratory plan — 2026-09-06

Written after reading the handoff, target README/CLAUDE/config/schema/routes, and current feature documentation, **before consulting historical integration bug reports**. Target is `examples/sf-sf`, not the separate SF-SF-WEBSITE checkout occupying port 4381. Planned test origin: http://localhost:4383.

## Discovery

Astro 5 static site with ClientRouter, GSAP/Lenis, shared components and props, six collections (five glob Markdown/MDX collections and one file-loader JSON archive). Work and service schemas contain nested objects/arrays; policies and case studies use MDX components. Detail routes opt into entry editing via the supported legacy page-source meta name. Asset conventions separate optimized imports in src/assets by area from deliberately unoptimized public GIF/alpha assets, plus remote Bunny CDN videos. No integration is installed on a fresh clone; the config defensively imports the legacy package name.

## Initial coverage

1. Establish served root, installed version/resolution, toolbar and annotations, listing/detail opt-in and representative route resolution.
2. Exercise literal text save/Enter/blur/Escape and save-on-exit, inline-markup save and rejection, and safe refusal of props/computed/package output. Verify exact source and navigation/HMR completion.
3. Inspect note/work/service/policy/role drawers: schema widgets, defaults, nested read-only data, date, image path, no-op and dirty cancel. Save representative frontmatter while preserving MDX/imports/comments/body. Exercise supported rich text vs source-mode fallback.
4. Use disposable entries for creation, duplicate protection and deletion; verify destination route, extension, defaults and cleanup. Inspect file-loader collection behavior without modifying shared archive data.
5. Explore image() previews, scope/filter/sort, selection cancellation, swap and upload placement; distinguish optimized assets, public GIFs, MDX imports, dynamic images and remote video. Record roadmap limitations separately from defects.
6. Inspect Collections and Settings, including config locks and a reversible live setting; verify Elements selection, source peek, CSS inspection and source-opening trigger inventory from current code.
7. Exercise ClientRouter navigation, modifier navigation, panel focus/Escape, desktop and a narrow viewport; inspect console/network errors for attribution.
8. After this plan, consult history for a bounded comparison pass. Run existing integration tests/typecheck and consumer static build where feasible; inspect production output for editor injection. Label protocol-only, manual-only, blocked and untested cases explicitly.

## Runtime correction (added when reporting)

The initial assumption that the legacy page-source meta was supported proved incorrect: the client detects it only to warn, and does not enable Edit entry. Testing used the existing Collections → Items entry point without modifying the layout or injecting a replacement meta tag. See [tests.md](tests.md) and [SF-SETUP-01](bugs.md#sf-setup-01--old-meta-name-hides-the-detail-page-entry-shortcut).

## Preservation

Target git baseline clean at 13b2949f5284312122c3c0f8d186cc117aae8990. Exact byte backups and SHA-256/mode manifest for 496 non-generated files stored in /tmp/sf-sf-retest-20260906 before browser writes. Existing integration worktree edits remain untouched. Dependency installation is local/ignored; no package/config change is planned. Restore only recorded test mutations after checking for unrelated concurrent changes.
