// OData V4 service layer on top of the CDS projection views (reads) and the RAP runtime (writes).
//   reads   : entity sets, keys, navigation (any depth), $filter $search $orderby $select $expand (nested options)
//             $top $skip $count, /$count, $apply (filter, groupby, aggregate) for analytical Fiori elements
//   writes  : create (incl. deep insert), update, delete, bound actions — always through the RAP transaction
//   draft   : IsActiveEntity keys, HasActiveEntity / HasDraftEntity, SiblingEntity, DraftAdministrativeData,
//             Edit / Activate / Prepare / Discard / Resume (SAP Fiori elements draft protocol)
//   $batch  : multipart/mixed (with atomic change sets and Content-ID references) and JSON batch
//   $metadata: EDMX with UI / Common / Capabilities / Aggregation / Analytics annotations
import { RapRuntime, RapError, normalizeRow, lockMs } from '../rap/rap.js';
import { edmType, toOData, fromOData } from '../rap/types.js';

const DRAFT_PROPS = { isactiveentity: 'IsActiveEntity', hasactiveentity: 'HasActiveEntity', hasdraftentity: 'HasDraftEntity' };
const DRAFT_COLS = { isactiveentity: '$isactive', hasactiveentity: '$hasactive', hasdraftentity: '$hasdraft' };
const SEVERITY = { E: 4, W: 3, I: 2, S: 1, '': 2 };

// the content of a large object: stored as upper-case hex (an ABAP xstring; OData uploads too); rows uploaded
// before that are base64
const lobBytes = v => { const t = String(v ?? ''); return /^(?:[0-9A-F]{2})+$/.test(t) ? Buffer.from(t, 'hex') : Buffer.from(t, 'base64'); };

export class ODataService {
  constructor(app) {
    this.app = app;
    this.model = app.model;
    // one RAP runtime per activated app: its EML hooks (rt.eml) are shared by OData, console runs and jobs
    this.rap = app.rap ??= new RapRuntime(app);
  }

  // ------------------------------------------------------------------ helpers
  get db() { return this.app.db; }
  service(name) {
    const s = this.model.services.get(String(name).toLowerCase());
    if (!s) throw new RapError(404, `Service ${name} not found`);
    return s;
  }
  set(srv, setName) {
    const e = srv.exposes.find(x => x.alias.toLowerCase() === String(setName).toLowerCase());
    if (!e) throw new RapError(404, `Entity set ${setName} not found in service ${srv.label}`);
    const ent = this.model.entities.get(e.entity);
    if (!ent || ent.broken) throw new RapError(500, `Entity ${e.entity} is not active`);
    return { name: e.alias, ent };
  }
  setOfEntity(srv, entityName) { return srv?.exposes.find(x => x.entity === entityName)?.alias || null; }
  field(ent, name) { return ent.fields.find(f => f.name === String(name).toLowerCase()); }
  isDraft(ent) { return !!ent.hasDraftView && this.model.isDraftEntity(ent.name); }
  num(f, v) { return this.ieee && v !== null && (f.ti.t === 'p' || f.ti.t === 'int8') ? String(v) : v; }

  // SQL source of an entity set: for draft-enabled entities a union of active rows and the current user's drafts.
  // Active rows carry lock information: $hasdraft (any user's draft), $mydraft, $lockowner, $lockfresh.
  source(ent) {
    const src = this.rawSource(ent);
    const acl = this.model.accessSql(ent.name, this.app.rt.auth ?? null, this.user);
    return acl ? `(SELECT * FROM ${src} acl WHERE ${acl})` : src;
  }
  rawSource(ent) {
    if (ent.params?.length) {
      // view / table function with parameters: values from the request (Set(P=..)/Set or ?P=..), else defaults
      const vals = {};
      for (const p of ent.params) {
        const given = this.paramValues?.[p.name];
        if (given !== undefined) vals[p.name] = typeof given === 'number' ? String(given) : `'${String(given).replace(/'/g, "''")}'`;
        else if (this.model.paramDefault(p) !== null) vals[p.name] = this.model.paramDefault(p);
        else throw new RapError(400, `${ent.label} needs parameter ${p.label}: ${ent.label}(${p.label}=...)/Set`);
      }
      return `(${this.model.entitySql(ent, vals)})`;
    }
    if (!this.isDraft(ent)) return `"${ent.name}"`;
    // collaborative draft: the draft is shared, so every user sees it ("my draft" = any draft)
    const collab = !!this.model.entityBo.get(this.model.baseEntity(ent.name))?.collaborative;
    const me = collab ? `"$draftcreatedbyuser"` : sqlStr(this.user);
    const cols = ent.fields.map(f => `"${f.name}"`).join(', ');
    const keyEq = ent.keys.map(k => `d."${k}" = a."${k}"`).join(' AND ');
    const draftOf = (cond) => `(SELECT ${cond} FROM "${ent.name}$d" d WHERE ${keyEq})`;
    const threshold = msToTs(Date.now() - lockMs());
    return `(SELECT ${ent.fields.map(f => `a."${f.name}"`).join(', ')}, 1 AS "$isactive", 0 AS "$hasactive",
        CASE WHEN EXISTS ${draftOf('1')} THEN 1 ELSE 0 END AS "$hasdraft",
        CASE WHEN EXISTS (SELECT 1 FROM "${ent.name}$d" d WHERE ${keyEq} AND d."$draftcreatedbyuser" = ${me}) THEN 1 ELSE 0 END AS "$mydraft",
        ${draftOf('MAX(d."$draftcreatedbyuser")')} AS "$lockowner",
        CASE WHEN EXISTS (SELECT 1 FROM "${ent.name}$d" d WHERE ${keyEq} AND d."$draftentitylastchangedatetime" >= ${threshold}) THEN 1 ELSE 0 END AS "$lockfresh",
        NULL AS "$draftuuid", NULL AS "$draftcreated", NULL AS "$draftchanged", NULL AS "$draftuser"
      FROM "${ent.name}" a
      UNION ALL
      SELECT ${cols}, 0, CASE WHEN "$hasactiveentity" = 'X' THEN 1 ELSE 0 END, 0, 1, "$draftcreatedbyuser", 1,
        "$draftuuid", "$draftentitycreationdatetime", "$draftentitylastchangedatetime", "$draftcreatedbyuser"
      FROM "${ent.name}$d" WHERE "$draftcreatedbyuser" = ${me})`;
  }
  // DraftAdministrativeData/InProcessByUser as SQL: own drafts, or the user holding a valid lock on an active instance
  inProcessSql() {
    const me = sqlStr(this.user);
    return `(CASE WHEN "$isactive" = 0 THEN ${me} WHEN "$hasdraft" = 1 AND "$lockfresh" = 1 AND "$lockowner" <> ${me} THEN "$lockowner" ELSE '' END)`;
  }

  // optimistic locking: "etag master <field>" of the base entity, as the projection's field name
  etagField(ent) {
    const base = this.model.entities.get(this.model.baseEntity(ent.name));
    const f = base?.behavior?.etag;
    return f ? this.model.projField(ent.name, f) : null;
  }
  etagOf(ent, row) {
    const f = this.etagField(ent);
    if (!f) return null;
    // drafts change with every edit; their etag is the draft's last change
    const v = row.$isactive === 0 ? (row.$draftchanged ?? row[f]) : row[f];
    return `W/"${String(v ?? '').replace(/"/g, '')}"`;
  }
  // If-Match on changes of active instances: 412 when someone else changed the object since it was read
  checkEtag(ent, key) {
    const want = this.ifMatch;
    if (!want || want === '*' || !this.etagField(ent) || key.$active === false) return;
    const row = this.readOne(ent, key);
    if (!row) return;
    const have = this.etagOf(ent, row);
    if (!want.split(',').map(x => x.trim()).includes(have)) throw new RapError(412, `${ent.label} was changed by another user in the meantime. Refresh and try again.`);
  }

  // attachments: @Semantics.largeObject elements are Edm.Stream properties (content stored as upper-case hex, like an
  // ABAP xstring; rows uploaded before are base64)
  streamOf(f) { const lo = f?.ann?.semantics?.largeobject; return lo && typeof lo === 'object' ? lo : null; }
  streamFields(ent, f) {
    const lo = this.streamOf(f);
    const find = n => (n ? this.field(ent, String(n).replace(/^'|'$/g, '')) : null);
    return { mime: find(lo.mimetype), file: find(lo.filename), disposition: String(lo.contentdispositionpreference || '#ATTACHMENT').replace('#', '').toLowerCase(), accept: [].concat(lo.acceptablemimetypes || []).map(String) };
  }
  toJson(ent, row, select, extra) {
    const o = {};
    const etag = this.etagOf(ent, row);
    if (etag) o['@odata.etag'] = etag;
    for (const f of ent.fields) {
      if (select && !select.includes(f.name)) continue;
      if (this.streamOf(f)) {
        const sf = this.streamFields(ent, f);
        const set = this.srv ? this.setOfEntity(this.srv, ent.name) : null;
        if (row[f.name]) {
          if (set) o[`${f.label}@odata.mediaReadLink`] = `${set}${this.keyPredicate(ent, row)}/${f.label}`;
          o[`${f.label}@odata.mediaContentType`] = sf.mime ? row[sf.mime.name] || 'application/octet-stream' : 'application/octet-stream';
        }
        continue;
      }
      o[f.label] = this.num(f, toOData(row[f.name], f.ti));
    }
    if (this.isDraft(ent)) {
      for (const [k, label] of Object.entries(DRAFT_PROPS)) if (!select || select.includes(k) || k === 'isactiveentity') o[label] = !!row[DRAFT_COLS[k]];
    }
    if (extra) Object.assign(o, extra);
    return o;
  }
  parseKey(ent, pred) {
    // (TravelUUID=a1b2...,IsActiveEntity=true) or (value)
    const key = {};
    const parts = splitTopComma(pred);
    if (parts.length === 1 && !/^[A-Za-z_][\w]*\s*=/.test(parts[0])) {
      if (ent.keys.length !== 1) throw new RapError(400, 'Key predicate needs all key fields');
      key[ent.keys[0]] = parseLiteral(parts[0], this.field(ent, ent.keys[0]).ti);
    } else {
      for (const p of parts) {
        const i = p.indexOf('=');
        const name = p.slice(0, i).trim();
        if (name.toLowerCase() === 'isactiveentity') { key.$active = p.slice(i + 1).trim() !== 'false'; continue; }
        const f = this.field(ent, name);
        if (!f) throw new RapError(400, `Unknown key field ${name}`);
        key[f.name] = parseLiteral(p.slice(i + 1).trim(), f.ti);
      }
    }
    for (const k of ent.keys) if (!(k in key)) throw new RapError(400, `Key field ${k} missing`);
    if (key.$active === undefined) key.$active = true;
    return key;
  }
  keyPredicate(ent, row) {
    const ks = ent.keys.map(k => { const f = this.field(ent, k); const v = toOData(row[k], f.ti); return `${f.label}=${typeof v === 'string' && f.ti.t !== 'uuid' ? `'${v.replace(/'/g, "''")}'` : v}`; });
    if (this.isDraft(ent)) ks.push(`IsActiveEntity=${row.$isactive === 0 || row.$isactive === false ? 'false' : 'true'}`);
    return `(${ks.join(',')})`;
  }
  readOne(ent, key) {
    if (ent.kind === 'custom') {
      const row = this.customRows(ent, { $top: '1' }, ent.keys.map(k => [k, key[k]])).rows[0];
      return row ? normalizeRow(ent, row) : null;
    }
    const where = ent.keys.map(k => `"${k}" = ?`);
    const params = ent.keys.map(k => key[k]);
    if (this.isDraft(ent)) { where.push('"$isactive" = ?'); params.push(key.$active === false ? 0 : 1); }
    const row = this.db.prepare(`SELECT * FROM ${this.source(ent)} WHERE ${where.join(' AND ')}`).get(...params);
    return row ? withDraftCols(normalizeRow(ent, row), row) : null;
  }

  // projection -> base mapping
  base(ent) {
    const baseName = this.model.baseEntity(ent.name);
    const base = this.model.entities.get(baseName);
    if (!base?.behavior) throw new RapError(405, `${ent.label} is read-only (no behavior definition)`);
    return base;
  }
  projBehavior(ent) {
    const pbo = this.model.entityBo.get(ent.name);
    return pbo?.projection ? pbo.entities.get(ent.name) : null;
  }
  toBaseValues(ent, body) {
    const out = {};
    for (const [k, v] of Object.entries(body || {})) {
      if (k.startsWith('@') || k.startsWith('_') || k.startsWith('__') || DRAFT_PROPS[k.toLowerCase()]) continue;
      if (v !== null && typeof v === 'object') continue; // navigation payload (deep insert) handled separately
      const f = this.field(ent, k);
      if (!f) throw new RapError(400, `Property ${k} does not exist in ${ent.label}`);
      const bf = this.model.baseField(ent.name, f.name);
      if (!bf) continue; // calculated fields are ignored on write (Fiori elements sends them back)
      out[bf] = fromOData(v, f.ti);
    }
    return out;
  }
  baseKey(ent, key) {
    const out = {};
    for (const k of ent.keys) out[this.model.baseField(ent.name, k) || k] = key[k];
    if (this.isDraft(ent)) out['%is_draft'] = key.$active === false ? '01' : '00';
    return out;
  }
  projKey(ent, baseKeyObj) {
    const out = {};
    for (const k of ent.keys) out[k] = baseKeyObj[this.model.baseField(ent.name, k) || k];
    out.$active = baseKeyObj['%is_draft'] !== '01';
    return out;
  }
  allowed(ent, op, assoc) {
    const pb = this.projBehavior(ent);
    if (!pb) return true;
    if (op === 'assoc') return !!pb.assocs[assoc]?.create;
    if (op === 'action') return !!pb.actions[assoc];
    return !!pb.ops[op];
  }

  // run a modification in a fresh RAP transaction, save, collect messages
  transact(fn, { tolerateFailed = false } = {}) {
    const tx = this.rap.begin();
    try {
      const resp = { failed: {}, reported: {}, mapped: {} };
      const result = fn(tx, resp);
      const failedNow = Object.values(resp.failed).some(r => r.length);
      let ok = !failedNow;
      if (ok || tolerateFailed) {
        tx.runModifyDeterminations();
        ok = tx.save() && ok;
      }
      const messages = tx.collectMessages(resp, tx);
      if (!ok && !tolerateFailed) {
        const errs = messages.filter(m => m.severity === 'E');
        const main = errs[0] || messages[0] || { text: 'The request was rejected by the business object' };
        const conflict = Object.values(resp.failed).some(rows => rows.some(r => ['04', '07'].includes(r['%fail']?.cause)));
        throw new RapError(conflict ? 409 : 400, main.text, (errs.length ? errs : messages));
      }
      return { result, messages, resp, ok };
    } finally { this.rap.end(); }
  }
  messagesHeader(messages, all = false) {
    const list = all ? messages : messages.filter(m => m.severity !== 'E');
    return list.length ? { 'sap-messages': JSON.stringify(list.map(m => ({ code: '', message: m.text, numericSeverity: SEVERITY[m.severity] ?? 2, severity: m.severity, target: m.targets?.[0] || '', transition: true }))) } : {};
  }

