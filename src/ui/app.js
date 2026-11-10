// Fiori-elements-like UI runtime: renders List Report and Object Page from the service's UI annotations.
const app = document.getElementById('app');
// the UI is served at "/" (rap serve) or "/a/<app>/" (studio); all server URLs are prefixed with BASE
const BASE = window.RAP_BASE || '';
const metaCache = new Map();
let pendingError = null; // error to show after navigating (e.g. failed activation of a new draft)
let workspace = null;

// ------------------------------------------------------------------ utilities
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const h = (strings, ...vals) => strings.reduce((a, s, i) => a + s + (i < vals.length ? (Array.isArray(vals[i]) ? vals[i].join('') : vals[i] ?? '') : ''), '');
async function api(method, url, body) {
  const r = await fetch(BASE + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  const messages = r.headers.get('sap-messages') ? JSON.parse(r.headers.get('sap-messages')) : [];
  if (!r.ok) { const e = new Error(data?.error?.message || r.statusText); e.details = data?.error?.details || []; throw e; }
  return { data, messages };
}
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3500); }
async function meta(srv) {
  if (!metaCache.has(srv)) metaCache.set(srv, (await api('GET', `/odata/${srv}/$uimetadata`)).data);
  return metaCache.get(srv);
}
function keyPredicate(set, row) {
  return '(' + set.keys.map(k => {
    const f = set.fields.find(x => x.name === k);
    const v = row[k];
    return `${k}=${f.type === 'Edm.Guid' || f.type.match(/Int|Decimal|Double/) ? v : `'${String(v).replace(/'/g, "''")}'`}`;
  }).concat(set.draft ? [`IsActiveEntity=${row.IsActiveEntity !== false}`] : []).join(',') + ')';
}
const label = (set, name) => set.fields.find(f => f.name === name)?.label || name;
function fmt(f, v, row) {
  if (v === null || v === undefined || v === '') return '<span class="muted">–</span>';
  if (f?.type === 'Edm.Boolean') return v ? 'Yes' : 'No';
  if (f?.type === 'Edm.Date') return esc(new Date(v + 'T00:00:00').toLocaleDateString());
  if (f?.type === 'Edm.DateTimeOffset') return esc(new Date(v).toLocaleString());
  if (f?.type === 'Edm.Decimal' || f?.type === 'Edm.Double') {
    const cur = f.semantics?.amount?.currencycode;
    const s = Number(v).toLocaleString(undefined, { minimumFractionDigits: f.scale ?? 2, maximumFractionDigits: f.scale ?? 2 });
    return esc(cur && row?.[cur] ? `${s} ${row[cur]}` : s);
  }
  if (f?.text && row?.[f.text]) return `${esc(row[f.text])} <span class="muted">(${esc(String(v).replace(/^0+(?=\d)/, ''))})</span>`;
  if (f?.type === 'Edm.String' && /^0+\d+$/.test(v) && f.abapType === 'n') return esc(String(v).replace(/^0+(?=\d)/, ''));
  return esc(v);
}
function cellHtml(set, item, row) {
  const f = set.fields.find(x => x.name === item.value);
  const html = fmt(f, row[item.value], row);
  if (item.criticality && row[item.criticality] !== undefined) {
    const textField = set.fields.find(x => /StatusText|Text$/.test(x.name) && x.name.toLowerCase().includes('status'));
    const shown = textField && row[textField.name] ? esc(row[textField.name]) : html;
    return `<span class="status-pill crit-${esc(row[item.criticality])}">${shown}</span>`;
  }
  return html;
}
function columnsOf(set) {
  const cols = set.ui.lineItem.filter(i => i.type === '#STANDARD' && !set.fields.find(f => f.name === i.value)?.hidden);
  if (cols.length) return cols;
  return set.fields.filter(f => !f.hidden && !f.key).slice(0, 6).map(f => ({ value: f.name, type: '#STANDARD' }));
}
const isNum = f => /Int|Decimal|Double/.test(f?.type || '');
function setActiveNav(name) { document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === name)); }
function showErrors(container, err) {
  const details = err.details?.length ? err.details : [{ message: err.message }];
  container.innerHTML = `<div class="strip E" role="alert"><div><strong>${esc(err.message)}</strong>${details.length > 1 ? `<ul>${details.map(d => `<li>${esc(d.message)}</li>`).join('')}</ul>` : ''}</div></div>`;
  for (const d of details) {
    for (const t of d.targets?.length ? d.targets : [d.target || '']) {
      const input = document.querySelector(`.form [data-field="${CSS.escape(t)}"]`);
      if (input) { input.classList.add('error'); input.title = d.message; }
    }
  }
}

