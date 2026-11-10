// Users and roles, CDS access control (DCL), AUTHORITY-CHECK, $session.user and the login gate.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace, startServer } from '../src/server/server.js';
import { authStoreFor } from '../src/server/auth.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-auth-'));
fs.cpSync(new URL('./fixtures/secured', import.meta.url).pathname, dir, { recursive: true });
const auth = authStoreFor(dir);
auth.setUser('alice', { password: 'secret-a', fullName: 'Alice Admin', admin: true });
auth.setUser('bob', { password: 'secret-b', roles: ['Z_SALES_EMEA'] });
auth.setUser('carol', { password: 'secret-c', roles: [] });
auth.grant('Z_SALES_EMEA', 'ZSALES', { ACTVT: ['03'], ZREGION: ['EMEA'] });
const ws = new Workspace(dir, { ...(process.env.RAP_DB ? { dbUrl: process.env.RAP_DB } : { dbFile: ':memory:' }), systemDir: false, lint: false });
const as = (user, m, u, b) => { try { return ws.odata.handle(m, u, b, { 'x-rap-user': user }); } catch (e) { return { status: e.status || 500, body: { error: e.message } }; } };
const S = '/odata/zui_sale';
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('secured app activates', () => assert.deepEqual(ws.app.diagnostics.errors, []));

test('access control: region authorization or own sales; administrators see everything', () => {
  const ids = u => as(u, 'GET', `${S}/Sale?$orderby=SaleId`).body.value.map(s => s.SaleId);
  assert.deepEqual(ids('ALICE'), ['S1', 'S2', 'S3', 'S4']);
  assert.deepEqual(ids('BOB'), ['S1', 'S2', 'S4']);        // EMEA by role + own S2
  assert.deepEqual(ids('CAROL'), ['S1', 'S3']);            // only own
  assert.equal(as('BOB', 'GET', `${S}/Sale('S3')`).status, 404);
  assert.equal(as('CAROL', 'GET', `${S}/Sale?$count=true&$top=0`).body['@odata.count'], 2);
});

test('$session.user in a CDS view', () => {
  assert.equal(as('CAROL', 'GET', `${S}/Sale('S1')`).body.IsMine, 'X');
  assert.equal(as('BOB', 'GET', `${S}/Sale('S1')`).body.IsMine, '');
});

test('AUTHORITY-CHECK in a global authorization handler', () => {
  assert.equal(as('BOB', 'PATCH', `${S}/Sale('S1')`, { Amount: 1 }).status, 400);      // role allows display (03) only
  assert.equal(as('ALICE', 'PATCH', `${S}/Sale('S1')`, { Amount: 150 }).status, 200);
});

test('ABAP SQL respects access control unless WITH PRIVILEGED ACCESS', () => {
  as('CAROL', 'GET', `${S}/Sale`);                          // sets the request user
  const rt = ws.app.rt;
  assert.equal(rt.cls('zcl_sale_report').visible({}).rv_count, 2);
  assert.equal(rt.cls('zcl_sale_report').all({}).rv_count, 4);
});

test('login gate: anonymous requests are refused, sessions and Basic work, users cannot impersonate', async () => {
  const server = startServer(ws, 0);
  await new Promise(r => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}${S}/Sale`)).status, 401);
    const html = await fetch(`${base}/`, { headers: { accept: 'text/html' }, redirect: 'manual' });
    assert.equal(html.status, 302);
    assert.match(html.headers.get('location'), /^\/login/);
    const bad = await fetch(`${base}/login`, { method: 'POST', body: 'user=bob&password=wrong', headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
    assert.match(bad.headers.get('location'), /failed=1/);
    const ok = await fetch(`${base}/login`, { method: 'POST', body: 'user=bob&password=secret-b&next=/', headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
    const cookie = ok.headers.get('set-cookie').split(';')[0];
    const r = await (await fetch(`${base}${S}/Sale`, { headers: { cookie, 'x-rap-user': 'ALICE' } })).json();
    assert.equal(r.value.length, 3);                        // still BOB: the header is ignored
    const basic = await fetch(`${base}${S}/Sale`, { headers: { authorization: 'Basic ' + Buffer.from('carol:secret-c').toString('base64') } });
    assert.equal((await basic.json()).value.length, 2);
    assert.equal((await fetch(`${base}/api/user`, { method: 'POST', body: '{"name":"ALICE"}', headers: { cookie } })).status, 403);
  } finally { server.close(); ws.close(); }
});
