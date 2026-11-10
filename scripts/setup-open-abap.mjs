#!/usr/bin/env node
// Fetches the open-abap engine (https://github.com/open-abap, MIT) into vendor/open-abap and builds the
// report/dynpro converter. Used by the classic ABAP engine (src/classic): reports, module pools, function
// groups, DDIC, and the standard classes of open-abap-core.
//   node scripts/setup-open-abap.mjs [--update]      (--update: the newest upstream commits instead of the tested ones)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'vendor', 'open-abap');
const PATCHES = path.join(ROOT, 'scripts', 'open-abap-patches');
// the commits RAP Studio is tested with (our patches apply to them); --update moves to the newest upstream commits
// instead, for trying a new version (then update the commits here and the patches)
export const PINNED = {
  'open-abap-core': 'f735eed652288c8ed85b3083a187cc3e7e4a9b97',
  'open-abap-gui': '51a5a572f6213f7d9e1b42e7c67f0b52b9905aae',
  'express-icf-shim': '996eb798ff8aa0a302c6672e95b1fde7b95bcbe3',
  'open-abap-bal': '0aa2ef7cea93ec65be007b1c8495cc83e769f334',
  'open-abap-pdf': '24ebdce4fa0a3cb377ec355ab80148a4e72bbb82',
  'open-abap-jobs': '86daa6edb0a44e686fde921e5786b76f211ab8f8',
  'open-abap-lock': '049c4a38dcbf0a490970a9fc89caf01b1c51a11b',
  'open-abap-xco': 'b4ea7ebb398808209934827841e8d4b7b8642b65',
};
export const REPOS = Object.keys(PINNED);
const update = process.argv.includes('--update');
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

fs.mkdirSync(VENDOR, { recursive: true });
let patched = false;   // the converter's sources changed: build it again
for (const r of REPOS) {
  const dir = path.join(VENDOR, r);
  const head = () => { try { return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
  if (!fs.existsSync(dir)) {
    console.log(`[open-abap] fetching ${r}`);
    fs.mkdirSync(dir, { recursive: true });
    run('git', ['-C', dir, 'init', '-q']);
    run('git', ['-C', dir, 'remote', 'add', 'origin', `https://github.com/open-abap/${r}.git`]);
  }
  const want = update ? null : PINNED[r];
  if (update || head() !== want) {
    // a different commit: drop our patch first (it is applied again below), then fetch just that commit
    if (head()) run('git', ['-C', dir, 'checkout', '-q', '--', '.']);
    run('git', ['-C', dir, 'fetch', '-q', '--depth', '1', 'origin', want || 'HEAD']);
    run('git', ['-C', dir, 'checkout', '-q', '--detach', 'FETCH_HEAD']);
    if (r === 'open-abap-gui') patched = true;
  }
  // our fixes on top (scripts/open-abap-patches/<repo>.patch): applied once; a changed patch is applied again to a
  // clean checkout (an older version of it may be in place)
  const patch = path.join(PATCHES, `${r}.patch`);
  if (fs.existsSync(patch)) {
    try { execFileSync('git', ['-C', dir, 'apply', '--reverse', '--check', patch], { stdio: 'ignore' }); }
    catch {
      console.log(`[open-abap] patching ${r}`);
      run('git', ['-C', dir, 'checkout', '-q', '--', '.']);
      run('git', ['-C', dir, 'apply', patch]);
      if (r === 'open-abap-gui') patched = true;
    }
  }
}
const conv = path.join(VENDOR, 'open-abap-gui', 'converter');
if (update || patched || !fs.existsSync(path.join(conv, 'build', 'src', 'api.js'))) {
  console.log('[open-abap] building the report/dynpro converter');
  run('npm', ['install', '--silent', '--no-audit', '--no-fund'], conv);
  run('npx', ['tsc', '-p', '.'], conv);
}
console.log(`[open-abap] ready in ${path.relative(ROOT, VENDOR)}`);
