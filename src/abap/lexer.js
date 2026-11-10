// ABAP tokenizer.
// Token: { t, v, ws, line }  ws = whitespace directly before the token (ABAP is whitespace-sensitive:
// `meth( x )` is a call, `a - b` is a subtraction, `a-b` is a component selector).
// t: 'id'   identifier or path (struct-comp, obj->attr, cls=>const, intf~meth, <fs>-comp, bo\entity)
//    'num'  integer literal
//    'char' '...' text field literal      'str' `...` string literal
//    'tpl'  |...{ expr }...| string template, v = [{ text } | { tokens }]
//    'sel'  component selection after ) or ], e.g. `)-field`  v = '-field'
//    'p'    punctuation / operator
//    'dot'  statement terminator          'colon' chain colon
export class AbapSyntaxError extends Error {
  constructor(msg, file, line) { super(`${file || '<abap>'}:${line ?? '?'}: ${msg}`); this.file = file; this.line = line; this.bare = msg; }
}

const OPS = ['&&=', '**', '<=', '>=', '<>', '&&', '+=', '-=', '*=', '/=', '?=', '=<', '=>', '(', ')', '[', ']', '=', '<', '>', '+', '-', '*', '/', ',', '@', '#', '&', '{', '}'];
const W = /[A-Za-z0-9_%$]/;

