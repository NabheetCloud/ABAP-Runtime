// Runs a report or a transaction of an app on its classic engine for code that runs on the ABAP runtime
// (SUBMIT ... AND RETURN, CALL TRANSACTION ... USING bdc_tab from classes). Called synchronously as a child process
// with a JSON request on stdin; prints the result as JSON. Uses the studio's running engine (url) or starts one.
//   { appDir, dbFile, url, kind: 'program' | 'transaction', name, values, steps }
import { ClassicEngine } from './manager.mjs';
import { runProgram, runTransaction } from './client.mjs';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const req = JSON.parse(Buffer.concat(chunks).toString('utf8'));
let engine = null, base = req.url;
try {
  if (!base) {
    engine = new ClassicEngine(req.appDir, { dbFile: req.dbFile });
    const st = await engine.ensure();
    if (st.state !== 'running') throw new Error(st.state === 'unavailable' ? 'The classic ABAP engine is not installed: npm run setup:open-abap'
      : `The classic programs do not compile: ${(st.diagnostics || []).slice(0, 3).map(d => `${d.file}:${d.line ?? ''} ${d.message}`).join('; ')}`);
    base = st.url;
  }
  base = base.replace('localhost', '127.0.0.1');
  const out = req.kind === 'program' ? await runProgram(base, req.name, req.values || {}) : await runTransaction(base, req.name, req.steps || []);
  process.stdout.write(JSON.stringify({ ok: true, result: out }));
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: e.message }));
} finally { engine?.stop(); }
process.exit(0);
