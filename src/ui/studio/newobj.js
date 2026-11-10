// Creating objects by hand, like ADT's "New" wizards: the New Object dialog (every object kind, grouped like ADT,
// with a short form per kind, a preview of the files, then create + activate + open) and the RAP business object
// generator (a table -> views, behavior with draft, service, Fiori elements app). The server builds the files
// (src/server/generate.js); the studio opens what was created and shows the activation result.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// a field label from a description: the whole words that fit
export function labelFrom(d, max) {
  const t = String(d || '').trim();
  if (t.length <= max) return t;
  let out = '';
  for (const w of t.split(/\s+/)) { if ((out ? `${out} ${w}` : w).length > max) break; out = out ? `${out} ${w}` : w; }
  return out || t.slice(0, max);
}

// tree folders (ADT groups) -> the kind created there
export const FOLDER_KIND = {
  'Database Tables': 'table', 'Data Elements': 'dtel', Domains: 'doma', 'Table Types': 'ttyp', 'Lock Objects': 'enqu',
  'Data Definitions': 'view', 'Metadata Extensions': 'ddlx', 'Access Controls': 'dcls', 'Behavior Definitions': 'bdef',
  Classes: 'class', Interfaces: 'intf', 'Service Definitions': 'srvd', 'Message Classes': 'msag',
  'Reports and Module Pools': 'report', 'Function Groups': 'fugr', 'Print Forms': 'xdpform', Transformations: 'xslt',
  Structures: 'stru', Transactions: 'tran', 'Form Interfaces': 'sfpi',
};

// in-app dialogs (the native confirm / prompt are suppressed in embedded browsers): resolve true / the text, or null
// with select: {label, value, options: [[value, text]]} it resolves { value, choice } (the input's text and the selection)
export function askDialog({ title, text = '', input = null, select = null, ok = 'OK', danger = false }) {
  return new Promise(resolve => {
    document.querySelector('.no-ov.no-ask')?.remove();
    const ov = document.createElement('div');
    ov.className = 'no-ov no-ask';
    ov.innerHTML = `<div class="no-dlg" role="dialog" aria-modal="true" aria-labelledby="askT"><div class="no-head"><strong id="askT">${esc(title)}</strong></div>
      <div class="no-form no-solo">${text ? `<p class="ask-text">${esc(text).replace(/\n/g, '<br>')}</p>` : ''}${input !== null ? `<label>${esc(input.label || '')}<input id="askIn" value="${esc(input.value || '')}" placeholder="${esc(input.placeholder || '')}" spellcheck="false" autocomplete="off"></label>` : ''}${select ? `<label>${esc(select.label || '')}<select id="askSel">${select.options.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(select.value) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>` : ''}
      <div class="no-err" hidden></div>
      <div class="no-acts"><span class="spacer"></span><button class="btn sm ghost" data-r="no">Cancel</button><button class="btn sm ${danger ? 'danger' : 'primary'}" data-r="ok">${esc(ok)}</button></div></div></div>`;
    document.body.appendChild(ov);
    const inp = ov.querySelector('#askIn');
    const done = v => { ov.remove(); document.removeEventListener('keydown', key, true); resolve(v); };
    const okv = () => {
      const sel = ov.querySelector('#askSel');
      if (!inp) return done(sel ? { value: null, choice: sel.value } : true);
      const err = input.validate?.(inp.value.trim());
      if (err) { const e = ov.querySelector('.no-err'); e.hidden = false; e.textContent = err; return; }
      done(sel ? { value: inp.value.trim(), choice: sel.value } : inp.value.trim());
    };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } if (e.key === 'Enter' && (inp ? document.activeElement === inp || document.activeElement?.id === 'askSel' : true)) { e.preventDefault(); okv(); } };
    document.addEventListener('keydown', key, true);
    ov.querySelector('[data-r="no"]').onclick = () => done(null);
    ov.querySelector('[data-r="ok"]').onclick = okv;
    ov.addEventListener('mousedown', e => { if (e.target === ov) done(null); });
    if (inp) { inp.focus(); inp.select(); } else ov.querySelector('[data-r="ok"]').focus();
  });
}

