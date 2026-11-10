// Source <-> model for the visual editors of RAP Studio (pure functions, also used by the node tests):
// tables (.tabl.cds), CDS view entities (.ddls.asddls), behavior definitions (.bdef.asbdef), metadata extensions
// (.ddlx.asddlxs) and classic screens (DYNPROS of a .prog.xml). Every serializer writes clean source in the style of
// the examples; what a model does not understand is kept as written (raw) so a save never loses anything.
import { splitTop, takeAnnotations, flatten, toLines, parseValue, formatValue } from './cdsann.js';
export { parseValue, formatValue, flatten, toLines };

const pad = (s, n) => s + ' '.repeat(Math.max(1, n - s.length));

// ------------------------------------------------------------------ tables and structures
// a field: { key, name, type, builtin, length, decimals, notNull, fk (the "with foreign key …" clause as written),
// anns }; an include structure: { include, suffix, anns }; anything else: { raw }
export function parseTable(text) {
  const m = /^([\s\S]*?)define\s+(table|structure)\s+([\w/]+)\s*\{([\s\S]*)\}\s*$/i.exec(text.trim());
  if (!m) throw new Error('Not a table or structure definition (define table … { … } / define structure … { … })');
  const header = flatten(takeAnnotations(m[1]).anns);
  const fields = [];
  let pending = [];
  for (const stmt of splitTop(m[4], ';')) {
    const { anns, rest } = takeAnnotations(stmt);
    const s = rest.trim();
    if (!s) { pending.push(...anns); continue; }
    const all = [...pending, ...anns]; pending = [];
    const one = s.replace(/\s+/g, ' ');
    const inc = /^include ([\w/]+)(?: with suffix (\w+))?$/i.exec(one);
    if (inc) { fields.push({ include: inc[1], suffix: inc[2] || '', anns: flatten(all) }); continue; }
    const f = /^(key\s+)?([\w$/]+)\s*:\s*(.+?)(\s+not\s+null)?(\s+with\s+foreign\s+key\b.*)?$/is.exec(one);
    if (!f || /^include\b/i.test(f[3])) { fields.push({ raw: s, anns: flatten(all) }); continue; }
    const t = /^abap\.(\w+)(?:\((\d+)(?:\s*,\s*(\d+))?\))?$/i.exec(f[3].trim());
    const fk = (f[5] || '').trim();
    fields.push({ key: !!f[1], name: f[2], type: t ? t[1].toLowerCase() : f[3].trim(), builtin: !!t, length: t?.[2] ? Number(t[2]) : null, decimals: t?.[3] ? Number(t[3]) : null, notNull: !!f[4], fk, anns: flatten(all) });
  }
  return { kind: m[2].toLowerCase(), name: m[3], header, fields };
}
// labels for fields of a table / structure source (fields typed with a built-in type have no data element, so their
// label is @EndUserText.label): labels { field: text } become or replace that annotation above the field
export function addFieldLabels(text, labels) {
  const want = new Map(Object.entries(labels || {}).map(([k, v]) => [k.toLowerCase(), String(v ?? '').replace(/'/g, '’').replace(/\s+/g, ' ').trim().slice(0, 60)]).filter(([, v]) => v));
  if (!want.size) return text;
  const lines = String(text).split('\n');
  const body = lines.findIndex(l => /\bdefine\s+(table|structure)\b/i.test(l));
  for (let i = lines.length - 1; i > body && body >= 0; i--) {
    const m = /^(\s*)(?:key\s+)?([\w$/]+)\s*:/i.exec(lines[i]);
    if (!m || !want.has(m[2].toLowerCase()) || /^\s*include\b/i.test(lines[i])) continue;
    const ann = `${m[1]}@EndUserText.label : '${want.get(m[2].toLowerCase())}'`;
    // an existing label annotation in the lines above the field (up to the previous field) is replaced
    let j = i - 1, done = false;
    while (j > body && /^\s*@/.test(lines[j])) { if (/^\s*@EndUserText\.label\b/i.test(lines[j])) { lines[j] = ann; done = true; break; } j--; }
    if (!done) lines.splice(i, 0, ann);
    want.delete(m[2].toLowerCase());
  }
  return lines.join('\n');
}
export const typeText = f => (f.builtin ? `abap.${f.type}${f.length != null && f.length !== '' ? `(${f.length}${f.decimals != null && f.decimals !== '' ? `,${f.decimals}` : ''})` : ''}` : f.type);
// the check table of a foreign key clause
export const checkTableOf = f => /with\s+foreign\s+key\s*(?:\[[^\]]*\])?\s*([\w/]+)/i.exec(f.fk || '')?.[1] || '';
// a foreign key to a check table: the field and the client are compared
// keys: the key fields of the check table ([{ name, client }]); the checked field takes the check table's last key,
// the client and other keys of the same name are compared with this table's fields
export function foreignKey(t, f, table, keys) {
  if (!table) return '';
  const own = t.fields.filter(x => !x.raw && !x.include);
  const client = own.find(x => x.type === 'clnt');
  const list = keys?.length ? keys : [...(client ? [{ name: client.name, client: true }] : []), { name: f.name }];
  const nonClient = list.filter(k => !k.client);
  const pairs = list.map(k => {
    if (k.client) return client ? `${k.name} = ${t.name}.${client.name}` : null;
    if (k === nonClient.at(-1)) return `${k.name} = ${t.name}.${f.name}`;
    const same = own.find(x => x.name.toLowerCase() === k.name.toLowerCase());
    return same ? `${k.name} = ${t.name}.${same.name}` : null;
  }).filter(Boolean);
  return `with foreign key [0..*,1] ${table} where ${pairs.join(' and ')}`;
}
// the reference field of an amount / quantity (@Semantics.amount.currencyCode: 'tab.field')
export const REF_ANNS = ['Semantics.amount.currencyCode', 'Semantics.quantity.unitOfMeasure'];
export const refOf = f => { const k = REF_ANNS.find(a => f.anns?.[a]); return k ? String(f.anns[k]).split('.').pop() : ''; };
export function writeTable(t) {
  const w = Math.max(10, ...t.fields.filter(f => !f.raw && !f.include).map(f => (f.key ? 4 : 0) + f.name.length + 1));
  const lines = toLines(t.header).map(l => l.replace(/^@(\w[\w.]*): /, '@$1 : '));
  lines.push(`define ${t.kind || 'table'} ${t.name} {`);
  for (const f of t.fields) {
    for (const l of toLines(f.anns || {}, '  ')) lines.push(l.replace(/^(\s*@[\w.]+): /, '$1 : '));
    if (f.raw) { lines.push(`  ${f.raw};`); continue; }
    if (f.include) { lines.push(`  include ${f.include}${f.suffix ? ` with suffix ${f.suffix}` : ''};`); continue; }
    lines.push(`  ${pad(`${f.key ? 'key ' : ''}${f.name}`, w)}: ${typeText(f)}${f.notNull ? ' not null' : ''}${f.fk ? `\n    ${f.fk.replace(/\s+where\s+/i, '\n      where ')}` : ''};`);
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}
export function checkTable(t) {
  const out = [], seen = new Set();
  const structure = t.kind === 'structure';
  let keysDone = false;
  for (const f of t.fields.filter(x => !x.raw && !x.include)) {
    if (!/^[a-z_][\w$/]*$/i.test(f.name)) out.push(`${f.name || '(empty)'}: not a valid name`);
    if (seen.has(f.name.toLowerCase())) out.push(`${f.name}: duplicate field`);
    seen.add(f.name.toLowerCase());
    if (structure && f.key) out.push(`${f.name}: a structure has no key fields`);
    if (f.key && keysDone) out.push(`${f.name}: key fields must come first`);
    if (!f.key) keysDone = true;
    if (f.key && !f.notNull && !structure) out.push(`${f.name}: key fields need "not null"`);
    if (f.builtin && /^(char|numc|dec|curr|quan|raw|sstring)$/.test(f.type) && !f.length) out.push(`${f.name}: abap.${f.type} needs a length`);
    if (f.builtin && /^(curr|quan)$/.test(f.type) && !refOf(f)) out.push(`${f.name}: an ${f.type === 'curr' ? 'amount needs its currency key' : 'quantity needs its unit'} field (Reference)`);
    const r = refOf(f);
    if (r && !t.fields.some(x => x.name === r) && !t.fields.some(x => x.include)) out.push(`${f.name}: the reference field ${r} is not a field`);
  }
  if (!structure && !t.fields.some(f => f.key)) out.push('The table has no key');
  if (structure && !t.fields.some(f => !f.raw)) out.push('The structure has no components');
  return out;
}

// ------------------------------------------------------------------ CDS view entities
export function parseView(text) {
  const m = /^([\s\S]*?)define\s+(root\s+)?view\s+entity\s+(\w+)([\s\S]*?)\{([\s\S]*)\}([\s\S]*)$/i.exec(text.trim());
  if (!m) throw new Error('Only view entities (define [root] view entity …) can be designed; edit this one in the Source view');
  if (/with\s+parameters/i.test(m[4])) throw new Error('A view with parameters: edit it in the Source view');
  const head = m[4];
  const src = /^\s*(as\s+select\s+(distinct\s+)?from|as\s+projection\s+on|provider\s+contract\s+(\w+)\s+as\s+projection\s+on)\s+([\w/]+)(?:\s+as\s+(\w+))?/i.exec(head);
  if (!src) throw new Error('Only select from / projection on a single source can be designed (joins, unions: Source view)');
  const after = head.slice(src[0].length);
  if (/\b(inner|left|right|cross)\s+(outer\s+)?join\b|\bunion\b/i.test(after)) throw new Error('A view with joins or unions: edit it in the Source view');
  const assocs = [];
  for (const piece of after.split(/(?=\b(?:association|composition)\b)/i).map(x => x.trim()).filter(Boolean)) {
    let a = /^(association|composition)\s*(\[[^\]]*\])?\s*(?:to\s+parent\s+|of\s+|to\s+)?(\w+)\s+as\s+(\w+)(?:\s+on\s+([\s\S]+))?$/i.exec(piece);
    if (!a) { assocs.push({ raw: piece }); continue; }
    const parent = /to\s+parent/i.test(piece);
    assocs.push({ kind: a[1].toLowerCase() === 'composition' ? 'composition' : parent ? 'parent' : 'association', card: a[2] || '', target: a[3], alias: a[4], on: (a[5] || '').trim() });
  }
  const elements = [];
  for (const chunk of splitTop(m[5], ',')) {
    const { anns, rest } = takeAnnotations(chunk);
    let s = rest.trim();
    if (!s) continue;
    const key = /^key\s+/i.test(s);
    if (key) s = s.replace(/^key\s+/i, '');
    const as = /^([\s\S]*?)\s+as\s+(\w+)\s*$/i.exec(s);
    elements.push({ key, expr: (as ? as[1] : s).trim(), alias: as ? as[2] : '', anns: flatten(anns) });
  }
  return { header: flatten(takeAnnotations(m[1]).anns), root: !!m[2], name: m[3], sourceKind: /projection/i.test(src[1]) ? 'projection' : 'select', contract: src[3] || '', distinct: !!src[2], source: src[4], sourceAlias: src[5] || '', assocs, elements, tail: m[6].trim() };
}
export function writeView(v) {
  const out = toLines(v.header);
  out.push(`define ${v.root ? 'root ' : ''}view entity ${v.name}`);
  out.push(v.sourceKind === 'projection' ? `  ${v.contract ? `provider contract ${v.contract} ` : ''}as projection on ${v.source}${v.sourceAlias ? ` as ${v.sourceAlias}` : ''}` : `  as select ${v.distinct ? 'distinct ' : ''}from ${v.source}${v.sourceAlias ? ` as ${v.sourceAlias}` : ''}`);
  const aw = Math.max(0, ...v.assocs.filter(a => !a.raw).map(a => a.target.length));
  for (const a of v.assocs) {
    if (a.raw) { out.push(`  ${a.raw}`); continue; }
    if (a.kind === 'composition') out.push(`  composition ${a.card || '[0..*]'} of ${pad(a.target, aw)} as ${a.alias}`);
    else if (a.kind === 'parent') out.push(`  association to parent ${a.target} as ${a.alias}${a.on ? ` on ${a.on}` : ''}`);
    else out.push(`  association ${a.card || '[0..1]'} to ${pad(a.target, aw)} as ${a.alias}${a.on ? ` on ${a.on}` : ''}`);
  }
  out.push('{');
  const ew = Math.max(0, ...v.elements.filter(e => e.alias).map(e => e.expr.length));
  v.elements.forEach((e, i) => {
    for (const l of toLines(e.anns || {}, '      ')) out.push(l);
    const body = `${e.alias ? `${pad(e.expr, ew)} as ${e.alias}` : e.expr}`;
    out.push(`${e.key ? '  key ' : '      '}${body}${i < v.elements.length - 1 ? ',' : ''}`);
  });
  out.push(`}${v.tail ? `\n${v.tail}` : ''}`);
  return `${out.join('\n')}\n`;
}
// CamelCase alias of a column: travel_uuid -> TravelUUID
export const camel = col => col.split('_').map(p => (/^(uuid|id)$/i.test(p) ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())).join('');

// ------------------------------------------------------------------ behavior definitions
function statements(body) {
  const out = [];
  let depth = 0, cur = '', q = false;
  for (const c of body) {
    cur += c;
    if (q) { if (c === "'") q = false; continue; }
    if (c === "'") { q = true; continue; }
    if (c === '{') depth++;
    if (c === '}') { depth--; if (depth === 0) { out.push(cur.trim()); cur = ''; } continue; }
    if (c === ';' && depth === 0) { out.push(cur.trim().replace(/;$/, '').trim()); cur = ''; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(Boolean);
}
const list = s => s.split(',').map(x => x.trim()).filter(Boolean);
function parseStatement(s, projection) {
  const one = s.replace(/\s+/g, ' ').trim();
  let m;
  if (projection) {
    if ((m = /^use (create|update|delete)$/i.exec(one))) return { k: 'use', op: m[1].toLowerCase() };
    if ((m = /^use action (\w+)$/i.exec(one))) return { k: 'useAction', name: m[1] };
    if ((m = /^use association (\w+)(?: \{ create; \})?$/i.exec(one))) return { k: 'useAssoc', name: m[1], create: /create/.test(one) };
    if (/^use etag$/i.test(one)) return { k: 'useEtag' };
  }
  if ((m = /^(create|update|delete)(?: \( features : (instance|global) \))?$/i.exec(one))) return { k: 'op', op: m[1].toLowerCase(), features: m[2] || '' };
  if ((m = /^association (\w+)(?: \{ create(?: \( features : (instance|global) \))?; \})?$/i.exec(one))) return { k: 'assoc', name: m[1], create: /create/.test(one), features: m[2] || '' };
  if ((m = /^field \(([^)]*)\) ([\s\S]+)$/i.exec(one))) return { k: 'field', props: list(m[1]), fields: list(m[2]) };
  if ((m = /^(internal )?(static )?(factory )?action(?: \( features : (instance|global) \))? (\w+)(?: parameter (\w+))?(?: result \[([^\]]+)\] (\$self|\w+))?$/i.exec(one))) return { k: 'action', internal: !!m[1], static: !!m[2], factory: !!m[3], features: m[4] || '', name: m[5], param: m[6] || '', result: m[7] ? `[${m[7]}] ${m[8]}` : '' };
  if ((m = /^determination (\w+) on (modify|save) \{ ([^}]*)\}$/i.exec(one))) return { k: 'det', name: m[1], when: m[2].toLowerCase(), ...triggers(m[3]) };
  if ((m = /^validation (\w+) on save \{ ([^}]*)\}$/i.exec(one))) return { k: 'val', name: m[1], ...triggers(m[2]) };
  if ((m = /^mapping for (\w+)( corresponding)?\s*\{([\s\S]*)\}$/i.exec(s.trim()))) return { k: 'mapping', table: m[1], corresponding: !!m[2], pairs: statements(m[3]).map(p => p.split('=').map(x => x.trim())).filter(p => p.length === 2) };
  return { k: 'raw', text: s.trim() };
}
function triggers(t) {
  const parts = statements(t);
  const ops = parts.filter(p => /^(create|update|delete)$/i.test(p)).map(p => p.toLowerCase());
  const fields = parts.filter(p => /^field /i.test(p)).flatMap(p => list(p.replace(/^field /i, '')));
  return { ops, fields };
}
export function parseBdef(text) {
  const t = text.replace(/\r/g, '');
  const first = t.search(/^\s*define behavior for/im);
  const head = first < 0 ? t : t.slice(0, first);
  const projection = /^\s*projection\s*;/im.test(head);
  const firstStmt = statements(head)[0]?.replace(/\s+/g, ' ') || 'managed';
  const impl = /^(.*?)(?: implementation in class (\w+) unique)?$/i.exec(firstStmt);
  const model = { projection, kind: projection ? 'projection' : impl[1].toLowerCase(), cls: impl[2] || '', strict: /strict\s*\(\s*(\d)\s*\)/i.exec(head)?.[1] || '', draft: /^\s*(with draft|use draft)\s*;/im.test(head), headRaw: [], entities: [] };
  for (const s of statements(head)) if (!/^(managed|unmanaged|abstract|projection|strict|with draft|use draft)\b/i.test(s.replace(/\s+/g, ' '))) model.headRaw.push(s);
  const re = /define behavior for (\w+)(?:\s+alias\s+(\w+))?([^{]*)\{/gi;
  let m;
  while ((m = re.exec(t))) {
    let depth = 1, i = re.lastIndex;
    for (; i < t.length && depth; i++) { if (t[i] === '{') depth++; if (t[i] === '}') depth--; }
    const body = t.slice(re.lastIndex, i - 1);
    re.lastIndex = i;
    const chars = m[3].replace(/\s+/g, ' ').trim();
    const ch = { table: /persistent table (\w+)/i.exec(chars)?.[1] || '', draftTable: /draft table (\w+)/i.exec(chars)?.[1] || '', lock: /lock (master|dependent by \w+)/i.exec(chars)?.[1] || '', auth: /authorization (master \( (?:instance|global)(?:, (?:instance|global))? \)|dependent by \w+)/i.exec(chars)?.[1] || '', etag: /(?<!total )etag master (\w+)/i.exec(chars)?.[1] || '', totalEtag: /total etag (\w+)/i.exec(chars)?.[1] || '', other: chars.replace(/persistent table \w+|draft table \w+|lock (master|dependent by \w+)|authorization (master \([^)]*\)|dependent by \w+)|total etag \w+|etag master \w+/gi, '').trim() };
    model.entities.push({ name: m[1], alias: m[2] || '', ...ch, items: statements(body).map(s => parseStatement(s, projection)) });
  }
  return model;
}
function writeStatement(x, ind) {
  switch (x.k) {
    case 'use': return `use ${x.op};`;
    case 'useAction': return `use action ${x.name};`;
    case 'useAssoc': return `use association ${x.name}${x.create ? ' { create; }' : ''};`;
    case 'useEtag': return null;
    case 'op': return `${x.op}${x.features ? ` ( features : ${x.features} )` : ''};`;
    case 'assoc': return `association ${x.name}${x.create ? ` { create${x.features ? ` ( features : ${x.features} )` : ''}; }` : ''};`;
    case 'field': return `field ( ${x.props.join(', ')} ) ${x.fields.join(', ')};`;
    case 'action': return `${x.internal ? 'internal ' : ''}${x.static ? 'static ' : ''}${x.factory ? 'factory ' : ''}action${x.features ? ` ( features : ${x.features} )` : ''} ${x.name}${x.param ? ` parameter ${x.param}` : ''}${x.result ? ` result ${x.result}` : ''};`;
    case 'det': return `determination ${x.name} on ${x.when} { ${[...x.ops.map(o => `${o};`), ...(x.fields.length ? [`field ${x.fields.join(', ')};`] : [])].join(' ')} }`;
    case 'val': return `validation ${x.name} on save { ${[...x.ops.map(o => `${o};`), ...(x.fields.length ? [`field ${x.fields.join(', ')};`] : [])].join(' ')} }`;
    case 'mapping': {
      const w = Math.max(0, ...x.pairs.map(p => p[0].length));
      return `mapping for ${x.table}${x.corresponding ? ' corresponding' : ''}\n${ind}{\n${x.pairs.map(([a, b]) => `${ind}  ${pad(a, w)}= ${b};`).join('\n')}\n${ind}}`;
    }
    default: return /[}]$/.test(x.text) ? x.text : `${x.text};`;
  }
}
export function writeBdef(b) {
  const out = [];
  if (b.projection) out.push('projection;');
  else out.push(`${b.kind}${b.cls ? ` implementation in class ${b.cls} unique` : ''};`);
  if (b.strict) out.push(`strict ( ${b.strict} );`);
  if (b.draft) out.push(b.projection ? 'use draft;' : 'with draft;');
  for (const r of b.headRaw) out.push(/[}]$/.test(r) ? r : `${r};`);
  for (const e of b.entities) {
    out.push('');
    out.push(`define behavior for ${e.name}${e.alias ? ` alias ${e.alias}` : ''}`);
    if (b.projection) { if (e.items.some(x => x.k === 'useEtag')) out.push('use etag'); }
    if (e.table) out.push(`persistent table ${e.table}`);
    if (e.draftTable && b.draft) out.push(`draft table ${e.draftTable}`);
    if (e.lock) out.push(`lock ${e.lock}`);
    if (e.totalEtag) out.push(`total etag ${e.totalEtag}`);
    if (e.auth) out.push(`authorization ${e.auth}`);
    if (e.etag) out.push(`etag master ${e.etag}`);
    if (e.other) out.push(e.other);
    out.push('{');
    let last = null;
    for (const x of e.items) {
      const s = writeStatement(x, '  ');
      if (s === null) continue;
      const group = { op: 1, assoc: 1, use: 1, useAssoc: 1, field: 2, action: 3, useAction: 3, det: 4, val: 5, mapping: 6 }[x.k] || 7;
      if (last !== null && group !== last) out.push('');
      last = group;
      out.push(s.split('\n').map(l => `  ${l.replace(/^  /, '')}`).join('\n').replace(/^  /, '  '));
    }
    out.push('}');
  }
  return `${out.join('\n')}\n`;
}

