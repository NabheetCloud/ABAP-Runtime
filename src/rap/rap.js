// Managed RAP runtime: transactional buffer, EML, behavior handler orchestration and save sequence.
import { installRapLocks } from './locks.js';
import { randomUUID } from 'node:crypto';
import { methodKey } from '../abap/compiler.js';
import { initialValue, toDb } from './types.js';

const ADMIN = {
  createdBy: ['semantics', 'user', 'createdby'],
  createdAt: ['semantics', 'systemdatetime', 'createdat'],
  lastChangedBy: ['semantics', 'user', 'lastchangedby'],
  lastChangedAt: ['semantics', 'systemdatetime', 'lastchangedat'],
  localChangedBy: ['semantics', 'user', 'localinstancelastchangedby'],
  localChangedAt: ['semantics', 'systemdatetime', 'localinstancelastchangedat'],
};
const annGet = (ann, path) => path.reduce((o, k) => (o == null ? o : o[k]), ann);

export class RapError extends Error {
  constructor(status, message, details = []) { super(message); this.status = status; this.details = details; }
}

export class RapRuntime {
  constructor(app) {
    this.app = app;
    this.model = app.model;
    this.rt = app.rt;
    this.db = app.db;
    this.tx = null;
    this.rt.eml = {
      read: spec => this.current().read(spec),
      modify: spec => this.current().modify(spec),
      commit: () => this.current().commitFromEml(),
      rollback: () => { this.tx?.cleanupUnmanaged(); this.tx = null; },
      raiseEvent: (spec, rows) => this.current().raiseEvent(spec, rows),
      dynamic: (kind, ops) => this.current().dynamic(kind, ops),
    };
    this.eventQueue = [];
    this.rt.sql = new SqlApi(this);
    installRapLocks(this.rt, this.db, this.model.lockObjects);   // ENQUEUE_/DEQUEUE_ of the app's lock objects
  }
  begin() { this.tx = new Transaction(this); return this.tx; }
  current() { return this.tx || this.begin(); }
  end() { if (this.tx && !this.tx.saved) this.tx.cleanupUnmanaged(); this.tx = null; this.flushEvents(); this.rt.runBackground?.(); }

