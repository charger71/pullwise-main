// Where the generator reads and writes, and what it records about the source. See README.md.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root (this file is tools/design-system/config.mjs). */
export const REPO = fileURLToPath(new URL('../../', import.meta.url));

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/**
 * --from: a folder holding the design system's current files at their published paths (project/tokens.json,
 * project/README.md, …), read from the artifact just before the run. The marketing layer, the cover, the logos and
 * anything people changed on the page are kept from it; only the storefront and admin layers are rebuilt.
 * --out: where the updated copy goes (default tools/design-system/out, which git ignores).
 */
const from = arg('from');
const out = arg('out') ?? resolve(REPO, 'tools/design-system/out');
if (!from || !existsSync(resolve(from, 'project/tokens.json'))) {
  console.error('Usage: npm run design-system -- --from <folder with the system\'s project/ files> [--out <folder>]');
  process.exit(1);
}
export const FROM = `${resolve(from, 'project')}/`;
export const OUT = `${resolve(out, 'project')}/`;
mkdirSync(OUT, { recursive: true });

const git = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
/** The commit the layers are built from, e.g. "main@d06bd95"; "+changes" when the working tree differs from it. */
export const REF = `${git('rev-parse', '--abbrev-ref', 'HEAD')}@${git('rev-parse', '--short', 'HEAD')}${git('status', '--porcelain', '--', 'css', 'js', 'admin', 'fonts') ? '+changes' : ''}`;
export const TODAY = new Date().toISOString().slice(0, 10);
