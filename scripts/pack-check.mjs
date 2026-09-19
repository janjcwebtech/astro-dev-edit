/**
 * Prove the published package behaves on a *real* install (issue #75).
 *
 * The unit suite cannot see this: every test imports from the working tree, and
 * `examples/` installs the package by path, so the entry's realpath lands
 * outside `node_modules` and Node's type-stripping restriction never applies.
 * Only a packed tarball, unpacked into a scratch project, reproduces what a
 * consumer gets.
 *
 * Two halves, and both are assertions — the failing one is as load-bearing as
 * the passing one:
 *
 *  - A **static** import works, because Astro loads `astro.config.mjs` through
 *    Vite and Vite strips the types. Asserted by booting a dev server and
 *    reading `/__dev-edit/health` and the annotations on the page.
 *  - A **dynamic** `await import()` fails with
 *    `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, because a bare specifier
 *    imported at runtime goes to Node's own loader, which refuses to strip
 *    types under `node_modules`. This is the documented limit, pinned here so a
 *    later change cannot quietly turn the silent-overlay-never-appears failure
 *    back on without this going red.
 *
 * Network and about a minute, so it is not in `npm test`. Run it before cutting
 * a release: `npm run check:pack`.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 4331;
const EXPECTED_REFUSAL = 'ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING';

const failures = [];
function check(ok, label, detail) {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
  if (!ok) {
    failures.push(label);
    if (detail) console.log(`       ${detail}`);
  }
}

/** Poll until the dev server answers, rather than sleeping a guessed interval. */
async function waitForServer(url, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
}

const dir = await mkdtemp(join(tmpdir(), 'astro-dev-edit-pack-'));
const proj = join(dir, 'proj');
let serverStarted = false;

try {
  console.log(`\nscratch: ${dir}\n`);

  console.log('packing…');
  const { stdout: packed } = await run('npm', ['pack', '--pack-destination', dir], { cwd: ROOT });
  const tarball = join(dir, packed.trim().split('\n').pop().trim());

  console.log('installing the tarball into a scratch project…');
  await run('mkdir', ['-p', join(proj, 'src', 'pages')]);
  await writeFile(
    join(proj, 'package.json'),
    JSON.stringify({ name: 'pack-check', private: true, type: 'module', version: '1.0.0' }, null, 2),
  );
  await writeFile(
    join(proj, 'astro.config.mjs'),
    'import { defineConfig } from "astro/config";\n'
      + 'import devEdit from "astro-dev-edit";\n\n'
      + 'export default defineConfig({ integrations: [devEdit()] });\n',
  );
  await writeFile(
    join(proj, 'src', 'pages', 'index.astro'),
    '<html><body><h1>pack check</h1><p>words in a file</p></body></html>\n',
  );
  await run('npm', ['install', tarball, '--no-audit', '--no-fund'], { cwd: proj, timeout: 300_000 });

  // --- the install is a real copy, not a symlink ---------------------------
  // A symlinked install resolves outside `node_modules` and would pass both
  // halves for the wrong reason, so the premise is asserted before the halves.
  const { stdout: realpath } = await run('node', [
    '-e',
    'console.log(require("fs").realpathSync("node_modules/astro-dev-edit"))',
  ], { cwd: proj });
  check(
    realpath.includes('node_modules'),
    'the install is a real copy under node_modules',
    `realpath: ${realpath.trim()}`,
  );

  // --- half one: a dynamic import is refused, by name ----------------------
  const { stdout: dynamic } = await run('node', [
    '-e',
    'import("astro-dev-edit").then(() => console.log("LOADED")).catch((e) => console.log(e.code ?? "no-code"))',
  ], { cwd: proj });
  check(
    dynamic.trim() === EXPECTED_REFUSAL,
    `a dynamic import is refused with ${EXPECTED_REFUSAL}`,
    `got: ${dynamic.trim()}`,
  );

  // --- half two: a static import mounts the integration --------------------
  console.log('booting the dev server…');
  // Astro 7's `astro dev` detaches, so this returns while the server runs on;
  // it is stopped in `finally` either way.
  await run('npx', ['astro', 'dev', '--port', String(PORT)], { cwd: proj, timeout: 120_000 })
    .catch(() => {}); // a non-detaching Astro (5/6) never returns — the poll below is the real gate
  serverStarted = true;

  const up = await waitForServer(`http://localhost:${PORT}/`);
  check(up, 'the dev server answers');

  if (up) {
    const health = await fetch(`http://localhost:${PORT}/__dev-edit/health`)
      .then((r) => r.json())
      .catch(() => null);
    check(
      health?.ok === true && health?.name === 'astro-dev-edit',
      'the integration mounted from a static import',
      `health: ${JSON.stringify(health)}`,
    );

    // Either namespace counts. Which attribute the annotation plugin writes is
    // the subject of #72/#76, not of this check — here it only has to prove the
    // plugin ran at all from a real install, so hard-coding one would make a
    // packaging check fail on an annotation change.
    const html = await fetch(`http://localhost:${PORT}/`).then((r) => r.text()).catch(() => '');
    const annotations = [...html.matchAll(/data-(?:atx|astro-source)-file="([^"]*)"/g)].map((m) => m[1]);
    check(
      annotations.some((f) => f.endsWith('src/pages/index.astro')),
      'the annotation plugin ran, and names the page file',
      `found ${annotations.length} annotation(s): ${JSON.stringify([...new Set(annotations)])}`
        + `\n       first 300 bytes: ${JSON.stringify(html.slice(0, 300))}`,
    );
  }
} finally {
  if (serverStarted) {
    await run('npx', ['astro', 'dev', 'stop'], { cwd: proj, timeout: 30_000 }).catch(() => {});
  }
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

console.log(failures.length ? `\n${failures.length} failed\n` : '\nall checks passed\n');
process.exit(failures.length ? 1 : 0);
