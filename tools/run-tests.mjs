// npm test: runs every *.test.js / *.test.mjs in the repo (found by name, so a new test file is never left out), then
// the two repo checks. Each runs to the end even when an earlier one fails, and the failures are listed together.

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', '.git', 'vendor', '.wrangler']);

/** Every test file under `dir`, as paths from the repo root. */
function testFiles(dir = ROOT) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : testFiles(join(dir, e.name));
    return /\.test\.m?js$/.test(e.name) ? [relative(ROOT, join(dir, e.name))] : [];
  });
}

// Checks of the repo itself (not unit tests): the migration rules and shops.json.
const CHECKS = [['tools/check-migrations.js'], ['tools/deploy-plan.mjs', '--check']];

const failed = [];
for (const args of [...testFiles().sort().map((f) => [f]), ...CHECKS]) {
  const { status } = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  if (status !== 0) failed.push(args.join(' '));
}
if (failed.length) {
  console.error(`\n${failed.length} failed:\n${failed.map((f) => `  node ${f}`).join('\n')}`);
  process.exit(1);
}
