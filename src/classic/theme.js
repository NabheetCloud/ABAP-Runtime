// RAP Studio look for classic ABAP programs: replaces the SAP GUI window chrome (menu bar, command field,
// status bar) with a header that holds the program's actions; the engine's forms and buttons keep working
// because they are moved, not copied.
// In the studio's preview (a frame of another origin): the page tells the studio where it is (a reload of the
// preview keeps this page), and the studio can ask it to focus its first input (browsers block autofocus in
// cross-origin frames).
(() => {
  if (window.parent === window) return;
  const firstInput = () => document.querySelector('[autofocus]:not([disabled])')
    || [...document.querySelectorAll('input:not([type=hidden]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled])')].find(e => e.offsetParent !== null);
  try { window.parent.postMessage({ type: 'rap-classic-page', path: location.pathname + location.search }, '*'); } catch {}
  window.addEventListener('message', e => {
    if (e.data?.type !== 'rap-focus') return;
    const el = firstInput();
    if (el && document.activeElement !== el) { el.focus(); if (el.select && el.type !== 'checkbox') try { el.select(); } catch {} }
  });
})();
(() => {
  const $ = s => document.querySelector(s);
  const shell = $('.wb-shell');
  document.documentElement.classList.add('rap-theme');
  if (!shell) return;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const app = document.body.dataset.rapApp || '';
  const title = $('#wb-page-title')?.textContent?.trim() || document.title;

  const head = document.createElement('header');
  head.className = 'rx-head';
  head.innerHTML = `<a class="rx-home" href="/" title="All programs" aria-label="All programs"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></a>
    <div class="rx-titles">${app ? `<span class="rx-app">${esc(app)}</span>` : ''}<h1>${esc(title)}</h1></div>
    <div class="rx-actions" role="toolbar" aria-label="Program actions"></div>`;
  const actions = head.querySelector('.rx-actions');
  const label = b => b.getAttribute('aria-label') || b.title || b.textContent.trim();
  // navigation and list functions of the command bar, with their names shown as tooltips
  for (const b of document.querySelectorAll('.wb-commandbar .wb-command-button')) {
    if (b.disabled) continue;
    b.classList.add('rx-icon-btn');
    if (!b.title) b.title = label(b);
    actions.appendChild(b);
  }
  shell.prepend(head);

  // the application toolbar (Execute, user functions) becomes the page's action row
  const toolbar = $('.wb-app-toolbar');
  // icon-only buttons get their name as a visible label
  if (toolbar) for (const b of toolbar.querySelectorAll('.wb-toolbar-button')) {
    const t = label(b);
    if (!b.textContent.trim() && t) b.insertAdjacentHTML('beforeend', `<span class="rx-label">${esc(t)}</span>`);
  }

  // dynpros: the framework places fields on an 18px line grid; give each screen line room for 32px fields
  for (const screen of document.querySelectorAll('.gg-dynpro')) {
    const controls = [...screen.querySelectorAll('.gg-dynpro-control')].filter(c => c.style.top);
    const tops = [...new Set(controls.map(c => parseFloat(c.style.top)))].sort((a, b) => a - b);
    const pitch = Math.min(...tops.slice(1).map((t, i) => t - tops[i]).filter(d => d > 0));
    if (!Number.isFinite(pitch) || pitch >= 36) continue;
    const scale = 40 / pitch;
    for (const c of controls) {
      c.style.top = `${parseFloat(c.style.top) * scale}px`;
      if (c.style.height && parseFloat(c.style.height) <= pitch * 1.6) c.style.height = '34px';
      else if (c.style.height) c.style.height = `${parseFloat(c.style.height) * scale}px`;
      if (c.querySelector('input[type=text],input[type=password]') && parseFloat(c.style.width) < 90) c.style.width = `${Math.max(parseFloat(c.style.width) + 24, 70)}px`;
      // an output field of one or two characters (a status) stays readable
      if (c.matches('output') && parseFloat(c.style.width) < 40) c.style.width = '40px';
    }
    if (screen.style.minHeight) screen.style.minHeight = `${parseFloat(screen.style.minHeight) * Math.min(scale, 1.5)}px`;
  }

  // dynpro fields get the text in front of them on the same line as their accessible name
  for (const screen of document.querySelectorAll('.gg-dynpro')) {
    const texts = [...screen.querySelectorAll('span.gg-dynpro-control')].filter(t => t.style.top && t.textContent.trim());
    for (const f of screen.querySelectorAll('input.gg-dynpro-control, output.gg-dynpro-control, select.gg-dynpro-control, .gg-dynpro-control input, .gg-dynpro-control select')) {
      if (f.closest('[data-table-control]') || f.getAttribute('aria-label') || f.getAttribute('aria-labelledby') || (f.id && screen.querySelector(`label[for="${CSS.escape(f.id)}"]`))) continue;
      const box = f.closest('.gg-dynpro-control') || f;
      const top = parseFloat(box.style.top), left = parseFloat(box.style.left);
      const label = texts.filter(t => Math.abs(parseFloat(t.style.top) - top) < 4 && parseFloat(t.style.left) < left).sort((a, b) => parseFloat(b.style.left) - parseFloat(a.style.left))[0];
      if (label) f.setAttribute('aria-label', label.textContent.trim());
    }
  }

  // a numeric field that shows its initial value (0.000): the first key replaces it instead of being appended
  document.addEventListener('focusin', e => {
    const f = e.target;
    if (f?.matches?.('input.gg-type-number') && /^\s*-?0*[.,]?0*\s*$/.test(f.value)) setTimeout(() => f.select(), 0);
  });

  // inputs as wide as their length (size) says, within the field grid of a selection screen
  for (const f of document.querySelectorAll('.gg-selection input[size]')) {
    const n = Number(f.getAttribute('size'));
    if (n > 0) f.style.minWidth = `calc(${Math.min(n, 60) + 2}ch + 18px)`;
  }

  // dates and times as ABAP wants them (what the framework's own script does before it submits)
  const internal = (type, v) => {
    let m; const s = String(v || '').trim();
    if (type === 'D' && (m = /^(\d{2})[./-](\d{2})[./-](\d{4})$/.exec(s))) return m[3] + m[2] + m[1];
    if (type === 'T' && (m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s))) return m[1].padStart(2, '0') + m[2] + (m[3] || '00');
    return s;
  };

  // selection screens: "Run in background" schedules the program with the values entered (Jobs page)
  const params = new URLSearchParams(location.search);
  if (params.get('name')) try { sessionStorage.setItem('rap.program', params.get('name')); } catch {}
  const selection = document.querySelector('.gg-page--selection form#gg-host-form, form#gg-host-form');
  let program = null; try { program = params.get('name') || sessionStorage.getItem('rap.program'); } catch {}
  if (toolbar && selection && program && document.querySelector('.gg-selection')) {
    const bg = document.createElement('button');
    bg.type = 'button';
    bg.className = 'wb-toolbar-button rx-bg-run';
    bg.innerHTML = '<span class="rx-label">Run in background</span>';
    bg.addEventListener('click', () => {
      const fields = {};
      for (const el of selection.elements) {
        if (!el.name || /^(session_id|page_id|gg_|command$)/.test(el.name) || el.name.startsWith('gg-')) continue;
        if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) continue;
        if (!(el.name in fields)) fields[el.name] = internal(el.getAttribute('data-abap-type'), el.value);
      }
      const f = document.createElement('form');
      f.method = 'post'; f.action = '/__rap/jobs';
      for (const [k, v] of Object.entries({ program, jobname: `${program}_BG`.slice(0, 32), fields: JSON.stringify(fields), start: 'now' })) {
        const i = document.createElement('input'); i.type = 'hidden'; i.name = k; i.value = v; f.appendChild(i);
      }
      document.body.appendChild(f); f.submit();
    });
    toolbar.appendChild(bg);
  }

  // status bar message -> banner at the top of the content
  const msg = $('#wb-status-message');
  const text = msg?.textContent?.trim();
  if (text) {
    const kind = /error|fehler/i.test(msg.className + msg.getAttribute('data-type')) || msg.querySelector('[class*=error]') ? 'error'
      : msg.querySelector('[class*=warn]') || /warn/i.test(msg.className) ? 'warning' : msg.querySelector('[class*=succ]') || /succ/i.test(msg.className) ? 'success' : 'info';
    const banner = document.createElement('div');
    banner.className = `rx-banner rx-banner--${kind}`;
    banner.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    banner.textContent = text;
    $('.wb-runtime-content')?.prepend(banner);
  }
})();

