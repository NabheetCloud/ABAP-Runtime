// Valid ABAP that RAP Studio rejected, reported by a tester who ran pipeline-generated RAP packages against a BTP
// ABAP trial: ADD/SUBTRACT, a component named "reference" in WHERE, CAST ...->m( ) as a statement, DCL
// "default false", the maximum of a P(31,6), '00000000' IS INITIAL, itab[] of a range, assert_differs on references.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Workspace } from '../src/server/server.js';
import { parseDcl, grantsSql } from '../src/ddl/dcl.js';

const DIR = new URL('./fixtures/feedback', import.meta.url).pathname;
const ws = new Workspace(DIR, { dbFile: ':memory:', systemDir: false });
const run = m => ws.app.rt.cls('zcl_fb')[m]({}).rv;

test('feedback fixture activates without errors (ADD, CAST statement, WHERE reference, DCL default false)', () => assert.deepEqual(ws.app.diagnostics.errors, []));
test('ADD ... TO / SUBTRACT ... FROM', () => assert.equal(run('add_subtract'), '6/7.25'));
test('a component named reference in LOOP WHERE, SELECT WHERE and READ TABLE WITH KEY', () => assert.equal(run('where_reference'), '2/1/1'));
test('CAST zif( NEW zcl( ) )->m( ) as a statement', () => assert.equal(run('cast_statement'), '2'));
test('the largest values of a P(31,6) are no overflow', () => assert.doesNotThrow(() => run('p_max')));
test("'00000000' IS INITIAL for d and n", () => assert.equal(run('zero_date'), 'XXX'));
test('range[] is the table, not a row: lines, LOOP AT, IN, IS INITIAL', () => assert.equal(run('range_body'), '2/6/in/full'));

test('DCL inheriting conditions ... default false: no access when the inherited entity has no access control', () => {
  const [role] = parseDcl('define role R { grant select on ZC_X where inheriting conditions from entity ZI_X default false; }', 'r.dcls');
  assert.equal(role.grants[0].where.default, false);
  const opts = { auths: {}, user: 'U', col: c => c, inherited: () => [] };
  assert.match(grantsSql(role.grants, opts), /^\(?1=0\)?$/);
  const [open] = parseDcl('define role R { grant select on ZC_X where inheriting conditions from entity ZI_X default true; }', 'r.dcls');
  const all = grantsSql(open.grants, opts);   // null: no restriction
  assert.ok(all === null || /^\(?1=1\)?$/.test(all), all);
});

test('assert_differs compares references by identity (rap test)', () => {
  const out = execFileSync(process.execPath, [new URL('../bin/rap.js', import.meta.url).pathname, 'test', DIR], { encoding: 'utf8' });
  assert.match(out, /2 passed, 0 failed/);
});

// ---- follow-ups: SORT BY VALUE (cheat sheets), exact packed numbers (#10), rap check warnings (#14)
test('SORT itab BY VALUE abap_sortorder_tab( ... ) and BY VALUE ...( FOR ... )', () => assert.equal(run('sort_by_value'), '321/abc'));

test('packed numbers beyond 15 digits are exact: P(31,6) display, arithmetic, comparison, CONV string (#10)', () => {
  assert.equal(run('p_exact'), '9999999999999999999999999.999999/-1234567890123456789012345.123455/9999999999999999999999999.999998/lt/0/9999999999999999999999999.999999');
});

test('rap check warns about what would not activate on SAP: unknown customer types, non-released tables, COMMIT WORK in RAP (#14)', () => {
  let out = '';
  try { out = execFileSync(process.execPath, [new URL('../bin/rap.js', import.meta.url).pathname, 'check', new URL('./fixtures/sapcheck', import.meta.url).pathname], { encoding: 'utf8' }); }
  catch (e) { out = e.stdout; }
  assert.match(out, /WARNING\s+src\/zcl_sapchk\.clas\.abap:8\s+.*ZUNKNOWN_TYPE/i);
  assert.match(out, /WARNING\s+src\/zcl_sapchk\.clas\.abap:11\s+.*MARA.*not released/i);
  assert.match(out, /WARNING\s+src\/zbp_r_sale\.clas\.locals_imp\.abap:9\s+.*COMMIT WORK/i);
  assert.doesNotMatch(out, /zcl_sapchk\.clas\.abap:12\s+.*COMMIT WORK/i, 'COMMIT WORK outside a behavior implementation is allowed');
  assert.doesNotMatch(out, /ABAP_BOOL|STRING_TABLE/i, 'SAP types are not flagged');
  assert.match(out, / 3 warning\(s\)/);
  // embedded PostgreSQL keeps every app in a database of its own: the standard layer's MARA is an error there
  if (!String(process.env.RAP_DB || '').startsWith('pglite')) assert.match(out, / 0 error\(s\), 3 warning\(s\)/);
});

test('exact packed numbers: *, /, overflow of a result, mixing with small numbers, database parameter (#10)', async () => {
  const { Dec } = await import('../src/abap/runtime.js');
  const rt = ws.app.rt, P31 = { k: 'p', len: 16, dec: 6 };
  const big = rt.cv(P31, '1234567890123456789.123456');
  assert.ok(big instanceof Dec);
  assert.equal(rt.s(rt.cv(P31, rt.arith('*', big, 2))), '2469135780246913578.246912');
  assert.equal(rt.s(rt.cv(P31, rt.arith('/', big, 3))), '411522630041152263.041152');
  assert.throws(() => rt.cv(P31, rt.arith('*', rt.cv(P31, '9999999999999999999999999.999999'), 10), 1), e => /OVERFLOW/i.test(e.constructor?.name || '') || /Overflow/.test(e.text || e.message || ''));
  assert.equal(rt.cv(P31, rt.arith('-', big, big)), 0, 'a small result is a plain number again');
  assert.equal(rt.cmp(big, 5), 1);
  assert.equal(rt.cv({ k: 'p', len: 8, dec: 2 }, '12.345'), 12.35, 'small packed values stay numbers');
  const db = ws.app.db;
  db.exec('CREATE TABLE IF NOT EXISTS zdec_t (v TEXT)');
  db.prepare('INSERT INTO zdec_t (v) VALUES (?)').run(rt.cv(P31, '9999999999999999999999999.999999'));
  assert.equal(db.prepare('SELECT v FROM zdec_t').get().v, '9999999999999999999999999.999999');
});
