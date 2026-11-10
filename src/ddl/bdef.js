// Parser for behavior definitions (managed and projection BDEFs).
import { tokenize, TokenStream } from './lexer.js';

// Generic structure: statement = tokens up to ';' or a '{ ... }' block.
function parseStatements(s, inBlock) {
  const out = [];
  while (!s.eof() && !(inBlock && s.is('}'))) {
    const toks = [];
    let block = null;
    while (!s.eof() && !s.is(';') && !s.is('{') && !s.is('}')) toks.push(s.next());
    if (s.is('{')) { s.next(); block = parseStatements(s, true); s.expect('}'); s.accept(';'); }
    else if (s.is(';')) s.next();
    else if (!toks.length) break;
    if (toks.length || block) out.push({ toks, block });
  }
  return out;
}

const lc = t => String(t.v).toLowerCase();
const words = toks => toks.map(lc);

export function parseBdef(src, file) {
  const s = new TokenStream(tokenize(src, file), file);
  const stmts = parseStatements(s, false);
  const bdef = { kind: 'bdef', type: 'managed', strict: 0, draft: false, entities: [], warnings: [], file };
  for (const st of stmts) {
    const w = words(st.toks);
    if (w[0] === 'define' && w[1] === 'behavior' && w[2] === 'for') { bdef.entities.push(parseEntity(st, bdef, file)); continue; }
    // behavior extension: "extension [using interface i] [implementation in class c unique];" + "extend behavior for Alias { ... }"
    if (w[0] === 'extension') {
      bdef.type = 'extension';
      const ic = w.indexOf('class');
      if (ic > 0) bdef.implClass = w[ic + 1];
      continue;
    }
    if (w[0] === 'extend' && w[1] === 'behavior' && w[2] === 'for') { bdef.entities.push({ ...parseEntity(st, bdef, file), extension: true }); continue; }
    if (['managed', 'unmanaged', 'projection', 'abstract', 'interface'].includes(w[0])) {
      bdef.type = w[0];
      const ic = w.indexOf('class');
      if (w[1] === 'implementation' && ic > 0) bdef.implClass = w[ic + 1];
      if (w.includes('with') && w.includes('additional') && w.includes('save')) bdef.additionalSave = true;
      if (w.includes('unmanaged') && w.includes('save')) bdef.unmanagedSave = true;
      continue;
    }
    if (w[0] === 'strict') { bdef.strict = Number(w[2] || 1); continue; }
    if (w[0] === 'with' && w[1] === 'draft') { bdef.draft = true; continue; }
    if (w[0] === 'with' && w[1] === 'collaborative' && w[2] === 'draft') { bdef.draft = true; bdef.collaborative = true; continue; }
    if (w[0] === 'use' && w[1] === 'draft') { bdef.draft = true; continue; }
    if (w[0] === 'extensible' || w[0] === 'with') continue;
    if (st.toks[0]) throw new Error(`${file}:${st.toks[0].line}: Unknown BDEF statement '${w.join(' ')}'`);
  }
  bdef.name = bdef.entities.find(e => e.root)?.entity || bdef.entities[0]?.entity;
  return bdef;
}

function parseEntity(st, bdef, file) {
  const t = st.toks.map(x => x.v);
  const w = words(st.toks);
  const e = {
    entity: w[3], alias: w[3], root: false, ops: {}, fields: {}, assocs: {}, actions: {},
    determinations: [], validations: [], mapping: {}, line: st.toks[0].line,
    draftActions: new Set(), prepare: null,
  };
  for (let i = 4; i < w.length; i++) {
    if (w[i] === 'alias') { e.alias = t[++i]; continue; }
    if (w[i] === 'persistent' && w[i + 1] === 'table') { e.persistentTable = w[i + 2]; i += 2; continue; }
    if (w[i] === 'draft' && w[i + 1] === 'table') { e.draftTable = w[i + 2]; i += 2; continue; }
    if (w[i] === 'lock' && w[i + 1] === 'master') { e.lockMaster = true; e.root = true; i++; continue; }
    if (w[i] === 'lock' && w[i + 1] === 'dependent') { e.lockDependentBy = w[i + 3]; i += 3; continue; }
    if (w[i] === 'etag' && w[i + 1] === 'master') { e.etag = w[i + 2]; i += 2; continue; }
    if (w[i] === 'etag' && w[i + 1] === 'dependent') { i += 3; continue; }
    if (w[i] === 'total' && w[i + 1] === 'etag') { e.totalEtag = w[i + 2]; i += 2; continue; }
    if (w[i] === 'changedocuments' && w[i + 1] === 'master') { const k = w[i + 2] === '(' ? i + 3 : i + 2; e.changeDocuments = w[k] || e.entity; i = w[k + 1] === ')' ? k + 1 : k; continue; }
    if (w[i] === 'changedocuments' && w[i + 1] === 'dependent') { e.changeDocumentsDependent = w[i + 3]; i += 3; continue; }
    if (w[i] === 'early' && w[i + 1] === 'numbering') { e.earlyNumbering = true; i++; continue; }
    if (w[i] === 'late' && w[i + 1] === 'numbering') { e.lateNumbering = true; i++; continue; }
    if (w[i] === 'implementation' && w[i + 1] === 'in' && w[i + 2] === 'class') { e.implClass = w[i + 3]; i += 3; continue; }
    if (w[i] === 'use' && w[i + 1] === 'etag') { i++; continue; }
    if (w[i] === 'with' && w[i + 1] === 'unmanaged' && w[i + 2] === 'save') { e.unmanagedSave = true; i += 2; continue; }
    if (w[i] === 'with' && w[i + 1] === 'additional' && w[i + 2] === 'save') { e.additionalSave = true; i += 2; continue; }
  }
  if (bdef.type === 'projection' && !bdef.entities.length) e.root = true;
  if (!e.lockDependentBy && bdef.type !== 'projection') e.root = true;

  for (const b of st.block || []) parseBodyStatement(b, e, bdef, file);
  return e;
}