// F4 value help: a button on every screen field with a value help (check table, domain fixed values, value table),
// F4 in the field opens it too; the pop-up lists the values with their texts, searchable, picked with a click or Enter
(() => {
  const NAME_OK = /^[A-Z_][\w/]*(-[\w/]+)*$/i;
  const fieldName = el => {
    const n = el.dataset.abapName || el.name || '';
    if (!NAME_OK.test(n) || /^(command|session_id|page_id|gg_action)$/i.test(n) || /^gg[-_](?!editor_)/i.test(n)) return null;
    return n.replace(/^gg_editor_/i, '').replace(/-\d+-(LOW|HIGH)$/i, '-$1').toUpperCase();
  };
  const inputs = [...document.querySelectorAll('input[name]')].filter(el => (el.type === 'text' || !el.type) && !el.readOnly && !el.disabled && fieldName(el));
  if (!inputs.length) return;
  const program = new URLSearchParams(location.search).get('name') || '';
  const names = [...new Set(inputs.map(fieldName))];
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  fetch(`/__rap/f4/fields?program=${encodeURIComponent(program)}&names=${encodeURIComponent(names.join(','))}`).then(r => r.ok ? r.json() : {}).then(has => {
    for (const el of inputs) {
      const name = fieldName(el);
      if (!has[name] || el.dataset.rxF4) continue;
      el.dataset.rxF4 = name;
      const wrap = document.createElement('span');
      wrap.className = 'rx-f4-wrap';
      const w = el.getBoundingClientRect().width;
      if (w) wrap.style.width = `${Math.max(w, 90)}px`;
      el.parentNode.insertBefore(wrap, el);
      wrap.appendChild(el);
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'rx-f4'; btn.tabIndex = -1;
      btn.title = 'Value help (F4)'; btn.setAttribute('aria-label', 'Value help (F4)');
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>';
      btn.addEventListener('click', e => { e.preventDefault(); open(el); });
      wrap.appendChild(btn);
      el.addEventListener('keydown', e => { if (e.key === 'F4') { e.preventDefault(); e.stopPropagation(); open(el); } }, true);
    }
  }).catch(() => {});

  const labelOf = el => (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent?.trim())
    || el.closest('.gg-field, .gg-range')?.querySelector('label, .gg-range-name')?.textContent?.trim() || el.dataset.rxF4;

  function open(el) {
    const name = el.dataset.rxF4;
    document.querySelector('.rx-f4-dialog')?.remove();
    const dlg = document.createElement('div');
    dlg.className = 'rx-f4-dialog';
    dlg.innerHTML = `<div class="rx-f4-panel" role="dialog" aria-modal="true" aria-labelledby="rx-f4-title">
      <div class="rx-f4-head"><h2 id="rx-f4-title">${esc(labelOf(el))}</h2><button type="button" class="rx-f4-close" aria-label="Close">×</button></div>
      <input class="rx-f4-search" type="search" placeholder="Search" aria-label="Search values" autocomplete="off">
      <div class="rx-f4-body"><div class="rx-f4-msg">Loading…</div></div>
      <div class="rx-f4-foot"></div></div>`;
    document.body.appendChild(dlg);
    const search = dlg.querySelector('.rx-f4-search'), body = dlg.querySelector('.rx-f4-body'), foot = dlg.querySelector('.rx-f4-foot');
    let data = null, active = 0, timer;
    const close = (focus = true) => { dlg.remove(); if (focus) el.focus(); };
    const pick = i => {
      const row = data?.rows?.[i];
      if (!row) return;
      el.value = String(row[data.key] ?? '').trim();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      close();
    };
    const mark = () => {
      body.querySelectorAll('tbody tr').forEach((tr, i) => { tr.classList.toggle('active', i === active); tr.setAttribute('aria-selected', i === active); });
      body.querySelector('tbody tr.active')?.scrollIntoView({ block: 'nearest' });
    };
    const render = () => {
      // a screen field without a label: the dictionary's label (data element, or the value's column)
      const h = dlg.querySelector('#rx-f4-title');
      if (/^[A-Z_][\w/-]*$/.test(h.textContent) && data.columns?.length) {
        const t = data.title && !/^[A-Z_][\w/-]*$/.test(data.title) ? data.title : data.columns[data.key]?.label;
        if (t) h.textContent = t;
      }
      if (data.error) { body.innerHTML = `<div class="rx-f4-msg">${esc(data.error)}</div>`; foot.textContent = ''; return; }
      if (data.missing) { body.innerHTML = `<div class="rx-f4-msg">Table ${esc(data.missing)} has no data in this system.</div>`; foot.textContent = ''; return; }
      if (!data.rows.length) { body.innerHTML = '<div class="rx-f4-msg">No values found.</div>'; foot.textContent = ''; return; }
      body.innerHTML = `<table role="listbox"><thead><tr>${data.columns.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${
        data.rows.map((r, i) => `<tr role="option" data-i="${i}">${r.map((v, k) => `<td${k === data.key ? ' class="key"' : ''}>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      foot.textContent = `${data.rows.length}${data.more ? '+' : ''} ${data.rows.length === 1 ? 'entry' : 'entries'}${data.table ? ` · ${data.table}` : ''}`;
      active = Math.max(0, data.rows.findIndex(r => String(r[data.key]).trim() === el.value.trim()));
      mark();
    };
    const load = () => fetch(`/__rap/f4?field=${encodeURIComponent(name)}&program=${encodeURIComponent(program)}&q=${encodeURIComponent(search.value)}`)
      .then(r => r.json()).then(d => { data = d; render(); }).catch(e => { data = { error: e.message }; render(); });
    body.addEventListener('click', e => { const tr = e.target.closest('tbody tr'); if (tr) pick(Number(tr.dataset.i)); });
    dlg.addEventListener('mousedown', e => { if (e.target === dlg) close(); });
    dlg.querySelector('.rx-f4-close').addEventListener('click', () => close());
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 200); });
    dlg.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown' && data?.rows?.length) { e.preventDefault(); active = Math.min(active + 1, data.rows.length - 1); mark(); }
      else if (e.key === 'ArrowUp' && data?.rows?.length) { e.preventDefault(); active = Math.max(active - 1, 0); mark(); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(active); }
      e.stopPropagation();
    });
    search.focus();
    load();
  }
})();

// the user's date format (their settings; DD.MM.YYYY is the engine's own): date fields and outputs show it, and a
// date typed in it goes to the engine as YYYYMMDD before the engine's own DD.MM.YYYY reading
(() => {
  const code = document.body?.dataset.rapDatfm || '1';
  const fmt = v => {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(v || '').trim());
    if (!m || m[0] === '00000000') return null;
    const [, y, mo, d] = m;
    return { 2: `${mo}/${d}/${y}`, 3: `${mo}-${d}-${y}`, 4: `${y}.${mo}.${d}`, 5: `${y}/${mo}/${d}`, 6: `${y}-${mo}-${d}` }[code] || null;
  };
  const parse = text => {
    const s = String(text || '').trim();
    let m, y, mo, d;
    if (/^\d{8}$/.test(s)) return s;
    const yearFirst = ['4', '5', '6'].includes(code);
    if (!yearFirst && (m = /^(\d{2})[./-](\d{2})[./-](\d{4})$/.exec(s))) { if (code === '2' || code === '3') [, mo, d, y] = m; else [, d, mo, y] = m; }
    else if (yearFirst && (m = /^(\d{4})[./-](\d{2})[./-](\d{2})$/.exec(s))) [, y, mo, d] = m;
    else return null;
    return `${y}${mo.padStart(2, '0')}${d.padStart(2, '0')}`;
  };
  const pattern = { 1: 'DD.MM.YYYY', 2: 'MM/DD/YYYY', 3: 'MM-DD-YYYY', 4: 'YYYY.MM.DD', 5: 'YYYY/MM/DD', 6: 'YYYY-MM-DD' }[code] || 'DD.MM.YYYY';
  // a real calendar day (YYYYMMDD; 00000000 is the initial date)
  const isDay = v => { if (v === '00000000') return true; const y = +v.slice(0, 4), m = +v.slice(4, 6), d = +v.slice(6, 8); const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
  const show = root => root.querySelectorAll('[data-abap-type="D"]').forEach(el => {
    const v = fmt(el.getAttribute('data-abap-value'));
    if ('value' in el && el.tagName !== 'OUTPUT') { if (v && el.value.trim() && el.value.trim() !== v) el.value = v; if (!el.placeholder) el.placeholder = pattern; }
    else if (v) el.textContent = v;
  });
  if (code !== '1') show(document);
  // ALV cells of date columns: the engine writes DD.MM.YYYY
  const ddmm = t => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(t).trim()); return m ? fmt(`${m[3]}${m[2]}${m[1]}`) : null; };
  document.querySelectorAll('.gg-type-date').forEach(el => {
    if (el.matches('input')) { if (!el.dataset.abapType) { const v = ddmm(el.value); if (v) el.value = v; } }
    else if (!el.children.length) { const v = ddmm(el.textContent); if (v) el.textContent = v; }
  });
  // before the engine's own handler (capture phase on the document runs first)
  document.addEventListener('submit', e => {
    // no impossible dates (32.13.2026): the field says what it expects, nothing is sent
    const bad = [...(e.target.querySelectorAll?.('input[data-abap-type="D"], input.gg-type-date') || [])].find(el => el.value.trim() && !(parse(el.value) && isDay(parse(el.value))));
    if (bad) {
      e.preventDefault(); e.stopImmediatePropagation();
      bad.setAttribute('aria-invalid', 'true'); bad.focus();
      let msg = document.getElementById('rx-date-error');
      if (!msg) { msg = document.createElement('div'); msg.id = 'rx-date-error'; msg.className = 'rx-banner rx-banner--error'; msg.setAttribute('role', 'alert'); (document.querySelector('.wb-runtime-content') || document.body).prepend(msg); }
      msg.textContent = `"${bad.value.trim()}" is not a valid date. Enter it as ${pattern}.`;
      return;
    }
    if (code === '1') return;   // the engine reads DD.MM.YYYY itself
    e.target.querySelectorAll?.('input[data-abap-type="D"]').forEach(el => { const v = parse(el.value); if (v) el.value = v; });
    e.target.querySelectorAll?.('input.gg-type-date:not([data-abap-type])').forEach(el => { const v = parse(el.value); if (v) el.value = `${v.slice(6, 8)}.${v.slice(4, 6)}.${v.slice(0, 4)}`; });
  }, true);
})();

// times of the system pages (kept in UTC) in the viewer's local time; the schedule form sends its time zone
(() => {
  const two = n => String(n).padStart(2, '0');
  document.querySelectorAll('time[data-local][datetime]').forEach(t => {
    const d = new Date(t.getAttribute('datetime'));
    if (isNaN(d)) return;
    t.textContent = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
    t.title = `${t.getAttribute('datetime').replace('T', ' ').slice(0, 19)} UTC`;
  });
  document.querySelectorAll('input[data-tz]').forEach(i => { i.value = String(new Date().getTimezoneOffset()); });
})();