  // ------------------------------------------------------------------ business events
  // Events raised in the save sequence are published after the commit: written to the event log and passed
  // to the event handler classes (FOR EVENTS OF <bo>), each in its own transaction.
  flushEvents() {
    if (this.flushing || !this.eventQueue.length) return;
    this.flushing = true;
    try {
      for (let n = 0; this.eventQueue.length && n < 100; n++) {
        const ev = this.eventQueue.shift();
        this.logEvent(ev);
        const bo = this.model.entityBo.get(ev.entity);
        for (const h of (bo?.eventHandlers || []).filter(h => h.entity === ev.entity && h.event === ev.event)) {
          const saved = this.tx;
          this.tx = null;
          try {
            const obj = this.rt.new(h.cls);
            obj[methodKey(h.method)]({ [h.importing]: ev.rows.map(r => this.rt.tag(this.rt.clone(r), ev.entity)) });
            ev.handled = (ev.handled || 0) + 1;
          } catch (e) {
            console.error(`[rap] event handler ${h.cls}->${h.method} failed: ${e.get_text?.()?.$ret || e.message}`);
          } finally { this.tx = saved; }
        }
      }
    } finally { this.flushing = false; }
  }
  logEvent(ev) {
    const db = this.db;
    try {
      if (!this.eventTable) { db.exec(`CREATE TABLE IF NOT EXISTS "rap_event_log" ("id" TEXT PRIMARY KEY, "raised_at" TEXT, "entity" TEXT, "event" TEXT, "raised_by" TEXT, "payload" TEXT)`); this.eventTable = true; }
      db.prepare(`INSERT INTO "rap_event_log" ("id", "raised_at", "entity", "event", "raised_by", "payload") VALUES (?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), new Date().toISOString(), ev.entity, ev.event, ev.user || '', JSON.stringify(ev.rows));
    } catch (e) { console.error(`[rap] event log: ${e.message}`); }
  }
  changes({ entity, objectId, top = 200 } = {}) {
    const where = [], params = [];
    if (entity) { where.push('"entity" = ?'); params.push(String(entity).toLowerCase()); }
    if (objectId) { where.push('"object_id" = ?'); params.push(objectId); }
    try { return this.db.prepare(`SELECT * FROM "rap_change_log"${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY "changed_at" DESC, "field" LIMIT ?`).all(...params, top); }
    catch { return []; }
  }
  events(top = 100) {
    try { return this.db.prepare(`SELECT * FROM "rap_event_log" ORDER BY "raised_at" DESC LIMIT ?`).all(top).map(r => ({ ...r, payload: JSON.parse(r.payload || '[]') })); }
    catch { return []; }
  }
}

// =====================================================================================================
class Transaction {
  constructor(rap) {
    this.rap = rap; this.model = rap.model; this.rt = rap.rt; this.db = rap.db;
    this.buffer = new Map();
    this.events = [];
    this.cids = new Map();
    this.pids = new Map(); // late numbering: %pid -> instance
    this.source = null;
    this.depth = 0;
    this.failed = {}; this.reported = {}; this.mapped = {};
    this.messages = [];
    this.unmanagedTouched = new Set();   // unmanaged BOs changed in this transaction (their buffer is the app's)
    this.saved = false;
    this.raised = [];                    // business events raised in the save sequence
  }

  // ------------------------------------------------------------------ resolution helpers
  boOf(name) {
    const m = this.model;
    let bo = m.bos.get(name) || m.entityBo.get(name);
    if (bo?.projection) bo = m.bos.get(bo.base) || m.entityBo.get(bo.base);
    if (!bo) throw this.rt.new('cx_sy_dyn_call_illegal_method', { text: `No behavior definition for ${String(name).toUpperCase()}` });
    return bo;
  }
  resolveEntity(bo, nameOrAlias) {
    const n = nameOrAlias.toLowerCase();
    if (bo) {
      const B = this.boOf(bo);
      // alias of the BO itself, of a projection BO or an entity name
      if (B.aliases.has(n)) return [B, B.aliases.get(n)];
      const pb = this.model.bos.get(bo) || this.model.entityBo.get(bo);
      if (pb?.projection && pb.aliases.has(n)) return [B, this.model.baseEntity(pb.aliases.get(n))];
      if (B.entities.has(n)) return [B, n];
    }
    const base = this.model.baseEntity(n);
    const B = this.model.entityBo.get(base);
    if (B && B.entities.has(base)) return [B, base];
    for (const b of this.model.bos.values()) if (!b.projection && b.aliases.has(n)) return [b, b.aliases.get(n)];
    throw this.rt.new('cx_sy_dyn_call_illegal_method', { text: `Unknown entity ${nameOrAlias.toUpperCase()} in EML` });
  }
  alias(entity) { return this.model.entities.get(entity).behavior.aliasLower; }
  ent(entity) { return this.model.entities.get(entity); }
  keyOf(entity, row) {
    const ent = this.ent(entity);
    if (row?.['%cid_ref'] && this.cids.has(row['%cid_ref'])) return { ...this.cids.get(row['%cid_ref']).key };
    const pid = row?.['%pid'] ?? row?.['%tky']?.['%pid'];
    if (pid && this.pids.has(pid)) return { ...this.pids.get(pid).key };
    const key = {};
    for (const k of ent.keys) key[k] = row?.[k] ?? row?.['%tky']?.[k] ?? row?.['%key']?.[k];
    if (ent.draft) key['%is_draft'] = draftFlag(row?.['%is_draft'] ?? row?.['%tky']?.['%is_draft']);
    return key;
  }
  keyStr(entity, key) {
    const ent = this.ent(entity);
    const parts = ent.keys.map(k => String(key[k] ?? '').replace(/ +$/, ''));
    if (ent.draft) parts.push(draftFlag(key['%is_draft']));
    return JSON.stringify(parts);
  }
  tagged(entity, obj) { return this.rt.tag(obj, entity); }

  // ------------------------------------------------------------------ buffer access
  bufferOf(entity) {
    if (!this.buffer.has(entity)) this.buffer.set(entity, new Map());
    return this.buffer.get(entity);
  }
  get(entity, key) {
    const ks = this.keyStr(entity, key);
    const buf = this.bufferOf(entity);
    if (buf.has(ks)) { const inst = buf.get(ks); return inst.deleted ? null : inst; }
    const ent = this.ent(entity);
    if (ent.keys.some(k => key[k] === undefined)) return null;
    const isDraft = !!ent.draft && draftFlag(key['%is_draft']) === '01';
    const source = isDraft ? `${entity}$d` : entity;
    const row = this.db.prepare(`SELECT * FROM "${source}" WHERE ${ent.keys.map(k => `"${k}" = ?`).join(' AND ')}`).get(...ent.keys.map(k => toDb(key[k], ent.fields.find(f => f.name === k).ti)));
    if (!row) return null;
    // drafts belong to the user who created them; other users neither see nor change them
    if (isDraft && row.$draftcreatedbyuser && row.$draftcreatedbyuser !== this.user && !this.anyOwner && !this.collab(entity)) return null;
    const inst = { entity, key: this.pickKey(entity, row, isDraft), data: normalizeRow(ent, row), isNew: false, deleted: false, changed: new Set(), isDraft };
    inst.orig = { ...inst.data };   // for change documents
    if (isDraft) inst.admin = { draftuuid: row.$draftuuid, hasActive: row.$hasactiveentity === 'X', created: row.$draftentitycreationdatetime, createdBy: row.$draftcreatedbyuser, changed: row.$draftentitylastchangedatetime };
    buf.set(ks, inst);
    return inst;
  }
  get user() { return this.rt.sy.uname; }
  // collaborative draft: all users work on the same draft, there is no exclusive lock
  collab(entity) { return !!this.model.entityBo.get(entity)?.collaborative; }
  // draft lock of an active instance: { owner, fresh } if a draft exists (fresh = exclusive lock still valid)
  draftLock(entity, key) {
    const ent = this.ent(entity);
    if (!ent.draft) return null;
    const row = this.db.prepare(`SELECT "$draftcreatedbyuser" AS owner, "$draftentitylastchangedatetime" AS changed FROM "${entity}$d" WHERE ${ent.keys.map(k => `"${k}" = ?`).join(' AND ')}`).get(...ent.keys.map(k => toDb(key[k], ent.fields.find(f => f.name === k).ti)));
    if (!row) return null;
    return { owner: row.owner || '', fresh: Date.now() - tsToMs(row.changed) < lockMs() };
  }
  // draft of an instance regardless of its owner (for lock handling)
  getDraftAny(entity, key) {
    this.anyOwner = true;
    try { return this.get(entity, { ...key, '%is_draft': '01' }); } finally { this.anyOwner = false; }
  }
  pickKey(entity, data, isDraft = false) {
    const ent = this.ent(entity);
    const k = {};
    for (const f of ent.keys) k[f] = data[f] === undefined ? undefined : toDb(data[f], ent.fields.find(x => x.name === f).ti);
    if (ent.draft) k['%is_draft'] = isDraft ? '01' : '00';
    return k;
  }
  children(entity, data, assoc, isDraft = false) {
    const a = this.ent(entity).assocs.get(assoc);
    const target = this.model.baseEntity(a.target);
    const tent = this.ent(target);
    const draft = !!tent.draft && isDraft;
    const out = new Map();
    if (!a.pairs.length) return [];
    const where = a.pairs.map(([, t]) => `"${t}" = ?`).join(' AND ');
    const rows = this.db.prepare(`SELECT * FROM "${draft ? target + '$d' : target}" WHERE ${where}`).all(...a.pairs.map(([s, t]) => toDb(data[s], tent.fields.find(f => f.name === t)?.ti || { t: 'c' })));
    for (const r of rows) {
      const key = this.pickKey(target, r, draft);
      const inst = this.get(target, key);
      if (inst) out.set(this.keyStr(target, key), inst);
    }
    for (const inst of this.bufferOf(target).values()) {
      if (inst.deleted || !!inst.isDraft !== draft) continue;
      if (a.pairs.every(([s, t]) => this.rt.eq(inst.data[t], data[s]))) out.set(this.keyStr(target, inst.key), inst);
    }
    return [...out.values()].map(i => ({ inst: i, target }));
  }
  event(entity, inst, kind, fields) {
    this.events.push({ entity, ks: this.keyStr(entity, inst.key), inst, kind, fields: new Set(fields), source: this.source });
  }
  resp() { return { failed: {}, reported: {}, mapped: {} }; }
  push(resp, part, alias, row) { (resp[part][alias] ||= []).push(row); }
  fail(resp, entity, key, cause, text, element) {
    const alias = this.alias(entity);
    const k = this.tagged(entity, { ...key });
    this.push(resp, 'failed', alias, Object.assign(this.tagged(entity, { ...key }), { '%fail': { cause } }));
    if (text) this.push(resp, 'reported', alias, Object.assign(k, { '%msg': this.rt.message({ severity: 'E', text }), ...(element ? { '%element': { [element]: '01' } } : {}) }));
  }

  // ------------------------------------------------------------------ handlers
  handlers(bo, entity, kind, target) {
    return (bo.handlers || []).filter(h => h.entity === entity && h.kind === kind && (target === undefined || h.target === target));
  }
  callHandler(bo, h, keys, extra = {}) {
    const C = this.rt.cls(h.cls);
    const obj = new C();
    const failed = this.rt.resp(bo.name), reported = this.rt.resp(bo.name), mapped = this.rt.resp(bo.name);
    const p = { failed, reported, mapped, ...extra };
    if (h.importing) p[h.importing] = keys;
    const save = this.source;
    this.depth++;
    let out;
    // the handler is a frame of the call stack (debugger, XCO call_stack), like a method called by the framework
    const stack = this.rt.callStack;
    stack.push(`${String(C.$name || h.cls).toUpperCase()} ${String(h.method).toUpperCase()}`);
    try { out = obj[methodKey(h.method)](p) || {}; }
    finally { stack.pop(); this.depth--; this.source = save; }
    return { result: h.result ? out[h.result] : undefined, failed: out.failed || failed, reported: out.reported || reported, mapped: out.mapped || mapped };
  }
  mergeResp(into, out) {
    for (const part of ['failed', 'reported', 'mapped']) {
      for (const [alias, rows] of Object.entries(out[part] || {})) {
        if (!Array.isArray(rows) || !rows.length) continue;
        (into[part][alias] ||= []).push(...rows);
      }
    }
  }

  // feature control / authorization for external requests; returns error text or null
  checkInstance(bo, entity, inst, op, name) {
    const beh = this.ent(entity).behavior;
    if (!inst.isDraft && !this.collab(entity)) {
      const lock = this.draftLock(entity, inst.key);
      if (lock && lock.owner !== this.user && lock.fresh) return `${beh.alias} is locked by user ${lock.owner}`;
    }
    const req = {};
    if (op === 'update') req['%update'] = '01';
    if (op === 'delete') req['%delete'] = '01';
    if (op === 'action') req['%action'] = { [name]: '01' };
    if (op === 'cba') req['%assoc'] = { [name]: '01' };
    const key = this.tagged(entity, { ...inst.key });
    for (const h of this.handlers(bo, entity, 'instance_authorization')) {
      const r = this.callHandler(bo, h, [key], { [h.request]: req });
      this.mergeResp(this, r);
      const row = (r.result || [])[0];
      if (row && isOn(op === 'update' ? row['%update'] : op === 'delete' ? row['%delete'] : op === 'action' ? row['%action']?.[name] : row['%assoc']?.[name])) return 'You are not authorized for this operation';
    }
    for (const h of this.handlers(bo, entity, 'global_authorization')) {
      const r = this.callHandler(bo, h, undefined, { [h.request]: req });
      const row = r.result || {};
      if (isOn(op === 'update' ? row['%update'] : op === 'delete' ? row['%delete'] : op === 'action' ? row['%action']?.[name] : row['%create'])) return 'You are not authorized for this operation';
    }
    const needsFeatures = (op === 'update' && beh.ops.update?.features) || (op === 'delete' && beh.ops.delete?.features) || (op === 'action' && beh.actions[name]?.features) || op === 'update';
    if (needsFeatures) {
      for (const h of this.handlers(bo, entity, 'instance_features')) {
        const r = this.callHandler(bo, h, [key], { [h.request]: req });
        const row = (r.result || [])[0];
        if (!row) continue;
        if (op === 'update' && isOn(row['%update'])) return 'Editing is disabled for this instance';
        if (op === 'delete' && isOn(row['%delete'])) return 'Deletion is disabled for this instance';
        if (op === 'action' && isOn(row['%action']?.[name] ?? row['%features']?.['%action']?.[name])) return `Action ${name} is disabled for this instance`;
      }
    }
    return null;
  }

  // features for UI: { update, delete, actions: {name: enabled}, fields: {name: 'readonly'|'mandatory'} }
  features(bo, entity, key) {
    const inst = this.get(entity, key);
    if (!inst) return null;
    const beh = this.ent(entity).behavior;
    const res = { update: !!beh.ops.update, delete: !!beh.ops.delete, actions: {}, fields: {}, assocs: {} };
    for (const a of Object.keys(beh.actions)) res.actions[a] = true;
    for (const a of Object.keys(beh.assocs)) res.assocs[a] = beh.assocs[a].create;
    if (!inst.isDraft && !this.collab(entity)) {
      const lock = this.draftLock(entity, inst.key);
      if (lock && lock.owner !== this.user && lock.fresh) {
        res.update = false; res.delete = false; res.lockedBy = lock.owner;
        for (const a of Object.keys(res.actions)) res.actions[a] = false;
        return res;
      }
    }
    const req = { '%update': '01', '%delete': '01', '%action': Object.fromEntries(Object.keys(beh.actions).map(a => [a, '01'])) };
    for (const h of this.handlers(bo, entity, 'instance_features')) {
      const r = this.callHandler(bo, h, [this.tagged(entity, { ...inst.key })], { [h.request]: req });
      const row = (r.result || [])[0];
      if (!row) continue;
      if (isOn(row['%update'])) res.update = false;
      if (isOn(row['%delete'])) res.delete = false;
      for (const [a, v] of Object.entries(row['%action'] || {})) if (isOn(v)) res.actions[a] = false;
      for (const [a, v] of Object.entries(row['%assoc'] || {})) if (isOn(v)) res.assocs[a] = false;
      for (const [f, v] of Object.entries(row['%field'] || {})) res.fields[f] = v === '01' ? 'readonly' : v === '02' ? 'mandatory' : 'unrestricted';
    }
    for (const h of this.handlers(bo, entity, 'instance_authorization')) {
      const r = this.callHandler(bo, h, [this.tagged(entity, { ...inst.key })], { [h.request]: req });
      const row = (r.result || [])[0];
      if (!row) continue;
      if (isOn(row['%update'])) res.update = false;
      if (isOn(row['%delete'])) res.delete = false;
      for (const [a, v] of Object.entries(row['%action'] || {})) if (isOn(v)) res.actions[a] = false;
    }
    return res;
  }

  // ------------------------------------------------------------------ EML READ
  read(spec) {
    const out = { results: [], links: [], failed: this.rt.resp(spec.bo), reported: this.rt.resp(spec.bo) };
    const resp = this.resp();
    for (const part of spec.parts) {
      const [bo, entity] = this.resolveEntity(spec.bo, part.entity);
      if (bo.type === 'unmanaged') { const r = this.umRead(bo, entity, part, resp); out.results.push(r.result); out.links.push(r.links); continue; }
      const res = [];
      const links = [];
      for (const row of part.rows || []) {
        const key = this.keyOf(entity, row);
        const inst = this.get(entity, key);
        if (!inst) { this.fail(resp, entity, key, '01'); continue; }
        if (part.assoc) {
          const a = this.ent(entity).assocs.get(part.assoc);
          if (!a) throw this.rt.new('cx_sy_dyn_call_illegal_method', { text: `Association ${part.assoc} not found in ${entity}` });
          let targets;
          if (a.toParent) {
            const pent = this.model.baseEntity(a.target);
            const pkey = {};
            for (const [s, t] of a.pairs) pkey[t] = inst.data[s];
            if (this.ent(pent).draft) pkey['%is_draft'] = inst.isDraft ? '01' : '00';
            const p = this.get(pent, pkey);
            targets = p ? [{ inst: p, target: pent }] : [];
          } else targets = this.children(entity, inst.data, part.assoc, inst.isDraft);
          for (const t of targets) {
            res.push(this.project(t.target, t.inst.data, part.fields, t.inst));
            links.push({ source: this.tagged(entity, { ...inst.key, '%tky': { ...inst.key } }), target: this.tagged(t.target, { ...t.inst.key }) });
          }
        } else res.push(this.project(entity, inst.data, part.fields, inst));
        void bo;
      }
      out.results.push(res);
      out.links.push(links);
    }
    Object.assign(out.failed, resp.failed);
    Object.assign(out.reported, resp.reported);
    this.rt.sy.subrc = Object.values(resp.failed).some(r => r.length) ? 4 : 0;
    return out;
  }
  project(entity, data, fields, inst) {
    const ent = this.ent(entity);
    const row = {};
    for (const f of ent.fields) if (!fields || fields.includes(f.name) || ent.keys.includes(f.name)) row[f.name] = this.rt.clone(data[f.name]);
    if (ent.draft) row['%is_draft'] = inst?.isDraft ? '01' : '00';
    if (inst?.pid) row['%pid'] = inst.pid;
    return this.tagged(entity, row);
  }

  // ------------------------------------------------------------------ EML MODIFY
  modify(spec) {
    const out = { results: [], mapped: this.rt.resp(spec.bo), failed: this.rt.resp(spec.bo), reported: this.rt.resp(spec.bo) };
    const resp = this.resp();
    const external = !spec.local && this.depth === 0;
    this.depth++;
    try {
      for (const op of spec.ops) {
        const [bo, entity] = this.resolveEntity(spec.bo, op.entity);
        const rows = op.rows || [];
        if (op.op === 'create') { this.create(bo, entity, rows, op.fields, resp, external, op.autoCid); out.results.push([]); }
        else if (op.op === 'cba') { this.createByAssoc(bo, entity, op.assoc, rows, op.fields, resp, external, op.autoCid); out.results.push([]); }
        else if (op.op === 'update') { this.update(bo, entity, rows, op.fields, resp, external); out.results.push([]); }
        else if (op.op === 'delete') { this.delete(bo, entity, rows, resp, external); out.results.push([]); }
        else if (op.op === 'execute') out.results.push(this.execute(bo, entity, op.action, rows, resp, external));
      }
    } finally { this.depth--; }
    if (this.depth === 0) this.runModifyDeterminations();
    for (const part of ['failed', 'reported', 'mapped']) Object.assign(out[part], resp[part]);
    this.rt.sy.subrc = Object.values(resp.failed).some(r => r.length) ? 4 : 0;
    return out;
  }

  valuesFrom(entity, row, fields) {
    // which components of the input row are applied
    const ent = this.ent(entity);
    const names = ent.fields.map(f => f.name);
    let use;
    if (Array.isArray(fields)) use = fields;
    else if (fields === 'control' && row['%control']) use = names.filter(n => isOn(row['%control'][n]));
    else use = names.filter(n => n in row);
    const out = {};
    for (const n of use) {
      if (!names.includes(n)) continue;
      const v = n in row ? row[n] : row['%data']?.[n];
      if (v === undefined) continue;
      out[n] = toDb(v, ent.fields.find(f => f.name === n).ti);
    }
    return out;
  }

  checkReadonly(bo, entity, values, resp, key, isCreate) {
    const beh = this.ent(entity).behavior;
    for (const f of Object.keys(values)) {
      const fb = beh.fields[f];
      if (!fb) continue;
      if (fb.readonly || fb.numberingManaged || (!isCreate && fb.readonlyUpdate)) {
        this.fail(resp, entity, key, '05', `Field ${this.label(entity, f)} is read-only`, f);
        return false;
      }
    }
    return true;
  }
  label(entity, f) {
    const fd = this.ent(entity).fields.find(x => x.name === f);
    return fd?.ann?.endusertext?.label || fd?.label || f;
  }

  create(bo, entity, rows, fields, resp, external, autoCid, parentValues) {
    if (bo.type === 'unmanaged') return this.umModify(bo, entity, { op: 'create', fields, autoCid }, rows, resp, external);
    const ent = this.ent(entity);
    const beh = ent.behavior;
    if (external && !beh.ops.create && !parentValues) { for (const r of rows) this.fail(resp, entity, {}, '02', `Create is not enabled for ${beh.alias}`); return; }
    // early numbering
    const prepared = rows.map(r => { const values = this.valuesFrom(entity, r, fields); return { row: r, cid: r['%cid'] || (autoCid ? 'auto' + randomUUID() : ''), values, given: { ...values } }; });
    if (beh.earlyNumbering) {
      const ents = prepared.map(p => this.tagged(entity, { '%cid': p.cid, ...p.values, ...(parentValues || {}) }));
      for (const h of this.handlers(bo, entity, 'numbering')) {
        const r = this.callHandler(bo, h, ents);
        this.mergeResp(resp, { failed: r.failed, reported: r.reported });
        for (const m of r.mapped[this.alias(entity)] || []) {
          const p = prepared.find(x => x.cid === m['%cid']);
          if (p) for (const k of ent.keys) if (m[k] !== undefined) p.values[k] = toDb(m[k], ent.fields.find(f => f.name === k).ti);
        }
      }
    }
    for (const p of prepared) {
      // read-only fields: what the caller sent (keys set by early numbering are not the caller's)
      if (external && !this.checkReadonly(bo, entity, p.given, resp, {}, true)) continue;
      const isDraft = !!ent.draft && draftFlag(p.row['%is_draft'] ?? parentValues?.['%is_draft']) === '01';
      const data = {};
      for (const f of ent.fields) data[f.name] = initialValue(f.ti);
      const { '%is_draft': _d, ...pv } = parentValues || {};
      Object.assign(data, p.values, pv);
      for (const k of ent.keys) {
        const fb = beh.fields[k];
        if ((fb?.numberingManaged) && !data[k]) data[k] = randomUUID().replace(/-/g, '').toUpperCase();
      }
      // late numbering: preliminary keys now, final keys from the saver's adjust_numbers at save
      let pid = null;
      if (beh.lateNumbering) {
        pid = 'PID' + randomUUID().replace(/-/g, '').toUpperCase();
        for (const k of this.ownKeyFields(entity)) if (this.rt.initial(data[k])) data[k] = tempKey(ent.fields.find(f => f.name === k).ti);
      }
      const key = this.pickKey(entity, data, isDraft);
      if (ent.keys.some(k => this.rt.initial(key[k]))) { this.fail(resp, entity, key, '02', `Key of ${beh.alias} is initial; supply it or use numbering`); continue; }
      if (this.get(entity, key)) { this.fail(resp, entity, key, '07', `${beh.alias} with this key already exists`); continue; }
      const inst = { entity, key, data, isNew: true, deleted: false, changed: new Set(Object.keys(p.values)), created: true, isDraft };
      if (isDraft) inst.admin = { draftuuid: randomUUID().replace(/-/g, '').toUpperCase(), hasActive: false, created: this.rt.timestampl(), createdBy: this.rt.sy.uname };
      this.bufferOf(entity).set(this.keyStr(entity, key), inst);
      if (p.cid) this.cids.set(p.cid, { entity, key });
      if (pid) { inst.pid = pid; this.pids.set(pid, inst); }
      this.push(resp, 'mapped', this.alias(entity), this.tagged(entity, { '%cid': p.cid, ...key, ...(pid ? { '%pid': pid } : {}) }));
      this.event(entity, inst, 'create', Object.keys(data));
    }
  }

  createByAssoc(bo, entity, assoc, rows, fields, resp, external, autoCid) {
    if (bo.type === 'unmanaged') return this.umModify(bo, entity, { op: 'cba', assoc, fields, autoCid }, rows, resp, external);
    const ent = this.ent(entity);
    const a = ent.assocs.get(assoc);
    if (!a) throw this.rt.new('cx_sy_dyn_call_illegal_method', { text: `Association ${assoc} not found in ${entity}` });
    const target = this.model.baseEntity(a.target);
    if (external && !ent.behavior.assocs[assoc]?.create) { this.fail(resp, entity, this.keyOf(entity, rows[0] || {}), '02', `Create by association ${assoc} is not enabled`); return; }
    for (const r of rows) {
      const key = this.keyOf(entity, r);
      const parent = this.get(entity, key);
      if (!parent) { this.fail(resp, entity, key, '01', `${ent.behavior.alias} not found`); continue; }
      if (external) { const e = this.checkInstance(bo, entity, parent, 'cba', assoc); if (e) { this.fail(resp, entity, key, /locked/.test(e) ? '04' : '03', e); continue; } }
      const parentValues = {};
      for (const [s, t] of a.pairs) parentValues[t] = parent.data[s];
      if (this.ent(target).draft) parentValues['%is_draft'] = parent.isDraft ? '01' : '00';
      this.create(bo, target, r['%target'] || [], fields, resp, external, autoCid, parentValues);
    }
  }

  update(bo, entity, rows, fields, resp, external) {
    if (bo.type === 'unmanaged') return this.umModify(bo, entity, { op: 'update', fields }, rows, resp, external);
    const ent = this.ent(entity);
    if (external && !ent.behavior.ops.update) { for (const r of rows) this.fail(resp, entity, this.keyOf(entity, r), '02', `Update is not enabled for ${ent.behavior.alias}`); return; }
    for (const r of rows) {
      const key = this.keyOf(entity, r);
      const inst = this.get(entity, key);
      if (!inst) { this.fail(resp, entity, key, '01', `${ent.behavior.alias} not found`); continue; }
      const values = this.valuesFrom(entity, r, fields);
      for (const k of ent.keys) delete values[k];
      if (external) {
        if (!this.checkReadonly(bo, entity, values, resp, key, false)) continue;
        const e = this.checkInstance(bo, entity, inst, 'update');
        if (e) { this.fail(resp, entity, key, /locked/.test(e) ? '04' : '06', e); continue; }
      }
      const changed = [];
      for (const [k, v] of Object.entries(values)) {
        if (!this.rt.eq(inst.data[k], v)) changed.push(k);
        inst.data[k] = v;
        inst.changed.add(k);
      }
      if (changed.length) this.event(entity, inst, 'update', changed);
    }
  }

  delete(bo, entity, rows, resp, external) {
    if (bo.type === 'unmanaged') return this.umModify(bo, entity, { op: 'delete' }, rows, resp, external);
    const ent = this.ent(entity);
    if (external && !ent.behavior.ops.delete) { for (const r of rows) this.fail(resp, entity, this.keyOf(entity, r), '02', `Delete is not enabled for ${ent.behavior.alias}`); return; }
    for (const r of rows) {
      const key = this.keyOf(entity, r);
      const inst = this.get(entity, key);
      if (!inst) { this.fail(resp, entity, key, '01', `${ent.behavior.alias} not found`); continue; }
      if (external) { const e = this.checkInstance(bo, entity, inst, 'delete'); if (e) { this.fail(resp, entity, key, /locked/.test(e) ? '04' : '06', e); continue; } }
      this.deleteInst(entity, inst);
    }
  }
  deleteInst(entity, inst) {
    inst.deleted = true;
    this.event(entity, inst, 'delete', []);
    for (const a of this.ent(entity).assocs.values()) {
      if (!a.composition) continue;
      for (const c of this.children(entity, inst.data, a.name, inst.isDraft)) this.deleteInst(c.target, c.inst);
    }
  }

  execute(bo, entity, action, rows, resp, external) {
    const ent = this.ent(entity);
    if (ent.draft && ent.behavior.draftActions.has(action) && !this.handlers(bo, entity, 'modify', action).length) return this.draftAction(bo, entity, action, rows, resp, external);
    const a = ent.behavior.actions[action];
    if (!a) throw this.rt.new('cx_sy_dyn_call_illegal_method', { text: `Action ${action} not defined for ${ent.behavior.alias}` });
    if (external && a.internal) { this.fail(resp, entity, {}, '02', `Action ${action} is internal`); return []; }
    const keys = [];
    for (const r of rows) {
      if (a.static) { keys.push(this.tagged(entity, { '%cid': r['%cid'] || '', '%param': r['%param'] || {} })); continue; }
      const key = this.keyOf(entity, r);
      const inst = bo.type === 'unmanaged' ? this.umInstance(bo, entity, key) : this.get(entity, key);
      if (!inst) { this.fail(resp, entity, key, '01', `${ent.behavior.alias} not found`); continue; }
      if (external && bo.type === 'unmanaged' && !this.umLock(bo, entity, [key], resp)) continue;
      if (external && !a.noAuth) { const e = this.checkInstance(bo, entity, inst, 'action', action); if (e) { this.fail(resp, entity, key, /locked/.test(e) ? '04' : '06', e); continue; } }
      const k = this.tagged(entity, { ...key, '%cid_ref': r['%cid_ref'] || '' });
      if (a.param || r['%param']) k['%param'] = this.paramValues(a.param, r['%param'] || {});
      if (a.factory) k['%cid_ref'] = r['%cid'] || r['%cid_ref'] || '';
      keys.push(k);
    }
    if (!keys.length) return [];
    let result = [];
    if (bo.type === 'unmanaged') this.unmanagedTouched.add(bo);
    for (const h of this.handlers(bo, entity, 'modify', action)) {
      const r = this.callHandler(bo, h, keys);
      this.mergeResp(resp, r);
      if (Array.isArray(r.result)) result = result.concat(r.result);
    }
    return result.map(x => (x && typeof x === 'object' && !this.rt.entityOf(x) ? this.tagged(entity, x) : x));
  }
  paramValues(paramEntity, values) {
    if (!paramEntity) return values;
    const pe = this.ent(paramEntity);
    const out = {};
    for (const f of pe.fields) out[f.name] = values[f.name] === undefined ? initialValue(f.ti) : toDb(values[f.name], f.ti);
    return out;
  }

  // ------------------------------------------------------------------ unmanaged BOs
  // The application owns the transactional buffer: handler methods FOR MODIFY / FOR READ / FOR LOCK do the work,
  // the saver's finalize / check_before_save / save / cleanup write it to the database.
  umHandlers(bo, entity, kind, op, assoc = null) {
    return (bo.handlers || []).filter(h => h.entity === entity && h.kind === kind && (op === undefined || h.op === op) && (h.assoc || null) === assoc);
  }
  withControl(entity, row, values) {
    return this.tagged(entity, { ...row, ...values, '%control': Object.fromEntries(Object.keys(values).map(f => [f, '01'])) });
  }
  umLock(bo, entity, keys, resp) {
    const root = [...bo.entities.entries()].find(([, b]) => b.root)?.[0] || entity;
    const hs = this.umHandlers(bo, root, 'lock');
    if (!hs.length) return true;
    const rootKeys = entity === root ? keys : keys.map(k => this.rootKeyOf(bo, entity, k)).filter(Boolean);
    let ok = true;
    for (const h of hs) {
      const r = this.callHandler(bo, h, rootKeys.map(k => this.tagged(root, { ...k })));
      this.mergeResp(resp, r);
      if (Object.values(r.failed || {}).some(x => x?.length)) ok = false;
    }
    return ok;
  }
  rootKeyOf(bo, entity, key) {
    let e = entity, data = this.umInstance(bo, entity, key)?.data;
    while (data && !this.ent(e).behavior.root) {
      const up = [...this.ent(e).assocs.values()].find(a => a.toParent);
      if (!up) return null;
      const pk = {}; for (const [s, t] of up.pairs) pk[t] = data[s];
      e = this.model.baseEntity(up.target);
      data = this.umInstance(bo, e, pk)?.data;
    }
    return data ? this.pickKey(e, data) : null;
  }
  // an instance as the application's read handler sees it (transactional buffer included); falls back to the database
  umInstance(bo, entity, key) {
    const hs = this.umHandlers(bo, entity, 'read', 'read');
    if (!hs.length) return this.get(entity, key);
    for (const h of hs) {
      const r = this.callHandler(bo, h, [this.tagged(entity, { ...key })]);
      const row = (r.result || [])[0];
      if (row) return { entity, key: this.pickKey(entity, row), data: row, isDraft: false, isNew: false, changed: new Set() };
    }
    return null;
  }
  umRead(bo, entity, part, resp) {
    const keys = (part.rows || []).map(r => this.tagged(entity, { ...this.keyOf(entity, r), '%control': r['%control'] }));
    const hs = this.umHandlers(bo, entity, 'read', 'read', part.assoc || null);
    if (!hs.length) throw this.rt.new('cx_sy_dyn_call_illegal_method', { text: `Unmanaged ${this.ent(entity).behavior.alias}: no FOR READ handler${part.assoc ? ` for ${part.assoc}` : ''}` });
    let result = [], links = [];
    for (const h of hs) {
      const extra = part.assoc ? { result_requested: 'X', full: 'X' } : {};
      const C = this.rt.cls(h.cls), obj = new C();
      const p = { failed: this.rt.resp(bo.name), reported: this.rt.resp(bo.name), [h.importing]: keys, ...extra };
      this.depth++;
      let out;
      try { out = obj[methodKey(h.method)](p) || {}; } finally { this.depth--; }
      this.mergeResp(resp, { failed: out.failed || p.failed, reported: out.reported || p.reported });
      if (Array.isArray(out[h.result])) result = result.concat(out[h.result]);
      const linkName = Object.keys(out).find(k => /link/i.test(k));
      if (linkName && Array.isArray(out[linkName])) links = links.concat(out[linkName]);
    }
    if (part.fields) result = result.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => k.startsWith('%') || part.fields.includes(k) || this.ent(this.rt.entityOf(r) || entity)?.keys.includes(k))));
    return { result: result.map(r => (this.rt.entityOf(r) ? r : this.tagged(part.assoc ? this.model.baseEntity(this.ent(entity).assocs.get(part.assoc).target) : entity, r))), links };
  }
  umModify(bo, entity, op, rows, resp, external) {
    const ent = this.ent(entity), beh = ent.behavior;
    const notEnabled = (what) => { for (const r of rows) this.fail(resp, entity, this.keyOf(entity, r), '02', `${what} is not enabled for ${beh.alias}`); };
    this.unmanagedTouched.add(bo);
    if (op.op === 'create') {
      if (external && !beh.ops.create) return notEnabled('Create');
      const ents = [];
      for (const r of rows) {
        const values = this.valuesFrom(entity, r, op.fields);
        if (external && !this.checkReadonly(bo, entity, values, resp, {}, true)) continue;
        ents.push(this.withControl(entity, { '%cid': r['%cid'] || (op.autoCid ? 'auto' + randomUUID() : '') }, values));
      }
      if (!ents.length) return;
      const hs = this.umHandlers(bo, entity, 'modify', 'create');
      if (!hs.length) throw this.rt.new('cx_sy_dyn_call_illegal_method', { text: `Unmanaged ${beh.alias}: no FOR MODIFY ... FOR CREATE handler` });
      for (const h of hs) this.mergeResp(resp, this.callHandler(bo, h, ents));
      return;
    }
    if (op.op === 'cba') {
      if (external && !beh.assocs[op.assoc]?.create) return notEnabled(`Create by association ${op.assoc}`);
      const target = this.model.baseEntity(ent.assocs.get(op.assoc).target);
      const ents = rows.map(r => this.tagged(entity, { ...this.keyOf(entity, r), '%target': (r['%target'] || []).map(t => this.withControl(target, { '%cid': t['%cid'] || (op.autoCid ? 'auto' + randomUUID() : '') }, this.valuesFrom(target, t, op.fields))) }));
      if (external && !this.umLock(bo, entity, ents.map(e => this.keyOf(entity, e)), resp)) return;
      const hs = this.umHandlers(bo, entity, 'modify', 'create', op.assoc);
      if (!hs.length) throw this.rt.new('cx_sy_dyn_call_illegal_method', { text: `Unmanaged ${beh.alias}: no handler FOR CREATE ${beh.alias}\\${op.assoc}` });
      for (const h of hs) this.mergeResp(resp, this.callHandler(bo, h, ents));
      return;
    }
    if (op.op === 'update' || op.op === 'delete') {
      if (external && !beh.ops[op.op]) return notEnabled(op.op === 'update' ? 'Update' : 'Delete');
      const ents = [];
      for (const r of rows) {
        const key = this.keyOf(entity, r);
        if (external) {
          const inst = this.umInstance(bo, entity, key);
          if (!inst) { this.fail(resp, entity, key, '01', `${beh.alias} not found`); continue; }
          if (!this.umLock(bo, entity, [key], resp)) continue;
          const e = this.checkInstance(bo, entity, inst, op.op);
          if (e) { this.fail(resp, entity, key, '06', e); continue; }
        }
        if (op.op === 'delete') { ents.push(this.tagged(entity, { ...key })); continue; }
        const values = this.valuesFrom(entity, r, op.fields);
        for (const k of ent.keys) delete values[k];
        if (external && !this.checkReadonly(bo, entity, values, resp, key, false)) continue;
        ents.push(this.withControl(entity, key, values));
      }
      if (!ents.length) return;
      const hs = this.umHandlers(bo, entity, 'modify', op.op);
      if (!hs.length) throw this.rt.new('cx_sy_dyn_call_illegal_method', { text: `Unmanaged ${beh.alias}: no FOR MODIFY ... FOR ${op.op.toUpperCase()} handler` });
      for (const h of hs) this.mergeResp(resp, this.callHandler(bo, h, ents));
    }
  }
  savers(bo) { return (bo.savers || []).map(s => { const C = this.rt.cls(s); return new C(); }); }
  // finalize and check_before_save of unmanaged BOs; false if the application reports failures
  umCheck() {
    for (const bo of this.unmanagedTouched) {
      for (const phase of ['finalize', 'check_before_save']) {
        for (const sv of this.savers(bo)) {
          const p = { failed: this.rt.resp(bo.name), reported: this.rt.resp(bo.name) };
          const out = sv[phase](p) || {};
          this.mergeResp(this, { failed: out.failed || p.failed, reported: out.reported || p.reported });
        }
        if (Object.values(this.failed).some(r => r.length)) {
          for (const sv of this.savers(bo)) sv.cleanup_finalize({});
          return false;
        }
      }
    }
    return true;
  }
  umSave() {
    for (const bo of this.unmanagedTouched) {
      for (const sv of this.savers(bo)) { const p = { reported: this.rt.resp(bo.name) }; const out = sv.save(p) || {}; this.mergeResp(this, { reported: out.reported || p.reported }); }
    }
  }
  cleanupUnmanaged() {
    for (const bo of this.unmanagedTouched) for (const sv of this.savers(bo)) { try { sv.cleanup({}); } catch {} }
    this.unmanagedTouched.clear();
  }

  // ------------------------------------------------------------------ determinations & validations
  runModifyDeterminations() {
    for (let round = 0; round < 25; round++) {
      const events = this.events.splice(0);
      if (!events.length) return;
      const work = [];
      for (const bo of this.model.bos.values()) {
        if (bo.projection) continue;
        for (const [entity, beh] of bo.entities) {
          for (const d of beh.determinations.filter(d => d.when === 'modify')) {
            const keys = new Map();
            for (const e of events) {
              if (e.entity !== entity || e.source === d.name) continue;
              if (!triggers(d, e)) continue;
              if (e.kind !== 'delete' && e.inst.deleted) continue;
              keys.set(e.ks, this.tagged(entity, { ...e.inst.key }));
            }
            if (keys.size) work.push({ bo, entity, d, keys: [...keys.values()] });
          }
        }
      }
      for (const w of work) {
        for (const h of this.handlers(w.bo, w.entity, 'determination_modify', w.d.name)) {
          this.source = w.d.name;
          try { this.mergeResp(this, this.callHandler(w.bo, h, w.keys)); }
          finally { this.source = null; }
        }
      }
    }
    throw new RapError(500, 'Determinations did not converge after 25 rounds (endless loop?)');
  }

  // instances that changed in this transaction, per entity
  changedInstances() {
    const out = [];
    for (const [entity, buf] of this.buffer) for (const inst of buf.values()) if (inst.isNew || inst.deleted || inst.changed.size) out.push({ entity, inst });
    return out;
  }

  // ------------------------------------------------------------------ save sequence
  save() {
    this.runModifyDeterminations();
    const changed = this.changedInstances();
    const boOfEntity = e => this.model.entityBo.get(e);
    // determinations on save
    for (const bo of this.model.bos.values()) {
      if (bo.projection) continue;
      for (const [entity, beh] of bo.entities) {
        for (const d of beh.determinations.filter(d => d.when === 'save')) {
          const keys = changed.filter(c => c.entity === entity && !c.inst.deleted && !c.inst.isDraft && matchesCumulative(d, c.inst)).map(c => this.tagged(entity, { ...c.inst.key }));
          if (!keys.length) continue;
          for (const h of this.handlers(bo, entity, 'determination_save', d.name)) this.mergeResp(this, this.callHandler(bo, h, keys));
        }
      }
    }
    this.runModifyDeterminations();
    // validations
    for (const bo of this.model.bos.values()) {
      if (bo.projection) continue;
      for (const [entity, beh] of bo.entities) {
        for (const v of beh.validations) {
          const keys = this.changedInstances().filter(c => c.entity === entity && !c.inst.deleted && !c.inst.isDraft && matchesCumulative(v, c.inst)).map(c => this.tagged(entity, { ...c.inst.key }));
          if (!keys.length) continue;
          for (const h of this.handlers(bo, entity, 'validation', v.name)) this.mergeResp(this, this.callHandler(bo, h, keys));
        }
      }
    }
    // static mandatory fields
    for (const { entity, inst } of this.changedInstances()) {
      if (inst.deleted || inst.isDraft) continue;
      const beh = this.ent(entity).behavior;
      for (const [f, fb] of Object.entries(beh.fields)) {
        if ((fb.mandatory || (fb.mandatoryCreate && inst.isNew)) && this.rt.initial(inst.data[f])) {
          this.fail(this, entity, inst.key, '02', `${this.label(entity, f)} is mandatory`, f);
        }
      }
    }
    if (Object.values(this.failed).some(r => r.length)) return false;
    if (!this.umCheck()) return false;
    if (!this.adjustNumbers()) return false;
    this.write(boOfEntity);
    this.saved = true;
    this.cleanupUnmanaged();
    return true;
  }

  // key fields an entity numbers itself (not copied from the parent through "association to parent")
  ownKeyFields(entity) {
    const ent = this.ent(entity);
    const fromParent = new Set([...ent.assocs.values()].filter(a => a.toParent).flatMap(a => a.pairs.map(([s]) => s)));
    return ent.keys.filter(k => !fromParent.has(k));
  }

  // late numbering: the saver's adjust_numbers receives "mapped" with %pid / %tmp and fills in the final keys
  adjustNumbers() {
    for (const bo of this.model.bos.values()) {
      if (bo.projection) continue;
      const late = [...bo.entities.entries()].filter(([, b]) => b.lateNumbering).map(([e]) => e);
      if (!late.length) continue;
      const mapped = this.rt.resp(bo.name);
      const pending = [];
      for (const entity of late) {
        for (const inst of this.bufferOf(entity).values()) {
          if (!inst.isNew || inst.deleted || inst.isDraft || !inst.pid) continue;
          const own = this.ownKeyFields(entity);
          const row = this.tagged(entity, { '%pid': inst.pid, '%tmp': { ...pick(inst.data, this.ent(entity).keys) } });
          for (const k of this.ent(entity).keys) row[k] = own.includes(k) ? initialValue(this.ent(entity).fields.find(f => f.name === k).ti) : inst.data[k];
          mapped[this.alias(entity)].push(row);
          pending.push({ entity, inst, row, own });
        }
      }
      if (!pending.length) continue;
      for (const sv of bo.savers) {
        const C = this.rt.cls(sv);
        const obj = new C();
        if (!this.model.classes.get(sv)?.methods.has('adjust_numbers')) continue;
        const out = obj.adjust_numbers({ mapped, reported: this.rt.resp(bo.name), failed: this.rt.resp(bo.name) }) || {};
        this.mergeResp(this, { failed: out.failed, reported: out.reported });
      }
      // apply final keys, parents first; children inherit parent key values through their foreign keys
      for (const p of pending) {
        const ent = this.ent(p.entity);
        const old = { ...p.inst.data };
        const updates = {};
        for (const k of p.own) {
          const v = p.row[k];
          if (this.rt.initial(v)) { this.fail(this, p.entity, p.inst.key, '02', `adjust_numbers did not assign ${k} of ${ent.behavior.alias}`); return false; }
          updates[k] = toDb(v, ent.fields.find(f => f.name === k).ti);
        }
        this.rekey(p.entity, p.inst, updates, old);
      }
    }
    return true;
  }
  rekey(entity, inst, updates, old) {
    const ent = this.ent(entity);
    const buf = this.bufferOf(entity);
    buf.delete(this.keyStr(entity, inst.key));
    Object.assign(inst.data, updates);
    inst.key = this.pickKey(entity, inst.data, inst.isDraft);
    buf.set(this.keyStr(entity, inst.key), inst);
    // propagate to composition children that still carry the preliminary parent key
    for (const a of ent.assocs.values()) {
      if (!a.composition) continue;
      const target = this.model.baseEntity(a.target);
      for (const child of [...this.bufferOf(target).values()]) {
        if (child.isDraft !== inst.isDraft) continue;
        if (!a.pairs.every(([s, t]) => this.rt.eq(child.data[t], old[s]))) continue;
        const cu = {};
        for (const [s, t] of a.pairs) cu[t] = inst.data[s];
        this.rekey(target, child, cu, { ...child.data });
      }
    }
  }

  write(boOfEntity) {
    const changed = this.changedInstances();
    const ts = this.rt.timestampl();
    const user = this.rt.sy.uname;
    const db = this.db;
    db.exec('SAVEPOINT rap_save');
    try {
      const saverData = new Map();
      for (const { entity, inst } of changed) {
        const ent = this.ent(entity);
        const bo = boOfEntity(entity);
        if (inst.isDraft) { this.writeDraft(ent, inst, ts, user); continue; }
        if (!inst.deleted) {
          for (const f of ent.fields) {
            const a = f.ann || {};
            if (inst.isNew && (annGet(a, ADMIN.createdBy) === true)) inst.data[f.name] = user;
            if (inst.isNew && (annGet(a, ADMIN.createdAt) === true)) inst.data[f.name] = ts;
            if (annGet(a, ADMIN.lastChangedBy) === true || annGet(a, ADMIN.localChangedBy) === true) inst.data[f.name] = user;
            if (annGet(a, ADMIN.lastChangedAt) === true || annGet(a, ADMIN.localChangedAt) === true) inst.data[f.name] = ts;
          }
        }
        const sd = saverData.get(bo) || { create: {}, update: {}, delete: {} };
        saverData.set(bo, sd);
        const alias = ent.behavior.aliasLower;
        if (inst.deleted && inst.isNew) continue;
        if (inst.deleted) (sd.delete[alias] ||= []).push(this.tagged(entity, { ...inst.key }));
        else if (inst.isNew) (sd.create[alias] ||= []).push(this.tagged(entity, { ...inst.data }));
        else (sd.update[alias] ||= []).push(this.tagged(entity, { ...inst.data, '%control': Object.fromEntries([...inst.changed].map(f => [f, '01'])) }));
        if (!ent.table || ent.behavior.unmanaged) continue;
        const table = this.model.tables.get(ent.table);
        const colTi = c => table.fields.find(f => f.name === c).ti;
        const mapped = Object.entries(ent.mapping);
        const keyCols = ent.keys.map(k => ent.mapping[k]);
        const keyVals = ent.keys.map(k => toDb(inst.data[k], colTi(ent.mapping[k])));
        if (inst.deleted) {
          db.prepare(`DELETE FROM "${table.name}" WHERE ${keyCols.map(c => `"${c}" = ?`).join(' AND ')}`).run(...keyVals);
        } else if (inst.isNew) {
          db.prepare(`INSERT INTO "${table.name}" (${mapped.map(([, c]) => `"${c}"`).join(', ')}) VALUES (${mapped.map(() => '?').join(', ')})`)
            .run(...mapped.map(([f, c]) => toDb(inst.data[f], colTi(c))));
        } else {
          const nonKey = mapped.filter(([f]) => !ent.keys.includes(f));
          if (nonKey.length) db.prepare(`UPDATE "${table.name}" SET ${nonKey.map(([, c]) => `"${c}" = ?`).join(', ')} WHERE ${keyCols.map(c => `"${c}" = ?`).join(' AND ')}`)
            .run(...nonKey.map(([f, c]) => toDb(inst.data[f], colTi(c))), ...keyVals);
        }
      }
      this.changeDocuments(changed, ts, user);
      this.inSave = true;
      this.umSave();
      // additional / unmanaged save in saver classes
      for (const [bo, sd] of saverData) {
        for (const s of bo?.savers || []) {
          const C = this.rt.cls(s);
          const obj = new C();
          if (typeof obj.save_modified === 'function') obj.save_modified({ create: wrap(sd.create, this.rt, bo), update: wrap(sd.update, this.rt, bo), delete: wrap(sd.delete, this.rt, bo), reported: this.rt.resp(bo.name), failed: this.rt.resp(bo.name) });
          if (typeof obj.save === 'function' && obj.save !== C.__proto__.prototype?.save) obj.save({});
        }
      }
      this.inSave = false;
      db.exec('RELEASE rap_save');
      this.rap.eventQueue.push(...this.raised.splice(0));
    } catch (e) {
      this.inSave = false;
      this.raised = [];
      try { db.exec('ROLLBACK TO rap_save'); db.exec('RELEASE rap_save'); } catch {}
      throw e;
    }
    this.buffer.clear();
    this.events = [];
  }

  // change documents: field-level history of entities with "changedocuments master ( object )" (and their
  // "changedocuments dependent by _Parent" children), written in the same database transaction
  changeDocuments(changed, ts, user) {
    const rows = [];
    const objectOf = entity => {
      let e = entity;
      for (let n = 0; n < 10; n++) {
        const b = this.ent(e).behavior;
        if (b.changeDocuments) return { cls: String(b.changeDocuments).toUpperCase(), entity: e };
        if (!b.changeDocumentsDependent) return null;
        const up = this.ent(e).assocs.get(b.changeDocumentsDependent) || [...this.ent(e).assocs.values()].find(a => a.toParent);
        if (!up) return null;
        e = this.model.baseEntity(up.target);
      }
      return null;
    };
    for (const { entity, inst } of changed) {
      if (inst.isDraft || (inst.deleted && inst.isNew)) continue;
      const obj = objectOf(entity);
      if (!obj) continue;
      const ent = this.ent(entity);
      const objectId = ent.keys.map(k => String(inst.data[k] ?? '').trim()).join('/');
      const fields = ent.fields.filter(f => !f.virtual && !ent.keys.includes(f.name));
      const ind = inst.deleted ? 'D' : inst.isNew ? 'I' : 'U';
      for (const f of fields) {
        const before = inst.isNew ? '' : inst.orig?.[f.name];
        const after = inst.deleted ? '' : inst.data[f.name];
        if (ind === 'U' && this.rt.eq(before, after)) continue;
        if (ind !== 'U' && this.rt.initial(ind === 'I' ? after : before)) continue;
        rows.push([randomUUID(), String(ts), obj.cls, objectId, entity, ind, f.name, String(before ?? ''), String(after ?? ''), user]);
      }
    }
    if (!rows.length) return;
    this.db.exec(`CREATE TABLE IF NOT EXISTS "rap_change_log" ("id" TEXT PRIMARY KEY, "changed_at" TEXT, "object_class" TEXT, "object_id" TEXT, "entity" TEXT, "change_ind" TEXT, "field" TEXT, "value_old" TEXT, "value_new" TEXT, "changed_by" TEXT)`);
    const st = this.db.prepare(`INSERT INTO "rap_change_log" ("id", "changed_at", "object_class", "object_id", "entity", "change_ind", "field", "value_old", "value_new", "changed_by") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of rows) st.run(...r);
  }

  writeDraft(ent, inst, ts, user) {
    const t = ent.draft.table;
    const keyCols = ent.keys;
    const keyVals = keyCols.map(k => toDb(inst.data[k], ent.fields.find(f => f.name === k).ti));
    if (inst.deleted) {
      if (!inst.isNew) this.db.prepare(`DELETE FROM "${t}" WHERE ${keyCols.map(k => `"${k}" = ?`).join(' AND ')}`).run(...keyVals);
      return;
    }
    const fields = ent.fields.filter(f => !f.virtual);
    const a = inst.admin || {};
    const cols = [...fields.map(f => f.name), 'draftuuid', 'hasactiveentity', 'draftentitycreationdatetime', 'draftentitylastchangedatetime', 'draftcreatedbyuser', 'draftlastchangedbyuser', 'draftentityoperationcode'];
    const vals = [...fields.map(f => toDb(inst.data[f.name], f.ti)), a.draftuuid || randomUUID().replace(/-/g, '').toUpperCase(), a.hasActive ? 'X' : '', a.created || ts, ts, a.createdBy || user, user, a.hasActive ? 'U' : 'C'];
    this.db.prepare(this.db.dialect.upsert(t, cols, keyCols)).run(...vals);
  }

  // framework implementation of draft actions (Edit, Activate, Discard, Resume, Prepare)
  draftAction(bo, entity, action, rows, resp, external) {
    const result = [];
    const asDraft = k => ({ ...k, '%is_draft': '01' });
    const asActive = k => ({ ...k, '%is_draft': '00' });
    const res = (inst) => {
      const row = this.tagged(entity, { ...inst.key, '%param': this.project(entity, inst.data, null, inst) });
      Object.defineProperty(row, '$inst', { value: inst, enumerable: false }); // follows late numbering at save
      result.push(row);
    };
    for (const r of rows) {
      const key = this.keyOf(entity, r);
      if (action === 'edit') {
        const active = this.get(entity, asActive(key));
        if (!active) { this.fail(resp, entity, key, '01', `${this.ent(entity).behavior.alias} not found`); continue; }
        if (external) { const e = this.checkInstance(bo, entity, active, 'update'); if (e) { this.fail(resp, entity, key, /locked/.test(e) ? '04' : '06', e); continue; } }
        const existing = this.getDraftAny(entity, asDraft(key));
        const preserve = r['%param']?.preservechanges;
        if (existing && this.collab(entity)) { res(existing); continue; }   // join the shared draft
        if (existing && existing.admin?.createdBy && existing.admin.createdBy !== this.user) {
          const fresh = Date.now() - tsToMs(existing.admin.changed) < lockMs();
          if (fresh) { this.fail(resp, entity, key, '04', `${this.ent(entity).behavior.alias} is locked by user ${existing.admin.createdBy}`); continue; }
          if (preserve === true || preserve === 'X') { this.fail(resp, entity, key, '07', `Unsaved changes by user ${existing.admin.createdBy} exist; editing discards them`); continue; }
          // the other user's lock expired: discard their draft and start a new one
          this.anyOwner = true;
          try { this.deleteInst(entity, existing); } finally { this.anyOwner = false; }
        } else if (existing) {
          if (preserve === true || preserve === 'X') { this.fail(resp, entity, key, '07', 'A draft with unsaved changes already exists for this object'); continue; }
          res(existing); // resume the existing draft of the same user
          continue;
        }
        res(this.copyToDraft(entity, active));
      } else if (action === 'activate') {
        const draft = this.get(entity, asDraft(key));
        if (!draft) { this.fail(resp, entity, key, '01', 'Draft not found'); continue; }
        // total etag: the active instance must not have changed since the draft was created from it
        const te = this.ent(entity).behavior.totalEtag;
        const active = te && draft.admin?.hasActive ? this.get(entity, asActive(key)) : null;
        if (active && !this.rt.eq(active.data[te], draft.data[te])) { this.fail(resp, entity, key, '07', `${this.ent(entity).behavior.alias} was changed by another user after this draft was created. Discard the draft and edit again.`); continue; }
        res(this.activateTree(entity, draft));
      } else if (action === 'discard') {
        const draft = this.get(entity, asDraft(key));
        if (!draft) { this.fail(resp, entity, key, '01', 'Draft not found'); continue; }
        this.deleteInst(entity, draft);
      } else if (action === 'resume') {
        const draft = this.get(entity, asDraft(key));
        if (!draft) { this.fail(resp, entity, key, '01', 'Draft not found'); continue; }
        res(draft);
      } else if (action === 'prepare') {
        const draft = this.get(entity, asDraft(key));
        if (!draft) { this.fail(resp, entity, key, '01', 'Draft not found'); continue; }
        this.prepare(bo, entity, draft, resp);
        res(draft);
      }
    }
    return result;
  }
  copyToDraft(entity, active) {
    const ent = this.ent(entity);
    const key = { ...active.key, '%is_draft': '01' };
    const inst = { entity, key, data: this.rt.clone(active.data), isNew: true, deleted: false, changed: new Set(), isDraft: true,
      admin: { draftuuid: randomUUID().replace(/-/g, '').toUpperCase(), hasActive: true, created: this.rt.timestampl(), createdBy: this.rt.sy.uname } };
    this.bufferOf(entity).set(this.keyStr(entity, key), inst);
    for (const a of ent.assocs.values()) {
      if (!a.composition) continue;
      for (const c of this.children(entity, active.data, a.name, false)) this.copyToDraft(c.target, c.inst);
    }
    return inst;
  }
  activateTree(entity, draft) {
    const ent = this.ent(entity);
    const akey = { ...draft.key, '%is_draft': '00' };
    let active = this.get(entity, akey);
    if (active) {
      for (const f of ent.fields) {
        if (ent.keys.includes(f.name) || f.virtual) continue;
        if (!this.rt.eq(active.data[f.name], draft.data[f.name])) { active.data[f.name] = this.rt.clone(draft.data[f.name]); active.changed.add(f.name); }
      }
    } else {
      active = { entity, key: akey, data: this.rt.clone(draft.data), isNew: true, deleted: false, changed: new Set(ent.fields.map(f => f.name)), created: true, isDraft: false };
      this.bufferOf(entity).set(this.keyStr(entity, akey), active);
      if (ent.behavior.lateNumbering) { active.pid = 'PID' + randomUUID().replace(/-/g, '').toUpperCase(); this.pids.set(active.pid, active); }
    }
    for (const a of ent.assocs.values()) {
      if (!a.composition) continue;
      const draftKids = this.children(entity, draft.data, a.name, true);
      const activeKids = active.isNew ? [] : this.children(entity, active.data, a.name, false);
      const keep = new Set();
      for (const c of draftKids) { const act = this.activateTree(c.target, c.inst); keep.add(this.keyStr(c.target, act.key)); }
      for (const c of activeKids) if (!keep.has(this.keyStr(c.target, c.inst.key))) this.deleteInst(c.target, c.inst);
    }
    draft.deleted = true;
    return active;
  }
  prepare(bo, entity, draft, resp) {
    // run the validations listed in "draft determine action Prepare" on the draft and its children
    const root = this.ent(entity).behavior;
    const tree = new Map();
    const collect = (e, inst) => {
      (tree.get(e) || tree.set(e, []).get(e)).push(this.tagged(e, { ...inst.key }));
      for (const a of this.ent(e).assocs.values()) if (a.composition) for (const c of this.children(e, inst.data, a.name, true)) collect(c.target, c.inst);
    };
    collect(entity, draft);
    for (const entry of root.prepare?.validations || []) {
      const [aliasOrName, name] = entry.includes('~') ? entry.split('~') : [root.aliasLower, entry];
      const target = bo.aliases.get(aliasOrName) || entity;
      const keys = tree.get(target) || [];
      if (!keys.length) continue;
      for (const h of this.handlers(bo, target, 'validation', name)) this.mergeResp(resp, this.callHandler(bo, h, keys));
    }
  }

  // dynamic EML: results are written into the tables the op rows reference (REF #( itab ) shares the table)
  dynamic(kind, opTab) {
    const fill = (target, rows) => {
      if (target && typeof target.set === 'function') return this.rt.setDeref(target, rows);
      if (Array.isArray(target)) { target.length = 0; target.push(...rows); }
    };
    opTab = (opTab || []).map(o => ({ ...o, instances: this.rt.deref(o.instances) }));
    const opOf = c => ({ C: 'create', U: 'update', D: 'delete', A: 'execute', B: 'cba', R: 'read', RB: 'rba' })[String(c).toUpperCase()] || String(c).toLowerCase();
    if (kind === 'read') {
      const parts = (opTab || []).map(o => ({ entity: String(o.entity_name).toLowerCase(), assoc: opOf(o.op) === 'rba' ? String(o.sub_name).toLowerCase() : null, fields: null, rows: o.instances || [] }));
      const r = this.read({ bo: null, parts });
      (opTab || []).forEach((o, i) => { fill(o.results, r.results[i] || []); fill(o.links, r.links[i] || []); });
      return r;
    }
    const ops = (opTab || []).map(o => {
      const op = opOf(o.op);
      return { entity: String(o.entity_name).toLowerCase(), op, assoc: op === 'cba' ? String(o.sub_name).toLowerCase() : null, action: op === 'execute' ? String(o.sub_name).toLowerCase() : null, fields: 'control', autoCid: false, rows: o.instances || [] };
    });
    const r = this.modify({ bo: null, ops });
    (opTab || []).forEach((o, i) => fill(o.results, r.results[i] || []));
    return r;
  }

  // RAISE ENTITY EVENT bo~event FROM rows: only allowed while saving
  raiseEvent(spec, rows) {
    const [name, event] = spec.split('~');
    const [, entity] = this.resolveEntity(null, name);
    const beh = this.ent(entity).behavior;
    if (!beh.events?.[event]) throw this.rt.new('cx_sy_dyn_call_illegal_method', { text: `Event ${event.toUpperCase()} is not defined for ${beh.alias}` });
    if (!this.inSave) throw this.rt.new('cx_sy_dyn_call_illegal_method', { text: 'RAISE ENTITY EVENT is only allowed in the save sequence (save / save_modified)' });
    this.raised.push({ entity, event, rows: this.rt.clone(rows || []), user: this.user });
  }

  commitFromEml() {
    const ok = this.save();
    const res = { failed: this.rt.resp(null), reported: this.rt.resp(null) };
    Object.assign(res.failed, this.failed);
    Object.assign(res.reported, this.reported);
    this.rap.tx = null;
    this.rap.flushEvents();
    this.rt.sy.subrc = ok ? 0 : 4;
    // background processes registered in this transaction run after a successful commit (bgPF)
    if (ok) this.rt.runBackground?.(); else this.rt.bgpfRollback?.();
    return res;
  }

  // messages for the OData layer
  collectMessages(...resps) {
    const out = [];
    const seen = new Set();
    for (const r of resps) {
      for (const [alias, rows] of Object.entries(r.reported || {})) {
        for (const row of rows || []) {
          const m = row['%msg'];
          if (!m) continue;
          const msg = normMessage(m, this.rt);
          const entity = this.rt.entityOf(row);
          const labelOf = f => (entity && this.ent(entity)?.fields.find(x => x.name === f)?.label) || f;
          const targets = Object.entries(row['%element'] || {}).filter(([, v]) => isOn(v)).map(([k]) => labelOf(k));
          const key = {};
          if (entity) for (const k of this.ent(entity)?.keys || []) key[k] = row[k];
          const id = JSON.stringify([alias, msg.text, targets, key]);
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({ ...msg, entity: alias, key, targets });
        }
      }
    }
    return out;
  }
}

function wrap(obj, rt, bo) { const r = rt.resp(bo?.name); Object.assign(r, obj); return r; }
function isOn(v) { return v === '01' || v === 'X' || v === true; }
function pick(o, keys) { const r = {}; for (const k of keys) r[k] = o[k]; return r; }
// preliminary key for late numbering (replaced in adjust_numbers)
function tempKey(ti) {
  if (['i', 'int8', 'p', 'f'].includes(ti.t)) return -(1 + Math.floor(Math.random() * 1e9));
  if (ti.t === 'uuid') return randomUUID().replace(/-/g, '').toUpperCase();
  const len = Math.max(2, Math.min(ti.len || 12, 12));
  return '$' + Array.from({ length: len - 1 }, () => Math.floor(Math.random() * 10)).join('');
}
// exclusive draft lock duration (SAP default: 15 minutes); afterwards other users may take over the draft
export function lockMs() { return Number(process.env.RAP_DRAFT_LOCK_MINUTES ?? 15) * 60000; }
export function tsToMs(ts) {
  const s = String(Math.floor(Number(ts) || 0)).padEnd(14, '0');
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
}
function draftFlag(v) { return v === '01' || v === true || v === 'X' ? '01' : '00'; }
function triggers(d, e) {
  if (e.kind === 'create' && (d.create || d.fields.some(f => e.fields.has(f)))) return true;
  if (e.kind === 'update' && (d.update || d.fields.some(f => e.fields.has(f)))) return true;
  if (e.kind === 'delete' && d.delete) return true;
  return false;
}
function matchesCumulative(d, inst) {
  if (inst.isNew) return d.create || d.fields.some(f => inst.changed.has(f));
  return d.update || d.fields.some(f => inst.changed.has(f));
}
function normMessage(m, rt) {
  if (m && m.$message) return { severity: m.severity, text: m.text };
  if (m && typeof m === 'object') {
    let text = '';
    try { text = typeof m.get_text === 'function' ? m.get_text({}).$ret : String(m.text || m.message || ''); } catch { text = String(m.message || ''); }
    const sev = m.m_severity || m.severity || 'E';
    return { severity: typeof sev === 'string' ? sev : 'E', text };
  }
  return { severity: 'E', text: rt.s(m) };
}
export function normalizeRow(ent, row) {
  const out = {};
  for (const f of ent.fields) {
    const v = row[f.name];
    out[f.name] = v === null || v === undefined ? initialValue(f.ti) : v;
  }
  return out;
}

// =====================================================================================================
// ABAP SQL bridge ($rt.sql)
// SQL trace (like ST05): while rt.sqlTrace is on, every statement of ABAP SQL is timed and kept (the last 1000) with
// its parameters, the number of rows and the ABAP method that ran it
function traced(db, rt) {
  const log = (rt.sqlTraceLog ||= []);
  const rec = (kind, sql, args, fn) => {
    const t0 = performance.now();
    let rows = null, error = null, out;
    try { out = fn(); rows = Array.isArray(out) ? out.length : out && typeof out === 'object' && 'changes' in out ? Number(out.changes) : out ? 1 : 0; return out; }
    catch (e) { error = e.message; throw e; }
    finally {
      log.push({ at: Date.now(), ms: Math.round((performance.now() - t0) * 100) / 100, kind, sql: String(sql).slice(0, 2000), params: args.slice(0, 20).map(a => (a instanceof Uint8Array ? `(${a.length} bytes)` : a)), rows, error, abap: (rt.callStack || []).at(-1) || '' });
      if (log.length > 1000) log.splice(0, log.length - 1000);
    }
  };
  return {
    ...db, dialect: db.dialect, kind: db.kind,
    exec: sql => rec('exec', sql, [], () => db.exec(sql)),
    prepare: sql => { const st = db.prepare(sql); return { all: (...a) => rec('select', sql, a, () => st.all(...a)), get: (...a) => rec('select', sql, a, () => st.get(...a)), run: (...a) => rec('change', sql, a, () => st.run(...a)) }; },
  };
}

class SqlApi {
  constructor(rap) { this.rap = rap; }
  get db() { return this.rap.rt?.sqlTrace ? (this.$traced ||= traced(this.rap.db, this.rap.rt)) : this.rap.db; }
  get rt() { return this.rap.rt; }
  run(sql, params, ranges, fae) {
    let text = sql;
    const values = [];
    const fn = params.map(p => p);
    // expand range placeholders and collect positional parameters in order
    const parts = text.split(/(\?|__RANGE_\d+__[^_]*(?:_[^_]+)*?__)/);
    let pi = 0;
    let out = '';
    for (const part of parts) {
      if (part === '?') { values.push(sqlValue(fn[pi++](fae))); out += '?'; continue; }
      const m = /^__RANGE_(\d+)__(.*)__$/.exec(part || '');
      if (m) {
        const range = fn[pi++](fae) || [];
        const col = m[2];
        if (!range.length) { out += '1=1'; continue; }
        const incl = [], excl = [];
        for (const r of range) {
          const op = String(r.option || 'EQ').toUpperCase();
          const cmp = { EQ: '=', NE: '<>', GT: '>', GE: '>=', LT: '<', LE: '<=' }[op];
          let c;
          if (cmp) { c = `${col} ${cmp} ?`; values.push(sqlValue(r.low)); }
          else if (op === 'BT' || op === 'NB') { c = `${op === 'NB' ? 'NOT ' : ''}${col} BETWEEN ? AND ?`; values.push(sqlValue(r.low), sqlValue(r.high)); }
          else if (op === 'CP' || op === 'NP') { c = `${col} ${op === 'NP' ? 'NOT ' : ''}LIKE ?`; values.push(String(r.low).replace(/\*/g, '%').replace(/\+/g, '_')); }
          else continue;
          (String(r.sign || 'I').toUpperCase() === 'E' ? excl : incl).push(c);
        }
        out += `(${incl.length ? `(${incl.join(' OR ')})` : '1=1'}${excl.length ? ` AND NOT (${excl.join(' OR ')})` : ''})`;
        continue;
      }
      out += part;
    }
    return this.inlineParameterized(out, values);
  }
  // FROM view( p = @x ): views and table functions with parameters are inlined with the bound values
  inlineParameterized(text, values) {
    const m = this.rap.model;
    const re = /\b([a-z_]\w*)\(/gi;
    let out = '', last = 0, vi = 0, mm;
    const vals = [...values];
    while ((mm = re.exec(text))) {
      const ent = m.entities.get(mm[1].toLowerCase());
      if (!ent?.params?.length) continue;
      let d = 1, j = mm.index + mm[0].length;
      for (; j < text.length && d; j++) { if (text[j] === '(') d++; if (text[j] === ')') d--; }
      const inside = text.slice(mm.index + mm[0].length, j - 1);
      const before = text.slice(last, mm.index);
      vi += (before.match(/\?/g) || []).length;
      const bound = {};
      for (const part of inside.split(',')) {
        const [k, v] = part.split('=').map(x => x.trim());
        if (!k) continue;
        if (v === '?') { bound[k.toLowerCase()] = sqlLiteral(vals[vi]); vals.splice(vi, 1); }
        else bound[k.toLowerCase()] = v;
      }
      for (const p of ent.params) if (!(p.name in bound)) { const dv = m.paramDefault(p); if (dv === null) throw this.rt.new('cx_sy_open_sql_db', { text: `Parameter ${p.label} of ${ent.label} is not bound` }); bound[p.name] = dv; }
      const asAlias = /^\s+AS\s+\w+/i.test(text.slice(j));
      out += before + `(${m.entitySql(ent, bound)})${asAlias ? '' : ` AS ${mm[1]}`}`;
      last = j;
      re.lastIndex = j;
    }
    return { text: out + text.slice(last), values: vals };
  }
  // CDS access control in ABAP SQL: protected views are read through their access condition
  // (WITH PRIVILEGED ACCESS skips it)
  restrict(sql, privileged) {
    const m = this.rap.model;
    if (!m.grants?.size || privileged) return sql;
    return sql.replace(/\b(FROM|JOIN)\s+"?([a-z_][\w]*)"?(\s+AS\s+(\w+))?/gi, (all, kw, name, asPart, alias) => {
      const acl = m.accessSql(name.toLowerCase(), this.rt.auth ?? null, this.rt.sy.uname);
      return acl ? `${kw} (SELECT * FROM "${name.toLowerCase()}" WHERE ${acl}) AS ${alias || name}` : all;
    });
  }
  // path expressions \_assoc-field: joins along the CDS associations of the data source
  resolvePaths(sql, paths) {
    const m = this.rap.model;
    const from = /\bFROM\s+"?([a-z_][\w]*)"?(?:\s+AS\s+"?(\w+)"?)?/i.exec(sql.replace(/__PATH_\d+__/g, x => x));
    let mainEntity = from?.[1]?.toLowerCase(), mainAlias = from?.[2] || from?.[1];
    const joins = [], made = new Map();
    let n = 0;
    const walk = (entity, alias, steps, joinType, filter) => {
      let cur = entity, curAlias = alias;
      steps.forEach((step, i) => {
        const a = m.entities.get(cur)?.assocs.get(step);
        if (!a) throw this.rt.new('cx_sy_open_sql_db', { text: `Association ${step.toUpperCase()} not found in ${String(cur).toUpperCase()}` });
        const id = `${curAlias}\\${step}`;
        if (!made.has(id)) {
          const pa = `pth${++n}`;
          const extra = i === steps.length - 1 && filter ? ` AND (${filter.replace(/(^|[\s(])([a-z_]\w*)(?=\s*(=|<>|<|>|LIKE|IN|BETWEEN|IS))/gi, (x, pre, col) => `${pre}${pa}."${col.toLowerCase()}"`)})` : '';
          joins.push(`${i === steps.length - 1 && joinType ? joinType : 'LEFT OUTER JOIN'} "${a.target}" ${pa} ON ${a.pairs.map(([s, t]) => `${curAlias}."${s}" = ${pa}."${t}"`).join(' AND ') || '1=1'}${extra}`);
          made.set(id, pa);
        }
        curAlias = made.get(id);
        cur = a.target;
      });
      return curAlias;
    };
    // data source view\_assoc: rows of the association target reachable from the source
    sql = sql.replace(/__PATH_(\d+)__(\s+AS\s+"?(\w+)"?)?/g, (all, i, asPart, alias) => {
      const p = paths[+i];
      if (!p.head) return all;
      let cur = p.head; const conds = [];
      let srcSql = `"${p.head}" s0`, prev = 's0';
      p.steps.forEach((step, k) => {
        const a = m.entities.get(cur)?.assocs.get(step);
        if (!a) throw this.rt.new('cx_sy_open_sql_db', { text: `Association ${step.toUpperCase()} not found in ${cur.toUpperCase()}` });
        srcSql += ` JOIN "${a.target}" s${k + 1} ON ${a.pairs.map(([x, y]) => `${prev}."${x}" = s${k + 1}."${y}"`).join(' AND ')}`;
        prev = `s${k + 1}`; cur = a.target;
      });
      void conds;
      if (!mainEntity || mainEntity.startsWith('__path')) { mainEntity = cur; mainAlias = alias || cur; }
      return `(SELECT DISTINCT ${prev}.* FROM ${srcSql}) AS ${alias || cur}`;
    });
    // to-one paths to a field become correlated subqueries (no join, so unqualified columns stay unambiguous)
    const scalar = (p) => {
      let cur = mainEntity, prev = mainAlias, sub = null;
      const chain = [];
      for (const step of p.steps) {
        const a = m.entities.get(cur)?.assocs.get(step);
        if (!a || !(a.toParent || a.card?.max === 1 || a.card === null || a.card?.max === undefined) || p.join) return null;
        chain.push({ a, alias: `q${++n}` });
        cur = a.target;
      }
      for (let k = chain.length - 1; k >= 0; k--) {
        const { a, alias } = chain[k];
        const outer = k === 0 ? prev : chain[k - 1].alias;
        const on = a.pairs.map(([x, y]) => `${alias}."${y}" = ${outer}."${x}"`).join(' AND ');
        const sel = k === chain.length - 1 ? `${alias}."${p.field}"` : null;
        sub = sel ? `(SELECT ${sel} FROM "${a.target}" ${alias} WHERE ${on}${p.filter ? ` AND (${p.filter})` : ''} LIMIT 1)` : sub.replace(/^\(SELECT /, `(SELECT `).replace(/ WHERE /, ` , "${a.target}" ${alias} WHERE ${on} AND `);
      }
      return sub;
    };
    sql = sql.replace(/__PATH_(\d+)__/g, (all, i) => {
      const p = paths[+i];
      if (p.field && p.steps.length === 1) { const sub = scalar(p); if (sub) return sub; }
      const a = walk(mainEntity, mainAlias, p.steps, p.join, p.filter);
      return p.field ? `${a}."${p.field}"` : a;
    });
    if (joins.length) {
      const f = /\bFROM\s+(\([\s\S]*?\)\s+AS\s+\w+|"?[a-z_]\w*"?(?:\s+AS\s+"?\w+"?)?)/i.exec(sql);
      const at = f.index + f[0].length;
      sql = `${sql.slice(0, at)} ${joins.join(' ')}${sql.slice(at)}`;
    }
    return sql;
  }
  select(spec) {
    let rows;
    if (spec.paths) spec = { ...spec, sql: this.resolvePaths(spec.sql, spec.paths) };
    spec = { ...spec, sql: this.restrict(spec.sql, spec.privileged) };
    if (spec.dyn) spec = { ...spec, sql: spec.sql.replace(/__DYN_(\d+)__/g, (m, i) => dynamicSql(this.rt.s(spec.dyn[+i]), +i === 0 && /WHERE __DYN_0__/.test(spec.sql))) };
    try {
      if (spec.fae !== undefined) {
        if (!spec.fae.length) {
          const { text, values } = this.run(spec.sql.replace(/ WHERE .*?(?= GROUP BY | ORDER BY | LIMIT |$)/, ''), [], [], undefined);
          rows = this.db.prepare(text).all(...values);
        } else {
          const seen = new Set();
          rows = [];
          for (const entry of spec.fae) {
            const { text, values } = this.run(spec.sql, spec.params, spec.ranges, entry);
            for (const r of this.db.prepare(text).all(...values)) {
              const id = JSON.stringify(r);
              if (!seen.has(id)) { seen.add(id); rows.push(r); }
            }
          }
        }
      } else {
        const { text, values } = this.run(spec.sql, spec.params, spec.ranges);
        rows = this.db.prepare(text).all(...values);
      }
    } catch (e) {
      throw this.rt.new('cx_sy_open_sql_db', { text: `SQL error: ${e.message} [${spec.sql}]` });
    }
    const ind = spec.indicators;
    rows = rows.map(r => {
      const o = Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase().replace(/^.*\./, ''), v === null ? '' : v]));
      // INDICATORS NULL STRUCTURE s: 'X' for columns that are null (NOT NULL: 'X' for columns that are not)
      if (ind) o[ind.name] = Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase().replace(/^.*\./, ''), (v === null) !== ind.not ? 'X' : '']));
      return o;
    });
    this.rt.sy.dbcnt = rows.length;
    this.rt.sy.subrc = rows.length ? 0 : 4;
    return spec.single ? rows[0] : rows;
  }
  exec(sql, params) {
    const { text, values } = this.run(sql, params, []);
    const r = this.db.prepare(text).run(...values);
    this.rt.sy.dbcnt = Number(r.changes);
    this.rt.sy.subrc = r.changes ? 0 : 4;
  }
  table(name) {
    const t = this.rap.model.tables.get(name);
    if (!t) throw this.rt.new('cx_sy_open_sql_db', { text: `Database table ${name.toUpperCase()} does not exist` });
    return t;
  }
  insert(name, rows) {
    const t = this.table(name);
    const stmt = this.db.prepare(this.db.dialect.insertIgnore(t.name, t.columns.map(c => c.name)));
    let n = 0;
    for (const r of rows) n += Number(stmt.run(...t.columns.map(c => toDb(r[c.name], c.ti))).changes);
    this.rt.sy.dbcnt = n; this.rt.sy.subrc = n === rows.length ? 0 : 4;
  }
  modify(name, rows) {
    const t = this.table(name);
    const stmt = this.db.prepare(this.db.dialect.upsert(t.name, t.columns.map(c => c.name), t.keys));
    for (const r of rows) stmt.run(...t.columns.map(c => toDb(r[c.name], c.ti)));
    this.rt.sy.dbcnt = rows.length; this.rt.sy.subrc = 0;
  }
  update(name, rows) {
    const t = this.table(name);
    const nonKey = t.columns.filter(c => !t.keys.includes(c.name));
    const stmt = this.db.prepare(`UPDATE "${t.name}" SET ${nonKey.map(c => `"${c.name}" = ?`).join(', ')} WHERE ${t.keys.map(k => `"${k}" = ?`).join(' AND ')}`);
    let n = 0;
    for (const r of rows) n += Number(stmt.run(...nonKey.map(c => toDb(r[c.name], c.ti)), ...t.keys.map(k => toDb(r[k], t.columns.find(c => c.name === k).ti))).changes);
    this.rt.sy.dbcnt = n; this.rt.sy.subrc = n ? 0 : 4;
  }
  deleteRows(name, rows) {
    const t = this.table(name);
    const stmt = this.db.prepare(`DELETE FROM "${t.name}" WHERE ${t.keys.map(k => `"${k}" = ?`).join(' AND ')}`);
    let n = 0;
    for (const r of rows) n += Number(stmt.run(...t.keys.map(k => toDb(r[k], t.columns.find(c => c.name === k).ti))).changes);
    this.rt.sy.dbcnt = n; this.rt.sy.subrc = n ? 0 : 4;
  }
}
// ABAP SQL text from a dynamic clause: backquoted literals, comparison words; host variables are not allowed
function dynamicSql(text, isWhere) {
  const t = String(text || '').trim();
  if (!t) return isWhere ? '1=1' : '1';
  if (/@/.test(t.replace(/'[^']*'|`[^`]*`/g, ''))) throw new Error('Host variables (@) are not supported in dynamic SQL clauses');
  const CMP = { EQ: '=', NE: '<>', GT: '>', GE: '>=', LT: '<', LE: '<=' };
  return t.split(/('(?:[^']|'')*'|`(?:[^`]|``)*`)/).map((part, i) => {
    if (i % 2) return part[0] === '`' ? `'${part.slice(1, -1).replace(/``/g, '`').replace(/'/g, "''")}'` : part;
    return part.replace(/\b(EQ|NE|GT|GE|LT|LE)\b/gi, m => CMP[m.toUpperCase()]).replace(/\bASCENDING\b/gi, 'ASC').replace(/\bDESCENDING\b/gi, 'DESC')
      .replace(/\b([A-Za-z_]\w*)~([A-Za-z_]\w*)\b/g, '$1.$2');
  }).join('');
}
function sqlLiteral(v) { return typeof v === 'number' ? String(v) : `'${String(sqlValue(v)).replace(/'/g, "''")}'`; }
function sqlValue(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'X' : '';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}