// ------------------------------------------------------------------ metadata extensions
export function parseDdlx(text) {
  const m = /^([\s\S]*?)annotate\s+(entity|view)\s+(\w+)\s+with\s*\{([\s\S]*)\}\s*$/i.exec(text.trim());
  if (!m) throw new Error('Not a metadata extension (annotate entity … with { … })');
  const elements = [];
  for (const stmt of splitTop(m[4], ';')) {
    const { anns, rest } = takeAnnotations(stmt);
    const name = rest.trim();
    if (!name && !anns.length) continue;
    elements.push({ name, anns: flatten(anns) });
  }
  return { header: flatten(takeAnnotations(m[1]).anns), kind: m[2], entity: m[3], elements };
}
export function writeDdlx(d) {
  const out = toLines(d.header);
  out.push(`annotate ${d.kind || 'entity'} ${d.entity} with`);
  out.push('{');
  d.elements.forEach((e, i) => {
    if (i) out.push('');
    for (const l of toLines(e.anns, '  ')) out.push(l);
    out.push(`  ${e.name};`);
  });
  out.push('}');
  return `${out.join('\n')}\n`;
}

// ------------------------------------------------------------------ classic screens (DYNPROS of a .prog.xml)
const tag = (xml, t) => { const m = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(xml); return m ? m[1] : ''; };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const n3 = v => String(Number(v) || 0).padStart(3, '0');
// the screens themselves: every element type, table controls, subscreens (classic.js)
export { parseScreens, writeScreens } from './classic.js';
// the flow logic of a screen: PBO / PAI module calls (the rest kept as written)
export function parseFlow(text) {
  const pbo = [], pai = [];
  let cur = null;
  for (const line of String(text || '').split('\n')) {
    if (/^\s*PROCESS\s+BEFORE\s+OUTPUT/i.test(line)) { cur = pbo; continue; }
    if (/^\s*PROCESS\s+AFTER\s+INPUT/i.test(line)) { cur = pai; continue; }
    const m = /^\s*MODULE\s+(\w+)(\s+AT\s+EXIT-COMMAND)?\s*\.?\s*$/i.exec(line);
    if (m && cur) cur.push({ name: m[1].toLowerCase(), exit: !!m[2] });
    else if (line.trim() && cur) cur.push({ raw: line.trim() });
  }
  return { pbo, pai };
}
export function writeFlow(f) {
  const mod = x => (x.raw ? `  ${x.raw}` : `  MODULE ${x.name}${x.exit ? ' AT EXIT-COMMAND' : ''}.`);
  return `PROCESS BEFORE OUTPUT.\n${f.pbo.map(mod).join('\n')}\n\nPROCESS AFTER INPUT.\n${f.pai.map(mod).join('\n')}\n`;
}
