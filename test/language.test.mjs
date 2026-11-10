// ABAP statements beyond the basics: SHIFT, resumable exceptions, CLEANUP, CONVERT, FIND IN TABLE,
// CALL TRANSFORMATION id, /UI2/CL_JSON, RTTS, CORRESPONDING ... FROM ... USING.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/server/server.js';

const ws = new Workspace(new URL('./fixtures/language', import.meta.url).pathname, { dbFile: ':memory:', systemDir: false });
const run = m => ws.app.rt.cls('zcl_lang')[m]({}).rv;

test('language fixture activates', () => assert.deepEqual(ws.app.diagnostics.errors, []));
test('SHIFT', () => assert.equal(run('shifts'), 'cdef/efabcd/123'));
test('RAISE RESUMABLE / CATCH BEFORE UNWIND / RESUME', () => assert.equal(run('resume'), '25;resumable=X;-1;20;'));
test('CLEANUP runs when the exception leaves the TRY', () => assert.equal(run('cleanup'), 'cleanup;caught'));
test('CONVERT TIME STAMP / DATE with time zones', () => assert.equal(run('convert'), '20240703 140000 20240101043000'));
test('FIND IN TABLE', () => assert.equal(run('find_table'), '3:2'));
test('CALL TRANSFORMATION id (asXML round trip)', () => assert.equal(run('xml_roundtrip'), '7-Seven'));
test('/UI2/CL_JSON serialize', () => assert.equal(run('json'), '[{"id":1,"name":"a"},{"id":2,"name":"b"}]'));
test('RTTS describe_by_data', () => assert.equal(run('rtts'), 'ID:I;NAME:g;I'));
test('CORRESPONDING ... FROM ... USING', () => assert.equal(run('lookup'), '/two'));

test('CDS hierarchy: levels, ranks (siblings ordered by name), tree sizes, parents', () => {
  const r = ws.odata.handle('GET', '/odata/zui_lang/EmployeeTree?$orderby=HierarchyRank');
  assert.deepEqual(r.body.value.map(e => [e.Name, e.HierarchyLevel, e.TreeSize, e.ParentId]),
    [['Ada', 1, 4, ''], ['Ann', 2, 2, 'E1'], ['Cy', 3, 1, 'E3'], ['Ben', 2, 1, 'E1']]);
});
test('FOR GROUPS ... GROUP BY with GROUP SIZE, FOR ... IN GROUP', () => assert.equal(run('groups'), 'a:1:2,b:2:4'));
test('ABAP SQL: path expressions and common table expressions', () => assert.equal(run('sql_paths'), 'Ada/2/2/2'));
test('data references point at their data object', () => assert.equal(run('refs'), '5/10,20/via ref/8'));
test('CALL TRANSFORMATION with an XSLT program and a simple transformation (both directions)', () => {
  const [html, xml, back] = run('trafos').split('#');
  assert.equal(html, '<ul><li id="r1">Alpha</li><li id="r2">Beta (last)</li></ul>');
  assert.equal(xml, '<?xml version="1.0" encoding="utf-8"?><Rows><Row id="2"><Name>Beta</Name></Row><Row id="1"><Name>Alpha</Name></Row></Rows>');
  assert.equal(back, '2:Alpha');
});
test('tree table requests: TopLevels, ExpandLevels, descendants, ancestors', () => {
  const H = "com.sap.vocabularies.Hierarchy.v1.TopLevels(HierarchyNodes=$root/Employee,HierarchyQualifier='ZI_EmployeeHier',NodeProperty='EmpId'";
  const get = apply => ws.odata.handle('GET', `/odata/zui_lang/Employee?$apply=${encodeURIComponent(apply)}&$count=true`).body;
  const row = r => [r.Name, r.DistanceFromRoot, r.DrillState, r.LimitedDescendantCount];
  assert.deepEqual(get(`${H},Levels=1)`).value.map(row), [['Ada', 0, 'collapsed', 0]]);
  assert.deepEqual(get(`${H},Levels=2)`).value.map(row), [['Ada', 0, 'expanded', 2], ['Ann', 1, 'collapsed', 0], ['Ben', 1, 'leaf', 0]]);
  assert.deepEqual(get(`${H},Levels=1,ExpandLevels=[{"NodeID":"E1","Levels":1},{"NodeID":"E3","Levels":1}])`).value.map(r => r.Name), ['Ada', 'Ann', 'Cy', 'Ben']);
  assert.deepEqual(get("descendants($root/Employee,ZI_EmployeeHier,EmpId,filter(EmpId eq 'E1'),1)").value.map(row), [['Ann', 1, 'collapsed', 0], ['Ben', 1, 'leaf', 0]]);
  assert.deepEqual(get(`ancestors($root/Employee,ZI_EmployeeHier,EmpId,filter(Name eq 'Cy'),keep start)/${H},Levels=9)`).value.map(r => r.Name), ['Ada', 'Ann', 'Cy']);
  const md = ws.odata.handle('GET', '/odata/zui_lang/$metadata').body;
  assert.match(md, /Aggregation.RecursiveHierarchy" Qualifier="ZI_EmployeeHier"[\s\S]*ParentNavigationProperty" NavigationPropertyPath="_Manager"/);
});
