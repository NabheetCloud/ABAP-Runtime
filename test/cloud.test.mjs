// Released ABAP Cloud APIs on the runtime: hashing and encodings, code pages, number ranges, application logs,
// the HTTP client (against a small server in another process) and e-mail into the outbox.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Workspace } from '../src/server/server.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-cloud-'));
fs.cpSync(new URL('./fixtures/cloud', import.meta.url).pathname, dir, { recursive: true });
const ws = new Workspace(dir, { dbFile: ':memory:', systemDir: false, lint: false });
const run = m => ws.app.rt.cls('zcl_cloud_apis')[m]({}).rv;
// the HTTP call blocks this process while it waits, so the server runs in its own process (it prints its port)
const server = spawn(process.execPath, ['-e', "require('http').createServer((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => { r.setHeader('x-echo', q.headers['x-test'] || ''); r.end(q.method + ' ' + q.url + ' ' + b); }); }).listen(0, '127.0.0.1', function () { console.log(this.address().port); })"]);
const port = new Promise(res => server.stdout.once('data', d => res(Number(String(d).trim()))));
after(() => { server.kill(); ws.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('cloud fixture activates', () => assert.deepEqual(ws.app.diagnostics.errors, []));
test('hashing, HMAC, base64, code pages, URL escaping', () => assert.equal(run('encodings'), 'BA7816BF8F01CFEA/4FD0B215/SMOp/Hé/48C3A9/Hé/a%20b%26c'));
test('number ranges: default interval, maintained interval, quantity, exhausted', () => assert.equal(run('numbers'), '00000001/00000002/5000/exhausted'));
test('application logs: saved to the Logs tables, loaded again', () => assert.equal(run('logs'), '2/Order failed/1/1/ZAPP'));
test('e-mail goes into the outbox (table and .eml file)', () => {
  assert.equal(run('mail'), 'Order 4711/a@example.com/1');
  const eml = fs.readdirSync(path.join(dir, '.rap', 'outbox'));
  assert.equal(eml.length, 1);
  assert.match(fs.readFileSync(path.join(dir, '.rap', 'outbox', eml[0]), 'utf8'), /Subject: Order 4711[\s\S]*filename="hello.txt"/);
});
test('HTTP client: request path, query, header and body; destinations by name', { timeout: 30000 }, async () => {
  ws.app.rt.cls('zcl_cloud_apis').url = `http://127.0.0.1:${await port}`;
  assert.equal(run('http'), '200/POST /echo?x=1 {"a":1}/abap/no destination');
});
test('background processing (bgPF): the operation runs after COMMIT WORK', () => assert.equal(run('background'), '0/1/SUCCESSFUL'));
test('application jobs: a template from the catalog, scheduled, run with its parameters and log; a failing job aborts', () => {
  const C = ws.app.rt.cls('zcl_cloud_apis');
  const [name, count] = C.schedule({ text: 'Orders 1-10' }).rv.split(':');
  assert.equal(name, 'IMPORT ORDERS');
  assert.equal(C.job_status({ jobname: name, jobcount: count }).rv, 'S Scheduled');
  assert.equal(ws.runDueJobs(), 1);
  assert.equal(C.job_status({ jobname: name, jobcount: count }).rv, 'F Finished');
  const job = ws.app.db.prepare('SELECT * FROM rap_apj_job WHERE jobcount = ?').get(count);
  assert.ok(job.log_handle);
  assert.equal(ws.app.db.prepare('SELECT message FROM zrap_balmsg WHERE log_handle = ?').get(job.log_handle).message, 'Imported Orders 1-10');
  assert.equal(ws.app.db.prepare("SELECT text FROM zcloud_run WHERE source = 'JOB'").get().text, 'Orders 1-10');
  const [n2, c2] = C.schedule({ text: 'FAIL' }).rv.split(':');
  ws.runDueJobs();
  assert.equal(C.job_status({ jobname: n2, jobcount: c2 }).rv, 'A Aborted');
  assert.ok(ws.summary().systemTables.includes('rap_apj_job'));
});
