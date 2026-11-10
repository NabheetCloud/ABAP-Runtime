// System pages of the classic engine, in the RAP Studio look: the programs launcher and what SAP keeps in its
// system transactions: background jobs (SM36/SM37) with their spool, application logs (SLG1), printed forms
// (SP01) and form previews, and a table browser (SE16). Served by host.mjs under / and /__rap/*.
import fs from 'node:fs';
import { DATE_HINT } from './functions.mjs';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// YYYYMMDDhhmmss (ABAP time stamp, UTC) -> YYYY-MM-DD hh:mm:ss
export const stamp = t => { const s = String(t || ''); return /^\d{14}/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}` : s; };
// times are kept in UTC; the page shows them in the viewer's local time (theme.js converts <time data-local>)
const when = ms => ms ? new Date(Number(ms)).toISOString().replace('T', ' ').slice(0, 19) : '';
const whenHtml = ms => ms ? `<time data-local datetime="${new Date(Number(ms)).toISOString()}">${esc(when(ms))} UTC</time>` : '';
const stampHtml = t => /^\d{14}/.test(String(t || '')) ? whenHtml(Date.UTC(+String(t).slice(0, 4), +String(t).slice(4, 6) - 1, +String(t).slice(6, 8), +String(t).slice(8, 10), +String(t).slice(10, 12), +String(t).slice(12, 14))) : esc(stamp(t));
const STATUS = { P: ['Scheduled', 'muted'], S: ['Released', 'info'], R: ['Active', 'info'], F: ['Finished', 'ok'], A: ['Cancelled', 'error'] };
const SEVERITY = { E: ['Error', 'error'], A: ['Abort', 'error'], X: ['Exit', 'error'], W: ['Warning', 'warn'], I: ['Info', 'info'], S: ['Success', 'ok'] };
const chip = ([t, k]) => `<span class="rs-chip rs-chip--${k}">${esc(t)}</span>`;

export function page(title, body, { app = '', active = '' } = {}) {
  const tabs = [['', 'Programs'], ['functions', 'Functions'], ['jobs', 'Jobs'], ['logs', 'Logs'], ['output', 'Output'], ['forms', 'Forms'], ['tables', 'Tables']];
  const nav = `<nav class="rs-nav" aria-label="System">${tabs.map(([k, t]) => `<a href="${k ? `/__rap/${k}` : '/'}"${k === active ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body class="rl-page"><header class="rl-head"><p class="rl-eyebrow">Classic ABAP</p><h1>${esc(app)}</h1>${nav}</header><main class="rl-main">${body}</main></body></html>`;
}

function table(cols, rows, empty) {
  if (!rows.length) return `<section class="rl-card rl-empty"><p>${esc(empty)}</p></section>`;
  return `<div class="rs-scroll"><table class="rs-table"><thead><tr>${cols.map(c => `<th${c.num ? ' class="num"' : ''}>${esc(c.title)}</th>`).join('')}</tr></thead>
<tbody>${rows.map(r => `<tr>${cols.map(c => `<td${c.num ? ' class="num"' : ''}>${c.html ? c.html(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function launcher(m, fns = []) {
  const kinds = { 1: 'Report', M: 'Module pool' };
  const cards = (m.programs || []).map(p => `
    <a class="rl-tile" href="${p.tcode ? `/transaction?tcode=${encodeURIComponent(p.tcode)}` : `/program?name=${encodeURIComponent(p.name)}`}">
      <span class="rl-tile-kind">${esc(kinds[p.type] || 'Program')}</span>
      <strong>${esc(p.title || p.name)}</strong>
      <code>${esc(p.tcode ? `${p.tcode} · ${p.name}` : p.name)}</code>
    </a>`).join('') + fns.map(f => `
    <a class="rl-tile" href="/__rap/functions/${encodeURIComponent(f.name)}">
      <span class="rl-tile-kind">Function module</span>
      <strong>${esc(f.name)}</strong>
      <code>group ${esc(f.group)} · test</code>
    </a>`).join('');
  return page(`${m.title || m.app} · Programs`, cards ? `<div class="rl-grid">${cards}</div>`
    : `<section class="rl-card rl-empty"><h2>No programs yet</h2><p>Add a report (<code>src/z….prog.abap</code>) or a module pool and it appears here.</p></section>`,
  { app: m.title || m.app, active: '' });
}

// ---------------------------------------------------------------- function modules (SE37 test)
const SEC_TITLES = { IMPORTING: 'Import parameters', CHANGING: 'Changing parameters', TABLES: 'Tables' };
const typeLabel = p => `${p.kind === 'TYPE REF TO' ? 'REF TO ' : ''}${p.typ || 'any'}${p.optional ? ' · optional' : ''}${p.default ? ` · default ${p.default}` : ''}`;
export function functionsPage(m, fns) {
  return page('Function modules', fns.length ? `<div class="rl-grid">${fns.map(f => `<a class="rl-tile" href="/__rap/functions/${encodeURIComponent(f.name)}">
  <span class="rl-tile-kind">Function module</span><strong>${esc(f.name)}</strong><code>group ${esc(f.group)} · test</code></a>`).join('')}</div>`
    : `<section class="rl-card rl-empty"><h2>No function modules yet</h2><p>A function module is <code>src/&lt;group&gt;.fugr.&lt;name&gt;.abap</code> with its "Local Interface" comment block.</p></section>`,
  { app: m.title || m.app, active: 'functions' });
}
// the test form: one field per import, changing and tables parameter (structures and tables as JSON), then the result
export function functionPage(m, fn, values = {}, result = null) {
  if (!fn) return page('Function module', '<section class="rl-card rl-empty"><p>This function module does not exist.</p></section>', { app: m.title || m.app, active: 'functions' });
  // field errors of the last execution (a date that is no date): the input is marked and says why
  const bad = new Map((result?.fields || []).map(e => [e.field, e.message]));
  const errOf = (name, i) => bad.get(name) || (i !== undefined ? bad.get(name.replace(/^([^-]+)-/, `$1[${i + 1}]-`)) : undefined);
  const mark = msg => msg ? ` aria-invalid="true" title="${esc(msg)}"` : '';
  const ph = k => DATE_HINT[k] ? ` placeholder="${DATE_HINT[k]}"` : '';
  const field = p => {
    const v = values[p.parameter] ?? '';
    const big = p.form ? p.form !== 'value' : p.shape === 'TTYP' || p.shape === 'TABL' || p.kind === 'STRUCTURE' || p.table;
    // the JSON hint names the real components: an array of rows for a table, an object for a structure
    const comps = (p.comps || []).slice(0, 3);
    const obj = `{${(comps.length ? comps : ['FIELD']).map(c => `"${c}": "…"`).join(', ')}}`;
    const hint = (p.form || (p.table || p.shape === 'TTYP' ? 'table' : 'struct')) === 'table' ? `JSON rows, e.g. [${obj}]` : `JSON, e.g. ${obj}`;
    // a structure: an input per component; a table: a grid of rows (the JSON is composed when the form is sent)
    if (big && p.comps?.length) {
      const isTable = (p.form || (p.table || p.shape === 'TTYP' ? 'table' : 'struct')) === 'table';
      let cur = null; try { cur = v ? JSON.parse(v) : null; } catch {}
      const comps = p.comps.slice(0, 16);
      const cell = (row, c, i) => { const msg = isTable ? errOf(`${p.parameter}-${c}`, i) : errOf(`${p.parameter}-${c}`);
        return `<input data-c="${esc(c)}" value="${esc(row?.[c] ?? row?.[c.toLowerCase()] ?? '')}" aria-label="${esc(c)}${isTable ? ` row ${i + 1}` : ''}"${ph(p.kinds?.[c])}${mark(msg)}>${msg && !isTable ? `<span class="rs-field-error">${esc(msg)}</span>` : ''}`; };
      const body = isTable
        ? `<table class="rs-grid"><thead><tr>${comps.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${(Array.isArray(cur) && cur.length ? cur : [{}, {}, {}]).map((r, i) => `<tr>${comps.map(c => `<td>${cell(r, c, i)}</td>`).join('')}</tr>`).join('')}</tbody></table><button type="button" class="rs-btn rs-small" data-addrow>+ Row</button>`
        : `<div class="rs-comps">${comps.map(c => `<label>${esc(c)}${cell(cur, c, 0)}</label>`).join('')}</div>`;
      return `<div class="rs-param-form" data-param="${esc(p.parameter)}" data-kind="${isTable ? 'table' : 'struct'}"><span class="rs-pname">${esc(p.parameter)} <small>${esc(typeLabel(p))}</small></span>${body}
        <details><summary>JSON</summary><textarea name="${esc(p.parameter)}" rows="3" placeholder="${esc(hint)}">${esc(v)}</textarea></details></div>`;
    }
    return `<label>${esc(p.parameter)} <small>${esc(typeLabel(p))}</small>${big || /^\s*[[{]/.test(v)
      ? `<textarea name="${esc(p.parameter)}" rows="3" placeholder="${esc(hint)}">${esc(v)}</textarea>`
      : `<input name="${esc(p.parameter)}" value="${esc(v)}" placeholder="${esc(p.default || DATE_HINT[p.kind] || '')}"${mark(bad.get(p.parameter))}${p.values?.length ? ` list="vh-${esc(p.parameter)}"` : ''}>${p.values?.length
        ? `<datalist id="vh-${esc(p.parameter)}">${p.values.map(x => `<option value="${esc(x.low)}">${esc(x.description || '')}</option>`).join('')}</datalist>` : ''}${bad.get(p.parameter) ? `<span class="rs-field-error">${esc(bad.get(p.parameter))}</span>` : ''}`}</label>`;
  };
  const inputs = ['IMPORTING', 'CHANGING', 'TABLES'].filter(s => fn.sections[s]?.length)
    .map(s => `<fieldset class="rs-wide rs-fs"><legend>${SEC_TITLES[s]}</legend>${fn.sections[s].map(field).join('')}</fieldset>`).join('');
  const sig = ['EXPORTING', 'EXCEPTIONS'].filter(s => fn.sections[s]?.length)
    .map(s => `<p class="rs-muted"><strong>${s === 'EXPORTING' ? 'Exports' : 'Exceptions'}:</strong> ${fn.sections[s].map(p => `<code>${esc(p.parameter)}</code>${p.typ ? ` <small>${esc(p.typ)}</small>` : ''}`).join(', ')}</p>`).join('');
  const show = v => {
    if (Array.isArray(v)) {
      if (!v.length) return '<p class="rs-muted">(empty table)</p>';
      if (typeof v[0] !== 'object' || v[0] === null) return table([{ title: 'Line', key: 'v' }], v.map(x => ({ v: x })), '');
      const cols = Object.keys(v[0]);
      return `<p class="rs-muted">${v.length} line(s)</p>` + table(cols.map(c => ({ title: c, html: r => esc(typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c]) })), v, '');
    }
    if (v && typeof v === 'object') return table([{ title: 'Component', key: 'k' }, { title: 'Value', key: 'v' }], Object.entries(v).map(([k, x]) => ({ k, v: typeof x === 'object' ? JSON.stringify(x) : x })), '');
    return `<code class="rs-val">${esc(v === '' ? "''" : v)}</code>`;
  };
  const res = result && `<section class="rl-card"><h2>Result <small>${result.ms} ms · sy-subrc ${result.subrc}</small></h2>
${result.fields?.length ? `<p class="rl-error">Not executed: correct the marked fields.</p><ul class="rs-field-errors">${result.fields.map(e => `<li>${esc(e.message)}</li>`).join('')}</ul>` : result.error ? `<pre class="rl-error">${esc(result.error)}</pre>` : ''}${result.exception ? `<p>${chip([`Exception ${result.exception}`, 'warn'])}</p>` : ''}
${[['Export parameters', result.exporting], ['Changing parameters', result.changing], ['Tables', result.tables]].filter(([, o]) => Object.keys(o || {}).length)
    .map(([t, o]) => `<h3>${t}</h3>${Object.entries(o).map(([k, v]) => `<div class="rs-param"><strong>${esc(k)}</strong>${show(v)}</div>`).join('')}`).join('')}</section>`;
  return page(`${fn.name} · test`, `<p><a href="/__rap/functions">← All function modules</a></p>
<section class="rl-card rs-form"><h2>${esc(fn.name)} <small>function group ${esc(fn.group)}</small></h2>${sig}
<form method="post" action="/__rap/functions/${encodeURIComponent(fn.name)}">${inputs || '<p class="rs-muted rs-wide">No input parameters.</p>'}
<div class="rs-actions"><button class="rs-btn" type="submit">Execute (F8)</button></div></form></section>${res || ''}
<script>addEventListener('keydown', e => { if (e.key === 'F8') { e.preventDefault(); document.querySelector('form[method=post]').requestSubmit(); } });
// the component inputs of structures and the rows of tables become the parameter's JSON (unless it was typed)
document.querySelectorAll('[data-addrow]').forEach(b => b.onclick = () => { const tb = b.previousElementSibling.tBodies[0]; const tr = tb.rows[tb.rows.length - 1].cloneNode(true); tr.querySelectorAll('input').forEach(i => { i.value = ''; }); tb.appendChild(tr); });
document.querySelector('form[method=post]')?.addEventListener('submit', () => {
  for (const box of document.querySelectorAll('[data-param]')) {
    const ta = box.querySelector('textarea');
    if (box.querySelector('details').open && ta.value.trim()) continue;
    const obj = el => { const o = {}; el.querySelectorAll('[data-c]').forEach(i => { if (i.value !== '') o[i.dataset.c] = i.value; }); return o; };
    if (box.dataset.kind === 'table') { const rows = [...box.querySelectorAll('tbody tr')].map(obj).filter(o => Object.keys(o).length); ta.value = rows.length ? JSON.stringify(rows) : ''; }
    else { const o = obj(box); ta.value = Object.keys(o).length ? JSON.stringify(o) : ''; }
  }
});</script>`,
  { app: m.title || m.app, active: 'functions' });
}

// ---------------------------------------------------------------- jobs
export function jobsPage(m, jobs, { notice } = {}) {
  const reports = (m.programs || []).filter(p => p.type !== 'M');
  const rows = jobs.list(200);
  const form = `<section class="rl-card rs-form"><h2>Schedule a job</h2>
<form method="post" action="/__rap/jobs">
  <label>Job name<input name="jobname" required maxlength="32" value="${esc(reports[0] ? `${reports[0].name}_JOB` : '')}"></label>
  <label>Program<select name="program">${reports.map(p => `<option value="${esc(p.name)}">${esc(p.title || p.name)} (${esc(p.name)})</option>`).join('')}</select></label>
  <label class="rs-wide">Selection values <small>one per line, e.g. P_CARR=LH or S_DATE-LOW=20260101</small><textarea name="params" rows="3" placeholder="P_CARR=LH"></textarea></label>
  <label>Variant <small>optional</small><input name="variant" maxlength="14"></label>
  <label>Start<select name="start"><option value="now">Immediately</option><option value="at">At date and time</option></select></label>
  <label>Date and time<input type="datetime-local" name="at"><input type="hidden" name="tz" data-tz value="0"></label>
  <label>Repeat every … minutes <small>0 = once</small><input type="number" name="period" min="0" value="0"></label>
  <div class="rs-actions"><button class="rs-btn" type="submit" ${reports.length ? '' : 'disabled'}>Schedule</button></div>
</form></section>`;
  const list = table([
    { title: 'Job', html: r => `<a href="/__rap/jobs/${esc(r.jobcount)}">${esc(r.jobname)}</a>` },
    { title: 'Number', key: 'jobcount' },
    { title: 'Status', html: r => chip(STATUS[r.status] || [r.status, 'muted']) },
    { title: 'User', key: 'username' },
    { title: 'Start', html: r => whenHtml(r.started || r.start_at) },
    { title: 'Duration', num: true, html: r => r.ended && r.started ? `${((r.ended - r.started) / 1000).toFixed(1)} s` : '' },
    { title: 'Repeats', html: r => r.period_min ? `every ${r.period_min} min` : '' },
  ], rows, 'No background jobs yet. Schedule one here, or from ABAP with JOB_OPEN, JOB_SUBMIT and JOB_CLOSE.');
  return page('Background jobs', `${notice ? `<p class="rs-notice">${esc(notice)}</p>` : ''}<div class="rs-split">${list}${form}</div>`, { app: m.title || m.app, active: 'jobs' });
}

export function jobPage(m, job) {
  if (!job) return page('Job', '<section class="rl-card rl-empty"><p>This job does not exist.</p></section>', { app: m.title || m.app, active: 'jobs' });
  const steps = job.steps.map(s => `<section class="rl-card rs-step"><h2>Step ${s.step}: ${esc(s.program)}${s.variant ? ` <small>variant ${esc(s.variant)}</small>` : ''}</h2>
${Object.keys(JSON.parse(s.params || '{}')).length ? `<p class="rs-muted">${esc(Object.entries(JSON.parse(s.params)).map(([k, v]) => `${k} = ${v}`).join(', '))}</p>` : ''}
${s.spool ? `<h3>Spool</h3><pre class="rs-spool">${esc(s.spool)}</pre>` : '<p class="rs-muted">No output yet.</p>'}</section>`).join('');
  const actions = ['P', 'S'].includes(job.status) ? `<form method="post" action="/__rap/jobs/${esc(job.jobcount)}/cancel"><button class="rs-btn rs-btn--ghost">Cancel job</button></form>` : '';
  const del = job.status !== 'R' ? `<form method="post" action="/__rap/jobs/${esc(job.jobcount)}/delete"><button class="rs-btn rs-btn--ghost">Delete</button></form>` : '';
  return page(`Job ${job.jobname}`, `<p><a href="/__rap/jobs">← All jobs</a></p>
<section class="rl-card"><h2>${esc(job.jobname)} <small>${esc(job.jobcount)}</small> ${chip(STATUS[job.status] || [job.status, 'muted'])}</h2>
<dl class="rs-dl"><dt>User</dt><dd>${esc(job.username)}</dd><dt>Planned start</dt><dd>${whenHtml(job.start_at)}</dd><dt>Started</dt><dd>${whenHtml(job.started)}</dd><dt>Ended</dt><dd>${whenHtml(job.ended)}</dd>
${job.period_min ? `<dt>Repeats</dt><dd>every ${job.period_min} minutes</dd>` : ''}${job.message ? `<dt>Message</dt><dd>${esc(job.message)}</dd>` : ''}</dl>
<div class="rs-actions">${actions}${del}</div></section>${steps}`, { app: m.title || m.app, active: 'jobs' });
}

// ---------------------------------------------------------------- application logs
export function logsPage(m, db) {
  const rows = safe(() => db.prepare('SELECT * FROM zrap_balhdr ORDER BY created_at DESC LIMIT 200').all(), []);
  return page('Application logs', table([
    { title: 'Log', html: r => `<a href="/__rap/logs/${encodeURIComponent(r.log_handle)}">${esc(r.external_id || r.log_handle)}</a>` },
    { title: 'Object', key: 'object' }, { title: 'Subobject', key: 'subobject' },
    { title: 'Created', html: r => stampHtml(r.created_at) },
    { title: 'User', key: 'log_user' }, { title: 'Program', key: 'program' },
    { title: 'Messages', num: true, key: 'msg_count' },
    { title: 'Problems', html: r => `${r.errors ? chip([`${r.errors} errors`, 'error']) : ''} ${r.warnings ? chip([`${r.warnings} warnings`, 'warn']) : ''}` },
  ], rows, 'No application logs yet. Programs write them with cl_bali_log and save them with cl_bali_log_db.'), { app: m.title || m.app, active: 'logs' });
}
export function logPage(m, db, handle) {
  const h = safe(() => db.prepare('SELECT * FROM zrap_balhdr WHERE log_handle = ?').get(handle), null);
  const msgs = safe(() => db.prepare('SELECT * FROM zrap_balmsg WHERE log_handle = ? ORDER BY item_no').all(handle), []);
  return page('Application log', `<p><a href="/__rap/logs">← All logs</a></p>
<section class="rl-card"><h2>${esc(h?.external_id || handle)} <small>${esc(h?.object)} / ${esc(h?.subobject)}</small></h2>
${table([{ title: '#', num: true, key: 'item_no' }, { title: 'Type', html: r => chip(SEVERITY[r.severity] || [r.severity, 'muted']) }, { title: 'Message', key: 'message' }], msgs, 'This log has no messages.')}</section>`,
  { app: m.title || m.app, active: 'logs' });
}

// ---------------------------------------------------------------- output queue and forms
// a PDF shown in the page (PDF.js), so it also works inside the studio preview, with a download button
export function pdfPage(m, title, src, back) {
  return page(title, `<p><a href="${esc(back)}">← Back</a></p>
<section class="rl-card"><h2>${esc(title)} <a class="rs-btn rs-btn--ghost rs-dl-btn" href="${esc(src)}" download>Download PDF</a></h2>
<div id="pdf" class="rs-pdf"><p class="rs-muted">Rendering…</p></div></section>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
pdfjsLib.getDocument(${JSON.stringify(src)}).promise.then(async pdf => {
  const host = document.getElementById('pdf'); host.innerHTML = '';
  for (let n = 1; n <= pdf.numPages; n++) {
    const pg = await pdf.getPage(n), vp = pg.getViewport({ scale: 1.4 });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; host.appendChild(c);
    await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  }
}).catch(e => { document.getElementById('pdf').textContent = 'The PDF could not be shown: ' + e.message; });
</script>`, { app: m.title || m.app, active: back.includes('forms') ? 'forms' : 'output' });
}
export function outputPage(m, forms) {
  return page('Output', table([
    { title: 'Request', num: true, key: 'id' },
    { title: 'Title', html: r => `<a href="/__rap/output/${r.id}">${esc(r.title)}</a>` },
    { title: 'Form', key: 'form' }, { title: 'Queue', html: r => esc(r.qname || 'DEFAULT') }, { title: 'User', key: 'username' },
    { title: 'Created', html: r => whenHtml(r.created) }, { title: 'Pages', num: true, key: 'pages' }, { title: 'Copies', num: true, html: r => esc(String(r.copies || 1)) },
    { title: 'Format', html: r => (r.format && r.format !== 'PDF' ? `<a href="/__rap/output/${r.id}.pdl" title="The print data">${esc(r.format)}</a>` : 'PDF') },
    { title: 'Size', num: true, html: r => `${Math.ceil((r.bytes || 0) / 1024)} KB` },
    { title: '', html: r => `<form method="post" action="/__rap/output/${r.id}/delete"><button class="rs-link">Delete</button></form>` },
  ], forms.outputs(200), 'Nothing printed yet. Programs print forms with zcl_rap_form=>print( ).'), { app: m.title || m.app, active: 'output' });
}
export function formsPage(m, forms) {
  const list = forms.list().map(n => ({ name: n, title: forms.load(n)?.title || n }));
  return page('Forms', list.length ? `<div class="rl-grid">${list.map(f => `<a class="rl-tile" href="/__rap/forms/${encodeURIComponent(f.name)}">
  <span class="rl-tile-kind">Form</span><strong>${esc(f.title)}</strong><code>${esc(f.name)} · preview with sample data</code></a>`).join('')}</div>`
    : `<section class="rl-card rl-empty"><h2>No forms yet</h2><p>A print form is a layout in <code>src/z….form.json</code>; programs fill it with zcl_rap_form.</p></section>`,
  { app: m.title || m.app, active: 'forms' });
}

// ---------------------------------------------------------------- table browser
const ENGINE = /^(rap_|sqlite_|kernel_locks$)/;
export function tablesPage(m, db, externals) {
  const all = safe(() => db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name").all(), []).filter(t => !ENGINE.test(t.name));
  const temp = externals.map(x => ({ name: x.name, type: `from app ${x.app}` }));
  const own = all.filter(t => /^[zy]/i.test(t.name) && !/^zrap_/.test(t.name)), sys = all.filter(t => !own.includes(t));
  const grid = list => `<div class="rs-tables">${list.map(t => `<a href="/__rap/tables/${encodeURIComponent(t.name)}"><code>${esc(t.name)}</code><small>${esc(t.type === 'table' ? count(db, t.name) : t.type)}</small></a>`).join('')}</div>`;
  return page('Tables', `<section class="rl-card"><h2>Tables of this app</h2>${own.length || temp.length ? grid([...own, ...temp]) : '<p class="rs-muted">None.</p>'}</section>
<details class="rl-card rs-details"><summary>System tables (${sys.length})</summary>${grid(sys)}</details>`, { app: m.title || m.app, active: 'tables' });
}
const count = (db, t) => { const n = safe(() => db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n, null); return n === null ? '' : `${n} rows`; };
export function tablePage(m, db, name, query) {
  if (!/^[\w/$#]{1,64}$/.test(String(name))) name = '';   // a table name only: it goes into the SQL text
  const cols = safe(() => db.prepare(`PRAGMA table_info("${name.replace(/"/g, '')}")`).all().map(c => c.name), []);
  if (!cols.length) return page('Table', '<section class="rl-card rl-empty"><p>This table does not exist.</p></section>', { app: m.title || m.app, active: 'tables' });
  const filters = cols.filter(c => query[`f_${c}`]);
  const where = filters.map(c => `"${c}" LIKE ?`).join(' AND ');
  const args = filters.map(c => String(query[`f_${c}`]).replace(/\*/g, '%'));
  const max = Math.min(Number(query.max) || 200, 5000);
  const rows = safe(() => db.prepare(`SELECT * FROM "${name}"${where ? ` WHERE ${where}` : ''} LIMIT ${max}`).all(...args), []);
  const total = safe(() => db.prepare(`SELECT COUNT(*) AS n FROM "${name}"${where ? ` WHERE ${where}` : ''}`).get(...args).n, rows.length);
  const show = v => v instanceof Uint8Array ? `(${v.length} bytes)` : v;
  return page(name, `<p><a href="/__rap/tables">← All tables</a></p>
<section class="rl-card"><h2><code>${esc(name)}</code> <small>${total} rows${total > rows.length ? `, first ${rows.length} shown` : ''}</small></h2>
<form method="get" class="rs-filter"><div class="rs-scroll"><table class="rs-table"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr>
<tr class="rs-filter-row">${cols.map(c => `<th><input name="f_${esc(c)}" value="${esc(query[`f_${c}`] || '')}" placeholder="filter" aria-label="Filter ${esc(c)}"></th>`).join('')}</tr></thead>
<tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${esc(show(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
<div class="rs-actions"><button class="rs-btn">Apply filter</button><span class="rs-muted">* matches any text</span></div></form></section>`, { app: m.title || m.app, active: 'tables' });
}

function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }
export const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
