// CDS access control (DCL, .dcls.asdcls): define role ... { grant select on <entity> [where <condition>]; }
// Conditions: element comparisons with literals, "= aspect user", "= aspect pfcg_auth( object, field, ACTVT = '03' )"
// (also with element lists), "inheriting conditions from entity <e> [default true|false]", and/or/not/parentheses,
// true/false. DEFAULT says what the inherited condition is when <e> has no access control of its own (true if omitted).
// Each request turns the grants of an entity into an SQL condition for the current user's authorizations.
import { tokenize, TokenStream } from './lexer.js';
import { valueAllowed } from '../server/auth.js';

export function parseDcl(src, file) {
  const s = new TokenStream(tokenize(src, file), file);
  const roles = [];
  while (!s.eof()) {
    if (!s.isSeq('define', 'role')) { s.next(); continue; }   // annotations before the role
    s.next(); s.next();
    const role = { name: s.ident(), grants: [], file };
    s.expect('{');
    while (!s.is('}') && !s.eof()) {
      const line = s.peek().line;
      s.expect('grant'); s.expect('select'); s.expect('on');
      const entity = s.ident().toLowerCase();
      let where = { k: 'true' };
      if (s.accept('where')) where = parseOr(s);
      s.expect(';');
      role.grants.push({ entity, where, line });
    }
    s.expect('}');
    roles.push(role);
  }
  return roles;
}

function parseOr(s) {
  let l = parseAnd(s);
  while (s.accept('or')) l = { k: 'or', l, r: parseAnd(s) };
  return l;
}
function parseAnd(s) {
  let l = parseNot(s);
  while (s.accept('and')) l = { k: 'and', l, r: parseNot(s) };
  return l;
}
function parseNot(s) {
  if (s.accept('not')) return { k: 'not', e: parseNot(s) };
  return parsePrimary(s);
}
function parsePrimary(s) {
  if (s.is('true') && !s.is('=', 1)) { s.next(); return { k: 'true' }; }
  if (s.is('false') && !s.is('=', 1)) { s.next(); return { k: 'false' }; }
  if (s.isSeq('inheriting', 'conditions')) {
    s.next(); s.next(); s.expect('from'); s.expect('entity');
    const entity = s.ident().toLowerCase();
    let dflt = true;
    if (s.accept('default')) {
      if (s.accept('false')) dflt = false;
      else s.expect('true');
    }
    return { k: 'inherit', entity, default: dflt };
  }
  // ( a, b ) = aspect pfcg_auth(...)  or a parenthesised condition
  if (s.is('(')) {
    let k = 1, depth = 1, list = true;
    for (; depth; k++) { const t = s.peek(k); if (t.t === 'eof') break; if (t.v === '(') depth++; if (t.v === ')') depth--; else if (depth === 1 && !(t.t === 'id' || t.v === ',' || t.v === '.')) list = false; }
    if (list && (s.is('=', k) || s.is('?', k))) {
      s.next();
      const els = [path(s)];
      while (s.accept(',')) els.push(path(s));
      s.expect(')');
      return comparison(s, els);
    }
    s.next();
    const e = parseOr(s);
    s.expect(')');
    return e;
  }
  return comparison(s, [path(s)]);
}
function path(s) {
  let p = s.ident();
  while (s.is('.')) { s.next(); p += '.' + s.ident(); }
  return p.toLowerCase();
}
function literal(s) {
  const t = s.next();
  if (t.t === 'str' || t.t === 'num') return t.t === 'num' ? Number(t.v) : t.v;
  s.fail(`Expected a literal but found '${t.v}'`);
}
function comparison(s, els) {
  if (s.is('?')) { s.next(); }   // ?= (null tolerant) behaves like =
  if (s.accept('is')) {
    const not = !!s.accept('not');
    if (s.accept('null')) return { k: 'null', el: els[0], not };
    s.expect('initial');
    return { k: 'initial', el: els[0], not };
  }
  const not = !!s.accept('not');
  if (s.accept('like')) return { k: 'like', el: els[0], v: literal(s), not };
  if (s.accept('between')) { const lo = literal(s); s.expect('and'); return { k: 'between', el: els[0], lo, hi: literal(s), not }; }
  const op = s.next().v;
  if (!['=', '<>', '<', '>', '<=', '>=', '!='].includes(op)) s.fail(`Unsupported operator '${op}' in access condition`);
  if (s.accept('aspect')) {
    if (s.accept('user')) return { k: 'user', el: els[0], op };
    const a = s.ident().toLowerCase();
    if (a !== 'pfcg_auth') s.fail(`Aspect ${a} is not supported (use aspect user or aspect pfcg_auth)`);
    s.expect('(');
    const object = s.ident().toUpperCase();
    const fields = [], filter = {};
    while (s.accept(',')) {
      const f = s.ident().toUpperCase();
      if (s.accept('=')) filter[f] = String(literal(s));
      else fields.push(f);
    }
    s.expect(')');
    if (fields.length !== els.length) s.fail(`pfcg_auth maps ${fields.length} authorization field(s) to ${els.length} element(s)`);
    return { k: 'pfcg', els, object, fields, filter };
  }
  return { k: 'cmp', el: els[0], op: op === '!=' ? '<>' : op, v: literal(s) };
}