// ------------------------------------------------------------------ router
async function loadUser() { document.getElementById('userName').textContent = (await api('GET', '/api/user')).data.user; }
document.getElementById('userBtn').onclick = async () => {
  const name = prompt('Work as user (e.g. ALICE, BOB). Drafts are locked per user.', document.getElementById('userName').textContent);
  if (!name) return;
  await api('POST', '/api/user', { name });
  await loadUser();
  route();
};
loadUser();
window.addEventListener('hashchange', route);
route();
async function route() {
  const hash = decodeURIComponent(location.hash.slice(1) || '/');
  try {
    workspace = (await api('GET', '/api/workspace')).data;
    renderBanner();
    if (hash === '/' || hash === '') return await renderLaunchpad();
    if (hash.startsWith('/_workspace')) return await renderWorkspace(hash);
    const [, srv, rest] = /^\/([^/]+)\/(.+)$/.exec(hash) || [];
    if (!srv) return renderLaunchpad();
    const [path, query] = rest.split('?');
    const m = /^([^(/]+)(?:\((.*)\))?(\/new)?$/.exec(path);
    if (!m) throw new Error(`Unknown route ${hash}`);
    if (m[3]) return await renderObject(srv, m[1], null, new URLSearchParams(query || ''));
    if (m[2] !== undefined) return await renderObject(srv, m[1], m[2]);
    return await renderList(srv, m[1], new URLSearchParams(query || ''));
  } catch (e) {
    app.innerHTML = `<div class="card"><div class="strip E">${esc(e.message)}</div></div>`;
  }
}
function renderBanner() {
  const d = workspace.diagnostics;
  document.getElementById('status').textContent = `v${workspace.version} · activated ${new Date(workspace.activatedAt).toLocaleTimeString()}`;
  document.getElementById('banner').innerHTML = d.errors.length
    ? `<div class="strip E" role="alert">Activation reported ${d.errors.length} error(s). <a href="#/_workspace">Open workspace</a></div>` : '';
}

// ------------------------------------------------------------------ launchpad
async function renderLaunchpad() {
  setActiveNav('apps');
  const tiles = [];
  for (const s of workspace.objects.services) {
    const m = await meta(s.name.toLowerCase());
    for (const set of Object.values(m.entitySets)) {
      if (set.transactional && !set.root) continue;
      let count = '';
      try { count = (await api('GET', `/odata/${s.name.toLowerCase()}/${set.name}?$top=0&$count=true`)).data['@odata.count']; } catch {}
      tiles.push(h`<a class="tile" href="#/${s.name.toLowerCase()}/${set.name}">
        <span class="t-title">${esc(set.ui.headerInfo?.typenameplural || set.label)}</span>
        <span class="t-sub">${esc(m.label)} · ${set.transactional ? 'Manage' : 'Display'}</span>
        <span class="t-kpi">${count}</span></a>`);
    }
  }
  app.innerHTML = h`<h1>Apps</h1>${tiles.length ? `<div class="tiles">${tiles.join("")}</div>` : `<div class="card empty">No services yet. Add a service definition (define service ...) to your workspace.</div>`}`;
}

// ------------------------------------------------------------------ list report
async function renderList(srv, setName, params) {
  setActiveNav('apps');
  const m = await meta(srv);
  const set = m.entitySets[setName];
  if (!set) throw new Error(`Entity set ${setName} not found`);
  const cols = columnsOf(set);
  const filters = set.ui.selectionFields.map(s => set.fields.find(f => f.name === s.value)).filter(Boolean);
  const actions = set.ui.lineItem.filter(i => i.type === '#FOR_ACTION').map(i => ({ ...i, def: set.actions.find(a => a.name.toLowerCase() === i.dataAction.toLowerCase()) })).filter(a => a.def);
  app.innerHTML = h`
    <div class="breadcrumb"><a href="#/">Apps</a> / ${esc(m.label)}</div>
    <h1>${esc(set.ui.headerInfo?.typenameplural || set.label)}</h1>
    <div class="card"><form class="filterbar" id="fb">
      <div class="field"><label for="f-search">Search</label><input class="input" id="f-search" name="$search" placeholder="Search" value="${esc(params.get('$search') || '')}"></div>
      ${filters.map(f => `<div class="field"><label for="f-${esc(f.name)}">${esc(f.label)}</label>${inputHtml(f, params.get(f.name) || '', { id: `f-${f.name}`, name: f.name, filter: true })}</div>`)}
      <button class="btn primary" type="submit">Go</button>
    </form></div>
    <div class="card">
      <div class="toolbar"><strong id="count"></strong><span class="spacer"></span>
        ${actions.map(a => `<button class="btn" data-action="${esc(a.def.name)}" disabled>${esc(a.label || a.def.label)}</button>`)}
        ${set.ops.create ? `<a class="btn primary" href="#/${srv}/${setName}/new">Create</a>` : ''}
        ${set.ops.delete ? `<button class="btn danger" id="del" disabled>Delete</button>` : ''}
      </div>
      <div id="msg"></div>
      <div class="table-wrap"><table><thead><tr><th class="sel"><input type="checkbox" id="all" aria-label="Select all"></th>
        ${cols.map(c => { const f = set.fields.find(x => x.name === c.value); return `<th class="${isNum(f) ? 'num' : ''}">${esc(c.label || label(set, c.value))}</th>`; })}
      </tr></thead><tbody id="rows"><tr><td colspan="99" class="empty">Loading…</td></tr></tbody></table></div>
    </div>`;
  const filterParts = [];
  for (const f of filters) {
    const v = params.get(f.name);
    const lit = f.abapType === 'n' && f.maxLength && /^\d+$/.test(v) ? v.padStart(f.maxLength, '0') : v;   // NUMC: shown without leading zeros
    if (v) filterParts.push(isNum(f) ? `${f.name} eq ${v}` : f.type === 'Edm.Date' ? `${f.name} eq ${v}` : `${f.name} eq '${lit.replace(/'/g, "''")}'`);
  }
  // draft-enabled: show drafts and active objects without a draft (like SAP Fiori elements)
  if (set.draft) filterParts.push('(IsActiveEntity eq false or SiblingEntity/IsActiveEntity eq null)');
  const q = new URLSearchParams({ $count: 'true', $top: '200' });
  if (filterParts.length) q.set('$filter', filterParts.join(' and '));
  if (params.get('$search')) q.set('$search', params.get('$search'));
  if (set.ui.sortOrder?.length) q.set('$orderby', set.ui.sortOrder.map(s => `${s.by} ${s.direction === '#DESC' ? 'desc' : 'asc'}`).join(','));
  const { data } = await api('GET', `/odata/${srv}/${setName}?${q}`);
  document.getElementById('count').textContent = `${esc(set.ui.headerInfo?.typenameplural || set.label)} (${data['@odata.count']})`;
  const tbody = document.getElementById('rows');
  tbody.innerHTML = data.value.length ? data.value.map((r, i) => h`<tr data-i="${i}"><td class="sel"><input type="checkbox" data-sel="${i}" aria-label="Select row"></td>
    ${cols.map((c, ci) => { const f = set.fields.find(x => x.name === c.value); return `<td class="${isNum(f) ? 'num' : ''}">${cellHtml(set, c, r)}${ci === 0 && r.IsActiveEntity === false ? ' <span class="status-pill crit-2">Draft</span>' : ''}</td>`; })}</tr>`).join('')
    : `<tr><td colspan="99" class="empty">No data found. ${set.ops.create ? 'Use Create to add the first entry.' : ''}</td></tr>`;
  const selected = () => [...tbody.querySelectorAll('[data-sel]:checked')].map(x => data.value[Number(x.dataset.sel)]);
  const updateButtons = () => {
    const n = selected().length;
    document.querySelectorAll('[data-action]').forEach(b => { b.disabled = n === 0; });
    const del = document.getElementById('del');
    if (del) del.disabled = n === 0;
  };
  tbody.addEventListener('click', e => {
    if (e.target.matches('input[type=checkbox]')) { updateButtons(); return; }
    const tr = e.target.closest('tr[data-i]');
    if (tr) location.hash = `#/${srv}/${setName}${keyPredicate(set, data.value[Number(tr.dataset.i)])}`;
  });
  document.getElementById('all').addEventListener('change', e => { tbody.querySelectorAll('[data-sel]').forEach(x => { x.checked = e.target.checked; }); updateButtons(); });
  fillValueHelps(document.getElementById('fb'));
  document.getElementById('fb').addEventListener('submit', e => {
    e.preventDefault();
    const p = new URLSearchParams();
    for (const [k, v] of new FormData(e.target)) if (v) p.set(k, v);
    location.hash = `#/${srv}/${setName}${p.toString() ? '?' + p : ''}`;
  });
  const msg = document.getElementById('msg');
  document.getElementById('del')?.addEventListener('click', async () => {
    const rows = selected();
    if (!confirm(`Delete ${rows.length} item(s)?`)) return;
    try { for (const r of rows) await api('DELETE', `/odata/${srv}/${setName}${keyPredicate(set, r)}`); toast(`${rows.length} item(s) deleted`); route(); }
    catch (e) { showErrors(msg, e); }
  });
  document.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', async () => {
    const def = set.actions.find(a => a.name === b.dataset.action);
    const param = def.parameters.length ? await paramDialog(def) : {};
    if (param === null) return;
    try {
      const msgs = [];
      for (const r of selected()) msgs.push(...(await api('POST', `/odata/${srv}/${setName}${keyPredicate(set, r)}/${def.name}`, param)).messages);
      toast(msgs.map(x => x.message).join(' · ') || `${def.label} executed`);
      route();
    } catch (e) { showErrors(msg, e); }
  }));
}

