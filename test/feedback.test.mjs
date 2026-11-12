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