// SQL condition for the grants of one entity, or null if the user may read everything.
//   grants: [{ where }], auths: user's authorizations (null = all), col(el) -> SQL column, inherited(entity) -> grants
export function grantsSql(grants, { auths, user, col, inherited, depth = 0 }) {
  if (!grants.length) return null;
  const q = v => (typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  const cond = (x) => {
    switch (x.k) {
      case 'true': return '1=1';
      case 'false': return '1=0';
      case 'and': return `(${cond(x.l)} AND ${cond(x.r)})`;
      case 'or': return `(${cond(x.l)} OR ${cond(x.r)})`;
      case 'not': return `(NOT ${cond(x.e)})`;
      case 'cmp': return `${col(x.el)} ${x.op} ${q(x.v)}`;
      case 'like': return `${col(x.el)} ${x.not ? 'NOT ' : ''}LIKE ${q(x.v)}`;
      case 'between': return `${col(x.el)} ${x.not ? 'NOT ' : ''}BETWEEN ${q(x.lo)} AND ${q(x.hi)}`;
      case 'null': return `${col(x.el)} IS ${x.not ? 'NOT ' : ''}NULL`;
      case 'initial': return `(${x.not ? 'NOT ' : ''}COALESCE(CAST(${col(x.el)} AS TEXT), '') IN ('', '0'))`;
      case 'user': return `${col(x.el)} ${x.op} ${q(user)}`;
      case 'inherit': {
        if (depth > 5) throw new Error('Access conditions inherit in a cycle');
        const s = grantsSql(inherited(x.entity), { auths, user, col, inherited, depth: depth + 1 });
        return s === null ? (x.default === false ? '1=0' : '1=1') : s;
      }
      case 'pfcg': {
        if (auths === null) return '1=1';
        const inst = (auths[x.object] || []).filter(a => Object.entries(x.filter).every(([f, v]) => valueAllowed(a[f], v)));
        if (!inst.length) return '1=0';
        const one = a => x.fields.map((f, i) => {
          const vals = a[f] || [];
          if (vals.includes('*')) return '1=1';
          if (!vals.length) return '1=0';
          const exact = vals.filter(v => !v.endsWith('*')), pat = vals.filter(v => v.endsWith('*'));
          return `(${[exact.length ? `${col(x.els[i])} IN (${exact.map(q).join(', ')})` : null, ...pat.map(p => `${col(x.els[i])} LIKE ${q(p.slice(0, -1).replace(/[%_]/g, '') + '%')}`)].filter(Boolean).join(' OR ')})`;
        }).join(' AND ');
        return `(${inst.map(a => `(${one(a)})`).join(' OR ')})`;
      }
      default: throw new Error(`Unsupported access condition ${x.k}`);
    }
  };
  const parts = grants.map(g => cond(g.where));
  return parts.includes('1=1') ? null : `(${parts.join(' OR ')})`;
}
