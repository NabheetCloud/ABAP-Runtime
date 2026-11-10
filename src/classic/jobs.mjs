// Background jobs of the classic engine (SM36/SM37 style). open-abap-jobs only has stubs, so the function modules
// JOB_OPEN, JOB_SUBMIT and JOB_CLOSE (declared in src/classic/abap) are implemented here, on two tables of the
// app's database, and a scheduler in the host runs released jobs when they are due: each step runs its report
// without a screen (through the engine's own HTTP interface, as a browser would) and keeps the list as spool.
//   rap_job       jobcount, jobname, status (P scheduled, S released, R active, F finished, A cancelled), ...
//   rap_job_step  jobcount, step, program, variant, params (JSON of selection-screen fields), spool
import { runProgram } from './client.mjs';

const now = () => Date.now();

export function installJobs(abap, client, { port, log = () => {} }) {
  const db = client.db;
  db.exec(`CREATE TABLE IF NOT EXISTS rap_job (jobcount TEXT PRIMARY KEY, jobname TEXT, status TEXT, username TEXT,
      created INTEGER, start_at INTEGER, period_min INTEGER, started INTEGER, ended INTEGER, message TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS rap_job_step (jobcount TEXT, step INTEGER, program TEXT, variant TEXT, params TEXT,
      spool TEXT, PRIMARY KEY (jobcount, step))`);
  db.exec(`UPDATE rap_job SET status = 'A', message = 'The engine stopped while the job ran' WHERE status = 'R'`);
  const value = v => { try { return String(v?.get?.() ?? v ?? '').replace(/ +$/, ''); } catch { return ''; } };
  const sy = () => abap.builtin.sy.get();
  const fail = name => { throw new abap.ClassicError({ classic: name }); };
  const nextCount = () => String((db.prepare('SELECT MAX(CAST(jobcount AS INTEGER)) AS n FROM rap_job').get()?.n || 0) + 1).padStart(8, '0');
  const startOf = (date, time) => {
    const d = value(date), t = value(time);
    if (!/^\d{8}$/.test(d) || d === '00000000') return null;
    const tt = /^\d{6}$/.test(t) ? t : '000000';
    return Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +tt.slice(0, 2), +tt.slice(2, 4), +tt.slice(4, 6));
  };

  const api = {
    // a job from the studio UI or ABAP: steps [{ program, variant, params }]
    create({ jobname, user, steps = [], startAt = now(), periodMin = 0, release = true }) {
      const jobcount = nextCount();
      db.prepare('INSERT INTO rap_job (jobcount, jobname, status, username, created, start_at, period_min) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(jobcount, jobname || 'JOB', release ? 'S' : 'P', user || 'DEVELOPER', now(), startAt, periodMin || 0);
      steps.forEach((s, i) => db.prepare('INSERT INTO rap_job_step (jobcount, step, program, variant, params) VALUES (?, ?, ?, ?, ?)')
        .run(jobcount, i + 1, String(s.program).toUpperCase(), s.variant || '', JSON.stringify(s.params || {})));
      return jobcount;
    },
    list(limit = 100) { return db.prepare('SELECT * FROM rap_job ORDER BY CAST(jobcount AS INTEGER) DESC LIMIT ?').all(limit); },
    get(jobcount) {
      const job = db.prepare('SELECT * FROM rap_job WHERE jobcount = ?').get(jobcount);
      return job && { ...job, steps: db.prepare('SELECT * FROM rap_job_step WHERE jobcount = ? ORDER BY step').all(jobcount) };
    },
    cancel(jobcount) { return db.prepare("UPDATE rap_job SET status = 'A', message = 'Cancelled', ended = ? WHERE jobcount = ? AND status IN ('P', 'S')").run(now(), jobcount).changes; },
    remove(jobcount) { db.prepare('DELETE FROM rap_job_step WHERE jobcount = ?').run(jobcount); return db.prepare("DELETE FROM rap_job WHERE jobcount = ? AND status <> 'R'").run(jobcount).changes; },
  };

  abap.FunctionModules.JOB_OPEN = async ({ exporting = {}, importing = {} }) => {
    const name = value(exporting.jobname);
    if (!name) fail('JOBNAME_MISSING');
    const count = api.create({ jobname: name, user: value(sy().uname), release: false, startAt: startOf(exporting.sdlstrtdt, exporting.sdlstrttm) ?? now() });
    importing.jobcount?.set(count);
    sy().subrc.set(0);
  };
  abap.FunctionModules.JOB_SUBMIT = async ({ exporting = {}, importing = {} }) => {
    const count = value(exporting.jobcount), report = value(exporting.report).toUpperCase();
    if (!db.prepare('SELECT 1 FROM rap_job WHERE jobcount = ?').get(count)) fail('JOB_NOTEX');
    if (!report) fail('PROGRAM_MISSING');
    const step = (db.prepare('SELECT MAX(step) AS n FROM rap_job_step WHERE jobcount = ?').get(count)?.n || 0) + 1;
    db.prepare('INSERT INTO rap_job_step (jobcount, step, program, variant, params) VALUES (?, ?, ?, ?, ?)').run(count, step, report, value(exporting.variant), '{}');
    importing.step_number?.set(step);
    sy().subrc.set(0);
  };
  abap.FunctionModules.JOB_CLOSE = async ({ exporting = {}, importing = {} }) => {
    const count = value(exporting.jobcount);
    const job = db.prepare('SELECT * FROM rap_job WHERE jobcount = ?').get(count);
    if (!job) fail('JOB_NOTEX');
    if (!db.prepare('SELECT 1 FROM rap_job_step WHERE jobcount = ?').get(count)) fail('JOB_NOSTEPS');
    const period = Number(value(exporting.prdmins) || 0) + 60 * Number(value(exporting.prddays) || 0) * 24 + 60 * Number(value(exporting.prdhours) || 0);
    const at = /X/i.test(value(exporting.strtimmed)) ? now() : startOf(exporting.sdlstrtdt, exporting.sdlstrttm);
    if (at === null && !job.start_at) fail('INVALID_STARTDATE');
    db.prepare("UPDATE rap_job SET status = 'S', start_at = ?, period_min = ? WHERE jobcount = ?").run(at ?? job.start_at, period || 0, count);
    importing.job_was_released?.set('X');
    sy().subrc.set(0);
  };

  // ---- the scheduler
  const base = `http://127.0.0.1:${port}/`;
  // selection-screen fields of a variant saved on the selection screen (open-abap-gui variants)
  async function variantFields(program, variant) {
    const out = {};
    const cls = abap.Classes.ZCL_GG_HOST_VARIANT;
    if (!variant || !cls) return out;
    const name = new abap.types.Character(14).set(variant);
    for (const owner of ['GG_BROWSER', 'GG_DEFAULT']) {
      const values = await cls.load({ iv_name: name, iv_report: new abap.types.String().set(`ZCL_${program}`), iv_owner: new abap.types.String().set(owner) });
      const rows = values?.array?.() || [];
      for (const r of rows) {
        const v = r.get(), n = value(v.name);
        const ranges = v.ranges.array();
        if (!ranges.length) { out[n] = value(v.value); continue; }
        ranges.forEach((x, i) => {
          const g = x.get(), p = ranges.length === 1 ? n : `${n}-${i + 1}`;
          out[`${p}-LOW`] = value(g.low); out[`${p}-HIGH`] = value(g.high); out[`${p}-SIGN`] = value(g.sign); out[`${p}-OPTION`] = value(g.option);
        });
      }
      if (rows.length) break;
    }
    return out;
  }
  async function runStep(step) {
    const r = await runProgram(base, step.program, JSON.parse(step.params || '{}'), { extra: await variantFields(step.program, step.variant) });
    if (!r.ok) throw new Error(r.message || `program ${step.program} failed`);
    return [r.message, r.list].filter(Boolean).join('\n');
  }
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      for (const job of db.prepare("SELECT * FROM rap_job WHERE status = 'S' AND start_at <= ? ORDER BY start_at").all(now())) {
        db.prepare("UPDATE rap_job SET status = 'R', started = ? WHERE jobcount = ?").run(now(), job.jobcount);
        let status = 'F', message = '';
        for (const step of db.prepare('SELECT * FROM rap_job_step WHERE jobcount = ? ORDER BY step').all(job.jobcount)) {
          try { db.prepare('UPDATE rap_job_step SET spool = ? WHERE jobcount = ? AND step = ?').run(await runStep(step), job.jobcount, step.step); }
          catch (e) { status = 'A'; message = `Step ${step.step} (${step.program}): ${e.message}`; break; }
        }
        db.prepare('UPDATE rap_job SET status = ?, ended = ?, message = ? WHERE jobcount = ?').run(status, now(), message, job.jobcount);
        log(`job ${job.jobname} ${job.jobcount} ${status === 'F' ? 'finished' : `cancelled: ${message}`}`);
        if (job.period_min > 0) {     // periodic job: the next run is a new released job
          const steps = db.prepare('SELECT * FROM rap_job_step WHERE jobcount = ? ORDER BY step').all(job.jobcount).map(s => ({ program: s.program, variant: s.variant, params: JSON.parse(s.params || '{}') }));
          api.create({ jobname: job.jobname, user: job.username, steps, startAt: job.start_at + job.period_min * 60000 * Math.max(1, Math.ceil((now() - job.start_at) / (job.period_min * 60000))), periodMin: job.period_min });
        }
      }
    } finally { busy = false; }
  }
  const timer = setInterval(() => tick().catch(e => log(`scheduler: ${e.message}`)), Number(process.env.RAP_JOB_TICK_MS || 2000));
  timer.unref();
  return { ...api, tick };
}
