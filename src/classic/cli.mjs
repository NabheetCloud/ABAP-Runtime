// Command line for an app's classic programs (run inside the app folder, like rap odata):
//   rap programs                                      the programs and transactions
//   rap program <PROG> [NAME=value ...] [--variant V] run a report, print its list
//   rap transaction <TCODE> [FIELD=value ...] [--step <FCODE> [FIELD=value ...]] ...
//                                                     start a transaction and press function codes
//   rap jobs | rap job <number> | rap job cancel <number> | rap job delete <number>
//   rap job schedule <PROG> [NAME=value ...] [--name JOB] [--variant V] [--at 2026-11-05T22:00:00Z] [--every MIN] [--no-wait]
//   rap logs | rap log <handle>                       application logs
//   rap table [<name> [FIELD=value ...] [--top N]]    tables of the app (values may contain *)
//   rap functions | rap fm <FUNCTION> [PARAM=value ...]  function modules: interfaces, test run (like SE37)
//                                                     (structures and tables as JSON: ET_ROWS='[{"FIELD": "x"}]')
// The programs run on the studio's engine for this app (built first when the sources changed); without a
// running studio the engine is started for this folder and stopped afterwards.
import fs from 'node:fs';
import path from 'node:path';
import { runProgram, runTransaction } from './client.mjs';
import { stamp } from './system.mjs';