// ------------------------------------------------------------------ inputs
function inputHtml(f, value, { id, name, filter } = {}) {
  const attrs = `class="input" id="${esc(id || 'i-' + f.name)}" name="${esc(name || f.name)}" data-field="${esc(f.name)}"`;
  const v = value ?? '';
  if (f.type === 'Edm.Boolean') return `<select ${attrs}><option value=""></option><option value="true" ${v === true ? 'selected' : ''}>Yes</option><option value="false" ${v === false ? 'selected' : ''}>No</option></select>`;
  if (f.type === 'Edm.Date') return `<input type="date" ${attrs} value="${esc(v || '')}">`;
  if (f.type === 'Edm.DateTimeOffset') return `<input type="datetime-local" ${attrs} value="${esc(v ? String(v).slice(0, 16) : '')}">`;
  if (isNum(f)) return `<input type="number" step="${f.type === 'Edm.Decimal' ? 'any' : '1'}" ${attrs} value="${esc(v)}">`;
  // fixed values (@ObjectModel.resultSet.sizeCategory: #XS) -> drop-down, like SAP Fiori elements
  if (f.valueHelp?.fixed) return `<select ${attrs} data-vh="${esc(f.valueHelp.entity)}" data-el="${esc(f.valueHelp.element)}" data-value="${esc(f.abapType === 'n' && v ? String(v).replace(/^0+(?=\d)/, '') : v)}"><option value="">${filter ? '' : '—'}</option>${v ? `<option value="${esc(v)}" selected>${esc(v)}</option>` : ''}</select>`;
  const list = f.valueHelp ? `list="vh-${esc(f.name)}"` : '';
  const dl = f.valueHelp ? `<datalist id="vh-${esc(f.name)}" data-vh="${esc(f.valueHelp.entity)}" data-el="${esc(f.valueHelp.element)}"></datalist>` : '';
  const max = f.maxLength && !filter ? `maxlength="${f.maxLength}"` : '';
  return `<input type="text" ${attrs} ${list} ${max} value="${esc(f.abapType === 'n' && v ? String(v).replace(/^0+(?=\d)/, '') : v)}" autocomplete="off">${dl}`;
}
async function fillValueHelps(root) {
  for (const sel of root.querySelectorAll('select[data-vh]')) {
    try {
      const { data } = await api('GET', `/api/vh/${sel.dataset.vh}?top=200`);
      const el = sel.dataset.el, cur = sel.dataset.value || '';
      const opts = data.value.map(r => {
        const key = Object.keys(r).find(k => k.toLowerCase() === el.toLowerCase());
        const v = String(r[key] ?? '').replace(/^0+(?=\d)/, '');
        const text = Object.entries(r).filter(([k]) => k !== key).map(([, x]) => x).find(x => typeof x === 'string' && x);
        return `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(text ? `${text} (${v})` : v)}</option>`;
      }).join('');
      sel.innerHTML = sel.options[0].outerHTML.replace(' selected', '') + opts;
      if (cur) sel.value = cur;
    } catch { /* value help optional */ }
  }
  for (const dl of root.querySelectorAll('datalist[data-vh]')) {
    try {
      const { data } = await api('GET', `/api/vh/${dl.dataset.vh}?top=100`);
      const el = dl.dataset.el;
      dl.innerHTML = data.value.map(r => {
        const key = Object.keys(r).find(k => k.toLowerCase() === el.toLowerCase());
        const text = Object.entries(r).filter(([k]) => k !== key).map(([, v]) => v).filter(v => typeof v === 'string' && v).slice(0, 2).join(' · ');
        return `<option value="${esc(String(r[key]).replace(/^0+(?=\d)/, ''))}">${esc(text)}</option>`;
      }).join('');
    } catch { /* value help optional */ }
  }
}
function readInput(f, el) {
  const v = el.value;
  if (f.type === 'Edm.Boolean') return v === '' ? false : v === 'true';
  if (isNum(f)) return v === '' ? 0 : Number(v);
  if (f.type === 'Edm.Date') return v || null;
  if (f.type === 'Edm.DateTimeOffset') return v ? new Date(v).toISOString() : null;
  if (f.abapType === 'n' && v) return v.padStart(f.maxLength || v.length, '0');
  return v;
}
function paramDialog(def) {
  const dlg = document.getElementById('dialog');
  dlg.innerHTML = h`<form method="dialog"><div class="d-head">${esc(def.label)}</div><div class="d-body">
    ${def.parameters.map(p => `<div class="field" style="max-width:none"><label for="p-${esc(p.name)}">${esc(p.label)}</label>${inputHtml(p, '', { id: 'p-' + p.name })}</div>`)}
    </div><div class="d-foot"><button class="btn" value="cancel">Cancel</button><button class="btn primary" value="ok">${esc(def.label)}</button></div></form>`;
  dlg.showModal();
  return new Promise(res => dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return res(null);
    const out = {};
    for (const p of def.parameters) out[p.name] = readInput(p, dlg.querySelector(`#p-${CSS.escape(p.name)}`));
    res(out);
  }, { once: true }));
}

