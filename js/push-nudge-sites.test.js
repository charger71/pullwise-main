// Every place a customer follows a series or an artist offers notifications afterwards (js/push-nudge.js): a new
// follow button that forgot to nudge would skip the moment the app asks. Checked in the source, since the buttons need
// a signed-in page to run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const LOOKAHEAD = 4; // lines after the follow in which its nudge must come

for (const file of ['js/components.js', 'js/pages/account.js']) {
  const lines = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!/await pull\.(followSeries|followArtist)\(/.test(line)) return;
    const after = lines.slice(i + 1, i + 1 + LOOKAHEAD).join('\n');
    assert.match(after, /\bnudge\(\{ kind: 'follow'/, `${file}:${i + 1} follows without offering notifications (nudge)`);
  });
}
