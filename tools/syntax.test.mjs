// Every script parses. Most admin screens and storefront pages have no unit test that loads them, so a broken line
// (an unclosed string, a missing bracket) would otherwise only show in the browser, as "Couldn't open this section".
// node --check reads each file without running it.

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP = new Set(['node_modules', '.git', 'vendor', '.wrangler', 'out', 'prh-probe-out']);

function scripts(dir = ROOT) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP.has(e.name) || e.name.startsWith('.') ? [] : scripts(join(dir, e.name));
    return /\.m?js$/.test(e.name) ? [join(dir, e.name)] : [];
  });
}

const broken = [];
const files = scripts();
for (const file of files) {
  const { status, stderr } = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (status !== 0) broken.push(`${relative(ROOT, file)}\n${stderr.trim().split('\n').slice(0, 5).join('\n')}`);
}
if (broken.length) {
  console.error(`Scripts that don't parse:\n\n${broken.join('\n\n')}`);
  process.exit(1);
}
console.log(`syntax ok (${files.length} scripts)`);