// ------------------------------------------------------------------ object page
async function renderObject(srv, setName, keyPred, createParams) {
  setActiveNav('apps');
  const m = await meta(srv);
  const set = m.entitySets[setName];
  if (!set) throw new Error(`Entity set ${setName} not found`);
  const creating = !keyPred;
  let row = {};
  let features = { update: set.ops.update, delete: set.ops.delete, actions: {}, assocs: {}, fields: {} };
  if (!creating) {
    row = (await api('GET', `/odata/${srv}/${setName}(${keyPred})`)).data;
    if (set.transactional) { try { features = (await api('GET', `/odata/${srv}/${setName}(${keyPred})/$features`)).data; } catch {} }
  }
  const hi = set.ui.headerInfo || {};
  const titleField = set.fields.find(f => f.name === hi.title?.value);
  const rawTitle = creating ? `New ${hi.typename || set.label}` : (row[hi.title?.value] ?? row[set.keys[0]]);
  const title = !creating && titleField?.abapType === 'n' ? String(rawTitle).replace(/^0+(?=\d)/, '') : rawTitle;
  const desc = creating ? '' : row[hi.description?.value] ?? '';
  const parentNav = set.navigation.find(n => n.toParent);
  const isDraft = !!set.draft && !creating && row.IsActiveEntity === false;
  let editing = creating || isDraft;
  const activeKey = () => keyPredicate(set, { ...row, IsActiveEntity: true });

  const facets = set.ui.facets.length ? set.ui.facets : [{ id: 'main', type: '#IDENTIFICATION_REFERENCE', label: 'General Information' }];
  const top = facets.filter(f => !f.parentId);
  const childrenOf = id => facets.filter(f => f.parentId === id);
  const fieldsForFacet = f => {
    if (f.type === '#IDENTIFICATION_REFERENCE') {
      const items = set.ui.identification.filter(i => i.type === '#STANDARD');
      return items.length ? items : set.fields.filter(x => !x.hidden).map(x => ({ value: x.name }));
    }
    if (f.type === '#FIELDGROUP_REFERENCE') return set.ui.fieldGroups[f.targetQualifier] || [];
    return [];
  };
  const actions = set.ui.identification.filter(i => i.type === '#FOR_ACTION').map(i => ({ ...i, def: set.actions.find(a => a.name.toLowerCase() === i.dataAction.toLowerCase()) })).filter(a => a.def);

  const formHtml = (items) => `<div class="form">${items.map(it => {
    const f = set.fields.find(x => x.name === it.value);
    if (!f || f.hidden) return '';
    const readonly = f.readonly || features.fields?.[f.name] === 'readonly' || (!creating && f.readonlyUpdate);
    const mandatory = f.mandatory || features.fields?.[f.name] === 'mandatory';
    const lbl = `<label for="i-${esc(f.name)}">${esc(it.label || f.label)}${editing && mandatory && !readonly ? ' <span class="req">*</span>' : ''}</label>`;
    if (editing && !readonly) return `<div class="field">${lbl}${inputHtml(f, row[f.name])}</div>`;
    return `<div class="field">${lbl}<div class="value">${it.criticality ? cellHtml(set, it, row) : fmt(f, row[f.name], row)}</div></div>`;
  }).join('')}</div>`;

  const sectionHtml = (f) => {
    if (f.type === '#COLLECTION') return `<section class="card" id="s-${esc(f.id)}"><h2>${esc(f.label || '')}</h2>${childrenOf(f.id).map(c => `<div class="subsection">${c.label ? `<h3>${esc(c.label)}</h3>` : ''}${c.type === '#LINEITEM_REFERENCE' ? `<div data-lineitem="${esc(c.targetElement)}"></div>` : formHtml(fieldsForFacet(c))}</div>`).join('')}</section>`;
    if (f.type === '#LINEITEM_REFERENCE') return creating ? '' : `<section class="card" id="s-${esc(f.id)}"><div data-lineitem="${esc(f.targetElement)}" data-label="${esc(f.label || '')}"></div></section>`;
    return `<section class="card" id="s-${esc(f.id)}"><h2>${esc(f.label || '')}</h2>${formHtml(fieldsForFacet(f))}</section>`;
  };

  const draw = () => {
    app.innerHTML = h`
      <div class="breadcrumb"><a href="#/">Apps</a> / <a href="#/${srv}/${parentNav ? parentNav.target : setName}">${esc(parentNav ? (m.entitySets[parentNav.target]?.ui.headerInfo?.typenameplural || parentNav.target) : (hi.typenameplural || set.label))}</a></div>
      <div class="card"><div class="op-header">
        <div><div class="type">${esc(hi.typename || set.label)}</div><div class="title">${esc(title ?? '')}</div><div class="desc">${esc(desc)}</div></div>
        <div class="toolbar" style="margin:0">
          ${isDraft ? '<span class="status-pill crit-2">Draft</span>' : ''}
          ${features.lockedBy ? `<span class="status-pill crit-1">Locked by ${esc(features.lockedBy)}</span>` : ''}
          ${editing ? `<button class="btn primary" id="save">${creating ? 'Create' : isDraft && !set.draftRoot ? 'Apply' : 'Save'}</button><button class="btn" id="cancel">${isDraft && set.draftRoot ? 'Discard draft' : 'Cancel'}</button>` : h`
            ${actions.map(a => `<button class="btn" data-action="${esc(a.def.name)}" ${features.actions?.[a.def.name] === false ? 'disabled title="Not available in the current state"' : ''}>${esc(a.label || a.def.label)}</button>`)}
            ${set.ops.update ? `<button class="btn primary" id="edit" ${features.update === false ? 'disabled title="Editing is not possible in the current state"' : ''}>Edit</button>` : ''}
            ${set.ops.delete || (parentNav && set.transactional) ? `<button class="btn danger" id="delete" ${features.delete === false ? 'disabled title="Deletion is not possible in the current state"' : ''}>Delete</button>` : ''}`}
        </div></div>
        ${top.length > 1 ? `<nav class="tabs">${top.map((f, i) => `<a href="#" data-tab="s-${esc(f.id)}" class="${i ? '' : 'active'}">${esc(f.label || f.id)}</a>`).join('')}</nav>` : ''}
      </div>
      <div id="msg"></div>
      ${top.map(sectionHtml)}`;
    wire();
  };

  const wire = () => {
    const msg = document.getElementById('msg');
    if (pendingError) { showErrors(msg, pendingError); pendingError = null; }
    fillValueHelps(app);
    document.querySelectorAll('[data-tab]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault();
      document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('active', x === a));
      document.getElementById(a.dataset.tab)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
    document.getElementById('edit')?.addEventListener('click', async () => {
      if (!set.draftRoot) { editing = true; draw(); return; }
      try {
        // draft: open the existing draft or create one with the Edit action
        const res = row.HasDraftEntity ? { data: { ...row, IsActiveEntity: false } } : await api('POST', `/odata/${srv}/${setName}${activeKey()}/Edit`, { PreserveChanges: true });
        location.hash = `#/${srv}/${setName}${keyPredicate(set, res.data)}`;
      } catch (e) { showErrors(document.getElementById('msg'), e); }
    });
    document.getElementById('cancel')?.addEventListener('click', async () => {
      if (isDraft && set.draftRoot) {
        if (!confirm('Discard all changes of this draft?')) return;
        await api('DELETE', `/odata/${srv}/${setName}(${keyPred})`);
        toast('Draft discarded');
        location.hash = row.HasActiveEntity ? `#/${srv}/${setName}${activeKey()}` : `#/${srv}/${setName}`;
        return;
      }
      if (creating || isDraft) history.back(); else { editing = false; draw(); }
    });
    document.getElementById('save')?.addEventListener('click', async () => {
      const body = {};
      for (const el of app.querySelectorAll('.form [data-field]')) {
        const f = set.fields.find(x => x.name === el.dataset.field);
        const v = readInput(f, el);
        if (creating ? (v !== '' && v !== null && v !== 0 && v !== false) : JSON.stringify(v) !== JSON.stringify(row[f.name])) body[f.name] = v;
      }
      try {
        let res;
        if (creating) {
          const parent = createParams?.get('parent');
          const nav = createParams?.get('nav');
          res = parent ? await api('POST', `/odata/${srv}/${parent}/${nav}`, body) : await api('POST', `/odata/${srv}/${setName}`, body);
          if (set.draft && res.data.IsActiveEntity === false) {
            if (parent) { toast('Added to the draft'); history.back(); return; }
            // new draft root: activate right away; on errors stay in the draft to fix them
            const draftKey = keyPredicate(set, res.data);
            try {
              const act = await api('POST', `/odata/${srv}/${setName}${draftKey}/Activate`, {});
              toast(act.messages.map(x => x.message).join(' · ') || `${hi.typename || 'Object'} created`);
              location.hash = `#/${srv}/${setName}${keyPredicate(set, act.data)}`;
            } catch (e) { pendingError = e; location.hash = `#/${srv}/${setName}${draftKey}`; }
            return;
          }
          toast(res.messages.map(x => x.message).join(' · ') || `${hi.typename || 'Object'} created`);
          location.hash = `#/${srv}/${setName}${keyPredicate(set, res.data)}`;
        } else {
          if (Object.keys(body).length || !isDraft) res = await api('PATCH', `/odata/${srv}/${setName}(${keyPred})`, body);
          if (isDraft && set.draftRoot) {
            const act = await api('POST', `/odata/${srv}/${setName}(${keyPred})/Activate`, {});
            toast(act.messages.map(x => x.message).join(' · ') || 'Changes saved');
            location.hash = `#/${srv}/${setName}${keyPredicate(set, act.data)}`;
            return;
          }
          if (isDraft) { toast('Applied to the draft'); history.back(); return; }
          toast(res.messages.map(x => x.message).join(' · ') || 'Changes saved');
          route();
        }
      } catch (e) { showErrors(msg, e); }
    });
    document.getElementById('delete')?.addEventListener('click', async () => {
      if (!confirm(`Delete ${title}?`)) return;
      try {
        await api('DELETE', `/odata/${srv}/${setName}(${keyPred})`);
        toast('Deleted');
        if (parentNav) history.back(); else location.hash = `#/${srv}/${setName}`;
      } catch (e) { showErrors(msg, e); }
    });
    document.querySelectorAll('.op-header [data-action]').forEach(b => b.addEventListener('click', async () => {
      const def = set.actions.find(a => a.name === b.dataset.action);
      const param = def.parameters.length ? await paramDialog(def) : {};
      if (param === null) return;
      try {
        const res = await api('POST', `/odata/${srv}/${setName}(${keyPred})/${def.name}`, param);
        toast(res.messages.map(x => x.message).join(' · ') || `${def.label} executed`);
        route();
      } catch (e) { showErrors(msg, e); }
    }));
    if (!creating) for (const el of app.querySelectorAll('[data-lineitem]')) renderSubTable(srv, m, set, keyPred, el, features);
  };
  draw();
}

