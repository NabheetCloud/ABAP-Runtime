import { mountDesigner } from './designer.js';
import { mountXdpDesigner } from './xdp-designer.js';
import { mountNewObject, objectParts, askDialog } from './newobj.js';
import { mountCodeIntel } from './codeintel.js';
import { mountVisual, visualKind } from './visual/editors.js';
// RAP Studio client: chat with the local AI agent + live preview, code, problems, data and console.
const root = document.getElementById('root');
const $ = (sel, el = document) => el.querySelector(sel);
import { md } from './markdown.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Monaco cancels its own pending requests (hover, completion) when the model changes: not an error
window.addEventListener('unhandledrejection', e => { if (e.reason?.name === 'Canceled' || e.reason?.message === 'Canceled') e.preventDefault(); });
// the classic engine's pages in the preview: where they are (kept on reload) and, after a run, the first input focused
window.addEventListener('message', e => {
  if (e.data?.type !== 'rap-classic-page' || !S.classicUrl || !S.classicUrl.startsWith(e.origin)) return;
  S.classicCurrent = e.data.path || null;
  const frame = $('#frame');
  const busy = document.activeElement && document.activeElement !== frame && document.activeElement !== document.body && /^(INPUT|TEXTAREA|SELECT)$|monaco/i.test(`${document.activeElement.tagName} ${document.activeElement.className}`);
  if (S.tab === 'preview' && frame && !busy) { try { frame.focus(); frame.contentWindow.postMessage({ type: 'rap-focus' }, e.origin); } catch {} }
});
async function api(method, url, body, raw, headers = {}) {
  const r = await fetch(url, { method, headers: { ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const t = await r.text();
  let d = null; try { d = t ? JSON.parse(t) : null; } catch { d = t; }
  if (!r.ok) throw new Error(d?.error?.message || d?.error || r.statusText);
  return d;
}
// files attached to a request (documents, specifications, screenshots): the paper clip, paste (screenshots from the
// clipboard) and drag and drop onto the box; sent with the message as base64, read by the agent
const ATTACH_ACCEPT = 'image/*,.pdf,.docx,.xlsx,.pptx,.odt,.txt,.md,.csv,.tsv,.json,.xml,.html,.abap,.cds,.sql,.yaml,.yml,.log,.eml,.xdp';
const MAX_ATTACH = 25 * 1024 * 1024;
const kb = n => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fileIcon = name => (/\.(png|jpe?g|gif|webp|bmp)$/i.test(name) ? '🖼' : /\.pdf$/i.test(name) ? '📕' : /\.docx|\.odt$/i.test(name) ? '📝' : /\.xlsx|\.csv|\.tsv$/i.test(name) ? '📊' : /\.pptx$/i.test(name) ? '📽' : '📄');
function attacher(box, textarea, chips, button) {
  const files = [];
  const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: ATTACH_ACCEPT, hidden: true });
  box.appendChild(input);
  const draw = () => {
    chips.hidden = !files.length;
    chips.innerHTML = files.map((f, i) => `<span class="att-chip" title="${esc(f.name)} (${kb(f.size)})">${f.preview ? `<img src="${f.preview}" alt="">` : `<span class="ic">${fileIcon(f.name)}</span>`}<span class="nm">${esc(f.name)}</span><small>${kb(f.size)}</small><button type="button" data-rm="${i}" aria-label="Remove ${esc(f.name)}">×</button></span>`).join('');
  };
  const add = list => {
    for (const f of list) {
      if (files.length >= 10) { toast('At most 10 files per message'); break; }
      if (f.size > MAX_ATTACH) { toast(`${f.name} is larger than 25 MB`); continue; }
      const name = f.name && f.name !== 'image.png' ? f.name : `screenshot-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
      files.push({ file: f, name, size: f.size, preview: /^image\//.test(f.type) ? URL.createObjectURL(f) : null });
    }
    draw();
  };
  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { add(input.files); input.value = ''; });
  chips.addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (!b) return; const [f] = files.splice(Number(b.dataset.rm), 1); if (f?.preview) URL.revokeObjectURL(f.preview); draw(); });
  textarea.addEventListener('paste', e => { const list = [...(e.clipboardData?.files || [])]; if (list.length) { e.preventDefault(); add(list); toast(list.length === 1 ? 'Screenshot attached' : `${list.length} files attached`); } });
  box.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); box.classList.add('dropping'); } });
  box.addEventListener('dragleave', e => { if (!box.contains(e.relatedTarget)) box.classList.remove('dropping'); });
  box.addEventListener('drop', e => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); box.classList.remove('dropping'); add(e.dataTransfer.files); });
  return {
    get count() { return files.length; },
    // [{ name, type, data (base64) }]
    payload: () => Promise.all(files.map(f => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve({ name: f.name, type: f.file.type, data: String(r.result).replace(/^data:[^,]*,/, '') }); r.onerror = () => reject(r.error); r.readAsDataURL(f.file); }))),
    clear: () => { for (const f of files) if (f.preview) URL.revokeObjectURL(f.preview); files.length = 0; draw(); },
  };
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3000); }

const S = { app: null, tab: 'preview', items: [], running: false, es: null, files: [], open: null, editor: null, model: null, dirty: false, ws: null, previewPath: '', homeKind: 'all', homeSearch: '' };
// the open exercise (Practice ABAP, at the end of this file)
const EX = { editor: null, models: {}, data: null, file: null, saveTimer: null, results: null };
const EXAMPLES = [
  ['RAP', 'Library loans', 'A library app to manage books and loans. Members borrow books; a loan has a due date, and returning a book is an action. Overdue loans are shown in red.'],
  ['RAP', 'Purchase requisitions', 'Purchase requisitions with items for the standard products and plants. Approve and reject actions, total amount calculated from items, a requisition can only be edited while it is open.'],
  ['RAP', 'Sales quotations', 'Sales quotations for the standard customers and products: items with quantity and price from the product valuation, a total in the customer currency, and a "convert to order" action.'],
  ['RAP', 'Leave requests', 'An employee leave request app: employees request vacation days, a manager approves or rejects with a comment, and the days left are validated.'],
  ['Classic', 'Stock report', 'A report of product stock per plant and storage location from the standard product data, with selection by plant and product type, an ALV list and a print form of the list.'],
  ['Classic', 'Maintenance transaction', 'A module pool transaction to maintain cost center budgets per fiscal year for the standard cost centers, with a lock object, an application log of changes and a nightly background job that prints a budget form.'],
];

// current user: drafts and draft locks belong to a user (cookie shared with the apps and Fiori elements)
// and the user's settings: the date format of classic screens, lists and printed forms
const DATE_FORMATS = [['1', 'DD.MM.YYYY'], ['2', 'MM/DD/YYYY'], ['3', 'MM-DD-YYYY'], ['4', 'YYYY.MM.DD'], ['5', 'YYYY/MM/DD'], ['6', 'YYYY-MM-DD']];
let userInfo = {};
async function loadUser() { userInfo = await api('GET', '/studio/api/user'); $('#userName').textContent = userInfo.user; }
$('#userBtn').onclick = async () => {
  const r = await askDialog({ title: 'User', text: 'Drafts are locked per user. The date format applies to classic screens, lists and printed forms.', ok: 'Save',
    input: userInfo.authenticated ? null : { label: 'User', value: $('#userName').textContent, placeholder: 'ALICE' },
    select: { label: 'Date format', value: userInfo.settings?.dateFormat || '1', options: DATE_FORMATS } });
  if (!r) return;
  const before = $('#userName').textContent;
  const name = r.value || before;
  if (name.toUpperCase() !== before.toUpperCase()) await api('POST', '/studio/api/user', { name });
  await api('POST', '/studio/api/user', { settings: { dateFormat: r.choice } });
  await loadUser();
  if (S.app) reloadPreview(true);
  toast(name.toUpperCase() !== before.toUpperCase() ? `Now working as ${$('#userName').textContent}` : 'Settings saved');
};
loadUser();
window.addEventListener('hashchange', route);
document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 's' && S.app) { e.preventDefault(); saveFile(); } });
route();

async function route() {
  const lm = /^#\/learn(?:\/([a-z0-9-]+))?/.exec(location.hash);
  if (lm) return lm[1] ? renderExercise(lm[1]) : renderLearn();
  closeExercise();
  const m = /^#\/app\/([^/]+)(?:\/(\w+))?/.exec(location.hash);
  if (!m) return renderHome();
  const [, app, tab] = m;
  if (app !== S.app) await openApp(app);
  setTab(tab || S.tab || 'preview');
  // a new blank app: the New Object dialog right away
  if (S.openNewAfter && S.app === app) { S.openNewAfter = false; newObj().openNew(); }
}

// ------------------------------------------------------------------ SAP standard catalog
// The standard layer's "preview": its objects by business area; one object at a time with fields, data and usage.
async function showStandard() {
  const host = $('#stdCatalog');
  if (!host) return;
  $('#frame').hidden = true; host.hidden = false;
  document.querySelector('#p-preview .preview-bar').hidden = true;
  if (!S.std) {
    host.innerHTML = '<p class="std-loading">Loading the catalog…</p>';
    S.std = await api('GET', '/studio/api/standard');
    S.stdSel = S.stdSel || S.std.areas[0].objects[0].view;
    S.stdView = 'fields';
  }
  const t = S.std.totals;
  host.innerHTML = `
    <div class="std-head">
      <div><strong>SAP S/4HANA standard content</strong><span class="std-sum">${t.objects} objects in ${S.std.areas.length} areas · ${t.tables} tables · ${t.views} released CDS views · ${t.rows} rows</span></div>
      <input class="input std-search" id="stdSearch" type="search" placeholder="Find, e.g. customer, KNA1, currency" aria-label="Find a standard object" value="${esc(S.stdQ || '')}">
    </div>
    <div class="std-body${S.stdOpen ? ' std-detail-open' : ''}">
      <nav class="std-list" id="stdList" aria-label="Standard objects"></nav>
      <section class="std-detail" id="stdDetail" aria-live="polite"></section>
    </div>`;
  const list = () => {
    const q = String(S.stdQ || '').toLowerCase();
    const match = o => !q || `${o.view} ${o.label} ${o.table} ${o.texts.join(' ')}`.toLowerCase().includes(q);
    $('#stdList').innerHTML = S.std.areas.map(a => {
      const objs = a.objects.filter(match);
      if (!objs.length) return '';
      // narrow pane: areas start collapsed (five lines); wide: the area of the object shown on the right
      const wide = host.clientWidth > 640;
      const open = q || S.stdArea === a.id || (wide && !S.stdArea && objs.some(o => o.view === S.stdSel));
      return `<details class="std-area" data-area="${a.id}" ${open ? 'open' : ''}><summary><span>${esc(a.title)}</span><span class="std-n">${objs.length}</span><small>${esc(a.description)}</small></summary>
        ${objs.map(o => `<button class="std-obj${o.view === S.stdSel ? ' sel' : ''}" data-view="${esc(o.view)}"><span>${esc(o.label)}</span><code>${esc(o.view)}</code></button>`).join('')}</details>`;
    }).join('') || '<p class="std-none">Nothing matches.</p>';
    $('#stdList').querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => { S.stdSel = b.dataset.view; S.stdOpen = true; host.querySelector('.std-body').classList.add('std-detail-open'); list(); detail(); }));
    $('#stdList').querySelectorAll('details').forEach(d => d.addEventListener('toggle', () => { if (d.open) S.stdArea = d.dataset.area; }));
  };
  const detail = async () => {
    const o = S.std.areas.flatMap(a => a.objects).find(x => x.view === S.stdSel);
    if (!o) return;
    const keys = o.fields.filter(f => f.key).map(f => f.name);
    const tab = S.stdView;
    $('#stdDetail').innerHTML = `
      <button class="btn sm ghost std-back" id="stdBack">← All objects</button>
      <h3>${esc(o.label)}</h3>
      <p class="std-meta"><code>${esc(o.view)}</code> released CDS view · table <code>${esc(o.table.toUpperCase())}</code>${o.rows !== null ? ` · ${o.rows} rows` : ''}${o.texts.length ? ` · texts in <code>${o.texts.map(esc).join('</code>, <code>')}</code>` : ''}</p>
      <div class="seg std-tabs" role="tablist">${[['fields', `Fields (${o.fields.length})`], ['data', 'Data'], ['use', 'How to use']].map(([v, l]) => `<button role="tab" data-v="${v}" aria-pressed="${tab === v}">${l}</button>`).join('')}</div>
      <div class="std-pane" id="stdPane"></div>`;
    $('#stdBack').onclick = () => { S.stdOpen = false; host.querySelector('.std-body').classList.remove('std-detail-open'); };
    $('#stdDetail').querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => { S.stdView = b.dataset.v; detail(); }));
    const pane = $('#stdPane');
    if (tab === 'fields') {
      pane.innerHTML = `<table class="std-table"><thead><tr><th>Field</th><th>Type</th></tr></thead><tbody>${o.fields.map(f => `<tr><td>${f.key ? '<span class="std-key" title="Key">key</span> ' : ''}${esc(f.name)}</td><td><code>${esc(f.type)}</code></td></tr>`).join('')}</tbody></table>
        <p class="std-note">Classic programs can also read table <code>${esc(o.table.toUpperCase())}</code> (fields ${o.tableFields.slice(0, 6).map(f => `<code>${esc(f)}</code>`).join(', ')}${o.tableFields.length > 6 ? ', …' : ''}).</p>`;
    } else if (tab === 'data') {
      pane.innerHTML = '<p class="std-loading">Loading…</p>';
      const d = await api('GET', `/studio/api/standard/rows?view=${encodeURIComponent(o.view)}&top=50`);
      if (S.stdSel !== o.view || S.stdView !== 'data') return;
      pane.innerHTML = d.rows.length ? `<div class="std-scroll"><table class="std-table std-data"><thead><tr>${d.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${d.rows.map(r => `<tr>${d.columns.map(c => `<td>${esc(r[c] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="std-note">${d.rows.length < (o.rows || 0) ? `First ${d.rows.length} of ${o.rows} rows.` : `${d.rows.length} rows.`} Read-only seed data, shared by every app.</p>` : '<p class="std-note">No rows.</p>';
    } else {
      const alias = `_${o.view.replace(/^I_/, '').replace(/_\d+$/, '')}`;
      const cond = keys.map(k => `$projection.${k} = ${alias}.${k}`).join(' and ');
      const name = o.fields.find(f => !f.key && /Name$|Description$/.test(f.name))?.name;
      pane.innerHTML = `<p class="std-note">In a CDS view of your app:</p>
<pre class="std-code">association [0..1] to ${esc(o.view)} as ${esc(alias)}
  on ${esc(cond)}${name ? `\n…\n${esc(alias)}.${esc(name)} as ${esc(name)}` : ''}</pre>
<p class="std-note">In ABAP:</p>
<pre class="std-code">SELECT ${esc([...keys, ...(name ? [name] : [])].join(', '))}
  FROM ${esc(o.view)}
  INTO TABLE @DATA(lt_${esc(o.view.replace(/^I_/, '').toLowerCase())}).</pre>
<p class="std-note">Or just ask the AI agent in your app, e.g. “add a ${esc(o.label.toLowerCase())} with a value help”.</p>`;
    }
  };
  $('#stdSearch').addEventListener('input', e => { S.stdQ = e.target.value; list(); });
  list(); detail();
}

// ------------------------------------------------------------------ home
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
function ago(t) {
  const ms = Date.now() - new Date(t).getTime();
  if (!Number.isFinite(ms)) return '';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  if (m < 14 * 1440) return `${Math.round(m / 1440)} d ago`;
  return new Date(t).toLocaleDateString();
}
// an app card: what it is (RAP / Classic), what it holds, when it last changed
// screens kept as apps from a GenUI5 conversation: their own page on the GenUI5 server, live data, changes confirmed
async function renderChatApps() {
  let r;
  try { r = await api('GET', '/studio/api/chatapps'); } catch { return; }
  const el = $('#chatApps');
  if (!el || !r.available || !r.apps.length) return;
  el.innerHTML = `<div class="apps-head"><h2>Kept from the chat <span class="count">${r.apps.length}</span></h2><span class="hint">Screens from a GenUI5 conversation, with live data.</span><span class="spacer"></span><a class="btn sm ghost" href="${esc(r.launchpad)}" target="_blank" rel="noopener">All kept apps ↗</a></div>
    <div class="app-grid">${r.apps.map(a => `<a class="app-card" href="${esc(a.url)}" target="_blank" rel="noopener"><span class="card-top"><span class="n">${esc(a.title)}</span><span class="ex-kind ex-chat">From chat</span></span>
      <span class="d">Kept from a GenUI5 conversation</span><span class="facts">Live data · changes need your confirmation</span><span class="when">${a.created ? `Kept ${esc(ago(a.created))}` : '&nbsp;'}</span></a>`).join('')}</div>`;
  el.hidden = false;
}
function appCard(a) {
  const facts = [
    a.services && plural(a.services, 'service'), a.uiApps && plural(a.uiApps, 'UI app'), a.programs && plural(a.programs, 'program'),
    a.transactions && plural(a.transactions, 'transaction'), a.forms && plural(a.forms, 'form'), a.tables && plural(a.tables, 'table'),
    a.standard && a.views && plural(a.views, 'released view'),
  ].filter(Boolean);
  const kind = a.standard ? ['sys', 'SAP standard'] : a.kind === 'classic' ? ['classic', 'Classic'] : a.kind === 'both' ? ['both', 'RAP + Classic'] : ['rap', 'RAP'];
  const when = a.running ? '<span class="busy">● building…</span>' : a.standard ? 'Read-only · used by every app' : `Changed ${esc(ago(a.changed || a.created))}`;
  const card = `<a class="app-card" href="#/app/${esc(a.name)}"><span class="card-top"><span class="n">${esc(a.title)}</span><span class="ex-kind ex-${kind[0]}">${kind[1]}</span></span>
    <span class="d">${esc(a.prompt || a.name)}</span><span class="facts">${esc(facts.join(' · ')) || '&nbsp;'}</span><span class="when">${a.archived && !a.running ? `Archived ${esc(ago(a.archived))}` : when}</span></a>`;
  if (a.standard) return card;
  // archive / restore / delete next to the card (not inside the link)
  const acts = a.archived
    ? `<button class="btn sm" data-restore="${esc(a.name)}">Restore</button><button class="btn sm danger" data-delete="${esc(a.name)}">Delete…</button>`
    : `<button class="btn sm ghost card-archive" data-archive="${esc(a.name)}" title="Archive: hide the app from Your apps (nothing is deleted)" aria-label="Archive ${esc(a.title)}">Archive</button>`;
  return `<div class="card-wrap${a.archived ? ' archived' : ''}">${card}<div class="card-acts">${acts}</div></div>`;
}
// archive, restore and delete an app (the home page and the app's ⋯ menu)
async function archiveApp(name, archived = true) {
  try {
    await api('POST', `/studio/api/apps/${name}/archive`, { archived });
    toast(archived ? 'App archived: it is under Archived on the start page' : 'App restored');
    return true;
  } catch (e) { toast(e.message); return false; }
}
async function deleteApp(a) {
  if (!await askDialog({ title: `Delete "${a.title}" for good?`, text: 'Its sources, data and chat are removed and cannot be restored. Other apps that use its tables or views stop working.', ok: 'Delete', danger: true })) return false;
  try { await api('DELETE', `/studio/api/apps/${a.name}`); toast(`"${a.title}" deleted`); return true; } catch (e) { toast(e.message); return false; }
}
// a blank app: name, title and kind; the Code tab opens with the New Object dialog (no AI agent involved)
function blankApp() {
  document.querySelector('.no-ov.blank')?.remove();
  const ov = document.createElement('div');
  ov.className = 'no-ov blank';
  ov.innerHTML = `<div class="no-dlg" role="dialog" aria-modal="true" aria-labelledby="blankT"><div class="no-head"><strong id="blankT">Blank app</strong><span class="spacer"></span><button class="btn sm ghost" data-x aria-label="Close">✕</button></div>
    <form class="no-form no-solo" novalidate>
      <p class="muted">An empty app to build by hand: + New in the Code tab creates tables, structures, data elements, programs, classes, forms… The AI agent stays out of it until you ask it something.</p>
      <label>Title<input id="blTitle" placeholder="e.g. Purchase orders" autocomplete="off" required></label>
      <label>Folder name<input id="blName" class="mono" placeholder="purchase-orders" autocomplete="off" spellcheck="false"></label>
      <fieldset><legend>Kind</legend><label class="no-chk"><input type="radio" name="blKind" value="classic" checked> Classic ABAP (DDIC, reports, function modules, module pools, Adobe forms)</label><label class="no-chk"><input type="radio" name="blKind" value="rap"> RAP (CDS, behavior, services, Fiori apps)</label></fieldset>
      <div class="no-err" hidden role="alert"></div>
      <div class="no-acts"><span class="spacer"></span><button class="btn sm ghost" type="button" data-x>Cancel</button><button class="btn sm primary" type="submit">Create app</button></div>
    </form></div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', key); };
  const key = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  ov.querySelectorAll('[data-x]').forEach(b => { b.onclick = close; });
  const t = $('#blTitle', ov), n = $('#blName', ov);
  const slug = v => v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  t.addEventListener('input', () => { if (!n.dataset.typed) n.value = slug(t.value); });
  n.addEventListener('input', () => { n.dataset.typed = '1'; });
  t.focus();
  $('form', ov).onsubmit = async e => {
    e.preventDefault();
    const err = $('.no-err', ov);
    if (!t.value.trim()) { err.hidden = false; err.textContent = 'Enter a title'; t.focus(); return; }
    const name = slug(n.value || t.value);
    if (!/^[a-z]/.test(name)) { err.hidden = false; err.textContent = 'The folder name must start with a letter'; n.focus(); return; }
    try {
      const r = await api('POST', '/studio/api/apps', { name, title: t.value.trim(), flavor: ov.querySelector('[name="blKind"]:checked').value });
      close();
      S.openNewAfter = true;
      location.hash = `#/app/${r.name}/code`;
    } catch (x) { err.hidden = false; err.textContent = x.message; }
  };
}
async function renderHome() {
  closeApp();
  const { apps } = await api('GET', '/studio/api/apps');
  const mine = apps.filter(a => !a.standard && !a.archived), system = apps.filter(a => a.standard);
  const archived = apps.filter(a => a.archived).sort((a, b) => String(b.archived).localeCompare(String(a.archived)));
  root.innerHTML = `<div class="home">
    <div class="hero">
      <h1>What do you want to build?</h1>
      <p>Describe it in plain words. The AI agent writes the ABAP: RAP business objects with Fiori apps, or classic reports,
      transactions, print forms and jobs. RAP Studio runs it right here, on a real database with SAP's standard data.</p>
      <div class="prompt-box">
        <textarea id="prompt" placeholder="e.g. A library app to manage books and loans… (attach specifications, screenshots or mockups too)" aria-label="Describe your app"></textarea>
        <div class="att-chips" id="promptFiles" hidden></div>
        <div class="row"><button class="btn sm ghost att-btn" id="promptAttach" type="button" title="Attach documents, spreadsheets, PDFs or screenshots (or paste / drop them here)">📎 Attach</button><span class="hint">⌘/Ctrl + Enter · paste or drop files</span><span class="spacer"></span><button class="btn" id="blank" type="button" title="An empty app: create tables, structures, programs, classes and forms yourself with + New in the Code tab (no AI agent)">Blank app</button><button class="btn primary" id="create">Build it →</button></div>
      </div>
      <div id="homeAsk"></div>
      <div class="examples">${EXAMPLES.map(([k, t], i) => `<button data-ex="${i}"><span class="ex-kind ex-${k.toLowerCase()}">${esc(k)}</span>${esc(t)}</button>`).join('')}</div>
      ${system.length ? `<p class="std-callout">Every app can use SAP standard data out of the box: customers, suppliers, products, plants, currencies and more. <a href="#/app/${esc(system[0].name)}/preview">Browse the catalog →</a></p>` : ''}
      <p class="std-callout">New to ABAP, or want to practice? Solve exercises with unit tests, right here. <a href="#/learn">Practice ABAP →</a></p>
    </div>
    ${mine.length ? `<section class="apps">
      <div class="apps-head">
        <h2>Your apps <span class="count">${mine.length}</span></h2>
        <span class="spacer"></span>
        <div class="seg" role="group" aria-label="Show">${[['all', 'All'], ['rap', 'RAP'], ['classic', 'Classic']].map(([v, t]) => `<button data-kind="${v}" aria-pressed="${v === S.homeKind}">${t}</button>`).join('')}</div>
        <input class="input search" id="appSearch" type="search" placeholder="Search apps" aria-label="Search apps" value="${esc(S.homeSearch || '')}">
      </div>
      <div class="app-grid" id="appGrid"></div>
    </section>` : ''}
    <section class="apps" id="chatApps" hidden></section>
    ${system.length ? `<section class="apps"><div class="apps-head"><h2>System</h2></div><div class="app-grid">${system.map(appCard).join('')}</div></section>` : ''}
    ${archived.length ? `<section class="apps"><details class="archived-apps" id="archivedApps"${S.homeArchived ? ' open' : ''}>
      <summary class="apps-head"><h2>Archived <span class="count">${archived.length}</span></h2><span class="hint">Hidden from Your apps. Their tables stay available to the other apps; restore or delete them here.</span></summary>
      <div class="app-grid">${archived.map(appCard).join('')}</div></details></section>` : ''}
  </div>`;
  $('#archivedApps')?.addEventListener('toggle', e => { S.homeArchived = e.target.open; });
  renderChatApps();
  root.querySelector('.home').addEventListener('click', async e => {
    const b = e.target.closest('[data-archive],[data-restore],[data-delete]');
    if (!b) return;
    e.preventDefault();
    b.disabled = true;
    const a = apps.find(x => x.name === (b.dataset.archive || b.dataset.restore || b.dataset.delete));
    const done = b.dataset.delete ? await deleteApp(a) : await archiveApp(a.name, !!b.dataset.archive);
    if (done) renderHome(); else b.disabled = false;
  });
  const grid = () => {
    const q = String(S.homeSearch || '').toLowerCase();
    const list = mine.filter(a => (S.homeKind === 'all' || a.kind === S.homeKind || a.kind === 'both') && (!q || `${a.title} ${a.prompt} ${a.name}`.toLowerCase().includes(q)));
    $('#appGrid').innerHTML = list.length ? list.map(appCard).join('') : '<p class="empty">No app matches.</p>';
  };
  if (mine.length) {
    grid();
    $('#appSearch').addEventListener('input', e => { S.homeSearch = e.target.value; grid(); });
    document.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
      S.homeKind = b.dataset.kind;
      document.querySelectorAll('[data-kind]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      grid();
    }));
  }
  $('#appSwitch').hidden = true; $('#statusPill').hidden = true; $('#moreWrap').hidden = true;
  document.querySelectorAll('[data-ex]').forEach(b => b.addEventListener('click', () => { $('#prompt').value = EXAMPLES[b.dataset.ex][2]; $('#prompt').focus(); }));
  const att = attacher($('.prompt-box'), $('#prompt'), $('#promptFiles'), $('#promptAttach'));
  const create = async () => {
    let prompt = $('#prompt').value.trim();
    if (!prompt && att.count) prompt = 'Build the app described in the attached files.';
    if (!prompt) return $('#prompt').focus();
    $('#create').disabled = true;
    const ui = await askUi(prompt, $('#homeAsk'), true);
    if (ui === null) { $('#create').disabled = false; return; }
    try {
      const attachments = await att.payload();
      const { name } = await api('POST', '/studio/api/apps', { prompt, ui, attachments });
      att.clear();
      location.hash = `#/app/${name}/preview`;
    } catch (e) { toast(e.message); $('#create').disabled = false; }
  };
  $('#create').addEventListener('click', create);
  $('#blank').addEventListener('click', () => blankApp());
  $('#prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) create(); });
  $('#prompt').focus();
}

// ------------------------------------------------------------------ workbench
// draggable separators of the workbench: chat | work, file tree | editor, source | form preview (remembered; arrow
// keys move them, a double click resets)
function splitter(handle, { host, prop, key, def, min, max, cur }) {
  const load = () => { try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; } };
  const save = v => { try { localStorage.setItem(key, String(Math.round(v))); } catch {} };
  const set = w => { const v = Math.max(min, Math.min(Math.max(min, host().clientWidth - max), w)); host().style.setProperty(prop, `${v}px`); return v; };
  const saved = load();
  if (saved) { if (host().clientWidth) set(saved); else host().style.setProperty(prop, `${saved}px`); }
  handle.addEventListener('pointerdown', e => {
    e.preventDefault(); handle.setPointerCapture(e.pointerId); handle.classList.add('dragging'); document.body.classList.add('ex-resizing');
    let last;
    const mv = ev => { last = set(ev.clientX - host().getBoundingClientRect().left); };
    const up = () => { handle.releasePointerCapture(e.pointerId); handle.classList.remove('dragging'); document.body.classList.remove('ex-resizing'); handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', up); if (last) save(last); };
    handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', up);
  });
  const now = () => (cur ? cur() : handle.previousElementSibling?.getBoundingClientRect().width) || def();
  handle.onkeydown = e => { const d = e.key === 'ArrowLeft' ? -24 : e.key === 'ArrowRight' ? 24 : 0; if (d) { e.preventDefault(); save(set(now() + d)); } };
  handle.ondblclick = () => { host().style.removeProperty(prop); try { localStorage.removeItem(key); } catch {} };
}
// the chat can be hidden for more room (wide grids, the screen painter): remembered, also with Ctrl+\\
function chatToggle() {
  const get = () => { try { return localStorage.getItem('rapstudio.chathidden') === '1'; } catch { return false; } };
  const apply = hidden => {
    $('.bench')?.classList.toggle('chat-hidden', hidden);
    const b = $('#chatToggle');
    if (b) { b.setAttribute('aria-pressed', String(hidden)); b.title = hidden ? 'Show the chat (Ctrl+\\)' : 'Hide the chat (Ctrl+\\)'; b.setAttribute('aria-label', hidden ? 'Show the chat' : 'Hide the chat'); }
  };
  const toggle = () => { const h = !$('.bench')?.classList.contains('chat-hidden'); try { localStorage.setItem('rapstudio.chathidden', h ? '1' : '0'); } catch {} apply(h); if (!h) $('#input')?.focus(); };
  apply(get());
  $('#chatToggle').onclick = toggle;
  if (!chatToggle.keys) { chatToggle.keys = true; document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === '\\' && $('.bench')) { e.preventDefault(); toggle(); } }); }
}
function benchResizers() {
  chatToggle();
  splitter($('#splitChat'), { host: () => $('.bench'), prop: '--chat-w', key: 'rapstudio.chatw', def: () => 380, min: 220, max: 420 });
  splitter($('#splitTree'), { host: () => $('.code'), prop: '--tree-w', key: 'rapstudio.treew', def: () => 250, min: 150, max: 360 });
  splitter($('#splitPreview'), { host: () => $('#edArea'), prop: '--ed-w', key: 'rapstudio.edw', def: () => $('#edArea').clientWidth / 2, min: 200, max: 260, cur: () => $('#editor').getBoundingClientRect().width });
}
function closeApp() {
  // a classic debug session ends with the app (the engine runs at full speed again)
  if (S.app && armedKind(S.dbg?.kind) && S.dbg.status !== 'done') api('POST', `/a/${S.app}/api/debug/cmd`, { cmd: 'stop' }).catch(() => {});
  clearInterval(S.dbgTimer); S.dbg = null;
  S.es?.close(); S.es = null; S.connectedOnce = false; clearInterval(S.watch); S.app = null; S.open = null; S.editor?.dispose?.(); S.editor = null; }

async function openApp(app) {
  closeApp();
  S.app = app;
  S.open = null; S.dirty = false; S.previewPath = null; S.previewChosen = false; S.classicPath = null;
  S.classicDiag = []; setTimeout(() => { if (S.app === app) loadClassicDiag(); }, 1500);
  root.innerHTML = `<div class="bench">
    <aside class="chat">
      <div class="msgs" id="msgs"></div>
      <div id="progress" hidden></div>
      <div id="chatAsk"></div>
      <div class="composer">
        <textarea id="input" placeholder="Ask for a change… e.g. add a priority field with a value help" aria-label="Message"></textarea>
        <div class="att-chips" id="inputFiles" hidden></div>
        <div class="row"><button class="btn sm ghost att-btn" id="inputAttach" type="button" title="Attach documents, spreadsheets, PDFs or screenshots (or paste / drop them here)" aria-label="Attach files">📎</button><span class="hint" id="hint">⌘/Ctrl + Enter to send</span><span class="spacer"></span><button class="btn danger" id="stop" hidden>Stop</button><button class="btn primary" id="send">Send</button></div>
      </div>
    </aside>
    <div class="split-v" id="splitChat" role="separator" aria-orientation="vertical" aria-label="Resize the chat" tabindex="0"></div>
    <section class="work">
      <nav class="tabs">
        <button class="chat-toggle" id="chatToggle" type="button" title="Hide the chat (Ctrl+\\)" aria-label="Hide the chat" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg></button>
        <a href="#/app/${app}/preview" data-tab="preview">Preview</a>
        <a href="#/app/${app}/code" data-tab="code">Code</a>
        <a href="#/app/${app}/problems" data-tab="problems">Problems<span class="badge" id="probBadge" hidden></span></a>
        <a href="#/app/${app}/data" data-tab="data">Data</a>
        <a href="#/app/${app}/console" data-tab="console">Console</a>
      </nav>
      <div class="panel" id="p-preview">
        <div class="bar preview-bar"><select class="input" id="uiSel" aria-label="What to preview"></select><span class="url" id="url" title=""></span><button class="btn sm" id="reload" title="Reload the preview">↻ Reload</button><button class="btn sm" id="feBtn" title="Generate a Fiori elements or SAPUI5 app for a service">+ UI app</button></div>
        <div class="bar" id="feForm" hidden>
          <strong>New SAPUI5 app</strong>
          <select class="input" id="feTemplate" aria-label="Template"></select>
          <select class="input" id="feSet" aria-label="Entity set"></select>
          <button class="btn sm primary" id="feGen">Generate</button><button class="btn sm ghost" id="feCancel">Cancel</button>
        </div>
        <iframe id="frame" title="App preview"></iframe>
        <div class="std" id="stdCatalog" hidden></div>
      </div>
      <div class="panel" id="p-code">
        <div class="code">
          <nav class="tree" id="tree"></nav>
          <div class="split-v" id="splitTree" role="separator" aria-orientation="vertical" aria-label="Resize the file tree" tabindex="0"></div>
          <div class="editor-wrap">
            <div class="bar"><span class="fname" id="fname">Select a file</span><span class="seg" id="viewSeg" hidden><button class="on" data-view="form">Form</button><button data-view="source">Source</button></span><span class="spacer"></span><span class="hint" id="saveHint"></span>
              <button class="btn sm" id="cleanUp" hidden title="ABAP cleaner: tidy this ABAP source (SAP's cleanup rules)">Clean up</button>
              <span class="obj-acts" id="objActs" hidden><button class="btn sm" id="checkBtn" title="Check this object (Ctrl+F2)">Check</button><button class="btn sm" id="activateBtn" title="Save and activate this object (Ctrl+F3)">Activate</button></span>
              <button class="btn sm primary" id="save" disabled title="Save (Ctrl+S)">Save</button><button class="btn sm run" id="runBtn" hidden title="Run (F8)">▶ Run</button><button class="btn sm" id="dbgBtn" hidden title="Debug (Shift+F8): stops at the breakpoints (click the margin next to a line number)">Debug</button></div>
            <div class="objout" id="objOut" hidden></div>
            <div class="ed-area" id="edArea"><div id="objView" class="objview" hidden></div>
            <div class="split-v" id="splitPreview" role="separator" aria-orientation="vertical" aria-label="Resize the source and the preview" tabindex="0"></div>
            <div id="editor"></div><div id="docView" class="docview" hidden></div></div>
            <div class="dbg" id="dbgPanel" hidden></div>
          </div>
        </div>
      </div>
      <div class="panel" id="p-problems"><div class="bar"><strong id="probTitle">Problems</strong><span class="spacer"></span><button class="btn sm" id="reactivate">Activate</button><button class="btn sm" id="runChecks" title="Run the code checks (check variant: knowledge/checks/variants/default.md)">Run checks</button><button class="btn sm primary" id="fixAi" hidden>Fix with AI</button></div><div class="scroll"><div id="probList"></div><div id="checkList"></div><div id="dumpList"></div></div></div>
      <div class="panel" id="p-data"><div class="bar"><select class="input" id="tableSel" aria-label="Table"></select><button class="btn sm" id="dataReload">Refresh</button><span class="hint" id="dataCount"></span></div><div class="scroll" id="dataGrid"></div></div>
      <div class="panel" id="p-console"><div class="bar"><select class="input" id="classSel" aria-label="Class"></select><button class="btn sm primary" id="runCls">Run (F9)</button><button class="btn sm" id="dbgCls" title="Run in the debugger: stops at the breakpoints set in the code editor (or at the first statement)">Debug</button><button class="btn sm" id="dbgTests" title="Run the unit tests in the debugger">Debug tests</button><span class="spacer"></span><label class="trace-sw" title="SQL trace: every statement of ABAP SQL with its time, rows and the ABAP method that ran it"><input type="checkbox" id="traceOn"> SQL trace</label></div><div class="scroll"><pre class="out" id="consoleOut">Run a class that implements IF_OO_ADT_CLASSRUN.</pre><div id="traceView" hidden></div></div></div>
    </section>
  </div>`;
  const apps = (await api('GET', '/studio/api/apps')).apps;
  const meta = apps.find(a => a.name === app);
  S.meta = meta;
  $('#appSwitch').hidden = false;
  $('#appName').textContent = meta?.title || app;
  $('#appMenu').innerHTML = apps.filter(a => !a.archived || a.name === app).map(a => `<a href="#/app/${esc(a.name)}">${esc(a.title)}</a>`).join('');
  $('#appBtn').onclick = () => { $('#appMenu').hidden = !$('#appMenu').hidden; };
  document.addEventListener('click', e => { if (!e.target.closest('.app-switch')) $('#appMenu').hidden = true; if (!e.target.closest('.more')) $('#moreMenu').hidden = true; });
  $('#moreWrap').hidden = false;
  $('#openApp').href = `/a/${app}/`;
  $('#download').href = `/studio/api/apps/${app}/download`;
  $('#abapgit').href = `/studio/api/apps/${app}/abapgit`;
  $('#moreBtn').onclick = () => { $('#moreMenu').hidden = !$('#moreMenu').hidden; };
  $('#moreMenu').onclick = () => { $('#moreMenu').hidden = true; };
  // archive / restore / delete the open app (not the SAP standard layer)
  for (const id of ['archiveApp', 'restoreApp', 'deleteApp']) $(`#${id}`).hidden = !!meta?.standard || (id === 'archiveApp' ? !!meta?.archived : !meta?.archived);
  $('#archiveApp').onclick = async () => { if (await archiveApp(app)) location.hash = '#/'; };
  $('#restoreApp').onclick = async () => { if (await archiveApp(app, false)) openApp(app); };
  $('#deleteApp').onclick = async () => { if (await deleteApp(meta)) location.hash = '#/'; };
  $('#statusPill').hidden = false;
  benchResizers();

  S.attach = attacher($('.chat'), $('#input'), $('#inputFiles'), $('#inputAttach'));   // drop files anywhere on the chat
  $('#send').onclick = send;
  $('#input').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); });
  S.readOnly = !!meta?.standard;
  if (meta?.standard) document.querySelector('[data-tab="preview"]').textContent = 'Catalog';
  if (meta?.standard) {   // the SAP standard layer is browsed, not changed
    $('#input').disabled = true; $('#send').disabled = true;
    $('#input').placeholder = 'Read-only: the SAP standard layer is used by every app. Ask for changes in your own app.';
  }
  $('#stop').onclick = () => api('POST', `/studio/api/apps/${app}/chat/stop`);
  $('#reload').onclick = () => reloadPreview(true);
  $('#feBtn').onclick = async () => {
    const d = await api('GET', `/studio/api/apps/${app}/fiori`);
    $('#feTemplate').innerHTML = Object.entries(d.templates).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    $('#feSet').innerHTML = d.services.flatMap(sv => sv.entitySets.map(e => `<option value="${esc(sv.name)}|${esc(e)}">${esc(e)} (${esc(sv.label)})</option>`)).join('');
    $('#feForm').hidden = !d.services.length;
    if (!d.services.length) toast('Define a service first (ask the agent)');
  };
  $('#feCancel').onclick = () => { $('#feForm').hidden = true; };
  $('#feGen').onclick = async () => {
    const [service, entitySet] = $('#feSet').value.split('|');
    try {
      const r = await api('POST', `/studio/api/apps/${app}/fiori`, { template: $('#feTemplate').value, service, entitySet });
      $('#feForm').hidden = true;
      S.previewPath = r.url; S.previewChosen = true;
      await refreshFiles();
      reloadPreview(true);
      toast(`Generated ${r.path}`);
    } catch (e) { toast(e.message); }
  };
  $('#uiSel').onchange = () => {
    S.previewPath = $('#uiSel').value; S.previewChosen = true; S.classicPath = null;
    try { localStorage.setItem(`rapstudio.preview.${S.app}`, S.previewPath); } catch {}
    reloadPreview(true);
  };
  $('#save').onclick = saveFile;
  $('#checkBtn').onclick = checkObject;
  $('#activateBtn').onclick = activateObject;
  $('#runBtn').onclick = runObject;
  $('#viewSeg').onclick = e => { const v = e.target.closest('[data-view]')?.dataset.view; if (v) setView(v); };
  // SAP keys in the code editor: Ctrl+S save, Ctrl+F2 check, Ctrl+F3 activate, F8 run
  window.onkeydown = e => {
    if (!S.open || !location.hash.includes('/code')) return;
    const k = e.key, mod = e.ctrlKey || e.metaKey;
    if (mod && k.toLowerCase() === 's') { e.preventDefault(); saveFile(); }
    else if (mod && k === 'F2') { e.preventDefault(); checkObject(); }
    else if (mod && k === 'F3') { e.preventDefault(); activateObject(); }
    else if (k === 'F8' && !$('#runBtn').hidden) { e.preventDefault(); runObject(); }
  };
  api('GET', `/a/${app}/api/clean`).then(c => { S.cleaner = c.available; }).catch(() => {});
  $('#cleanUp').onclick = async () => {
    if (S.dirty) await saveFile();
    $('#saveHint').textContent = 'Cleaning…';
    const r = await api('POST', `/a/${app}/api/clean`, { file: S.open });
    $('#saveHint').textContent = r.ok ? (r.files.length ? 'Cleaned' : 'Already clean') : 'Not cleaned: the result would not activate';
    if (!r.ok) toast(`ABAP cleaner's result did not activate (${r.errors?.[0]?.message || 'errors'}); the file is unchanged`);
    if (r.files.length) openFile(S.open);
    setTimeout(() => { $('#saveHint').textContent = ''; }, 3000);
  };
  $('#reactivate').onclick = async () => { await api('POST', `/a/${app}/api/activate`); refreshWorkspace(); };
  $('#fixAi').onclick = () => {
    const d = S.ws.diagnostics.errors.slice(0, 30).map(e => `- ${e.file}${e.line ? ':' + e.line : ''} ${e.message}`).join('\n');
    // errors and warnings first, then the infos (suggestions such as modern syntax and dynamic ASSIGN)
    const c = (S.checks?.findings || []).slice(0, 40).map(f => `- ${f.severity} ${f.file}:${f.line} ${f.message} [${f.rule}]`).join('\n');
    sendText(d ? `Activation reports these errors. Fix them and run the check again until there are 0 errors:\n${d}`
      : `The code checks report these findings. Fix them, infos included (rap atc --fix applies the automatic fixes; replace old statements with the modern syntax the finding names; keep dynamic constructs only where they are needed and check them with IS ASSIGNED), then run the checks again:\n${c}`);
  };
  $('#runChecks').onclick = () => runChecks(true);
  $('#tableSel').onchange = loadData; $('#dataReload').onclick = loadData;
  $('#runCls').onclick = runClass;
  $('#dbgCls').onclick = () => { const c = $('#classSel').value; if (c) startDebug('class', c); };
  $('#dbgTests').onclick = () => startDebug('tests');
  $('#dbgBtn').onclick = async () => {
    const t = runTarget(S.open || '');
    if (t?.kind === 'console') return startDebug('class', t.name);
    // a program, transaction or function module: run it in the preview with the breakpoints active (without
    // breakpoints it stops at its first statement)
    if (classicDebuggable(t)) { await startDebug('classic', t.name || t.path, { first: !bpList().length }); runObject(); }
  };
  $('#traceOn').onchange = async e => { await api('POST', `/a/${app}/api/trace`, { on: e.target.checked }); loadTrace(); };
  S.bps = loadBreakpoints(app);
  S.watches = loadWatches(app);

  // live events first, then history (items carry their index, so duplicates are harmless)
  S.items = [];
  connectEvents();
  await syncChat();
  await refreshWorkspace(true);
  // fallback: the server sends a heartbeat every 15 s; a silent or closed stream is reopened and the page catches up
  clearInterval(S.watch);
  S.watch = setInterval(() => {
    if (!S.app || document.hidden) return;
    const silent = Date.now() - (S.lastEvent || 0);
    if (!S.es || S.es.readyState === EventSource.CLOSED || silent > 35000) { connectEvents(); syncChat(); refreshWorkspace(true); return; }
    if (S.running && silent > 6000) { syncChat(); refreshWorkspace(true); }
  }, 5000);
}
// Live events (Server-Sent Events). Browsers allow only ~6 connections per host, so hidden tabs let go of theirs.
function connectEvents() {
  S.es?.close();
  if (!S.app || document.hidden) { S.es = null; return; }
  const es = S.es = new EventSource(`/studio/api/apps/${S.app}/events`);
  S.lastEvent = Date.now();
  es.onmessage = e => { S.lastEvent = Date.now(); onEvent(JSON.parse(e.data)); };
  // the browser gives up on HTTP errors (e.g. while the studio restarts): try again shortly
  es.onerror = () => { if (es.readyState === EventSource.CLOSED && S.es === es) setTimeout(() => { if (S.es === es) { connectEvents(); syncChat(); refreshWorkspace(true); } }, 2000); };
}
document.addEventListener('visibilitychange', () => {
  if (!S.app) return;
  if (document.hidden) { S.es?.close(); S.es = null; return; }
  connectEvents(); syncChat(); refreshWorkspace(true);
});
async function syncChat() {
  if (!S.app) return;
  const app = S.app;
  let hist; try { hist = await api('GET', `/studio/api/apps/${app}/chat`); } catch { return; }
  if (app !== S.app) return;
  hist.items.forEach((it, i) => { S.items[i] = it; });
  S.items.length = hist.items.length;
  setRunning(hist.running);
  renderChat();
}

function setTab(tab) {
  S.tab = tab;
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `p-${tab}`));
  if (tab === 'code' && !S.editor) initEditor();
  if (tab === 'data') loadTables();
  if (tab === 'console') loadClasses();
  if (tab === 'problems') { runChecks(); loadDumps(); loadClassicDiag(); }
  if (tab === 'console') loadTrace();
  if (tab === 'preview' && !$('#frame').src) reloadPreview(true);
}