  // ------------------------------------------------------------------ request dispatch
  handle(method, url, body, headers = {}) {
    // UI5 sends IEEE754Compatible=true and then expects Edm.Decimal / Edm.Int64 values as strings
    this.ieee = /IEEE754Compatible=true/i.test(headers.accept || '') || /IEEE754Compatible=true/i.test(headers['content-type'] || '');
    this.user = userOf(headers);
    this.app.rt.sy.uname = this.user;
    this.app.rt.authStore = this.authStore || null;
    this.app.rt.auth = this.authStore ? this.authStore.authorizationsOf(this.user) : null;
    this.db.setSessionUser?.(this.user);
    this.ifMatch = headers['if-match'] || null;
    const u = new URL(url, 'http://x');
    const segs = splitPath(decodeURIComponent(u.pathname).replace(/^.*?\/odata\//, ''));
    const srv = this.service(segs.shift());
    this.srv = srv;
    const q = Object.fromEntries(u.searchParams);
    if (!segs.length) return { status: 200, body: { '@odata.context': '$metadata', value: srv.exposes.map(e => ({ name: e.alias, kind: 'EntitySet', url: e.alias })) } };
    if (segs[0] === '$metadata') return { status: 200, body: this.edmx(srv), headers: { 'Content-Type': 'application/xml; charset=utf-8' } };
    if (segs[0] === '$uimetadata') return { status: 200, body: this.uiMetadata(srv) };

    // resolve the resource path: Set | Set(key) | Set(key)/nav | Set(key)/nav(key)/... | .../$count | .../action
    const m = /^([^(]+)(?:\((.*)\))?$/.exec(segs[0]);
    const s0 = this.set(srv, m[1]);
    // parameters: Set(P_A=..,P_B=..)/Set (SAP convention) or query options named like the parameters
    this.paramValues = {};
    for (const p of s0.ent.params || []) { const k = Object.keys(q).find(x => x.toLowerCase() === p.name); if (k) this.paramValues[p.name] = parseLiteral(q[k], p.ti); }
    let pred = m[2];
    if (pred !== undefined && s0.ent.params?.length && splitTopComma(pred).every(x => s0.ent.params.some(p => p.name === x.split('=')[0].trim().toLowerCase()))) {
      for (const x of splitTopComma(pred)) { const i = x.indexOf('='); const p = s0.ent.params.find(z => z.name === x.slice(0, i).trim().toLowerCase()); this.paramValues[p.name] = parseLiteral(x.slice(i + 1).trim(), p.ti); }
      pred = undefined;
      if (segs[1]?.toLowerCase() === 'set') segs.splice(1, 1);
    }
    let cur = pred === undefined ? { kind: 'set', ent: s0.ent, setName: s0.name } : { kind: 'entity', ent: s0.ent, key: this.parseKey(s0.ent, pred), setName: s0.name };
    for (let i = 1; i < segs.length; i++) {
      const seg = segs[i];
      const last = i === segs.length - 1;
      if (seg === '$count') return { status: 200, body: String(this.query(srv, cur.ent, { ...q, $count: 'true', $top: '0' }, cur.filter || null)['@odata.count']), headers: { 'Content-Type': 'text/plain' } };
      if (cur.kind !== 'entity') throw new RapError(400, `Unexpected segment ${seg}`);
      if (seg === '$features') return { status: 200, body: this.features(cur.ent, cur.key) };
      const nm = /^([^(]+)(?:\((.*)\))?$/.exec(seg);
      const navName = nm[1].toLowerCase();
      const streamField = last && this.streamOf(this.field(cur.ent, navName)) ? this.field(cur.ent, navName) : null;
      if (streamField) return this.stream(cur.ent, cur.key, streamField, method, body, headers);
      if (navName === 'draftadministrativedata' || navName === 'siblingentity') {
        const row = this.readOne(cur.ent, cur.key);
        if (!row) throw new RapError(404, `${cur.ent.label} not found`);
        const v = navName === 'siblingentity' ? this.sibling(cur.ent, row) : this.draftAdmin(cur.ent, row);
        if (!v) throw new RapError(404, 'No sibling / draft administrative data');
        return { status: 200, body: v };
      }
      const assoc = cur.ent.assocs.get(navName);
      if (assoc) {
        const row = this.readOne(cur.ent, cur.key);
        if (!row) throw new RapError(404, `${cur.ent.label} not found`);
        const target = this.model.entities.get(assoc.target);
        const filter = this.navFilter(cur.ent, row, assoc, target);
        if (nm[2] !== undefined) { cur = { kind: 'entity', ent: target, key: this.parseKey(target, nm[2]), setName: this.setOfEntity(srv, target.name) }; continue; }
        if (last && (method === 'POST')) return this.createByAssoc(srv, cur.ent, cur.key, assoc, body);
        const toOne = assoc.toParent || assoc.card?.max === 1;
        if (toOne) {
          const res = this.query(srv, target, { ...q, $top: '1' }, filter).value[0];
          if (!res) throw new RapError(404, 'Not found');
          cur = { kind: 'entity', ent: target, key: this.parseKey(target, this.keyPredicate(target, this.rowFromJson(target, res)).slice(1, -1)), setName: this.setOfEntity(srv, target.name) };
          if (last) return { status: 200, body: { '@odata.context': `$metadata#${cur.setName}/$entity`, ...res } };
          continue;
        }
        cur = { kind: 'set', ent: target, filter, setName: this.setOfEntity(srv, target.name) };
        if (last) return { status: 200, body: { '@odata.context': `$metadata#${cur.setName}`, ...this.query(srv, target, q, filter) } };
        continue;
      }
      // a property of the entity: Set(key)/Property (and /$value: the raw value), e.g. the title of a parent
      // (SAP Fiori elements: the breadcrumb of a child object page)
      const prop = method === 'GET' && nm[2] === undefined ? this.field(cur.ent, navName) : null;
      if (prop && (last || (i === segs.length - 2 && segs[i + 1] === '$value'))) {
        const row = this.readOne(cur.ent, cur.key);
        if (!row) throw new RapError(404, `${cur.ent.label} not found`);
        const value = this.toJson(cur.ent, row, [prop.name])[prop.label];
        if (!last) return { status: 200, body: value === null || value === undefined ? '' : String(value), headers: { 'Content-Type': 'text/plain' } };
        return { status: 200, body: { '@odata.context': `$metadata#${cur.setName}(${this.keyPredicate(cur.ent, row).slice(1, -1)})/${prop.label}`, value: value ?? null } };
      }
      // a media read link resolved against the entity's request path (UI5: Book(…)/Loan(…)/ReceiptPdf): the
      // entity set by its own name and key
      const other = nm[2] !== undefined && srv.exposes?.some(e => e.alias === nm[1]) ? (() => { try { return this.set(srv, nm[1]); } catch { return null; } })() : null;
      if (other) { cur = { kind: 'entity', ent: other.ent, key: this.parseKey(other.ent, nm[2]), setName: other.name }; continue; }
      // bound action, possibly namespace-qualified
      if (last && method === 'POST') return this.action(srv, cur.ent, cur.key, seg.split('.').pop().toLowerCase(), body);
      throw new RapError(404, `Unknown resource ${seg}`);
    }
    if (cur.kind === 'set') {
      if (method === 'GET') return { status: 200, body: { '@odata.context': `$metadata#${cur.setName}`, ...this.query(srv, cur.ent, q, cur.filter || null) } };
      if (method === 'POST') return this.create(srv, cur.setName, cur.ent, body);
      throw new RapError(405, `${method} not allowed on a collection`);
    }
    if (method === 'GET') {
      const row = this.readOne(cur.ent, cur.key);
      if (!row) throw new RapError(404, `${cur.ent.label} not found`);
      const select = selectList(q.$select);
      const json = this.toJson(cur.ent, row, select ? [...new Set([...select, ...cur.ent.keys])] : null);
      if (wantsControl(q.$select)) Object.assign(json, this.controlProps(cur.ent, [row])[0]);
      if (q.$expand) this.expand(srv, cur.ent, [row], [json], q.$expand);
      const etag = this.etagOf(cur.ent, row);
      return { status: 200, body: { '@odata.context': `$metadata#${cur.setName}/$entity`, ...json }, ...(etag ? { headers: { ETag: etag } } : {}) };
    }
    if (method === 'PATCH' || method === 'PUT') return this.update(srv, cur.ent, cur.key, body);
    if (method === 'DELETE') return this.remove(cur.ent, cur.key);
    throw new RapError(405, `${method} not allowed on an entity`);
  }

  // GET / PUT / DELETE of an attachment: Set(key)/Attachment
  stream(ent, key, f, method, body, headers) {
    const sf = this.streamFields(ent, f);
    if (method === 'GET') {
      const row = this.readOne(ent, key);
      if (!row) throw new RapError(404, `${ent.label} not found`);
      if (!row[f.name]) return { status: 204, body: null };
      const name = sf.file ? String(row[sf.file.name] || '') : '';
      return { status: 200, body: lobBytes(row[f.name]), headers: { 'Content-Type': (sf.mime && row[sf.mime.name]) || 'application/octet-stream', ...(name ? { 'Content-Disposition': `${sf.disposition === 'inline' ? 'inline' : 'attachment'}; filename="${name.replace(/"/g, '')}"` } : {}) } };
    }
    if (method !== 'PUT' && method !== 'DELETE') throw new RapError(405, `${method} not allowed on ${f.label}`);
    const base = this.base(ent);
    const raw = method === 'DELETE' ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body ?? ''));
    const mimeType = String(headers['content-type'] || 'application/octet-stream').split(';')[0];
    if (method === 'PUT' && sf.accept.length && !sf.accept.some(a => a === mimeType || (a.endsWith('/*') && mimeType.startsWith(a.slice(0, -1))))) throw new RapError(415, `${f.label}: ${mimeType} is not accepted (${sf.accept.join(', ')})`);
    const fileName = decodeURIComponent(String(headers.slug || /filename="?([^";]+)"?/.exec(headers['content-disposition'] || '')?.[1] || ''));
    // stored like an ABAP xstring (upper-case hex): ABAP code reading the field gets the bytes (older rows: base64)
    const values = { [this.model.baseField(ent.name, f.name)]: raw.length ? raw.toString('hex').toUpperCase() : '' };
    if (sf.mime) values[this.model.baseField(ent.name, sf.mime.name)] = raw.length ? mimeType : '';
    if (sf.file && (fileName || !raw.length)) values[this.model.baseField(ent.name, sf.file.name)] = fileName;
    this.checkEtag(ent, key);
    const { messages } = this.transact((tx, resp) => tx.update(tx.boOf(base.name), base.name, [{ ...this.baseKey(ent, key), ...values }], Object.keys(values), resp, true));
    return { status: 204, headers: this.messagesHeader(messages), body: null };
  }

  // full entity representation for write responses (incl. instance feature control)
  full(ent, row) { return Object.assign(this.toJson(ent, row), this.controlProps(ent, [row])[0]); }

  rowFromJson(ent, json) {
    const r = {};
    for (const f of ent.fields) r[f.name] = fromOData(json[f.label], f.ti);
    if (this.isDraft(ent)) r.$isactive = json.IsActiveEntity === false ? 0 : 1;
    return r;
  }
  // filter for navigation from a parent row; drafts navigate to drafts, actives to actives
  navFilter(ent, row, assoc, target) {
    const filter = assoc.pairs.map(([s, t]) => [t, row[s]]);
    if (this.isDraft(target)) filter.push(['$isactive', row.$isactive === 0 ? 0 : 1]);
    return filter;
  }

  // ------------------------------------------------------------------ queries
  query(srv, ent, q, fixedFilter) {
    if (ent.kind === 'custom') return this.customQuery(srv, ent, q, fixedFilter);
    if (q.$apply && /Hierarchy\.v1\.TopLevels|^\s*(descendants|ancestors)\(/.test(q.$apply)) return this.hierarchyQuery(srv, ent, q, fixedFilter);
    const params = [];
    const where = [];
    for (const [col, v] of fixedFilter || []) { where.push(`"${col}" = ?`); params.push(v); }
    // with $apply, $filter applies to the result of the transformations (OData V4); a condition (of a top-level
    // "and") on a property the result no longer has, e.g. IsActiveEntity after a groupby, restricts the rows first
    let postFilter = null;
    if (q.$filter && q.$apply) {
      const outCols = this.applyColumns(ent, q.$apply);
      const post = [], pre = [];
      for (const c of splitTopAnd(q.$filter)) {
        let onResult = true;
        try { new FilterParser(c, ent, this, outCols).parse(); } catch (e) { if (e.status === 400 && /^Unknown property/.test(e.message)) onResult = false; else throw e; }
        (onResult ? post : pre).push(c);
      }
      if (pre.length) { const f = new FilterParser(pre.map(c => `(${c})`).join(' and '), ent, this).parse(); where.push(f.sql); params.push(...f.params); }
      if (post.length) postFilter = post.map(c => `(${c})`).join(' and ');
    } else if (q.$filter) {
      const f = new FilterParser(q.$filter, ent, this).parse();
      where.push(f.sql); params.push(...f.params);
    }
    if (q.$search) {
      const terms = String(q.$search).replace(/^"|"$/g, '').trim();
      if (terms) {
        let fields = ent.fields.filter(f => f.ann?.search?.defaultsearchelement);
        if (!fields.length) fields = ent.fields.filter(f => ['c', 'string', 'n'].includes(f.ti.t));
        where.push(`(${fields.map(f => `"${f.name}" LIKE ?`).join(' OR ')})`);
        for (let i = 0; i < fields.length; i++) params.push(`%${terms}%`);
      }
    }
    let src = this.source(ent);
    const whereSql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    if (q.$apply) return this.apply(ent, { ...q, $filter: postFilter }, `${src}${whereSql}`, params);
    let order = '';
    if (q.$orderby) {
      order = ' ORDER BY ' + q.$orderby.split(',').map(p => {
        const [n, dir] = p.trim().split(/\s+/);
        const col = DRAFT_COLS[n.toLowerCase()] || this.field(ent, n)?.name;
        if (!col) throw new RapError(400, `Unknown property ${n} in $orderby`);
        return `"${col}" ${dir?.toLowerCase() === 'desc' ? 'DESC' : 'ASC'}`;
      }).join(', ');
    } else if (ent.keys.length) order = ' ORDER BY ' + ent.keys.map(k => `"${k}"`).join(', ');
    const top = q.$top !== undefined ? Math.max(0, Number(q.$top)) : 1000;
    const skip = q.$skip !== undefined ? Math.max(0, Number(q.$skip)) : 0;
    let rows;
    try { rows = this.db.prepare(`SELECT * FROM ${src}${whereSql}${order} LIMIT ? OFFSET ?`).all(...params, top, skip); }
    catch (e) { throw new RapError(500, `Query on ${ent.label} failed: ${e.message}`); }
    rows = rows.map(r => withDraftCols(normalizeRow(ent, r), r));
    const select = selectList(q.$select);
    const value = rows.map(r => this.toJson(ent, r, select ? [...new Set([...select, ...ent.keys])] : null));
    if (wantsControl(q.$select)) this.controlProps(ent, rows).forEach((c, i) => Object.assign(value[i], c));
    if (q.$expand) this.expand(srv, ent, rows, value, q.$expand);
    const out = { value };
    if (q.$count === 'true') out['@odata.count'] = this.db.prepare(`SELECT COUNT(*) AS n FROM ${src}${whereSql}`).get(...params).n;
    return out;
  }

  // ---------------------------------------------------------------- hierarchies (Fiori elements tree table)
  // An entity annotated @OData.hierarchy.recursiveHierarchy: [{ entity.name: 'ZI_X_Hier' }] answers the
  // hierarchy requests of the OData V4 model: TopLevels(...), descendants(...), ancestors(...)/TopLevels(...).
  hierarchyOf(ent) {
    const r = [].concat(ent.ann?.odata?.hierarchy?.recursivehierarchy || [])[0];
    const name = String(r?.entity?.name || r?.['entity.name'] || '').replace(/^'|'$/g, '').toLowerCase();
    const h = name && this.model.entities.get(name);
    if (!h?.def?.hierarchy || !ent.keys.length) return null;
    const node = ent.keys[0];
    const parentAssoc = [...ent.assocs.values()].find(a => a.name === h.def.hierarchy.assoc || a.baseAssoc === h.def.hierarchy.assoc);
    return { ent: h, qualifier: h.label, node, nodeLabel: this.field(ent, node).label, parentNav: parentAssoc?.label || null };
  }
  hierarchyQuery(srv, ent, q, fixedFilter) {
    const hier = this.hierarchyOf(ent);
    if (!hier) throw new RapError(400, `${ent.label} has no recursive hierarchy (@OData.hierarchy.recursiveHierarchy)`);
    const he = hier.ent;
    const nodeField = k => he.fields.find(f => f.expr?.k === 'path' && String(f.expr.path[0]).toLowerCase() === '$node' && String(f.expr.path[1]).toLowerCase() === k)?.name;
    const hkey = he.keys[0], pf = nodeField('parent_id'), rf = nodeField('hierarchy_rank');
    // structure from the hierarchy view; data (incl. access control) from the entity set itself
    const structure = this.db.prepare(`SELECT * FROM "${he.name}"`).all();
    const rows = this.query(srv, ent, { $top: '100000' }, fixedFilter).value;
    const byId = new Map(rows.map(r => [String(r[hier.nodeLabel]), r]));
    const nodes = new Map();
    for (const h of structure) {
      const id = String(h[hkey]);
      if (byId.has(id)) nodes.set(id, { id, parent: pf ? String(h[pf] ?? '') : '', rank: rf ? Number(h[rf]) : 0, children: [] });
    }
    for (const n of nodes.values()) if (n.parent && nodes.has(n.parent)) nodes.get(n.parent).children.push(n);
    for (const n of nodes.values()) n.children.sort((a, b) => a.rank - b.rank);
    let roots = [...nodes.values()].filter(n => !n.parent || !nodes.has(n.parent)).sort((a, b) => a.rank - b.rank);
    // filter(...)/search(...) arguments of ancestors / descendants -> matching node ids
    const ids = expr => {
      const sub = {};
      for (const part of splitTopSlash(expr || '')) {
        const m = /^(filter|search)\((.*)\)$/s.exec(part.trim());
        if (m?.[1] === 'filter') sub.$filter = sub.$filter ? `(${sub.$filter}) and (${m[2]})` : m[2];
        if (m?.[1] === 'search') sub.$search = m[2];
      }
      return new Set(this.query(srv, ent, { ...sub, $top: '100000' }, fixedFilter).value.map(r => String(r[hier.nodeLabel])));
    };
    const levelOf = n => { let l = 0, p = nodes.get(n.parent); while (p) { l++; p = nodes.get(p.parent); } return l; };
    let visible = [];
    for (const st of splitTopSlash(q.$apply).map(x => x.trim())) {
      let m;
      if ((m = /^ancestors\((.*)\)$/s.exec(st))) {
        const hit = ids(splitTopComma(m[1])[3]);
        const keep = new Set();
        for (const id of hit) { let n = nodes.get(id); while (n && !keep.has(n.id)) { keep.add(n.id); n = nodes.get(n.parent); } }
        for (const n of nodes.values()) n.children = n.children.filter(c => keep.has(c.id));
        roots = roots.filter(r => keep.has(r.id));
      } else if ((m = /^descendants\((.*)\)$/s.exec(st))) {
        const args = splitTopComma(m[1]);
        const depth = args[4] !== undefined && args[4].trim() !== '' ? Number(args[4]) : Infinity;
        visible = [];
        const walk = (n, d) => { for (const c of n.children) { visible.push({ node: c, level: levelOf(c), expanded: d + 1 < depth && c.children.length > 0 }); if (d + 1 < depth) walk(c, d + 1); } };
        for (const id of ids(args[3])) if (nodes.has(id)) walk(nodes.get(id), 0);
      } else if ((m = /TopLevels\((.*)\)$/s.exec(st))) {
        const parts = [];
        { let d = 0, q = false, cur = ''; for (const ch of m[1]) { if (ch === "'" || ch === '"') q = !q; if (!q && '([{'.includes(ch)) d++; if (!q && ')]}'.includes(ch)) d--; if (ch === ',' && !d && !q) { parts.push(cur); cur = ''; } else cur += ch; } parts.push(cur); }
        const params = Object.fromEntries(parts.map(x => { const i = x.indexOf('='); return [x.slice(0, i).trim(), x.slice(i + 1).trim()]; }));
        const levels = params.Levels !== undefined ? Number(params.Levels) : Infinity;
        const expand = new Map();
        if (params.ExpandLevels) for (const e of JSON.parse(params.ExpandLevels)) expand.set(String(e.NodeID), e.Levels === null ? Infinity : Number(e.Levels));
        visible = [];
        const walk = (n, level, budget) => {
          const own = expand.has(n.id) ? expand.get(n.id) : budget;
          const open = own > 0 && n.children.length > 0;
          visible.push({ node: n, level, expanded: open });
          if (open) for (const c of n.children) walk(c, level + 1, own - 1);
        };
        for (const r of roots) walk(r, 0, levels - 1);
      } else if (!/^(orderby|filter|search)\(/.test(st)) throw new RapError(400, `Unsupported hierarchy transformation ${st}`);
    }
    const int = v => this.num({ ti: { t: 'int8' } }, v);
    const out = visible.map((v, i) => {
      let count = 0;   // visible descendants directly following the node
      for (let k = i + 1; k < visible.length && visible[k].level > v.level; k++) count++;
      return { ...byId.get(v.node.id), DrillState: v.node.children.length === 0 ? 'leaf' : v.expanded ? 'expanded' : 'collapsed', DistanceFromRoot: int(v.level), LimitedDescendantCount: int(count), LimitedRank: int(i) };
    });
    const skip = Number(q.$skip || 0), top = q.$top !== undefined ? Number(q.$top) : out.length;
    let value = out.slice(skip, skip + top);
    const select = selectList(q.$select);
    if (select) {
      const keep = new Set([...ent.fields.filter(f => select.includes(f.name) || ent.keys.includes(f.name)).map(f => f.label), 'DrillState', 'DistanceFromRoot', 'LimitedDescendantCount', 'LimitedRank']);
      value = value.map(r => Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k.split('@')[0]) || k.startsWith('@') || k.startsWith('__'))));
    }
    const res = { value };
    if (q.$count === 'true') res['@odata.count'] = out.length;
    return res;
  }

  // custom entity: the query class gets filter, paging, sorting and requested elements and returns the rows
  customRows(ent, q, fixedFilter) {
    const rt = this.app.rt;
    if (!ent.queryClass || !rt.hasClass(ent.queryClass)) throw new RapError(500, `Query class ${String(ent.queryClass || '').toUpperCase()} of custom entity ${ent.label} not found`);
    const lit = (v, f) => (f?.numeric ? String(Number(v)) : `'${String(v ?? '').replace(/'/g, "''")}'`);
    const conds = [], ranges = [];
    let rangeable = true;
    for (const [col, v] of fixedFilter || []) {
      const f = this.field(ent, col);
      conds.push(`${col.toUpperCase()} = ${lit(v, f)}`);
      ranges.push({ name: col.toUpperCase(), range: [{ sign: 'I', option: 'EQ', low: v, high: '' }] });
    }
    if (q.$filter) {
      const f = new FilterParser(q.$filter, ent, this).parse();
      let i = 0;
      conds.push(f.sql.replace(/"([a-z_][\w$]*)"/g, (m, c) => c.toUpperCase()).replace(/\?/g, () => { const v = f.params[i++]; return typeof v === 'number' ? String(v) : `'${String(v ?? '').replace(/'/g, "''")}'`; }));
      const r = filterRanges(q.$filter, ent, this);
      if (r) for (const x of r) { const have = ranges.find(y => y.name === x.name); if (have) have.range.push(...x.range); else ranges.push(x); }
      else rangeable = false;
    }
    const sort = (q.$orderby || '').split(',').filter(s => s.trim()).map(p => {
      const [n, dir] = p.trim().split(/\s+/);
      const f = this.field(ent, n);
      if (!f) throw new RapError(400, `Unknown property ${n} in $orderby`);
      return { name: f.name.toUpperCase(), desc: dir?.toLowerCase() === 'desc' };
    });
    const select = selectList(q.$select);
    const top = q.$top !== undefined ? Math.max(0, Number(q.$top)) : -1;
    const spec = {
      entity: ent.name.toUpperCase(), offset: Number(q.$skip || 0), size: top, sort,
      elements: (select ? ent.fields.filter(f => select.includes(f.name) || f.key) : ent.fields).map(f => f.name.toUpperCase()),
      filterSql: conds.map(c => `( ${c} )`).join(' AND '), ranges: rangeable ? ranges : null,
      search: q.$search ? String(q.$search).replace(/^"|"$/g, '') : '', data: top !== 0, count: q.$count === 'true',
      params: Object.entries(this.paramValues || {}).map(([name, value]) => ({ name: name.toUpperCase(), value })),
    };
    const req = rt.queryRequest(spec), res = rt.queryResponse();
    const obj = rt.new(ent.queryClass);
    try { rt.call(obj, 'if_rap_query_provider~select', { io_request: req, io_response: res }); }
    catch (e) { if (e instanceof RapError) throw e; throw new RapError(500, `${ent.label}: ${e.get_text?.()?.$ret || e.message}`); }
    if (spec.data && !res.data) throw new RapError(500, `Query class ${ent.queryClass.toUpperCase()} did not call set_data`);
    if (spec.count && res.total === undefined) throw new RapError(500, `Query class ${ent.queryClass.toUpperCase()} did not call set_total_number_of_records`);
    let rows = (res.data || []).map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v])));
    if (top > 0 && rows.length > top) rows = rows.slice(0, top);
    return { rows, total: res.total };
  }
  customQuery(srv, ent, q, fixedFilter) {
    const { rows, total } = this.customRows(ent, q, fixedFilter);
    const select = selectList(q.$select);
    const norm = rows.map(r => normalizeRow(ent, r));
    const value = norm.map(r => this.toJson(ent, r, select ? [...new Set([...select, ...ent.keys])] : null));
    if (q.$expand) this.expand(srv, ent, norm, value, q.$expand);
    const out = { value };
    if (q.$count === 'true') out['@odata.count'] = total;
    return out;
  }

  expand(srv, ent, rows, json, expandParam) {
    for (const item of splitTopComma(expandParam)) {
      const mm = /^\s*([^($]+)(?:\((.*)\))?\s*$/.exec(item);
      const name = mm[1].trim();
      const opts = parseExpandOptions(mm[2] || '');
      if (name.toLowerCase() === 'draftadministrativedata') { rows.forEach((r, i) => { json[i].DraftAdministrativeData = this.draftAdmin(ent, r); }); continue; }
      if (name.toLowerCase() === 'siblingentity') { rows.forEach((r, i) => { json[i].SiblingEntity = this.sibling(ent, r); }); continue; }
      const a = ent.assocs.get(name.toLowerCase());
      if (!a) throw new RapError(400, `Unknown navigation property ${name}`);
      const target = this.model.entities.get(a.target);
      rows.forEach((row, i) => {
        const res = this.query(srv, target, opts, this.navFilter(ent, row, a, target));
        const toOne = a.toParent || a.card?.max === 1;
        json[i][a.label] = toOne ? (res.value[0] || null) : res.value;
        if (!toOne && opts.$count === 'true') json[i][`${a.label}@odata.count`] = res['@odata.count'];
      });
    }
  }

  draftAdmin(ent, row) {
    if (!this.isDraft(ent)) return null;
    let d = row;
    if (row.$isactive !== 0) {
      if (!row.$hasdraft) return null;
      const where = ent.keys.map(k => `"${k}" = ?`).join(' AND ');
      d = this.db.prepare(`SELECT "$draftuuid" AS "$draftuuid", "$draftentitycreationdatetime" AS "$draftcreated", "$draftentitylastchangedatetime" AS "$draftchanged", "$draftcreatedbyuser" AS "$draftuser" FROM "${ent.name}$d" WHERE ${where}`).get(...ent.keys.map(k => row[k]));
      if (!d) return null;
    }
    const owner = d.$draftuser || '';
    const collab = !!this.model.entityBo.get(this.model.baseEntity(ent.name))?.collaborative;
    const fresh = !collab && Date.now() - tsToMs(d.$draftchanged) < lockMs();
    const mine = owner === this.user;
    const inProcess = fresh ? owner : '';
    return {
      DraftUUID: toOData(d.$draftuuid, { t: 'uuid' }), CreationDateTime: toOData(d.$draftcreated, { t: 'tsl' }), CreatedByUser: owner,
      LastChangeDateTime: toOData(d.$draftchanged, { t: 'tsl' }), LastChangedByUser: owner, InProcessByUser: inProcess,
      DraftIsCreatedByMe: mine, DraftIsProcessedByMe: mine && fresh, DraftIsLastChangedByMe: mine,
      CreatedByUserDescription: owner, LastChangedByUserDescription: owner, InProcessByUserDescription: inProcess,
    };
  }
  sibling(ent, row) {
    if (!this.isDraft(ent)) return null;
    const active = row.$isactive !== 0;
    if (active && !row.$mydraft) return null;
    if (!active && !row.$hasactive) return null;
    const key = {};
    for (const k of ent.keys) key[k] = row[k];
    key.$active = !active;
    const s = this.readOne(ent, key);
    return s ? this.toJson(ent, s) : null;
  }

  // instance feature control as computed properties (__EntityControl / __OperationControl)
  controlProps(ent, rows) {
    let base;
    try { base = this.base(ent); } catch { return rows.map(() => ({})); }
    const tx = this.rap.begin();
    try {
      return rows.map(r => {
        const f = tx.features(tx.boOf(base.name), base.name, this.baseKey(ent, { ...r, $active: r.$isactive !== 0 }));
        if (!f) return {};
        const ops = {};
        for (const a of Object.values(base.behavior.actions)) if (!a.internal) ops[a.label] = f.actions[a.name] !== false;
        return { __EntityControl: { Deletable: !!f.delete, Updatable: !!f.update }, __OperationControl: ops };
      });
    } catch { return rows.map(() => ({})); } finally { this.rap.end(); }
  }

  // the columns the transformations of $apply produce ([{name, label, ti}]), null when they keep the entity's
  applyColumns(ent, apply) {
    let cols = null;
    for (const step of splitTopSlash(apply)) {
      const t = /^(\w+)\((.*)\)$/s.exec(step.trim());
      if (!t || (t[1] !== 'groupby' && t[1] !== 'aggregate')) continue;
      let groups = [], aggs = [];
      if (t[1] === 'groupby') {
        const parts = splitTopComma(t[2]);
        groups = parts[0].trim().replace(/^\(|\)$/g, '').split(',').map(x => x.trim()).filter(Boolean);
        const ag = parts[1] && /^aggregate\((.*)\)$/s.exec(parts[1].trim());
        if (ag) aggs = splitTopComma(ag[1]);
      } else aggs = splitTopComma(t[2]);
      cols = [...groups.map(g => this.field(ent, g)).filter(Boolean).map(f => ({ name: f.name, label: f.label, ti: f.ti })),
        ...aggs.map(a => /^\s*(\$count|[\w]+)(?:\s+with\s+(\w+))?(?:\s+as\s+(\w+))?\s*$/i.exec(a)).filter(Boolean).map(([, prop, withM, as]) => {
          const f = prop === '$count' ? null : this.field(ent, prop);
          const name = (as || (prop === '$count' ? 'count' : prop)).toLowerCase();
          return { name, label: as || f?.label || name, ti: prop === '$count' || /^count/i.test(withM || '') ? { t: 'int8' } : f?.ti || { t: 'int8' } };
        })];
    }
    return cols;
  }

  // $apply: filter(...)/groupby((a,b),aggregate(m with sum as x, $count as n))/aggregate(...)
  apply(ent, q, from, params) {
    let sql = `SELECT * FROM ${from}`;
    let cols = null; // output columns after aggregation: [{name, label, ti}]
    let n = 0;
    for (const step of splitTopSlash(q.$apply)) {
      const t = /^(\w+)\((.*)\)$/s.exec(step.trim());
      if (!t) throw new RapError(400, `Unsupported $apply transformation ${step}`);
      const [, kind, arg] = t;
      const alias = `ap${++n}`;
      if (kind === 'filter') {
        const f = new FilterParser(arg, ent, this, cols).parse();
        sql = `SELECT * FROM (${sql}) ${alias} WHERE ${f.sql}`;
        params = [...params, ...f.params];
      } else if (kind === 'groupby' || kind === 'aggregate') {
        let groups = [], aggs = [];
        if (kind === 'groupby') {
          const parts = splitTopComma(arg);
          groups = parts[0].trim().replace(/^\(|\)$/g, '').split(',').map(s => s.trim()).filter(Boolean);
          const ag = parts[1] && /^aggregate\((.*)\)$/s.exec(parts[1].trim());
          if (ag) aggs = splitTopComma(ag[1]);
        } else aggs = splitTopComma(arg);
        const gcols = groups.map(g => { const f = this.field(ent, g); if (!f) throw new RapError(400, `Unknown property ${g} in groupby`); return f; });
        const select = gcols.map(f => `"${f.name}"`);
        const out = gcols.map(f => ({ name: f.name, label: f.label, ti: f.ti }));
        for (const a of aggs) {
          const am = /^\s*(\$count|[\w]+)(?:\s+with\s+(\w+))?(?:\s+as\s+(\w+))?\s*$/i.exec(a);
          if (!am) throw new RapError(400, `Unsupported aggregate ${a}`);
          const [, prop, withM, as] = am;
          if (prop === '$count') { select.push(`COUNT(*) AS "${(as || 'count').toLowerCase()}"`); out.push({ name: (as || 'count').toLowerCase(), label: as || 'count', ti: { t: 'int8' } }); continue; }
          const f = this.field(ent, prop);
          if (!f) throw new RapError(400, `Unknown property ${prop} in aggregate`);
          if (!withM && !defaultAggregation(f)) {
            // not a measure (e.g. the currency or unit of a measure): single value if unique, otherwise null
            const name = (as || prop).toLowerCase();
            select.push(`CASE WHEN COUNT(DISTINCT "${f.name}") = 1 THEN MAX("${f.name}") ELSE NULL END AS "${name}"`);
            out.push({ name, label: as || f.label, ti: f.ti });
            continue;
          }
          const method = (withM || defaultAggregation(f) || 'sum').toLowerCase();
          const fn = { sum: 'SUM', average: 'AVG', avg: 'AVG', min: 'MIN', max: 'MAX', countdistinct: 'COUNT(DISTINCT', count: 'COUNT' }[method];
          if (!fn) throw new RapError(400, `Unsupported aggregation method ${method}`);
          const name = (as || prop).toLowerCase();
          select.push(fn === 'COUNT(DISTINCT' ? `COUNT(DISTINCT "${f.name}") AS "${name}"` : `${fn}("${f.name}") AS "${name}"`);
          out.push({ name, label: as || f.label, ti: method === 'countdistinct' || method === 'count' ? { t: 'int8' } : f.ti });
        }
        sql = `SELECT ${select.join(', ') || '1 AS "$one"'} FROM (${sql}) ${alias}${gcols.length ? ` GROUP BY ${gcols.map(f => `"${f.name}"`).join(', ')}` : ''}`;
        cols = out;
      } else if (kind === 'orderby' || kind === 'top' || kind === 'skip') {
        // handled through the system query options below
      } else throw new RapError(400, `Unsupported $apply transformation ${kind}`);
    }
    const colsFinal = cols || ent.fields.map(f => ({ name: f.name, label: f.label, ti: f.ti }));
    let order = '';
    if (q.$orderby) order = ' ORDER BY ' + q.$orderby.split(',').map(p => {
      const [nm, dir] = p.trim().split(/\s+/);
      const c = colsFinal.find(x => x.label.toLowerCase() === nm.toLowerCase());
      if (!c) throw new RapError(400, `Unknown property ${nm} in $orderby`);
      return `"${c.name}" ${dir?.toLowerCase() === 'desc' ? 'DESC' : 'ASC'}`;
    }).join(', ');
    let outer = `SELECT * FROM (${sql}) aq`;
    // q.$filter here: one on the aggregation's result (the entity's properties were filtered before the transformations)
    if (q.$filter) {
      const f = new FilterParser(q.$filter, ent, this, cols).parse();
      outer += ` WHERE ${f.sql}`;
      params = [...params, ...f.params];
    }
    const top = q.$top !== undefined ? Math.max(0, Number(q.$top)) : 5000;
    const skip = q.$skip !== undefined ? Math.max(0, Number(q.$skip)) : 0;
    let rows;
    try { rows = this.db.prepare(`${outer}${order} LIMIT ? OFFSET ?`).all(...params, top, skip); }
    catch (e) { throw new RapError(500, `$apply on ${ent.label} failed: ${e.message}`); }
    const value = rows.map(r => {
      const o = { '@odata.id': null };
      for (const c of colsFinal) if (c.name in r) o[c.label] = this.num({ ti: c.ti }, toOData(r[c.name], c.ti));
      return o;
    });
    const res = { value };
    if (q.$count === 'true') res['@odata.count'] = this.db.prepare(`SELECT COUNT(*) AS n FROM (${outer})`).get(...params).n;
    return res;
  }

  // ------------------------------------------------------------------ writes
  location(ent, setName, baseKey) {
    const row = this.readOne(ent, this.projKey(ent, baseKey));
    return row ? { row, location: `${setName}${this.keyPredicate(ent, row)}` } : { row: null, location: null };
  }

  create(srv, setName, ent, body) {
    if (!this.allowed(ent, 'create')) throw new RapError(405, `Create is not enabled for ${ent.label}`);
    const base = this.base(ent);
    const values = this.toBaseValues(ent, body);
    const draft = this.isDraft(ent);
    const deep = this.deepChildren(ent, body);
    const { result, messages } = this.transact((tx, resp) => {
      const bo = tx.boOf(base.name);
      tx.create(bo, base.name, [{ '%cid': 'c1', ...values, ...(draft ? { '%is_draft': '01' } : {}) }], Object.keys(values), resp, true);
      const m = (resp.mapped[base.behavior.aliasLower] || []).find(x => x['%cid'] === 'c1');
      if (m && deep.length) {
        const key = tx.pickKey(base.name, m, draft);
        for (const d of deep) tx.createByAssoc(bo, base.name, d.assoc, [{ ...key, '%target': d.rows.map((r, i) => ({ '%cid': `d${i}`, ...r })) }], null, resp, true);
      }
      return m ? (tx.get(base.name, tx.pickKey(base.name, m, draft)) || { key: tx.pickKey(base.name, m, draft) }) : null;
    });
    const { row, location } = result ? this.location(ent, setName, result.key) : {};
    return { status: 201, headers: { ...this.messagesHeader(messages), ...(location ? { Location: location } : {}) }, body: row ? { '@odata.context': `$metadata#${setName}/$entity`, ...this.full(ent, row) } : {}, location };
  }
  deepChildren(ent, body) {
    const out = [];
    for (const [k, v] of Object.entries(body || {})) {
      if (!Array.isArray(v)) continue;
      const a = ent.assocs.get(k.toLowerCase());
      if (!a || !a.composition) continue;
      const target = this.model.entities.get(a.target);
      out.push({ assoc: a.baseAssoc || a.name, rows: v.map(r => this.toBaseValues(target, r)) });
    }
    return out;
  }

  createByAssoc(srv, ent, key, assoc, body) {
    if (!this.allowed(ent, 'assoc', assoc.name)) throw new RapError(405, `Create by association ${assoc.label} is not enabled`);
    const base = this.base(ent);
    const target = this.model.entities.get(assoc.target);
    const baseTarget = this.base(target);
    const baseAssoc = assoc.baseAssoc || assoc.name;
    const values = this.toBaseValues(target, body);
    const { result, messages } = this.transact((tx, resp) => {
      const bo = tx.boOf(base.name);
      tx.createByAssoc(bo, base.name, baseAssoc, [{ ...this.baseKey(ent, key), '%target': [{ '%cid': 'c1', ...values }] }], Object.keys(values), resp, true);
      const m = (resp.mapped[baseTarget.behavior.aliasLower] || []).find(x => x['%cid'] === 'c1');
      return m ? (tx.get(baseTarget.name, tx.pickKey(baseTarget.name, m, m['%is_draft'] === '01')) || { key: tx.pickKey(baseTarget.name, m, m['%is_draft'] === '01') }) : null;
    });
    const setName = this.setOfEntity(srv, target.name) || target.label;
    const { row, location } = result ? this.location(target, setName, result.key) : {};
    return { status: 201, headers: { ...this.messagesHeader(messages), ...(location ? { Location: location } : {}) }, body: row ? { '@odata.context': `$metadata#${setName}/$entity`, ...this.full(target, row) } : {}, location };
  }

  update(srv, ent, key, body) {
    if (!this.allowed(ent, 'update')) throw new RapError(405, `Update is not enabled for ${ent.label}`);
    const base = this.base(ent);
    if (this.isDraft(ent) && key.$active !== false) throw new RapError(400, `${ent.label} is draft-enabled: execute the Edit action and change the draft instead`);
    const values = this.toBaseValues(ent, body);
    for (const k of base.keys) delete values[k];
    this.checkEtag(ent, key);
    const { messages } = this.transact((tx, resp) => {
      const bo = tx.boOf(base.name);
      tx.update(bo, base.name, [{ ...this.baseKey(ent, key), ...values }], Object.keys(values), resp, true);
    });
    const row = this.readOne(ent, key);
    return { status: 200, headers: this.messagesHeader(messages), body: row ? this.full(ent, row) : {} };
  }

  remove(ent, key) {
    const base = this.base(ent);
    const discard = this.isDraft(ent) && key.$active === false;
    if (!discard && !this.allowed(ent, 'delete')) throw new RapError(405, `Delete is not enabled for ${ent.label}`);
    if (!discard) this.checkEtag(ent, key);
    const { messages } = this.transact((tx, resp) => {
      const bo = tx.boOf(base.name);
      if (discard && base.behavior.root && base.behavior.draftActions?.has('discard')) tx.execute(bo, base.name, 'discard', [this.baseKey(ent, key)], resp, false);
      else tx.delete(bo, base.name, [this.baseKey(ent, key)], resp, !discard);
    });
    return { status: 204, headers: this.messagesHeader(messages), body: null };
  }

  action(srv, ent, key, name, body) {
    const base = this.base(ent);
    const beh = base.behavior;
    const isDraftAction = !!beh.draftActions?.has(name);
    const a = beh.actions[name];
    if (!a && !isDraftAction) throw new RapError(404, `Action ${name} not found`);
    if (!isDraftAction && !this.allowed(ent, 'action', name)) throw new RapError(404, `Action ${name} is not available for ${ent.label}`);
    let param;
    if (a?.param) {
      const pe = this.model.entities.get(a.param);
      param = {};
      for (const [k, v] of Object.entries(body || {})) { const f = this.field(pe, k); if (f) param[f.name] = fromOData(v, f.ti); }
    }
    if (name === 'edit') param = { preservechanges: body?.PreserveChanges === true };
    if (!isDraftAction || name === 'edit') this.checkEtag(ent, key);
    const prepare = name === 'prepare';
    const { result, messages } = this.transact((tx, resp) => {
      const bo = tx.boOf(base.name);
      return tx.execute(bo, base.name, name, [{ ...this.baseKey(ent, key), ...(param ? { '%param': param } : {}) }], resp, !isDraftAction);
    }, { tolerateFailed: prepare });
    const setName = this.setOfEntity(srv, ent.name) || ent.label;
    let out = null;
    if (isDraftAction) {
      const r = (result || [])[0];
      if (r && name !== 'discard') {
        const row = this.readOne(ent, this.projKey(ent, tx0Key(r)));
        out = row ? { '@odata.context': `$metadata#${setName}/$entity`, ...this.full(ent, row) } : null;
      }
    } else if (a.result === '$self' || !a.result) {
      const row = this.readOne(ent, key);
      out = row ? { '@odata.context': `$metadata#${setName}/$entity`, ...this.full(ent, row) } : null;
    } else out = (result || []).map(r => r['%param']);
    return { status: out ? 200 : 204, headers: this.messagesHeader(messages, prepare), body: out };
  }

  features(ent, key) {
    const base = this.base(ent);
    const tx = this.rap.begin();
    try {
      const f = tx.features(tx.boOf(base.name), base.name, this.baseKey(ent, key));
      if (!f) throw new RapError(404, `${ent.label} not found`);
      const pb = this.projBehavior(ent);
      if (pb) {
        f.update = f.update && !!pb.ops.update;
        f.delete = f.delete && !!pb.ops.delete;
        for (const a of Object.keys(f.actions)) if (!pb.actions[a]) delete f.actions[a];
        for (const a of Object.keys(f.assocs)) f.assocs[a] = f.assocs[a] && !!pb.assocs[a]?.create;
      }
      f.actions = Object.fromEntries(Object.entries(f.actions).map(([a, v]) => [base.behavior.actions[a]?.label || a, v]));
      f.assocs = Object.fromEntries(Object.entries(f.assocs).map(([a, v]) => [ent.assocs.get(a)?.label || base.assocs.get(a)?.label || a, v]));
      const fields = {};
      for (const [bf, v] of Object.entries(f.fields)) { const pf = this.model.projField(ent.name, bf); if (pf) fields[this.field(ent, pf).label] = v; }
      f.fields = fields;
      return f;
    } finally { this.rap.end(); }
  }

  // ------------------------------------------------------------------ $batch
  // multipart/mixed (OData 4.0) or application/json (OData 4.01 JSON batch)
  batch(raw, headers, path) {
    const servicePath = path.replace(/\$batch$/, '');
    const ct = headers['content-type'] || '';
    const run = (method, url, hdrs, body) => {
      const rel = url.replace(/^https?:\/\/[^/]+/, '');
      const full = rel.startsWith('/') ? rel : servicePath + rel;
      let json = null;
      if (body && body.trim()) { try { json = JSON.parse(body); } catch { throw new RapError(400, 'Invalid JSON in batch request body'); } }
      let res;
      try { res = this.handle(method, full, json, { ...headers, ...lower(hdrs) }); }
      catch (e) { if (!(e instanceof RapError)) this.onError?.(e, `OData ${method} ${rel}`); res = errorResponse(e); }
      if (process.env.RAP_DEBUG) console.log(`[batch] ${method} ${rel} -> ${res.status}${res.status >= 400 ? ' ' + JSON.stringify(res.body).slice(0, 300) : ''}${method !== 'GET' && body ? ' body=' + body.slice(0, 200) : ''}`);
      return res;
    };
    const db = this.db;
    let cs = 0;
    const changeset = (requests) => {
      // all-or-nothing: savepoint around the change set; Content-ID references ($1) resolve to created entities
      const sp = `cs_${++cs}`;
      db.exec(`SAVEPOINT ${sp}`);
      const ids = {};
      const results = [];
      for (const r of requests) {
        const url = r.url.replace(/^\$(\w+)/, (m, id) => ids[id] || m);
        const res = run(r.method, url, r.headers, r.body);
        results.push({ ...res, contentId: r.contentId });
        if (r.contentId && res.location) ids[r.contentId] = res.location;
        if (res.status >= 400) {
          db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`);
          return [{ ...res, contentId: r.contentId }];
        }
      }
      db.exec(`RELEASE ${sp}`);
      return results;
    };
    if (/application\/json/i.test(ct)) {
      const req = JSON.parse(raw || '{}');
      const responses = [];
      const groups = new Map();
      for (const r of req.requests || []) {
        if (r.atomicityGroup) { (groups.get(r.atomicityGroup) || groups.set(r.atomicityGroup, []).get(r.atomicityGroup)).push(r); continue; }
        const res = run(r.method, r.url, r.headers, r.body === undefined ? '' : JSON.stringify(r.body));
        responses.push({ id: r.id, status: res.status, headers: res.headers || {}, body: res.body });
      }
      for (const [, rs] of groups) {
        const out = changeset(rs.map(r => ({ method: r.method, url: r.url, headers: r.headers, body: r.body === undefined ? '' : JSON.stringify(r.body), contentId: r.id })));
        for (const [i, res] of out.entries()) responses.push({ id: res.contentId || rs[i]?.id, atomicityGroup: rs[0].atomicityGroup, status: res.status, headers: res.headers || {}, body: res.body });
      }
      return { status: 200, headers: { 'Content-Type': 'application/json', 'OData-Version': '4.01' }, body: JSON.stringify({ responses }) };
    }
    const boundary = /boundary=("?)([^";]+)\1/i.exec(ct)?.[2];
    if (!boundary) throw new RapError(400, 'Missing multipart boundary');
    const parts = parseMultipart(raw, boundary);
    const respBoundary = `batchresponse_${Date.now().toString(36)}`;
    const out = [];
    for (const p of parts) {
      const pct = p.headers['content-type'] || '';
      if (/multipart\/mixed/i.test(pct)) {
        const csb = /boundary=("?)([^";]+)\1/i.exec(pct)[2];
        const reqs = parseMultipart(p.body, csb).map(cp => ({ ...parseHttp(cp.body), contentId: cp.headers['content-id'] }));
        const results = changeset(reqs);
        const csResp = `changesetresponse_${Date.now().toString(36)}_${out.length}`;
        out.push(`--${respBoundary}\r\nContent-Type: multipart/mixed; boundary=${csResp}\r\n\r\n${results.map(r => `--${csResp}\r\n${httpPart(r, r.contentId)}`).join('')}--${csResp}--\r\n`);
      } else {
        const r = parseHttp(p.body);
        const res = run(r.method, r.url, r.headers, r.body);
        out.push(`--${respBoundary}\r\n${httpPart(res, p.headers['content-id'])}`);
      }
    }
    return { status: 200, headers: { 'Content-Type': `multipart/mixed; boundary=${respBoundary}`, 'OData-Version': '4.0' }, body: `${out.join('')}--${respBoundary}--\r\n` };
  }

  // ------------------------------------------------------------------ UI metadata (for the built-in Fiori-like UI)
  uiMetadata(srv) {
    const sets = {};
    for (const e of srv.exposes) {
      const ent = this.model.entities.get(e.entity);
      if (!ent) continue;
      sets[e.alias] = this.entityMetadata(srv, e.alias, ent);
    }
    return { service: srv.label, label: srv.ann?.endusertext?.label || srv.label, entitySets: sets };
  }

  entityMetadata(srv, setName, ent) {
    const baseName = this.model.baseEntity(ent.name);
    const base = this.model.entities.get(baseName);
    const beh = base?.behavior;
    const pb = this.projBehavior(ent);
    const pv = [].concat(ent.ann?.ui?.presentationvariant || [])[0];
    const sortOrder = [].concat(pv?.sortorder || []).map(x => ({ by: ent.fields.find(f => f.name === String(x.by).toLowerCase())?.label || x.by, direction: x.direction || '#ASC' }));
    const ui = { lineItem: [], identification: [], fieldGroups: {}, selectionFields: [], facets: [], headerInfo: ent.ann?.ui?.headerinfo || null, sortOrder, charts: [].concat(ent.ann?.ui?.chart || []) };
    const fields = [];
    const label = (f) => f.ann?.endusertext?.label || f.ann?.endusertext?.quickinfo || humanize(f.label);
    const addUi = (target, elName, entries, kind) => {
      for (const x of Array.isArray(entries) ? entries : [entries]) {
        if (!x || typeof x !== 'object') continue;
        const item = { type: x.type || '#STANDARD', value: elName, label: x.label, position: x.position ?? 999, importance: x.importance, criticality: x.criticality, dataAction: x.dataaction, qualifier: x.qualifier };
        if (kind === 'fg') (ui.fieldGroups[x.qualifier || ''] ||= []).push(item);
        else target.push(item);
      }
    };
    for (const f of ent.fields) {
      const bf = this.model.baseField(ent.name, f.name);
      const fb = bf && beh ? beh.fields[bf] : null;
      const readonly = !bf || !!fb?.readonly || !!fb?.numberingManaged || ent.keys.includes(f.name) && !!fb;
      const vh = f.ann?.consumption?.valuehelpdefinition;
      const vhDef = Array.isArray(vh) ? vh[0] : vh;
      fields.push({
        name: f.label, label: label(f), type: edmType(f.ti), abapType: f.ti.t, maxLength: f.ti.len, scale: f.ti.dec,
        key: ent.keys.includes(f.name), readonly, readonlyUpdate: !!fb?.readonlyUpdate,
        // what a create may set (the runtime's checkReadonly on create): not read-only, not numbered by the framework
        readonlyCreate: !bf || !!fb?.readonly || !!fb?.numberingManaged,
        mandatory: !!(fb?.mandatory || fb?.mandatoryCreate), hidden: !!(f.ann?.ui?.hidden || f.ann?.consumption?.hidden),
        text: f.ann?.objectmodel?.text?.element ? [].concat(f.ann.objectmodel.text.element)[0] : null,
        valueHelp: vhDef?.entity ? { entity: String(vhDef.entity.name).toLowerCase(), element: vhDef.entity.element, fixed: this.fixedValues(vhDef.entity.name) } : null,
        semantics: f.ann?.semantics || null, aggregation: defaultAggregation(f),
      });
      const u = f.ann?.ui || {};
      if (u.lineitem) addUi(ui.lineItem, f.label, u.lineitem);
      if (u.identification) addUi(ui.identification, f.label, u.identification);
      if (u.fieldgroup) addUi(null, f.label, u.fieldgroup, 'fg');
      if (u.selectionfield) ui.selectionFields.push({ value: f.label, position: [].concat(u.selectionfield)[0]?.position ?? 999 });
      if (u.facet) ui.facets.push(...[].concat(u.facet));
    }
    for (const a of ent.assocs.values()) if (a.ann?.ui?.facet) ui.facets.push(...[].concat(a.ann.ui.facet));
    const byPos = (x, y) => x.position - y.position;
    ui.lineItem.sort(byPos); ui.identification.sort(byPos); ui.selectionFields.sort(byPos);
    for (const g of Object.values(ui.fieldGroups)) g.sort(byPos);
    ui.facets = ui.facets.map(f => ({ id: f.id, parentId: f.parentid, type: f.type, label: f.label, position: f.position ?? 999, purpose: f.purpose, targetQualifier: f.targetqualifier, targetElement: f.targetelement })).sort(byPos);
    const navs = [...ent.assocs.values()].filter(a => a.exposed).map(a => ({
      name: a.label, target: this.setOfEntity(srv, a.target), targetEntity: a.target, composition: a.composition, toParent: a.toParent,
      many: !(a.toParent || a.card?.max === 1),
      create: !!(beh && beh.assocs[a.baseAssoc || a.name]?.create && (!pb || pb.assocs[a.name]?.create)),
    }));
    const actions = [];
    if (beh) {
      for (const a of Object.values(beh.actions)) {
        if (a.internal || (pb && !pb.actions[a.name])) continue;
        const pe = a.param ? this.model.entities.get(a.param) : null;
        const lbl = [...ui.lineItem, ...ui.identification].find(x => x.dataAction?.toLowerCase() === a.name)?.label;
        actions.push({ name: a.label, label: lbl || humanize(a.label), static: a.static, features: a.features, parameters: pe ? pe.fields.map(f => ({ name: f.label, label: label(f), type: edmType(f.ti), maxLength: f.ti.len, mandatory: !!f.ann?.consumption?.mandatory })) : [] });
      }
    }
    const ops = beh ? {
      create: !!beh.ops.create && (!pb || !!pb.ops.create) && !base.behavior.lockDependentBy,
      update: !!beh.ops.update && (!pb || !!pb.ops.update),
      delete: !!beh.ops.delete && (!pb || !!pb.ops.delete),
    } : { create: false, update: false, delete: false };
    // side effects: explicit (BDEF "side effects") or derived from determination trigger fields
    const sideEffects = [];
    if (beh) {
      const lab = n => { const pf = this.model.projField(ent.name, n); return pf ? this.field(ent, pf)?.label : null; };
      const navLabel = n => [...ent.assocs.values()].find(a => (a.baseAssoc || a.name) === n || a.name === n)?.label;
      if (beh.sideEffects?.length) {
        for (const se of beh.sideEffects) {
          const props = [], ents = [];
          for (const t of se.targets) {
            if (t.kind === 'self') ents.push('');
            else if (t.kind === 'entity') { const n = navLabel(t.path); if (n) ents.push(n); }
            else if (t.kind === 'field') {
              if (t.path.includes('.')) {
                const [a, f] = t.path.split('.');
                const assoc = [...ent.assocs.values()].find(x => (x.baseAssoc || x.name) === a || x.name === a);
                const tf = assoc && this.model.entities.get(assoc.target)?.fields.find(z => z.name === this.model.projField(assoc.target, f) || z.name === f);
                if (assoc && tf) props.push(`${assoc.label}/${tf.label}`);
              }
              else { const l = lab(t.path); if (l) props.push(l); }
            }
          }
          const fields = se.sources.filter(x => x.kind === 'field').map(x => lab(x.name)).filter(Boolean);
          const action = se.sources.find(x => x.kind === 'action');
          if ((fields.length || action) && (props.length || ents.length)) sideEffects.push({ sourceProperties: fields, action: action ? beh.actions[action.name]?.label : null, targetProperties: props, targetEntities: ents });
        }
      } else {
        const triggers = new Set(beh.determinations.filter(d => d.when === 'modify').flatMap(d => d.fields).map(lab).filter(Boolean));
        if (triggers.size) {
          const parent = [...ent.assocs.values()].find(a => a.toParent);
          sideEffects.push({ sourceProperties: [...triggers], targetProperties: ent.fields.filter(f => !ent.keys.includes(f.name)).map(f => f.label), targetEntities: parent ? [parent.label] : [] });
        }
      }
    }
    return {
      sideEffects,
      name: setName, entity: ent.label, label: ent.ann?.endusertext?.label || ui.headerInfo?.typenameplural || setName,
      keys: ent.keys.map(k => this.field(ent, k).label), fields, ui, navigation: navs, actions, ops,
      // keys assigned by early / late numbering handlers (a key sent by a client on create is not used)
      keysNumbered: !!(beh?.earlyNumbering || beh?.lateNumbering),
      transactional: !!beh, root: !!base?.behavior?.root, draft: this.isDraft(ent), draftRoot: this.isDraft(ent) && !!base?.behavior?.root,
      hierarchyQualifier: this.hierarchyOf(ent)?.qualifier || null,
    };
  }

  // ------------------------------------------------------------------ OData V4 $metadata (EDMX + annotations)
  edmx(srv) {
    const ns = `com.sap.gateway.srvd.${srv.name}.v0001`;
    const x = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const meta = this.uiMetadata(srv);
    const types = [], actions = [], sets = [], ann = [];
    let needsDraftAdmin = false;
    const labelOf = (ent, name) => ent.fields.find(f => f.name === String(name).toLowerCase())?.label || name;
    for (const [setName, m] of Object.entries(meta.entitySets)) {
      const e = srv.exposes.find(z => z.alias === setName);
      const ent = this.model.entities.get(e.entity);
      const tname = `${setName}Type`;
      const draft = this.isDraft(ent);
      const base = m.transactional ? this.base(ent) : null;
      const hasControl = !!base && this.rap.app.model.bos.get(base.bo?.name)?.handlers?.some(h => h.entity === base.name && h.kind === 'instance_features');
      const props = ent.fields.map(f => {
        if (this.streamOf(f)) return `<Property Name="${x(f.label)}" Type="Edm.Stream"/>`;
        const t = edmType(f.ti);
        let facets = '';
        if (t === 'Edm.String' && f.ti.len) facets = ` MaxLength="${f.ti.len}"`;
        if (t === 'Edm.Decimal') facets = ` Precision="${f.ti.len || 16}" Scale="${f.ti.dec ?? 2}"`;
        if (t === 'Edm.DateTimeOffset') facets = ' Precision="7"';
        return `<Property Name="${x(f.label)}" Type="${t}"${ent.keys.includes(f.name) ? ' Nullable="false"' : ''}${facets}/>`;
      });
      const hier = this.hierarchyOf(ent);
      if (hier) props.push('<Property Name="LimitedDescendantCount" Type="Edm.Int64"/>', '<Property Name="DistanceFromRoot" Type="Edm.Int64"/>', '<Property Name="DrillState" Type="Edm.String"/>', '<Property Name="LimitedRank" Type="Edm.Int64"/>');
      if (draft) {
        needsDraftAdmin = true;
        props.push('<Property Name="IsActiveEntity" Type="Edm.Boolean" Nullable="false" DefaultValue="true"/>', '<Property Name="HasActiveEntity" Type="Edm.Boolean" Nullable="false" DefaultValue="false"/>', '<Property Name="HasDraftEntity" Type="Edm.Boolean" Nullable="false" DefaultValue="false"/>');
      }
      if (hasControl) props.push(`<Property Name="__EntityControl" Type="${ns}.EntityControl"/>`, `<Property Name="__OperationControl" Type="${ns}.${setName}OperationControl"/>`);
      const navs = m.navigation.filter(n => n.target).map(n => {
        const tgt = `${ns}.${n.target}Type`;
        const partner = Object.values(meta.entitySets[n.target]?.navigation || []).find(b => (b.toParent && n.composition) || (n.toParent && b.composition))?.name;
        return `<NavigationProperty Name="${x(n.name)}" Type="${n.many ? `Collection(${tgt})` : tgt}"${n.toParent ? ' Nullable="false"' : ''}${partner ? ` Partner="${x(partner)}"` : ''}${n.composition ? ' ContainsTarget="false"' : ''}/>`;
      });
      if (draft) navs.push(`<NavigationProperty Name="DraftAdministrativeData" Type="${ns}.DraftAdministrativeDataType" ContainsTarget="true"/>`, `<NavigationProperty Name="SiblingEntity" Type="${ns}.${tname}"/>`);
      const keys = [...m.keys.map(k => `<PropertyRef Name="${x(k)}"/>`), ...(draft ? ['<PropertyRef Name="IsActiveEntity"/>'] : [])];
      types.push(`<EntityType Name="${tname}"><Key>${keys.join('')}</Key>${props.join('')}${navs.join('')}</EntityType>`);
      if (hasControl) types.push(`<ComplexType Name="${setName}OperationControl">${m.actions.map(a => `<Property Name="${x(a.name)}" Type="Edm.Boolean" Nullable="false"/>`).join('')}</ComplexType>`);
      const bindings = m.navigation.filter(n => n.target).map(n => `<NavigationPropertyBinding Path="${x(n.name)}" Target="${x(n.target)}"/>`);
      if (draft) bindings.push(`<NavigationPropertyBinding Path="SiblingEntity" Target="${x(setName)}"/>`);
      sets.push(`<EntitySet Name="${x(setName)}" EntityType="${ns}.${tname}">${bindings.join('')}</EntitySet>`);
      const bound = `<Parameter Name="_it" Type="${ns}.${tname}" Nullable="false"/>`;
      for (const a of m.actions) {
        const params = a.parameters.map(p => `<Parameter Name="${x(p.name)}" Type="${p.type}"${p.maxLength && p.type === 'Edm.String' ? ` MaxLength="${p.maxLength}"` : ''}/>`).join('');
        actions.push(`<Action Name="${x(a.name)}" IsBound="true" EntitySetPath="_it">${bound}${params}<ReturnType Type="${ns}.${tname}" Nullable="false"/></Action>`);
      }
      if (draft && m.draftRoot) {
        actions.push(`<Action Name="Edit" IsBound="true" EntitySetPath="_it">${bound}<Parameter Name="PreserveChanges" Type="Edm.Boolean"/><ReturnType Type="${ns}.${tname}" Nullable="false"/></Action>`);
        actions.push(`<Action Name="Activate" IsBound="true" EntitySetPath="_it">${bound}<ReturnType Type="${ns}.${tname}" Nullable="false"/></Action>`);
        actions.push(`<Action Name="Prepare" IsBound="true" EntitySetPath="_it">${bound}<Parameter Name="SideEffectsQualifier" Type="Edm.String"/><ReturnType Type="${ns}.${tname}" Nullable="false"/></Action>`);
        actions.push(`<Action Name="Discard" IsBound="true">${bound}</Action>`);
        actions.push(`<Action Name="Resume" IsBound="true" EntitySetPath="_it">${bound}<ReturnType Type="${ns}.${tname}" Nullable="false"/></Action>`);
      }
      // annotations
      const dataField = (it) => it.type === '#FOR_ACTION'
        ? `<Record Type="UI.DataFieldForAction"><PropertyValue Property="Action" String="${ns}.${x(m.actions.find(a => a.name.toLowerCase() === String(it.dataAction).toLowerCase())?.name || it.dataAction)}"/>${it.label ? `<PropertyValue Property="Label" String="${x(it.label)}"/>` : ''}</Record>`
        : `<Record Type="UI.DataField"><PropertyValue Property="Value" Path="${x(it.value)}"/>${it.label ? `<PropertyValue Property="Label" String="${x(it.label)}"/>` : ''}${it.criticality ? `<PropertyValue Property="Criticality" Path="${x(labelOf(ent, it.criticality))}"/>` : ''}${it.importance ? `<Annotation Term="UI.Importance" EnumMember="UI.ImportanceType/${it.importance === '#HIGH' ? 'High' : it.importance === '#LOW' ? 'Low' : 'Medium'}"/>` : ''}</Record>`;
      const t = [];
      // defaults for entities without UI annotations, so generated Fiori apps are usable immediately
      const visible = m.fields.filter(f => !f.hidden && !(f.key && f.type === 'Edm.Guid'));
      if (!m.ui.lineItem.length) m.ui.lineItem = visible.slice(0, 6).map((f, i) => ({ type: '#STANDARD', value: f.name, position: i }));
      if (!m.ui.identification.length && !m.ui.facets.length) {
        m.ui.identification = visible.map((f, i) => ({ type: '#STANDARD', value: f.name, position: i }));
        m.ui.facets = [{ id: 'General', type: '#IDENTIFICATION_REFERENCE', label: 'General Information', position: 10 }];
      }
      if (!m.ui.headerInfo && visible[0]) m.ui.headerInfo = { typename: humanize(setName), typenameplural: humanize(setName), title: { value: visible[0].name } };
      if (m.ui.lineItem.length) t.push(`<Annotation Term="UI.LineItem"><Collection>${m.ui.lineItem.map(dataField).join('')}</Collection></Annotation>`);
      if (m.ui.identification.length) t.push(`<Annotation Term="UI.Identification"><Collection>${m.ui.identification.map(dataField).join('')}</Collection></Annotation>`);
      for (const [q, items] of Object.entries(m.ui.fieldGroups)) t.push(`<Annotation Term="UI.FieldGroup"${q ? ` Qualifier="${x(q)}"` : ''}><Record Type="UI.FieldGroupType"><PropertyValue Property="Data"><Collection>${items.map(dataField).join('')}</Collection></PropertyValue></Record></Annotation>`);
      if (m.ui.selectionFields.length) t.push(`<Annotation Term="UI.SelectionFields"><Collection>${m.ui.selectionFields.map(s => `<PropertyPath>${x(s.value)}</PropertyPath>`).join('')}</Collection></Annotation>`);
      const hi = m.ui.headerInfo;
      if (hi) t.push(`<Annotation Term="UI.HeaderInfo"><Record Type="UI.HeaderInfoType"><PropertyValue Property="TypeName" String="${x(hi.typename || setName)}"/><PropertyValue Property="TypeNamePlural" String="${x(hi.typenameplural || setName)}"/>${hi.title?.value ? `<PropertyValue Property="Title"><Record Type="UI.DataField"><PropertyValue Property="Value" Path="${x(labelOf(ent, hi.title.value))}"/></Record></PropertyValue>` : ''}${hi.description?.value ? `<PropertyValue Property="Description"><Record Type="UI.DataField"><PropertyValue Property="Value" Path="${x(labelOf(ent, hi.description.value))}"/></Record></PropertyValue>` : ''}</Record></Annotation>`);
      const facetRec = (f) => {
        if (f.type === '#COLLECTION') return `<Record Type="UI.CollectionFacet"><PropertyValue Property="ID" String="${x(f.id)}"/><PropertyValue Property="Label" String="${x(f.label)}"/><PropertyValue Property="Facets"><Collection>${m.ui.facets.filter(c => c.parentId === f.id).map(facetRec).join('')}</Collection></PropertyValue></Record>`;
        const target = f.type === '#IDENTIFICATION_REFERENCE' ? '@UI.Identification' : f.type === '#FIELDGROUP_REFERENCE' ? `@UI.FieldGroup${f.targetQualifier ? '#' + f.targetQualifier : ''}` : f.type === '#LINEITEM_REFERENCE' ? `${f.targetElement}/@UI.LineItem` : f.type === '#CHART_REFERENCE' ? `@UI.Chart${f.targetQualifier ? '#' + f.targetQualifier : ''}` : '@UI.Identification';
        return `<Record Type="UI.ReferenceFacet"><PropertyValue Property="ID" String="${x(f.id)}"/><PropertyValue Property="Label" String="${x(f.label)}"/><PropertyValue Property="Target" AnnotationPath="${x(target)}"/></Record>`;
      };
      if (m.ui.facets.length) t.push(`<Annotation Term="UI.Facets"><Collection>${m.ui.facets.filter(f => !f.parentId).map(facetRec).join('')}</Collection></Annotation>`);
      // analytics: charts, presentation variant, aggregation capabilities
      const measures = m.fields.filter(f => f.aggregation);
      for (const c of m.ui.charts) {
        const ct = String(c.charttype || '#COLUMN').replace('#', '').toLowerCase().replace(/_(\w)/g, (_, ch) => ch.toUpperCase());
        const chartType = { column: 'Column', bar: 'Bar', line: 'Line', pie: 'Pie', donut: 'Donut', columnStacked: 'ColumnStacked', barStacked: 'BarStacked', area: 'Area', bubble: 'Bubble', scatter: 'Scatter' }[ct] || 'Column';
        t.push(`<Annotation Term="UI.Chart"${c.qualifier ? ` Qualifier="${x(c.qualifier)}"` : ''}><Record Type="UI.ChartDefinitionType"><PropertyValue Property="Title" String="${x(c.title || '')}"/><PropertyValue Property="ChartType" EnumMember="UI.ChartType/${chartType}"/><PropertyValue Property="Dimensions"><Collection>${[].concat(c.dimensions || []).map(d => `<PropertyPath>${x(labelOf(ent, d))}</PropertyPath>`).join('')}</Collection></PropertyValue><PropertyValue Property="Measures"><Collection>${[].concat(c.measures || []).map(d => `<PropertyPath>${x(labelOf(ent, d))}</PropertyPath>`).join('')}</Collection></PropertyValue><PropertyValue Property="DimensionAttributes"><Collection>${[].concat(c.dimensions || []).map((d, i) => `<Record Type="UI.ChartDimensionAttributeType"><PropertyValue Property="Dimension" PropertyPath="${x(labelOf(ent, d))}"/><PropertyValue Property="Role" EnumMember="UI.ChartDimensionRoleType/${i ? 'Series' : 'Category'}"/></Record>`).join('')}</Collection></PropertyValue><PropertyValue Property="MeasureAttributes"><Collection>${[].concat(c.measures || []).map(d => `<Record Type="UI.ChartMeasureAttributeType"><PropertyValue Property="Measure" PropertyPath="${x(labelOf(ent, d))}"/><PropertyValue Property="Role" EnumMember="UI.ChartMeasureRoleType/Axis1"/></Record>`).join('')}</Collection></PropertyValue></Record></Annotation>`);
      }
      if (m.ui.charts.length || measures.length) {
        const chart = m.ui.charts[0];
        t.push(`<Annotation Term="UI.PresentationVariant"><Record Type="UI.PresentationVariantType">${m.ui.sortOrder.length ? `<PropertyValue Property="SortOrder"><Collection>${m.ui.sortOrder.map(s => `<Record Type="Common.SortOrderType"><PropertyValue Property="Property" PropertyPath="${x(s.by)}"/><PropertyValue Property="Descending" Bool="${s.direction === '#DESC'}"/></Record>`).join('')}</Collection></PropertyValue>` : ''}<PropertyValue Property="Visualizations"><Collection>${chart ? `<AnnotationPath>@UI.Chart${chart.qualifier ? '#' + x(chart.qualifier) : ''}</AnnotationPath>` : ''}<AnnotationPath>@UI.LineItem</AnnotationPath></Collection></PropertyValue></Record></Annotation>`);
        t.push(`<Annotation Term="Aggregation.ApplySupported"><Record><PropertyValue Property="Transformations"><Collection><String>aggregate</String><String>groupby</String><String>filter</String></Collection></PropertyValue><PropertyValue Property="GroupableProperties"><Collection>${m.fields.filter(f => !f.aggregation).map(f => `<PropertyPath>${x(f.name)}</PropertyPath>`).join('')}</Collection></PropertyValue><PropertyValue Property="AggregatableProperties"><Collection>${measures.map(f => `<Record Type="Aggregation.AggregatablePropertyType"><PropertyValue Property="Property" PropertyPath="${x(f.name)}"/></Record>`).join('')}</Collection></PropertyValue></Record></Annotation>`);
        for (const f of measures) {
          // measures are exposed as custom aggregates (one definition per property; Analytics.AggregatedProperty would duplicate them)
          t.push(`<Annotation Term="Aggregation.CustomAggregate" Qualifier="${x(f.name)}" String="${f.type}"/>`);
        }
      }
      m.sideEffects.forEach((se, i) => {
        const coll = (tag, items) => `<Collection>${items.map(v => `<${tag}>${x(v)}</${tag}>`).join('')}</Collection>`;
        t.push(`<Annotation Term="Common.SideEffects" Qualifier="se${i + 1}"><Record Type="Common.SideEffectsType">${se.sourceProperties.length ? `<PropertyValue Property="SourceProperties">${coll('PropertyPath', se.sourceProperties)}</PropertyValue>` : ''}${se.targetProperties.length ? `<PropertyValue Property="TargetProperties">${coll('String', se.targetProperties)}</PropertyValue>` : ''}${se.targetEntities.length ? `<PropertyValue Property="TargetEntities">${coll('NavigationPropertyPath', se.targetEntities)}</PropertyValue>` : ''}</Record></Annotation>`);
        if (se.action) ann.push(`<Annotations Target="${ns}.${x(se.action)}(${ns}.${tname})"><Annotation Term="Common.SideEffects"><Record Type="Common.SideEffectsType"><PropertyValue Property="TargetProperties">${coll('String', se.targetProperties.map(p => `_it/${p}`))}</PropertyValue>${se.targetEntities.length ? `<PropertyValue Property="TargetEntities">${coll('NavigationPropertyPath', se.targetEntities.map(e => e ? `_it/${e}` : '_it'))}</PropertyValue>` : ''}</Record></Annotation></Annotations>`);
      });
      if (draft && m.draftRoot) t.push(`<Annotation Term="Common.SemanticKey"><Collection>${(hi?.title?.value ? [labelOf(ent, hi.title.value)] : m.keys).map(k => `<PropertyPath>${x(k)}</PropertyPath>`).join('')}</Collection></Annotation>`);
      ann.push(`<Annotations Target="${ns}.${tname}">${t.join('')}</Annotations>`);
      // entity set annotations: draft root / node, insert restrictions
      const st = [];
      if (draft) {
        st.push(m.draftRoot
          ? `<Annotation Term="Common.DraftRoot"><Record Type="Common.DraftRootType"><PropertyValue Property="ActivationAction" String="${ns}.Activate"/><PropertyValue Property="DiscardAction" String="${ns}.Discard"/><PropertyValue Property="EditAction" String="${ns}.Edit"/><PropertyValue Property="PreparationAction" String="${ns}.Prepare"/><PropertyValue Property="ResumeAction" String="${ns}.Resume"/></Record></Annotation>`
          : `<Annotation Term="Common.DraftNode"><Record Type="Common.DraftNodeType"><PropertyValue Property="PreparationAction" String="${ns}.Prepare"/></Record></Annotation>`);
      }
      if (m.transactional) {
        st.push(`<Annotation Term="Capabilities.InsertRestrictions"><Record><PropertyValue Property="Insertable" Bool="${m.ops.create}"/></Record></Annotation>`);
        // instance feature control (%update / %delete) drives the Edit and Delete buttons per instance
        st.push(hasControl && m.ops.update
          ? `<Annotation Term="Capabilities.UpdateRestrictions"><Record><PropertyValue Property="Updatable" Path="__EntityControl/Updatable"/></Record></Annotation>`
          : `<Annotation Term="Capabilities.UpdateRestrictions"><Record><PropertyValue Property="Updatable" Bool="${m.ops.update}"/></Record></Annotation>`);
        st.push(hasControl && m.ops.delete
          ? `<Annotation Term="Capabilities.DeleteRestrictions"><Record><PropertyValue Property="Deletable" Path="__EntityControl/Deletable"/></Record></Annotation>`
          : `<Annotation Term="Capabilities.DeleteRestrictions"><Record><PropertyValue Property="Deletable" Bool="${m.ops.delete}"/></Record></Annotation>`);
        const navRestr = m.navigation.filter(n => n.target && n.many).map(n => `<Record Type="Capabilities.NavigationPropertyRestriction"><PropertyValue Property="NavigationProperty" NavigationPropertyPath="${x(n.name)}"/><PropertyValue Property="InsertRestrictions"><Record><PropertyValue Property="Insertable" Bool="${n.create}"/></Record></PropertyValue></Record>`);
        if (navRestr.length) st.push(`<Annotation Term="Capabilities.NavigationRestrictions"><Record><PropertyValue Property="RestrictedProperties"><Collection>${navRestr.join('')}</Collection></PropertyValue></Record></Annotation>`);
      } else st.push(`<Annotation Term="Capabilities.InsertRestrictions"><Record><PropertyValue Property="Insertable" Bool="false"/></Record></Annotation><Annotation Term="Capabilities.UpdateRestrictions"><Record><PropertyValue Property="Updatable" Bool="false"/></Record></Annotation><Annotation Term="Capabilities.DeleteRestrictions"><Record><PropertyValue Property="Deletable" Bool="false"/></Record></Annotation>`);
      st.push(`<Annotation Term="Capabilities.SearchRestrictions"><Record><PropertyValue Property="Searchable" Bool="true"/></Record></Annotation>`);
      for (const f of ent.fields.filter(z => this.streamOf(z))) {
        const sf = this.streamFields(ent, f);
        ann.push(`<Annotations Target="${ns}.${tname}/${x(f.label)}">${sf.mime ? `<Annotation Term="Core.MediaType" Path="${x(sf.mime.label)}"/>` : ''}${sf.file ? `<Annotation Term="Core.ContentDisposition"><Record><PropertyValue Property="Filename" Path="${x(sf.file.label)}"/><PropertyValue Property="Type" String="${sf.disposition === 'inline' ? 'inline' : 'attachment'}"/></Record></Annotation>` : ''}${sf.accept.length ? `<Annotation Term="Core.AcceptableMediaTypes"><Collection>${sf.accept.map(a => `<String>${x(a)}</String>`).join('')}</Collection></Annotation>` : ''}</Annotations>`);
        if (sf.mime) ann.push(`<Annotations Target="${ns}.${tname}/${x(sf.mime.label)}"><Annotation Term="Core.IsMediaType"/></Annotations>`);
      }
      if (hier) ann.push(`<Annotations Target="${ns}.${tname}"><Annotation Term="Aggregation.RecursiveHierarchy" Qualifier="${x(hier.qualifier)}"><Record><PropertyValue Property="NodeProperty" PropertyPath="${x(hier.nodeLabel)}"/>${hier.parentNav ? `<PropertyValue Property="ParentNavigationProperty" NavigationPropertyPath="${x(hier.parentNav)}"/>` : ''}</Record></Annotation><Annotation Term="Hierarchy.RecursiveHierarchy" Qualifier="${x(hier.qualifier)}"><Record><PropertyValue Property="LimitedDescendantCount" Path="LimitedDescendantCount"/><PropertyValue Property="DistanceFromRoot" Path="DistanceFromRoot"/><PropertyValue Property="DrillState" Path="DrillState"/><PropertyValue Property="LimitedRank" Path="LimitedRank"/></Record></Annotation></Annotations>`);
      const etagF = this.etagField(ent);
      if (m.transactional && etagF) st.push(`<Annotation Term="Core.OptimisticConcurrency"><Collection><PropertyPath>${x(this.field(ent, etagF).label)}</PropertyPath></Collection></Annotation>`);
      ann.push(`<Annotations Target="${ns}.Container/${x(setName)}">${st.join('')}</Annotations>`);
      // action availability from instance feature control
      if (hasControl) for (const a of m.actions) ann.push(`<Annotations Target="${ns}.${x(a.name)}(${ns}.${tname})"><Annotation Term="Core.OperationAvailable" Path="_it/__OperationControl/${x(a.name)}"/></Annotations>`);
      // property annotations
      for (const f of m.fields) {
        const pa = [`<Annotation Term="Common.Label" String="${x(f.label)}"/>`];
        if (f.hidden) pa.push('<Annotation Term="UI.Hidden"/>');
        // Computed: never set by a client; Immutable: set on create only (e.g. keys with external numbering)
        if (f.readonlyCreate || (f.key && m.keysNumbered)) pa.push('<Annotation Term="Core.Computed"/>');
        else if (f.readonly || f.readonlyUpdate) pa.push('<Annotation Term="Core.Immutable"/>');
        if (f.mandatory) pa.push('<Annotation Term="Common.FieldControl" EnumMember="Common.FieldControlType/Mandatory"/>');
        if (f.text) pa.push(`<Annotation Term="Common.Text" Path="${x(labelOf(ent, f.text))}"><Annotation Term="UI.TextArrangement" EnumMember="UI.TextArrangementType/TextFirst"/></Annotation>`);
        if (f.semantics?.amount?.currencycode) pa.push(`<Annotation Term="Measures.ISOCurrency" Path="${x(labelOf(ent, f.semantics.amount.currencycode))}"/>`);
        if (f.semantics?.quantity?.unitofmeasure) pa.push(`<Annotation Term="Measures.Unit" Path="${x(labelOf(ent, f.semantics.quantity.unitofmeasure))}"/>`);
        if (f.aggregation) pa.push('<Annotation Term="Analytics.Measure"/>');
        else if (m.ui.charts.length) pa.push('<Annotation Term="Analytics.Dimension"/>');
        if (f.valueHelp) {
          const vhSet = this.setOfEntity(srv, f.valueHelp.entity);
          const vhEnt = this.model.entities.get(f.valueHelp.entity);
          if (vhSet && vhEnt) {
            const el = vhEnt.fields.find(z => z.name === String(f.valueHelp.element).toLowerCase())?.label || f.valueHelp.element;
            const display = vhEnt.fields.filter(z => z.label !== el && ['c', 'string'].includes(z.ti.t)).slice(0, 3);
            if (f.valueHelp.fixed) pa.push('<Annotation Term="Common.ValueListWithFixedValues"/>');
            pa.push(`<Annotation Term="Common.ValueList"><Record Type="Common.ValueListType"><PropertyValue Property="CollectionPath" String="${x(vhSet)}"/><PropertyValue Property="SearchSupported" Bool="true"/><PropertyValue Property="Parameters"><Collection><Record Type="Common.ValueListParameterInOut"><PropertyValue Property="LocalDataProperty" PropertyPath="${x(f.name)}"/><PropertyValue Property="ValueListProperty" String="${x(el)}"/></Record>${display.map(d => `<Record Type="Common.ValueListParameterDisplayOnly"><PropertyValue Property="ValueListProperty" String="${x(d.label)}"/></Record>`).join('')}</Collection></PropertyValue></Record></Annotation>`);
          }
        }
        ann.push(`<Annotations Target="${ns}.${tname}/${x(f.name)}">${pa.join('')}</Annotations>`);
      }
      if (draft) {
        ann.push(`<Annotations Target="${ns}.${tname}/IsActiveEntity"><Annotation Term="UI.Hidden"/></Annotations>`, `<Annotations Target="${ns}.${tname}/HasActiveEntity"><Annotation Term="UI.Hidden"/></Annotations>`, `<Annotations Target="${ns}.${tname}/HasDraftEntity"><Annotation Term="UI.Hidden"/></Annotations>`);
      }
    }
    if (needsDraftAdmin) {
      types.push(`<EntityType Name="DraftAdministrativeDataType"><Key><PropertyRef Name="DraftUUID"/></Key><Property Name="DraftUUID" Type="Edm.Guid" Nullable="false"/><Property Name="CreationDateTime" Type="Edm.DateTimeOffset" Precision="7"/><Property Name="CreatedByUser" Type="Edm.String" MaxLength="12"/><Property Name="DraftIsCreatedByMe" Type="Edm.Boolean"/><Property Name="LastChangeDateTime" Type="Edm.DateTimeOffset" Precision="7"/><Property Name="LastChangedByUser" Type="Edm.String" MaxLength="12"/><Property Name="InProcessByUser" Type="Edm.String" MaxLength="12"/><Property Name="DraftIsProcessedByMe" Type="Edm.Boolean"/><Property Name="DraftIsLastChangedByMe" Type="Edm.Boolean"/><Property Name="CreatedByUserDescription" Type="Edm.String" MaxLength="80"/><Property Name="LastChangedByUserDescription" Type="Edm.String" MaxLength="80"/><Property Name="InProcessByUserDescription" Type="Edm.String" MaxLength="80"/></EntityType>`);
    }
    if (types.some(t => t.includes('__EntityControl'))) types.push('<ComplexType Name="EntityControl"><Property Name="Deletable" Type="Edm.Boolean" Nullable="false"/><Property Name="Updatable" Type="Edm.Boolean" Nullable="false"/></ComplexType>');
    const ref = (uri, ns2, alias) => `<edmx:Reference Uri="${uri}"><edmx:Include Namespace="${ns2}" Alias="${alias}"/></edmx:Reference>`;
    const voc = 'https://sap.github.io/odata-vocabularies/vocabularies';
    const oasis = 'https://oasis-tcs.github.io/odata-vocabularies/vocabularies';
    return `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx">
${ref(`${voc}/Common.xml`, 'com.sap.vocabularies.Common.v1', 'Common')}
${ref(`${voc}/UI.xml`, 'com.sap.vocabularies.UI.v1', 'UI')}
${ref(`${voc}/Analytics.xml`, 'com.sap.vocabularies.Analytics.v1', 'Analytics')}
${ref(`${oasis}/Org.OData.Core.V1.xml`, 'Org.OData.Core.V1', 'Core')}
${ref(`${oasis}/Org.OData.Capabilities.V1.xml`, 'Org.OData.Capabilities.V1', 'Capabilities')}
${ref(`${oasis}/Org.OData.Aggregation.V1.xml`, 'Org.OData.Aggregation.V1', 'Aggregation')}
${ref(`${voc}/Hierarchy.xml`, 'com.sap.vocabularies.Hierarchy.v1', 'Hierarchy')}
${ref(`${oasis}/Org.OData.Measures.V1.xml`, 'Org.OData.Measures.V1', 'Measures')}
<edmx:DataServices><Schema Namespace="${ns}" Alias="SAP__self" xmlns="http://docs.oasis-open.org/odata/ns/edm">
${types.join('\n')}
${actions.join('\n')}
<EntityContainer Name="Container">${sets.join('')}</EntityContainer>
${ann.join('\n')}
</Schema></edmx:DataServices></edmx:Edmx>`;
  }

  // value help: simple search on any entity
  // a value help with few values is a drop-down: @ObjectModel.resultSet.sizeCategory: #XS on the value help view
  fixedValues(entityName) {
    const e = this.model.entities.get(String(entityName).toLowerCase());
    return String(e?.ann?.objectmodel?.resultset?.sizecategory || '').toUpperCase() === '#XS';
  }
  // the built-in UI's value helps: only entities some field names as its value help (@Consumption.valueHelpDefinition),
  // never a database table, read as the user of the request with their authorizations (CDS access controls)
  valueHelp(entityName, search, top = 50, headers = {}) {
    const name = String(entityName).toLowerCase();
    const ent = this.model.entities.get(name);
    const targets = new Set();
    for (const e of this.model.entities.values()) for (const f of e.fields || []) {
      const vh = f.ann?.consumption?.valuehelpdefinition;
      for (const d of Array.isArray(vh) ? vh : [vh]) if (d?.entity?.name) targets.add(String(d.entity.name).toLowerCase());
    }
    if (!ent || ent.broken || ent.kind === 'table' || !targets.has(name)) throw new RapError(404, `Value help entity ${entityName} not found`);
    this.user = userOf(headers);
    this.app.rt.sy.uname = this.user;
    this.app.rt.authStore = this.authStore || null;
    this.app.rt.auth = this.authStore ? this.authStore.authorizationsOf(this.user) : null;
    this.db.setSessionUser?.(this.user);
    return this.query(null, ent, { $search: search || '', $top: String(Math.min(Number(top) || 50, 1000)) }, null);
  }
}

function sqlStr(v) { return `'${String(v ?? '').replace(/'/g, "''")}'`; }
function msToTs(ms) {
  const d = new Date(ms);
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return Number(`${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`);
}
function tsToMs(ts) {
  const s = String(Math.floor(Number(ts) || 0)).padEnd(14, '0');
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14));
}
function withDraftCols(base, r) {
  for (const k of ['$isactive', '$hasactive', '$hasdraft', '$mydraft', '$lockowner', '$lockfresh', '$draftuuid', '$draftcreated', '$draftchanged', '$draftuser']) base[k] = r[k];
  return base;
}
// current user: header x-rap-user, HTTP basic auth, or cookie rap_user (set by the UI user switcher)
export function userOf(headers = {}) {
  let u = headers['x-rap-user'];
  if (!u && /^Basic /i.test(headers.authorization || '')) u = Buffer.from(headers.authorization.slice(6), 'base64').toString().split(':')[0];
  if (!u) u = /(?:^|;\s*)rap_user=([^;]+)/.exec(headers.cookie || '')?.[1];
  return (decodeURIComponent(u || 'DEVELOPER')).toUpperCase().replace(/[^A-Z0-9_.@-]/g, '').slice(0, 12) || 'DEVELOPER';
}

function tx0Key(r) {
  if (r.$inst) return { ...r.$inst.key }; // final key after late numbering
  const { '%param': _p, '%cid': _c, '%cid_ref': _r, ...k } = r;
  return k;
}
function lower(h) { return Object.fromEntries(Object.entries(h || {}).map(([k, v]) => [k.toLowerCase(), v])); }
function selectList(sel) {
  if (!sel) return null;
  return sel.split(',').map(s => s.trim()).filter(s => s && !s.startsWith('__')).map(s => s.toLowerCase());
}
function wantsControl(sel) { return !sel || /__EntityControl|__OperationControl/.test(sel); }
function defaultAggregation(f) {
  const d = f.ann?.aggregation?.default;
  return d ? String(d).replace('#', '').toUpperCase() : null;
}
function errorResponse(e) {
  const status = e instanceof RapError ? e.status : 500;
  const message = e?.get_text ? e.get_text().$ret : e.message;
  const details = (e.details || []).map(d => ({ code: '', message: d.text, target: d.targets?.[0] || '', '@Common.numericSeverity': SEVERITY[d.severity] ?? 4 }));
  return { status, body: { error: { code: String(status), message, target: details[0]?.target || '', details, '@Common.numericSeverity': 4 } } };
}
export { errorResponse, parseMultipart, parseHttp };

// ------------------------------------------------------------------ multipart helpers
function parseMultipart(body, boundary) {
  const parts = [];
  const delim = `--${boundary}`;
  const chunks = body.split(delim);
  for (let i = 1; i < chunks.length; i++) {
    let c = chunks[i];
    if (c.startsWith('--')) break;
    c = c.replace(/^\r?\n/, '');
    const sep = c.search(/\r?\n\r?\n/);
    const head = sep < 0 ? c : c.slice(0, sep);
    const rest = sep < 0 ? '' : c.slice(sep).replace(/^\r?\n\r?\n/, '');
    const headers = {};
    for (const line of head.split(/\r?\n/)) { const k = line.indexOf(':'); if (k > 0) headers[line.slice(0, k).trim().toLowerCase()] = line.slice(k + 1).trim(); }
    parts.push({ headers, body: rest.replace(/\r?\n$/, '') });
  }
  return parts;
}
function parseHttp(text) {
  const sep = text.search(/\r?\n\r?\n/);
  const head = sep < 0 ? text : text.slice(0, sep);
  const body = sep < 0 ? '' : text.slice(sep).replace(/^\r?\n\r?\n/, '');
  const lines = head.split(/\r?\n/);
  const [method, url] = lines[0].split(' ');
  const headers = {};
  for (const line of lines.slice(1)) { const k = line.indexOf(':'); if (k > 0) headers[line.slice(0, k).trim().toLowerCase()] = line.slice(k + 1).trim(); }
  return { method, url, headers, body };
}
const STATUS_TEXT = { 200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 412: 'Precondition Failed', 500: 'Internal Server Error' };
function httpPart(res, contentId) {
  const isJson = res.body !== null && typeof res.body === 'object';
  const body = res.body === null || res.body === undefined ? '' : isJson ? JSON.stringify(res.body) : String(res.body);
  const hdrs = { ...(body ? { 'Content-Type': isJson ? 'application/json;odata.metadata=minimal;IEEE754Compatible=true' : (res.headers?.['Content-Type'] || 'text/plain') } : {}), 'OData-Version': '4.0', ...Object.fromEntries(Object.entries(res.headers || {}).filter(([k]) => k !== 'Content-Type')) };
  return `Content-Type: application/http\r\nContent-Transfer-Encoding: binary\r\n${contentId ? `Content-ID: ${contentId}\r\n` : ''}\r\nHTTP/1.1 ${res.status} ${STATUS_TEXT[res.status] || ''}\r\n${Object.entries(hdrs).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n${body}\r\n`;
}

// ------------------------------------------------------------------ $filter
class FilterParser {
  constructor(text, ent, svc, applyCols = null) { this.toks = tokenizeFilter(text); this.i = 0; this.ent = ent; this.svc = svc; this.params = []; this.applyCols = applyCols; }
  peek(k = 0) { return this.toks[this.i + k]; }
  next() { return this.toks[this.i++]; }
  is(v) { const t = this.peek(); return t && (t.v === v || (t.t === 'id' && String(t.v).toLowerCase() === v)); }
  parse() { const sql = this.or(); if (this.i < this.toks.length) throw new RapError(400, `Unexpected '${this.peek().v}' in $filter`); return { sql, params: this.params }; }
  or() { let l = this.and(); while (this.is('or')) { this.next(); l = `(${l} OR ${this.and()})`; } return l; }
  and() { let l = this.not(); while (this.is('and')) { this.next(); l = `(${l} AND ${this.not()})`; } return l; }
  not() { if (this.is('not')) { this.next(); return `(NOT ${this.cmp()})`; } return this.cmp(); }
  cmp() {
    if (this.is('(')) { this.next(); const e = this.or(); this.next(); return `(${e})`; }
    const t = this.peek();
    if (t.t === 'id' && this.peek(1)?.v === '(') {
      const fn = this.next().v.toLowerCase();
      this.next();
      const left = this.operand();
      if (fn === 'tolower' || fn === 'toupper' || fn === 'trim') {
        this.next(); // )
        const sqlFn = { tolower: 'lower', toupper: 'upper', trim: 'trim' }[fn];
        return this.comparison({ ...left, sql: `${sqlFn}(${left.sql})` });
      }
      this.next(); // ,
      const lit = this.literal();
      this.next(); // )
      const v = String(lit.v).toLowerCase();
      const pat = fn === 'contains' ? `%${v}%` : fn === 'startswith' ? `${v}%` : fn === 'endswith' ? `%${v}` : null;
      if (!pat) throw new RapError(400, `Unsupported function ${fn} in $filter`);
      this.params.push(pat);
      return `lower(${left.sql}) LIKE ?`;
    }
    return this.comparison(this.operand());
  }
  comparison(left) {
    const op = this.next()?.v.toLowerCase();
    if (op === 'in') {
      this.next(); // (
      const vals = [];
      while (!this.is(')')) { const l = this.next(); if (l.v === ',') continue; vals.push(l); }
      this.next();
      for (const v of vals) this.params.push(left.ti ? fromOData(v.v, left.ti) : v.v);
      return `${left.sql} IN (${vals.map(() => '?').join(', ')})`;
    }
    const ops = { eq: '=', ne: '<>', gt: '>', ge: '>=', lt: '<', le: '<=' };
    if (!ops[op]) throw new RapError(400, `Unsupported operator ${op} in $filter`);
    const lit = this.literal();
    if (left.special) return left.special(op, lit);
    if (lit.t === 'null') {
      const empty = left.ti && ['i', 'int8', 'p', 'f', 'tsl', 'ts'].includes(left.ti.t) ? '0' : "''";
      return op === 'eq' ? `(${left.sql} IS NULL OR ${left.sql} = ${empty})` : `(${left.sql} IS NOT NULL AND ${left.sql} <> ${empty})`;
    }
    if (left.bool) { this.params.push(lit.v === true || lit.v === 'true' ? 1 : 0); return `${left.sql} ${ops[op]} ?`; }
    this.params.push(left.ti ? fromOData(lit.v, left.ti) : lit.v);
    return `${left.sql} ${ops[op]} ?`;
  }
  literal() { const l = this.next(); if (!l) throw new RapError(400, 'Incomplete $filter'); return l; }
  operand() {
    const t = this.next();
    const name = String(t?.v ?? '');
    const lname = name.toLowerCase();
    if (this.applyCols) {
      const c = this.applyCols.find(c => c.label.toLowerCase() === lname || c.name === lname);
      if (c) return { sql: `"${c.name}"`, ti: c.ti };
      // after a groupby / aggregate only its columns exist
      if (t?.t !== 'str' && (DRAFT_PROPS[lname] || lname.startsWith('siblingentity/') || this.svc.field(this.ent, name))) throw new RapError(400, `Unknown property ${name} in $filter`);
    }
    if (lname === 'isactiveentity') {
      // "IsActiveEntity eq null" (launchpad/OVP shorthand) means: no sibling draft of the current user
      return { sql: '"$isactive"', bool: true, special: (op, lit) => {
        if (lit.t !== 'null') { this.params.push(lit.v === true || lit.v === 'true' ? 1 : 0); return `"$isactive" ${op === 'ne' ? '<>' : '='} ?`; }
        const none = `(("$isactive" = 1 AND "$mydraft" = 0) OR ("$isactive" = 0 AND "$hasactive" = 0))`;
        return op === 'eq' ? none : `NOT ${none}`;
      } };
    }
    if (DRAFT_COLS[lname]) return { sql: `"${DRAFT_COLS[lname]}"`, bool: true };
    // draft protocol paths used by SAP Fiori elements
    if (lname === 'siblingentity/isactiveentity') {
      // no sibling for the current user: active without own draft, or a new draft without active instance
      return { special: (op, lit) => {
        const none = `(("$isactive" = 1 AND "$mydraft" = 0) OR ("$isactive" = 0 AND "$hasactive" = 0))`;
        return (lit.t === 'null') === (op === 'eq') ? none : `NOT ${none}`;
      } };
    }
    if (lname.startsWith('draftadministrativedata/')) {
      const prop = lname.split('/')[1];
      const expr = prop === 'inprocessbyuser' ? this.svc.inProcessSql() : prop === 'createdbyuser' || prop === 'lastchangedbyuser' ? `COALESCE("$lockowner", '')` : null;
      if (!expr) return { special: () => '1=1' };
      return { special: (op, lit) => {
        this.params.push(lit.t === 'null' ? '' : String(lit.v));
        return `${expr} ${op === 'eq' ? '=' : '<>'} ?`;
      } };
    }
    const f = this.svc.field(this.ent, name);
    if (!f) throw new RapError(400, `Unknown property ${name} in $filter`);
    return { sql: `"${f.name}"`, ti: f.ti };
  }
}
function tokenizeFilter(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") { let v = ''; i++; while (i < s.length) { if (s[i] === "'" && s[i + 1] === "'") { v += "'"; i += 2; continue; } if (s[i] === "'") break; v += s[i++]; } i++; out.push({ t: 'str', v }); continue; }
    if ('(),'.includes(c)) { out.push({ t: 'p', v: c }); i++; continue; }
    const m = /^[^\s(),']+/.exec(s.slice(i));
    const w = m[0];
    i += w.length;
    if (w === 'null') out.push({ t: 'null', v: null });
    else if (w === 'true' || w === 'false') out.push({ t: 'bool', v: w === 'true' });
    else if (/^-?\d+(\.\d+)?$/.test(w)) out.push({ t: 'num', v: Number(w) });
    else if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(w) || /^\d{4}-\d{2}-\d{2}/.test(w)) out.push({ t: 'str', v: w });
    else out.push({ t: 'id', v: w });
  }
  return out;
}
// $filter as ranges per element (if_rap_query_filter~get_as_ranges): only "and" of simple comparisons,
// "or" of comparisons on one element, contains/startswith/endswith; otherwise null
function filterRanges(filter, ent, svc) {
  const out = new Map();
  const OPS = { eq: 'EQ', ne: 'NE', gt: 'GT', ge: 'GE', lt: 'LT', le: 'LE' };
  const strip = s => { s = s.trim(); while (/^\(.*\)$/s.test(s) && splitTop(s.slice(1, -1), ' or ').length >= 1 && balanced(s.slice(1, -1))) s = s.slice(1, -1).trim(); return s; };
  for (const term of splitTop(strip(filter), ' and ')) {
    const alts = splitTop(strip(term), ' or ');
    for (const alt of alts) {
      const a = strip(alt);
      let m = /^(\w+)\s+(eq|ne|gt|ge|lt|le)\s+(.+)$/i.exec(a), name, row;
      if (m) {
        const f = svc.field(ent, m[1]);
        if (!f) return null;
        name = f.name.toUpperCase(); row = { sign: 'I', option: OPS[m[2].toLowerCase()], low: parseLiteral(m[3].trim(), f.ti), high: '' };
      } else if ((m = /^(contains|startswith|endswith)\((\w+),\s*'((?:[^']|'')*)'\)$/i.exec(a))) {
        const f = svc.field(ent, m[2]);
        if (!f) return null;
        const v = m[3].replace(/''/g, "'");
        name = f.name.toUpperCase(); row = { sign: 'I', option: 'CP', low: m[1].toLowerCase() === 'contains' ? `*${v}*` : m[1].toLowerCase() === 'startswith' ? `${v}*` : `*${v}`, high: '' };
      } else return null;
      if (alts.length > 1 && out.has(name) && out.get(name).term !== term) return null;
      if (!out.has(name)) out.set(name, { term, range: [] });
      else if (alts.length === 1 && out.get(name).term !== term) { /* several ANDed conditions on one element cannot be one range */ return null; }
      out.get(name).range.push(row);
    }
  }
  return [...out.entries()].map(([name, x]) => ({ name, range: x.range }));
}
function balanced(s) { let d = 0; for (const c of s) { if (c === '(') d++; if (c === ')' && --d < 0) return false; } return d === 0; }
function splitTop(s, sep) {
  const out = []; let d = 0, q = false, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") q = !q;
    if (q) continue;
    if (c === '(') d++; else if (c === ')') d--;
    else if (d === 0 && s.slice(i, i + sep.length).toLowerCase() === sep) { out.push(s.slice(start, i)); start = i + sep.length; i += sep.length - 1; }
  }
  out.push(s.slice(start));
  return out.map(x => x.trim()).filter(Boolean);
}

