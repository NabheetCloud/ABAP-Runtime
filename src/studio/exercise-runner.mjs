// Runs the ABAP Unit tests of one exercise folder and prints the result as JSON (used by exercises.js in a child
// process with a time limit).   node src/studio/exercise-runner.mjs <exercise dir>
import { Workspace } from '../server/server.js';

const ws = new Workspace(process.argv[2], { lint: true, dbUrl: 'sqlite:memory', systemDir: false });
const errors = ws.app.diagnostics.errors.map(e => ({ file: e.file, line: e.line, message: e.message }));
// abaplint's syntax check (unknown variables, wrong types …): shown like activation errors, the tests still run
const syntax = ws.app.diagnostics.warnings.filter(w => /^\[abaplint check_syntax\]/.test(w.message)).map(e => ({ file: e.file, line: e.line, message: e.message.replace(/^\[abaplint check_syntax\] /, '').replace(/, findTop$/, '') }));
const r = errors.length ? { results: [], ms: 0 } : ws.runTests('');
process.stdout.write('\n@@RESULT@@' + JSON.stringify({ errors, syntax, ms: r.ms, results: r.results.map(t => ({ test: t.method, cls: t.cls, status: t.status, message: t.message })) }));
ws.close();
process.exit(0);