// ------------------------------------------------------------------ chat
function onEvent(ev) {
  if (ev.type === 'ping') return;
  if (ev.type === 'hello') { if (S.connectedOnce) { syncChat(); refreshWorkspace(true); } S.connectedOnce = true; setRunning(ev.running); return; }
  if (ev.type === 'item') { S.items[ev.id] = ev.item; if (ev.item.role === 'user') S.forceScroll = true; if (ev.item.role === 'run') setRunning(ev.item.status === 'running'); scheduleRender(); return; }
  if (ev.type === 'delta') { const it = S.items[ev.id]; if (it) { it.text += ev.text; scheduleRender(); } return; }
  if (ev.type === 'replace') { const it = S.items[ev.id]; if (it) { it.text = ev.text; scheduleRender(); } return; }
  if (ev.type === 'live') { const it = S.items[ev.id]; if (it) { it.file = ev.file || it.file; it.code = ev.code; scheduleRender(); } return; }
  if (ev.type === 'update') { S.items[ev.id] = ev.item; scheduleRender(); if (ev.item.file && ev.item.status === 'done' && /Write|Edit/.test(ev.item.name)) refreshFiles(); return; }
  if (ev.type === 'end') { const i = S.items.findLastIndex(x => x.role === 'run'); if (i >= 0) S.items[i] = ev.run; setRunning(false); renderChat(); refreshWorkspace(true); return; }
  if (ev.type === 'activation') { refreshWorkspace(true); }
}
function setRunning(r) {
  S.running = r;
  $('#stop') && ($('#stop').hidden = !r);
  $('#send') && ($('#send').disabled = r || !!S.readOnly);
  $('#hint') && ($('#hint').textContent = r ? 'The AI agent is working on your app…' : '⌘/Ctrl + Enter to send');
  updatePill();
  clearInterval(S.timer);
  if (r) S.timer = setInterval(() => { const t = $('#progress .elapsed'); if (t) t.textContent = elapsed(); }, 1000);
  renderProgress();
}
async function send() {
  let t = $('#input').value.trim();
  if (!t && S.attach?.count) t = 'Please look at the attached files.';
  if (!t) return;
  if (S.running) return toast('The AI agent is still working — wait or press Stop');
  const ui = await askUi(t, $('#chatAsk'), false);
  if (ui === null) return;
  let attachments = [];
  try { attachments = await S.attach.payload(); } catch (e) { return toast(`Could not read the files: ${e.message}`); }
  $('#input').value = '';
  S.attach.clear();
  sendText(t, ui, attachments);
}
async function sendText(text, ui, attachments) {
  if (S.running) return toast('The AI agent is still working — wait or press Stop');
  S.forceScroll = true;                                           // a new message always jumps to the latest reply
  try {
    await api('POST', `/studio/api/apps/${S.app}/chat`, { message: text, ui, ...(attachments?.length ? { attachments } : {}) });
    // show the message and the working state right away, even if the live stream is late
    setRunning(true);
    if (!S.es || S.es.readyState !== EventSource.OPEN) connectEvents();
    syncChat();
  } catch (e) { toast(e.message); }
}
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderChat(); });
}
// consecutive look-around steps (reading the reference app, listing folders) collapse into one row
const isExplore = it => it?.role === 'tool' && (/^(Read|LS|Glob|Grep)$/.test(it.name) || (it.name === 'Bash' && /^\s*(ls|cd|cat|head|tail|find|pwd|wc)\b/.test(it.command || it.summary || '')));
function blocksOf(items) {
  const out = [];
  let summary = null;                                                  // a run's result goes after its steps
  const flush = () => { if (summary) out.push(summary); summary = null; };
  items.forEach((it, i) => {
    if (!it) return;
    if (it.role === 'user') flush();
    if (it.role === 'run') { if (it.status !== 'running') summary = { key: `i${i}`, it, i }; return; }  // running: see the progress card
    if (isExplore(it)) return;                                         // reading files/reference material is not shown
    out.push({ key: `i${i}`, it, i });
  });
  flush();
  return out;
}
// an app without chat history: what it holds and what to ask for next
function overviewHtml() {
  const a = S.meta || {};
  const facts = [['service', a.services], ['UI app', a.uiApps], ['program', a.programs], ['transaction', a.transactions], ['form', a.forms],
    ['table', a.tables], ['CDS view', a.views], ['class', a.classes, 'classes']].filter(([, n]) => n).map(([t, n, pl]) => plural(n, t, pl));
  const ideas = a.standard ? [] : [
    ...(a.services ? ['Add a field with a value help to the main entity', a.uiApps ? 'Add a chart and a filter to the list report' : 'Generate an SAP Fiori elements List Report for the service'] : []),
    ...(a.programs ? ['Run every report and show me the output', 'Schedule the main report as a nightly background job'] : []),
    ...(!a.services && !a.programs && a.prompt ? ['Build the app described above'] : []),
    ...(a.classes || a.programs || a.services ? ['Add ABAP Unit tests for the business logic'] : []),
  ].slice(0, 4);
  return `<div class="overview">
    <h2>${esc(a.title || S.app)}</h2>
    ${a.prompt ? `<p class="ov-prompt">${esc(a.prompt)}</p>` : ''}
    ${facts.length ? `<ul class="ov-facts">${facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    <p class="ov-hint">${a.standard ? 'SAP standard objects with seed data, used by every app. Browse them by business area in the Catalog: fields, data and how to use each one.'
      : 'Describe what to build or change. The AI agent edits the sources in this app\'s folder; the preview updates on every change.'}</p>
    ${ideas.length ? `<div class="ov-ideas">${ideas.map(t => `<button data-suggest="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
    ${a.standard ? '' : `<p class="ov-hint">Or build it yourself: <span class="ov-new">${[['table', 'Database table'], ['stru', 'Structure'], ['doma', 'Domain'], ['dtel', 'Data element'], ['report', 'Report'], ['fugr', 'Function module'], ['modulepool', 'Module pool'], ['xdpform', 'Adobe form'], ['class', 'Class']].map(([k, t]) => `<button class="btn sm" data-newobj="${k}">+ ${t}</button>`).join('')}</span></p>`}
  </div>`;
}
function renderChat() {
  const box = $('#msgs');
  if (!box) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const liveIdx = S.items.findLastIndex(x => x?.role === 'tool' && /^(Write|Edit|MultiEdit)$/.test(x.name));
  box.innerHTML = S.items.length ? blocksOf(S.items).map(b => `<div data-block="${b.key}">${b.explore ? exploreHtml(b) : itemHtml(b.it, b.key, b.i === liveIdx)}</div>`).join('')
    : overviewHtml();
  bindItems(box);
  box.querySelectorAll('[data-suggest]').forEach(b => b.addEventListener('click', () => { $('#input').value = b.dataset.suggest; $('#input').focus(); }));
  box.querySelectorAll('[data-newobj]').forEach(b => b.addEventListener('click', () => { location.hash = `#/app/${S.app}/code`; newObj().openNew(b.dataset.newobj); }));
  box.querySelectorAll('pre.live, .think.live .think-t').forEach(p => { p.scrollTop = p.scrollHeight; });
  if (atBottom || S.running || S.forceScroll) box.scrollTop = box.scrollHeight;
  S.forceScroll = false;
  renderProgress();
}
function bindItems(el) {
  el.querySelectorAll('[data-open]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); location.hash = `#/app/${S.app}/code`; openFile(a.dataset.open); }));
  // remember what the user opened or closed (re-rendering with "open" also fires toggle, so listen to clicks)
  el.querySelectorAll('details[data-key] > summary').forEach(sm => sm.addEventListener('click', () => {
    const d = sm.parentElement, open = !d.open;
    (S.openKeys ||= new Set())[open ? 'add' : 'delete'](d.dataset.key);
    (S.closedKeys ||= new Set())[open ? 'delete' : 'add'](d.dataset.key);
  }));
}
function isOpen(key, byDefault) { return S.openKeys?.has(key) || (byDefault && !S.closedKeys?.has(key)); }

// what a source file is, in RAP terms
const OBJ_TYPES = { TABL: 'database table', DDLS: 'CDS view entity', DDLX: 'metadata extension', DCLS: 'access control', BDEF: 'behavior definition', CLAS: 'ABAP class', INTF: 'ABAP interface', SRVD: 'service definition', SRVB: 'service binding', MSAG: 'message class', DATA: 'seed data' };
function objOf(file = '') {
  const kind = kindOf(file);
  const base = file.split('/').at(-1) || file;
  if (/^src\//.test(file) && OBJ_TYPES[kind]) {
    let type = OBJ_TYPES[kind];
    if (kind === 'DDLS' && /^zc_/i.test(base)) type = 'CDS projection view';
    if (kind === 'BDEF' && /^zc_/i.test(base)) type = 'projection behavior';
    if (kind === 'CLAS' && /^zbp_/i.test(base)) type = /locals_imp/.test(base) ? 'behavior implementation' : 'behavior pool';
    return { kind, type, name: base.split('.')[0].toUpperCase() };
  }
  if (kind === 'DATA') return { kind, type: 'seed data', name: base.replace(/\.json$/, '').toUpperCase() };
  if (/^webapp\//.test(file)) return { kind: 'UI5', type: `UI5 ${file.split('/')[1]}`, name: file.split('/').slice(2).join('/') };
  return { kind, type: 'file', name: file };
}
function exploreHtml(b) {
  const running = b.items.some(x => x.status === 'running' || x.status === 'writing');
  const files = b.items.map(x => x.file || x.command || x.summary);
  const ref = b.items.some(x => /examples\//.test(x.file || x.command || x.summary || ''));
  const label = `${running ? 'Studying' : 'Studied'} ${b.items.length} ${b.items.length === 1 ? 'item' : 'items'}${ref ? ' of the reference app' : ''}`;
  return `<div class="step explore ${running ? 'running' : ''}"><span class="ic">${running ? '●' : '◦'}</span><details data-key="${b.key}" ${isOpen(b.key) ? 'open' : ''}><summary>${label}</summary><ul class="explore-list">${files.map(f => `<li>${esc(f)}</li>`).join('')}</ul></details></div>`;
}
function commandLabel(cmd = '') {
  if (/\brap check\b/.test(cmd)) return 'Activating and checking all objects (CDS, BDEF, ABAP with abaplint)';
  if (/\brap fiori\b/.test(cmd)) return `Generating the SAP Fiori elements app${/--template (\w+)/.test(cmd) ? ` (${RegExp.$1})` : ''}`;
  if (/\brap run\b/.test(cmd)) return 'Running a console class';
  if (/\brap deliver\b/.test(cmd)) return 'Writing the deliverables: technical specification, QA test report with screenshots, ATC check report';
  if (/\brap atc\b/.test(cmd)) return 'Running the code checks (ATC)';
  if (/\bcurl\b/.test(cmd)) {
    const m = /-X (\w+)/.exec(cmd); const u = /\/odata\/[^\s'"]*/.exec(cmd)?.[0];
    return `Testing the OData service${u ? `: ${m ? m[1] : 'GET'} ${decodeURIComponent(u.replace(/%24/g, '$')).replace(/^\/odata\//, '').slice(0, 70)}` : ''}`;
  }
  if (/\bmkdir\b/.test(cmd)) return 'Creating folders';
  return cmd;
}
// the delivery documents of a change: technical specification, QA test report, ATC report (Word, PDF)
const DOC_NAMES = { Technical_Specification: 'Technical specification', QA_Test_Report: 'QA test report', ATC_Check_Report: 'ATC check report' };
function deliverablesHtml(it) {
  if (it.status === 'running') return `<div class="deliv running"><span class="spin"></span>Writing the deliverables: technical specification, QA test report with screenshots, ATC check report…</div>`;
  if (it.status === 'error') return `<div class="deliv error"><b>The deliverables could not be written.</b><pre>${esc(it.error || '')}</pre></div>`;
  const base = `/studio/api/apps/${encodeURIComponent(S.app)}/${it.folder}/`;
  const docs = Object.keys(DOC_NAMES).filter(n => it.files?.includes(`${n}.docx`) || it.files?.includes(`${n}.pdf`));
  const a = it.atc?.after || {}, t = it.tests || {};
  const atc = `${a.error || 0} errors · ${a.warning || 0} warnings · ${a.info || 0} infos${it.atc?.fixed ? ` · ${it.atc.fixed} fixed automatically` : ''}`;
  const tests = `${t.passed || 0} of ${t.total || 0} passed${t.failed ? ` · <b class="bad">${t.failed} failed</b>` : ''}${t.screenshots ? ` · ${t.screenshots} screenshots` : ''}`;
  return `<div class="deliv"><div class="deliv-h">📄 Deliverables${it.auto ? ' <span class="hint">written by the studio</span>' : ''}</div>
    <div class="deliv-facts"><span>ATC: ${atc}</span><span>Tests: ${tests}</span></div>
    <ul class="deliv-docs">${docs.map(n => `<li><span class="nm">${DOC_NAMES[n]}</span>${it.files.includes(`${n}.pdf`) ? `<a href="${base}${n}.pdf" target="_blank">PDF</a>` : ''}${it.files.includes(`${n}.docx`) ? `<a href="${base}${n}.docx" download>Word</a>` : ''}</li>`).join('')}</ul>
    <div class="hint">${esc(it.folder)}/</div></div>`;
}
function itemHtml(it, key, isLast) {
  if (!it) return '';
  switch (it.role) {
    case 'user': return `<div class="msg-user">${esc(it.text)}${(it.attachments || []).length ? `<div class="msg-files">${it.attachments.map(a => (a.kind === 'image' ? `<a href="${esc(a.url)}" target="_blank" title="${esc(a.name)}"><img src="${esc(a.url)}" alt="${esc(a.name)}" loading="lazy"></a>` : `<a class="att-chip" href="${esc(a.url)}" target="_blank" title="${esc(a.name)} (${kb(a.size)})"><span class="ic">${fileIcon(a.name)}</span><span class="nm">${esc(a.name)}</span></a>`)).join('')}</div>` : ''}</div>`;
    case 'assistant': return it.text.trim() ? `<div class="msg-ai">${md(it.text)}</div>` : '';
    case 'deliverables': return deliverablesHtml(it);
    case 'thinking': {
      if (!it.text.trim() && it.status !== 'running') return '';
      const live = it.status === 'running';
      const secs = it.ms ? Math.max(1, Math.round(it.ms / 1000)) : 0;
      return `<div class="think ${live ? 'live' : ''}"><details data-key="${key}" ${isOpen(key, live) ? 'open' : ''}><summary>${live ? '<span class="spin"></span>Thinking…' : `Thought for ${secs}s`}</summary><div class="think-t">${esc(live ? it.text.slice(-1500) : it.text)}</div></details></div>`;
    }
    case 'tool': {
      const busy = it.status === 'running' || it.status === 'writing';
      if (/^(Write|Edit|MultiEdit)$/.test(it.name)) {
        const o = objOf(it.file || '');
        const verb = it.name === 'Write' ? (busy ? 'Writing' : 'Created') : (busy ? 'Changing' : 'Changed');
        const lines = it.code ? it.code.split('\n').length : 0;
        const title = it.file ? `${verb} ${esc(o.type)} <a data-open="${esc(it.file)}">${esc(o.name)}</a>` : `${verb} a file…`;
        const live = busy && isLast;
        const code = it.code ? `<pre class="src ${live ? 'live' : ''}">${highlight(live ? it.code.split('\n').slice(-60).join('\n') : it.code.split('\n').slice(0, 400).join('\n'), it.file)}${live ? '<span class="caret-blink">▍</span>' : ''}</pre>` : '';
        return `<div class="obj ${busy ? 'busy' : ''} ${it.status === 'error' ? 'error' : ''}"><details data-key="${key}" ${isOpen(key, live) ? 'open' : ''}><summary><span class="kind k-${o.kind}">${o.kind}</span><span class="t">${title}</span>${lines ? `<span class="n">${it.name === 'Write' ? '' : '+'}${lines} line${lines === 1 ? '' : 's'}</span>` : ''}${busy ? '<span class="spin"></span>' : it.status === 'error' ? '<span class="n err">failed</span>' : ''}</summary>${code}${it.output && it.status === 'error' ? `<pre>${esc(it.output)}</pre>` : ''}</details></div>`;
      }
      if (it.name === 'TodoWrite') return '';                                // shown in the progress card
      const icon = busy ? '●' : it.status === 'error' ? '✕' : ({ Bash: '›' }[it.name] || '•');
      const label = it.name === 'Bash' ? esc(commandLabel(it.command || it.summary)) : esc(it.summary);
      const detail = it.name === 'Bash' ? `<pre>$ ${esc(it.command || it.summary)}${it.output ? '\n' + esc(it.output) : ''}</pre>` : it.output ? `<pre>${esc(it.output)}</pre>` : '';
      const body = detail ? `<details data-key="${key}" ${isOpen(key) ? 'open' : ''}><summary>${label}</summary>${detail}</details>` : `<span>${label}</span>`;
      return `<div class="step ${busy ? 'running' : it.status}"><span class="ic">${icon}</span>${body}</div>`;
    }
    case 'run': {
      const t = it.ms ? `${Math.floor(it.ms / 60000) ? Math.floor(it.ms / 60000) + 'm ' : ''}${Math.round((it.ms % 60000) / 1000)}s` : '';
      return `<div class="run-row">${it.status === 'done' ? '✓ Done' : it.status === 'stopped' ? '■ Stopped' : '✕ Failed'}${t ? ' in ' + t : ''}${it.costUsd ? ` · $${it.costUsd.toFixed(2)}` : ''}${it.turns ? ` · ${it.turns} steps` : ''}</div>`;
    }
    case 'error': return `<div class="err-row">${esc(it.text)}</div>`;
  }
  return '';
}

// light syntax colouring for ABAP, CDS and BDEF in the chat
const KW_ABAP = 'CLASS|ENDCLASS|DEFINITION|IMPLEMENTATION|PUBLIC|PRIVATE|PROTECTED|SECTION|FINAL|ABSTRACT|INHERITING|FROM|FOR|METHODS|METHOD|ENDMETHOD|IMPORTING|EXPORTING|CHANGING|RETURNING|VALUE|RESULT|REQUEST|DATA|TYPES|TYPE|TABLE|OF|REF|TO|CONSTANTS|IF|ELSEIF|ELSE|ENDIF|LOOP|AT|INTO|ENDLOOP|READ|ENTITIES|ENTITY|MODIFY|UPDATE|CREATE|DELETE|EXECUTE|WITH|FIELDS|ALL|IN|LOCAL|MODE|SELECT|SINGLE|WHERE|AND|OR|NOT|IS|INITIAL|APPEND|INSERT|CORRESPONDING|NEW|COND|SWITCH|REDUCE|WHEN|THEN|CASE|ENDCASE|OTHERS|RETURN|CHECK|CLEAR|TRY|CATCH|ENDTRY|RAISE|EXCEPTION|FAILED|REPORTED|MAPPED|LINK|BY|LINES|COMMIT|ROLLBACK|DO|ENDDO|WHILE|ENDWHILE|BEHAVIOR|DEFERRED|ABAP|TRUE|FALSE|UP|ROWS|ORDER|GROUP|INNER|JOIN|LEFT|OUTER|ON|AS|EXIT|CONTINUE|LET|BASE|NEXT|UNTIL|ASSIGNING|FIELD-SYMBOL|DATA';
const KW_CDS = 'define|root|view|entity|table|as|select|from|projection|on|key|association|composition|to|of|parent|redirected|child|provider|contract|transactional_query|annotate|with|service|expose|managed|unmanaged|implementation|in|class|unique|strict|draft|persistent|lock|master|dependent|authorization|instance|global|etag|total|create|update|delete|field|readonly|mandatory|numbering|features|action|determination|validation|modify|save|determine|mapping|for|corresponding|use|side|effects|affects|late|early|internal|static|factory|parameter|result|case|when|then|else|end|cast|and|or|not|null|is|include|abap|virtual|alias|join|inner|left|outer|where|group|by|distinct|having|union|all|extend|metadata|layer|not';
const RE_HL = new RegExp(String.raw`(^\*.*$|"[^\n]*$)|(//[^\n]*|/\*[\s\S]*?\*/)|('(?:[^'\\]|\\.)*'|\`[^\`]*\`|\|(?:[^|\\]|\\.)*\|)|(@[\w.]+)|\b(\d+(?:\.\d+)?)\b|\b(${KW_ABAP})\b|\b(${KW_CDS})\b`, 'gmi');
function highlight(code, file = '') {
  const abap = /\.abap$/.test(file);
  let out = '', last = 0;
  code.replace(RE_HL, (m, abapCmt, cdsCmt, str, anno, num, kwA, kwC, off) => {
    out += esc(code.slice(last, off)); last = off + m.length;
    const cls = abapCmt ? (abap ? 'c' : null) : cdsCmt ? (abap ? null : 'c') : str ? 's' : anno ? (abap ? null : 'a') : num ? 'n' : kwA ? (abap ? 'k' : null) : kwC ? (abap ? null : 'k') : null;
    out += cls ? `<span class="hl-${cls}">${esc(m)}</span>` : esc(m);
    return m;
  });
  return out + esc(code.slice(last));
}

// ------------------------------------------------------------------ build progress (while the agent works)
const PHASES = [
  ['tables', 'Database tables', f => /\.tabl\./.test(f)],
  ['cds', 'CDS data model', f => /\.ddls\./.test(f)],
  ['bdef', 'Behavior definitions', f => /\.bdef\./.test(f)],
  ['abap', 'ABAP behavior logic', f => /\.(clas|intf|msag)\./.test(f)],
  ['ui', 'UI annotations', f => /\.ddlx\./.test(f)],
  ['srv', 'Service', f => /\.srv[db]\./.test(f)],
  ['data', 'Seed data', f => /^data\//.test(f)],
  ['fiori', 'Fiori app', (f, cmd) => /^webapp\//.test(f) || /\brap fiori\b/.test(cmd)],
  ['check', 'Check & test', (f, cmd) => /\brap check\b|\bcurl\b/.test(cmd)],
];
// classic ABAP programs (reports, module pools) instead of a RAP service
const CLASSIC_PHASES = [
  ['tables', 'Database tables', f => /\.tabl\./.test(f)],
  ['data', 'Seed data', f => /^data\//.test(f)],
  ['ddic', 'Data elements & domains', f => /\.(dtel|doma|ttyp)\./.test(f)],
  ['prog', 'Programs & texts', f => /\.(prog|fugr|tran)\./.test(f)],
  ['abap', 'ABAP classes', f => /\.(clas|intf|msag)\./.test(f)],
  ['check', 'Compile & check', (f, cmd) => /\brap (check|gui)\b/.test(cmd)],
];
// print forms (Adobe forms): data provider, layout, output class
const FORM_PHASES = [
  ['tables', 'Database tables', f => /\.tabl\./.test(f)],
  ['data', 'Seed data', f => /^data\//.test(f)],
  ['cds', 'CDS data model', f => /\.ddls\./.test(f)],
  ['srv', 'Form data provider', f => /\.srvd\./.test(f)],
  ['layout', 'Form layouts', (f, cmd) => /\.form\.json$/.test(f) || /\.(png|jpe?g|ttf)$/i.test(f) || /\brap form import\b/.test(cmd)],
  ['abap', 'ABAP output', f => /\.(clas|intf|prog|fugr)\./.test(f)],
  ['check', 'Check & render', (f, cmd) => /\brap (check|form|forms|run)\b/.test(cmd)],
];
function elapsed() {
  const run = S.items.findLast(x => x?.role === 'run');
  if (!run?.at) return '';
  const s = Math.max(0, Math.round((Date.now() - new Date(run.at)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function renderProgress() {
  const el = $('#progress');
  if (!el) return;
  if (!S.running) { el.hidden = true; el.innerHTML = ''; return; }
  const from = S.items.findLastIndex(x => x?.role === 'run');
  const steps = S.items.slice(from + 1).filter(x => x?.role === 'tool');
  const request = S.items.slice(0, from + 1).findLast(x => x?.role === 'user')?.text || '';
  const classic = request.includes('UI: classic ABAP programs'), forms = request.includes('Output: print form');
  const phase = (forms ? FORM_PHASES : classic ? CLASSIC_PHASES : PHASES).map(([id, label, test]) => ({ id, label, test, objs: [], seen: false }));
  let current = null;
  for (const t of steps) {
    const f = t.file || '', cmd = t.command || '';
    if (f ? !/Write|Edit/.test(t.name) : !cmd) continue;              // reading files is not progress
    const p = phase.find(p => p.test(f, cmd));
    if (!p) continue;
    p.seen = true;
    if (f && /Write|Edit/.test(t.name)) { const o = objOf(f); if (!p.objs.includes(o.name)) p.objs.push(o.name); }
    current = p;
  }
  const last = steps.at(-1);
  const busy = last && (last.status === 'writing' || last.status === 'running');
  let now;
  if (busy && /Write|Edit/.test(last.name)) { const o = objOf(last.file || ''); now = last.file ? `${last.name === 'Write' ? 'Writing' : 'Changing'} ${o.type} <b>${esc(o.name)}</b>` : 'Writing…'; }
  else if (busy && last.name === 'Bash') now = esc(commandLabel(last.command || last.summary));
  else if (busy && isExplore(last)) now = 'Preparing the next step';
  else if (S.items.at(-1)?.role === 'thinking' && S.items.at(-1).status === 'running') now = 'Thinking…';
  else now = steps.length ? 'Thinking about the next step' : forms ? 'Planning the data and the form layout' : classic ? 'Planning the tables and programs' : 'Planning the data model and behavior';
  const todos = S.items.slice(from + 1).findLast(x => x?.role === 'tool' && x.name === 'TodoWrite')?.summary?.replace(/^Plan: /, '').split(' · ') || [];
  el.hidden = false;
  el.innerHTML = `<div class="prog">
    <div class="prog-h"><span class="spin"></span><span class="now">${now}</span><span class="elapsed">${elapsed()}</span></div>
    <ol class="phases">${phase.map(p => `<li class="${p === current ? 'active' : p.seen ? 'done' : ''}" title="${esc(p.objs.join(', '))}"><span class="dot"></span><span class="pl">${p.label}</span>${p.objs.length ? `<span class="po">${esc(p.objs.slice(0, 3).join(', '))}${p.objs.length > 3 ? ` +${p.objs.length - 3}` : ''}</span>` : ''}</li>`).join('')}</ol>
    ${todos.length ? `<details class="todos" data-key="todos" ${isOpen('todos') ? 'open' : ''}><summary>Plan · ${todos.filter(t => t.startsWith('✓')).length}/${todos.length} done</summary><ul>${todos.map(t => `<li class="${t.startsWith('✓') ? 'done' : t.startsWith('▸') ? 'active' : ''}">${esc(t.slice(2))}</li>`).join('')}</ul></details>` : ''}
  </div>`;
  bindItems(el);
}

// ------------------------------------------------------------------ UI choice
// When a request does not say which UI to build, ask: SAP Fiori elements (and which template), freestyle SAPUI5 or
// classic ABAP programs. Requests for a report, module pool or transaction mean classic ABAP without asking.
const FE_TEMPLATES = [
  ['lrop', 'List Report & Object Page', 'Search, filter and edit records with draft'],
  ['worklist', 'Worklist', 'A simple list of items to process'],
  ['alp', 'Analytical List Page', 'Chart and table to analyse data'],
  ['ovp', 'Overview Page', 'Cards with charts and lists on one page'],
  ['fpm', 'Custom page (Flexible Programming Model)', 'Your own layout with Fiori building blocks'],
];
const RE_TEMPLATE = { lrop: /list report|object page|\blrop\b/i, worklist: /worklist/i, alp: /analytical list|\balp\b/i, ovp: /overview page|\bovp\b/i, fpm: /flexible programming|\bfpm\b|building blocks/i };
const RE_FE = /fiori elements|\bfe app\b/i;
const RE_FREE = /free[\s-]?style|custom (sapui5|ui5|ui)\b|\b(sapui5|ui5) (app|application|ui)\b/i;
// classic programs: reports, selection screens, lists/ALV, module pools and dynpro transactions, function modules,
// print forms, background jobs, application logs, lock objects
const RE_CLASSIC = /\b(report|reports|selection screen|alv|module pool|dynpro|transaction code|t-?code|function module|function group|se38|se16|sm36|sm37|slg1|classic abap|background jobs?|batch jobs?|application logs?|lock objects?)\b/i;
// print forms (SAP Adobe forms): the data provider, the layout and the output in ABAP
const RE_FORMS = /\b(print forms?|adobe forms?|adobe|interactive forms?|smart ?forms?|sapscript|pdf forms?|pdf (invoices?|documents?|output)|invoice pdf|form layouts?|xdp|output forms?)\b/i;
const RE_NEW_UI = /\b(add|create|build|generate|make)\s+(a|an|another|one more)?\s*(new\s+)?(ui|user interface|frontend|front-end|screen|fiori app|fiori ui|app ui)\b/i;
async function askUi(text, host, isNewApp) {
  const tpl = Object.keys(RE_TEMPLATE).find(k => RE_TEMPLATE[k].test(text));
  if (tpl) return { kind: 'fiori', template: tpl };
  if (RE_FREE.test(text)) return { kind: 'freestyle' };
  const fe = RE_FE.test(text);
  if (!fe && !isNewApp && RE_FORMS.test(text) && /\b(add|create|build|make|design|generate|need|want)\b/i.test(text)) return { kind: 'forms' };
  if (!fe && !isNewApp && !RE_NEW_UI.test(text)) return undefined;   // an ordinary change request (or "run the report …")
  if (!fe && RE_FORMS.test(text)) return { kind: 'forms' };
  if (!fe && RE_CLASSIC.test(text)) return { kind: 'classic' };
  let kind = fe ? 'fiori' : await choose(host, 'Which kind of UI do you want?', [
    ['fiori', 'SAP Fiori elements', 'Generated from annotations: standard floorplans, draft, value helps'],
    ['freestyle', 'Freestyle SAPUI5', 'A custom UI5 app (XML views and controllers)'],
    ['classic', 'Classic ABAP', 'Reports with selection screens and ALV lists, module pools'],
  ]);
  if (kind === null) return null;
  if (kind === 'freestyle' || kind === 'classic') return { kind };
  const template = await choose(host, 'Which SAP Fiori elements template?', FE_TEMPLATES);
  return template === null ? null : { kind, template };
}
function choose(host, question, options) {
  return new Promise(resolve => {
    host.innerHTML = `<div class="ask" role="group" aria-label="${esc(question)}"><div class="ask-q">${esc(question)}</div><div class="ask-opts">${options.map(([v, t, d]) => `<button type="button" class="ask-opt" data-v="${esc(v)}"><strong>${esc(t)}</strong><span>${esc(d)}</span></button>`).join('')}</div><button type="button" class="btn sm ghost" data-v="">Cancel</button></div>`;
    host.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => { host.innerHTML = ''; resolve(b.dataset.v || null); }));
    host.querySelector('.ask-opt')?.focus();
  });
}

// tiny markdown renderer (headings, lists, code, bold, inline code, tables, links)
// ------------------------------------------------------------------ workspace status, preview
let lastVersion = 0;
async function refreshWorkspace(reloadUi) {
  if (!S.app) return;
  try { S.ws = await api('GET', `/a/${S.app}/api/workspace`); } catch { return; }
  const d = S.ws.diagnostics;
  $('#probBadge').hidden = !d.errors.length; $('#probBadge').textContent = d.errors.length;
  $('#fixAi').hidden = !(d.errors.length || S.checks?.summary.error || S.checks?.summary.warning || S.checks?.summary.info);
  if (S.tab === 'problems') runChecks();
  updatePill();
  renderProblems();
  await refreshFiles();
  // not while a debugged run is under way: a reload would drop the request the debugger holds (its result is lost)
  const debugging = S.dbg && ['paused', 'running'].includes(S.dbg.status);
  if (reloadUi && S.ws.version !== lastVersion && !debugging) { lastVersion = S.ws.version; reloadPreview(); }
  if (S.tab === 'data') loadTables(true);
  if (S.tab === 'console') loadClasses();
}
function updatePill() {
  const p = $('#statusPill');
  if (!p || !S.ws) return;
  const e = S.ws.diagnostics.errors.length;
  p.className = 'pill ' + (S.running ? 'busy' : e ? 'err' : 'ok');
  p.textContent = S.running ? '● Building…' : e ? `${e} error(s)` : `Active · v${S.ws.activation ?? S.ws.version}`;
}
function reloadPreview(force) {
  if (S.meta?.standard) return showStandard();
  // the app's real SAPUI5 apps first (Fiori elements or freestyle components), then the built-in data browser
  const ui5 = S.files.filter(f => /^webapp\/[^/]+\/index\.html$/.test(f)).map(f => f.split('/')[1])
    .map(n => ({ v: `apps/${n}/`, t: n, g: S.files.some(f => f.startsWith(`webapp/${n}/view/`)) ? 'SAPUI5 apps (freestyle)' : 'SAP Fiori elements apps' }));
  // reports, module pools and function groups run on the classic ABAP engine (its own server per app)
  const classic = S.files.some(f => /\.(prog\.abap|fugr\.|form\.json)/i.test(f)) ? [{ v: '@classic', t: 'Classic ABAP programs', g: 'Classic ABAP' }] : [];
  // every service is also served as OData V2: a SAPUI5 V2-model test page
  const v2 = S.files.some(f => /\.srvd\./i.test(f)) ? [{ v: 'sap/opu/odata/', t: 'OData V2 services (SAPUI5 test)', g: 'Services' }] : [];
  const uis = [...ui5, ...classic, ...v2, { v: '', t: 'Data browser (all entities)', g: 'Services' }];
  if (!S.previewChosen) {                                        // not chosen in this session: last choice for this app, else its first UI5 app or its programs
    let saved = null; try { saved = localStorage.getItem(`rapstudio.preview.${S.app}`); } catch {}
    const next = uis.some(u => u.v === saved) ? saved : (ui5[0]?.v ?? classic[0]?.v ?? '');
    if (next !== S.previewPath) { S.previewPath = next; force = true; }
  }
  // grouped: Fiori elements apps, SAPUI5 apps, Classic ABAP, Services
  const groups = [...new Set(uis.map(u => u.g))];
  $('#uiSel').innerHTML = groups.map(g => `<optgroup label="${esc(g)}">${uis.filter(u => u.g === g).map(u => `<option value="${esc(u.v)}" ${u.v === S.previewPath ? 'selected' : ''}>${esc(u.t)}</option>`).join('')}</optgroup>`).join('');
  $('#uiSel').hidden = uis.length < 2;
  const frame = $('#frame');
  if (S.previewPath === '@classic') return showClassic(frame, force);
  const base = `/a/${S.app}/${S.previewPath}`;
  $('#url').textContent = location.origin + base;
  if (!force && frame.src && frame.contentWindow) {
    // keep the user's current page inside the app, just reload it
    try { armRapDebugger(); frame.contentWindow.location.reload(); return; } catch {}
  }
  frame.src = base + `?v=${Date.now()}`;
  armRapDebugger();
}

// classic programs: build and start the engine of this app, then show its launcher (keeps the current page on reload)
async function showClassic(frame, force) {
  $('#url').textContent = 'Starting the classic ABAP engine…';
  let st;                                                       // builds again first when a program changed
  try { st = await api('POST', `/a/${S.app}/api/classic`); } catch (e) { $('#url').textContent = e.message; return; }
  if (S.previewPath !== '@classic') return;
  if (st.state !== 'running') {
    $('#url').textContent = st.state === 'unavailable' ? 'Classic engine not installed: npm run setup:open-abap' : 'The classic programs did not build: see Problems';
    toast($('#url').textContent);   // the address field is hidden in narrow panes
    frame.srcdoc = `<body style="font:14px system-ui;padding:24px;color:#5d6b7a">${esc((st.diagnostics || []).map(d => `${d.file}${d.line ? ':' + d.line : ''} ${d.message}`).join('\n') || st.state)}</body>`;
    return;
  }
  $('#url').textContent = st.url;
  frame.removeAttribute('srcdoc');
  if (!force && S.classicUrl === st.url && frame.src.startsWith(st.url)) {
    armClassicDebugger();
    // the user works in the preview (typing on a test page …): no reload under their hands
    if (document.activeElement === frame) return;
    // the page the preview shows now (the engine's pages report it), not the object F8 started earlier
    if (S.classicCurrent) { frame.src = st.url + S.classicCurrent.replace(/^\//, ''); return; }
    if (!S.classicPath) { try { frame.contentWindow.location.reload(); return; } catch {} }
  }
  S.classicUrl = st.url;
  S.classicCurrent = null;
  armClassicDebugger();
  frame.src = st.url + (S.classicPath || '');   // the object F8 started (until another preview is chosen)
}

// ------------------------------------------------------------------ code
async function refreshFiles() {
  try { S.files = (await api('GET', `/studio/api/apps/${S.app}/files`)).files; } catch { return; }
  const tree = $('#tree');
  if (!tree) return;
  const head = S.readOnly ? '' : '<div class="tree-head"><button class="btn sm" id="newObj" title="Create an object by hand">+ New</button><button class="btn sm" id="genBo" title="Generate a RAP business object from a table">RAP BO from table</button></div>';
  tree.innerHTML = head + (S.files.length ? treeHtml(buildTree(S.files), '') : '<div class="empty-state">No files yet</div>');
  const no = newObj();
  if ($('#newObj')) { $('#newObj').onclick = () => no.openNew(); $('#genBo').onclick = () => no.openRapBo(); }
  tree.oncontextmenu = e => {
    if (S.readOnly) return;
    const a = e.target.closest('[data-f]'), d = e.target.closest('[data-dir]');
    if (!a && !d) return;
    no.contextMenu(e, { file: a?.dataset.f, dir: d ? d.textContent.replace(/\d+\s*$/, '').trim() : (a ? a.closest('.tdir, li, details')?.querySelector('[data-dir]')?.textContent.replace(/\d+\s*$/, '').trim() : null),
      dirPath: d?.dataset.dir, onOpen: f => openFile(f), onDelete: deleteObject, onRename: renameFile });
  };
  tree.querySelectorAll('[data-f]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); openFile(a.dataset.f); }));
  tree.querySelectorAll('[data-dir]').forEach(d => d.addEventListener('click', () => {
    const c = collapsed(); const k = d.dataset.dir;
    c.has(k) ? c.delete(k) : c.add(k);
    try { localStorage.setItem(`rapstudio.tree.${S.app}`, JSON.stringify([...c])); } catch {}
    d.parentElement.classList.toggle('closed', c.has(k));
    d.setAttribute('aria-expanded', String(!c.has(k)));
  }));
  if (S.open && !S.dirty && S.files.includes(S.open) && !isDoc(S.open)) reloadOpenFile();
}
// creating, deleting and renaming objects by hand (newobj.js)
function newObj() {
  return (S.newObj ||= mountNewObject({ app: () => S.app, api, toast, done: async r => {
    S.ws = r.summary || S.ws;
    if (r.appUrl) { S.previewPath = r.appUrl; S.previewChosen = true; try { localStorage.setItem(`rapstudio.preview.${S.app}`, r.appUrl); } catch {} }
    await refreshWorkspace();
    // the preview shows what was generated (the new Fiori app, the new service)
    reloadPreview(true);
    // a new object opens in its Design view when it has one (its form), else in the source
    if (r.open) { S.openDesign = true; await openFile(r.open); S.openDesign = false; }
    const errs = (r.errors || []).map(e => ({ ...e, severity: 'error' }));
    showObjOut(errs, errs.length ? null : `✓ ${r.files.length} object file(s) created and activated${r.app ? ` · Fiori app ${r.app.replace(/^webapp\//, '')} (Preview tab)` : ''}${r.notes?.length ? ` — ${r.notes.join(' ')}` : ''}`);
  } }));
}
async function deleteObject(f) {
  const parts = objectParts(S.files, f);
  if (!await askDialog({ title: `Delete ${objName(f).toUpperCase()}?`, text: `${parts.map(p => p.replace(/^src\//, '')).join(', ')}\n\nObjects that use it stop working until you change them.`, ok: 'Delete', danger: true })) return;
  for (const p of parts) await api('DELETE', `/a/${S.app}/api/source/${encodeURIComponent(p)}`);
  if (parts.includes(S.open)) { S.open = null; S.dirty = false; $('#fname').textContent = 'Select a file'; setEditorText('', 'plaintext', true); }
  S.ws = await api('POST', `/a/${S.app}/api/activate`);
  await refreshWorkspace();
  toast(`Deleted ${parts.length} file(s)`);
}
async function renameFile(f) {
  const to = await askDialog({ title: 'Rename', ok: 'Rename', input: { label: 'New name (path)', value: f, validate: v => (!v ? 'Enter a path' : /\.\.|^\//.test(v) ? 'A path inside the app' : (S.files || []).includes(v) && v !== f ? `${v} exists already` : null) } });
  if (!to || to === f) return;
  const text = await (await fetch(`/a/${S.app}/api/source/${encodeURIComponent(f)}`)).text();
  await api('PUT', `/a/${S.app}/api/source/${encodeURIComponent(to)}`, text, true);
  await api('DELETE', `/a/${S.app}/api/source/${encodeURIComponent(f)}`);
  await refreshWorkspace();
  if (S.open === f) openFile(to);
}
// ADT-style grouping of the abapGit sources; everything else keeps its folder structure
const KINDS = [
  [/\.tabl\./, 'TABL', ['Dictionary', 'Database Tables']],
  [/\.ddls\./, 'DDLS', ['Core Data Services', 'Data Definitions']],
  [/\.ddlx\./, 'DDLX', ['Core Data Services', 'Metadata Extensions']],
  [/\.dcls\./, 'DCLS', ['Core Data Services', 'Access Controls']],
  [/\.bdef\./, 'BDEF', ['Core Data Services', 'Behavior Definitions']],
  [/\.clas\./, 'CLAS', ['Source Code Library', 'Classes']],
  [/\.intf\./, 'INTF', ['Source Code Library', 'Interfaces']],
  [/\.srvd\./, 'SRVD', ['Business Services', 'Service Definitions']],
  [/\.srvb\./, 'SRVB', ['Business Services', 'Service Bindings']],
  [/\.msag\./, 'MSAG', ['Texts', 'Message Classes']],
  [/\.prog\./, 'PROG', ['Programs', 'Reports and Module Pools']],
  [/\.fugr\./, 'FUGR', ['Programs', 'Function Groups']],
  [/\.dtel\./, 'DTEL', ['Dictionary', 'Data Elements']],
  [/\.doma\./, 'DOMA', ['Dictionary', 'Domains']],
  [/\.ttyp\./, 'TTYP', ['Dictionary', 'Table Types']],
  [/\.xslt\./, 'XSLT', ['Source Code Library', 'Transformations']],
  [/\.tran\./, 'TRAN', ['Programs', 'Transactions']],
  [/\.enqu\./, 'ENQU', ['Dictionary', 'Lock Objects']],
  [/\.form\./, 'FORM', ['Form Objects', 'Print Forms']],
  [/\.xdp$/, 'XDP', ['Form Objects', 'Print Forms']],
  [/\.sfpi\./, 'SFPI', ['Form Objects', 'Form Interfaces']],
  [/\.sajc\./, 'SAJC', ['Application Jobs', 'Job Catalog Entries']],
  [/\.sajt\./, 'SAJT', ['Application Jobs', 'Job Templates']],
];
function kindOf(f) {
  if (/\.fugr\.(?!xml$)(?!sapl)(?!l\w+(top|uxx)\.abap$)[\w$#]+\.abap$/i.test(f)) return 'FUNC';
  const k = KINDS.find(([re]) => re.test(f));
  if (k) return k[1];
  if (/^data\//.test(f)) return 'DATA';
  if (/\.xml$/.test(f)) return 'XML';
  if (/\.(js|mjs)$/.test(f)) return 'JS';
  if (/\.json$/.test(f)) return 'JSON';
  if (/\.html$/.test(f)) return 'HTML';
  if (/\.md$/.test(f)) return 'MD';
  if (/\.pdf$/.test(f)) return 'PDF';
  if (/\.docx$/.test(f)) return 'DOC';
  if (/\.properties$/.test(f)) return 'I18N';
  return 'FILE';
}
function buildTree(files) {
  const root = { dirs: new Map(), files: [] };
  const add = (path, f, label) => {
    let n = root;
    for (const d of path) { if (!n.dirs.has(d)) n.dirs.set(d, { dirs: new Map(), files: [] }); n = n.dirs.get(d); }
    n.files.push({ f, label });
  };
  for (const f of files) {
    const parts = f.split('/');
    if (parts.length === 1) { add(['Project files'], f, f); continue; }
    const k = parts[0] === 'src' && KINDS.find(([re]) => re.test(f));
    if (k) {
      const name = parts.at(-1);
      // a class and its includes (locals_imp, locals_def, testclasses) form one folder
      if (k[1] === 'CLAS') { const cls = name.split('.')[0]; add(['src', ...k[2], cls], f, name.split('.').slice(1, -1).join('.').replace(/^clas\.?/, '') || 'global class'); continue; }
      // a function group holds its function modules; a program its source, attributes and screens
      if (k[1] === 'FUGR') { const [grp, fm] = name.split('.fugr.'); add(['src', ...k[2], grp], f, fm === 'xml' ? 'group attributes' : fm.replace(/\.abap$/, '')); continue; }
      if (k[1] === 'PROG') { const [prog, part] = name.split('.prog.'); add(['src', ...k[2], prog], f, part === 'abap' ? 'source code' : part === 'xml' ? 'attributes, screens, GUI status' : part.replace(/^screen_(\d+)\.abap$/, 'screen $1 flow logic')); continue; }
      // a form object and its Adobe layout: one folder per form
      if (k[1] === 'XDP' || k[1] === 'FORM') {
        const form = name.split('.')[0];
        const both = files.includes(`src/${form}.form.json`) && files.includes(`src/${form}.xdp`);
        // one entry per Adobe form: its layout (the designer links the form object and the interface)
        if (both) { if (k[1] === 'XDP') add(['src', ...k[2]], f, form); continue; }
        if (k[1] === 'XDP') { add(['src', ...k[2]], f, `${form} · Adobe layout`); continue; }
      }
      // DDIC structures are .tabl sources too
      if (k[1] === 'TABL' && (S.ws?.objects?.structures || []).some(x => x.name.toLowerCase() === name.split('.')[0])) { add(['src', 'Dictionary', 'Structures'], f, name.split('.')[0]); continue; }
      add(['src', ...k[2]], f, name.replace(/\.(tabl|ddls|ddlx|dcls|bdef|intf|srvd|srvb|msag|dtel|doma|ttyp|tran|enqu|form|xslt|shlp|sajc|sajt|sfpi)\..*$/, ''));
      continue;
    }
    // the delivery documents: docs/<date>-<topic>/Technical_Specification.pdf -> "Technical Specification · PDF"
    if (parts[0] === 'docs') { add(parts.slice(0, -1), f, docLabel(parts.at(-1))); continue; }
    add(parts.slice(0, -1), f, parts.at(-1));
  }
  return root;
}
function collapsed() {
  if (S.collapsedApp !== S.app) {
    S.collapsedApp = S.app;
    try { S.collapsed = new Set(JSON.parse(localStorage.getItem(`rapstudio.tree.${S.app}`) || '[]')); } catch { S.collapsed = new Set(); }
  }
  return S.collapsed;
}
function count(n) { let c = n.files.length; for (const d of n.dirs.values()) c += count(d); return c; }
function treeHtml(n, path, depth = 0) {
  const c = collapsed();
  const order = ['src', 'webapp', 'data', 'docs'];
  const dirs = [...n.dirs.entries()].sort(([a], [b]) => depth ? 0 : ((order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9)));
  const files = [...n.files].sort((a, b) => a.label.localeCompare(b.label));
  const pad = d => `style="padding-left:${8 + d * 14}px"`;
  return dirs.map(([name, d]) => {
    const k = `${path}/${name}`;
    const closed = c.has(k);
    return `<div class="dir${closed ? ' closed' : ''}"><button type="button" class="dir-h" data-dir="${esc(k)}" aria-expanded="${!closed}" ${pad(depth)}><span class="caret">▾</span><span class="folder">${esc(name)}</span><span class="cnt">${count(d)}</span></button><div class="dir-c">${treeHtml(d, k, depth + 1)}</div></div>`;
  }).join('') + files.map(({ f, label }) => `<a href="#" data-f="${esc(f)}" class="${f === S.open ? 'active' : ''}" title="${esc(f)}" ${pad(depth)}><span class="kind">${kindOf(f)}</span>${esc(label)}</a>`).join('');
}
function langOf(f) {
  if (/\.abap$/.test(f)) return 'abap';
  if (/\.(asddls|asddlxs|srvdsrv|cds|asbdef)$/.test(f)) return 'cds';
  if (/\.json$/.test(f)) return 'json';
  if (/\.(xml|xdp|xsd)$/.test(f)) return 'xml';
  if (/\.js$/.test(f)) return 'javascript';
  if (/\.html$/.test(f)) return 'html';
  if (/\.md$/.test(f)) return 'markdown';
  if (/\.css$/.test(f)) return 'css';
  return 'plaintext';
}
const isDoc = f => /^docs\/.+\.(pdf|docx)$/.test(f || '');
const docLabel = n => `${n.replace(/\.(pdf|docx)$/, '').replace(/_/g, ' ')} · ${/\.pdf$/.test(n) ? 'PDF' : 'Word'}`;
// a document of the docs folder: a PDF is shown in the editor area, a Word file can be downloaded
function openDoc(f) {
  S.open = f; S.dirty = false;
  const url = `/studio/api/apps/${encodeURIComponent(S.app)}/${f.split('/').map(encodeURIComponent).join('/')}`;
  const pdf = f.replace(/\.docx$/, '.pdf'), hasPdf = S.files.includes(pdf);
  $('#fname').textContent = f; $('#fname').classList.remove('dirty'); $('#save').disabled = true;
  for (const id of ['cleanUp', 'objActs', 'objOut', 'runBtn', 'dbgBtn', 'viewSeg', 'objView', 'editor', 'splitPreview', 'save']) $(`#${id}`).hidden = true;
  $('#edArea').classList.remove('split', 'designing');
  if (S.designer) { S.designer.destroy(); S.designer = null; }
  const v = $('#docView');
  v.hidden = false;
  v.innerHTML = /\.pdf$/.test(f)
    ? `<div class="doc-bar"><span>${esc(docLabel(f.split('/').pop()))}</span><span class="spacer"></span><a class="btn sm" href="${url}" target="_blank">Open in a new tab ↗</a>${S.files.includes(f.replace(/\.pdf$/, '.docx')) ? `<a class="btn sm" href="${url.replace(/\.pdf$/, '.docx')}" download>Download Word</a>` : ''}</div><iframe class="doc-frame" src="${url}" title="${esc(f)}"></iframe>`
    : `<div class="doc-card"><div class="doc-ic">📄</div><h3>${esc(docLabel(f.split('/').pop()))}</h3><p>Word document of the delivery (${esc(f.split('/')[1])}).</p><div class="doc-acts"><a class="btn primary" href="${url}" download>Download Word</a>${hasPdf ? `<a class="btn" href="#" data-open-doc="${esc(pdf)}">Show the PDF</a>` : ''}</div></div>`;
  v.querySelector('[data-open-doc]')?.addEventListener('click', e => { e.preventDefault(); openFile(e.target.dataset.openDoc); });
  document.querySelectorAll('#tree a').forEach(a => a.classList.toggle('active', a.dataset.f === f));
}
async function openFile(f, line) {
  if (S.dirty && S.open && f !== S.open && !await askDialog({ title: 'Discard changes?', text: `${S.open} has unsaved changes.`, ok: 'Discard', danger: true })) return;
  if (isDoc(f)) return openDoc(f);
  $('#docView').hidden = true; $('#docView').innerHTML = ''; $('#splitPreview').hidden = false; $('#save').hidden = false;
  S.open = f; S.dirty = false;
  if (!S.editor) await initEditor();
  const text = await (await fetch(`/a/${S.app}/api/source/${encodeURIComponent(f)}`)).text();
  setEditorText(text, langOf(f));
  $('#fname').textContent = f; $('#fname').classList.remove('dirty'); $('#save').disabled = true;
  $('#cleanUp').hidden = !(S.cleaner && /\.abap$/i.test(f) && !S.readOnly);
  $('#objActs').hidden = S.readOnly || !/^src\//.test(f);
  $('#objOut').hidden = true;
  const run = runTarget(f);
  $('#runBtn').hidden = !run; if (run) $('#runBtn').title = `${run.label} (F8)`;
  $('#dbgBtn').hidden = !(run?.kind === 'console' || classicDebuggable(run));
  S.text = text;
  $('#viewSeg').hidden = !hasFormView(f);
  $('#viewSeg').innerHTML = visualKind(f) ? `<button data-view="design">Design</button>${/\.xml$/.test(f) ? '<button data-view="form">Form</button>' : ''}<button data-view="source">Source</button>` : isFormLayout(f) ? '<button data-view="design">Design</button><button data-view="form">Preview</button><button data-view="source">Source</button>' : isXdp(f) ? '<button data-view="design">Design</button><button data-view="form">Preview</button><button data-view="source">Source</button>' : '<button data-view="form">Form</button><button data-view="source">Source</button>';
  S.formKeys = null;
  setView(hasFormView(f) ? (S.openDesign && (visualKind(f) || isXdp(f)) ? 'design' : isFormLayout(f) || isXdp(f) ? S.formViewPref || 'design' : visualKind(f) && !/\.xml$/.test(f) ? S.visualViewPref || 'source' : visualKind(f) ? S.xmlDesignPref || 'design' : S.viewPref || 'form') : 'source', true);
  document.querySelectorAll('#tree a').forEach(a => a.classList.toggle('active', a.dataset.f === f));
  if (line && S.editor.revealLineInCenter) { S.editor.revealLineInCenter(line); S.editor.setPosition({ lineNumber: line, column: 1 }); S.editor.focus(); }
  renderBreakpoints();
}
async function reloadOpenFile() {
  if (!S.open || !S.editor) return;   // the editor is still being created (a file opened from the chat)
  const text = await (await fetch(`/a/${S.app}/api/source/${encodeURIComponent(S.open)}`)).text();
  if (!S.editor) return;
  if (getEditorText() !== text && !S.dirty) { setEditorText(text, langOf(S.open), true); S.text = text; if (S.view === 'design') S.designer?.refresh(); else if (S.view === 'form') isFormLayout(S.open) ? renderFormPreview() : renderObjView(); }
}
async function saveFile() {
  await S.designer?.flush?.();   // a Design view's pending edit (a grid cell) first
  if (!S.open || !S.dirty) return;
  await api('PUT', `/a/${S.app}/api/source/${encodeURIComponent(S.open)}`, getEditorText(), true);
  S.dirty = false; $('#fname').classList.remove('dirty'); $('#save').disabled = true;
  S.text = getEditorText();
  $('#saveHint').textContent = 'Saved';
  setTimeout(() => { $('#saveHint').textContent = ''; }, 2500);
}
// ------------------------------------------------------------------ object actions: check, activate, run
const objName = f => f.split('/').pop().split('.')[0];
// what F8 does for an object: data preview of tables and views, the test page of function modules, the program or
// transaction on the classic engine, the console of a class, the preview of a print form
function runTarget(f) {
  if (!/^src\//.test(f) || S.readOnly) return null;
  const name = objName(f), base = f.split('/').pop();
  const views = S.ws?.objects?.views || [], tables = S.ws?.objects?.tables || [];
  const has = (list, n) => list.find(x => x.name.toLowerCase() === n.toLowerCase());
  if (/\.tabl\./.test(f) && has(tables, name)) return { label: 'Data preview', kind: 'data', name: has(tables, name).name };
  if (/\.ddls\./.test(f) && has(views, name) && !has(views, name).broken) return { label: 'Data preview', kind: 'data', name: has(views, name).name };
  const fm = /^[\w$#]+\.fugr\.([\w$#]+)\.abap$/i.exec(base);
  if (fm && !/^(sapl|l\w+top$|l\w+uxx$)/i.test(fm[1])) return { label: 'Test function module', kind: 'classic', path: `__rap/functions/${fm[1].toUpperCase()}` };
  if (/\.fugr\.xml$/.test(f)) return { label: 'Test function modules', kind: 'classic', path: '__rap/functions' };
  if (/\.tran\.xml$/.test(f)) return { label: `Start transaction ${name.toUpperCase()}`, kind: 'classic', path: `transaction?tcode=${encodeURIComponent(name.toUpperCase())}` };
  if (/\.prog\.(abap|xml)$/.test(f) || /\.prog\.screen_\d+\.abap$/.test(f)) return { label: 'Run program', kind: 'program', name: name.toUpperCase() };
  if (/\.form\.json$/.test(f)) return { label: 'Preview form', kind: 'classic', path: `__rap/forms/${encodeURIComponent(name)}` };
  if (/\.clas\.abap$/.test(f) && (S.ws?.objects?.classes || []).some(c => c.classrun && c.name.toLowerCase() === name.toLowerCase())) return { label: 'Run class (console)', kind: 'console', name };
  return null;
}
async function runObject() {
  const t = runTarget(S.open || '');
  if (!t) return;
  if (S.dirty) await activateObject();
  if (t.kind === 'data') {
    location.hash = `#/app/${S.app}/data`;
    await loadTables(true);
    $('#tableSel').value = t.name; loadData();
  } else if (t.kind === 'console') {
    location.hash = `#/app/${S.app}/console`;
    loadClasses(); $('#classSel').value = [...$('#classSel').options].find(o => o.value.toLowerCase() === t.name.toLowerCase())?.value || ''; runClass();
  } else {
    // module pools start with their transaction code, reports with their name
    let path = t.path;
    if (t.kind === 'program') {
      const st = await api('GET', `/a/${S.app}/api/classic`).catch(() => ({}));
      const p = (st.list || []).find(x => x.name === t.name);
      path = p?.tcode ? `transaction?tcode=${encodeURIComponent(p.tcode)}` : `program?name=${encodeURIComponent(t.name)}`;
    }
    S.previewPath = '@classic'; S.previewChosen = true; S.classicPath = path;
    const fresh = !$('#frame').src;                            // the tab loads the preview itself the first time
    location.hash = `#/app/${S.app}/preview`;
    if (!fresh) reloadPreview(true);
  }
}
async function checkObject() {
  if (!S.open) return;
  const out = $('#objOut');
  out.hidden = false; out.className = 'objout'; out.innerHTML = '<span class="muted">Checking…</span>';
  const r = await api('POST', `/a/${S.app}/api/check`, { file: S.open, text: getEditorText() }).catch(e => ({ error: e.message }));
  if (r.error) { out.innerHTML = esc(r.error); return; }
  const rows = [...(r.activation || []).map(x => ({ ...x, severity: 'error' })), ...r.findings.filter(f => f.severity !== 'info')];
  const infos = r.findings.filter(f => f.severity === 'info').length;
  showObjOut(rows, rows.length ? null : `✓ ${objName(S.open).toUpperCase()}: no errors${infos ? ` (${infos} suggestion${infos > 1 ? 's' : ''} under Problems)` : ''}${S.dirty ? ' — not saved yet' : ''}`);
}
async function activateObject() {
  if (!S.open) return;
  await S.designer?.flush?.();
  if (S.dirty) await saveFile();
  $('#saveHint').textContent = 'Activating…';
  const sum = await api('POST', `/a/${S.app}/api/activate`);
  S.ws = sum;
  const errs = sum.diagnostics.errors.filter(e => e.file === S.open);
  const others = sum.diagnostics.errors.length - errs.length;
  $('#saveHint').textContent = '';
  showObjOut(errs.map(e => ({ ...e, severity: 'error' })), errs.length ? null : `✓ ${objName(S.open).toUpperCase()} activated${others ? ` — ${others} error(s) in other objects, see Problems` : ''}${isClassicObject(S.open) ? ' — building the classic programs…' : ''}`);
  refreshWorkspace();
  // classic programs: the engine converts and compiles them; what it rejects is an error of the object too
  if (!errs.length && isClassicObject(S.open)) {
    const file = S.open;
    const st = await api('POST', `/a/${S.app}/api/classic`).catch(() => null);
    if (!st) return;
    S.classicDiag = classicDiagnostics(st);
    if ($('#probList') && S.tab === 'problems') renderProblems();
    const mine = S.classicDiag.filter(d => d.file === file && d.severity === 'error');
    if (S.open !== file) return;
    if (mine.length) showObjOut(mine, null);
    else { const out = $('#objOut'); if (!out.hidden && out.classList.contains('good')) out.innerHTML = out.innerHTML.replace(' — building the classic programs…', ' — classic programs built'); }
  }
}
// sources the classic engine builds (reports, module pools, function groups, DDIC objects, forms)
const isClassicObject = f => /^src\/.+\.(prog\.|fugr\.|dtel\.xml|doma\.xml|ttyp\.xml|enqu\.xml|tran\.xml|sfpi\.json|form\.json|xdp)/i.test(f || '') || (/\.tabl\.cds$/.test(f || '') && (S.files || []).some(x => /\.prog\./.test(x)));
// the classic build's diagnostics with the app's file names (a converted program's class zcl_<prog> is its program)
function classicDiagnostics(st) {
  const files = S.files || [];
  const map = f => {
    const b = String(f || '').split('/').pop().toLowerCase();
    if (!b) return '';
    const direct = files.find(x => x.split('/').pop().toLowerCase() === b);
    if (direct) return direct;
    const cls = /^zcl_(.+)\.clas\.mjs$/.exec(b);
    if (cls) return files.find(x => new RegExp(`^src/z${cls[1]}\\.prog\\.abap$`).test(x)) || files.find(x => x === `src/zcl_${cls[1]}.clas.abap`) || b;
    return b;
  };
  return (st?.diagnostics || []).map(d => ({ ...d, file: map(d.file), message: String(d.message || '').replace(/^classic engine: /, '') }));
}
async function loadClassicDiag() {
  if (!S.app || S.readOnly) return;
  const st = await api('GET', `/a/${S.app}/api/classic`).catch(() => null);
  if (!st?.programs && !(st?.diagnostics || []).length) { S.classicDiag = []; return; }
  S.classicDiag = classicDiagnostics(st);
  if (S.tab === 'problems') renderProblems();
}
function showObjOut(rows, okText) {
  const out = $('#objOut');
  out.hidden = false;
  out.className = `objout ${rows.length ? 'bad' : 'good'}`;
  out.innerHTML = rows.length ? `<button class="x" title="Close">×</button>${rows.slice(0, 20).map((r, i) => `<a href="#" data-l="${i}"><span class="sev ${r.severity === 'error' ? 'e' : 'w'}">${r.severity}</span> ${r.line ? `line ${r.line}: ` : ''}${esc(r.message)}</a>`).join('')}`
    : `<button class="x" title="Close">×</button>${esc(okText)}`;
  out.querySelector('.x').onclick = () => { out.hidden = true; };
  out.querySelectorAll('[data-l]').forEach(a => a.onclick = e => { e.preventDefault(); const r = rows[a.dataset.l]; setView('source'); if (r.line && S.editor.revealLineInCenter) { S.editor.revealLineInCenter(r.line); S.editor.setPosition({ lineNumber: r.line, column: (r.column || 1) }); S.editor.focus(); } });
  if (okText) { clearTimeout(S.okTimer); S.okTimer = setTimeout(() => { if (out.classList.contains('good')) out.hidden = true; }, 5000); }
}

// ------------------------------------------------------------------ object view: abapGit XML as a readable form
// print form layouts (.form.json) show the source next to a live PDF preview
const isFormLayout = f => /^src\/.*\.form\.json$/i.test(f);
// Adobe XDP layouts (Adobe LiveCycle Designer): the visual designer, the XML next to the PDF rendered from it
const isXdp = f => /^src\/.*\.xdp$/i.test(f);
const hasFormView = f => /^src\/.*\.xml$/i.test(f) || isFormLayout(f) || isXdp(f) || !!visualKind(f);
function setView(v, initial) {
  if (!hasFormView(S.open || '')) v = 'source';
  const layout = isFormLayout(S.open || '') || isXdp(S.open || ''), visual = visualKind(S.open || ''), designable = layout || !!visual;
  const visualSrc = visual && !/\.xml$/.test(S.open);   // tables, views, BDEFs, metadata extensions: Design / Source only
  if (v === 'design' && !designable) v = 'form';
  if (v === 'form' && visualSrc) v = 'design';
  S.view = v;
  if (!initial && hasFormView(S.open || '')) S[layout ? 'formViewPref' : visualSrc ? 'visualViewPref' : visual ? 'xmlDesignPref' : 'viewPref'] = v;
  $('#viewSeg').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $('#edArea').classList.toggle('split', layout && v === 'form');
  $('#edArea').classList.toggle('designing', v === 'design');
  $('#objView').hidden = v === 'source';
  $('#editor').hidden = (v === 'form' && !layout) || v === 'design';
  // Monaco measures itself when it becomes visible again (else it draws only the first line for a moment)
  if (!$('#editor').hidden) requestAnimationFrame(() => S.editor?.layout?.());
  if (v !== 'design' && S.designer) { S.designer.destroy(); S.designer = null; }
  if (v === 'design') openDesigner();
  else if (v === 'form') layout ? renderFormPreview(true) : renderObjView();
}
// the visual designer of a form layout: it edits the editor's text (the JSON stays the source)
function openDesigner() {
  S.designer?.destroy();
  const vk = visualKind(S.open);
  if (vk) {
    S.designer = mountVisual($('#objView'), { kind: vk, file: S.open, app: S.app, api, getText: getEditorText, setText: t => { setEditorText(t, langOf(S.open), true); markDirty(); } });
    return;
  }
  S.designer = (isXdp(S.open) ? mountXdpDesigner : mountDesigner)($('#objView'), {
    app: S.app, name: objName(S.open), api, toast, openFile: f => openFile(f),
    getText: getEditorText,
    setText: t => { setEditorText(t, langOf(S.open), true); markDirty(); },
  });
}
// the preview of a form layout: rendered on the server from the editor's text with the layout's sample data or a
// record of its data provider (the service definition), refreshed while typing
async function renderFormPreview(full) {
  const host = $('#objView'), file = S.open;
  if (full || !host.querySelector('.fp-frame')) {
    host.innerHTML = `<div class="fp-bar"><select id="fpRec" title="Data: the layout's sample data or a record of its data provider"><option value="">${isXdp(file) ? 'Sample data / first record' : 'Sample data'}</option></select>
      <select id="fpLoc" title="Locale (date and number formats)"><option value="">Form locale</option>${['en_US', 'en_GB', 'de_DE', 'fr_FR', 'es_ES', 'it_IT', 'nl_NL', 'ja_JP'].map(l => `<option>${l}</option>`).join('')}</select>
      <span class="fp-info" id="fpInfo"></span><span class="spacer"></span><a class="btn sm" id="fpOpen" target="_blank" title="Open the PDF in a new tab">Open PDF</a></div>
      <div class="fp-err" id="fpErr" hidden></div><iframe class="fp-frame" title="Form preview"></iframe>`;
    host.querySelector('#fpRec').onchange = e => { S.formKeys = e.target.value ? JSON.parse(e.target.value) : null; renderFormPreview(); };
    host.querySelector('#fpLoc').onchange = () => renderFormPreview();
    api('GET', `/a/${S.app}/api/forms/records?name=${encodeURIComponent(objName(file))}`).then(r => {
      if (S.open !== file || !r.records?.length) return;
      $('#fpRec').insertAdjacentHTML('beforeend', `<optgroup label="${esc(r.entity)}">${r.records.map(x => `<option value='${esc(JSON.stringify(x.keys))}'>${esc(x.text)}</option>`).join('')}</optgroup>`);
    }).catch(() => {});
  }
  const seq = S.formSeq = (S.formSeq || 0) + 1;
  const res = await fetch(`/a/${S.app}/api/forms/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: objName(file), text: getEditorText(), keys: S.formKeys || undefined, locale: $('#fpLoc')?.value || undefined }) }).catch(e => ({ ok: false, json: async () => ({ error: { message: e.message } }) }));
  if (seq !== S.formSeq || S.open !== file || S.view !== 'form') return;
  const err = $('#fpErr');
  if (!res.ok) { const b = await res.json().catch(() => ({})); err.hidden = false; err.classList.remove('warn'); err.textContent = b.error?.message || `Preview failed (${res.status})`; return; }
  // the layout's warnings (unknown fields, fonts, images, failing calculations)
  let warnings = [];
  try { warnings = JSON.parse(decodeURIComponent(escape(atob(res.headers.get('X-Warnings') || '')))) || []; } catch {}
  err.hidden = !warnings.length;
  err.classList.toggle('warn', !!warnings.length);
  err.textContent = warnings.length ? `${warnings.length} warning${warnings.length > 1 ? 's' : ''}:\n${warnings.slice(0, 8).join('\n')}` : '';
  const url = URL.createObjectURL(await res.blob());
  if (S.formUrl) URL.revokeObjectURL(S.formUrl);
  S.formUrl = url;
  const pages = res.headers.get('X-Pages');
  const fields = Number(res.headers.get('X-Fields') || 0);
  $('#fpInfo').textContent = `${pages} page${pages === '1' ? '' : 's'}${fields ? ` · ${fields} fillable field${fields > 1 ? 's' : ''}` : ''}`;
  $('#fpOpen').href = url;
  host.querySelector('.fp-frame').src = `${url}#toolbar=0&navpanes=0&view=FitH`;
}
const XML_OBJ_TYPES = { DTEL: 'Data Element', DOMA: 'Domain', TTYP: 'Table Type', TABL: 'Database Table', TRAN: 'Transaction', ENQU: 'Lock Object', PROG: 'Program', FUGR: 'Function Group', MSAG: 'Message Class', SHLP: 'Search Help', XSLT: 'Transformation', DEVC: 'Package', CLAS: 'Class', INTF: 'Interface', VIEW: 'Dictionary View', SICF: 'ICF Service' };
const XML_LABELS = {
  DD01V: 'Domain', DD04V: 'Data element', DD40V: 'Table type', DD25V: 'Lock object', DD02V: 'Table', TSTC: 'Transaction', TSTCT: 'Text', TSTCC: 'GUI support', PROGDIR: 'Attributes',
  TPOOL: 'Text elements', DYNPROS: 'Screens', CUA: 'GUI status', DD07V_TAB: 'Fixed values', DD26E_TAB: 'Tables', DD27P_TAB: 'Lock parameters', DD26E_TABLE: 'Tables', DD27P_TABLE: 'Lock parameters', DD26E: 'Table', DD27P: 'Lock parameter',
  OBJPOS: 'Position', TABPOS: 'Position', FORTABNAME: 'Foreign key table', KEYFLAG: 'Key', DOMMASTER: 'Original language', VALPOSI: 'Position', VALPOS: 'Position', MASKLEN: 'Mask length', AS4LOCAL: 'Activation state', DD03P_TABLE: 'Fields', FUNCTIONS: 'Function modules',
  INCLUDES: 'Includes', HEADER: 'Header', CONTAINERS: 'Containers', FIELDS: 'Fields', FLOW_LOGIC: 'Flow logic', STA: 'Statuses', FUN: 'Functions', PFK: 'Function keys', IMPORT: 'Importing', EXPORT: 'Exporting', CHANGING: 'Changing', TABLES: 'Tables', EXCEPTION: 'Exceptions',
  ROLLNAME: 'Name', DOMNAME: 'Domain', TYPENAME: 'Name', VIEWNAME: 'Name', TABNAME: 'Table', DDLANGUAGE: 'Language', DDTEXT: 'Description', DATATYPE: 'Data type', LENG: 'Length', OUTPUTLEN: 'Output length', DECIMALS: 'Decimals',
  HEADLEN: 'Heading length', SCRLEN1: 'Short label length', SCRLEN2: 'Medium label length', SCRLEN3: 'Long label length', REPTEXT: 'Heading', SCRTEXT_S: 'Short label', SCRTEXT_M: 'Medium label', SCRTEXT_L: 'Long label',
  REFKIND: 'Reference kind', LOWERCASE: 'Lower case', SIGNFLAG: 'Sign', VALEXI: 'Has fixed values', ENTITYTAB: 'Value table', CONVEXIT: 'Conversion routine', DTELMASTER: 'Original language',
  ROWTYPE: 'Line type', ROWKIND: 'Line type kind', ACCESSMODE: 'Access', KEYDEF: 'Key definition', KEYKIND: 'Key kind', GENERIC: 'Generic', TCODE: 'Transaction code', PGMNA: 'Program', DYPNO: 'Screen', TTEXT: 'Text', SPRSL: 'Language',
  S_WEBGUI: 'SAP GUI for HTML', S_WIN32: 'SAP GUI for Windows', S_PLATIN: 'SAP GUI for Java', NAME: 'Name', SUBC: 'Program type', RLOAD: 'Language', FIXPT: 'Fixed point arithmetic', UCCHECK: 'Unicode checks', STATE: 'State',
  DOMVALUE_L: 'Value', DOMVALUE_H: 'To value', VALPOS: 'Position', AGGTYPE: 'Aggregation', ROOTTAB: 'Primary table', DDTEXT_: 'Text', VIEWFIELD: 'Field', ENQMODE: 'Lock mode', FIELDNAME: 'Field', TABLEPOS: 'Position', ID: 'Type', KEY: 'Key', ENTRY: 'Text', LENGTH: 'Length',
  AREAT: 'Description', FUNCNAME: 'Function module', SHORT_TEXT: 'Short text', PARAMETER: 'Parameter', TYP: 'Type', DBFIELD: 'Like', DEFAULT: 'Default', OPTIONAL: 'Optional', REFERENCE: 'By reference', DBSTRUCT: 'Structure', ARBGB: 'Message class', MSGNR: 'Number', TEXT: 'Text', STEXT: 'Short text',
};
const XML_VALUES = {
  DATATYPE: { CHAR: 'CHAR · character string', NUMC: 'NUMC · numeric text', DEC: 'DEC · packed number', INT4: 'INT4 · integer', DATS: 'DATS · date', TIMS: 'TIMS · time', CURR: 'CURR · amount', QUAN: 'QUAN · quantity', CUKY: 'CUKY · currency key', UNIT: 'UNIT · unit', CLNT: 'CLNT · client', STRG: 'STRING', RAW: 'RAW · bytes', STRU: 'STRU · structure', FLTP: 'FLTP · floating point', LANG: 'LANG · language' },
  ACCESSMODE: { T: 'Standard table', S: 'Sorted table', H: 'Hashed table', I: 'Index table', A: 'Any table' },
  KEYDEF: { D: 'Standard key', K: 'Key components', T: 'Table line', N: 'Not specified' },
  KEYKIND: { N: 'Non-unique', U: 'Unique', G: 'Not specified' },
  ROWKIND: { E: 'Data element', S: 'Structure / table', D: 'Domain', R: 'Reference', '': 'Built-in type' },
  SUBC: { 1: 'Executable program (report)', M: 'Module pool', F: 'Function group', I: 'Include', K: 'Class pool', S: 'Subroutine pool' },
  REFKIND: { D: 'Domain', R: 'Reference type', '': 'Built-in type' },
  ENQMODE: { E: 'Write lock (exclusive, cumulative)', S: 'Read lock (shared)', X: 'Exclusive, not cumulative', O: 'Optimistic' },
  ID: { R: 'Title', S: 'Selection text', I: 'Text symbol', H: 'List heading' },
};
const xmlLabel = t => XML_LABELS[t] || t.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
function xmlValue(tag, v) {
  const map = XML_VALUES[tag];
  const shown = map && map[v] !== undefined ? map[v] : v === 'X' ? 'Yes' : v;
  // a reference to another object of the app opens it
  const target = /^(DOMNAME|ROLLNAME|ROWTYPE|PGMNA|TABNAME|ROOTTAB|ENTITYTAB|TYP|DBSTRUCT|TYPENAME)$/.test(tag) && v && (S.files || []).find(f => f !== S.open && f.startsWith(`src/${v.toLowerCase()}.`) && !/\.testclasses\./.test(f));
  return target ? `<a href="#" data-open="${esc(target)}" title="Open ${esc(target)}">${esc(shown)}</a>` : esc(shown);
}
function xmlFields(leaves) {
  return `<dl class="ov-fields">${leaves.map(l => `<dt>${esc(xmlLabel(l.tagName))}</dt><dd>${xmlValue(l.tagName, l.textContent)}</dd>`).join('')}</dl>`;
}
function xmlRows(title, rows, depth) {
  const flat = rows.every(r => [...r.children].every(c => !c.children.length));
  if (!flat) return `<div class="ov-group"><h4>${esc(xmlLabel(title))} <span class="std-n">${rows.length}</span></h4>${rows.map(r => `<div class="ov-sub">${xmlSection(r, depth + 1)}</div>`).join('')}</div>`;
  const cols = [...new Set(rows.flatMap(r => [...r.children].map(c => c.tagName)))];
  return `<div class="ov-group"><h4>${esc(xmlLabel(title))} <span class="std-n">${rows.length}</span></h4><div class="ov-scroll"><table class="grid ov-table"><thead><tr>${cols.map(c => `<th>${esc(xmlLabel(c))}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${cols.map(c => { const e = [...r.children].find(x => x.tagName === c); return `<td>${e ? xmlValue(c, e.textContent) : ''}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}
function xmlSection(el, depth = 0) {
  const kids = [...el.children];
  const leaves = kids.filter(k => !k.children.length);
  let html = leaves.length ? xmlFields(leaves) : '';
  const nodes = kids.filter(k => k.children.length);
  const tags = [...new Set(nodes.map(n => n.tagName))];
  for (const t of tags) {
    const list = nodes.filter(n => n.tagName === t);
    if (list.length > 1) { html += xmlRows(t, list, depth); continue; }
    const n = list[0], inner = [...n.children];
    // a list container (<DD07V_TAB><DD07V>…</DD07V>…, <FUNCTIONS><item>…)
    if (inner.length && inner.every(c => c.tagName === inner[0].tagName && c.children.length) && (inner.length > 1 || /^(item|.*_TAB|.*S)$/i.test(inner[0].tagName) || /(_TAB|S)$/.test(t))) html += xmlRows(t, inner, depth);
    else if (depth > 5) html += `<pre class="ov-pre">${esc(n.textContent.trim())}</pre>`;
    else html += `<div class="ov-group"><h4>${esc(xmlLabel(t))}</h4>${xmlSection(n, depth + 1)}</div>`;
  }
  return html;
}
function renderObjView() {
  const host = $('#objView');
  const text = S.dirty ? getEditorText() : (S.text ?? getEditorText());
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const values = doc.getElementsByTagName('asx:values')[0];
  if (doc.getElementsByTagName('parsererror').length || !values) {
    host.innerHTML = `<div class="empty-state">This file is not abapGit XML that can be shown as a form. <a href="#" data-src>Show the source</a></div>`;
    host.querySelector('[data-src]').onclick = e => { e.preventDefault(); setView('source'); };
    return;
  }
  const type = (/LCL_OBJECT_(\w+)/.exec(doc.documentElement.getAttribute('serializer') || '')?.[1]) || S.open.split('.').slice(-2, -1)[0].toUpperCase();
  const desc = ['DDTEXT', 'TTEXT', 'AREAT', 'STEXT'].map(t => values.getElementsByTagName(t)[0]?.textContent).find(Boolean)
    || [...values.getElementsByTagName('item')].find(i => i.getElementsByTagName('ID')[0]?.textContent === 'R')?.getElementsByTagName('ENTRY')[0]?.textContent || '';
  const run = runTarget(S.open);
  host.innerHTML = `<header class="ov-head"><span class="kind">${esc(type)}</span><div><div class="ov-type">${esc(XML_OBJ_TYPES[type] || 'Object')}</div><h3>${esc(objName(S.open).toUpperCase())}</h3>${desc ? `<p>${esc(desc)}</p>` : ''}</div>
    <span class="spacer"></span>${run ? `<button class="btn sm run" data-run>▶ ${esc(run.label)}</button>` : ''}</header><div class="ov-body">${xmlSection(values)}</div>`;
  host.querySelector('[data-run]')?.addEventListener('click', runObject);
  host.querySelectorAll('[data-open]').forEach(a => a.onclick = e => { e.preventDefault(); openFile(a.dataset.open); });
}
function formEdited() { if (S.view === 'design') return S.designer?.refresh(); if (S.view === 'form' && isFormLayout(S.open || '')) { clearTimeout(S.formTimer); S.formTimer = setTimeout(() => renderFormPreview(), 500); } }
// unsaved changes: the editor's text differs from the file as loaded or saved (an edit undone, or a Design view that
// rewrote the same text, leaves the file clean)
function markDirty() {
  const changed = !S.editor || typeof S.text !== 'string' || getEditorText() !== S.text;
  if (changed === S.dirty) return;
  S.dirty = changed;
  $('#fname').classList.toggle('dirty', changed);
  $('#save').disabled = !changed;
}

// Monaco editor from CDN (falls back to a textarea)
let monacoReady = null;
function loadMonaco() {
  if (monacoReady) return monacoReady;
  monacoReady = new Promise(resolve => {
    const VS = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs';
    const s = document.createElement('script');
    s.src = `${VS}/loader.js`;
    const timer = setTimeout(() => resolve(null), 10000);
    s.onerror = () => { clearTimeout(timer); resolve(null); };
    s.onload = () => {
      window.MonacoEnvironment = { getWorkerUrl: () => `data:text/javascript;charset=utf-8,${encodeURIComponent(`self.MonacoEnvironment={baseUrl:'${VS}/../'};importScripts('${VS}/base/worker/workerMain.js');`)}` };
      window.require.config({ paths: { vs: VS } });
      window.require(['vs/editor/editor.main'], () => { clearTimeout(timer); registerCds(window.monaco); resolve(window.monaco); });
    };
    document.head.appendChild(s);
  });
  return monacoReady;
}
function registerCds(monaco) {
  monaco.languages.register({ id: 'cds' });
  monaco.languages.setMonarchTokensProvider('cds', {
    ignoreCase: true,
    keywords: ['define', 'root', 'view', 'entity', 'as', 'select', 'from', 'projection', 'on', 'provider', 'contract', 'association', 'composition', 'to', 'parent', 'of', 'key', 'where', 'and', 'or', 'not', 'case', 'when', 'then', 'else', 'end', 'cast', 'redirected', 'child', 'table', 'abstract', 'annotate', 'with', 'service', 'expose', 'managed', 'unmanaged', 'implementation', 'in', 'class', 'unique', 'strict', 'behavior', 'for', 'alias', 'persistent', 'lock', 'master', 'dependent', 'by', 'authorization', 'etag', 'create', 'update', 'delete', 'field', 'readonly', 'mandatory', 'numbering', 'action', 'result', 'parameter', 'determination', 'validation', 'modify', 'save', 'mapping', 'use', 'internal', 'static', 'factory', 'features', 'instance', 'global', 'early', 'late', 'draft', 'is', 'null', 'initial', 'distinct', 'inner', 'left', 'outer', 'join', 'group', 'having', 'not', 'include', 'virtual', 'localized', 'corresponding', 'side', 'effects', 'determine', 'transactional_query', 'transactional_interface'],
    tokenizer: {
      root: [
        [/@[\w.]+/, 'annotation'], [/#\w+/, 'type'], [/\/\/.*$/, 'comment'], [/\/\*/, 'comment', '@comment'],
        [/'([^'\\]|\\.)*'/, 'string'], [/\$\w+/, 'variable'], [/\babap\.\w+/, 'type'], [/\d+(\.\d+)?/, 'number'],
        [/[a-zA-Z_][\w]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
      ],
      comment: [[/[^/*]+/, 'comment'], [/\*\//, 'comment', '@pop'], [/[/*]/, 'comment']],
    },
  });
}
async function initEditor() {
  const host = $('#editor');
  if (!host || S.editor) return;
  const monaco = await loadMonaco();
  if (!$('#editor') || S.editor) return;
  if (monaco) {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    S.editor = monaco.editor.create(host, { value: '', language: 'abap', theme: dark ? 'vs-dark' : 'vs', automaticLayout: true, fontSize: 13, minimap: { enabled: false }, tabSize: 2, scrollBeyondLastLine: false, glyphMargin: true });
    // breakpoints: a click in the margin next to the line numbers sets or removes one
    S.editor.onMouseDown(e => {
      const T = monaco.editor.MouseTargetType;
      if ((e.target.type === T.GUTTER_GLYPH_MARGIN || e.target.type === T.GUTTER_LINE_NUMBERS) && e.target.position && /\.abap$/i.test(S.open || '')) toggleBreakpoint(S.open, e.target.position.lineNumber);
    });
    S.editor.onDidChangeModelContent(() => { if (!S.settingText) { markDirty(); formEdited(); followBreakpoints(); } });
    S.monaco = monaco;
    // code intelligence: completion, F3, where-used (Ctrl/Cmd+Shift+G), rename (F2), hover, outline
    S.codeintel = mountCodeIntel(monaco, S.editor, {
      app: () => S.app, file: () => S.open, api, toast,
      openFile: (f, line) => openFile(f, line),
      afterRename: async r => { S.dirty = false; await refreshWorkspace(); openFile(r.newFile); },
    });
  } else {
    host.innerHTML = '<textarea spellcheck="false" aria-label="Source code"></textarea>';
    const ta = host.querySelector('textarea');
    ta.addEventListener('input', () => { markDirty(); formEdited(); });
    S.editor = { dispose() {}, ta };
  }
}
function setEditorText(text, lang, keepView) {
  S.settingText = true;
  if (S.editor.ta) S.editor.ta.value = text;
  else {
    const view = keepView ? S.editor.saveViewState() : null;
    const old = S.editor.getModel();
    S.editor.setModel(S.monaco.editor.createModel(text, lang));
    old?.dispose();
    if (view) S.editor.restoreViewState(view);
  }
  S.settingText = false;
}
function getEditorText() { return S.editor.ta ? S.editor.ta.value : S.editor.getValue(); }

// ------------------------------------------------------------------ problems, data, console
function renderProblems() {
  const d = S.ws.diagnostics;
  $('#probTitle').textContent = `Problems · activation ${d.errors.length} error(s), ${d.warnings.length} warning(s)`;
  const rows = [...d.errors.map(x => ({ ...x, s: 'e' })), ...d.warnings.map(x => ({ ...x, s: 'w' }))];
  $('#probList').innerHTML = `<div class="chk-head"><strong>Activation</strong><span class="chk-sum">${S.ws.activationMs} ms</span></div>` + (rows.length ? rows.map((r, i) => `<div class="prob" data-p="${i}"><span class="sev ${r.s}">${r.s === 'e' ? 'ERROR' : 'warning'}</span><span>${esc(r.file)}${r.line ? ':' + r.line : ''}</span><span>${esc(r.message)}</span></div>`).join('')
    : '<div class="chk-ok">✓ All objects are active and consistent.</div>');
  // the classic engine: programs it could not convert or compile, debugger hooks it could not place
  const seen = new Set(rows.map(r => `${r.file}|${r.line}|${String(r.message).replace(/^classic engine: /, '')}`));
  const cd = (S.classicDiag || []).filter(x => !/GGCONV-W101/.test(x.message) && !seen.has(`${x.file}|${x.line}|${x.message}`));
  if (cd.length) {
    $('#probList').insertAdjacentHTML('beforeend', `<div class="chk-head"><strong>Classic engine</strong><span class="chk-sum">conversion and compilation of the classic programs</span></div>${cd.map((r, i) => `<div class="prob" data-c="${i}"><span class="sev ${r.severity === 'error' ? 'e' : 'w'}">${r.severity === 'error' ? 'ERROR' : 'warning'}</span><span>${esc(r.file)}${r.line ? ':' + r.line : ''}</span><span>${esc(/^debugger:/.test(r.message) ? `The debugger cannot stop in this program: ${r.message.replace(/^debugger:\s*/, '')}` : r.message)}</span></div>`).join('')}`);
    $('#probList').querySelectorAll('[data-c]').forEach(el => el.addEventListener('click', () => { const r = cd[el.dataset.c]; if (/^src\//.test(r.file)) { location.hash = `#/app/${S.app}/code`; openFile(r.file, r.line); } }));
  }
  $('#probList').querySelectorAll('[data-p]').forEach(el => el.addEventListener('click', () => { const r = rows[el.dataset.p]; if (r.file) { location.hash = `#/app/${S.app}/code`; openFile(r.file, r.line); } }));
}
// code checks: findings by category (open when they hold errors or warnings), explanation and quick fix per finding
async function runChecks(force) {
  if (!S.app || (S.checksFor === `${S.app}@${S.ws?.version}` && !force && S.checks)) return renderChecks();
  $('#checkList').innerHTML = '<div class="chk-head"><strong>Code checks</strong><span class="chk-sum">running…</span></div>';
  try { S.checks = await api('GET', `/a/${S.app}/api/atc`); S.checksFor = `${S.app}@${S.ws?.version}`; }
  catch (e) { $('#checkList').innerHTML = `<div class="chk-head"><strong>Code checks</strong><span class="chk-sum">${esc(e.message)}</span></div>`; return; }
  renderChecks();
}
function renderChecks() {
  const c = S.checks;
  if (!c) return;
  const sum = c.summary;
  const chips = [['error', sum.error], ['warning', sum.warning], ['info', sum.info]].filter(([, n]) => n).map(([k, n]) => `<span class="chk-chip ${k}">${n} ${k}${n === 1 ? '' : 's'}</span>`).join('');
  const groups = c.categories.map(cat => [cat, c.findings.filter(f => f.category === cat)]).filter(([, l]) => l.length);
  $('#checkList').innerHTML = `<div class="chk-head"><strong>Code checks</strong><span class="chk-sum">${esc(c.title || c.variant)} · ${c.files} sources · ${c.ms} ms</span>${chips}
      ${sum.fixable ? `<button class="btn sm" id="fixAll" title="Apply all automatic fixes">Fix ${sum.fixable} automatically</button>` : ''}</div>
    ${groups.length ? groups.map(([cat, list]) => `<details class="chk-cat" ${list.some(f => f.severity !== 'info') ? 'open' : ''}><summary>${esc(cat)} <span class="std-n">${list.length}</span></summary>
      ${list.map(f => `<div class="chk-f" data-i="${c.findings.indexOf(f)}"><span class="sev ${f.severity === 'error' ? 'e' : f.severity === 'warning' ? 'w' : 'i'}">${f.severity}</span>
        <a href="#" class="chk-loc" data-open>${esc(f.file.replace(/^src\//, ''))}:${f.line}</a><span class="chk-msg">${esc(f.message)}</span>
        <span class="chk-act"><button class="btn sm ghost" data-why title="Why, and how to fix it">?</button>${f.fix ? '<button class="btn sm" data-fix>Fix</button>' : ''}<button class="btn sm ghost" data-ai title="Ask the assistant to fix this finding">Fix with AI</button></span>
        <div class="chk-doc" hidden></div></div>`).join('')}</details>`).join('') : '<div class="chk-ok">✓ No findings.</div>'}`;
  $('#fixAll')?.addEventListener('click', () => applyFix({}));
  $('#checkList').querySelectorAll('.chk-f').forEach(el => {
    const f = c.findings[el.dataset.i];
    el.querySelector('[data-open]').onclick = e => { e.preventDefault(); location.hash = `#/app/${S.app}/code`; openFile(f.file, f.line); };
    el.querySelector('[data-fix]')?.addEventListener('click', () => applyFix({ rule: f.rule, file: f.file }));
    el.querySelector('[data-ai]').onclick = () => sendText(`Fix this ${f.severity} of the code checks in ${f.file} line ${f.line}: ${f.message} [${f.rule}]. Run \`rap atc\` afterwards; the finding must be gone and nothing new may appear.`);
    el.querySelector('[data-why]').onclick = async () => {
      const doc = el.querySelector('.chk-doc');
      if (!doc.hidden) { doc.hidden = true; return; }
      doc.hidden = false; doc.innerHTML = '…';
      const d = await api('GET', `/a/${S.app}/api/atc/doc/${encodeURIComponent(f.rule)}`);
      doc.innerHTML = md(d.markdown);
    };
  });
  $('#fixAi').hidden = !(S.ws.diagnostics.errors.length || sum.error || sum.warning || sum.info);
}
async function applyFix(body) {
  const r = await api('POST', `/a/${S.app}/api/atc/fix`, body);
  toast(r.fixed ? `${r.fixed} fix(es) applied in ${r.files.length} file(s)` : 'Nothing to fix');
  await refreshWorkspace();
  runChecks(true);
}
async function loadTables(keep) {
  if (!S.ws) return;
  const sel = $('#tableSel');
  const cur = sel.value;
  const opts = [...S.ws.objects.tables.map(t => ({ v: t.name, t: `${t.name} (table)` })), ...S.ws.objects.views.filter(v => !v.broken).map(v => ({ v: v.name, t: `${v.name} (view)` }))];
  // the runtime's own records: application jobs, logs, background processes, mail outbox, number ranges
  const SYS = { rap_apj_job: 'Application jobs', zrap_balhdr: 'Application logs', zrap_balmsg: 'Application log messages', rap_bgpf_process: 'Background processes (bgPF)',
    rap_mail_outbox: 'Mail outbox', rap_nr_interval: 'Number range intervals', rap_job: 'Background jobs (reports)', rap_output: 'Printed forms' };
  const sys = (S.ws.systemTables || []).map(n => ({ v: n, t: SYS[n] || n }));
  sel.innerHTML = `<optgroup label="Tables and views">${opts.map(o => `<option value="${esc(o.v)}">${esc(o.t)}</option>`).join('')}</optgroup>`
    + (sys.length ? `<optgroup label="System">${sys.map(o => `<option value="${esc(o.v)}">${esc(o.t)}</option>`).join('')}</optgroup>` : '');
  opts.push(...sys);
  if (cur && opts.some(o => o.v === cur)) sel.value = cur;
  if (!opts.length) { $('#dataGrid').innerHTML = '<div class="empty-state">No tables yet</div>'; return; }
  if (!keep || cur) loadData();
}
async function loadData() {
  const t = $('#tableSel').value;
  if (!t) return;
  const ticket = (S.dataTicket = (S.dataTicket || 0) + 1);   // only the latest choice is shown (responses can overtake)
  try {
    const d = await api('GET', `/a/${S.app}/api/data/${encodeURIComponent(t)}?top=500`);
    if (ticket !== S.dataTicket) return;
    $('#dataCount').textContent = `${d.count} row(s)${d.count > d.rows.length ? `, showing ${d.rows.length}` : ''}`;
    $('#dataGrid').innerHTML = d.rows.length ? `<table class="grid"><thead><tr>${d.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${d.rows.map(r => `<tr>${d.columns.map(c => `<td title="${esc(r[c])}">${esc(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<div class="empty-state">Table is empty</div>';
  } catch (e) { $('#dataGrid').innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; }
}
function loadClasses() {
  if (!S.ws) return;
  const cls = S.ws.objects.classes.filter(c => c.classrun);
  const sel = $('#classSel');
  const cur = sel.value;
  sel.innerHTML = cls.map(c => `<option>${esc(c.name)}</option>`).join('') || '<option value="">no console classes</option>';
  if (cur) sel.value = cur;
  $('#runCls').disabled = !cls.length;
}
async function runClass() {
  const c = $('#classSel').value;
  if (!c) return;
  $('#consoleOut').textContent = 'Running…';
  const r = await api('POST', `/a/${S.app}/api/run/${encodeURIComponent(c)}`);
  $('#consoleOut').textContent = `${r.output}${r.ok ? '' : `\n\n${r.error}`}\n\n— ${r.ms} ms`;
  if (r.dump) { const a = document.createElement('a'); a.href = '#'; a.textContent = '\nRuntime error recorded: show it (Problems)'; a.onclick = e => { e.preventDefault(); location.hash = `#/app/${S.app}/problems`; setTimeout(() => openDump(r.dump), 300); }; $('#consoleOut').appendChild(a); }
  if ($('#traceOn')?.checked) loadTrace();
}

// ------------------------------------------------------------------ practice: ABAP exercises (exercism's ABAP track)
// The list groups the exercises by level with the learner's progress; an exercise page has the instructions, the class
// to complete (saved as you type), its unit tests (read-only) and the test results. F8 runs the tests.
function closeExercise() {
  if (!EX.data) return;
  clearTimeout(EX.saveTimer); flushExercise();
  EX.editor?.dispose?.(); EX.editor = null;
  Object.values(EX.models).forEach(m => m.dispose?.()); EX.models = {}; EX.data = null;
  window.removeEventListener('keydown', exerciseKeys, true);
}
function learnHeader() { $('#appSwitch').hidden = true; $('#statusPill').hidden = true; $('#moreWrap').hidden = true; }
async function renderLearn() {
  closeExercise(); closeApp(); learnHeader();
  root.innerHTML = '<div class="home"><div class="empty-state">Loading the exercises…</div></div>';
  let d;
  try { d = await api('GET', '/studio/api/exercises'); }
  catch (e) { root.innerHTML = `<div class="home"><div class="empty-state">${esc(e.message)}</div></div>`; return; }
  const filter = S.learnFilter || 'all';
  const show = x => filter === 'all' || (filter === 'todo' ? x.status !== 'passed' : x.status === 'passed');
  const status = x => x.status === 'passed' ? '<span class="lx-st done">✓ Solved</span>' : x.status === 'started' ? `<span class="lx-st started">${x.total ? `${x.passed}/${x.total} tests` : 'Started'}</span>` : '';
  root.innerHTML = `<div class="home"><div class="learn">
    <div class="learn-head">
      <div><h1>Practice ABAP</h1>
      <p>${d.exercises.length} exercises from <a href="https://exercism.org/tracks/abap" target="_blank">exercism's ABAP track</a>: read the task, write the class, run its unit tests until they pass.</p></div>
      <div class="learn-progress"><strong>${d.done}</strong> of ${d.exercises.length} solved<div class="bar-track"><span style="width:${Math.round(100 * d.done / Math.max(1, d.exercises.length))}%"></span></div></div>
    </div>
    <div class="apps-head"><div class="seg" role="group" aria-label="Show">${[['all', 'All'], ['todo', 'To do'], ['done', 'Solved']].map(([v, t]) => `<button data-lf="${v}" aria-pressed="${v === filter}">${t}</button>`).join('')}</div>
      <span class="spacer"></span><input class="input search" id="exSearch" type="search" placeholder="Search exercises" aria-label="Search exercises" value="${esc(S.learnSearch || '')}"></div>
    <div id="exList"></div>
  </div></div>`;
  const list = () => {
    const q = String(S.learnSearch || '').toLowerCase();
    $('#exList').innerHTML = d.levels.map(level => {
      const items = d.exercises.filter(x => x.level === level && show(x) && (!q || `${x.name} ${x.blurb}`.toLowerCase().includes(q)));
      return items.length ? `<section class="apps"><div class="apps-head"><h2>${level} <span class="count">${items.length}</span></h2></div><div class="app-grid">${items.map(x => `
        <a class="app-card lx-card ${x.status}" href="#/learn/${esc(x.slug)}"><div class="card-top"><span class="n">${esc(x.name)}</span>${status(x)}</div>
        <span class="d">${esc(x.blurb)}</span><span class="lx-diff" title="Difficulty ${x.difficulty} of 10">${'●'.repeat(Math.min(5, Math.ceil(x.difficulty / 2)))}${'○'.repeat(5 - Math.min(5, Math.ceil(x.difficulty / 2)))}</span></a>`).join('')}</div></section>` : '';
    }).join('') || '<p class="empty">No exercise matches.</p>';
  };
  list();
  $('#exSearch').addEventListener('input', e => { S.learnSearch = e.target.value; list(); });
  document.querySelectorAll('[data-lf]').forEach(b => b.onclick = () => { S.learnFilter = b.dataset.lf; renderLearn(); });
}

async function renderExercise(slug) {
  closeExercise(); closeApp(); learnHeader();
  root.innerHTML = '<div class="home"><div class="empty-state">Loading…</div></div>';
  let d;
  try { d = await api('GET', `/studio/api/exercises/${slug}`); }
  catch (e) { root.innerHTML = `<div class="home"><div class="empty-state">${esc(e.message)} <a href="#/learn">All exercises</a></div></div>`; return; }
  EX.data = d; EX.results = null;
  const cleaner = (await api('GET', '/studio/api/exercises').catch(() => ({}))).cleaner;
  const sol = d.files.find(f => f.role === 'solution');
  root.innerHTML = `<div class="ex">
    <aside class="ex-doc">
      <div class="ex-top"><a href="#/learn">← All exercises</a><span class="spacer"></span><span class="lx-level">${esc(d.level)}</span></div>
      <h2>${esc(d.name)}</h2>
      <nav class="ex-tabs">${[['task', 'Task'], d.hints && ['hints', 'Hints'], ['solution', 'Solution']].filter(Boolean).map(([k, t]) => `<button data-dt="${k}">${t}</button>`).join('')}</nav>
      <div class="ex-md" id="exDoc"></div>
    </aside>
    <div class="ex-split-v" id="exSplitV" role="separator" aria-orientation="vertical" aria-label="Resize the task panel" tabindex="0"></div>
    <section class="ex-work">
      <div class="bar"><span class="ex-files">${d.files.map(f => `<button data-file="${esc(f.name)}" title="${f.role === 'test' ? 'The unit tests (read-only)' : 'Your solution'}">${f.role === 'test' ? 'Unit tests' : esc(f.name.replace(/\.clas\.abap$/, ''))}</button>`).join('')}</span>
        <span class="spacer"></span><span class="hint" id="exHint"></span>
        ${cleaner ? '<button class="btn sm" id="exClean" title="ABAP cleaner: tidy your code">Clean up</button>' : ''}
        <button class="btn sm" id="exCheck" title="Code checks on your class (Ctrl+F2)">Check</button>
        <button class="btn sm ghost" id="exReset" title="Start over with the original class">Reset</button>
        <button class="btn sm primary" id="exRun" title="Run the unit tests (F8)">▶ Run tests</button></div>
      <div id="exEditor"></div>
      <div class="ex-split-h" id="exSplitH" role="separator" aria-orientation="horizontal" aria-label="Resize the test results" tabindex="0"></div>
      <div class="ex-results" id="exResults"><div class="ex-res-empty">Write your solution in <code>${esc(sol?.name || '')}</code>, then <strong>Run tests</strong> (F8). ${d.status === 'passed' ? '<span class="lx-st done">✓ Solved before</span>' : ''}</div></div>
    </section>
  </div>`;
  const docTab = k => {
    document.querySelectorAll('[data-dt]').forEach(b => b.classList.toggle('on', b.dataset.dt === k));
    const el = $('#exDoc');
    if (k === 'task') el.innerHTML = exMd(d.instructions) + (d.source ? `<p class="ex-src">Source: <a href="${esc(d.source)}" target="_blank">${esc(d.source.replace(/^https?:\/\//, '').slice(0, 60))}</a> · exercism (MIT)</p>` : '');
    if (k === 'hints') el.innerHTML = exMd(d.hints);
    if (k === 'solution') {
      const solved = (EX.data.status === 'passed') || EX.results?.ok;
      el.innerHTML = solved ? '<p class="muted">Loading…</p>' : `<p>Try to solve it yourself first: the tests tell you what is missing.</p><button class="btn sm" id="exReveal">Show the reference solution anyway</button>`;
      const load = async () => { const r = await api('GET', `/studio/api/exercises/${slug}/solution`); el.innerHTML = `<p class="muted">One possible solution${solved ? '' : ' (you have not solved it yet)'}:</p>${r.files.map(f => `<pre class="ex-code"><code>${esc(f.text)}</code></pre>`).join('')}`; };
      if (solved) load(); else $('#exReveal').onclick = load;
    }
  };
  document.querySelectorAll('[data-dt]').forEach(b => b.onclick = () => docTab(b.dataset.dt));
  docTab('task');
  exResizers();
  // the editor: one model per file, the tests read-only; the solution is saved as you type
  const monaco = await loadMonaco();
  if (EX.data !== d) return;
  const host = $('#exEditor');
  if (monaco) {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    EX.editor = monaco.editor.create(host, { language: 'abap', theme: dark ? 'vs-dark' : 'vs', automaticLayout: true, fontSize: 13, minimap: { enabled: false }, tabSize: 2, scrollBeyondLastLine: false });
    for (const f of d.files) EX.models[f.name] = monaco.editor.createModel(f.text, 'abap');
    EX.editor.onDidChangeModelContent(() => { if (EX.file === sol?.name) { $('#exHint').textContent = 'Editing…'; clearTimeout(EX.saveTimer); EX.saveTimer = setTimeout(flushExercise, 800); } });
  } else {
    host.innerHTML = '<textarea spellcheck="false" aria-label="Source code"></textarea>';
    const ta = host.querySelector('textarea');
    for (const f of d.files) EX.models[f.name] = { text: f.text };
    ta.oninput = () => { if (EX.file === sol?.name) { EX.models[EX.file].text = ta.value; clearTimeout(EX.saveTimer); EX.saveTimer = setTimeout(flushExercise, 800); } };
    EX.editor = { ta, dispose() {} };
  }
  const showFile = name => {
    EX.file = name;
    document.querySelectorAll('[data-file]').forEach(b => b.classList.toggle('on', b.dataset.file === name));
    const ro = name !== sol?.name;
    if (EX.editor.ta) { EX.editor.ta.value = EX.models[name].text; EX.editor.ta.readOnly = ro; }
    else { EX.editor.setModel(EX.models[name]); EX.editor.updateOptions({ readOnly: ro }); }
  };
  EX.showFile = showFile;
  document.querySelectorAll('[data-file]').forEach(b => b.onclick = () => showFile(b.dataset.file));
  showFile(sol?.name || d.files[0].name);
  $('#exRun').onclick = runExerciseTests;
  $('#exCheck').onclick = checkExercise;
  $('#exReset').onclick = async () => {
    if (!await askDialog({ title: 'Start over?', text: 'Your code for this exercise is replaced by the original class.', ok: 'Start over', danger: true })) return;
    await api('POST', `/studio/api/exercises/${slug}/reset`);
    renderExercise(slug);
  };
  $('#exClean')?.addEventListener('click', async () => {
    $('#exHint').textContent = 'Cleaning…';
    try { const r = await api('POST', `/studio/api/exercises/${slug}/clean`, { text: exText() }); setExText(r.code); $('#exHint').textContent = 'Cleaned'; }
    catch (e) { toast(e.message); $('#exHint').textContent = ''; }
  });
  window.addEventListener('keydown', exerciseKeys, true);
}
// exercism markdown: ~~~~exercism/note (or caution, advanced) blocks become note boxes
const exMd = src => src.split(/~~~~exercism\/(\w+)\n([\s\S]*?)\n~~~~/).map((part, i) => i % 3 === 0 ? md(part) : i % 3 === 2 ? `<div class="ex-note">${md(part)}</div>` : '').join('');
// the task panel's width and the results panel's height: dragged (or arrow keys), remembered for the next exercise
function exResizers() {
  const ex = $('.ex'), res = $('#exResults');
  const load = (k, d) => { try { return Number(localStorage.getItem(k)) || d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, String(Math.round(v))); } catch {} };
  const setW = w => { const max = ex.clientWidth - 320; const v = Math.max(240, Math.min(max, w)); ex.style.setProperty('--ex-doc-w', `${v}px`); return v; };
  const setH = h => { const max = $('.ex-work').clientHeight - 160; const v = Math.max(80, Math.min(max, h)); res.style.height = `${v}px`; return v; };
  setW(load('rapstudio.ex.docw', Math.round(ex.clientWidth * 0.34)));
  setH(load('rapstudio.ex.resh', Math.round($('.ex-work').clientHeight * 0.34)));
  const drag = (el, move, key) => {
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('dragging'); document.body.classList.add('ex-resizing');
      let last;
      const mv = ev => { last = move(ev); };
      const up = () => { el.releasePointerCapture(e.pointerId); el.classList.remove('dragging'); document.body.classList.remove('ex-resizing'); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); if (last) save(key, last); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
    });
  };
  const v = $('#exSplitV'), h = $('#exSplitH');
  drag(v, ev => setW(ev.clientX - ex.getBoundingClientRect().left), 'rapstudio.ex.docw');
  drag(h, ev => setH($('.ex-work').getBoundingClientRect().bottom - ev.clientY), 'rapstudio.ex.resh');
  v.onkeydown = e => { const d = e.key === 'ArrowLeft' ? -24 : e.key === 'ArrowRight' ? 24 : 0; if (d) { e.preventDefault(); save('rapstudio.ex.docw', setW($('.ex-doc').offsetWidth + d)); } };
  h.onkeydown = e => { const d = e.key === 'ArrowUp' ? 24 : e.key === 'ArrowDown' ? -24 : 0; if (d) { e.preventDefault(); save('rapstudio.ex.resh', setH(res.offsetHeight + d)); } };
  v.ondblclick = () => save('rapstudio.ex.docw', setW(Math.round(ex.clientWidth * 0.34)));
  h.ondblclick = () => save('rapstudio.ex.resh', setH(Math.round($('.ex-work').clientHeight * 0.34)));
}
const exSolution = () => EX.data?.files.find(f => f.role === 'solution')?.name;
const exText = () => { const m = EX.models[exSolution()]; return m.getValue ? m.getValue() : m.text; };
function setExText(t) { const m = EX.models[exSolution()]; if (m.setValue) m.setValue(t); else { m.text = t; if (EX.file === exSolution()) EX.editor.ta.value = t; } }
function exerciseKeys(e) {
  if (!EX.data) return;
  if (e.key === 'F8') { e.preventDefault(); runExerciseTests(); }
  else if ((e.ctrlKey || e.metaKey) && e.key === 'F2') { e.preventDefault(); checkExercise(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); flushExercise(); }
}
async function flushExercise() {
  if (!EX.data || !exSolution()) return;
  clearTimeout(EX.saveTimer);
  const text = exText();
  if (text === EX.saved) { if ($('#exHint')) $('#exHint').textContent = ''; return; }
  await api('PUT', `/studio/api/exercises/${EX.data.slug}/files/${encodeURIComponent(exSolution())}`, text, true).catch(() => {});
  EX.saved = text;
  if ($('#exHint')) $('#exHint').textContent = 'Saved';
}
async function runExerciseTests() {
  if (!EX.data) return;
  const slug = EX.data.slug;
  $('#exRun').disabled = true;
  $('#exResults').innerHTML = '<div class="ex-res-empty">Running the tests…</div>';
  let r;
  try { r = await api('POST', `/studio/api/exercises/${slug}/test`, { name: exSolution(), text: exText() }); EX.saved = exText(); }
  catch (e) { r = { ok: false, errors: [{ message: e.message }], results: [], passed: 0, total: 0 }; }
  if (EX.data?.slug !== slug) return;
  $('#exRun').disabled = false; $('#exHint').textContent = '';
  EX.results = r;
  if (r.ok) EX.data.status = 'passed';
  const pretty = t => t.replace(/^test_?/, '').replace(/_/g, ' ');
  const problems = [...r.errors, ...(r.syntax || [])];
  const errs = problems.map((e, i) => `<a href="#" class="ex-t error" data-err="${i}"><span class="ic">!</span><span><strong>${e.line ? `Line ${e.line}` : 'Error'}</strong> ${esc(e.message)}</span></a>`).join('');
  $('#exResults').innerHTML = `<div class="ex-res-head ${r.ok ? 'ok' : 'bad'}">${r.ok && !r.syntax?.length ? `🎉 All ${r.total} tests pass. Well done!` : r.errors.length ? 'Your class does not compile yet' : `${r.syntax?.length ? `${r.syntax.length} syntax error(s) · ` : ''}${r.passed} of ${r.total} tests pass`}
      ${r.ok ? `<span class="spacer"></span><button class="btn sm" id="exSeeSol">Compare with the reference solution</button><a class="btn sm primary" href="#/learn">Next exercise →</a>` : ''}</div>
    ${errs}${r.results.map(t => `<div class="ex-t ${t.status}"><span class="ic">${t.status === 'passed' ? '✓' : '✗'}</span><span><strong>${esc(pretty(t.test))}</strong>${t.message ? ` <span class="msg">${esc(t.message)}</span>` : ''}</span></div>`).join('')}`;
  $('#exSeeSol')?.addEventListener('click', () => document.querySelector('[data-dt="solution"]').click());
  document.querySelectorAll('[data-err]').forEach(a => a.onclick = ev => {
    ev.preventDefault();
    const e = problems[a.dataset.err];
    const name = (e.file || '').split('/').pop();
    if (EX.models[name]) EX.showFile(name);
    if (e.line && EX.editor.revealLineInCenter) { EX.editor.revealLineInCenter(e.line); EX.editor.setPosition({ lineNumber: e.line, column: 1 }); EX.editor.focus(); }
  });
}
async function checkExercise() {
  if (!EX.data) return;
  $('#exResults').innerHTML = '<div class="ex-res-empty">Checking…</div>';
  const r = await api('POST', `/studio/api/exercises/${EX.data.slug}/check`, { name: exSolution(), text: exText() }).catch(e => ({ findings: [], error: e.message }));
  const list = r.findings || [];
  $('#exResults').innerHTML = `<div class="ex-res-head ${list.some(f => f.severity === 'error') ? 'bad' : 'ok'}">${r.error ? esc(r.error) : list.length ? `Code checks: ${list.length} finding(s)` : '✓ Code checks: no findings'}</div>
    ${list.map((f, i) => `<a href="#" class="ex-t ${f.severity === 'error' ? 'error' : 'warn'}" data-f="${i}"><span class="ic">${f.severity === 'error' ? '!' : f.severity === 'warning' ? '▲' : 'i'}</span><span><strong>Line ${f.line}</strong> ${esc(f.message)} <span class="msg">${esc(f.rule)}</span></span></a>`).join('')}`;
  document.querySelectorAll('#exResults [data-f]').forEach(a => a.onclick = ev => {
    ev.preventDefault(); const f = list[a.dataset.f];
    EX.showFile(exSolution());
    if (EX.editor.revealLineInCenter) { EX.editor.revealLineInCenter(f.line); EX.editor.setPosition({ lineNumber: f.line, column: f.column || 1 }); EX.editor.focus(); }
  });
}

// ------------------------------------------------------------------ debugger, runtime errors, SQL trace
// breakpoints per app (file -> lines), kept in the browser; sent to the debugger when a session starts or they change
function loadBreakpoints(app) { try { return JSON.parse(localStorage.getItem(`rapstudio.bp.${app}`) || '{}'); } catch { return {}; } }
const bpList = () => Object.entries(S.bps || {}).flatMap(([f, ls]) => ls.map(l => `${f}:${l}`));
function toggleBreakpoint(file, line) {
  // the classic engine could not place its debugger hooks in this program: say so instead of a breakpoint that never stops
  const noHooks = (S.classicDiag || []).find(d => d.file === file && /^debugger:/.test(d.message));
  if (noHooks && !(S.bps[file] || []).includes(line)) toast(`The debugger cannot stop in ${objName(file).toUpperCase()} yet (see Problems → Classic engine)`);
  const ls = new Set(S.bps[file] || []);
  ls.has(line) ? ls.delete(line) : ls.add(line);
  S.bps[file] = [...ls].sort((a, b) => a - b);
  if (!S.bps[file].length) delete S.bps[file];
  try { localStorage.setItem(`rapstudio.bp.${S.app}`, JSON.stringify(S.bps)); } catch {}
  renderBreakpoints();
  if (S.dbg && S.dbg.status !== 'done') {
    // the classic debugger only runs while there are breakpoints (or a stop): without them the engine is at full speed
    if (armedKind(S.dbg.kind) && !bpList().length && S.dbg.status !== 'paused' && S.dbgQuiet) { api('POST', `/a/${S.app}/api/debug/cmd`, { cmd: 'stop' }); S.dbg = null; clearInterval(S.dbgTimer); renderDebugger(); return; }
    api('POST', `/a/${S.app}/api/debug/cmd`, { cmd: 'breakpoints', breakpoints: bpList() });
  } else armDebugger();
}
// classic programs: what the Debug button can start (programs, transactions, function modules; not print forms)
const classicDebuggable = t => !!t && (t.kind === 'program' || (t.kind === 'classic' && !/^__rap\/forms/.test(t.path || '')));
// breakpoints in the app's ABAP while its classic programs are in the preview: the debugger is armed (quietly: the
// panel opens when a run of the preview reaches a breakpoint)
function armClassicDebugger() {
  if (S.previewPath !== '@classic' || !bpList().length || S.dbgStarting) return;
  if (S.dbg && S.dbg.status !== 'done' && S.dbg.status !== 'none') return;
  startDebug('classic', 'programs', { quiet: true });
}
// the same for a RAP app in the preview: breakpoints in its classes (behavior handlers) arm the RAP debugger, which
// serves the app's OData requests; the panel opens when a click in the app reaches a breakpoint
const armedKind = k => k === 'classic' || k === 'rap';
const isClassicSource = f => /\.(prog|fugr)\./.test(f);
function armRapDebugger() {
  if (!S.app || S.readOnly || S.previewPath === '@classic' || S.dbgStarting) return;
  if (!bpList().some(b => !isClassicSource(b))) return;
  if (S.dbg && S.dbg.status !== 'done' && S.dbg.status !== 'none') return;
  startDebug('rap', 'app', { quiet: true });
}
function armDebugger() { armClassicDebugger(); armRapDebugger(); }
function renderBreakpoints() {
  if (!S.editor?.deltaDecorations || !S.monaco) return;
  const R = S.monaco.Range;
  // stickiness 1: a breakpoint stays on its statement when lines are inserted or removed above it
  // the debugger tells where each breakpoint stops (bound: the line, null: nowhere): an unbound one is grey, a moved
  // one shows the line it stops on
  const bound = S.dbg && S.dbg.status !== 'done' ? S.dbg.bound || {} : {};
  const deco = (S.bps?.[S.open] || []).map(l => {
    const b = bound[`${S.open}:${l}`];
    const msg = b === null ? 'Breakpoint not bound: no statement here or below in this block, the program does not stop (click to remove)' : b && b !== l ? `Breakpoint: stops at line ${b}, the next statement (click to remove)` : 'Breakpoint (click to remove)';
    return { range: new R(l, 1, l, 1), options: { stickiness: 1, glyphMarginClassName: b === null ? 'bp-glyph bp-unbound' : b && b !== l ? 'bp-glyph bp-moved' : 'bp-glyph', glyphMarginHoverMessage: { value: msg } } };
  });
  // where a moved breakpoint really stops
  for (const l of S.bps?.[S.open] || []) { const b = bound[`${S.open}:${l}`]; if (b && b !== l) deco.push({ range: new R(b, 1, b, 1), options: { stickiness: 1, glyphMarginClassName: 'bp-target', glyphMarginHoverMessage: { value: `Stops here for the breakpoint at line ${l}` } } }); }
  const p = S.dbg?.paused;
  if (p && p.file === S.open) deco.push({ range: new R(p.line, 1, p.line, 1), options: { isWholeLine: true, className: 'dbg-line', glyphMarginClassName: 'dbg-arrow' } });
  S.bpDeco = S.editor.deltaDecorations(S.bpDeco || [], deco);
  S.bpDecoCount = (S.bps?.[S.open] || []).length;
}
// after an edit: the breakpoints take the lines their decorations moved to
function followBreakpoints() {
  if (!S.bpDeco?.length || !S.bpDecoCount || !S.editor?.getModel) return;
  const model = S.editor.getModel();
  const lines = [...new Set(S.bpDeco.slice(0, S.bpDecoCount).map(id => model.getDecorationRange(id)?.startLineNumber).filter(Boolean))].sort((a, b) => a - b);
  const old = S.bps[S.open] || [];
  if (lines.join() === old.join()) return;
  S.bps[S.open] = lines;
  if (!lines.length) delete S.bps[S.open];
  try { localStorage.setItem(`rapstudio.bp.${S.app}`, JSON.stringify(S.bps)); } catch {}
  if (S.dbg && S.dbg.status !== 'done') api('POST', `/a/${S.app}/api/debug/cmd`, { cmd: 'breakpoints', breakpoints: bpList() }).catch(() => {});
}
async function startDebug(kind, name, { first = false, quiet = false } = {}) {
  if (S.dirty) await saveFile();
  S.dbgQuiet = quiet;
  S.dbgStarting = true;
  try { S.dbg = await api('POST', `/a/${S.app}/api/debug`, { kind, name, breakpoints: bpList(), first, watches: watchList() }); } finally { S.dbgStarting = false; }
  S.dbgShown = null;
  renderDebugger();
  clearInterval(S.dbgTimer);
  S.dbgEvery = armedKind(kind) ? 400 : 250;
  S.dbgTimer = setInterval(pollDebugger, S.dbgEvery);
}
async function pollDebugger() {
  let st;
  try { st = await api('GET', `/a/${S.app}/api/debug`); } catch { return; }
  // armed (waiting for a breakpoint): a slower poll; stopped or running: fast
  const every = st.status === 'armed' ? 1500 : armedKind(st.kind) ? 400 : 250;
  if (S.dbgEvery !== every && st.status !== 'done' && st.status !== 'none') { S.dbgEvery = every; clearInterval(S.dbgTimer); S.dbgTimer = setInterval(pollDebugger, every); }
  const boundKey = JSON.stringify(st.bound || {});
  if (boundKey !== S.dbgBoundKey) { S.dbgBoundKey = boundKey; S.dbg = st; renderBreakpoints(); }
  S.dbg = st;
  const p = st.paused, key = p ? `${p.file}:${p.line}:${p.stack.length}:${p.seq || ''}` : `${st.status}:${st.last?.at || ''}`;
  if (key !== S.dbgShown) {
    S.dbgShown = key;
    if (p) S.dbgQuiet = false;
    // a classic run went on after a stop and finished: its result (the list) is in the preview
    if (!p && armedKind(st.kind) && st.status === 'armed' && S.dbgBack) { S.dbgBack = false; location.hash = `#/app/${S.app}/preview`; }
    if (p) {
      if (!location.hash.includes('/code')) location.hash = `#/app/${S.app}/code`;
      if (S.open !== p.file) await openFile(p.file, p.line);
      else if (S.editor.revealLineInCenterIfOutsideViewport) S.editor.revealLineInCenterIfOutsideViewport(p.line);
    }
    renderBreakpoints();
    renderDebugger();
    // the panel takes room from the editor: the stopped line stays in sight
    if (p && S.open === p.file) setTimeout(() => S.editor?.revealLineInCenter?.(p.line), 150);
  }
  if (st.status === 'done' || st.status === 'none') {
    clearInterval(S.dbgTimer);
    const r = st.result || {};
    if (r.kind === 'class') $('#consoleOut').textContent = `${r.output || ''}${r.ok ? '' : `\n\n${r.error || ''}`}`;
    if (r.dump) loadDumps();
  }
}
// a new value for a variable of the stopped frame (the debugger converts it to the variable's type)
async function dbgSet(expr, value) {
  if (S.dbg?.status !== 'paused') return;
  try {
    const st = await api('POST', `/a/${S.app}/api/debug/cmd`, { cmd: 'set', expr, value });
    if (st?.paused?.error) toast(st.paused.error);
    if (st?.paused) { S.dbg = st; S.dbgShown = null; }
  } catch (e) { toast(e.message); }
  setTimeout(pollDebugger, 120);
  toast(`${expr} = ${value}`);
}
function dbgCmd(cmd) { if (S.dbg && S.dbg.status === 'paused') { S.dbg.status = 'running'; if (armedKind(S.dbg.kind)) S.dbgBack = true; api('POST', `/a/${S.app}/api/debug/cmd`, { cmd }); renderDebugger(); } }
// a value of the variables view: elementary values inline, tables and structures as nested rows
function dbgValue(v) {
  if (!v) return '';
  switch (v.t) {
    case 'num': return `<span class="dv-num">${esc(v.v)}</span>`;
    case 'text': return `<span class="dv-text">'${esc(v.v)}'</span>`;
    case 'unassigned': return '<span class="dv-muted">not assigned</span>';
    case 'ref': return '<span class="dv-muted">initial reference</span>';
    case 'class': return `<span class="dv-muted">class ${esc(v.v)}</span>`;
    case 'table': return `<span class="dv-kind">table</span> <span class="dv-muted">${v.lines} line(s)</span>`;
    case 'object': return `<span class="dv-kind">${esc(v.cls)}</span>`;
    default: return '<span class="dv-kind">structure</span>';
  }
}
// rows of the variables view; every row knows its expression (lv_x, ls_s-comp, lt_t[2]-comp, me->attr): elementary
// values can be changed (double-click), any row can become a watch
function dbgRows(vars, depth = 0, prefix = '', sep = '') {
  return Object.entries(vars || {}).map(([n, v]) => {
    const expr = !prefix ? n : /^\[\d+\]$/.test(n) ? `${prefix}${n}` : `${prefix}${sep || '-'}${n}`;
    const kids = v.t === 'table' ? (v.rows || []).map((r, k) => [`[${k + 1}]`, r]) : (v.t === 'struct' || v.t === 'object') ? Object.entries(v.comps || {}) : [];
    const edit = (v.t === 'num' || v.t === 'text') && S.dbg?.status === 'paused';
    const head = `<div class="dv-row" style="padding-left:${8 + depth * 14}px" data-expr="${esc(expr)}">${kids.length ? '<span class="dv-caret">▸</span>' : '<span class="dv-caret"></span>'}<span class="dv-name">${esc(n)}</span><span class="dv-val${edit ? ' dv-edit' : ''}" ${edit ? `title="Double-click to change the value" data-set="${esc(expr)}"` : ''}>${dbgValue(v)}</span><button class="dv-watch" data-addwatch="${esc(expr)}" title="Watch ${esc(expr)}">👁</button></div>`;
    return kids.length ? `<details class="dv"><summary>${head}</summary>${dbgRows(Object.fromEntries(kids), depth + 1, expr, v.t === 'object' ? '->' : '-')}</details>` : head;
  }).join('');
}
// watches of an app (kept in the browser): [{ expr, stop (a watchpoint), cond }]
function loadWatches(app) { try { return JSON.parse(localStorage.getItem(`rapstudio.watch.${app}`) || '[]'); } catch { return []; } }
const watchList = () => (S.watches ||= loadWatches(S.app));
function saveWatches(list) {
  S.watches = list;
  try { localStorage.setItem(`rapstudio.watch.${S.app}`, JSON.stringify(list)); } catch {}
  if (S.dbg && S.dbg.status !== 'done' && S.dbg.status !== 'none') api('POST', `/a/${S.app}/api/debug/cmd`, { cmd: 'watches', watches: list }).then(st => { if (st?.paused) { S.dbg = st; renderDebugger(); } }).catch(() => {});
  renderDebugger();
}
function watchHtml(p) {
  const list = watchList();
  const vals = Object.fromEntries((p?.watches || []).map(w => [w.expr, w]));
  return `<div class="dbg-h">Watch <span class="dv-muted">expressions; ⏸ stops where the value changes</span></div>
    ${list.map((w, i) => { const cur = vals[w.expr]; const edit = cur && (cur.value?.t === 'num' || cur.value?.t === 'text') && S.dbg?.status === 'paused';
      return `<div class="dv-row dw-row" data-expr="${esc(w.expr)}"><button class="dw-stop${w.stop ? ' on' : ''}" data-wstop="${i}" title="${w.stop ? 'Watchpoint: stops where the value changes' : 'Make it a watchpoint'}">⏸</button><span class="dv-name" title="${esc(w.frame ? `in ${w.frame}` : 'everywhere')}">${esc(w.expr)}${w.stop && w.cond ? ` <span class="dv-muted">${esc(w.cond)}</span>` : ''}</span><span class="dv-val${edit ? ' dv-edit' : ''}" ${edit ? `data-set="${esc(w.expr)}" title="Double-click to change the value"` : ''}>${cur ? (cur.found ? dbgValue(cur.value) : '<span class="dv-muted">not in this frame</span>') : '<span class="dv-muted">—</span>'}</span>${w.stop ? `<button class="dw-cond" data-wcond="${i}" title="Condition (e.g. > 100, = 'X', <> 0)">if…</button>` : ''}<button class="dw-del" data-wdel="${i}" title="Remove">×</button></div>`; }).join('')}
    <div class="dw-add"><input class="input" id="dwInput" placeholder="Add a watch: lv_total, ls_out-qty, lt_items[1]-name, me->attr" spellcheck="false"></div>`;
}
function renderDebugger() {
  const el = $('#dbgPanel');
  if (!el) return;
  const st = S.dbg;
  // a classic run that finished normally: the breakpoints stay armed, the panel goes away until one is reached
  if (st && armedKind(st.kind) && st.status === 'armed' && st.last && !st.paused) S.dbgQuiet = true;
  // the session ended (End debugging, Stop, a run without output): the panel goes away and the editor gets its room
  const ended = st && st.status === 'done' && !(st.result?.dump || st.result?.output || st.result?.results?.length || st.result?.error);
  if (!st || st.status === 'none' || ended || (armedKind(st.kind) && S.dbgQuiet && st.status !== 'paused')) { el.hidden = true; if (ended) renderBreakpoints(); return; }
  el.hidden = false;
  const p = st.paused, r = st.result;
  // not stopped (armed, running, finished without output): one line, the editor keeps its height
  el.classList.toggle('compact', !p && !(st.status === 'done' && (r?.dump || r?.output || r?.results?.length)));
  // every button is always there, in the same order, disabled where it does not apply (nothing moves between stops)
  const paused = st.status === 'paused' && !!p;
  const btn = (cmd, label, key, title, on = paused) => `<button class="btn sm" data-dc="${cmd}" ${on ? '' : 'disabled'} title="${title} (${key})">${label} <kbd>${key}</kbd></button>`;
  const tool = (cmd, label, cls, title, on) => `<button class="btn sm ${cls}" data-dc="${cmd}" ${on ? '' : 'disabled'} title="${title}">${label}</button>`;
  const armed = armedKind(st.kind);
  const what = st.kind === 'tests' ? 'Unit tests' : st.kind === 'rap' ? 'RAP app (the preview\'s requests)' : st.kind === 'classic' ? (st.name && st.name !== 'programs' ? `Program ${String(st.name).replace(/^.*[?=]/, '').toUpperCase()}` : 'Classic ABAP programs') : `Class ${String(st.name || '').toUpperCase()}`;
  const status = st.status === 'paused' ? `Stopped at <b>${esc(p.stack[0] || '')}</b> line ${p.line}`
    : st.status === 'armed' ? (st.last ? 'Finished: the result is in the preview. The breakpoints stay active.' : st.kind === 'rap' ? 'Breakpoints active: use the app in the preview' : 'Breakpoints active: run the program in the preview')
    : st.status === 'done' ? (r?.stopped ? 'Stopped' : r?.error ? `Ended with an error: ${esc(r.error)}` : st.kind === 'tests' ? `Tests done: ${r?.passed ?? 0} passed, ${(r?.failed ?? 0) + (r?.errors ?? 0)} failed` : 'Finished') : 'Running…';
  // the step buttons first and always in the same place (the status text after them changes its length)
  el.innerHTML = `<div class="dbg-head"><strong>Debugger</strong><span class="dbg-steps">${btn('into', 'Step into', 'F5', 'Next statement, also inside called methods')}${btn('over', 'Step over', 'F6', 'Next statement of this method')}${btn('out', 'Return', 'F7', 'Up to the calling method', paused && (p.stack?.length || 0) > 1)}${btn('continue', 'Continue', 'F8', 'To the next breakpoint')}</span>
      <span class="dbg-what">${esc(what)}</span><span class="dbg-status" title="${esc(String(status).replace(/<[^>]+>/g, ''))}">${status}</span><span class="spacer"></span>
      <span class="dbg-tools">${armed ? tool('hide', 'Hide', 'ghost', 'The breakpoints stay active', st.status !== 'paused' && st.status !== 'done') : ''}${tool('stop', armed ? 'End debugging' : 'Stop', 'danger', armed ? 'Breakpoints off until the next run in the preview' : 'Stop the run', st.status !== 'done')}${tool('close', 'Close', 'ghost', 'Close the debugger', st.status === 'done')}</span></div>
    ${p?.reason?.kind === 'watchpoint' ? `<div class="dbg-reason">Watchpoint <b>${esc(p.reason.expr)}</b>${p.reason.cond ? ` (${esc(p.reason.cond)})` : ''}: changed from ${dbgValue(p.reason.old)} to ${dbgValue(p.reason.value)}</div>` : ''}
    ${p ? `<div class="dbg-body"><div class="dbg-vars">${watchHtml(p)}<div class="dbg-h">Variables</div>${dbgRows(p.vars) || '<div class="dv-muted dv-row">none</div>'}${p.me?.comps ? `<div class="dbg-h">${esc(p.meLabel || 'Attributes (me)')}</div>${dbgRows(p.me.comps, 0, p.meLabel ? '' : 'me', '->').replace(/data-expr="me->/g, 'data-expr="me->')}` : ''}</div>
      <div class="dbg-side"><div class="dbg-h">Call stack</div>${(p.frames || p.stack.map(label => ({ label }))).map((f, k) => `<a href="#" class="dbg-frame${k ? '' : ' cur'}" data-frame="${esc(f.label)}"${f.file ? ` data-file="${esc(f.file)}" data-line="${f.line}"` : ''}>${esc(f.label)}${f.file ? ` <span class="dv-muted">${f.line}</span>` : ''}</a>`).join('')}
      <div class="dbg-h">System fields</div>${dbgRows(Object.fromEntries(Object.entries(p.sy).filter(([, v]) => v.v !== '' && v.v !== undefined).map(([k, v]) => [`sy-${k}`, v])))}</div></div>`
    : r && st.status === 'done' ? `<div class="dbg-body dbg-result">${r.dump ? `<a href="#" data-dump="${r.dump}">Show the runtime error</a>` : ''}${r.kind === 'class' && r.output ? `<pre class="out">${esc(r.output)}</pre>` : ''}${r.kind === 'tests' ? (r.results || []).map(t => `<div class="dv-row"><span class="${t.status === 'passed' ? 'dv-num' : 'dv-err'}">${t.status === 'passed' ? '✓' : '✗'}</span> ${esc(t.cls)}->${esc(t.method)} <span class="dv-muted">${esc(t.message || '')}</span></div>`).join('') : ''}</div>` : ''}`;
  // watches: add (Enter, 👁 on a variable), remove, watchpoint on / off, condition
  const inp = el.querySelector('#dwInput');
  const frame = st.paused?.stack?.[0] || '';   // a watch belongs to the method it was added in
  if (inp) inp.onkeydown = e => { if (e.key === 'Enter' && inp.value.trim()) { saveWatches([...watchList().filter(w => w.expr !== inp.value.trim()), { expr: inp.value.trim(), stop: false, frame }]); } };
  el.querySelectorAll('[data-addwatch]').forEach(b => b.onclick = e => { e.preventDefault(); e.stopPropagation(); const x = b.dataset.addwatch; if (!watchList().some(w => w.expr === x)) saveWatches([...watchList(), { expr: x, stop: false, frame }]); });
  el.querySelectorAll('[data-wdel]').forEach(b => b.onclick = () => saveWatches(watchList().filter((_, i) => i !== Number(b.dataset.wdel))));
  el.querySelectorAll('[data-wstop]').forEach(b => b.onclick = () => saveWatches(watchList().map((w, i) => (i === Number(b.dataset.wstop) ? { ...w, stop: !w.stop } : w))));
  el.querySelectorAll('[data-wcond]').forEach(b => b.onclick = () => { const i = Number(b.dataset.wcond); askDialog({ title: 'Watchpoint condition', ok: 'Set', input: { label: 'Stop only when the new value… (e.g. > 100, = \'X\', <> 0; empty: on every change)', value: watchList()[i].cond || '' } }).then(c => { if (c !== null) saveWatches(watchList().map((w, k) => (k === i ? { ...w, cond: c.trim() } : w))); }); });
  // change a value: double-click, type, Enter
  el.querySelectorAll('[data-set]').forEach(v => v.ondblclick = e => {
    e.preventDefault(); e.stopPropagation();
    if (v.querySelector('input')) return;
    const raw = v.textContent.replace(/^'(.*)'$/s, '$1');
    v.innerHTML = `<input class="dv-input" value="${esc(raw)}">`;
    const i = v.querySelector('input'); i.focus(); i.select();
    const done = ok => { if (ok) dbgSet(v.dataset.set, i.value); else renderDebugger(); };
    i.onkeydown = k => { if (k.key === 'Enter') { k.preventDefault(); done(true); } if (k.key === 'Escape') done(false); k.stopPropagation(); };
    i.onblur = () => done(false);
    i.onclick = k => k.stopPropagation();
  });
  el.querySelectorAll('[data-dc]').forEach(b => b.onclick = () => {
    const c = b.dataset.dc;
    if (c === 'close') { S.dbg = null; renderDebugger(); renderBreakpoints(); return; }
    if (c === 'hide') { S.dbgQuiet = true; renderDebugger(); return; }
    if (c === 'stop') { api('POST', `/a/${S.app}/api/debug/cmd`, { cmd: 'stop' }); return; }
    dbgCmd(c);
  });
  el.querySelectorAll('[data-frame]').forEach(a => a.onclick = e => { e.preventDefault(); if (a.dataset.file) return openFile(a.dataset.file, Number(a.dataset.line)); const cls = a.dataset.frame.split(' ')[0].toLowerCase(); const f = (S.files || []).find(x => x === `src/${cls}.clas.abap`) || (S.files || []).find(x => x.startsWith(`src/${cls}.`)); if (f) openFile(f); });
  el.querySelector('[data-dump]')?.addEventListener('click', e => { e.preventDefault(); location.hash = `#/app/${S.app}/problems`; setTimeout(() => openDump(Number(e.target.dataset.dump)), 300); });
}
// F5 / F6 / F7 / F8 while the debugger has stopped (before the editor's own keys)
window.addEventListener('keydown', e => {
  if (S.dbg?.status !== 'paused' || !S.app) return;
  const cmd = { F5: 'into', F6: 'over', F7: 'out', F8: 'continue' }[e.key];
  if (cmd) { e.preventDefault(); e.stopPropagation(); if (cmd !== 'out' || (S.dbg.paused?.stack?.length || 0) > 1) dbgCmd(cmd); }
}, true);
window.addEventListener('keydown', e => { if (e.key === 'F8' && e.shiftKey && S.app && !$('#dbgBtn')?.hidden && location.hash.includes('/code')) { e.preventDefault(); e.stopPropagation(); $('#dbgBtn').click(); } }, true);

// runtime errors (like ST22): the uncaught exceptions of ABAP code, with the call stack and the source
async function loadDumps() {
  if (!S.app || !$('#dumpList')) return;
  let list = [];
  try { list = await api('GET', `/a/${S.app}/api/dumps`); } catch { return; }
  const when = ms => new Date(ms).toLocaleString();
  $('#dumpList').innerHTML = `<div class="chk-head"><strong>Runtime errors</strong><span class="chk-sum">${list.length ? `${list.length} recorded` : 'none'}</span>${list.length ? '<button class="btn sm ghost" id="dumpClear">Delete all</button>' : ''}</div>
    ${list.length ? list.map(d => `<div class="dump" data-id="${d.id}"><a href="#" class="dump-h"><span class="sev e">${esc(d.exception)}</span><span class="dump-msg">${esc(d.message)}</span><span class="dump-meta">${esc(d.context)} · ${esc(when(d.created))}</span></a><div class="dump-d" hidden></div></div>`).join('')
      : '<div class="chk-ok">✓ No runtime errors. When ABAP code ends with an exception nobody catches, it is recorded here with the call stack and the source.</div>'}`;
  $('#dumpClear')?.addEventListener('click', async () => { await api('DELETE', `/a/${S.app}/api/dumps`); loadDumps(); });
  document.querySelectorAll('#dumpList .dump-h').forEach(a => a.onclick = e => { e.preventDefault(); openDump(Number(a.parentElement.dataset.id)); });
}
async function openDump(id) {
  const box = document.querySelector(`#dumpList .dump[data-id="${id}"] .dump-d`);
  if (!box) { await loadDumps(); if (!document.querySelector(`#dumpList .dump[data-id="${id}"]`)) return; return openDump(id); }
  if (!box.hidden) { box.hidden = true; return; }
  const d = await api('GET', `/a/${S.app}/api/dumps/${id}`);
  box.hidden = false;
  box.innerHTML = `<div class="dbg-h">Call stack</div>${d.frames.map(f => `<a href="#" class="dbg-frame" data-f="${esc(f.file)}" data-l="${f.line ?? ''}">${esc(f.cls.toUpperCase())}->${esc(String(f.method).toUpperCase())}${f.file ? ` <span class="dv-muted">${esc(f.file.replace(/^src\//, ''))}:${f.line}</span>` : ''}</a>`).join('') || '<div class="dv-muted">no ABAP frames</div>'}
    ${d.source.length ? `<div class="dbg-h">Source</div><pre class="dump-src">${d.source.map(x => `<span class="${x.line === d.line ? 'hit' : ''}">${String(x.line).padStart(4)}  ${esc(x.text)}</span>`).join('\n')}</pre>` : ''}`;
  box.querySelectorAll('[data-f]').forEach(a => a.onclick = e => { e.preventDefault(); if (a.dataset.f) { location.hash = `#/app/${S.app}/code`; openFile(a.dataset.f, Number(a.dataset.l) || undefined); } });
}

// SQL trace (like ST05): switched on per app in the Console tab
async function loadTrace() {
  if (!S.app || !$('#traceView')) return;
  let t;
  try { t = await api('GET', `/a/${S.app}/api/trace`); } catch { return; }
  $('#traceOn').checked = t.on;
  const v = $('#traceView');
  v.hidden = !t.on && !t.records.length;
  v.innerHTML = `<div class="chk-head"><strong>SQL trace</strong><span class="chk-sum">${t.on ? 'on' : 'off'} · ${t.records.length} statement(s)${t.records.length ? ` · ${t.records.reduce((a, r) => a + r.ms, 0).toFixed(1)} ms` : ''}</span><button class="btn sm ghost" id="traceRefresh">Refresh</button>${t.records.length ? '<button class="btn sm ghost" id="traceClear">Clear</button>' : ''}</div>
    ${t.records.length ? `<table class="grid trace"><thead><tr><th>Time</th><th>ms</th><th>Rows</th><th>ABAP</th><th>Statement</th></tr></thead><tbody>${t.records.map(r => `<tr class="${r.error ? 'err' : ''}" title="${esc(r.params.length ? `Parameters: ${JSON.stringify(r.params)}` : '')}${r.error ? ` Error: ${esc(r.error)}` : ''}"><td>${new Date(r.at).toLocaleTimeString()}</td><td class="num">${r.ms}</td><td class="num">${r.rows ?? ''}</td><td>${esc(r.abap)}</td><td class="sql">${esc(r.sql)}</td></tr>`).join('')}</tbody></table>`
      : `<div class="chk-ok">${t.on ? 'Run something (a class, the app\'s UI): its SQL statements appear here.' : ''}</div>`}`;
  $('#traceRefresh').onclick = loadTrace;
  $('#traceClear')?.addEventListener('click', async () => { await api('DELETE', `/a/${S.app}/api/trace`); loadTrace(); });
}
