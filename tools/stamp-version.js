// Writes admin/version.js: "v<date> · <fingerprint>" shown in the admin footer.
// The fingerprint is a short hash of every file under admin/, js/ and css/ (except version.js itself), so it
// changes exactly when the site's code does, however the commit was made. The date is kept from the last
// stamp until the fingerprint changes. Run by the git pre-commit hook (.githooks/pre-commit).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OUT = 'admin/version.js';
const files = execFileSync('git', ['ls-files', 'admin', 'js', 'css'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && f !== OUT && existsSync(f))
  .sort();
const hash = createHash('sha1');
for (const f of files) hash.update(f).update('\0').update(readFileSync(f));
const fingerprint = hash.digest('hex').slice(0, 7);

const previous = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
if (previous.includes(`· ${fingerprint}'`)) process.exit(0); // code unchanged since the last stamp

const date = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replaceAll('-', '.');
writeFileSync(OUT, `// Written by tools/stamp-version.js on commit; don't edit by hand.\nexport const VERSION = 'v${date} · ${fingerprint}';\n`);
console.log(`Stamped ${OUT}: v${date} · ${fingerprint}`);