async function renderSubTable(srv, m, set, keyPred, el, features) {
  const nav = set.navigation.find(n => n.name.toLowerCase() === el.dataset.lineitem.toLowerCase());
  if (!nav) { el.innerHTML = `<div class="strip W">Navigation ${esc(el.dataset.lineitem)} is not exposed</div>`; return; }
  const target = m.entitySets[nav.target];
  if (!target) { el.innerHTML = `<div class="strip W">Entity ${esc(nav.targetEntity)} is not exposed in the service</div>`; return; }
  const cols = columnsOf(target);
  const { data } = await api('GET', `/odata/${srv}/${set.name}(${keyPred})/${nav.name}`);
  // in draft-enabled BOs children are created inside the parent's draft only
  const canCreate = nav.create && features.assocs?.[nav.name] !== false && (!set.draft || /IsActiveEntity=false/.test(keyPred));
  el.innerHTML = h`<div class="toolbar"><h2 style="margin:0">${esc(el.dataset.label || target.ui.headerInfo?.typenameplural || nav.name)} (${data.value.length})</h2><span class="spacer"></span>
    ${canCreate ? `<a class="btn" href="#/${srv}/${target.name}/new?parent=${encodeURIComponent(set.name + '(' + keyPred + ')')}&nav=${encodeURIComponent(nav.name)}">Create</a>` : ''}</div>
    <div class="table-wrap"><table><thead><tr>${cols.map(c => { const f = target.fields.find(x => x.name === c.value); return `<th class="${isNum(f) ? 'num' : ''}">${esc(c.label || label(target, c.value))}</th>`; })}</tr></thead>
    <tbody>${data.value.length ? data.value.map((r, i) => `<tr data-i="${i}">${cols.map(c => { const f = target.fields.find(x => x.name === c.value); return `<td class="${isNum(f) ? 'num' : ''}">${cellHtml(target, c, r)}</td>`; }).join('')}</tr>`).join('') : '<tr><td colspan="99" class="empty">No items</td></tr>'}</tbody></table></div>`;
  el.querySelector('tbody').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-i]');
    if (tr) location.hash = `#/${srv}/${target.name}${keyPredicate(target, data.value[Number(tr.dataset.i)])}`;
  });
}

