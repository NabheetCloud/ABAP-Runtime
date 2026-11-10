// helper: round-trips every designable source of the examples (parse -> write -> parse); node test/visual-rt.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as M from '../src/ui/studio/visual/models.js';

export const KINDS = { 'tabl.cds': ['parseTable', 'writeTable'], 'ddls.asddls': ['parseView', 'writeView'], 'bdef.asbdef': ['parseBdef', 'writeBdef'], 'ddlx.asddlxs': ['parseDdlx', 'writeDdlx'] };
export function designable(dir) {
  const files = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory() && !['.rap', 'node_modules', 'webapp'].includes(e.name)) walk(f); else if (Object.keys(KINDS).some(k => e.name.endsWith(k))) files.push(f); } };
  walk(dir);
  return files;
}
export function roundTrip(f) {
  const k = Object.keys(KINDS).find(x => f.endsWith(x));
  const [p, w] = KINDS[k];
  const t = fs.readFileSync(f, 'utf8');
  let a;
  try { a = M[p](t); } catch (e) { return { kind: k, skipped: e.message }; }
  const out = M[w](a);
  const b = M[p](out);
  return { kind: k, out, same: JSON.stringify(a) === JSON.stringify(b) && M[w](b) === out };
}
if (process.argv[1] && process.argv[1].endsWith('visual-rt.mjs')) {
  const stats = {};
  for (const f of designable(process.argv[2] || 'examples')) {
    const r = roundTrip(f);
    const s = `${r.kind} ${r.skipped ? 'skip' : r.same ? 'ok' : 'DIFF'}`;
    stats[s] = (stats[s] || 0) + 1;
    if (r.skipped && process.argv[3]) console.log('SKIP', f, r.skipped);
    if (!r.skipped && !r.same) console.log('DIFF', f);
  }
  console.log(stats);
}