const argv = process.argv.slice(2);
const has = name => argv.includes(name);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const pairs = list => Object.fromEntries(list.filter(a => /^[^-][^=]*=/.test(a)).map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const positional = () => { const out = []; for (let i = 1; i < argv.length; i++) { if (argv[i].startsWith('--')) { if (!['--print', '--no-wait'].includes(argv[i])) i++; continue; } if (!argv[i].includes('=')) out.push(argv[i]); } return out; };
const when = ms => ms ? new Date(Number(ms)).toISOString().replace('T', ' ').slice(0, 19) : '';
const STATUS = { P: 'scheduled', S: 'released', R: 'active', F: 'finished', A: 'cancelled' };

// the app's classic engine: the studio's, or one started for the folder (stop( ) ends it)
export async function engine(dir = process.cwd(), { soft = false } = {}) {
  const app = process.env.RAP_APP || path.basename(dir);
  const port = Number(process.env.RAP_PORT || opt('--port', 4004));
  try {
    const r = await fetch(`http://localhost:${port}/a/${encodeURIComponent(app)}/api/classic`, { method: 'POST' });
    const st = await r.json();
    if (!r.ok) fail(st.error?.message || `HTTP ${r.status}`);
    return ready(st, () => {}, soft);
  } catch (e) {
    if (!/fetch failed|ECONNREFUSED/i.test(String(e?.cause?.code || e?.message))) throw e;
    const { Workspace } = await import('../server/server.js');
    const ws = new Workspace(dir, { lint: false });
    return ready(await ws.classic.ensure(), () => ws.close(), soft);
  }
}
function ready(st, stop, soft) {
  if (st.state !== 'running' && soft) { stop(); return { error: st.state, diagnostics: st.diagnostics || [], stop: () => {} }; }
  if (st.state !== 'running') {
    console.log(st.state === 'unavailable' ? 'The classic ABAP engine is not installed: npm run setup:open-abap' : 'The classic programs do not compile:');
    for (const d of st.diagnostics || []) console.log(`  ERROR   ${d.file}${d.line ? ':' + d.line : ''}  ${d.message}`);
    stop(); process.exit(1);
  }
  return { base: st.url.replace('localhost', '127.0.0.1'), stop };
}
function fail(m) { console.log(m); process.exit(1); }
const api = async (e, p, init) => { const r = await fetch(e.base + p.replace(/^\//, ''), init); const j = await r.json().catch(() => null); if (!r.ok) fail(j?.error || `HTTP ${r.status}`); return j; };
const screenText = s => Object.entries(s || {}).map(([k, v]) => `  ${k.padEnd(24)} ${v}`).join('\n');

export async function classicCli(cmd) {
  const e = await engine();
  let ok = true;
  try {
    const [a1, a2] = positional();
    if (cmd === 'programs') {
      const m = await api(e, '/__rap/api/programs');
      if (!m.programs.length) console.log('No programs yet.');
      for (const p of m.programs) console.log(`${p.name.padEnd(30)} ${p.type === 'M' ? 'module pool' : 'report'.padEnd(11)} ${p.tcode ? `tcode ${p.tcode.padEnd(8)}` : ''.padEnd(14)} ${p.title}`);
    } else if (cmd === 'program') {
      if (!a1) fail('usage: rap program <PROG> [NAME=value ...] [--variant V]');
      const r = await runProgram(e.base, a1, pairs(argv.slice(1)), { extra: {} });
      ok = r.ok;
      console.log(`${r.ok ? '' : 'FAILED '}${a1.toUpperCase()}${r.title ? ` - ${r.title}` : ''}`);
      if (r.message) console.log(`Message: ${r.message}`);
      if (r.screen) console.log(`Still on the selection screen:\n${screenText(r.screen)}`);
      if (r.list) console.log(r.list.length > 8000 ? r.list.slice(0, 8000) + '\n… (truncated)' : r.list);
    } else if (cmd === 'transaction') {
      if (!a1) fail('usage: rap transaction <TCODE> [FIELD=value ...] [--step <FCODE> [FIELD=value ...]] ...');
      // fields before the first --step go with it; without --step they are entered with ENTER
      const steps = [];
      let cur = { command: null, fields: {} };
      for (let i = 1; i < argv.length; i++) {
        if (argv[i] === '--step') {
          if (cur.command) { steps.push(cur); cur = { command: argv[++i], fields: {} }; } else cur.command = argv[++i];   // fields typed before the first function code go with it
          continue;
        }
        if (argv[i].startsWith('--')) { i++; continue; }
        const k = argv[i].indexOf('=');
        if (k > 0) cur.fields[argv[i].slice(0, k)] = argv[i].slice(k + 1);
      }
      if (cur.command || Object.keys(cur.fields).length) steps.push({ command: cur.command || 'ENTER', fields: cur.fields });
      const out = await runTransaction(e.base, a1, steps);
      for (const s of out) {
        ok = ok && s.ok;
        console.log(`--- ${s.command}${s.ok ? '' : ' (FAILED)'}: ${s.title}`);
        if (s.message) console.log(`Message: ${s.message}`);
        console.log(screenText(s.screen));
      }
      const last = out.at(-1);
      if (last?.commands && Object.keys(last.commands).length) console.log(`Function codes: ${Object.entries(last.commands).map(([k, v]) => `${k} (${v})`).join(', ')}`);
    } else if (cmd === 'jobs') {
      const list = await api(e, '/__rap/api/jobs');
      if (!list.length) console.log('No background jobs.');
      for (const j of list) console.log(`${j.jobcount}  ${j.jobname.padEnd(24)} ${(STATUS[j.status] || j.status).padEnd(10)} ${when(j.started || j.start_at)}${j.period_min ? `  every ${j.period_min} min` : ''}${j.message ? `  ${j.message}` : ''}`);
    } else if (cmd === 'job' && a1 === 'schedule') {
      if (!a2) fail('usage: rap job schedule <PROG> [NAME=value ...] [--name JOB] [--variant V] [--at ISO] [--every MIN] [--no-wait]');
      let j = await api(e, '/__rap/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ program: a2.toUpperCase(), jobname: opt('--name'), variant: opt('--variant'), at: opt('--at'), every: opt('--every'), params: Object.fromEntries(Object.entries(pairs(argv.slice(1))).map(([k, v]) => [k.toUpperCase(), v])) }) });
      console.log(`Job ${j.jobname} ${j.jobcount} ${STATUS[j.status]}, start ${when(j.start_at)}${j.period_min ? `, every ${j.period_min} min` : ''}`);
      if (!has('--no-wait') && !opt('--at')) {
        for (let i = 0; i < 300 && !['F', 'A'].includes(j.status); i++) { await new Promise(r => setTimeout(r, 200)); j = await api(e, `/__rap/api/jobs/${j.jobcount}`); }
        printJob(j); ok = j.status === 'F';
      }
    } else if ((cmd === 'job' || cmd === 'output') && a1 === 'delete') {
      if (!a2) fail(`usage: rap ${cmd} delete <number>`);
      const r = await fetch(`${e.base}__rap/${cmd === 'job' ? 'jobs' : 'output'}/${encodeURIComponent(a2)}/delete`, { method: 'POST', redirect: 'manual' });
      console.log(r.status < 400 ? `${cmd === 'job' ? 'Job' : 'Output request'} ${a2} deleted` : `HTTP ${r.status}`);
    } else if (cmd === 'job' && a1 === 'cancel') {
      const r = await api(e, `/__rap/api/jobs/${a2}/cancel`, { method: 'POST' });
      console.log(r.cancelled ? `Job ${a2} cancelled` : `Job ${a2} is not scheduled or released`);
    } else if (cmd === 'job') {
      const j = await api(e, `/__rap/api/jobs/${a1}`);
      if (!j) fail(`Job ${a1} does not exist`);
      printJob(j);
    } else if (cmd === 'logs') {
      const list = await api(e, '/__rap/api/logs');
      if (!list.length) console.log('No application logs.');
      for (const l of list) console.log(`${String(l.log_handle).padEnd(22)} ${stamp(l.created_at)}  ${l.object}/${l.subobject}  ${l.external_id}  ${l.msg_count} messages${l.errors ? `, ${l.errors} errors` : ''}${l.warnings ? `, ${l.warnings} warnings` : ''}  (${l.program || '-'}, ${l.log_user})`);
    } else if (cmd === 'log') {
      const l = await api(e, `/__rap/api/logs/${encodeURIComponent(a1)}`);
      if (!l.header) fail(`Log ${a1} does not exist`);
      console.log(`${l.header.external_id}  ${l.header.object}/${l.header.subobject}`);
      for (const m of l.messages) console.log(`  ${String(m.item_no).padStart(3)} ${m.severity}  ${m.message}`);
    } else if (cmd === 'forms') {
      for (const f of await api(e, '/__rap/api/forms')) console.log(`${f.name.padEnd(30)} ${f.title}`);
    } else if (cmd === 'form') {
      if (!a1) fail("usage: rap form <FORM> [--data '<json>'] [--print] [--title T] [--out file.pdf]");
      const data = opt('--data') ? opt('--data') : '{}';
      const r = await api(e, `/__rap/api/forms/${encodeURIComponent(a1)}?${has('--print') ? `print=1&title=${encodeURIComponent(opt('--title', ''))}` : ''}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: data });
      console.log(`Form ${r.form}: ${r.pages} page(s), ${r.bytes} bytes${r.request ? `, output request ${r.request}` : ''}${opt('--data') ? '' : ' (sample data)'}`);
      console.log('Text on the pages:\n' + r.text.map(t => `  ${t}`).join('\n'));
      if (opt('--out')) {
        const pdf = await fetch(e.base + (r.pdf || `__rap/forms/${encodeURIComponent(a1)}.pdf`).replace(/^\//, ''));
        fs.writeFileSync(opt('--out'), Buffer.from(await pdf.arrayBuffer()));
        console.log(`Saved ${opt('--out')}`);
      }
    } else if (cmd === 'outputs') {
      const list = await api(e, '/__rap/api/outputs');
      if (!list.length) console.log('The output queue is empty.');
      for (const o of list) console.log(`${String(o.id).padStart(4)}  ${when(o.created)}  ${o.form.padEnd(24)} ${o.title}  (${o.pages} page(s), ${o.username})`);
    } else if (cmd === 'functions') {
      const list = await api(e, '/__rap/api/functions');
      if (!list.length) console.log('No function modules yet.');
      for (const f of list) {
        console.log(`${f.name}  (group ${f.group})`);
        for (const [s, ps] of Object.entries(f.sections)) for (const p of ps) console.log(`  ${s.padEnd(11)} ${p.parameter.padEnd(24)} ${p.typ || ''}${p.optional ? ' optional' : ''}${p.default ? ` default ${p.default}` : ''}`);
      }
    } else if (cmd === 'fm') {
      if (!a1) fail('usage: rap fm <FUNCTION> [PARAM=value ...]');
      const r = await api(e, `/__rap/api/functions/${encodeURIComponent(a1.toUpperCase())}`, { method: 'POST', body: JSON.stringify({ params: pairs(argv.slice(1)) }) });
      ok = !r.error;
      console.log(`${r.function}: sy-subrc ${r.subrc}${r.exception ? `, exception ${r.exception}` : ''}${r.error ? `\nError: ${r.error}` : ''} (${r.ms} ms)`);
      for (const [t, o] of [['Exporting', r.exporting], ['Changing', r.changing], ['Tables', r.tables]]) for (const [k, v] of Object.entries(o || {})) {
        if (Array.isArray(v)) { console.log(`${t} ${k}: ${v.length} line(s)`); for (const row of v.slice(0, 50)) console.log(`  ${typeof row === 'object' ? Object.values(row).join(' | ') : row}`); }
        else console.log(`${t} ${k} = ${typeof v === 'object' ? JSON.stringify(v) : v}`);
      }
    } else if (cmd === 'table') {
      if (!a1) { console.log((await api(e, '/__rap/api/tables')).filter(t => !/^(rap_|sqlite_)/.test(t)).join('\n')); return; }
      const where = new URLSearchParams(Object.entries(pairs(argv.slice(1))).map(([k, v]) => [k.toLowerCase(), v]));
      where.set('$top', opt('--top', '50'));
      const t = await api(e, `/__rap/api/tables/${encodeURIComponent(a1.toLowerCase())}?${where}`);
      console.log(t.columns.join(' | '));
      for (const r of t.rows) console.log(t.columns.map(c => r[c] instanceof Object ? '(binary)' : r[c]).join(' | '));
      console.log(`(${t.rows.length} rows)`);
    }
  } finally { e.stop(); }
  process.exit(ok ? 0 : 1);
}
function printJob(j) {
  console.log(`Job ${j.jobname} ${j.jobcount}: ${STATUS[j.status] || j.status}${j.started ? `, ran ${when(j.started)}` : `, start ${when(j.start_at)}`}${j.ended && j.started ? ` (${((j.ended - j.started) / 1000).toFixed(1)} s)` : ''}${j.message ? ` - ${j.message}` : ''}`);
  for (const s of j.steps || []) {
    console.log(`Step ${s.step}: ${s.program}${s.variant ? ` variant ${s.variant}` : ''}${s.params && s.params !== '{}' ? ` ${s.params}` : ''}`);
    if (s.spool) console.log(s.spool.split('\n').map(l => `  ${l}`).join('\n'));
  }
}
