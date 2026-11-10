// Tokenizer shared by the CDS (DDL/DDLX/SRVD) and BDEF parsers.
// Tokens: { t: 'id' | 'str' | 'num' | 'p', v, line, col }

export class SourceError extends Error {
  constructor(message, file, line, col) {
    super(`${file || '<source>'}:${line ?? '?'}:${col ?? '?'} ${message}`);
    this.file = file; this.line = line; this.col = col; this.bare = message;
  }
}

const PUNCT = ['..', '<=', '>=', '<>', '!=', '=>', '{', '}', '(', ')', '[', ']', ';', ',', ':', '.', '=', '<', '>', '@', '#', '*', '+', '-', '/', '\\', '~', '|', '?'];

export function tokenize(src, file) {
  const out = [];
  let i = 0, line = 1, lineStart = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; lineStart = i; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    const col = i - lineStart + 1;
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '-' && src[i + 1] === '-') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') { line++; lineStart = i + 1; } i++; }
      i += 2; continue;
    }
    if (c === '"') { // quoted identifier, e.g. "%admin" in draft tables
      const j = src.indexOf('"', i + 1);
      if (j < 0) throw new SourceError('Unterminated quoted identifier', file, line, col);
      out.push({ t: 'id', v: src.slice(i + 1, j), line, col });
      i = j + 1;
      continue;
    }
    if (c === "'") {
      let s = ''; i++;
      while (i < n) {
        if (src[i] === "'" && src[i + 1] === "'") { s += "'"; i += 2; continue; }
        if (src[i] === "'") break;
        s += src[i++];
      }
      if (i >= n) throw new SourceError('Unterminated string literal', file, line, col);
      i++;
      out.push({ t: 'str', v: s, line, col });
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^\d+(\.\d+)?/.exec(src.slice(i, i + 40));
      out.push({ t: 'num', v: m[0], line, col });
      i += m[0].length; continue;
    }
    // identifiers; namespaces like /DMO/I_Travel are one identifier
    const nsm = /^\/[A-Za-z0-9_]+\/[A-Za-z0-9_]+/.exec(src.slice(i, i + 80));
    if (nsm) { out.push({ t: 'id', v: nsm[0], line, col }); i += nsm[0].length; continue; }
    if (/[A-Za-z_$%]/.test(c)) {
      const m = /^[A-Za-z_$%][A-Za-z0-9_$%]*/.exec(src.slice(i, i + 200));
      out.push({ t: 'id', v: m[0], line, col });
      i += m[0].length; continue;
    }
    const p = PUNCT.find(p => src.startsWith(p, i));
    if (!p) throw new SourceError(`Unexpected character '${c}'`, file, line, col);
    out.push({ t: 'p', v: p, line, col });
    i += p.length;
  }
  out.push({ t: 'eof', v: '<end of file>', line, col: 1 });
  return out;
}

// Minimal recursive-descent helper with case-insensitive keyword matching.
export class TokenStream {
  constructor(tokens, file) { this.toks = tokens; this.i = 0; this.file = file; }
  peek(k = 0) { return this.toks[Math.min(this.i + k, this.toks.length - 1)]; }
  next() { return this.toks[this.i < this.toks.length - 1 ? this.i++ : this.i]; }
  eof() { return this.peek().t === 'eof'; }
  is(v, k = 0) {
    const t = this.peek(k);
    if (t.t === 'eof') return false;
    if (t.t === 'p') return t.v === v;
    if (t.t === 'id') return t.v.toLowerCase() === v.toLowerCase();
    return false;
  }
  isSeq(...vs) { return vs.every((v, k) => this.is(v, k)); }
  accept(v) { if (this.is(v)) return this.next(); return null; }
  acceptSeq(...vs) { if (this.isSeq(...vs)) { vs.forEach(() => this.next()); return true; } return false; }
  expect(v) {
    if (this.is(v)) return this.next();
    this.fail(`Expected '${v}' but found '${this.peek().v}'`);
  }
  ident() {
    const t = this.peek();
    if (t.t !== 'id') this.fail(`Expected identifier but found '${t.v}'`);
    return this.next().v;
  }
  fail(msg, tok = this.peek()) { throw new SourceError(msg, this.file, tok.line, tok.col); }
  // skip tokens until one of the given punctuation values at nesting depth 0 (not consumed)
  skipUntil(...stops) {
    let depth = 0;
    while (!this.eof()) {
      const t = this.peek();
      if (depth === 0 && t.t === 'p' && stops.includes(t.v)) return;
      if (t.t === 'p' && ['(', '{', '['].includes(t.v)) depth++;
      if (t.t === 'p' && [')', '}', ']'].includes(t.v)) { if (depth === 0) return; depth--; }
      this.next();
    }
  }
}
