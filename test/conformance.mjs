// Conformance run against a directory of abapGit sources, e.g. SAP's ABAP cheat sheets:
//   git clone --depth 1 https://github.com/SAP-samples/abap-cheat-sheets /tmp/cheat
//   node test/conformance.mjs /tmp/cheat/src
// Every class (with its local includes), CDS source and BDEF is parsed/compiled; failures are listed.
import fs from 'node:fs';
import path from 'node:path';
import { compileAbap, registerInterfaces } from '../src/abap/compiler.js';
import { parseCds } from '../src/ddl/cds.js';
import { parseBdef } from '../src/ddl/bdef.js';

const dir = process.argv[2];
if (!dir) { console.error('usage: node test/conformance.mjs <dir with abapGit files>'); process.exit(2); }
let ok = 0;
const fails = [];
// global interfaces first (as during activation): classes implementing them need their signatures
for (const f of fs.readdirSync(dir)) if (/\.intf\.abap$/.test(f)) registerInterfaces(fs.readFileSync(path.join(dir, f), 'utf8'), f);
for (const f of fs.readdirSync(dir).sort()) {
  const p = path.join(dir, f);
  try {
    if (/\.(clas|intf)\.abap$/.test(f)) {
      const base = f.replace(/\.(clas|intf)\.abap$/, '');
      const units = [{ src: fs.readFileSync(p, 'utf8'), file: f }];
      for (const x of ['locals_def', 'locals_imp']) { const lp = path.join(dir, `${base}.clas.${x}.abap`); if (fs.existsSync(lp)) units.push({ src: fs.readFileSync(lp, 'utf8'), file: path.basename(lp) }); }
      for (const c of compileAbap(units, f).classes) new Function('$rt', c.js);
    } else if (/\.(asddls|srvdsrv|asddlxs)$/.test(f)) parseCds(fs.readFileSync(p, 'utf8'), f);
    else if (/\.asbdef$/.test(f)) parseBdef(fs.readFileSync(p, 'utf8'), f);
    else continue;
    ok++;
  } catch (e) { fails.push(`${e.file || f}:${e.line ?? ''}  ${(e.bare || e.message).slice(0, 120)}`); }
}
console.log(`passed ${ok}, failed ${fails.length}`);
for (const x of fails) console.log('  ' + x);