function splitTopComma(s) {
  const out = [];
  let depth = 0, cur = '', q = false;
  for (const c of s) {
    if (c === "'") q = !q;
    if (!q && c === '(') depth++;
    if (!q && c === ')') depth--;
    if (!q && !depth && c === ',') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
// the conditions of a top-level "and" ("a eq 1 and (b eq 2 or c eq 3)" -> two)
function splitTopAnd(s) {
  const out = [];
  let depth = 0, cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") q = !q;
    if (!q && c === '(') depth++;
    if (!q && c === ')') depth--;
    if (!q && !depth && /^\sand\s/i.test(s.slice(i, i + 5))) { out.push(cur); cur = ''; i += 4; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}
function splitTopSlash(s) {
  const out = [];
  let depth = 0, cur = '', q = false;
  for (const c of s) {
    if (c === "'") q = !q;
    if (!q && c === '(') depth++;
    if (!q && c === ')') depth--;
    if (!q && !depth && c === '/') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
// path segments, keeping key predicates with slashes / quotes intact
function splitPath(p) {
  const out = [];
  let depth = 0, cur = '', q = false;
  for (const c of p) {
    if (c === "'") q = !q;
    if (!q && c === '(') depth++;
    if (!q && c === ')') depth--;
    if (!q && !depth && c === '/') { if (cur) out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}
function parseExpandOptions(s) {
  const out = {};
  let depth = 0, cur = '';
  const flush = () => { const i = cur.indexOf('='); if (i > 0) out[cur.slice(0, i).trim()] = cur.slice(i + 1).trim(); cur = ''; };
  for (const c of s) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (!depth && c === ';') { flush(); continue; }
    cur += c;
  }
  flush();
  return out;
}
function parseLiteral(s, ti) {
  if (s.startsWith("'")) return fromOData(s.slice(1, -1).replace(/''/g, "'"), ti);
  if (s.startsWith('guid')) return fromOData(s.slice(5, -1), ti);
  return fromOData(s, ti);
}
export function humanize(name) {
  return String(name).replace(/^_/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/_/g, ' ').replace(/\bI D\b/g, 'ID').replace(/\bUUID\b/i, 'UUID').replace(/^./, c => c.toUpperCase());
}
