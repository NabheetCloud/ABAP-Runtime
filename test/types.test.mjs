// ABAP's types at runtime: values are plain JS values, the compiler converts into each declared type (fixed-length
// c / n / x, p with length and decimals, i range), applies the calculation type of arithmetic and tells RTTS the
// declared type. Plus enumerations, sy-index in loops, STEP in FOR, CL_ABAP_BIGINT / CL_ABAP_RATIONAL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/server/server.js';

const ws = new Workspace(new URL('./fixtures/types', import.meta.url).pathname, { dbFile: ':memory:', systemDir: false, lint: false });
const run = m => ws.app.rt.cls('zcl_types')[m]({}).rv;

test('types fixture activates', () => assert.deepEqual(ws.app.diagnostics.errors, []));
test('fixed-length c, n, x, also in structure components; a number into c is right-aligned', () => assert.equal(run('fixed_length'), 'ABC/00042/FF00/WXY/00012/  42/2'));
test('f is binary, decfloat decimal; p rounds; integer calculation rounds every step', () => assert.equal(run('numbers'), 'X/-1.01/1/0/2'));
test('overflow and conversion errors raise the CX_SY exceptions of ABAP', () => assert.equal(run('overflow'), 'arith/conv/zerodivide/notation'));
test('calculation type of inline declarations, RTTS of declared types', () => assert.equal(run('calc_types'), 'FeaP8I/16'));
test('sy-index in WHILE and after nested DO, FOR ... STEP -1', () => assert.equal(run('loops'), '123-1-2/cba'));
test('enumerated types', () => assert.equal(run('enums'), 'RED/BLUE/X'));
test('CL_ABAP_BIGINT and CL_ABAP_RATIONAL', () => assert.equal(run('big'), '370370367037037036703703703670/1/3'));
test('ABAP memory, data buffers, SAP memory (SET/GET PARAMETER), dynamic ASSIGN', () => assert.equal(run('memory'), 'hello-42-0/4/hello/1010/42/0/4'));
test('classic exceptions of methods: RAISE and EXCEPTIONS ... = n', () => assert.equal(run('exceptions'), '4/0'));
test('function modules from classes: CALL FUNCTION, TABLES, EXCEPTIONS, FORM/PERFORM, global data, update task at COMMIT WORK', () => assert.equal(run('functions'), '8/3+5/7/1/2'));
test('datasets: OPEN / TRANSFER / READ / CLOSE / DELETE DATASET in the app folder', () => assert.equal(run('files'), 'ab'));
