// Activation: reads a workspace, parses every source, builds the runtime model, creates the
// database schema (tables + one SQL view per CDS view entity) and compiles ABAP classes.
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../db/index.js';
import { parseCds, mergeDeep } from '../ddl/cds.js';
import { parseBdef } from '../ddl/bdef.js';
import { compileAbap, registerInterfaces, setDdicTypes } from '../abap/compiler.js';
import { lockObjects } from './locks.js';
import { functionGroupUnits } from '../abap/fugr.js';
import { parseDcl, grantsSql } from '../ddl/dcl.js';
import { AbapRuntime } from '../abap/runtime.js';
import { resolveType, isNumeric, toDb } from './types.js';
import { systemDirOf, systemCatalog, referencesOf } from './catalog.js';
import { readDdic, builtinOf, expandIncludes, checkDdic, checkEnqu, systemDdicFiles } from './ddic.js';

const CDS_EXT = /\.(cds|asddls|ddls|asddlxs|ddlx|srvdsrv|srvd|tabl|astabldt)$/i;
const BDEF_EXT = /\.(asbdef|bdef)$/i;
const ABAP_EXT = /\.abap$/i;

export function listSources(dir) {
  const out = [];
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'webapp') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

class Diagnostics {
  constructor() { this.errors = []; this.warnings = []; }
  error(file, line, message) { this.errors.push({ file, line, message }); }
  warn(file, line, message) { this.warnings.push({ file, line, message }); }
}

export function activate(dir, opts = {}) {
  const diag = new Diagnostics();
  const rel = f => path.relative(dir, f);
  const model = new Model();
  const rt = new AbapRuntime();
  rt.model = model;
  rt.appDir = dir;   // datasets (OPEN DATASET) live in <app>/.rap/files

  // ---------------------------------------------------------------- parse
  const bdefs = [];
  const abapFiles = [];
  const fugrFiles = new Map();   // function group -> its .abap files
  const sources = listSources(dir);
  // domains, data elements and table types (DDIC XML): the app's own, and the other apps' for their types
  const sysDir = systemDirOf(dir, opts);
  model.ddicLocal = readDdic(sources);
  model.ddic = readDdic([...sources, ...systemDdicFiles(sysDir, dir)]);
  // CDS definitions are added after all are read: structures first (tables and structures include them)
  const cdsDefs = [], enqus = [];
  for (const file of sources) {
    const name = path.basename(file);
    try {
      if (CDS_EXT.test(name)) {
        for (const def of parseCds(fs.readFileSync(file, 'utf8'), rel(file))) { def.file = rel(file); cdsDefs.push(def); }
      } else if (BDEF_EXT.test(name)) {
        const text = fs.readFileSync(file, 'utf8');
        const b = parseBdef(text, rel(file));
        b.file = rel(file);
        bdefs.push(b);
        // parsed but not run: say so instead of silently doing nothing
        const lineAt = i => text.slice(0, i).split('\n').length;
        for (const m of text.matchAll(/^\s*(?:static\s+)?function\s+(\w+)/gim)) diag.warn(rel(file), lineAt(m.index), `Function ${m[1]} is not supported by the runtime: use an action with a result`);
        for (const m of text.matchAll(/\(\s*precheck\s*\)|\bprecheck\b/gi)) { diag.warn(rel(file), lineAt(m.index), 'precheck is not run by the runtime: check the data in a validation'); break; }
      } else if (ABAP_EXT.test(name)) {
        // reports and module pools run on the classic engine (src/classic); function groups run on both
        if (/\.prog\./i.test(name)) continue;
        if (/\.fugr\./i.test(name)) { const g = name.split('.')[0].toLowerCase(); (fugrFiles.get(g) || fugrFiles.set(g, []).get(g)).push(file); continue; }
        abapFiles.push(file);
      } else if (/\.tabl\.xml$/i.test(name)) {
        const def = parseTablXml(fs.readFileSync(file, 'utf8'), rel(file));
        if (def) { def.file = rel(file); cdsDefs.push(def); }
      } else if (/\.enqu\.xml$/i.test(name)) {
        enqus.push([rel(file), fs.readFileSync(file, 'utf8')]);
      } else if (/\.(dcls\.asdcls|asdcls|dcls)$/i.test(name)) {
        for (const role of parseDcl(fs.readFileSync(file, 'utf8'), rel(file))) model.roles.push({ ...role, file: rel(file) });
      } else if (/\.xslt\.source\.xml$/i.test(name)) {
        (rt.transformations ||= {})[name.split('.')[0].toLowerCase()] = fs.readFileSync(file, 'utf8');
      } else if (/\.msag\.json$/i.test(name)) {
        rt.messages[name.split('.')[0].toLowerCase()] = JSON.parse(fs.readFileSync(file, 'utf8'));
      }
    } catch (e) {
      diag.error(e.file || rel(file), e.line, e.bare || e.message);
    }
  }

  model.ddicDefs = new Map(cdsDefs.filter(d => d.kind === 'table' || d.kind === 'structure').map(d => [d.name, d]));
  for (const def of cdsDefs) if (def.kind === 'structure') { try { model.addDef(def, diag); } catch (e) { diag.error(def.file, e.line, e.message); } }
  for (const def of cdsDefs) if (def.kind !== 'structure') { try { model.addDef(def, diag); } catch (e) { diag.error(def.file, e.line, e.message); } }

  // ---------------------------------------------------------------- objects of other apps in the system
  // other apps' and the SAP standard layer's tables and views, used by name
  const catalog = systemCatalog(sysDir, dir, { standard: opts.standard !== false });
  model.loadExternals(catalog, abapFiles, diag);

  // ---------------------------------------------------------------- dictionary checks (domains, data elements,
  // table types, lock objects, references of tables and structures)
  const known = n => model.tables.has(n) || model.structures.has(n) || model.views.has(n) || model.abstracts.has(n) || catalog.has(n) || model.ddic.dataElements.has(n) || model.ddic.tableTypes.has(n) || model.ddic.domains.has(n);
  checkDdic(model.ddicLocal, { known, err: (f, l, m) => diag.error(rel(f), l, m), warn: (f, l, m) => diag.warn(rel(f), l, m) });
  for (const [f, xml] of enqus) checkEnqu(f, xml, { known, err: (ff, l, m) => diag.error(ff, l, m) });
  model.lockObjects = lockObjects(enqus);
  for (const def of cdsDefs) if ((def.kind === 'table' || def.kind === 'structure') && !def.external) model.checkFields(def, known, diag);

  // ---------------------------------------------------------------- entities
  model.resolveEntities(diag);
  for (const b of bdefs) model.addBdef(b, diag);
  for (const x of model.extensions || []) model.extendBdef(x, diag);
  model.resolveBos(diag);
  model.checkRoles(diag);

  // AMDP table function implementations: METHOD m BY DATABASE FUNCTION ... SQLScript ... ENDMETHOD
  model.amdp = new Map();
  for (const file of abapFiles) {
    const src = fs.readFileSync(file, 'utf8');
    const cls = /CLASS\s+(\w+)\s+IMPLEMENTATION/i.exec(src)?.[1]?.toLowerCase();
    for (const m of src.matchAll(/METHOD\s+(\w+)\s+BY\s+DATABASE\s+FUNCTION\b[^.]*\.([\s\S]*?)\bENDMETHOD\s*\./gi)) {
      model.amdp.set(`${cls}=>${m[1].toLowerCase()}`, { body: m[2], file: rel(file) });
    }
  }

  // ---------------------------------------------------------------- ABAP
  // one compilation unit per class: main include + local definitions + local implementations
  const units = new Map();
  for (const file of abapFiles) {
    const pool = path.basename(file).split('.')[0].toLowerCase();
    const order = /locals_def/i.test(file) ? 1 : /locals_imp/i.test(file) ? 2 : /testclasses/i.test(file) ? 3 : 0;
    const u = units.get(pool) || [];
    u.push({ file, order });
    units.set(pool, u);
  }
  // the static types of the dictionary for the compiler: data elements / domains (CURR 15,2 is a p with 2 decimals),
  // tables, structures and CDS entities with their components
  setDdicTypes(name => ddicSpec(model, name));
  // global interfaces first: classes implementing them need their method signatures
  for (const file of abapFiles) if (/\.intf\.abap$/i.test(file)) registerInterfaces(fs.readFileSync(file, 'utf8'), rel(file));
  // local classes and interfaces belong to their class pool: a name two pools use (lhc_item in the behavior pools of
  // two BOs) gets a runtime name scoped by the pool, so neither replaces the other
  const localNames = new Map(), seenIn = new Map();
  for (const [pool, files] of units) {
    const names = new Set();
    for (const f of files) {
      const text = fs.readFileSync(f.file, 'utf8').replace(/^\*.*$/gm, '').replace(/".*$/gm, '');
      for (const m of text.matchAll(/^\s*(?:CLASS|INTERFACE)\s+([\w$]+)\b([^.]*)\./gim)) {
        const n = m[1].toLowerCase();
        if (n === pool || /\bPUBLIC\b/i.test(m[2]) || /^\s*(IMPLEMENTATION|LOAD)\b/i.test(m[2])) continue;
        names.add(n);
      }
    }
    localNames.set(pool, names);
    for (const n of names) seenIn.set(n, (seenIn.get(n) || 0) + 1);
  }
  const renameOf = pool => new Map([...(localNames.get(pool) || [])].filter(n => seenIn.get(n) > 1).map(n => [n, `${pool}__${n}`]));
  for (const [pool, files] of units) {
    files.sort((a, b) => a.order - b.order);
    const file = files[0].file;
    try {
      const res = compileAbap(files.map(f => ({ src: fs.readFileSync(f.file, 'utf8'), file: rel(f.file) })), rel(file), { rename: renameOf(pool) });
      for (const i of res.interfaces) new Function('$rt', i.js)(rt);
      for (const c of res.classes) {
        c.pool = pool;
        if (c.name.startsWith(`${pool}__`)) c.localName = c.name.slice(pool.length + 2);   // its name in the source
        try { new Function('$rt', c.js)(rt); }
        catch (e) { diag.error(rel(file), c.line, `Generated code for ${c.name} is invalid: ${e.message}`); continue; }
        model.classes.set(c.name, c);
      }
    } catch (e) {
      diag.error(e.file || rel(file), e.line, e.bare || e.message);
    }
  }
  // function groups: a class per group, its function modules callable with CALL FUNCTION from any ABAP code
  rt.functions = new Map();
  for (const [group, files] of fugrFiles) {
    // code after ENDFUNCTION belongs to no function module (SAP: a syntax error of that include)
    let misplaced = false;
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      const end = /^\s*ENDFUNCTION\s*\.[^\n]*$/im.exec(text);
      if (!end || !/^\s*FUNCTION\s+[\w/]+\s*\./im.test(text)) continue;
      const after = text.slice(end.index + end[0].length).split('\n');
      const k = after.findIndex(l => l.trim() && !/^\s*\*/.test(l) && !/^\s*"/.test(l));
      if (k >= 0) { misplaced = true; diag.error(rel(f), text.slice(0, end.index + end[0].length).split('\n').length + k, 'Statements after ENDFUNCTION are outside the function module: move them before ENDFUNCTION'); }
    }
    if (misplaced) continue;
    const g = functionGroupUnits(group, files, rel);
    try {
      const res = compileAbap(g.units, g.units[0].file);
      for (const c of res.classes) { new Function('$rt', c.js)(rt); model.classes.set(c.name, c); }
      for (const fm of g.functions) rt.functions.set(fm.toUpperCase(), g.cls);
    } catch (e) {
      // the classic engine still runs the group (its own compiler): a warning here, not an activation error
      diag.warn(e.file || g.units[0].file, e.line, `Function group ${group.toUpperCase()} is not callable from classes yet: ${e.bare || e.message}`);
    }
  }
  setDdicTypes(null);
  model.bindHandlers(diag);

  // ---------------------------------------------------------------- database
  // database: sqlite (default), pglite (embedded PostgreSQL) or postgres://... (one schema per app)
  const url = opts.dbUrl ?? (opts.dbFile ? (opts.dbFile === ':memory:' ? 'sqlite:memory' : `sqlite:${opts.dbFile}`) : undefined);
  const db = opts.db || openDatabase({ url, dir, schema: `app_${path.basename(dir)}` });
  model.createSchema(db, diag);
  seedData(dir, db, model, diag);

  return { dir, model, rt, db, diagnostics: diag };
}

function seedData(dir, db, model, diag) {
  const dataDir = path.join(dir, 'data');
  if (!fs.existsSync(dataDir)) return;
  for (const f of fs.readdirSync(dataDir)) {
    if (!f.endsWith('.json')) continue;
    const tname = f.replace(/\.json$/, '').toLowerCase().replace(/#/g, '/');   // abapGit file names: #scwm#lagp = /scwm/lagp
    const t = model.tables.get(tname);
    if (!t) { diag.warn(`data/${f}`, null, `No table ${tname} for seed data`); continue; }
    if (t.external) { diag.warn(`data/${f}`, null, `Table ${t.label} belongs to app ${t.external.app}; its data is maintained there`); continue; }
    const count = db.prepare(`SELECT COUNT(*) AS n FROM "${tname}"`).get().n;
    if (count > 0) continue;
    try {
      const rows = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
      const cols = t.columns;
      const stmt = db.prepare(`INSERT INTO "${tname}" (${cols.map(c => `"${c.name}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
      db.exec('BEGIN');
      for (const r of rows) {
        const lr = Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v]));
        stmt.run(...cols.map(c => toDb(lr[c.name], c.ti)));
      }
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch {}
      diag.error(`data/${f}`, null, `Seed data could not be loaded: ${e.message}`);
    }
  }
}