function parseBodyStatement(b, e, bdef, file) {
  const t = b.toks.map(x => x.v);
  let w = words(b.toks);
  const line = b.toks[0]?.line;
  const fail = msg => { throw new Error(`${file}:${line}: ${msg}`); };
  let internal = false;
  if (w[0] === 'internal') { internal = true; w = w.slice(1); t.splice(0, 1); }
  if (w[0] === 'use') {
    // projection: use create; use action x; use association _y { create; }
    w = w.slice(1); t.splice(0, 1);
    e.useOnly = true;
  }
  const kw = w[0];
  if (['create', 'update', 'delete'].includes(kw)) {
    e.ops[kw] = { features: w.includes('features') ? w[w.indexOf('features') + 2] : null, precheck: w.includes('precheck') };
    return;
  }
  if (kw === 'field') {
    // field ( readonly, numbering : managed ) A, B;
    const close = w.indexOf(')');
    const props = [];
    let cur = [];
    for (const x of w.slice(2, close)) { if (x === ',') { props.push(cur.join('')); cur = []; } else cur.push(x); }
    if (cur.length) props.push(cur.join(''));
    const names = w.slice(close + 1).filter(x => x !== ',');
    for (const n of names) {
      const f = e.fields[n] ||= {};
      for (const p of props) {
        if (p === 'readonly') f.readonly = true;
        else if (p === 'readonly:update') f.readonlyUpdate = true;
        else if (p === 'mandatory') f.mandatory = true;
        else if (p === 'mandatory:create') f.mandatoryCreate = true;
        else if (p === 'numbering:managed') f.numberingManaged = true;
        else if (p === 'features:instance') f.features = true;
        else if (p === 'suppress') f.suppress = true;
      }
    }
    return;
  }
  if (kw === 'association') {
    const name = w[1];
    const a = e.assocs[name] = { name, create: false, abbreviated: false };
    for (const x of b.block || []) if (lc(x.toks[0] || {}) === 'create' || (lc(x.toks[0] || {}) === 'use' && lc(x.toks[1] || {}) === 'create')) a.create = true;
    return;
  }
  if (kw === 'action' || (kw === 'static' && w[1] === 'action') || (kw === 'factory' && w[1] === 'action') ||
      (kw === 'static' && w[1] === 'factory') || kw === 'determine') {
    if (kw === 'determine') { e.determineActions ||= []; e.determineActions.push(w[2]); return; }
    let i = w.indexOf('action') + 1;
    const a = { internal, static: w[0] === 'static', factory: w.includes('factory'), features: false, param: null, result: null };
    if (w[i] === '(') {
      const close = w.indexOf(')', i);
      const inner = w.slice(i + 1, close).join('');
      if (inner.includes('features:instance')) a.features = true;
      if (inner.includes('authorization:none')) a.noAuth = true;
      i = close + 1;
    }
    a.name = w[i];
    a.label = t[i];
    for (let j = i + 1; j < w.length; j++) {
      if (w[j] === 'parameter') a.param = w[++j];
      if (w[j] === 'result') {
        // result [1] $self | result [0..*] EntityName
        j++;
        if (w[j] === '[') { const c = w.indexOf(']', j); a.resultCard = w.slice(j + 1, c).join(''); j = c + 1; }
        a.result = w[j] === '$self' ? '$self' : (w[j] === 'entity' ? w[j + 1] : w[j]);
      }
      if (w[j] === '[' && !a.result && a.factory) { const c = w.indexOf(']', j); a.resultCard = w.slice(j + 1, c).join(''); j = c; }
    }
    if (e.useOnly) a.use = true;
    e.actions[a.name] = a;
    return;
  }
  if (kw === 'determination') {
    // determination setStatus on modify { create; update; delete; field A, B; }
    const d = { name: w[1], label: t[1], when: w[3], create: false, update: false, delete: false, fields: [] };
    for (const x of b.block || []) {
      const xw = words(x.toks);
      if (xw[0] === 'create') d.create = true;
      else if (xw[0] === 'update') d.update = true;
      else if (xw[0] === 'delete') d.delete = true;
      else if (xw[0] === 'field') d.fields.push(...xw.slice(1).filter(v => v !== ','));
    }
    e.determinations.push(d);
    return;
  }
  if (kw === 'validation') {
    const v = { name: w[1], label: t[1], create: false, update: false, delete: false, fields: [] };
    for (const x of b.block || []) {
      const xw = words(x.toks);
      if (xw[0] === 'create') v.create = true;
      else if (xw[0] === 'update') v.update = true;
      else if (xw[0] === 'delete') v.delete = true;
      else if (xw[0] === 'field') v.fields.push(...xw.slice(1).filter(v => v !== ','));
    }
    e.validations.push(v);
    return;
  }
  if (kw === 'mapping') {
    // mapping for ztab [corresponding] { Element = column; }
    e.mappingTable = w[2];
    e.mappingCorresponding = w.includes('corresponding');
    for (const x of b.block || []) {
      const xw = words(x.toks);
      if (xw[1] === '=') e.mapping[xw[0]] = xw[2];
    }
    return;
  }
  if (kw === 'draft' && w[1] === 'action') {
    // draft action Edit; draft action Activate optimized; draft action Discard; draft action Resume;
    let i = 2;
    if (w[i] === '(') i = w.indexOf(')', i) + 1;
    e.draftActions.add(w[i]);
    return;
  }
  if (kw === 'draft' && w[1] === 'determine' && w[2] === 'action') {
    // draft determine action Prepare { validation a; determination b; }
    e.draftActions.add(w[3]);
    e.prepare = { validations: [], determinations: [] };
    for (const x of b.block || []) {
      const xw = words(x.toks);
      // entries may be qualified with the entity alias: Booking~validateFlightDate
      if (xw[0] === 'validation') e.prepare.validations.push(...xw.slice(1).join('').split(',').filter(Boolean));
      if (xw[0] === 'determination') e.prepare.determinations.push(...xw.slice(1).join('').split(',').filter(Boolean));
    }
    return;
  }
  if (kw === 'side' && w[1] === 'effects') {
    // side effects { field A affects field B, field _Assoc.C, entity _Assoc; action x affects $self; }
    e.sideEffects ||= [];
    for (const x of b.block || []) {
      const xt = x.toks.map(t => t.v);
      const xw = xt.map(v => String(v).toLowerCase());
      const ai = xw.indexOf('affects');
      if (ai < 0) continue;
      const sources = [];
      for (let i = 0; i < ai; i++) {
        if (xw[i] === 'field' || xw[i] === 'action') { sources.push({ kind: xw[i], name: xw[i + 1] }); i++; }
      }
      const targets = [];
      const rest = xt.slice(ai + 1).join(' ').split(',').map(t => t.trim()).filter(Boolean);
      for (const t of rest) {
        const m = /^(field|entity|permissions|messages)\s*(.*)$/i.exec(t) || [null, t === '$self' ? 'self' : 'field', t];
        targets.push({ kind: m[1].toLowerCase(), path: m[2].replace(/\s*\.\s*/g, '.').toLowerCase() });
      }
      if (sources.length && targets.length) e.sideEffects.push({ sources, targets });
    }
    return;
  }
  if (kw === 'event' || (kw === 'managed' && w[1] === 'event')) {
    // event Name [parameter ZD_Param];  managed event Name on Trigger parameter ...
    const k = kw === 'event' ? 1 : 2;
    const pi = w.indexOf('parameter');
    (e.events ||= {})[w[k]] = { name: w[k], label: t[k], param: pi > 0 ? w[pi + 1] : null, managed: kw === 'managed' };
    return;
  }
  if (['side', 'draft', 'static', 'factory', 'with', 'managed', 'function'].includes(kw)) {
    if (kw === 'function') e.functionsIgnored = true;
    return; // side effects, draft actions, events: ignored for now
  }
  if (kw === 'authorization' || kw === 'lock' || kw === 'etag') return;
  fail(`Unknown behavior statement '${w.join(' ')}'`);
}
