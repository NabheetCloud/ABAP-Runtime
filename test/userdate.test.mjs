// The user's date format (SAP's DATFM 1-6): kept per user in the system's settings, chosen in the studio's user
// dialog, and used by the classic engine for screens, WRITE lists / DATE = USER templates, printed forms and the
// function module test page.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatDate, parseUserDate, settingsOf, setSettings, SETTINGS_FILE } from '../src/server/usersettings.js';
import { userDate } from '../src/classic/userdate.mjs';
import { DATE_HINT, parseDate } from '../src/classic/functions.mjs';
import { Studio } from '../src/studio/studio.js';
import { Workspace } from '../src/server/server.js';
import { classicAvailable } from '../src/classic/build.mjs';
import { runProgram } from '../src/classic/client.mjs';

const skip = !classicAvailable() ? 'classic engine not installed (npm run setup:open-abap)' : /^pglite|^postgres/.test(process.env.RAP_DB || '') ? 'the classic engine uses the SQLite database' : false;
const tmp = [];
after(() => { for (const d of tmp) fs.rmSync(d, { recursive: true, force: true }); });
const mk = p => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); tmp.push(d); return d; };

test('date formats: SAP DATFM 1-6 out and in; invalid days are no dates', () => {
  const out = ['1', '2', '3', '4', '5', '6'].map(c => formatDate('20261231', c));
  assert.deepEqual(out, ['31.12.2026', '12/31/2026', '12-31-2026', '2026.12.31', '2026/12/31', '2026-12-31']);
  ['1', '2', '3', '4', '5', '6'].forEach((c, i) => assert.equal(parseUserDate(out[i], c), '20261231', c));
  assert.equal(formatDate('00000000', '2'), '');
  assert.equal(parseUserDate('20261231', '2'), '20261231', 'the internal format always works');
  assert.equal(parseUserDate('02/03/2026', '2'), '20260203', 'month first');
  assert.equal(parseUserDate('02.03.2026', '1'), '20260302', 'day first');
  assert.equal(parseUserDate('2/3/2026', '2'), null, 'two digits for day and month');
  assert.equal(parseUserDate('2026-11-10', '1'), null, 'only the user\'s format (and YYYYMMDD)');
  assert.equal(parseUserDate('31/02/2026', '2'), null);
  assert.equal(parseUserDate('13/01/2026', '2'), null, 'no month 13');
  assert.equal(parseUserDate('tomorrow', '1'), null);
  // the function module test page follows the user's format
  userDate.code = '2';
  try { assert.equal(DATE_HINT.D, 'MM/DD/YYYY'); assert.equal(parseDate('12/31/2026'), '20261231'); } finally { userDate.code = '1'; }
  assert.equal(DATE_HINT.D, 'DD.MM.YYYY');
});

test('settings: per user, default DD.MM.YYYY, unknown codes refused', () => {
  const dir = mk('rap-us-');
  assert.equal(settingsOf(dir, 'alice').dateFormat, '1');
  setSettings(dir, 'alice', { dateFormat: '6' });
  assert.equal(settingsOf(dir, 'ALICE').dateFormat, '6');
  assert.equal(settingsOf(dir, 'bob').dateFormat, '1');
  assert.throws(() => setSettings(dir, 'alice', { dateFormat: '9' }), /Unknown date format/);
  assert.equal(settingsOf(dir, '__proto__').dateFormat, '1');
  fs.writeFileSync(path.join(dir, SETTINGS_FILE), '{broken');
  assert.equal(settingsOf(dir, 'alice').dateFormat, '1', 'a broken file gives the defaults');
});

test('studio: the user API reads and saves the date format of the current user', async () => {
  const dir = mk('rap-us-studio-');
  const s = new Studio(dir, { port: 0 });
  const srv = s.listen();
  await new Promise(r => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}/studio/api/user`;
  const H = { 'content-type': 'application/json', cookie: 'rap_user=CAROL' };
  try {
    assert.deepEqual((await (await fetch(base, { headers: H })).json()).settings, { dateFormat: '1' });
    const r = await (await fetch(base, { method: 'POST', headers: H, body: JSON.stringify({ settings: { dateFormat: '2' } }) })).json();
    assert.equal(r.user, 'CAROL');
    assert.equal(r.settings.dateFormat, '2');
    assert.equal(settingsOf(dir, 'carol').dateFormat, '2');
    assert.equal((await fetch(base, { method: 'POST', headers: H, body: JSON.stringify({ settings: { dateFormat: 'x' } }) })).status, 400);
    assert.equal((await fetch(base, { method: 'POST', headers: H, body: '{' })).status, 400);
  } finally { s.close(); }
});

test('classic engine: WRITE lists, the page and a changed setting follow the user', { skip, timeout: 180000 }, async () => {
  const dir = mk('rap-us-po-');
  fs.cpSync(new URL('./fixtures/po-classic', import.meta.url).pathname, dir, { recursive: true });
  setSettings(dir, 'DEVELOPER', { dateFormat: '2' });
  const ws = new Workspace(dir, { systemDir: false, lint: false });
  try {
    const st = await ws.classic.ensure();
    assert.equal(st.state, 'running', JSON.stringify(st.diagnostics));
    const base = st.url.replace('localhost', '127.0.0.1');
    const r = await runProgram(base, 'ZPO_REPORT', { P_CREATE: 'X', P_NEWPO: '4500000001', P_ALV: '' });
    assert.ok(r.ok, r.message);
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    assert.ok(r.list.includes(formatDate(today, '2')), `list shows the date as MM/DD/YYYY:\n${r.list.slice(0, 600)}`);
    assert.ok(!r.list.includes(formatDate(today, '1')), 'not as DD.MM.YYYY');
    let page = await (await fetch(`${base}program?name=ZPO_REPORT`)).text();
    assert.match(page, /data-rap-datfm="2"/);
    setSettings(dir, 'DEVELOPER', { dateFormat: '6' });
    page = await (await fetch(`${base}program?name=ZPO_REPORT`)).text();
    assert.match(page, /data-rap-datfm="6"/, 'a changed setting applies to the next page');
    // the studio's user cookie picks the user of the request
    setSettings(dir, 'ERIN', { dateFormat: '4' });
    page = await (await fetch(`${base}program?name=ZPO_REPORT`, { headers: { cookie: 'rap_user=ERIN' } })).text();
    assert.match(page, /data-rap-datfm="4"/);
  } finally { ws.close(); }
});