// ------------------------------------------------------------------ workspace
async function renderWorkspace() {
  setActiveNav('workspace');
  const w = workspace;
  const d = w.diagnostics;
  const o = w.objects;
  app.innerHTML = h`<h1>Workspace</h1>
    <div class="card"><div class="toolbar"><div><strong>${esc(w.dir)}</strong><div class="muted">Activation v${w.version} in ${w.activationMs} ms · ${d.errors.length} error(s) · ${d.warnings.length} warning(s)</div></div><span class="spacer"></span><button class="btn primary" id="act">Activate all</button></div>
    ${d.errors.length || d.warnings.length ? `<div class="diag">${d.errors.map(e => `<div class="e">ERROR ${esc(e.file)}${e.line ? ':' + e.line : ''} ${esc(e.message)}</div>`).join('')}${d.warnings.map(e => `<div class="w">warning ${esc(e.file)}${e.line ? ':' + e.line : ''} ${esc(e.message)}</div>`).join('')}</div>` : '<div class="strip S">All objects are active and consistent.</div>'}</div>
    <div class="grid2">
      <div class="card"><h2>Services</h2><ul class="obj-list">${o.services.map(s => `<li><strong>${esc(s.name)}</strong> ${s.entitySets.map(e => `<a class="tag" href="#/${esc(s.name.toLowerCase())}/${esc(e)}">${esc(e)}</a>`).join(' ')} <a class="muted" href="${BASE}/odata/${esc(s.name.toLowerCase())}/$metadata" target="_blank">metadata</a></li>`).join('') || '<li class="muted">none</li>'}</ul>
      <h2 style="margin-top:16px">Behavior definitions</h2><ul class="obj-list">${o.behaviors.map(b => `<li><strong>${esc(b.name)}</strong><span class="tag">${esc(b.type)}</span><span class="muted">${esc(b.entities.join(', '))}</span></li>`).join('') || '<li class="muted">none</li>'}</ul></div>
      <div class="card"><h2>CDS entities</h2><ul class="obj-list">${o.views.map(v => `<li><strong>${esc(v.name)}</strong>${v.root ? '<span class="tag">root</span>' : ''}${v.projection ? '<span class="tag">projection</span>' : ''}${v.behavior ? '<span class="tag">behavior</span>' : ''}${v.broken ? '<span class="tag err">inactive</span>' : ''}</li>`).join('')}${o.tables.map(t => `<li><strong>${esc(t.name)}</strong><span class="tag">table</span><span class="muted">${t.fields} fields</span></li>`).join('')}</ul></div>
      <div class="card"><h2>Classes</h2><ul class="obj-list">${o.classes.map(c => `<li><strong>${esc(c.name)}</strong>${c.superName ? `<span class="muted">→ ${esc(c.superName)}</span>` : ''}<span class="spacer"></span>${c.classrun ? `<button class="btn" data-run="${esc(c.name)}">Run</button>` : ''}<button class="btn ghost" data-js="${esc(c.name)}">JavaScript</button></li>`).join('') || '<li class="muted">none</li>'}</ul></div>
    </div>
    <div class="card" id="out" hidden><h2 id="out-title"></h2><pre class="code" id="out-body"></pre></div>`;
  document.getElementById('act').addEventListener('click', async () => { await api('POST', '/api/activate'); metaCache.clear(); toast('Activated'); route(); });
  const out = document.getElementById('out');
  document.querySelectorAll('[data-run]').forEach(b => b.addEventListener('click', async () => {
    const { data } = await api('POST', `/api/run/${b.dataset.run}`);
    out.hidden = false;
    document.getElementById('out-title').textContent = `Console: ${b.dataset.run} (${data.ms} ms)`;
    document.getElementById('out-body').textContent = data.output + (data.ok ? '' : `\n\n${data.error}`);
  }));
  document.querySelectorAll('[data-js]').forEach(b => b.addEventListener('click', async () => {
    const r = await fetch(`${BASE}/api/js/${b.dataset.js}`);
    out.hidden = false;
    document.getElementById('out-title').textContent = `Generated JavaScript: ${b.dataset.js}`;
    document.getElementById('out-body').textContent = await r.text();
  }));
}
