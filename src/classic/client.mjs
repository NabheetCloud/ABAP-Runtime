// Drives an app's classic engine over HTTP, as a browser does, for programs that are not in front of a user:
// the CLI (rap program / transaction / job / ...) and the job scheduler. Results are plain text and values.
import zlib from 'node:zlib';
export const text = h => String(h).replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(tr|p|div|h\d|li|pre|section)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
const unescape = s => String(s ?? '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// the work area of the page (the list, the screen), without the window chrome
export const listOf = html => text((/<main[\s\S]*?<\/main>/i.exec(html) || [html])[0]);
// the status bar message ("Flight LH 0400 found"), '' when there is none
export const messageOf = html => text(/<[^>]*id="wb-status-message"[^>]*>([\s\S]*?)<\/(?:div|span|p|output)>/i.exec(html)?.[1] || '');
export const titleOf = html => text(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
// dates and times as ABAP wants them (YYYYMMDD, HHMMSS) from what a user types: 05.11.2026, 2026-11-05, 02:00
export function internal(type, v) {
  const s = String(v ?? '').trim();
  let m;
  if (type === 'D') {
    if ((m = /^(\d{2})[./-](\d{2})[./-](\d{4})$/.exec(s))) return `${m[3]}${m[2]}${m[1]}`;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s))) return `${m[1]}${m[2]}${m[3]}`;
  }
  if (type === 'T' && (m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s))) return `${m[1].padStart(2, '0')}${m[2]}${m[3] || '00'}`;
  return s;
}
// the ABAP type (D, T) of the date and time fields of a page
export function typesOf(html) {
  const out = {};
  for (const m of String(html).matchAll(/<input\b[^>]*data-abap-type="([DT])"[^>]*>/gi)) { const n = /\bname="([^"]+)"/.exec(m[0])?.[1]; if (n) out[n] = m[1]; }
  return out;
}
// the form fields of a page with their current values (what a browser would post; dates and times internal)
export function fieldsOf(html) {
  const out = {};
  for (const m of String(html).matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0], name = /\bname="([^"]+)"/.exec(tag)?.[1];
    if (!name || /^(command|gg_action|gg_ucomm)$/.test(name)) continue;
    const type = /\btype="([^"]+)"/.exec(tag)?.[1] || 'text';
    if ((type === 'checkbox' || type === 'radio') && !/\bchecked\b/.test(tag)) continue;
    const raw = /\bdata-abap-value="([^"]*)"/.exec(tag)?.[1];
    if (!(name in out)) out[name] = unescape(raw ?? /\bvalue="([^"]*)"/.exec(tag)?.[1] ?? '');
  }
  for (const m of String(html).matchAll(/<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi)) {
    if (!(m[1] in out)) out[m[1]] = unescape(/<option[^>]*value="([^"]*)"[^>]*selected/i.exec(m[2])?.[1] ?? /<option[^>]*value="([^"]*)"/i.exec(m[2])?.[1] ?? '');
  }
  return out;
}
// the ABAP fields of a screen (data-abap-name), with values: what a user sees on a dynpro or selection screen
export function screenOf(html) {
  const out = {};
  for (const m of String(html).matchAll(/<(input|select|textarea)\b[^>]*data-abap-name="([^"]+)"[^>]*>/gi)) {
    const tag = m[0], name = m[2];
    const type = /\btype="([^"]+)"/.exec(tag)?.[1] || 'text';
    if (type === 'checkbox') { out[name] = /\bchecked\b/.test(tag) ? 'X' : ''; continue; }
    if (!(name in out)) out[name] = unescape(/\bvalue="([^"]*)"/.exec(tag)?.[1] || '').replace(/ +$/, '');
  }
  // output-only fields: <output id="gg-dynpro-control-n-NAME">value</output>
  for (const m of String(html).matchAll(/<output\b[^>]*id="gg-dynpro-control-n-([^"]+)"[^>]*>([\s\S]*?)<\/output>/gi)) if (!(m[1] in out)) out[m[1]] = text(m[2]);
  return out;
}
// function codes offered on the page (toolbar and command buttons): { SHOW: 'Display', SAVE: 'Save', ... }
export function commandsOf(html) {
  const out = {};
  for (const m of String(html).matchAll(/<button\b[^>]*value="COMMAND:([^"]+)"[^>]*>/gi)) out[m[1]] = /\baria-label="([^"]*)"/.exec(m[0])?.[1] || /\btitle="([^"]*)"/.exec(m[0])?.[1] || m[1];
  return out;
}
const failed = html => /class="[^"]*wb-status-error|data-type="E"|The program stopped with an error/i.test(html);

async function post(base, fields, cookie) {
  const r = await fetch(`${base}dispatch`, { method: 'POST', body: new URLSearchParams(fields), headers: { 'content-type': 'application/x-www-form-urlencoded', cookie } });
  return { status: r.status, html: await r.text() };
}
// the given values with upper-case names; dates and times converted for the page's D / T fields
const upper = (values, html) => {
  const types = typesOf(html);
  return Object.fromEntries(Object.entries(values || {}).map(([k, v]) => { const n = String(k).toUpperCase(); return [n, types[n] || types[n.replace(/-(LOW|HIGH)$/, '-LOW')] ? internal(types[n] || types[n.replace(/-(LOW|HIGH)$/, '-LOW')], v) : String(v)]; }));
};
const isSelection = html => /<[^>]+class="[^"]*\bgg-page--selection\b/.test(html);

