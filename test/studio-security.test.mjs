// Security regressions of RAP Studio and `rap serve` that are independent of any assistant: no login bypass with a
// bearer token, safe login redirects, the studio page's Content-Security-Policy, the Build chat's Markdown links, and
// jobs not started by a plain GET.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace, startServer } from '../src/server/server.js';
import { authStoreFor, safeNext } from '../src/server/auth.js';
import { Studio, studioCsp } from '../src/studio/studio.js';
import { md } from '../src/ui/studio/markdown.js';

const FAKE = { authorization: 'Bearer ' + 'a'.repeat(64) };
const ADMIN = { 'x-rap-user': 'ALICE' };
let dir, ws, server, base;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-sec-'));
  fs.cpSync(new URL('../apps/travel', import.meta.url).pathname, dir, { recursive: true });
  fs.rmSync(path.join(dir, '.rap'), { recursive: true, force: true });
  authStoreFor(dir).setUser('alice', { password: 'secret-a', admin: true });
  ws = new Workspace(dir, { dbFile: ':memory:', systemDir: false, lint: false });
  server = startServer(ws, 0);
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server?.close(); ws?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const travel = () => ws.odata.handle('GET', '/odata/zui_travel/Travel?$filter=IsActiveEntity eq true&$orderby=TravelUUID', null, ADMIN).body.value;
const post = (url, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });

test('a bearer token never skips the login (no assistant callback route exists any more)', async () => {
  const before = travel().map(r => [r.TravelUUID, r.OverallStatus]);
  const open = before.find(([, s]) => s === 'O');
  assert.ok(open, 'fixture has an open travel');
  for (const url of [
    '/genui/tool', '/genui/run', '/genui/capabilities',
    '/odata/zui_travel/$metadata/genui/tool',
    "/odata/zui_travel/Travel/$count/genui/tool?$filter=OverallStatus%20eq%20'O'",
    `/sap/opu/odata/sap/ZUI_TRAVEL/acceptTravel/genui/tool?TravelUUID=guid'${open[0]}'&IsActiveEntity=true`,
    '/genui%2Ftool', '/x/genui/tool',
  ]) {
    const r = await post(url, FAKE);
    assert.ok([401, 403].includes(r.status), `${url} -> ${r.status}`);
    assert.doesNotMatch(await r.text(), /edmx|"d":|^\d+$/, url);
  }
  // logged on: the assistant routes are gone
  const auth = { authorization: 'Basic ' + Buffer.from('alice:secret-a').toString('base64') };
  for (const url of ['/genui/capabilities', '/genui/resources/rap/genui/library.js']) assert.equal((await fetch(base + url, { headers: auth })).status, 404, url);
  assert.deepEqual(travel().map(r => [r.TravelUUID, r.OverallStatus]), before, 'no data changed');
});

test('login: next only returns to a path on this server', async () => {
  for (const n of ['/\\evil.com', '//evil.com', '/\t/evil.com', '/%09/x\\y', 'https://evil.com', '\\\\evil.com', '/ /evil.com', '']) assert.equal(safeNext(n), '/', JSON.stringify(n));
  for (const n of ['/', '/a/app/', '/a/app/?x=1#y']) assert.equal(safeNext(n), n);
  const r = await fetch(`${base}/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'user=alice&password=secret-a&next=' + encodeURIComponent('/\\evil.com') });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/');
  const page = await (await fetch(`${base}/login?next=${encodeURIComponent('/\\evil.com')}`)).text();
  assert.match(page, /name="next" value="\/"/);
});

test('the studio page is served with the Content-Security-Policy', async () => {
  const s = new Studio(fs.mkdtempSync(path.join(os.tmpdir(), 'rap-sec-csp-')), { port: 0 });
  const srv = s.listen();
  await new Promise(r => srv.once('listening', r));
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/`);
    assert.equal(r.status, 200);
    const csp = r.headers.get('content-security-policy') || '';
    assert.match(csp, /img-src 'self' data: blob:;/);
    assert.match(csp, /connect-src 'self';/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /frame-ancestors 'self'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  } finally { s.close(); }
});