export function mountNewObject({ app, api, toast, done }) {
  let meta = null;
  const load = async () => (meta = await api('GET', `/a/${app()}/api/generate/kinds`));

  function modal(html, cls = '') {
    document.querySelector('.no-ov')?.remove();
    const ov = document.createElement('div');
    ov.className = 'no-ov';
    ov.innerHTML = `<div class="no-dlg ${cls}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(ov);
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });
    ov.querySelectorAll('[data-close]').forEach(b => { b.onclick = close; });
    return { el: ov.querySelector('.no-dlg'), close };
  }

  // a field of a kind's form
  function fieldHtml(f) {
    const id = `no_${f.k}`;
    const val = x => (Array.isArray(x) ? x : [x, x]);
    const opt = (list, v) => list.map(x => { const [k, l] = val(x); return `<option value="${esc(k)}"${String(v) === String(k) ? ' selected' : ''}>${esc(l)}</option>`; }).join('');
    const tables = meta.tables.map(t => t.name.toUpperCase()), views = meta.views.map(v => v.name);
    const show = f.show ? ` data-show="${esc(f.show)}"` : '';
    const help = f.help ? `<small class="no-help">${esc(f.help)}</small>` : '';
    // the app's objects as suggestions of a free input (a standard object can be typed too)
    const suggest = list => `<label${show}>${esc(f.label)}<input id="${id}" data-k="${f.k}" list="${id}_l" placeholder="${esc(f.placeholder || '')}" spellcheck="false" autocomplete="off" class="mono up"><datalist id="${id}_l">${list.map(x => `<option value="${esc(String(x).toUpperCase())}">`).join('')}</datalist>${help}</label>`;
    const def = f.rap ? (meta.flavor === 'rap' && f.default) : meta.flavor === 'classic' && f.rapDefault ? f.rapDefault : f.default;
    switch (f.type) {
      case 'checkbox': return `<label class="no-chk"${show}><input type="checkbox" id="${id}" data-k="${f.k}"${def ? ' checked' : ''}> ${esc(f.label)}</label>`;
      case 'textarea': return `<label${show}>${esc(f.label)}<textarea id="${id}" data-k="${f.k}" rows="5" class="mono" spellcheck="false" placeholder="${esc(f.placeholder || '')}">${esc(f.default || '')}</textarea>${help}</label>`;
      case 'select': return `<label${show}>${esc(f.label)}<select id="${id}" data-k="${f.k}">${opt(f.options, def)}</select>${help}</label>`;
      case 'number': return `<label${show}>${esc(f.label)}<input type="number" min="0" id="${id}" data-k="${f.k}" value="${esc(f.default ?? '')}"></label>`;
      case 'table': return `<label${show}>${esc(f.label)}<select id="${id}" data-k="${f.k}"><option value=""></option>${opt(tables)}</select></label>`;
      case 'view': return `<label${show}>${esc(f.label)}<select id="${id}" data-k="${f.k}"><option value=""></option>${opt(views)}</select></label>`;
      case 'source': return `<label${show}>${esc(f.label)}<select id="${id}" data-k="${f.k}"><option value=""></option><optgroup label="Tables">${opt(tables)}</optgroup><optgroup label="Views">${opt(views)}</optgroup></select></label>`;
      case 'service': return `<label${show}>${esc(f.label)}<select id="${id}" data-k="${f.k}"><option value=""></option>${opt(meta.services)}</select>${meta.services.length ? '' : '<small class="no-help">No service definition in this app yet.</small>'}</label>`;
      case 'bdef': return `<label${show}>${esc(f.label)}<select id="${id}" data-k="${f.k}"><option value=""></option>${opt(meta.bdefs.map(b => b.toUpperCase()))}</select></label>`;
      case 'program': return `<label${show}>${esc(f.label)}<select id="${id}" data-k="${f.k}"><option value=""></option>${opt((meta.programs || []).map(p => [p.name, `${p.name.toUpperCase()} · ${p.subc === 'M' ? 'module pool' : 'report'}`]))}</select></label>`;
      case 'sfpi': return `<label${show}>${esc(f.label)}<select id="${id}" data-k="${f.k}"><option value="">(new interface from the parameters below)</option>${opt(meta.interfaces || [])}</select></label>`;
      case 'domain': return suggest(meta.domains || []);
      case 'msag': return suggest(meta.messageClasses || []);
      case 'type': return suggest([...(meta.structures || []), ...tables, ...(meta.dataElements || [])]);
      // methods of a class: a row per method (name, visibility, static, parameters, exceptions)
      case 'methods': return `<fieldset class="no-methods" data-k="${f.k}"${show}><legend>${esc(f.label)} <small class="no-help">(definition and empty implementation)</small></legend><div class="no-mrows"></div><button type="button" class="btn sm" data-addm>+ Method</button></fieldset>`;
      case 'views': return `<fieldset${show}><legend>${esc(f.label)}</legend><div class="no-multi" data-k="${f.k}">${views.map(v => `<label class="no-chk"><input type="checkbox" value="${esc(v)}"> ${esc(v)}</label>`).join('') || '<span class="muted">No views yet</span>'}</div></fieldset>`;
      default: return `<label${show}>${esc(f.label)}<input id="${id}" data-k="${f.k}" value="${esc(f.default ?? '')}" placeholder="${esc(f.placeholder || '')}"${f.maxlength ? ` maxlength="${f.maxlength}"` : ''}${f.fromDescription ? ` data-from="${f.fromDescription}"` : ''} spellcheck="false" autocomplete="off">${help}</label>`;
    }
  }
  const valuesOf = el => {
    const o = {};
    el.querySelectorAll('[data-k]').forEach(i => {
      if (i.closest('[data-show]')?.hidden) return;
      if (i.classList.contains('no-multi')) o[i.dataset.k] = [...i.querySelectorAll('input:checked')].map(c => c.value).join(',');
      else if (i.classList.contains('no-methods')) o[i.dataset.k] = JSON.stringify([...i.querySelectorAll('.no-mrow')].map(r => Object.fromEntries([...r.querySelectorAll('[data-m]')].map(x => [x.dataset.m, x.type === 'checkbox' ? x.checked : x.value]))).filter(m => m.name.trim()));
      else o[i.dataset.k] = i.type === 'checkbox' ? i.checked : i.value;
    });
    return o;
  };
  // the search: exact or prefix matches of the label first, then words, then anywhere (label, group, icon)
  const rank = (k, q) => { const l = k.label.toLowerCase(); return l === q ? 0 : l.startsWith(q) ? 1 : l.split(/[\s(]+/).some(w => w.startsWith(q)) ? 2 : `${l} ${k.group} ${k.icon} ${k.id}`.toLowerCase().includes(q) ? 3 : 9; };

  // the result of a creation: open the object, report the activation
  async function created(r) {
    load().catch(() => {});
    if (r.errors?.length) toast(`${r.errors.length} activation error(s): see the object`);
    else toast(`Created and activated: ${r.files.length} file(s)`);
    await done(r);
  }

  // ---------------------------------------------------------------- New Object
  // preset: values for the form (e.g. the group of a new function module)
  async function openNew(preselect, preset = {}) {
    // the dialog opens at once; the kinds come while the user types the search (nothing typed is lost)
    const { el, close } = modal(`<div class="no-head"><strong>New object</strong><span class="spacer"></span><button class="btn sm ghost" data-close aria-label="Close">✕</button></div>
      <div class="no-body"><div class="no-list"><input class="no-search" placeholder="Search object types…" spellcheck="false" aria-label="Search object types">
        <div class="no-kinds" role="listbox"><p class="muted no-pad">Loading…</p></div></div>
        <div class="no-form"><p class="muted">Choose what to create. Type to search, ↑ ↓ and Enter to choose.</p></div></div>`, 'no-wide');
    const search = el.querySelector('.no-search');
    if (!preselect) search.focus();
    // Enter before the kinds are there: chosen once they are
    let pendingEnter = false, typed = '';
    search.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); pendingEnter = true; return; }
      // what is typed after that Enter is the name of the new object
      if (pendingEnter && e.key.length === 1 && !e.metaKey && !e.ctrlKey) { e.preventDefault(); typed += e.key; }
    };
    // the kinds of the last opening right away; fresh ones (new tables, domains …) before the form is drawn
    if (!meta) await load(); else load().catch(() => {});   // the app's objects are reloaded after every creation
    if (!el.isConnected) return;
    const groups = [...new Set(meta.kinds.map(k => k.group))];
    const kinds = el.querySelector('.no-kinds');
    kinds.innerHTML = `${groups.map(g => `<div class="no-g">${esc(g)}</div>${meta.kinds.filter(k => k.group === g).map(k => `<a href="#" class="no-k" role="option" data-kind="${k.id}"><span class="no-ic">${esc(k.icon)}</span>${esc(k.label)}</a>`).join('')}`).join('')}<p class="muted no-pad no-none" hidden>No object type matches. Try "table", "structure", "class" or "form".</p>`;
    const form = el.querySelector('.no-form');
    let current = null;
    const select = id => {
      const k = meta.kinds.find(x => x.id === id);
      if (!k) return;
      current = id;
      el.querySelectorAll('.no-k').forEach(a => a.classList.toggle('on', a.dataset.kind === id));
      const nameFromSource = !!k.nameFrom;
      const basic = k.fields.filter(f => !f.advanced), adv = k.fields.filter(f => f.advanced);
      form.innerHTML = `<h3>${esc(k.label)}</h3>
        ${nameFromSource ? '' : `<label>Name<input id="no_name" data-k="name" class="mono up" placeholder="${esc(k.prefix || 'Z')}…" spellcheck="false" autocomplete="off"></label>`}
        ${basic.map(f => fieldHtml(f)).join('')}
        ${adv.length ? `<details class="no-adv"><summary>Technical settings</summary>${adv.map(f => fieldHtml(f)).join('')}</details>` : ''}
        <div class="no-err" hidden role="alert"></div>
        <div class="no-files" hidden></div>
        <div class="no-acts"><button class="btn sm" data-a="preview">Preview files</button><span class="spacer"></span><button class="btn sm ghost" data-close>Cancel</button><button class="btn sm primary" data-a="create">Create and activate</button></div>`;
      form.querySelectorAll('[data-close]').forEach(b => { b.onclick = close; });
      for (const [kk, v] of Object.entries(preset)) { const i = form.querySelector(`[data-k="${kk}"]`); if (i) { if (i.type === 'checkbox') i.checked = !!v; else i.value = v; } }
      // conditional fields: data-show="source=interface"
      const showAll = () => form.querySelectorAll('[data-show]').forEach(x => { const not = x.dataset.show.includes('!='); const [kk, v] = x.dataset.show.split(not ? '!=' : '='); const i = form.querySelector(`[data-k="${kk}"]`); x.hidden = !!i && (not ? i.value.trim() === v : i.value !== v); });
      showAll();
      form.querySelectorAll('.no-methods').forEach(box => {
        const rows = box.querySelector('.no-mrows');
        const add = () => {
          rows.insertAdjacentHTML('beforeend', `<div class="no-mrow"><input data-m="name" class="mono" placeholder="method" aria-label="Method name" spellcheck="false"><select data-m="visibility" aria-label="Visibility"><option>public</option><option>protected</option><option>private</option></select><label class="no-chk"><input type="checkbox" data-m="static"> static</label>
            <input data-m="params" class="mono no-mwide" placeholder="importing iv_ebeln type zpo_ebeln returning value(rs_po) type zpo_s_po" aria-label="Parameters" spellcheck="false"><input data-m="raising" class="mono" placeholder="raising zcx_…" aria-label="Exceptions" spellcheck="false"><button type="button" class="btn sm ghost" data-delm aria-label="Remove the method">✕</button></div>`);
          const r = rows.lastElementChild;
          r.querySelector('[data-delm]').onclick = () => { r.remove(); form.dispatchEvent(new Event('input')); };
          r.querySelector('[data-m="name"]').focus();
        };
        box.querySelector('[data-addm]').onclick = add;
      });
      const nm = form.querySelector('#no_name');
      if (nm) {
        // the prefix is a suggestion: selected, so typing the whole name replaces it
        nm.value = preset.name || (k.prefix && k.prefix !== 'Z' ? k.prefix : '');
        nm.focus(); nm.select();
        nm.addEventListener('input', () => { const p = nm.selectionStart; nm.value = nm.value.toUpperCase(); nm.setSelectionRange(p, p); });
      }
      // preset values (a new function module in a group): the first empty field gets the cursor
      if (preset.name) { const next = [...form.querySelectorAll('input[data-k]:not([type=checkbox]), textarea[data-k]')].find(i => i !== nm && !i.value && !i.closest('[data-show]')?.hidden); const fm = id === 'fugr' ? form.querySelector('#no_fm') : null; (fm || next)?.focus(); }
      form.querySelectorAll('input.up').forEach(i => { if (i !== nm) i.addEventListener('input', () => { const p = i.selectionStart; i.value = i.value.toUpperCase(); i.setSelectionRange(p, p); }); });
      // labels of a data element: from the description until typed
      const desc = form.querySelector('[data-k="description"]');
      const fill = () => form.querySelectorAll('[data-from]').forEach(i => { if (!i.dataset.typed) i.placeholder = labelFrom(desc?.value || '', Number(i.dataset.from)); });
      form.querySelectorAll('[data-from]').forEach(i => i.addEventListener('input', () => { i.dataset.typed = i.value ? '1' : ''; }));
      desc?.addEventListener('input', fill); fill();
      const err = form.querySelector('.no-err');
      let shown = false;
      const run = async write => {
        err.hidden = true;
        const btn = form.querySelector(write ? '[data-a="create"]' : '[data-a="preview"]');
        btn.disabled = true;
        try {
          const vals = valuesOf(form);
          form.querySelectorAll('[data-from]').forEach(i => { if (!i.value) vals[i.dataset.k] = i.placeholder; });
          const r = await api('POST', `/a/${app()}/api/generate/object`, { kind: id, ...vals, write });
          if (!write) {
            const box = form.querySelector('.no-files');
            box.hidden = false; shown = true;
            box.innerHTML = `<div class="no-tabs">${r.files.map((f, i) => `<button class="${i ? '' : 'on'}" data-i="${i}">${esc(f.replace(/^src\//, ''))}</button>`).join('')}</div><pre class="no-pre">${esc(r.preview[r.files[0]])}</pre>${r.notes.length ? `<p class="muted">${r.notes.map(esc).join('<br>')}</p>` : ''}`;
            box.querySelectorAll('[data-i]').forEach(b => { b.onclick = () => { box.querySelectorAll('[data-i]').forEach(x => x.classList.toggle('on', x === b)); box.querySelector('.no-pre').textContent = r.preview[r.files[b.dataset.i]]; }; });
            return;
          }
          close();
          await created(r);
        } catch (e) { err.hidden = false; err.textContent = e.message; if (!write) form.querySelector('.no-files').hidden = true; } finally { btn.disabled = false; }
      };
      // the preview follows the input once it is shown
      let t = null;
      form.addEventListener('input', () => { showAll(); if (shown) { clearTimeout(t); t = setTimeout(() => run(false), 400); } });
      form.addEventListener('change', () => { showAll(); if (shown) { clearTimeout(t); t = setTimeout(() => run(false), 200); } });
      form.querySelector('[data-a="preview"]').onclick = () => run(false);
      form.querySelector('[data-a="create"]').onclick = () => run(true);
      form.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(true); } });
    };
    el.querySelectorAll('.no-k').forEach(a => { a.onclick = e => { e.preventDefault(); select(a.dataset.kind); }; });
    const visible = () => [...el.querySelectorAll('.no-k')].filter(a => !a.hidden);
    let active = -1;
    const mark = () => visible().forEach((a, i) => a.classList.toggle('hot', i === active));
    const filter = () => {
      const q = search.value.trim().toLowerCase();
      const kindsEl = el.querySelector('.no-kinds');
      const items = [...el.querySelectorAll('.no-k')];
      for (const a of items) { const k = meta.kinds.find(x => x.id === a.dataset.kind); a.hidden = !!q && rank(k, q) > 3; a.style.order = q ? String(rank(k, q)) : ''; }
      kindsEl.classList.toggle('ranked', !!q);
      el.querySelectorAll('.no-g').forEach(g => { let n = g.nextElementSibling, any = false; while (n && n.classList.contains('no-k')) { if (!n.hidden) any = true; n = n.nextElementSibling; } g.hidden = !any || !!q; });
      el.querySelector('.no-none').hidden = items.some(a => !a.hidden);
      active = q && visible().length ? 0 : -1;
      if (q) { const sorted = visible().sort((a, b) => Number(a.style.order) - Number(b.style.order)); active = sorted.length ? visible().indexOf(sorted[0]) : -1; }
      mark();
    };
    search.oninput = filter;
    search.onkeydown = e => {
      const v = visible();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!v.length) return; active = (active + (e.key === 'ArrowDown' ? 1 : v.length - 1)) % v.length; mark(); v[active].scrollIntoView({ block: 'nearest' }); }
      // Enter chooses the highlighted kind; on an empty search it does nothing
      if (e.key === 'Enter') { e.preventDefault(); if (active >= 0 && v[active]) select(v[active].dataset.kind); }
    };
    if (search.value) filter();
    if (pendingEnter && !preselect) {
      const v = visible();
      if (active >= 0 && v[active]) { select(v[active].dataset.kind); const nm = el.querySelector('#no_name'); if (nm && typed) { nm.value = typed.toUpperCase(); nm.setSelectionRange(nm.value.length, nm.value.length); } }
    }
    if (preselect) select(preselect);
  }

  // ---------------------------------------------------------------- RAP business object generator
  async function openRapBo(table) {
    await load();
    const { el, close } = modal(`<div class="no-head"><strong>Generate RAP business object</strong><span class="spacer"></span><button class="btn sm ghost" data-close>✕</button></div>
      <div class="no-form no-solo">
        <p class="muted">From a database table: a root view (ZR_), a projection (ZC_), UI annotations, a managed behavior definition with draft, the behavior pool, a service definition and a SAP Fiori elements List Report / Object Page app.</p>
        <label>Table<select id="no_table">${meta.tables.map(t => `<option${t.name === table ? ' selected' : ''}>${esc(t.name.toUpperCase())}</option>`).join('') || '<option value="">(no tables yet)</option>'}</select></label>
        <p class="muted no-small">No table yet? <a href="#" data-a="newtable">Create a database table</a> first.</p>
        <label>Business object name<input id="no_bo" placeholder="e.g. SalesOrder" spellcheck="false"></label>
        <label class="no-chk"><input type="checkbox" id="no_draft" checked> With draft</label>
        <label class="no-chk"><input type="checkbox" id="no_fiori" checked> Generate a SAP Fiori elements app</label>
        <div class="no-err" hidden></div><div class="no-files" hidden></div>
        <div class="no-acts"><button class="btn sm" data-a="preview">Preview files</button><span class="spacer"></span><button class="btn sm ghost" data-close>Cancel</button><button class="btn sm primary" data-a="create">Generate</button></div>
      </div>`);
    el.querySelectorAll('[data-close]').forEach(b => { b.onclick = close; });
    const tbl = el.querySelector('#no_table'), bo = el.querySelector('#no_bo');
    const suggest = () => { const t = tbl.value.toLowerCase().replace(/^z/, '').replace(/_a$/, ''); bo.value = t.split('_').map(p => p[0]?.toUpperCase() + p.slice(1)).join(''); };
    tbl.onchange = suggest; suggest();
    el.querySelector('[data-a="newtable"]').onclick = e => { e.preventDefault(); close(); openNew('table'); };
    const err = el.querySelector('.no-err');
    const run = async write => {
      err.hidden = true;
      try {
        const r = await api('POST', `/a/${app()}/api/generate/rapbo`, { table: tbl.value, name: bo.value, draft: el.querySelector('#no_draft').checked, fiori: el.querySelector('#no_fiori').checked, write });
        if (!write) {
          const box = el.querySelector('.no-files');
          box.hidden = false;
          box.innerHTML = `<div class="no-tabs">${r.files.map((f, i) => `<button class="${i ? '' : 'on'}" data-i="${i}">${esc(f.replace(/^src\//, ''))}</button>`).join('')}${el.querySelector('#no_fiori').checked ? '<button disabled>webapp/… (after activation)</button>' : ''}</div><pre class="no-pre">${esc(r.preview[r.files[0]])}</pre>${r.notes.length ? `<p class="muted">${r.notes.map(esc).join('<br>')}</p>` : ''}`;
          box.querySelectorAll('[data-i]').forEach(b => { b.onclick = () => { box.querySelectorAll('[data-i]').forEach(x => x.classList.toggle('on', x === b)); box.querySelector('.no-pre').textContent = r.preview[r.files[b.dataset.i]]; }; });
          return;
        }
        close();
        await created(r);
      } catch (e) { err.hidden = false; err.textContent = e.message; }
    };
    el.querySelector('[data-a="preview"]').onclick = () => run(false);
    el.querySelector('[data-a="create"]').onclick = () => run(true);
  }

  // ---------------------------------------------------------------- context menu of the tree
  function contextMenu(e, { file, dir, dirPath, onOpen, onDelete, onRename }) {
    e.preventDefault();
    document.querySelector('.no-menu')?.remove();
    const items = [];
    if (file) items.push(['Open', () => onOpen(file)]);
    const kind = dir ? FOLDER_KIND[dir] : null;
    items.push([kind ? `New ${meta?.kinds?.find(k => k.id === kind)?.label || 'object'}…` : 'New object…', () => openNew(kind)]);
    // a function group: a new function module in it
    // a function group (one of its files, or its folder): a new function module in it; a program's folder: a transaction
    const grp = /^src\/([\w$#]+)\.fugr\./.exec(file || '')?.[1] || /\/Function Groups\/([\w$#]+)$/.exec(dirPath || '')?.[1];
    const progDir = /\/Reports and Module Pools\/([\w$#]+)$/.exec(dirPath || '')?.[1];
    if (progDir && !file) items.push([`New transaction code for ${progDir.toUpperCase()}…`, () => openNew('tran', { program: progDir })]);
    if (grp) items.push([`New function module in ${grp.toUpperCase()}…`, () => openNew('fugr', { name: grp.toUpperCase() })]);
    if (/\.prog\.(abap|xml)$/.test(file || '')) items.push(['New transaction code for this program…', () => openNew('tran', { program: file.split('/').pop().split('.')[0] })]);
    if (/\.tabl\.cds$/.test(file || '')) items.push(['New table type with this line type…', () => openNew('ttyp', { rowtype: file.split('/').pop().split('.')[0].toUpperCase() })]);
    if (/\.tabl\.cds$/.test(file || '')) items.push(['Generate RAP business object…', () => openRapBo(file.split('/').pop().split('.')[0])]);
    if (file && !/^src\//.test(file)) items.push(['Rename…', () => onRename(file)]);
    if (file) items.push(['Delete…', () => onDelete(file)]);
    const m = document.createElement('div');
    m.className = 'no-menu';
    m.innerHTML = items.map(([t], i) => `<button data-i="${i}">${esc(t)}</button>`).join('');
    m.style.left = `${Math.min(e.clientX, innerWidth - 240)}px`; m.style.top = `${Math.min(e.clientY, innerHeight - items.length * 32 - 10)}px`;
    document.body.appendChild(m);
    m.querySelectorAll('button').forEach(b => { b.onclick = () => { m.remove(); items[b.dataset.i][1](); }; });
    setTimeout(() => document.addEventListener('mousedown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('mousedown', off); } }), 0);
  }
  load().catch(() => {});
  return { openNew, openRapBo, contextMenu, reload: () => load().catch(() => {}) };
}

// the files of an object (all its parts: zcl_x.clas.abap + .clas.locals_imp.abap …; a function group's modules)
export function objectParts(files, f) {
  const base = f.split('/').pop();
  // an Adobe form: its layout and its form object
  if (/\.xdp$/.test(base)) return [f, ...files.filter(x => x === f.replace(/\.xdp$/, '.form.json'))];
  const m = /^([^.]+)\.([^.]+)\./.exec(base);
  if (!m || !/^src\//.test(f) || m[2] === 'fugr') return [f];   // a function module alone, not its whole group
  const dir = f.slice(0, f.length - base.length);
  return files.filter(x => x.startsWith(dir) && x.slice(dir.length).startsWith(`${m[1]}.${m[2]}.`));
}
