// The interface of a function module (SE37's Import / Export / Changing / Tables / Exceptions tabs) <-> the
// "*"Local Interface:" comment block SAP writes after FUNCTION name. Pure functions: the studio's Design view of a
// function module, the New Object dialog (generate.js) and the node tests use them.
export const SECTIONS = ['IMPORTING', 'EXPORTING', 'CHANGING', 'TABLES', 'EXCEPTIONS'];
export const TYPINGS = ['TYPE', 'LIKE', 'TYPE REF TO', 'STRUCTURE'];
const BLOCK = /^[ \t]*\*"[^\n]*\n?/gm;

// { name, params: [{ section, name, byValue, typing, type, default, optional }], exceptions: [name] }
export function parseFm(text) {
  const src = String(text || '');
  const name = /^\s*FUNCTION\s+([\w/]+)\s*\./im.exec(src)?.[1] || '';
  const params = [], exceptions = [];
  let section = null;
  for (const line of src.split('\n')) {
    const m = /^\s*\*"\s*(.*)$/.exec(line);
    if (!m) { if (section && line.trim() && !/^\s*\*/.test(line)) break; continue; }
    const t = m[1].trim();
    if (SECTIONS.includes(t.toUpperCase())) { section = t.toUpperCase(); continue; }
    if (!section || !t || /^-+$/.test(t) || /Local Interface/i.test(t) || /^\*/.test(t)) continue;
    if (section === 'EXCEPTIONS') { exceptions.push(t.split(/\s+/)[0].toUpperCase()); continue; }
    const p = /^(?:(VALUE|REFERENCE)\(\s*([\w/]+)\s*\)|([\w/]+))\s*(?:(TYPE\s+REF\s+TO|TYPE|LIKE|STRUCTURE)\s+([\w/=>~-]+))?(.*)$/i.exec(t);
    if (!p) continue;
    const rest = p[6] || '';
    params.push({
      section, name: (p[2] || p[3]).toUpperCase(), byValue: /^VALUE$/i.test(p[1] || ''),
      typing: (p[4] || 'TYPE').toUpperCase().replace(/\s+/g, ' '), type: (p[5] || '').toUpperCase(),
      default: /DEFAULT\s+('(?:[^']|'')*'|\S+)/i.exec(rest)?.[1] || '', optional: /\bOPTIONAL\b/i.test(rest),
    });
  }
  return { name, params, exceptions };
}

// the comment block for a model
export function interfaceBlock(m) {
  const out = ['*"----------------------------------------------------------------------', '*"*"Local Interface:'];
  for (const sec of SECTIONS) {
    if (sec === 'EXCEPTIONS') { if (m.exceptions.length) out.push('*"  EXCEPTIONS', ...m.exceptions.map(e => `*"      ${String(e).toUpperCase()}`)); continue; }
    const list = m.params.filter(p => p.section === sec && p.name);
    if (!list.length) continue;
    out.push(`*"  ${sec}`);
    for (const p of list) {
      const nm = String(p.name).toUpperCase();
      const typ = p.type ? ` ${sec === 'TABLES' && p.typing === 'TYPE REF TO' ? 'TYPE' : p.typing}  ${String(p.type).toUpperCase()}` : '';
      const def = p.default && sec !== 'EXPORTING' && sec !== 'TABLES' ? ` DEFAULT ${p.default}` : '';
      const opt = p.optional && sec !== 'EXPORTING' ? ' OPTIONAL' : '';
      out.push(sec === 'TABLES' ? `*"      ${nm}${typ}${opt}` : `*"     ${p.byValue || sec === 'EXPORTING' && p.byValue !== false ? `VALUE(${nm})` : `REFERENCE(${nm})`}${typ}${def}${opt}`);
    }
  }
  out.push('*"----------------------------------------------------------------------');
  return `${out.join('\n')}\n`;
}

// the source with the model's interface (the block replaced, or inserted after FUNCTION)
export function writeFm(text, m) {
  const src = String(text || '');
  const block = interfaceBlock(m);
  const fn = /^[ \t]*FUNCTION\s+[\w/]+\s*\.[^\n]*\n?/im.exec(src);
  if (!fn) return src;
  const after = src.slice(fn.index + fn[0].length);
  const lead = /^(?:[ \t]*\*"[^\n]*\n?)+/.exec(after);
  return src.slice(0, fn.index + fn[0].length) + block + (lead ? after.slice(lead[0].length) : after);
}

// checks of the interface: names, duplicates, typing
export function checkFm(m) {
  const out = [], seen = new Set();
  for (const p of m.params) {
    if (!/^[A-Z_/][A-Z0-9_/]*$/i.test(p.name || '')) out.push(`${p.name || '(empty)'}: not a valid parameter name`);
    if (seen.has(String(p.name).toUpperCase())) out.push(`${p.name}: twice`);
    seen.add(String(p.name).toUpperCase());
    if (!p.type && p.section !== 'TABLES') out.push(`${p.name}: no type (generic parameters are not supported here)`);
    if (p.section === 'TABLES' && p.typing === 'TYPE REF TO') out.push(`${p.name}: a TABLES parameter is typed with STRUCTURE, LIKE or a table type`);
  }
  for (const e of m.exceptions) if (!/^[A-Z_][A-Z0-9_]*$/i.test(e)) out.push(`${e}: not a valid exception name`);
  return out;
}

// the dialog's short form: "importing iv_x type zdtel default 10 optional value" per line
export function paramsFromLines(text) {
  const m = { params: [], exceptions: [] };
  for (const raw of String(text || '').split('\n')) {
    const l = raw.trim().replace(/\.$/, '');
    if (!l) continue;
    const w = l.split(/\s+/);
    let sec = w[0].toUpperCase();
    sec = { IMPORT: 'IMPORTING', EXPORT: 'EXPORTING', CHANGE: 'CHANGING', TABLE: 'TABLES', EXCEPTION: 'EXCEPTIONS', RAISING: 'EXCEPTIONS' }[sec] || sec;
    if (!SECTIONS.includes(sec)) throw new Error(`"${l}": start with importing, exporting, changing, tables or exceptions`);
    if (sec === 'EXCEPTIONS') { m.exceptions.push(...w.slice(1).map(x => x.toUpperCase())); continue; }
    const rest = l.slice(w[0].length).trim();
    const p = /^([\w/]+)(?:\s+(type\s+ref\s+to|type|like|structure)\s+([\w/=>~-]+))?(.*)$/i.exec(rest);
    if (!p) throw new Error(`"${l}": name and type expected`);
    const tail = p[4] || '';
    m.params.push({ section: sec, name: p[1].toUpperCase(), typing: (p[2] || (sec === 'TABLES' ? 'STRUCTURE' : 'TYPE')).toUpperCase().replace(/\s+/g, ' '), type: (p[3] || '').toUpperCase(),
      default: /\bdefault\s+('(?:[^']|'')*'|\S+)/i.exec(tail)?.[1] || '', optional: /\b(optional|default)\b/i.test(tail), byValue: /\bvalue\b/i.test(tail) || sec === 'EXPORTING' });
  }
  return m;
}
