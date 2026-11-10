// abapGit export: object XML next to the sources, CDS tables as TABL XML, one service binding per service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abapGitFiles } from '../src/studio/abapgit.js';
import { syntaxCheck } from '../src/check/abaplint.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('travel exports as an abapGit repository that abaplint accepts', () => {
  const files = abapGitFiles(new URL('../examples/travel', import.meta.url).pathname, { packageName: 'ZTRAVEL' });
  for (const f of ['.abapgit.xml', 'src/package.devc.xml', 'src/ztravel_a.tabl.xml', 'src/zr_travel.ddls.xml', 'src/zr_travel.bdef.xml', 'src/zui_travel.srvd.xml', 'src/zui_travel_o4.srvb.xml', 'src/zbp_r_travel.clas.xml']) assert.ok(files.has(f), f);
  assert.ok(![...files.keys()].some(f => f.endsWith('.tabl.cds')));
  assert.match(files.get('src/ztravel_a.tabl.xml'), /<FIELDNAME>TRAVEL_UUID<\/FIELDNAME>[\s\S]*<KEYFLAG>X<\/KEYFLAG>/);
  assert.match(files.get('src/zc_travel.ddls.xml'), /<SOURCE_TYPE>P<\/SOURCE_TYPE>/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-ag-'));
  for (const [rel, c] of files) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), c); }
  assert.deepEqual(syntaxCheck(dir).errors, []);
  fs.rmSync(dir, { recursive: true, force: true });
});