export function tokenize(src, file, lineOffset = 0) {
  const toks = [];
  let i = 0, line = 1 + lineOffset, ws = true;
  const n = src.length;
  const push = (t, v) => { toks.push({ t, v, ws, line }); ws = false; };

  const readPathTail = () => {
    // continue a path after the first word: -comp ->attr =>static ~intfmeth \entity
    let v = '';
    for (;;) {
      if (src[i] === '-' && src[i + 1] === '>' && src[i + 2] === '*') { v += '->*'; i += 3; continue; }
      if (src[i] === '-' && src[i + 1] === '>' && /[A-Za-z_%<\/]/.test(src[i + 2] || '')) { v += '->'; i += 2; v += readWord(); continue; }
      if (src[i] === '=' && src[i + 1] === '>' && /[A-Za-z_%\/]/.test(src[i + 2] || '')) { v += '=>'; i += 2; v += readWord(); continue; }
      if (src[i] === '-' && /[A-Za-z_%<]/.test(src[i + 1] || '')) { v += '-'; i += 1; v += readWord(); continue; }
      if (src[i] === '~' && src[i + 1] === '*') { v += '~*'; i += 2; continue; }
      if (src[i] === '~' && /[A-Za-z_%\/]/.test(src[i + 1] || '')) { v += '~'; i += 1; v += readWord(); continue; }
      if (src[i] === '\\' && /[A-Za-z_\\]/.test(src[i + 1] || '')) { v += '\\'; i += 1; if (src[i] === '\\') { v += '\\'; i++; } v += readWord(); continue; }
      return v;
    }
  };
  const readWord = () => {
    let v = '';
    const ns = /^\/[A-Za-z0-9_]+\//.exec(src.slice(i, i + 40));
    if (ns) { v += ns[0]; i += ns[0].length; }
    const fs = /^<[A-Za-z0-9_]+>/.exec(src.slice(i, i + 64));
    if (fs) { v += fs[0]; i += fs[0].length; return v; }
    while (i < n && W.test(src[i])) v += src[i++];
    return v;
  };

  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; ws = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; ws = true; continue; }
    // full-line comment: '*' in column 1
    if (c === '*' && (i === 0 || src[i - 1] === '\n')) { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '"') { while (i < n && src[i] !== '\n') i++; continue; }
    // pragmas: ##NAME or ##NAME[PARAM]
    if (c === '#' && src[i + 1] === '#') { i += 2; while (i < n && /[A-Za-z0-9_\[\]]/.test(src[i])) i++; continue; }
    // ';' only occurs in AMDP (SQLScript) bodies, which are skipped by the compiler
    if (c === ';') { push('p', ';'); i++; continue; }
    if (c === '.') { push('dot', '.'); i++; continue; }
    if (c === ':') { push('colon', ':'); i++; continue; }
    if (c === "'") { push('char', readQuoted("'")); continue; }
    if (c === '`') { push('str', readQuoted('`')); continue; }
    if (c === '|') { push('tpl', readTemplate()); continue; }
    if (/[0-9]/.test(c)) {
      let v = '';
      while (i < n && /[0-9]/.test(src[i])) v += src[i++];
      if (W.test(src[i] || '')) { while (i < n && W.test(src[i])) v += src[i++]; v += readPathTail(); push('id', v); continue; }
      push('num', v); continue;
    }
    if (c === '!' && /[A-Za-z_]/.test(src[i + 1] || '')) { i++; continue; } // escape character for names
    const isFs = c === '<' && /^<[A-Za-z0-9_]+>/.test(src.slice(i, i + 64)) && !(ws === false && toks.length && toks[toks.length - 1].t === 'id');
    const isNs = c === '/' && /^\/[A-Za-z0-9_]+\/[A-Za-z_]/.test(src.slice(i, i + 40)) && ws;
    if (/[A-Za-z_%$]/.test(c) || isFs || isNs || (c === '\\' && /[A-Za-z_]/.test(src[i + 1] || ''))) {
      let v = '';
      if (c === '\\') { v = '\\'; i++; }
      v += readWord();
      v += readPathTail();
      push('id', v);
      continue;
    }
    if ((c === ')' || c === ']')) {
      push('p', c); i++;
      if ((src[i] === '-' && /[A-Za-z_%]/.test(src[i + 1] || '')) || (src[i] === '-' && src[i + 1] === '>' && /[A-Za-z_]/.test(src[i + 2] || ''))) {
        const save = ws; ws = false;
        push('sel', readPathTail());
        ws = save;
        ws = false;
      }
      continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (!op) throw new AbapSyntaxError(`Unexpected character '${c}'`, file, line);
    push('p', op); i += op.length;
  }
  return toks;

  function readQuoted(q) {
    let s = ''; i++;
    for (;;) {
      if (i >= n || src[i] === '\n') throw new AbapSyntaxError('Unterminated literal', file, line);
      if (src[i] === q && src[i + 1] === q) { s += q; i += 2; continue; }
      if (src[i] === q) { i++; return s; }
      s += src[i++];
    }
  }
  function readTemplate() {
    const parts = []; let text = ''; i++;
    for (;;) {
      if (i >= n) throw new AbapSyntaxError('Unterminated string template', file, line);
      const ch = src[i];
      if (ch === '\\') {
        const e = src[i + 1];
        text += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
        i += 2; continue;
      }
      if (ch === '|') { i++; break; }
      if (ch === '{') {
        if (text) parts.push({ text }); text = '';
        let depth = 1, j = i + 1;
        while (j < n && depth) {
          if (src[j] === "'" || src[j] === '`') { const q = src[j++]; while (j < n && src[j] !== q) j++; }
          else if (src[j] === '|') { j++; while (j < n && src[j] !== '|') { if (src[j] === '\\') j++; j++; } }
          else if (src[j] === '{') depth++;
          else if (src[j] === '}') depth--;
          j++;
        }
        const inner = src.slice(i + 1, j - 1);
        parts.push({ tokens: tokenize(inner, file, line - 1) });
        for (const ch2 of inner) if (ch2 === '\n') line++;
        i = j; continue;
      }
      if (ch === '\n') line++;
      text += ch; i++;
    }
    if (text) parts.push({ text });
    return parts;
  }
}

// Split token list into statements, expanding chained statements (`DATA: a TYPE i, b TYPE i.`).
export function splitStatements(tokens) {
  const stmts = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    const ci = cur.findIndex(t => t.t === 'colon');
    if (ci < 0) { stmts.push(cur); cur = []; return; }
    const prefix = cur.slice(0, ci);
    const rest = cur.slice(ci + 1);
    let part = [], depth = 0;
    const parts = [];
    for (const t of rest) {
      if (t.t === 'p' && ['(', '['].includes(t.v)) depth++;
      if (t.t === 'p' && [')', ']'].includes(t.v)) depth--;
      if (depth === 0 && t.t === 'p' && t.v === ',') { parts.push(part); part = []; continue; }
      part.push(t);
    }
    parts.push(part);
    for (const p of parts) if (p.length || prefix.length) stmts.push([...prefix, ...p]);
    cur = [];
  };
  for (const t of tokens) {
    if (t.t === 'dot') flush(); else cur.push(t);
  }
  if (cur.length) flush();
  return stmts;
}