// =====================================================================================================
export class Model {
  constructor() {
    this.tables = new Map();      // name -> { name, fields, columns, keys }
    this.views = new Map();       // name -> parsed view def
    this.abstracts = new Map();
    this.ddlx = [];
    this.services = new Map();
    this.entities = new Map();    // name -> resolved entity (views, abstract, tables)
    this.bos = new Map();         // root entity -> BO
    this.entityBo = new Map();    // entity -> BO (base and projection)
    this.classes = new Map();
    this.roles = [];              // CDS access controls (DCL)
    this.structures = new Map();  // DDIC structures (define structure): types for ABAP, no database table
  }
  // references of the components of a table or structure: Z data elements, include structures, the currency /
  // unit field of an amount / quantity, check tables
  checkFields(def, known, diag) {
    const own = new Set(this.componentsOf(def, { error() {}, warn() {} }).map(f => f.name));
    const what = def.kind === 'structure' ? 'Structure' : 'Table';
    for (const f of def.fields) {
      if (f.include) continue;
      const n = String(f.type?.name || '');
      if (/^[zy]/i.test(n) && !known(n)) diag.error(def.file, f.line ?? null, `${what} ${def.label}: the type ${n.toUpperCase()} of ${f.label} does not exist (no data element, structure or table type of that name)`);
      for (const [k, txt] of [['amount', 'currency key'], ['quantity', 'unit']]) {
        const ref = f.ann?.semantics?.[k]?.[k === 'amount' ? 'currencycode' : 'unitofmeasure'];
        if (!ref) continue;
        const [tab, fld] = String(ref).includes('.') ? String(ref).toLowerCase().split('.') : [def.name, String(ref).toLowerCase()];
        const fields = tab === def.name ? own : new Set((this.tables.get(tab)?.fields || this.structures.get(tab)?.fields || []).map(x => x.name));
        if (!fields.has(fld)) diag.error(def.file, f.line ?? null, `${what} ${def.label}: the ${txt} field ${String(ref)} of ${f.label} does not exist`);
      }
      if (f.checkTable && /^[zy]/i.test(f.checkTable) && !known(f.checkTable)) diag.error(def.file, f.line ?? null, `${what} ${def.label}: check table ${f.checkTable.toUpperCase()} of ${f.label} does not exist`);
      // the foreign key's where clause: fields of the check table = fields of this table
      const ct = f.checkTable && (this.tables.get(f.checkTable) || this.ddicDefs?.get(f.checkTable));
      if (ct && f.fkPairs) {
        const ctFields = new Set((ct.fields || []).map(x => x.name));
        for (const fl of (this.ddicDefs?.get(f.checkTable)?.fields || [])) if (fl.name) ctFields.add(fl.name);
        for (const [ck, ownF] of f.fkPairs) {
          if (!ctFields.has(ck)) diag.error(def.file, f.line ?? null, `${what} ${def.label}: the foreign key of ${f.label} compares ${ck}, which is not a field of the check table ${f.checkTable.toUpperCase()}`);
          if (!/^'/.test(ownF) && !own.has(ownF) && !(this.tables.get(def.name)?.fields || []).some(x => x.name === ownF) && !def.fields.some(x => x.name === ownF)) diag.error(def.file, f.line ?? null, `${what} ${def.label}: the foreign key of ${f.label} uses ${ownF}, which is not a field of ${def.label}`);
        }
      }
    }
  }

  // ---------------------------------------------------------------- access control (DCL)
  checkRoles(diag) {
    this.grants = new Map();
    for (const r of this.roles) for (const g of r.grants) {
      const ent = this.entities.get(g.entity);
      if (!ent) { diag.error(r.file, g.line, `Access control ${r.name}: entity ${g.entity} not found`); continue; }
      const els = [];
      const walk = x => { if (!x) return; if (x.el) els.push(x.el); if (x.els) els.push(...x.els); walk(x.l); walk(x.r); walk(x.e); if (x.k === 'inherit' && !this.entities.has(x.entity)) diag.error(r.file, g.line, `Access control ${r.name}: inherited entity ${x.entity} not found`); };
      walk(g.where);
      const bad = els.filter(e => !ent.fields.some(f => f.name === e));
      if (bad.length) { diag.error(r.file, g.line, `Access control ${r.name}: ${bad.join(', ')} not element(s) of ${ent.label}${bad.some(b => b.includes('.')) ? ' (paths along associations are not supported)' : ''}`); continue; }
      (this.grants.get(g.entity) || this.grants.set(g.entity, []).get(g.entity)).push({ ...g, role: r.name });
    }
    for (const ent of this.entities.values()) {
      const chk = String(ent.ann?.accesscontrol?.authorizationcheck || '').toUpperCase();
      if (chk === '#MANDATORY' && !this.grants.has(ent.name)) diag.warn(ent.file, null, `${ent.label} requires an access control (#MANDATORY) but has none: nobody can read it`);
    }
  }
  // SQL condition restricting the rows of an entity for a user (null: no restriction)
  accessSql(entName, auths, user, alias = '') {
    const ent = this.entities.get(entName);
    if (!ent || !this.grants) return null;
    const grants = this.grants.get(entName) || [];
    if (!grants.length) return String(ent.ann?.accesscontrol?.authorizationcheck || '').toUpperCase() === '#MANDATORY' ? '1=0' : null;
    const col = el => {
      let f = ent.fields.find(x => x.name === el)?.name;
      if (!f) f = ent.fields.find(x => this.baseField(entName, x.name) === el)?.name;   // inherited from the base entity
      return `${alias}"${f || el}"`;
    };
    return grantsSql(grants, { auths, user, col, inherited: e => this.grants.get(e) || [] });
  }

  // the type of a table / structure component: a Z data element becomes its built-in type (DDIC XML of the app or
  // the system); a component typed with a structure or a table type keeps that (the initial value of ABAP data)
  typeOf(type) {
    const n = String(type?.name || '');
    if (!n.startsWith('abap.') && this.ddic) {
      const b = builtinOf(n, this.ddic);
      if (b) return { ...resolveType(b), de: n };
      if (this.ddic.tableTypes.has(n)) return { t: 'string', tableType: n };
    }
    const def = this.ddicDefs?.get(n);
    if (def?.kind === 'structure') return { t: 'string', struct: n };
    return resolveType(type);
  }
  componentsOf(def, diag) {
    const lookup = n => this.ddicDefs?.get(n) || (this.structures.get(n)?.def) || null;
    return expandIncludes(def, lookup, (f, msg) => {
      if (/^[zy]/i.test(f.include)) diag.error(def.file, f.line ?? null, `${def.kind === 'structure' ? 'Structure' : 'Table'} ${def.label}: ${msg}`);
      else diag.warn(def.file, f.line ?? null, `INCLUDE ${f.include} in ${def.label} is not known here and is left out`);
    });
  }
  addDef(def, diag) {
    switch (def.kind) {
      case 'structure': {
        const fields = this.componentsOf(def, diag).map(f => { const ti = this.typeOf(f.type); return { name: f.name, label: f.label, ti, numeric: isNumeric(ti), ann: f.ann, ...(ti.struct ? { struct: ti.struct } : {}), ...(ti.tableType ? { tableType: ti.tableType } : {}) }; });
        this.structures.set(def.name, { name: def.name, label: def.label, fields, file: def.file, ann: def.ann, def });
        break;
      }
      case 'table': {
        const fields = [];
        for (const f of this.componentsOf(def, diag)) {
          const ti = this.typeOf(f.type);
          if (ti.t === 'clnt') continue; // single-client runtime: client columns are dropped
          fields.push({ name: f.name, label: f.label, key: f.key, ti, numeric: isNumeric(ti), ann: f.ann });
        }
        this.tables.set(def.name, { name: def.name, label: def.label, fields, columns: fields, keys: fields.filter(f => f.key).map(f => f.name), file: def.file, ann: def.ann });
        break;
      }
      case 'view': this.views.set(def.name, def); break;
      case 'abstract': case 'custom': this.abstracts.set(def.name, def); break;
      case 'tablefunction': (this.tableFunctions ||= new Map()).set(def.name, def); break;
      case 'ddlx': this.ddlx.push(def); break;
      case 'service': this.services.set(def.name, def); break;
    }
  }

  // Names this app uses but does not define are taken from the other apps of the system (read-only):
  // tables, and CDS views with everything they are built on. Their data stays in the owner's database.
  loadExternals(catalog, abapFiles, diag) {
    if (!catalog.size) return;
    const local = n => this.tables.has(n) || this.views.has(n) || this.abstracts.has(n) || !!this.tableFunctions?.has(n);
    for (const t of this.tables.values()) {
      const other = catalog.get(t.name);
      if (other && other.def.kind === 'table') diag.warn(t.file, null, `Table ${t.label} also exists in app ${other.app}. Reuse it instead of keeping a second copy of the data.`);
    }
    const queue = [];
    for (const v of this.views.values()) queue.push(...referencesOf(v));
    for (const s of this.services.values()) queue.push(...referencesOf(s));
    for (const x of this.ddlx) queue.push(...referencesOf(x));
    for (const f of abapFiles) {
      try { for (const m of fs.readFileSync(f, 'utf8').matchAll(/\b[a-z_][\w]*/gi)) { const n = m[0].toLowerCase(); if (catalog.has(n)) queue.push(n); } } catch {}
    }
    this.externals = new Map();
    while (queue.length) {
      const n = queue.shift();
      if (local(n) || this.externals.has(n)) continue;
      const x = catalog.get(n);
      if (!x) continue;
      const info = { app: x.app, appDir: x.appDir };
      this.externals.set(n, info);
      const def = { ...structuredClone(x.def), file: x.rel, external: info };
      this.addDef(def, diag);
      if (def.kind === 'table') this.tables.get(def.name).external = info;
      queue.push(...referencesOf(def));
    }
  }

  // ---------------------------------------------------------------- views -> entities
  resolveEntities(diag) {
    for (const t of this.tables.values()) {
      this.entities.set(t.name, { name: t.name, label: t.label, kind: 'table', fields: t.fields.map(f => ({ ...f, column: f.name })), keys: t.keys, assocs: new Map(), ann: t.ann || {} });
    }
    for (const a of this.abstracts.values()) {
      const fields = a.fields.map(f => { const ti = resolveType(f.type); return { name: f.name, label: f.label, key: f.key, ti, numeric: isNumeric(ti), ann: f.ann }; });
      const ent = { name: a.name, label: a.label, kind: a.kind === 'custom' ? 'custom' : 'abstract', fields, keys: fields.filter(f => f.key).map(f => f.name), assocs: new Map(), ann: a.ann || {}, file: a.file, def: a, root: a.root };
      // custom entity: data comes from an ABAP class implementing if_rap_query_provider
      if (ent.kind === 'custom') {
        const impl = String(a.ann?.objectmodel?.query?.implementedby || '').replace(/^ABAP:/i, '').toLowerCase();
        if (!impl) diag.error(a.file, a.line, `Custom entity ${a.label} needs @ObjectModel.query.implementedBy: 'ABAP:<class>'`);
        ent.queryClass = impl || null;
      }
      this.entities.set(a.name, ent);
    }
    for (const tf of this.tableFunctions?.values() || []) {
      const fields = tf.fields.map(f => { const ti = resolveType(f.type); return { name: f.name, label: f.label, key: f.key, ti, numeric: isNumeric(ti), ann: f.ann }; }).filter(f => f.ti.t !== 'clnt');
      const [cls, method] = String(tf.implementedBy || '').toLowerCase().split('=>');
      this.entities.set(tf.name, { name: tf.name, label: tf.label, kind: 'tablefunction', fields, keys: fields.filter(f => f.key).map(f => f.name), assocs: new Map(), ann: tf.ann || {}, file: tf.file, def: tf, params: paramsOf(tf.params), impl: { cls, method } });
    }
    const resolving = new Set();
    const resolve = name => {
      if (this.entities.has(name)) return this.entities.get(name);
      const v = this.views.get(name);
      if (!v) return null;
      if (resolving.has(name)) throw new Error(`Cyclic view definition involving ${name}`);
      resolving.add(name);
      try { this.entities.set(name, this.resolveView(v, resolve)); }
      finally { resolving.delete(name); }
      return this.entities.get(name);
    };
    for (const v of this.views.values()) {
      try { resolve(v.name); }
      catch (e) { diag.error(v.file, e.line ?? v.line, e.message); this.entities.delete(v.name); }
    }
    // associations: second pass, targets now known
    // base views before projections (projections inherit associations from their source)
    const depth = (v) => { let d = 0, e = this.entities.get(v.name); while (e?.projection) { d++; e = this.entities.get(e.source); } return d; };
    for (const v of [...this.views.values()].sort((a, b) => depth(a) - depth(b))) {
      const ent = this.entities.get(v.name);
      if (!ent) continue;
      try { this.resolveAssocs(ent, v, diag); } catch (e) { diag.error(v.file, v.line, e.message); }
    }
    // composition children: derive on-condition from the child's "association to parent"
    for (const ent of this.entities.values()) {
      for (const a of ent.assocs.values()) {
        if (a.composition && !a.pairs.length) {
          const child = this.entities.get(a.target);
          const up = child && [...child.assocs.values()].find(x => x.toParent && x.target === ent.name);
          if (up) a.pairs = up.pairs.map(([c, p]) => [p, c]);
          else diag.error(ent.file, null, `Composition ${a.label} of ${ent.label}: child ${a.target} has no 'association to parent ${ent.label}'`);
        }
        if (a.toParent && !a.pairs.length) diag.error(ent.file, null, `Association to parent ${a.label} needs an ON condition`);
      }
    }
    // metadata extensions
    for (const x of this.ddlx) {
      const ent = this.entities.get(x.target);
      if (!ent) { diag.error(x.file, null, `Metadata extension for unknown entity ${x.target}`); continue; }
      mergeDeep(ent.ann, x.ann);
      for (const [el, ann] of Object.entries(x.elements)) {
        const f = ent.fields.find(f => f.name === el);
        if (f) { f.ann = mergeDeep(f.ann || {}, ann); continue; }
        const a = ent.assocs.get(el);
        if (a) { a.ann = mergeDeep(a.ann || {}, ann); continue; }
        diag.warn(x.file, null, `Metadata extension annotates unknown element ${el} of ${x.target}`);
      }
    }
    for (const s of this.services.values()) {
      for (const e of s.exposes) if (!this.entities.has(e.entity)) diag.error(s.file, null, `Service ${s.label} exposes unknown entity ${e.entity}`);
    }
  }

  resolveView(v, resolve) {
    const ent = { name: v.name, label: v.label, kind: 'view', root: v.root, projection: !!v.projection, contract: v.contract, def: v, file: v.file, ann: v.ann || {}, fields: [], assocs: new Map(), params: paramsOf(v.params) };
    const src = resolve(v.from.name);
    if (!src) throw Object.assign(new Error(`${v.label}: data source ${v.from.label} not found`), { line: v.line });
    ent.source = src.name;
    ent.sourceAliases = { [v.from.alias || v.from.name]: src.name, [v.from.name]: src.name };
    for (const j of v.joins) {
      const js = resolve(j.name);
      if (!js) throw Object.assign(new Error(`${v.label}: join source ${j.label} not found`), { line: v.line });
      ent.sourceAliases[j.alias || j.name] = js.name;
    }
    const typeOfPath = (p) => {
      const parts = p.map(x => x.toLowerCase());
      let e = src, col = parts[0];
      if (parts.length === 2 && ent.sourceAliases[parts[0]]) { e = this.entities.get(ent.sourceAliases[parts[0]]); col = parts[1]; }
      else if (parts.length >= 2) {
        // association path: _Assoc.Field -> use source assocs (projection) or own assoc defs
        const a = src.assocs?.get(parts[0]) || null;
        const ad = v.assocs.find(x => x.name === parts[0]);
        const tgt = a ? this.entities.get(a.target) : ad ? resolve(ad.target) : null;
        if (tgt) { const f = tgt.fields.find(f => f.name === parts[parts.length - 1]); if (f) return { ti: f.ti, assocPath: true }; }
        return { ti: { t: 'c', len: 255 }, assocPath: true };
      }
      const f = e?.fields.find(f => f.name === col);
      if (!f) {
        for (const alias of Object.keys(ent.sourceAliases)) {
          const f2 = this.entities.get(ent.sourceAliases[alias])?.fields.find(f => f.name === col);
          if (f2) return { ti: f2.ti, srcField: f2, from: ent.sourceAliases[alias] };
        }
        return null;
      }
      return { ti: f.ti, srcField: f, from: e.name };
    };
    const inferType = (x) => {
      switch (x.k) {
        case 'lit': return typeof x.v === 'number' ? (Number.isInteger(x.v) ? { t: 'i' } : { t: 'p', len: 16, dec: 2 }) : { t: 'c', len: Math.max(1, String(x.v).length) };
        case 'path': {
          if (x.path[0] === '$session') return { t: x.path[1]?.toLowerCase() === 'system_date' ? 'd' : 'c', len: 12 };
          if (x.path[0].toLowerCase() === '$node') {
            const k = String(x.path[1]).toLowerCase();
            if (k === 'node_id' || k === 'parent_id') { const kf = src.fields.find(f => f.name === src.keys?.[0]); return kf?.ti || { t: 'c', len: 40 }; }
            return { t: 'i' };
          }
          if (x.path[0].toLowerCase() === '$parameters') { const p = ent.params?.find(q => q.name === String(x.path[1]).toLowerCase()); if (!p) throw new Error(`${v.label}: unknown parameter ${x.path[1]}`); return p.ti; }
          return typeOfPath(x.path)?.ti || { t: 'c', len: 255 };
        }
        case 'cast': return resolveType(x.type);
        case 'case': return inferType(x.whens[0]?.[1] || x.else || { k: 'lit', v: '' });
        case 'bin': return ['+', '-', '*', '/'].includes(x.op) ? (inferType(x.l).t === 'i' && inferType(x.r).t === 'i' && x.op !== '/' ? { t: 'i' } : { t: 'p', len: 31, dec: 2 }) : { t: 'bool' };
        case 'neg': return inferType(x.e);
        case 'fn': {
          if (['concat', 'concat_with_space', 'substring', 'upper', 'lower', 'left', 'right', 'replace', 'lpad', 'rpad', 'ltrim', 'rtrim'].includes(x.name)) return { t: 'string' };
          if (['length', 'instr', 'count', 'dats_days_between'].includes(x.name)) return { t: 'i' };
          if (['sum', 'avg', 'max', 'min', 'abs', 'round', 'ceil', 'floor', 'division', 'coalesce', 'currency_conversion', 'unit_conversion'].includes(x.name)) return x.args[0] ? inferType(x.args[0]) : { t: 'p', len: 31, dec: 2 };
          if (x.name === 'div' || x.name === 'mod') return { t: 'i' };
          if (x.name === 'dats_add_days' || x.name === 'dats_add_months') return { t: 'd' };
          if (x.name === 'tstmp_current_utctimestamp') return { t: 'ts' };
          return { t: 'c', len: 255 };
        }
        default: return { t: 'c', len: 255 };
      }
    };
    for (const el of v.elements) {
      if (el.assocRef) {
        // exposed association; projection may redirect it
        ent.fields.push({ name: el.name, label: el.label, isAssoc: true, assocRef: el.assocRef, redirect: el.redirect, ann: el.ann });
        continue;
      }
      if (el.virtual) {
        const ti = resolveType(el.type);
        ent.fields.push({ name: el.name, label: el.label, key: el.key, ti, numeric: isNumeric(ti), ann: el.ann, virtual: true });
        continue;
      }
      const ti = inferType(el.expr);
      const f = { name: el.name, label: el.label, key: el.key, ti, numeric: isNumeric(ti), ann: el.ann, expr: el.expr };
      if (el.expr.k === 'path') {
        const info = typeOfPath(el.expr.path);
        if (info?.srcField && !info.assocPath) { f.basePath = info.srcField.name; f.baseEntity = info.from; f.ann = mergeDeep(mergeDeep({}, info.srcField.ann || {}), el.ann || {}); }
      }
      ent.fields.push(f);
    }
    const realFields = ent.fields.filter(f => !f.isAssoc);
    ent.keys = realFields.filter(f => f.key).map(f => f.name);
    ent.fields = ent.fields.filter(f => !f.isAssoc);
    ent.exposedAssocs = v.elements.filter(e => e.assocRef).map(e => ({ name: e.name, label: e.label, assocRef: e.assocRef, redirect: e.redirect, ann: e.ann }));
    return ent;
  }

  resolveAssocs(ent, v, diag) {
    // own association definitions
    for (const a of v.assocs) {
      const target = this.entities.get(a.target);
      if (!target) { diag.warn(v.file, v.line, `${v.label}: association target ${a.target} not found; association ${a.label} ignored`); continue; }
      ent.assocs.set(a.name, { name: a.name, label: a.label, target: a.target, card: a.card, composition: !!a.composition, toParent: !!a.toParent, pairs: a.on ? onPairs(a.on, a.name, ent) : [], filters: a.on ? onFilters(a.on, a.name) : [], on: a.on, exposed: false });
    }
    // projection: associations come from the base entity, possibly redirected
    if (ent.projection) {
      const base = this.entities.get(ent.source);
      for (const x of ent.exposedAssocs) {
        const ba = base.assocs.get(x.assocRef);
        if (!ba) { if (!ent.assocs.has(x.name)) diag.warn(v.file, v.line, `${v.label}: association ${x.label} not found in ${base.label}`); continue; }
        const target = x.redirect ? x.redirect.target : ba.target;
        if (!this.entities.has(target)) { diag.error(v.file, v.line, `${v.label}: redirected target ${target} not found`); continue; }
        ent.assocs.set(x.name, { ...ba, name: x.name, label: x.label, target, toParent: x.redirect ? x.redirect.kind === 'parent' : ba.toParent, composition: x.redirect ? x.redirect.kind === 'child' : ba.composition, baseAssoc: ba.name, pairs: ba.pairs, ann: x.ann });
      }
      // pairs of compositions are derived later from the base
    }
    for (const x of ent.exposedAssocs || []) {
      const a = ent.assocs.get(x.name);
      if (a) { a.exposed = true; a.ann = mergeDeep(a.ann || {}, x.ann || {}); }
    }
  }

  // ---------------------------------------------------------------- BDEF
  // behavior extension: merges into the extended BO (fields, determinations, validations, actions, events)
  extendBdef(b, diag) {
    for (const e of b.entities) {
      let bo = null, entity = null;
      for (const x of this.bos.values()) {
        if (x.projection) continue;
        const n = x.aliases.get(e.alias.toLowerCase()) || (x.entities.has(e.entity) ? e.entity : null);
        if (n) { bo = x; entity = n; break; }
      }
      if (!bo) { diag.error(b.file, e.line, `Behavior extension: ${e.alias} is not an entity of a behavior definition`); continue; }
      const beh = bo.entities.get(entity);
      for (const [f, props] of Object.entries(e.fields)) beh.fields[f] = { ...(beh.fields[f] || {}), ...props };
      beh.determinations.push(...e.determinations);
      beh.validations.push(...e.validations);
      Object.assign(beh.actions, e.actions);
      for (const [a, x] of Object.entries(e.assocs)) beh.assocs[a] = { ...(beh.assocs[a] || {}), ...x };
      if (e.events) beh.events = { ...(beh.events || {}), ...e.events };
      if (e.prepare?.validations?.length) beh.prepare = { validations: [...(beh.prepare?.validations || []), ...e.prepare.validations] };
      (bo.extensionClasses ||= new Set()).add(b.implClass || e.implClass);
    }
  }

  addBdef(b, diag) {
    if (b.type === 'extension') { (this.extensions ||= []).push(b); return; }
    if (b.type === 'unmanaged' && b.draft) diag.error(b.file, null, 'Draft is not supported for unmanaged business objects yet; use managed (optionally with unmanaged save)');
    for (const w of b.warnings) diag.warn(b.file, null, w);
    const root = b.entities.find(e => e.root) || b.entities[0];
    if (!root) { diag.error(b.file, null, 'Behavior definition without entities'); return; }
    const bo = { name: root.entity, bdef: b, type: b.type, projection: b.type === 'projection', entities: new Map(), aliases: new Map(), implClass: b.implClass, file: b.file, collaborative: !!b.collaborative };
    for (const e of b.entities) {
      const ent = this.entities.get(e.entity);
      if (!ent) { diag.error(b.file, e.line, `Behavior for unknown entity ${e.entity}`); continue; }
      e.aliasLower = e.alias.toLowerCase();
      bo.entities.set(e.entity, e);
      bo.aliases.set(e.aliasLower, e.entity);
      ent.behavior = e;
      ent.bo = bo;
      this.entityBo.set(e.entity, bo);
    }
    this.bos.set(bo.name, bo);
  }

  resolveBos(diag) {
    for (const bo of this.bos.values()) {
      if (bo.projection) {
        const rootEnt = this.entities.get(bo.name);
        bo.base = this.baseEntity(bo.name);
        if (!this.bos.has(bo.base)) diag.error(bo.file, null, `Projection BDEF ${bo.name}: base entity ${bo.base} has no behavior definition`);
        void rootEnt;
        continue;
      }
      for (const [name, beh] of bo.entities) {
        const ent = this.entities.get(name);
        // persistence mapping: element -> column
        // unmanaged save: the saver class writes; "mapping for <table>" still defines element <-> column names
        beh.unmanaged = !!(bo.bdef.unmanagedSave || beh.unmanagedSave);
        const tableName = beh.persistentTable || (beh.unmanaged ? beh.mappingTable : null);
        const table = tableName ? this.tables.get(tableName) : null;
        if (tableName && !table) diag.error(bo.file, beh.line, `Table ${tableName} not found`);
        if (bo.type === 'managed' && !beh.persistentTable && !beh.unmanaged) diag.error(bo.file, beh.line, `Managed entity ${beh.alias} needs 'persistent table' (or 'with unmanaged save')`);
        ent.table = table?.name;
        ent.mapping = {};
        if (table) {
          for (const f of ent.fields) {
            const explicit = beh.mapping[f.name];
            if (explicit) { ent.mapping[f.name] = explicit; continue; }
            if (f.basePath && f.baseEntity === table.name) ent.mapping[f.name] = f.basePath;
            else if (beh.mappingCorresponding && table.fields.some(c => c.name === f.name)) ent.mapping[f.name] = f.name;
          }
          for (const k of ent.keys) if (!ent.mapping[k]) diag.error(bo.file, beh.line, `Key ${k} of ${ent.label} is not mapped to a column of ${table.name}`);
        }
        if (bo.bdef.draft) {
          // draft-enabled: drafts live in the draft table (managed by the runtime, columns = element names + admin data)
          const dt = (beh.draftTable || `${ent.name}_d`).toLowerCase();
          if (!beh.draftTable) diag.warn(bo.file, beh.line, `Draft-enabled entity ${beh.alias} has no 'draft table'; using ${dt}`);
          ent.draft = { table: dt };
          // a user-defined draft table (with include sych_bdl_draft_admin_inc) is replaced by the managed one
          if (this.tables.has(dt)) { this.tables.delete(dt); this.entities.delete(dt); }
        }
        for (const f of Object.keys(beh.fields)) if (!ent.fields.some(x => x.name === f)) diag.warn(bo.file, beh.line, `Field ${f} in behavior of ${beh.alias} does not exist`);
        for (const d of [...beh.determinations, ...beh.validations]) for (const f of d.fields) if (!ent.fields.some(x => x.name === f)) diag.error(bo.file, beh.line, `${d.label}: trigger field ${f} does not exist in ${ent.label}`);
        for (const a of Object.values(beh.actions)) if (a.param && !this.entities.has(a.param)) diag.error(bo.file, beh.line, `Action ${a.label}: parameter entity ${a.param} not found`);
        for (const a of Object.keys(beh.assocs)) if (!ent.assocs.has(a)) diag.error(bo.file, beh.line, `Association ${a} not defined in ${ent.label}`);
      }
    }
  }

  // views that need a draft twin ("<name>$d"): draft-enabled entities and projections on them
  markDraftViews() {
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of this.entities.values()) {
        if (e.kind !== 'view' || e.hasDraftView) continue;
        if (e.draft || (e.projection && this.entities.get(e.source)?.hasDraftView)) { e.hasDraftView = true; changed = true; }
      }
    }
  }
  isDraftEntity(name) { const b = this.baseEntity(name); return !!this.entities.get(b)?.draft; }

  // follow projections down to the entity that carries transactional behavior
  baseEntity(name) {
    let e = this.entities.get(name);
    while (e && e.projection) e = this.entities.get(e.source);
    return e?.name;
  }
  // map a field of a projection entity to the base entity field
  baseField(entName, field) {
    let e = this.entities.get(entName);
    let f = field;
    while (e && e.projection) {
      const el = e.fields.find(x => x.name === f);
      if (!el) return null;
      f = el.expr?.k === 'path' && el.expr.path.length === 1 ? el.expr.path[0].toLowerCase() : null;
      if (!f) return null;
      e = this.entities.get(e.source);
    }
    return f;
  }
  projField(entName, baseFieldName) {
    const e = this.entities.get(entName);
    if (!e?.projection) return baseFieldName;
    for (const f of e.fields) if (this.baseField(entName, f.name) === baseFieldName) return f.name;
    return null;
  }

  bindHandlers(diag) {
    for (const bo of this.bos.values()) {
      if (bo.projection) continue;
      bo.handlers = [];
      bo.savers = [];
      const pools = new Set([bo.implClass, ...[...bo.entities.values()].map(e => e.implClass), ...(bo.extensionClasses || [])].filter(Boolean));
      for (const c of this.classes.values()) {
        const inPool = pools.size ? pools.has(c.pool) || pools.has(c.name) : true;
        if (!inPool) continue;
        if (c.superName === 'cl_abap_behavior_saver' || c.superName === 'cl_abap_behavior_saver_failed') { bo.savers.push(c.name); continue; }
        for (const m of c.methods.values()) {
          if (!m.rap || m.rap.kind === 'event') continue;
          const entity = bo.aliases.get(m.rap.entity);
          if (!entity) { diag.error(c.file, m.line, `Handler ${c.name}->${m.name}: entity alias ${m.rap.entity} not in behavior definition ${bo.name}`); continue; }
          bo.handlers.push({ ...m.rap, cls: c.name, method: m.name, alias: m.rap.entity, entity });
        }
      }
      // business event handlers: classes FOR EVENTS OF <bo> (and their local classes)
      bo.eventHandlers = [];
      for (const c of this.classes.values()) {
        const of = c.forEventsOf || this.classes.get(c.pool)?.forEventsOf;
        if (of !== bo.name) continue;
        for (const m of c.methods.values()) {
          if (m.rap?.kind !== 'event') continue;
          const entity = bo.aliases.get(m.rap.entity) || (bo.entities.has(m.rap.entity) ? m.rap.entity : null);
          if (!entity) { diag.error(c.file, m.line, `Event handler ${c.name}->${m.name}: ${m.rap.entity} is not an entity of ${bo.name}`); continue; }
          if (!bo.entities.get(entity).events?.[m.rap.target]) { diag.error(c.file, m.line, `Event handler ${c.name}->${m.name}: event ${m.rap.target} is not defined in the behavior of ${m.rap.entity}`); continue; }
          bo.eventHandlers.push({ cls: c.name, method: m.name, importing: m.rap.importing, entity, event: m.rap.target });
        }
      }
      // every behavior that needs code must have a handler
      for (const [name, beh] of bo.entities) {
        const has = (kind, target) => bo.handlers.some(h => h.entity === name && h.kind === kind && (!target || h.target === target));
        for (const d of beh.determinations) if (!has(d.when === 'save' ? 'determination_save' : 'determination_modify', d.name)) diag.error(bo.file, beh.line, `Determination ${d.label} of ${beh.alias} has no implementation`);
        for (const v of beh.validations) if (!has('validation', v.name)) diag.error(bo.file, beh.line, `Validation ${v.label} of ${beh.alias} has no implementation`);
        for (const a of Object.values(beh.actions)) if (!has('modify', a.name)) diag.error(bo.file, beh.line, `Action ${a.label} of ${beh.alias} has no implementation`);
        if (beh.earlyNumbering && !has('numbering')) diag.error(bo.file, beh.line, `Early numbering for ${beh.alias} has no implementation (FOR NUMBERING)`);
        const saverHas = (m) => bo.savers.some(sv => this.classes.get(sv)?.methods.has(m));
        if (beh.lateNumbering && !saverHas('adjust_numbers')) diag.error(bo.file, beh.line, `Late numbering for ${beh.alias} needs a saver class (INHERITING FROM cl_abap_behavior_saver) with METHODS adjust_numbers REDEFINITION`);
        if (bo.type === 'unmanaged') {
          for (const op of ['create', 'update', 'delete']) if (beh.ops[op] && !bo.handlers.some(h => h.entity === name && h.kind === 'modify' && h.op === op && !h.assoc)) diag.error(bo.file, beh.line, `Unmanaged ${beh.alias}: '${op}' needs a handler method FOR MODIFY IMPORTING ... FOR ${op.toUpperCase()} ${beh.alias}`);
          for (const a of Object.keys(beh.assocs)) if (beh.assocs[a].create && !bo.handlers.some(h => h.entity === name && h.op === 'create' && h.assoc === a)) diag.error(bo.file, beh.line, `Unmanaged ${beh.alias}: 'association ${a} { create; }' needs a handler FOR CREATE ${beh.alias}\\${a}`);
          if (!has('read')) diag.warn(bo.file, beh.line, `Unmanaged ${beh.alias} has no FOR READ handler; EML READ and actions read the database`);
          if (beh.root && !saverHas('save')) diag.error(bo.file, beh.line, `Unmanaged BO ${beh.alias} needs a saver class (INHERITING FROM cl_abap_behavior_saver) with METHODS save REDEFINITION`);
        }
        if ((bo.bdef.unmanagedSave || beh.unmanagedSave || bo.bdef.additionalSave || beh.additionalSave) && !saverHas('save_modified')) diag.error(bo.file, beh.line, `'with unmanaged/additional save' for ${beh.alias} needs a saver class with METHODS save_modified REDEFINITION`);
      }
    }
  }

  // ---------------------------------------------------------------- schema
  createSchema(db, diag) {
    this.dialect = db.dialect;
    const sqlType = ti => db.dialect.type(ti);
    for (const v of db.views()) db.dropView(v);
    const viewKw = this.linkExternalTables(db, diag);
    for (const t of this.tables.values()) {
      if (t.external) continue;
      if (!db.tableExists(t.name)) {
        const cols = t.columns.map(c => `"${c.name}" ${sqlType(c.ti)}`);
        const pk = t.keys.length ? `, PRIMARY KEY (${t.keys.map(k => `"${k}"`).join(', ')})` : '';
        db.exec(`CREATE TABLE "${t.name}" (${cols.join(', ')}${pk})`);
      } else {
        const have = new Set(db.tableColumns(t.name));
        for (const c of t.columns) if (!have.has(c.name)) db.exec(`ALTER TABLE "${t.name}" ADD COLUMN "${c.name}" ${sqlType(c.ti)}`);
      }
    }
    // managed draft tables
    for (const ent of this.entities.values()) {
      if (!ent.draft) continue;
      const cols = [...ent.fields.filter(f => !f.virtual).map(f => ({ name: f.name, type: sqlType(f.ti) })), ...DRAFT_ADMIN.map(c => ({ name: c.name, type: c.type === 'REAL' ? sqlType({ t: 'tsl' }) : 'TEXT' }))];
      const t = ent.draft.table;
      if (!db.tableExists(t)) {
        db.exec(`CREATE TABLE "${t}" (${cols.map(c => `"${c.name}" ${c.type}`).join(', ')}, PRIMARY KEY (${ent.keys.map(k => `"${k}"`).join(', ')}))`);
      } else {
        const have = new Set(db.tableColumns(t));
        for (const c of cols) if (!have.has(c.name)) db.exec(`ALTER TABLE "${t}" ADD COLUMN "${c.name}" ${c.type}`);
      }
    }
    this.markDraftViews();
    // create views in dependency order (PostgreSQL checks referenced views when a view is created)
    const pending = [];
    for (const ent of this.entities.values()) {
      if (ent.kind === 'tablefunction') {
        try {
          ent.sql = this.tableFunctionSql(ent, ent.params.length ? Object.fromEntries(ent.params.map(p => [p.name, this.paramDefault(p) ?? (p.numeric ? '0' : "''")])) : {});
          if (ent.params.length) ent.parameterized = true;
          else pending.push({ ent, name: ent.name, sql: ent.sql });
        } catch (e) { diag.error(ent.file, ent.def.line, `Table function ${ent.label}: ${e.message}`); ent.broken = true; }
        continue;
      }
      if (ent.kind !== 'view') continue;
      try {
        if (ent.params?.length) {
          // views with parameters are not database views: every use inlines their SQL with the bound values
          ent.parameterized = true;
          continue;
        }
        ent.sql = this.viewSql(ent);
        pending.push({ ent, name: ent.name, sql: ent.sql });
        if (ent.hasDraftView) pending.push({ ent, name: `${ent.name}$d`, sql: this.viewSql(ent, true) });
      } catch (e) { diag.error(ent.file, ent.def.line, `View ${ent.label}: ${e.message}`); ent.broken = true; }
    }
    let progress = true;
    const errors = new Map();
    while (pending.length && progress) {
      progress = false;
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i];
        try { db.exec(`CREATE ${viewKw} "${p.name}" AS ${p.sql}`); pending.splice(i--, 1); progress = true; errors.delete(p.name); }
        catch (e) { errors.set(p.name, e.message); }
      }
    }
    for (const p of pending) { diag.error(p.ent.file, p.ent.def.line, `View ${p.ent.label}: ${errors.get(p.name)}`); p.ent.broken = true; }
    for (const ent of this.entities.values()) {
      if (!ent.parameterized || ent.broken) continue;
      try { db.prepare(`SELECT * FROM (${this.entitySql(ent, Object.fromEntries(ent.params.map(p => [p.name, this.paramDefault(p) ?? (p.numeric ? '0' : "''")])))}) t LIMIT 0`).all(); }
      catch (e) { diag.error(ent.file, ent.def.line, `${ent.label}: ${e.message}`); ent.broken = true; }
    }
    for (const ent of this.entities.values()) {
      if (ent.kind !== 'view' || ent.broken || ent.parameterized) continue;
      try { db.prepare(`SELECT * FROM "${ent.name}" LIMIT 0`).all(); if (ent.hasDraftView) db.prepare(`SELECT * FROM "${ent.name}$d" LIMIT 0`).all(); }
      catch (e) { diag.error(ent.file, ent.def.line, `View ${ent.label} is not valid: ${e.message}`); ent.broken = true; }
    }
  }

  // Other apps' tables become read-only views on the owner's data:
  //   SQLite: the owner's database file is attached and read through TEMP views (so all views of this app are TEMP)
  //   PostgreSQL server: a view on the owner's schema (app_<owner>)
  // Returns the keyword for creating this app's views.
  linkExternalTables(db, diag) {
    const ext = [...this.tables.values()].filter(t => t.external);
    if (!ext.length) return 'VIEW';
    if (db.kind === 'sqlite') {
      const attached = new Map();
      for (const t of ext) {
        const file = path.join(t.external.appDir, '.rap', 'data.db');
        let alias = attached.get(file);
        if (!alias) {
          if (!fs.existsSync(file)) { diag.error(t.file, null, `Table ${t.label} belongs to app ${t.external.app}, which has no data yet. Open that app once.`); continue; }
          alias = `ext${attached.size + 1}`;
          try { db.exec(`ATTACH DATABASE '${file.replace(/'/g, "''")}' AS ${alias}`); attached.set(file, alias); }
          catch (e) { diag.error(t.file, null, `Cannot read the data of app ${t.external.app}: ${e.message}`); continue; }
        }
        try { db.exec(`CREATE TEMP VIEW "${t.name}" AS SELECT * FROM ${alias}."${t.name}"`); db.prepare(`SELECT * FROM "${t.name}" LIMIT 0`).all(); }
        catch (e) { diag.error(t.file, null, `Table ${t.label} of app ${t.external.app} is not in its database yet (${e.message}). Open that app once.`); }
      }
      return 'TEMP VIEW';
    }
    if (db.driver === 'pg') {
      for (const t of ext) {
        const schema = `app_${t.external.app}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        try { db.exec(`CREATE VIEW "${t.name}" AS SELECT * FROM "${schema}"."${t.name}"`); }
        catch (e) { diag.error(t.file, null, `Table ${t.label} of app ${t.external.app} is not in the database yet (${e.message}). Open that app once.`); }
      }
      return 'VIEW';
    }
    for (const t of ext) diag.error(t.file, null, `Table ${t.label} belongs to app ${t.external.app}. Using another app's tables needs SQLite or a PostgreSQL server; embedded PostgreSQL (pglite) keeps every app in a separate database.`);
    return 'VIEW';
  }

  // Table function: the SQLScript of its AMDP method as one SELECT (local table variables become CTEs).
  // Client handling is dropped (single-client runtime); :parameters become the bound values.
  tableFunctionSql(ent, params = {}) {
    const impl = this.amdp?.get(`${ent.impl.cls}=>${ent.impl.method}`);
    if (!impl) throw new Error(`implementation ${String(ent.impl.cls).toUpperCase()}=>${String(ent.impl.method).toUpperCase()} BY DATABASE FUNCTION not found`);
    const stmts = splitSqlScript(impl.body);
    const ctes = [];
    let ret = null;
    const vars = new Set();
    const fix = sql => sql
      .replace(/--[^\n]*/g, '')
      .replace(/"([A-Za-z0-9_/]+)"/g, (m, n) => `"${n.toLowerCase()}"`)
      .replace(/session_context\s*\(\s*'CLIENT'\s*\)/gi, "'100'")
      .replace(/(\b\w+\.)?"?\b(client|mandt)\b"?\s*=\s*((\b\w+\.)?"?\b(client|mandt)\b"?|:\w+|'\d*')/gi, '1=1')
      .replace(/(\b\w+\.)?"?\b(client|mandt)\b"?\s+as\s+("?\w+"?)/gi, "'100' AS $3")
      .replace(/(SELECT\s+(?:DISTINCT\s+)?|,\s*)(\b\w+\.)?"?\b(client|mandt)\b"?(?=\s*,)/gi, "$1'100' AS client")
      .replace(/:(\w+)/g, (m, n) => {
        const k = n.toLowerCase();
        if (vars.has(k)) return `"${k}"`;
        if (k in params) return params[k];
        throw new Error(`unknown variable or parameter :${n}`);
      });
    for (const st of stmts) {
      let m;
      if ((m = /^RETURN\s+([\s\S]+)$/i.exec(st))) { ret = m[1].trim(); continue; }
      if ((m = /^(\w+)\s*=\s*(SELECT[\s\S]+)$/i.exec(st))) { ctes.push([m[1].toLowerCase(), fix(m[2])]); vars.add(m[1].toLowerCase()); continue; }
      if (/^(DECLARE|USING)\b/i.test(st)) continue;
      throw new Error(`SQLScript statement not supported here: ${st.slice(0, 60)}`);
    }
    if (!ret) throw new Error('the AMDP method has no RETURN statement');
    const body = /^:(\w+)$/.test(ret) ? `SELECT * FROM "${ret.slice(1).toLowerCase()}"` : fix(ret);
    // keep only the declared result columns, in their order (the client column is dropped)
    const inner = `${ctes.length ? `WITH ${ctes.map(([n, q]) => `"${n}" AS (${q})`).join(', ')} ` : ''}${body}`;
    return `SELECT ${ent.fields.map(f => `tf."${f.name}"`).join(', ')} FROM (${inner}) tf`;
  }

  // SQL of an entity with parameter values (SQL literals by parameter name)
  entitySql(ent, params) {
    if (ent.kind === 'tablefunction') return this.tableFunctionSql(ent, params);
    return this.viewSql(ent, false, params);
  }
  paramDefault(p) {
    const sf = String(p.ann?.environment?.systemfield || '').toUpperCase();
    if (sf === '#SYSTEM_DATE' || sf === '#USER_DATE') return this.dialect.today();
    if (sf === '#SYSTEM_LANGUAGE') return `'E'`;
    if (sf === '#USER') return this.dialect.sessionUser();
    if (sf === '#CLIENT') return `'100'`;
    if (sf === '#SYSTEM_TIME') return `'000000'`;
    const dv = p.ann?.consumption?.defaultvalue;
    return dv !== undefined ? sqlLit(dv) : null;
  }
  // FROM source with parameter bindings: inline the source's SQL
  sourceSql(src, ctx, draft) {
    const e = this.entities.get(src.name);
    if (!e?.params?.length) return null;
    if (draft) throw new Error(`${e.label} has parameters and cannot be used in a draft-enabled view`);
    const vals = {};
    for (const p of e.params) {
      const b = (src.params || []).find(x => x.name === p.name);
      if (b) vals[p.name] = this.exprSql(b.expr, ctx);
      else if (this.paramDefault(p) !== null) vals[p.name] = this.paramDefault(p);
      else throw new Error(`Parameter ${p.label} of ${e.label} is not bound`);
    }
    return `(${this.entitySql(e, vals)})`;
  }

  // parent-child hierarchy: recursive query over the source following the child-to-parent association;
  // $node.hierarchy_level / _rank / _tree_size / _parent_rank, $node.node_id / parent_id
  hierarchySql(ent, params) {
    const v = ent.def, h = v.hierarchy;
    const src = this.entities.get(h.source);
    if (!src) throw new Error(`hierarchy source ${h.source} not found`);
    const a = src.assocs.get(h.assoc);
    if (!a?.pairs?.length) throw new Error(`${h.assoc} is not an association of ${src.label} with an ON condition`);
    const key = src.keys[0] || a.pairs[0][1];
    const lit = (x, alias) => this.exprSql(x, { ent: src, srcAliases: {}, assocAlias: () => { throw new Error('association paths are not supported here'); }, params }).replace(/\bt0\./g, `${alias}.`);
    const seg = alias => `${h.order.length ? h.order.map(o => `COALESCE(${this.dialect.castText(lit(o.e, alias))}, '')`).join(` || '~' || `) + ` || '~' || ` : ''}${this.dialect.castText(`${alias}."${key}"`)}`;
    const cols = src.fields.filter(f => !f.virtual).map(f => `"${f.name}"`);
    const startCond = h.start ? lit(h.start, 's') : a.pairs.map(([c]) => `(s."${c}" IS NULL OR s."${c}" = '')`).join(' AND ');
    const depth = h.depth || 50;
    const cte = `WITH RECURSIVE "$h" (${cols.join(', ')}, "$lvl", "$path", "$parent") AS (`
      + `SELECT ${cols.map(c => `s.${c}`).join(', ')}, 1, ${seg('s')}, NULL FROM "${src.name}" s WHERE ${startCond} `
      + `UNION ALL SELECT ${cols.map(c => `c.${c}`).join(', ')}, h."$lvl" + 1, h."$path" || '/' || ${seg('c')}, h."${key}" FROM "${src.name}" c JOIN "$h" h ON ${a.pairs.map(([cf, pf]) => `c."${cf}" = h."${pf}"`).join(' AND ')} WHERE h."$lvl" < ${depth})`;
    const ranked = `(SELECT x.*, ROW_NUMBER() OVER (ORDER BY x."$path") AS "$rank" FROM "$h" x)`;
    const node = k => {
      switch (k) {
        case 'hierarchy_level': return 't0."$lvl"';
        case 'hierarchy_rank': return 't0."$rank"';
        case 'node_id': return `t0."${key}"`;
        case 'parent_id': return 't0."$parent"';
        case 'hierarchy_tree_size': return `(SELECT COUNT(*) FROM "$h" d WHERE d."$path" = t0."$path" OR d."$path" LIKE t0."$path" || '/%')`;
        case 'hierarchy_parent_rank': return `COALESCE((SELECT p."$rank" FROM ${ranked} p WHERE t0."$path" LIKE p."$path" || '/%' AND p."$lvl" = t0."$lvl" - 1), 0)`;
        case 'hierarchy_is_orphan': case 'hierarchy_is_cycle': return '0';
        default: throw new Error(`$node.${k} is not supported`);
      }
    };
    const elems = ent.fields.map(f => {
      const e = f.expr;
      const p = e?.k === 'path' ? e.path.map(x => String(x).toLowerCase()) : null;
      const sql = p?.[0] === '$node' ? node(p[1]) : p && p.length === 1 ? `t0."${p[0]}"` : this.exprSql(e, { ent: src, srcAliases: {}, assocAlias: () => { throw new Error('association paths are not supported in hierarchies'); }, params });
      return `${sql} AS "${f.name}"`;
    });
    return `${cte} SELECT ${elems.join(', ')} FROM ${ranked} t0`;
  }

  viewSql(ent, draft = false, params = null) {
    const v = ent.def;
    if (v.hierarchy) return this.hierarchySql(ent, params);
    const joins = [];
    const aliasFor = {};
    const fromAlias = 't0';
    const srcAliases = { [v.from.alias || v.from.name]: fromAlias };
    if (v.from.alias) srcAliases[v.from.name] = fromAlias;
    v.joins.forEach((j, i) => { srcAliases[j.alias || j.name] = `t${i + 1}`; });
    const src = this.entities.get(ent.source);
    let assocJoinN = 0;
    const assocAlias = (name) => {
      if (aliasFor[name]) return aliasFor[name];
      // own association or (for projections) association of the source
      // own association (defined in this view) or an association exposed by the data source
      const own = !ent.projection && v.assocs.some(x => x.name === name);
      const a = own ? ent.assocs.get(name) : (src.assocs.get(name) || ent.assocs.get(name));
      if (!a) throw new Error(`Unknown association ${name}`);
      const alias = `a${++assocJoinN}`;
      aliasFor[name] = alias;
      let on;
      if (own && a.on) on = this.exprSql(a.on, { ent, srcAliases, assocAlias, viewAssoc: name, alias, own: true });
      else on = a.pairs.map(([s, t]) => `${fromAlias}."${s}" = ${alias}."${t}"`).join(' AND ') + (a.filters || []).map(f => ` AND ${alias}."${f[0]}" = ${sqlLit(f[1])}`).join('');
      joins.push(`LEFT OUTER JOIN "${a.target}" ${alias} ON ${on || '1=1'}`);
      return alias;
    };
    const ctx = { ent, srcAliases, assocAlias, params };
    const cols = ent.fields.filter(f => !f.virtual).map(f => `${this.exprSql(f.expr, ctx)} AS "${f.name}"`);
    for (const f of ent.fields.filter(f => f.virtual)) cols.push(`${f.numeric ? '0' : "''"} AS "${f.name}"`);
    let from = this.sourceSql(v.from, ctx, draft) || `"${v.from.name}"`;
    if (draft) {
      // draft twin: read the draft table instead of the persistent table (presented in the persistent table's
      // column layout so all element expressions stay valid), or the source's draft twin for projections
      if (ent.draft) {
        const table = this.tables.get(ent.table);
        const inv = Object.fromEntries(Object.entries(ent.mapping).map(([el, col]) => [col, el]));
        const sel = table.columns.map(c => (inv[c.name] ? `d."${inv[c.name]}" AS "${c.name}"` : `NULL AS "${c.name}"`));
        from = `(SELECT ${sel.join(', ')}, ${DRAFT_ADMIN.map(c => `d."${c.name}" AS "$${c.name}"`).join(', ')} FROM "${ent.draft.table}" d)`;
      } else from = `"${v.from.name}$d"`;
      cols.push(...DRAFT_ADMIN.map(c => `t0."$${c.name}" AS "$${c.name}"`));
    }
    let sql = `SELECT ${v.distinct ? 'DISTINCT ' : ''}${cols.join(', ')} FROM ${from} ${fromAlias}`;
    v.joins.forEach((j, i) => { sql += ` ${j.type} ${this.sourceSql(j, ctx, draft) || `"${j.name}"`} t${i + 1}${j.on ? ` ON ${this.exprSql(j.on, ctx)}` : ''}`; });
    const where = v.where ? ` WHERE ${this.exprSql(v.where, ctx)}` : '';
    const group = v.groupBy ? ` GROUP BY ${v.groupBy.map(g => this.exprSql(g, ctx)).join(', ')}` : '';
    const having = v.having ? ` HAVING ${this.exprSql(v.having, ctx)}` : '';
    // joins for association paths are collected while generating column SQL
    return sql + (joins.length ? ' ' + joins.join(' ') : '') + where + group + having;
  }

  exprSql(x, ctx) {
    const r = e => this.exprSql(e, ctx);
    switch (x.k) {
      case 'lit': return sqlLit(x.v);
      case 'path': {
        const p = x.path.map(s => s.toLowerCase());
        if (p[0] === '$session') {
          const k = p[1];
          if (k === 'user') return this.dialect.sessionUser();
          if (k === 'system_language') return `'E'`;
          if (k === 'client') return `'100'`;
          if (k === 'system_date' || k === 'user_date') return this.dialect.today();
          return `''`;
        }
        if (p[0] === '$projection') {
          const f = ctx.ent.fields.find(f => f.name === p[1]);
          if (!f) throw new Error(`$projection.${p[1]} is not an element`);
          return f.expr ? r(f.expr) : `''`;
        }
        if (p[0] === '$parameters') {
          const v = ctx.params?.[p[1]];
          if (v === undefined) throw new Error(`Parameter ${p[1]} has no value`);
          return v;
        }
        if (ctx.viewAssoc && p[0] === ctx.viewAssoc) return `${ctx.alias}."${p[1]}"`;
        if (p.length >= 2 && ctx.srcAliases[p[0]]) return `${ctx.srcAliases[p[0]]}."${p[1]}"`;
        if (p.length >= 2) {
          // association path expression: _Assoc.Field
          const alias = ctx.assocAlias(p[0]);
          return `${alias}."${p[p.length - 1]}"`;
        }
        return `t0."${p[0]}"`;
      }
      case 'fn': {
        const a = x.args.map(r);
        switch (x.name) {
          case 'concat': return `(${a.join(' || ')})`;
          case 'concat_with_space': return `(${a[0]} || ' ' || ${a[1]})`;
          case 'substring': return `substr(${a[0]}, ${a[1]}, ${a[2]})`;
          case 'left': return `substr(${a[0]}, 1, ${a[1]})`;
          case 'right': return `substr(${a[0]}, -(${a[1]}))`;
          case 'length': return `length(rtrim(${a[0]}))`;
          case 'instr': return this.dialect.instr(a[0], a[1]);
          case 'upper': case 'lower': case 'abs': case 'replace': case 'coalesce': case 'ltrim': case 'rtrim':
          case 'max': case 'min': case 'sum': case 'avg': return `${x.name}(${a.join(', ')})`;
          case 'count': return x.args.length ? `count(${a.join(', ')})` : 'count(*)';
          case 'round': return this.dialect.round(a[0], a[1] ?? 0);
          case 'ceil': return `ceil(${a[0]})`;
          case 'floor': return `floor(${a[0]})`;
          case 'div': return this.dialect.div(a[0], a[1]);
          case 'mod': return `((${a[0]}) % (${a[1]}))`;
          case 'division': return this.dialect.division(a[0], a[1], a[2] ?? 2);
          case 'currency_conversion': case 'unit_conversion': return a[0] ?? '0';
          case 'dats_days_between': return this.dialect.daysBetween(a[0], a[1]);
          case 'dats_add_days': return this.dialect.addDays(a[0], a[1]);
          case 'dats_add_months': return this.dialect.addMonths(a[0], a[1]);
          case 'tstmp_current_utctimestamp': return this.dialect.nowTimestamp();
          case 'lpad': return this.dialect.name === 'postgres' ? `lpad(${a[0]}, ${a[1]}, ${a[2]})` : `substr(replace(hex(zeroblob(${a[1]})), '00', ${a[2]}) || ${a[0]}, -(${a[1]}))`;
        }
        throw new Error(`CDS function ${x.name} is not supported yet`);
      }
      case 'cast': {
        const ti = resolveType(x.type);
        return `CAST(${r(x.e)} AS ${this.dialect.type(ti)})`;
      }
      case 'case': {
        let s = 'CASE';
        if (x.base) s += ' ' + r(x.base);
        for (const [w, t] of x.whens) s += ` WHEN ${r(w)} THEN ${r(t)}`;
        if (x.else) s += ` ELSE ${r(x.else)}`;
        return s + ' END';
      }
      case 'bin': return `(${r(x.l)} ${x.op} ${r(x.r)})`;
      case 'not': return `(NOT ${r(x.e)})`;
      case 'neg': return `(-${r(x.e)})`;
      case 'isnull': return `(${r(x.e)} IS ${x.neg ? 'NOT ' : ''}NULL)`;
      case 'isinitial': return `(${x.neg ? 'NOT ' : ''}COALESCE(CAST(${r(x.e)} AS TEXT), '') IN ('', '0', '0.0'))`;
      case 'like': return `(${r(x.e)} ${x.neg ? 'NOT ' : ''}LIKE ${r(x.p)})`;
      case 'between': return `(${r(x.e)} ${x.neg ? 'NOT ' : ''}BETWEEN ${r(x.lo)} AND ${r(x.hi)})`;
      case 'in': return `(${r(x.e)} ${x.neg ? 'NOT ' : ''}IN (${x.list.map(r).join(', ')}))`;
    }
    throw new Error(`Unsupported expression ${x.k}`);
  }

  // ---------------------------------------------------------------- runtime API used by $rt
  keysOf(entity) { return this.entities.get(entity)?.keys || null; }
  draftEnabled(entity) { return !!this.entities.get(entity)?.draft; }
  fieldsOf(name) { return this.entities.get(name)?.fields || this.structures.get(name)?.fields || null; }
  aliasesOf(bo) {
    const b = this.bos.get(bo) || this.entityBo.get(bo);
    return b ? [...b.aliases.keys()] : [];
  }
  guessEntity(obj) {
    let best = null, bestN = -1;
    for (const e of this.entities.values()) {
      if (!e.behavior || !e.keys?.length) continue;
      if (e.keys.every(k => k in obj) && e.keys.length > bestN) { best = e.name; bestN = e.keys.length; }
    }
    return best;
  }
  // DATA x TYPE <data element / table type of the app>
  dataElementInitial(name) {
    if (!this.ddic) return undefined;
    if (this.ddic.tableTypes.has(name)) return [];
    const b = builtinOf(name, this.ddic);
    return b ? (isNumeric(resolveType(b)) ? 0 : '') : undefined;
  }
}

// a dictionary type as the compiler's static type spec (src/abap/compiler.js typeSpec): null when unknown
function specOfTi(ti) {
  switch (ti?.t) {
    case 'p': return { k: 'p', len: Math.min(16, Math.ceil(((ti.len ?? 15) + 1) / 2)), dec: ti.dec ?? 0 };
    case 'c': return ti.len ? { k: 'c', len: ti.len } : null;
    case 'n': return { k: 'n', len: ti.len ?? 1 };
    case 'i': case 'int8': case 'f': case 'd': case 't': case 'string': return { k: ti.t };
    default: return null;
  }
}
function ddicSpec(model, name, depth = 0) {
  const n = String(name || '').toLowerCase();
  if (!n || depth > 6) return null;
  const fields = model.fieldsOf(n) || (model.tables?.get?.(n)?.fields);
  if (fields) {
    const comps = {};
    for (const f of fields) if (!f.isAssoc) comps[f.name.toLowerCase()] = f.struct ? ddicSpec(model, f.struct, depth + 1) : specOfTi(f.ti);
    return { k: 'struct', comps };
  }
  if (model.ddic?.dataElements?.has(n) || model.ddic?.domains?.has(n)) return specOfTi(model.typeOf({ name: n }));
  return null;
}

// abapGit table definition (DD02V / DD03P) -> table def
function parseTablXml(xml, file) {
  const tag = (src, t) => { const m = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(src); return m ? m[1].trim() : null; };
  const name = tag(xml, 'TABNAME');
  if (!name) return null;
  const fields = [];
  for (const m of xml.matchAll(/<DD03P>([\s\S]*?)<\/DD03P>/g)) {
    const f = m[1];
    const fname = tag(f, 'FIELDNAME');
    if (/^\.INCLU/i.test(fname || '')) { const inc = tag(f, 'PRECFIELD'); if (inc) fields.push({ include: inc.toLowerCase() }); continue; }
    if (!fname || fname.startsWith('.')) continue;
    const dt = (tag(f, 'DATATYPE') || '').toLowerCase();
    const rollname = (tag(f, 'ROLLNAME') || '').toLowerCase();
    const len = Number(tag(f, 'LENG') || 0) || undefined;
    const dec = Number(tag(f, 'DECIMALS') || 0) || undefined;
    let type;
    if (rollname && !dt) type = { name: rollname };
    else {
      const map = { char: 'abap.char', numc: 'abap.numc', dats: 'abap.dats', tims: 'abap.tims', int1: 'abap.int1', int2: 'abap.int2', int4: 'abap.int4', int8: 'abap.int8', dec: 'abap.dec', curr: 'abap.curr', quan: 'abap.quan', fltp: 'abap.fltp', cuky: 'abap.cuky', unit: 'abap.unit', lang: 'abap.lang', clnt: 'abap.clnt', raw: 'abap.raw', string: 'abap.string', sstr: 'abap.sstring', rstr: 'abap.string', utcl: 'abap.utclong', d16n: 'abap.d16n', d34n: 'abap.d34n', accp: 'abap.accp' };
      type = rollname && ['sysuuid_x16', 'abp_creation_tstmpl', 'abp_lastchange_tstmpl', 'abp_locinst_lastchange_tstmpl', 'timestampl', 'timestamp', 'abap_boolean', 'abp_creation_user', 'abp_lastchange_user', 'abp_locinst_lastchange_user'].includes(rollname)
        ? { name: rollname } : { name: map[dt] || 'abap.char', len, dec };
    }
    fields.push({ name: fname.toLowerCase(), label: fname, key: tag(f, 'KEYFLAG') === 'X', type, notNull: tag(f, 'NOTNULL') === 'X', ann: {} });
  }
  return { kind: /^(INTTAB|APPEND)$/i.test(tag(xml, 'TABCLASS') || '') ? 'structure' : 'table', name: name.toLowerCase(), label: name, ann: { endusertext: { label: tag(xml, 'DDTEXT') } }, fields, file };
}

// draft administrative data stored with every draft instance
export const DRAFT_ADMIN = [
  { name: 'draftuuid', type: 'TEXT' }, { name: 'hasactiveentity', type: 'TEXT' },
  { name: 'draftentitycreationdatetime', type: 'REAL' }, { name: 'draftentitylastchangedatetime', type: 'REAL' },
  { name: 'draftcreatedbyuser', type: 'TEXT' }, { name: 'draftlastchangedbyuser', type: 'TEXT' },
  { name: 'draftentityoperationcode', type: 'TEXT' },
];

function sqlLit(v) {
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

// ON condition -> [[sourceElement, targetElement]] for "$projection.X = _A.Y" (or "X = _A.Y") conjuncts
function onPairs(on, assocName, ent) {
  const pairs = [];
  const walk = (x) => {
    if (x.k === 'bin' && x.op === 'AND') { walk(x.l); walk(x.r); return; }
    if (x.k === 'bin' && x.op === '=' && x.l.k === 'path' && x.r.k === 'path') {
      const side = (p) => {
        const s = p.path.map(t => t.toLowerCase());
        if (s[0] === assocName) return ['t', s[s.length - 1]];
        if (s[0] === '$projection') return ['s', s[1]];
        // a source column: find the element exposing it
        const col = s[s.length - 1];
        const el = ent.fields.find(f => f.basePath === col) || ent.fields.find(f => f.name === col);
        return ['s', el ? el.name : col];
      };
      const a = side(x.l), b = side(x.r);
      if (a[0] === 's' && b[0] === 't') pairs.push([a[1], b[1]]);
      else if (a[0] === 't' && b[0] === 's') pairs.push([b[1], a[1]]);
    }
  };
  walk(on);
  return pairs;
}
function onFilters(on, assocName) {
  const out = [];
  const walk = (x) => {
    if (x.k === 'bin' && x.op === 'AND') { walk(x.l); walk(x.r); return; }
    if (x.k === 'bin' && x.op === '=' && x.l.k === 'path' && x.r.k === 'lit' && x.l.path[0].toLowerCase() === assocName) out.push([x.l.path[x.l.path.length - 1].toLowerCase(), x.r.v]);
  };
  walk(on);
  return out;
}

// parameters of a view or table function: name, type, annotations
function paramsOf(list) {
  return (list || []).map(p => { const ti = resolveType(p.type); return { name: p.name, label: p.label, ti, numeric: isNumeric(ti), ann: p.ann || {} }; });
}
// SQLScript statements of an AMDP body (top-level ';', strings respected)
function splitSqlScript(body) {
  const out = [];
  let cur = '', q = false, d = 0;
  for (const c of body) {
    if (c === "'") q = !q;
    if (!q) { if (c === '(') d++; if (c === ')') d--; }
    if (c === ';' && !q && d === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map(x => x.replace(/^--.*$/gm, '').trim()).filter(Boolean);
}