// runs a report: selection screen defaults, the given values on top, Execute (F8); returns the list (pages: also the
// HTML of the selection screen and of the result, for screenshots)
export async function runProgram(base, program, values = {}, { extra = {}, pages = false } = {}) {
  const r = await fetch(`${base}program?name=${encodeURIComponent(String(program).toUpperCase())}`);
  const page = await r.text();
  if (!r.ok) return { ok: false, status: r.status, message: messageOf(page) || listOf(page).slice(0, 500), list: '', ...(pages ? { html: page } : {}) };
  const cookie = r.headers.get('set-cookie')?.split(';')[0] || '';
  // a program without a selection screen shows its list right away
  if (!isSelection(page)) return { ok: !failed(page), status: r.status, title: titleOf(page), message: messageOf(page), list: listOf(page), ...(pages ? { html: page } : {}) };
  const res = await post(base, { ...fieldsOf(page), ...upper(extra, page), ...upper(values, page), gg_action: 'SUBMIT', gg_ucomm: 'ONLI' }, cookie);
  const stillSelection = isSelection(res.html);
  return { ok: res.status < 400 && !failed(res.html), status: res.status, title: titleOf(res.html), message: messageOf(res.html),
    list: stillSelection ? '' : listOf(res.html), screen: stillSelection ? screenOf(res.html) : undefined, ...(pages ? { html: res.html, selection: page } : {}) };
}

// runs a transaction: the first screen, then each step [{ command, fields }] (fields are typed in, the function
// code is pressed); returns the screen after every step
export async function runTransaction(base, tcode, steps = []) {
  const r = await fetch(`${base}transaction?tcode=${encodeURIComponent(String(tcode).toUpperCase())}`);
  let html = await r.text();
  const out = [];
  const snap = (command, status) => ({ command, status, ok: status < 400 && !failed(html), title: titleOf(html), message: messageOf(html), screen: screenOf(html), commands: commandsOf(html), activeTab: /role="tab"[^>]*value="TAB:([^|"]+)[^"]*"[^>]*aria-selected="true"/.exec(html)?.[1] || undefined, text: html.replace(/<(style|script)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() });
  out.push(snap('(start)', r.status));
  if (!r.ok) return out;
  const cookie = r.headers.get('set-cookie')?.split(';')[0] || '';
  for (const s of steps) {
    const res = await post(base, { ...fieldsOf(html), action: 'SUBMIT', ...upper(s.fields, html), gg_action: s.action || `COMMAND:${String(s.command || 'ENTER').toUpperCase()}` }, cookie);   // action: e.g. a tab, TAB:<tab>|<function code>
    html = res.html;
    out.push(snap(s.action || String(s.command || 'ENTER').toUpperCase(), res.status));
    if (res.status >= 400) break;
  }
  return out;
}

// the text drawn on the pages of a PDF made by open-abap-pdf or the form engine: literal strings, and the glyph ids
// of embedded fonts (hex strings) through the font's ToUnicode map
export function pdfText(buf) {
  const raw = Buffer.from(buf).toString('latin1');
  const objs = new Map();
  for (const m of raw.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)) {
    let body = m[2], data = null;
    const st = /^([\s\S]*?)stream\r?\n([\s\S]*?)\r?\nendstream/.exec(body);
    if (st) {
      body = st[1];
      if (/\/Subtype \/Image/.test(body)) data = '';
      else if (/\/FlateDecode/.test(body)) { try { data = zlib.inflateSync(Buffer.from(st[2], 'latin1')).toString('latin1'); } catch { data = ''; } }
      else data = st[2];
    }
    objs.set(Number(m[1]), { body, data });
  }
  // font resource name -> glyph id (hex) -> text
  const cmaps = {};
  for (const { body } of objs.values()) {
    const fonts = /\/Font\s*<<([^>]*)>>/.exec(body)?.[1];
    if (!fonts) continue;
    for (const [, name, id] of fonts.matchAll(/\/([\w.+-]+)\s+(\d+) 0 R/g)) {
      const uni = /\/ToUnicode (\d+) 0 R/.exec(objs.get(Number(id))?.body || '')?.[1];
      const cmap = uni && objs.get(Number(uni))?.data;
      if (!cmap) continue;
      const map = cmaps[name] = {};
      for (const [, g, u] of cmap.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map[g.toLowerCase()] = Buffer.from(u, 'hex').swap16().toString('utf16le');
    }
  }
  const out = [];
  const lit = s => s.replace(/\\([0-7]{3})/g, (x, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\([()\\])/g, '$1');
  for (const { data } of objs.values()) {
    if (!data || !/T[jJ]/.test(data)) continue;
    let font = null;
    for (const m of data.matchAll(/\/([\w.+-]+)\s+[\d.]+\s+Tf|\(((?:\\.|[^\\)])*)\)\s*Tj|<([0-9a-fA-F]*)>\s*Tj/g)) {
      if (m[1]) font = m[1];
      else if (m[2] !== undefined) out.push(lit(m[2]));
      else { const map = cmaps[font] || {}; out.push((m[3].match(/.{4}/g) || []).map(g => map[g.toLowerCase()] ?? '').join('')); }
    }
  }
  return out;
}