test('CSP: jsdelivr only for the pinned Monaco and pdf.js packages', () => {
  const csp = studioCsp();
  assert.doesNotMatch(csp, /https:\/\/cdn\.jsdelivr\.net[ ;]/, 'never the whole CDN');
  assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net\/npm\/monaco-editor@0\.52\.2\/ https:\/\/cdn\.jsdelivr\.net\/npm\/pdfjs-dist@4\.10\.38\/;/);
  const ui = fs.readFileSync(new URL('../src/ui/studio/studio.js', import.meta.url), 'utf8') + fs.readFileSync(new URL('../src/ui/studio/xdp-designer.js', import.meta.url), 'utf8');
  for (const u of ui.match(/https:\/\/cdn\.jsdelivr\.net\/npm\/[^'"`\s]+/g)) assert.ok(csp.split(/[ ;]+/).some(src => src.endsWith('/') && u.startsWith(src)), `${u} is covered`);
  assert.doesNotMatch(ui, /genui|mountDataChat|data-mode="data"/, 'no data-assistant mode in the studio');
});

test('CSP: frames may load the classic engine on its own local port (Run / Debug preview)', () => {
  const frame = studioCsp().split(';').map(s => s.trim()).find(s => s.startsWith('frame-src'));
  assert.ok(frame.includes('http://localhost:*') && frame.includes('http://127.0.0.1:*'), frame);
  assert.doesNotMatch(frame, /https?:\/\/\*|\s\*(\s|$)/, 'never any host');
});

test('Build chat Markdown: https links are links, javascript: never; links can be shown as text', () => {
  assert.match(md('[docs](https://help.sap.com)'), /<a href="https:\/\/help\.sap\.com" target="_blank">docs<\/a>/);
  assert.doesNotMatch(md('[x](javascript:alert(1))', { links: 'text' }) + md('[x](javascript:alert(1))'), /<a /);
  const t = md('Look [here](https://evil.example/c?d=secret)', { links: 'text' });
  assert.doesNotMatch(t, /<a /);
  assert.match(t, /here \(<span class="md-url">https:\/\/evil\.example\/c\?d=secret<\/span>\)/);
});

test('studio: a plain GET of an app page opens the workspace without starting its jobs', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-sec-jobs-'));
  fs.cpSync(new URL('./fixtures/secured', import.meta.url).pathname, path.join(d, 'sec'), { recursive: true });
  const s = new Studio(d, { port: 0 });
  const srv = s.listen();
  await new Promise(r => srv.once('listening', r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  try {
    await fetch(`${b}/a/sec/`);
    await fetch(`${b}/a/sec/odata/zui_sale/Sale`);
    assert.ok(s.workspaces.has('sec'));
    assert.ok(!s.workspaces.get('sec').jobsStarted, 'GET does not start jobs');
    assert.ok(!s.workspaces.get('sec').jobTimer);
    await fetch(`${b}/a/sec/api/trace`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"on":false}' });
    assert.ok(s.workspaces.get('sec').jobsStarted, 'a change request starts them');
  } finally { s.close(); fs.rmSync(d, { recursive: true, force: true }); }
});

test('$metadata: keys with external numbering are Immutable (settable on create), managed keys Computed', () => {
  const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-sec-meta-'));
  fs.cpSync(new URL('./fixtures/secured', import.meta.url).pathname, tdir, { recursive: true });
  const bdef = path.join(tdir, 'src', 'zr_sale.bdef.asbdef');
  fs.writeFileSync(bdef, fs.readFileSync(bdef, 'utf8').replace('  update;', '  create;\n  update;').replace('field ( readonly ) SaleId, Owner, IsMine;', 'field ( readonly ) Owner, IsMine;\n  field ( readonly : update ) SaleId;'));
  const ew = new Workspace(tdir, { dbFile: ':memory:', systemDir: false, lint: false });
  try {
    const x = ew.odata.handle('GET', '/odata/zui_sale/$metadata', null, ADMIN).body;
    const ann = p => (new RegExp(`SaleType/${p}"[^]*?</Annotations>`).exec(x) || [''])[0];
    assert.match(ann('SaleId'), /Core\.Immutable/);
    assert.doesNotMatch(ann('SaleId'), /Core\.Computed/);
    assert.match(ann('Owner'), /Core\.Computed/);
  } finally { ew.close(); fs.rmSync(tdir, { recursive: true, force: true }); }
  const m = ws.odata.handle('GET', '/odata/zui_travel/$metadata', null, ADMIN).body;
  assert.match((/TravelType\/TravelUUID"[^]*?<\/Annotations>/.exec(m) || [''])[0], /Core\.Computed/, 'managed numbering');
});

test('with users: an app\'s development functions are for administrators; end users keep their pages and value helps', async () => {
  authStoreFor(dir).setUser('bob', { password: 'secret-b' });
  const basic = (u, p) => ({ authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') });
  const bob = basic('bob', 'secret-b'), alice = basic('alice', 'secret-a');
  try {
    for (const [method, url] of [['POST', '/api/activate'], ['POST', '/api/run/zcl_travel_demo'], ['GET', '/api/js/zbp_r_travel'], ['GET', '/api/atc'], ['POST', '/api/check'],
      ['POST', '/api/debug'], ['POST', '/api/trace'], ['GET', '/api/trace'], ['POST', '/api/test'], ['POST', '/api/generate/object'], ['POST', '/api/clean'], ['GET', '/api/dumps'], ['GET', '/api/changes']]) {
      const r = await fetch(base + url, { method, headers: { ...bob, 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
      assert.equal(r.status, 403, `${method} ${url} -> ${r.status}`);
      assert.match((await r.json()).error.message, /not an administrator/);
    }
    // what end users use
    assert.equal((await fetch(base + '/api/user', { headers: bob })).status, 200);
    assert.equal((await fetch(base + '/api/workspace', { headers: bob })).status, 200);
    assert.equal((await fetch(base + '/api/classic', { headers: bob })).status, 200);
    assert.equal((await fetch(base + '/odata/zui_travel/Travel?$top=1', { headers: bob })).status, 200);
    // administrators keep everything
    assert.equal((await fetch(base + '/api/atc', { headers: alice })).status, 200);
    assert.equal((await fetch(base + '/api/trace', { headers: alice })).status, 200);
  } finally { authStoreFor(dir).deleteUser('bob'); }
});

// ---------------------------------------------------------------- 1.0.0 security review
import http from 'node:http';
const raw = (port, { method = 'GET', path: p = '/', headers = {}, body = '' } = {}) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, res => { let d = ''; res.on('data', c => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
  r.on('error', reject); r.end(body);
});

test('studio: listens on loopback only; other host names and cross-site changes are refused (no DNS rebinding, no CSRF)', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-sec-guard-'));
  const s = new Studio(d, { port: 0 });
  const srv = s.listen();
  await new Promise(r => srv.once('listening', r));
  const port = srv.address().port;
  try {
    assert.equal(srv.address().address, '127.0.0.1');
    assert.equal((await raw(port, { path: '/studio/api/apps', headers: { host: `attacker.example:${port}` } })).status, 421, 'rebinding name');
    assert.equal((await raw(port, { path: '/studio/api/apps', headers: { host: `localhost:${port}` } })).status, 200);
    const create = headers => raw(port, { method: 'POST', path: '/studio/api/apps', headers: { host: `localhost:${port}`, 'content-type': 'text/plain', ...headers }, body: '{"title":"x","flavor":"classic"}' });
    for (const h of [{ origin: 'https://evil.example' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site', origin: 'http://localhost:3000' }, { origin: 'null' }])
      assert.equal((await create(h)).status, 403, JSON.stringify(h));
    assert.deepEqual(fs.readdirSync(d).filter(n => !n.startsWith('.')), [], 'nothing was created');
    // the studio's own page, and clients without a browser (the CLI, the agent's curl) keep working
    assert.equal((await create({ origin: `http://localhost:${port}`, 'sec-fetch-site': 'same-origin' })).status, 201);
  } finally { s.close(); fs.rmSync(d, { recursive: true, force: true }); }
});

test('value helps of the built-in UI: only declared value-help entities, never a table', () => {
  const tw = new Workspace(new URL('../examples/travel', import.meta.url).pathname, { dbFile: ':memory:', systemDir: false, lint: false });
  try {
    assert.ok(tw.odata.valueHelp('ZI_Customer', '', 5, { 'x-rap-user': 'BOB' }).value.length > 0);
    assert.throws(() => tw.odata.valueHelp('zcustomer_a', '', 5, {}), /not found/, 'a database table');
    assert.throws(() => tw.odata.valueHelp('ZR_Travel', '', 5, {}), /not found/, 'an entity no field uses as value help');
  } finally { tw.close(); }
});

test('small hardening: date formats from Object.prototype are refused, the users file is private, the agent keeps its tool list', async () => {
  const { setSettings } = await import('../src/server/usersettings.js');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-sec-small-'));
  try {
    for (const bad of ['constructor', '__proto__', 'toString']) assert.throws(() => setSettings(d, 'x', { dateFormat: bad }), /Unknown date format/);
    authStoreFor(d).setUser('zed', { password: 'pw-zed-1' });
    assert.equal(fs.statSync(path.join(d, '.rap-users.json')).mode & 0o777, 0o600);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
  const agent = fs.readFileSync(new URL('../src/studio/agent.js', import.meta.url), 'utf8');
  assert.doesNotMatch(agent, /'--permission-mode', 'bypassPermissions'/);
  assert.match(agent, /'--permission-mode', 'acceptEdits'/);
});

test('classic engine with users: programs run as the studio\'s logged-on user (signed cookie); a browser without it is refused', { skip: !(await import('../src/classic/build.mjs')).classicAvailable() && 'classic engine not installed', timeout: 180000 }, async () => {
  const { signUser } = await import('../src/server/auth.js');
  const sys = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-sec-cl-'));
  const app = path.join(sys, 'who');
  fs.mkdirSync(path.join(app, 'src'), { recursive: true });
  fs.writeFileSync(path.join(app, 'src', 'zwho.prog.abap'), "REPORT zwho.\nWRITE: / 'USER=', sy-uname.\n");
  authStoreFor(sys).setUser('bob', { password: 'pw-bob-1' });
  const w = new Workspace(app, { systemDir: sys, lint: false });
  try {
    const st = await w.classic.ensure();
    assert.equal(st.state, 'running', JSON.stringify(st.diagnostics));
    const base = st.url.replace('localhost', '127.0.0.1');
    const page = async headers => { const r = await fetch(`${base}program?name=ZWHO`, { headers }); return { status: r.status, text: await r.text() }; };
    let r = await page({ cookie: `rap_csig=${signUser(sys, 'bob')}` });
    assert.match(r.text.replace(/<[^>]+>/g, ' '), /USER=\s*BOB/);
    r = await page({ 'user-agent': 'Mozilla/5.0', 'sec-fetch-mode': 'navigate' });
    assert.equal(r.status, 401, 'a browser without the studio logon');
    r = await page({ 'user-agent': 'Mozilla/5.0', cookie: `rap_csig=BOB.${'0'.repeat(64)}` });
    assert.equal(r.status, 401, 'a forged signature');
    r = await page({ cookie: 'rap_user=MALLORY' });
    assert.doesNotMatch(r.text, /MALLORY/, 'with users the plain user cookie means nothing');
  } finally { w.close(); fs.rmSync(sys, { recursive: true, force: true }); }
});

test('the studio\'s logon hands the signed user cookie to the browser', async () => {
  const sys = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-sec-sig-'));
  authStoreFor(sys).setUser('carl', { password: 'pw-carl-1', admin: true });
  const s = new Studio(sys, { port: 0 });
  const srv = s.listen();
  await new Promise(r => srv.once('listening', r));
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/studio/api/apps`, { headers: { authorization: 'Basic ' + Buffer.from('carl:pw-carl-1').toString('base64') } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('set-cookie') || '', /rap_csig=CARL\.[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax/);
    assert.equal(fs.statSync(path.join(sys, '.rap-secret')).mode & 0o777, 0o600);
  } finally { s.close(); fs.rmSync(sys, { recursive: true, force: true }); }
});

test('a logged-on user who is no administrator gets the list of apps and a logoff, not raw JSON', async () => {
  const sys = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-sec-enduser-'));
  fs.cpSync(new URL('../apps/travel', import.meta.url).pathname, path.join(sys, 'travel'), { recursive: true, filter: s => !s.includes(`${path.sep}.rap`) });
  authStoreFor(sys).setUser('dora', { password: 'pw-dora-1' });
  const s = new Studio(sys, { port: 0 });
  const srv = s.listen();
  await new Promise(r => srv.once('listening', r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  const dora = { authorization: 'Basic ' + Buffer.from('dora:pw-dora-1').toString('base64') };
  try {
    const page = await fetch(`${b}/`, { headers: { ...dora, accept: 'text/html' } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /href="\/a\/travel\/"/);
    assert.match(html, /Travel Management/);
    assert.match(html, /href="\/logout"/);
    assert.equal((await fetch(`${b}/studio/api/apps`, { headers: dora })).status, 403, 'the studio API stays closed');
  } finally { s.close(); fs.rmSync(sys, { recursive: true, force: true }); }
});
