// RAP debugging: while breakpoints are set, the debugger's worker serves the app's OData requests, so an action
// clicked in the app stops in its behavior handler (variables, call stack); continue answers the request.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Workspace, routeWorkspace } from '../src/server/server.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rap-dbg-'));
fs.cpSync(new URL('../examples/travel', import.meta.url).pathname, dir, { recursive: true, filter: f => !f.includes(`${path.sep}.rap`) });
const ws = new Workspace(dir, { systemDir: false, lint: false });
after(() => { ws.debugStop(); ws.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const FILE = 'src/zbp_r_travel.clas.locals_imp.abap';
const LINE = fs.readFileSync(path.join(dir, FILE), 'utf8').split('\n').findIndex((l, i, a) => /READ ENTITIES OF zr_travel IN LOCAL MODE/.test(l) && a.slice(0, i).some(x => /METHOD acceptTravel\./.test(x))) + 1;

// an HTTP request through the app's routes; resolves with the response
function request(method, url, body) {
  return new Promise(resolve => {
    const res = { status: 0, headers: {}, writeHead(s, h) { this.status = s; Object.assign(this.headers, h || {}); }, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.status, body: String(b ?? '') }); }, write() {} };
    routeWorkspace(ws, { method, url, headers: { 'content-type': 'application/json' } }, res, body ? JSON.stringify(body) : '', url.split('?')[0], '');
  });
}
const until = async (want, ms = 20000) => {
  for (const t0 = Date.now(); Date.now() - t0 < ms;) { const s = ws.debugState(); if (want.includes(s.status)) return s; await new Promise(r => setTimeout(r, 30)); }
  return ws.debugState();
};

test('RAP debugging: an action of the app stops in the behavior handler; continue answers the request', { timeout: 60000 }, async () => {
  const list = JSON.parse((await request('GET', '/odata/zui_travel/Travel?$top=20&$filter=IsActiveEntity eq true')).body).value;
  const travel = list.find(t => t.OverallStatus !== 'A');
  assert.ok(travel, 'a travel that is not accepted yet');
  ws.debugStart({ kind: 'rap', name: 'app', breakpoints: [`${FILE}:${LINE}`] });
  assert.equal((await until(['armed'])).status, 'armed');
  // reads go through the debugger's worker too and answer without stopping
  const read = await request('GET', '/odata/zui_travel/Travel?$top=1');
  assert.equal(read.status, 200, read.body);
  const answer = request('POST', `/odata/zui_travel/Travel(TravelUUID=${travel.TravelUUID},IsActiveEntity=true)/com.sap.gateway.srvd.zui_travel.v0001.acceptTravel`, {});
  let s = await until(['paused']);
  assert.equal(s.status, 'paused');
  assert.equal(s.kind, 'rap');
  assert.deepEqual([s.paused.file, s.paused.line], [FILE, LINE]);
  assert.match(s.paused.stack[0], /ACCEPTTRAVEL/i);
  assert.equal(s.paused.vars.keys.t, 'table');
  assert.equal(s.paused.vars.keys.lines, 1);
  ws.debugCommand('over');
  s = await until(['paused']);
  assert.ok(s.paused.line > LINE);
  assert.equal(s.paused.vars.travels.t, 'table');
  ws.debugCommand('continue');
  const r = await answer;
  assert.equal(r.status, 200, r.body);
  assert.equal(JSON.parse(r.body).OverallStatus, 'A');
  assert.equal((await until(['armed'])).status, 'armed');
  // stop: the app is served by the studio again
  ws.debugCommand('stop');
  assert.equal((await until(['done'])).status, 'done');
  assert.equal(ws.rapDebugging, false);
  assert.equal((await request('GET', '/odata/zui_travel/Travel?$top=1')).status, 200);
});

test('a new debug session is not ended by the previous one (RAP session armed, then a console class)', { timeout: 60000 }, async () => {
  const CLS = 'src/zcl_travel_console.clas.abap';
  const lines = fs.readFileSync(path.join(dir, CLS), 'utf8').split('\n');
  const first = lines.findIndex(l => /out->write/.test(l)) + 1;
  ws.debugStart({ kind: 'rap', name: 'app', breakpoints: [`${FILE}:${LINE}`] });
  await until(['armed']);
  ws.debugStart({ kind: 'class', name: 'zcl_travel_console', breakpoints: [`${CLS}:${first}`] });
  let s = await until(['paused', 'done']);
  assert.deepEqual([s.status, s.paused?.line], ['paused', first]);
  await new Promise(r => setTimeout(r, 2600));   // past the previous session's stop timer
  ws.debugCommand('over');
  s = await until(['paused', 'done']);
  assert.equal(s.status, 'paused', JSON.stringify(s.result));
  assert.ok(s.paused.line > first);
  ws.debugCommand('stop');
  await until(['done']);
});
