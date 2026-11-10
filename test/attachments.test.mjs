// Attachments: @Semantics.largeObject elements as OData Edm.Stream properties (upload, download, delete).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/server/server.js';

const ws = new Workspace(new URL('./fixtures/docs', import.meta.url).pathname, { ...(process.env.RAP_DB ? { dbUrl: process.env.RAP_DB } : { dbFile: ':memory:' }), systemDir: false });
const call = (m, u, b, h = {}) => { try { return ws.odata.handle(m, u, b, h); } catch (e) { return { status: e.status || 500, body: { error: e.message } }; } };
const S = '/odata/zui_doc';

test('docs fixture activates', () => assert.deepEqual(ws.app.diagnostics.errors, []));

test('upload, read link, download, reject, delete', () => {
  assert.equal(call('POST', `${S}/Doc`, { DocId: 'D1', Title: 'Spec' }).status, 201);
  const up = call('PUT', `${S}/Doc('D1')/Attachment`, Buffer.from('hello attachment'), { 'content-type': 'text/plain', slug: 'hello.txt' });
  assert.equal(up.status, 204, JSON.stringify(up.body));
  const d = call('GET', `${S}/Doc('D1')`).body;
  assert.equal(d['Attachment@odata.mediaReadLink'], "Doc(DocId='D1')/Attachment");
  assert.equal(d['Attachment@odata.mediaContentType'], 'text/plain');
  assert.equal(d.FileName, 'hello.txt');
  assert.equal(d.Attachment, undefined);
  const dl = call('GET', `${S}/Doc('D1')/Attachment`);
  assert.equal(dl.body.toString(), 'hello attachment');
  assert.match(dl.headers['Content-Disposition'], /attachment; filename="hello.txt"/);
  assert.equal(call('PUT', `${S}/Doc('D1')/Attachment`, Buffer.from('x'), { 'content-type': 'image/png' }).status, 415);
  const md = call('GET', `${S}/$metadata`).body;
  assert.match(md, /Name="Attachment" Type="Edm.Stream"/);
  assert.match(md, /Core.MediaType" Path="MimeType"/);
  assert.equal(call('DELETE', `${S}/Doc('D1')/Attachment`).status, 204);
  assert.equal(call('GET', `${S}/Doc('D1')/Attachment`).status, 204);
});

test('a single property: Set(key)/Property and /$value (Fiori elements breadcrumbs); ABAP xstring content downloads as bytes', () => {
  const p = call('GET', `${S}/Doc('D1')/Title`);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(p.body.value, 'SPEC');
  assert.match(p.body['@odata.context'], /Doc\(DocId='D1'\)\/Title$/);
  assert.equal(call('GET', `${S}/Doc('D1')/Title/$value`).body, 'SPEC');
  assert.equal(call('GET', `${S}/Doc('D1')/NoSuchField`).status, 404);
  // content written by ABAP (an xstring is upper-case hex in the table) comes back as the bytes
  ws.app.db.prepare("UPDATE zdoc_a SET attachment = ?, mime_type = 'text/plain' WHERE doc_id = 'D1'").run(Buffer.from('from ABAP').toString('hex').toUpperCase());
  assert.equal(call('GET', `${S}/Doc('D1')/Attachment`).body.toString(), 'from ABAP');
  // a media read link resolved against a navigation path (UI5): Parent(…)/Set(key)/Stream
  assert.equal(call('GET', `${S}/Doc('D1')/Doc(DocId='D1')/Attachment`).body.toString(), 'from ABAP');
});

test('an upload through OData is stored like an ABAP xstring: ABAP reads the same bytes', () => {
  assert.equal(call('POST', `${S}/Doc`, { DocId: 'D2', Title: 'Binary' }).status, 201);
  const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x10, 0x80, 0x0a, 0x41]);
  assert.equal(call('PUT', `${S}/Doc('D2')/Attachment`, bytes, { 'content-type': 'text/plain', slug: 'bin.txt' }).status, 204);
  const raw = ws.app.db.prepare("SELECT attachment FROM zdoc_a WHERE doc_id = 'D2'").get().attachment;
  assert.equal(String(raw), bytes.toString('hex').toUpperCase());
  const r = ws.runClass('zcl_doc_attachment');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.output.trim(), `${bytes.length}:${bytes.toString('hex').toUpperCase()}:text/plain`);
  assert.deepEqual(call('GET', `${S}/Doc('D2')/Attachment`).body, bytes);
  // a row uploaded before (base64) still downloads
  ws.app.db.prepare("UPDATE zdoc_a SET attachment = ? WHERE doc_id = 'D2'").run(Buffer.from('old upload').toString('base64'));
  assert.equal(call('GET', `${S}/Doc('D2')/Attachment`).body.toString(), 'old upload');
  assert.equal(call('DELETE', `${S}/Doc('D2')`).status, 204);
});

test('change documents record field changes; a behavior extension adds a determination', () => {
  assert.equal(call('PATCH', `${S}/Doc('D1')`, { Title: 'final spec' }).status, 200);
  assert.equal(call('GET', `${S}/Doc('D1')`).body.Title, 'FINAL SPEC');                 // determination from the extension
  const ch = ws.odata.rap.changes({ entity: 'zr_doc', objectId: 'D1' });
  const title = ch.filter(c => c.field === 'title');
  assert.deepEqual(title.map(c => [c.change_ind, c.value_old, c.value_new]).reverse(), [['I', '', 'SPEC'], ['U', 'SPEC', 'FINAL SPEC']]);
  assert.equal(title[0].object_class, 'ZDOC');
});

test('collaborative draft: two users edit the same draft', () => {
  const cw = new Workspace(new URL('./fixtures/collab', import.meta.url).pathname, { ...(process.env.RAP_DB ? { dbUrl: process.env.RAP_DB } : { dbFile: ':memory:' }), systemDir: false });
  const as = (u, m, url, b) => { try { return cw.odata.handle(m, url, b, { 'x-rap-user': u }); } catch (e) { return { status: e.status || 500, body: { error: e.message } }; } };
  const N = '/odata/zui_note';
  assert.deepEqual(cw.app.diagnostics.errors, []);
  assert.equal(as('ALICE', 'POST', `${N}/Note`, { NoteId: 'N1', Text: 'first' }).status, 201);
  assert.equal(as('ALICE', 'POST', `${N}/Note(NoteId='N1',IsActiveEntity=false)/Activate`, {}).status, 200);
  assert.equal(as('ALICE', 'POST', `${N}/Note(NoteId='N1',IsActiveEntity=true)/Edit`, { PreserveChanges: true }).status, 200);
  assert.equal(as('BOB', 'POST', `${N}/Note(NoteId='N1',IsActiveEntity=true)/Edit`, { PreserveChanges: true }).status, 200);    // joins instead of 409
  assert.equal(as('BOB', 'PATCH', `${N}/Note(NoteId='N1',IsActiveEntity=false)`, { Text: 'edited by Bob' }).status, 200);
  assert.equal(as('ALICE', 'GET', `${N}/Note(NoteId='N1',IsActiveEntity=false)`).body.Text, 'edited by Bob');
  assert.equal(as('ALICE', 'POST', `${N}/Note(NoteId='N1',IsActiveEntity=false)/Activate`, {}).status, 200);
  assert.equal(as('BOB', 'GET', `${N}/Note(NoteId='N1',IsActiveEntity=true)`).body.Text, 'edited by Bob');
  cw.close();
});
