// OData V2 for RAP services (service binding type ODATA V2, like a SEGW / Gateway service), at
//   <app>/sap/opu/odata/sap/<SERVICE>/            service document, $metadata, entity sets, $batch
// It translates each V2 request into the service's OData V4 request and the V4 result back into V2 JSON
// ({ d: { results, __count } }, __metadata, /Date(..)/ values, __deferred navigation), so the RAP behaviour
// (determinations, validations, actions, draft, authorizations, ETags) is the same in both protocols.
// Bound actions become function imports (POST, the key fields and action parameters as URL parameters).
import { RapError } from '../rap/rap.js';
import { errorResponse, parseMultipart, parseHttp } from './odata.js';

const V2_TYPE = { 'Edm.Date': 'Edm.DateTime', 'Edm.TimeOfDay': 'Edm.Time', 'Edm.Stream': null };
const x = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const STATUS_TEXT = { 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 412: 'Precondition Failed', 500: 'Internal Server Error' };

export class ODataV2 {
  constructor(odata) { this.odata = odata; this.cache = new Map(); }

  // the service and its V2 view (types per entity set, function imports), cached per activation
  meta(name) {
    const srv = this.odata.service(String(name).toLowerCase().replace(/_srv$/, ''));
    const key = `${srv.name}|${this.odata.app.version ?? ''}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const ui = this.odata.uiMetadata(srv);
    const ns = `${srv.name.toUpperCase()}_SRV`;
    const sets = {};
    for (const [setName, m] of Object.entries(ui.entitySets)) {
      const draft = !!m.draft;
      const fields = m.fields.filter(f => V2_TYPE[f.type] !== null);
      const types = Object.fromEntries(fields.map(f => [f.name, f.type]));
      if (draft) Object.assign(types, { IsActiveEntity: 'Edm.Boolean', HasActiveEntity: 'Edm.Boolean', HasDraftEntity: 'Edm.Boolean' });
      sets[setName] = { name: setName, type: `${setName}Type`, m, draft, fields, types, keys: [...m.keys, ...(draft ? ['IsActiveEntity'] : [])], navs: m.navigation.filter(n => n.target && ui.entitySets[n.target]) };
    }
    // bound actions and the draft actions of draft roots as function imports; names stay unique in the service
    const functions = {};
    const add = (name, set, action, params) => { const n = functions[name] ? `${set.name}_${name}` : name; functions[n] = { name: n, set, action, params }; };
    for (const set of Object.values(sets)) {
      for (const a of set.m.actions || []) add(a.name, set, a.name, a.parameters || []);
      if (set.draft && set.m.draftRoot) for (const a of ['Edit', 'Activate', 'Prepare', 'Discard']) add(`${set.name}${a}`, set, a, a === 'Edit' ? [{ name: 'PreserveChanges', type: 'Edm.Boolean' }] : []);
    }
    const v = { srv, ui, ns, container: `${ns}_Entities`, sets, functions };
    this.cache.set(key, v);
    return v;
  }

  // ------------------------------------------------------------------ $metadata (EDMX 1.0, sap: annotations)
  edmx(v) {
    const types = [], assocs = [], entitySets = [], assocSets = [], fis = [];
    const prop = (f, set) => {
      const t = V2_TYPE[f.type] || f.type;
      const facets = [
        t === 'Edm.String' && f.maxLength ? ` MaxLength="${f.maxLength}"` : '',
        t === 'Edm.Decimal' ? ` Precision="${f.maxLength || 16}" Scale="${f.scale ?? 2}"` : '',
        t === 'Edm.DateTimeOffset' ? ' Precision="7"' : '',
        f.type === 'Edm.Date' ? ' Precision="0" sap:display-format="Date"' : '',
      ].join('');
      const ro = f.readonly || f.key;
      const unit = f.semantics?.amount?.currencycode || f.semantics?.quantity?.unitofmeasure;
      return `<Property Name="${x(f.name)}" Type="${t}"${set.keys.includes(f.name) ? ' Nullable="false"' : ''}${facets} sap:label="${x(f.label || f.name)}"${f.text ? ` sap:text="${x(f.text)}"` : ''}${unit ? ` sap:unit="${x(unit)}"` : ''}${ro ? ' sap:creatable="false" sap:updatable="false"' : f.readonlyUpdate ? ' sap:updatable="false"' : ''}${f.semantics?.currencycode ? ' sap:semantics="currency-code"' : ''}/>`;
    };
    for (const set of Object.values(v.sets)) {
      const props = set.fields.map(f => prop(f, set));
      if (set.draft) props.push('<Property Name="IsActiveEntity" Type="Edm.Boolean" Nullable="false" sap:label="Is active" sap:creatable="false" sap:updatable="false"/>',
        '<Property Name="HasActiveEntity" Type="Edm.Boolean" Nullable="false" sap:creatable="false" sap:updatable="false"/>', '<Property Name="HasDraftEntity" Type="Edm.Boolean" Nullable="false" sap:creatable="false" sap:updatable="false"/>');
      const navs = set.navs.map(n => {
        const a = `assoc_${set.name}_${n.name}`;
        assocs.push(`<Association Name="${x(a)}"><End Type="${v.ns}.${set.type}" Multiplicity="${n.toParent ? '*' : '1'}" Role="FromRole_${x(a)}"/><End Type="${v.ns}.${v.sets[n.target].type}" Multiplicity="${n.many ? '*' : n.toParent ? '1' : '0..1'}" Role="ToRole_${x(a)}"/></Association>`);
        assocSets.push(`<AssociationSet Name="${x(a)}_set" Association="${v.ns}.${x(a)}" sap:creatable="false" sap:updatable="false" sap:deletable="false"><End EntitySet="${x(set.name)}" Role="FromRole_${x(a)}"/><End EntitySet="${x(n.target)}" Role="ToRole_${x(a)}"/></AssociationSet>`);
        return `<NavigationProperty Name="${x(n.name)}" Relationship="${v.ns}.${x(a)}" FromRole="FromRole_${x(a)}" ToRole="ToRole_${x(a)}"/>`;
      });
      types.push(`<EntityType Name="${x(set.type)}" sap:label="${x(set.m.label || set.name)}" sap:content-version="1"><Key>${set.keys.map(k => `<PropertyRef Name="${x(k)}"/>`).join('')}</Key>${props.join('')}${navs.join('')}</EntityType>`);
      const tx = !!set.m.transactional;
      entitySets.push(`<EntitySet Name="${x(set.name)}" EntityType="${v.ns}.${x(set.type)}" sap:creatable="${tx}" sap:updatable="${tx}" sap:deletable="${tx}" sap:content-version="1"/>`);
    }
    for (const fi of Object.values(v.functions)) {
      const keyParams = fi.set.keys.map(k => `<Parameter Name="${x(k)}" Type="${V2_TYPE[fi.set.types[k]] || fi.set.types[k] || 'Edm.String'}" Mode="In"/>`);
      const params = fi.params.map(p => `<Parameter Name="${x(p.name)}" Type="${V2_TYPE[p.type] || p.type || 'Edm.String'}" Mode="In" Nullable="true"${p.maxLength ? ` MaxLength="${p.maxLength}"` : ''}/>`);
      fis.push(`<FunctionImport Name="${x(fi.name)}"${fi.action === 'Discard' ? '' : ` ReturnType="${v.ns}.${x(fi.set.type)}" EntitySet="${x(fi.set.name)}"`} m:HttpMethod="POST" sap:action-for="${v.ns}.${x(fi.set.type)}"${fi.params.find(p => p.label) ? '' : ''}>${keyParams.join('')}${params.join('')}</FunctionImport>`);
    }
    return `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="1.0" xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns:sap="http://www.sap.com/Protocols/SAPData">
<edmx:DataServices m:DataServiceVersion="2.0">
<Schema Namespace="${v.ns}" xml:lang="en" sap:schema-version="1" xmlns="http://schemas.microsoft.com/ado/2008/09/edm">
${types.join('\n')}
${assocs.join('\n')}
<EntityContainer Name="${v.container}" m:IsDefaultEntityContainer="true" sap:supported-formats="atom json">
${entitySets.join('\n')}
${assocSets.join('\n')}
${fis.join('\n')}
</EntityContainer>
</Schema>
</edmx:DataServices>
</edmx:Edmx>`;
  }

  // ------------------------------------------------------------------ values V2 <-> V4
  toV2Value(type, val) {
    if (val === null || val === undefined) return val;
    if (type === 'Edm.Date') return /^\d{4}-\d{2}-\d{2}$/.test(val) ? `/Date(${Date.parse(`${val}T00:00:00Z`)})/` : val;
    if (type === 'Edm.DateTimeOffset') { const ms = Date.parse(val); return Number.isFinite(ms) ? `/Date(${ms}+0000)/` : val; }
    if (type === 'Edm.TimeOfDay') { const m = /^(\d{2}):(\d{2}):(\d{2})/.exec(val); return m ? `PT${m[1]}H${m[2]}M${m[3]}S` : val; }
    if (type === 'Edm.Decimal' || type === 'Edm.Int64' || type === 'Edm.Double') return String(val);
    return val;
  }
  toV4Value(type, val) {
    if (val === null || val === undefined || typeof val !== 'string') return val;
    const date = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(val);
    if (type === 'Edm.Date') return date ? new Date(Number(date[1])).toISOString().slice(0, 10) : val.slice(0, 10);
    if (type === 'Edm.DateTimeOffset') return date ? new Date(Number(date[1])).toISOString() : val;
    if (type === 'Edm.TimeOfDay') { const m = /^PT(\d+)H(\d+)M(\d+)S$/.exec(val); return m ? `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}:${m[3].padStart(2, '0')}` : val; }
    if (type === 'Edm.Decimal' || type === 'Edm.Double') return Number(val);
    if (type === 'Edm.Int32' || type === 'Edm.Int16' || type === 'Edm.Byte') return Number(val);
    return val;
  }
  keyLiteral(type, val) {
    if (type === 'Edm.Guid') return `guid'${val}'`;
    if (type === 'Edm.String') return `'${String(val).replace(/'/g, "''")}'`;
    if (type === 'Edm.Date') return `datetime'${val}T00:00:00'`;
    return String(val);
  }
  keyOf(v, set, row) { return `${set.name}(${set.keys.map(k => `${k}=${this.keyLiteral(set.types[k], row[k])}`).join(',')})`; }

  entityToV2(v, set, row, base) {
    const out = { __metadata: {} };
    const uri = `${base}${this.keyOf(v, set, row)}`;
    out.__metadata = { id: uri, uri, type: `${v.ns}.${set.type}`, ...(row['@odata.etag'] ? { etag: row['@odata.etag'] } : {}) };
    for (const [k, val] of Object.entries(row)) {
      if (k.startsWith('@') || k.includes('@odata') || k === '__EntityControl' || k === '__OperationControl') continue;
      const nav = set.navs.find(n => n.name === k);
      if (nav) {
        const target = v.sets[nav.target];
        out[k] = Array.isArray(val) ? { results: val.map(r => this.entityToV2(v, target, r, base)) } : val ? this.entityToV2(v, target, val, base) : null;
        continue;
      }
      if (k in set.types) out[k] = this.toV2Value(set.types[k], val);
    }
    for (const n of set.navs) if (!(n.name in out)) out[n.name] = { __deferred: { uri: `${uri}/${n.name}` } };
    return out;
  }
  bodyToV4(v, set, body) {
    if (!body || typeof body !== 'object') return body;
    const out = {};
    for (const [k, val] of Object.entries(body)) {
      if (k === '__metadata' || (val && typeof val === 'object' && val.__deferred)) continue;
      const nav = set.navs.find(n => n.name === k);
      if (nav) { const list = Array.isArray(val?.results) ? val.results : Array.isArray(val) ? val : null; if (list) out[k] = list.map(r => this.bodyToV4(v, v.sets[nav.target], r)); continue; }
      if (['IsActiveEntity', 'HasActiveEntity', 'HasDraftEntity'].includes(k)) continue;
      out[k] = this.toV4Value(set.types[k], val);
    }
    return out;
  }

  // V2 key predicates and $filter literals -> V4
  literalsToV4(s) {
    return String(s)
      .replace(/guid'([0-9a-fA-F-]{32,36})'/g, '$1')
      .replace(/datetime'(\d{4}-\d{2}-\d{2})T00:00(?::00(?:\.0+)?)?'/g, '$1')
      .replace(/datetime'([^']+)'/g, '$1Z')
      .replace(/datetimeoffset'([^']+)'/g, '$1')
      .replace(/time'PT(\d+)H(\d+)M(\d+)S'/g, (a, h, m, sec) => `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${sec.padStart(2, '0')}`)
      // numeric suffixes (12.5M, 10L): only on standalone numbers, never inside a GUID or name
      .replace(/(?<![\w.'])(-?\d+(?:\.\d+)?)[mMdDfF](?=[,)\s]|$)/g, '$1')
      .replace(/(?<![\w.'])(-?\d+)L(?=[,)\s]|$)/g, '$1');
  }
  filterToV4(f) {
    return this.literalsToV4(f)
      .replace(/substringof\(\s*('(?:[^']|'')*')\s*,\s*([\w/]+)\s*\)(\s+eq\s+true)?/gi, 'contains($2,$1)')
      .replace(/\b((?:startswith|endswith)\([^()]*\))\s+eq\s+true/gi, '$1');
  }
  queryToV4(q) {
    const out = new URLSearchParams();
    for (const [k, val] of Object.entries(q)) {
      if (k === '$inlinecount') { if (val === 'allpages') out.set('$count', 'true'); continue; }
      if (k === '$filter') { out.set(k, this.filterToV4(val)); continue; }
      if (k === '$format' || k === '$skiptoken' || k.startsWith('sap-')) continue;
      if (k === '$expand') { out.set(k, val.split(',').map(e => e.trim().split('/')[0]).filter(Boolean).join(',')); continue; }
      out.set(k, val);
    }
    return out.toString();
  }

  // ------------------------------------------------------------------ requests
  // path: below /sap/opu/odata/sap/ ("ZUI_TRAVEL/Travel?..."); returns { status, headers, body }
  handle(method, path, body, headers = {}) {
    method = String(headers['x-http-method'] || method).toUpperCase();
    try { return this.dispatch(method, path, body, headers); }
    catch (e) { return this.error(e); }
  }
  error(e) {
    const r = errorResponse(e);
    const err = r.body.error;
    return { status: r.status, headers: { 'Content-Type': 'application/json' }, body: { error: { code: err.code, message: { lang: 'en', value: err.message }, innererror: { errordetails: (err.details || []).map(d => ({ code: d.code, message: d.message, target: d.target, severity: 'error' })) } } } };
  }
  dispatch(method, path, body, headers) {
    const u = new URL(path, 'http://x');
    const segs = decodeURIComponent(u.pathname).replace(/^\//, '').split('/').filter(Boolean);
    const v = this.meta(segs.shift());
    const base = `${headers['x-rap-base'] || ''}/sap/opu/odata/sap/${v.ns.replace(/_SRV$/, '')}/`;
    const q = Object.fromEntries(u.searchParams);
    const v4base = `/odata/${v.srv.name}/`;
    const v4 = (m, rel, b) => this.odata.handle(m, v4base + rel, b, { ...headers, accept: 'application/json' });
    const json = (status, payload, extra = {}) => ({ status, headers: { 'Content-Type': 'application/json', DataServiceVersion: '2.0', ...messageHeader(extra) }, body: payload });

    if (!segs.length) return json(200, { d: { EntitySets: Object.keys(v.sets) } });
    if (segs[0] === '$metadata') return { status: 200, headers: { 'Content-Type': 'application/xml', DataServiceVersion: '2.0' }, body: this.edmx(v) };

    const m = /^([^(]+)(?:\((.*)\))?$/.exec(segs[0]);
    const fi = v.functions[m[1]];
    if (fi && !v.sets[m[1]]) {
      // declared m:HttpMethod="POST": an action must never run from a GET (a link or an <img> would trigger it
      // with the user's session cookie)
      if (method !== 'POST') return { status: 405, headers: { Allow: 'POST', 'Content-Type': 'application/json', DataServiceVersion: '2.0' }, body: { error: { code: '405', message: { lang: 'en', value: `Function import ${m[1]} requires POST` } } } };
      return this.functionImport(v, fi, q, base, v4, json);
    }
    let set = v.sets[m[1]];
    if (!set) throw new RapError(404, `Resource ${m[1]} not found in service ${v.ns}`);
    let rel = `${set.name}${m[2] !== undefined ? `(${this.literalsToV4(m[2])})` : ''}`;
    let single = m[2] !== undefined;
    for (const seg of segs.slice(1)) {
      if (seg === '$count') { const r = v4('GET', `${rel}/$count?${this.queryToV4(q)}`); return { status: 200, headers: { 'Content-Type': 'text/plain', DataServiceVersion: '2.0' }, body: String(r.body) }; }
      const nav = set.navs.find(n => n.name === seg);
      if (!nav) throw new RapError(404, `Unknown navigation ${seg}`);
      rel += `/${seg}`; set = v.sets[nav.target]; single = !nav.many;
    }
    const query = this.queryToV4(q);
    const r = v4(method === 'MERGE' || method === 'PUT' ? 'PATCH' : method, `${rel}${query ? `?${query}` : ''}`, ['POST', 'PUT', 'MERGE', 'PATCH'].includes(method) ? this.bodyToV4(v, set, body) : null);
    if (r.status >= 400) return this.error(Object.assign(new RapError(r.status, r.body?.error?.message || 'Error'), { details: [] }));
    if (method === 'DELETE' || method === 'MERGE' || method === 'PUT' || method === 'PATCH') return { status: 204, headers: { DataServiceVersion: '1.0', ...messageHeader(r.headers), ...(r.headers?.ETag ? { ETag: r.headers.ETag } : {}) }, body: null };
    if (method === 'POST') {
      const entity = this.entityToV2(v, set, r.body, base);
      return { ...json(201, { d: entity }, r.headers), headers: { ...json(201, null, r.headers).headers, Location: entity.__metadata.uri } };
    }
    if (single) return json(200, { d: this.entityToV2(v, set, r.body, base) }, r.headers);
    const d = { results: (r.body.value || []).map(row => this.entityToV2(v, set, row, base)) };
    if (r.body['@odata.count'] !== undefined) d.__count = String(r.body['@odata.count']);
    return json(200, { d }, r.headers);
  }
  functionImport(v, fi, q, base, v4, json) {
    const set = fi.set;
    const unquote = s => s === undefined ? s : this.literalsToV4(s).replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
    const key = set.keys.map(k => {
      if (q[k] === undefined) throw new RapError(400, `Parameter ${k} is missing`);
      const raw = this.literalsToV4(q[k]);
      return `${k}=${set.types[k] === 'Edm.String' && !/^'.*'$/.test(raw) ? `'${raw}'` : raw}`;
    }).join(',');
    const params = Object.fromEntries(fi.params.filter(p => q[p.name] !== undefined).map(p => [p.name, this.toV4Value(p.type, p.type === 'Edm.Boolean' ? unquote(q[p.name]) === 'true' : unquote(q[p.name]))]));
    const r = v4('POST', `${set.name}(${key})/${v.srv.name}.${fi.action}`, params);
    if (r.status >= 400) return this.error(Object.assign(new RapError(r.status, r.body?.error?.message || 'Error'), { details: [] }));
    if (!r.body || typeof r.body !== 'object') return { status: 204, headers: { DataServiceVersion: '1.0', ...messageHeader(r.headers) }, body: null };
    return json(200, { d: this.entityToV2(v, set, r.body, base) }, r.headers);
  }

  // ------------------------------------------------------------------ $batch (multipart/mixed, change sets all-or-nothing)
  batch(raw, headers, servicePath) {
    const boundary = /boundary=("?)([^";]+)\1/i.exec(headers['content-type'] || '')?.[2];
    if (!boundary) return this.error(new RapError(400, 'Missing multipart boundary'));
    const run = (method, url, hdrs, body) => {
      let json = null;
      if (body && body.trim()) { try { json = JSON.parse(body); } catch { return this.error(new RapError(400, 'Invalid JSON in batch request body')); } }
      // URLs are relative to the service root, or absolute (/sap/opu/odata/sap/<service>/...)
      const abs = /^(https?:\/\/[^/]+)?\//.test(url);
      const rel = abs ? url.replace(/^https?:\/\/[^/]+/, '').replace(/^.*\/sap\/opu\/odata\/sap\//, '') : `${servicePath}/${url}`;
      return this.handle(method, rel, json, { ...headers, ...hdrs });
    };
    const db = this.odata.db;
    const respBoundary = `batchresponse_${Date.now().toString(36)}`;
    const out = [];
    let cs = 0;
    for (const p of parseMultipart(raw, boundary)) {
      const pct = p.headers['content-type'] || '';
      if (/multipart\/mixed/i.test(pct)) {
        const csb = /boundary=("?)([^";]+)\1/i.exec(pct)[2];
        const sp = `v2cs_${++cs}`;
        db.exec(`SAVEPOINT ${sp}`);
        const results = [];
        let failed = null;
        for (const cp of parseMultipart(p.body, csb)) {
          const r = parseHttp(cp.body);
          const res = run(r.method, r.url, r.headers, r.body);
          if (res.status >= 400) { failed = res; break; }
          results.push({ ...res, contentId: cp.headers['content-id'] });
        }
        // a failed change set is undone and answered with its error only
        if (failed) { db.exec(`ROLLBACK TO ${sp}`); db.exec(`RELEASE ${sp}`); out.push(`--${respBoundary}\r\n${part(failed)}`); continue; }
        db.exec(`RELEASE ${sp}`);
        const csResp = `changesetresponse_${Date.now().toString(36)}_${cs}`;
        out.push(`--${respBoundary}\r\nContent-Type: multipart/mixed; boundary=${csResp}\r\n\r\n${results.map(r => `--${csResp}\r\n${part(r, r.contentId)}`).join('')}--${csResp}--\r\n`);
      } else {
        const r = parseHttp(p.body);
        out.push(`--${respBoundary}\r\n${part(run(r.method, r.url, r.headers, r.body))}`);
      }
    }
    return { status: 202, headers: { 'Content-Type': `multipart/mixed; boundary=${respBoundary}`, DataServiceVersion: '2.0' }, body: `${out.join('')}--${respBoundary}--\r\n` };
  }
}

// V4 sap-messages (array) -> V2 sap-message (first message with the others as details)
function messageHeader(h = {}) {
  const raw = h?.['sap-messages'];
  if (!raw) return {};
  try {
    const list = JSON.parse(raw);
    if (!list.length) return {};
    const sev = m => ({ 1: 'success', 2: 'info', 3: 'warning', 4: 'error' })[m.numericSeverity] || 'info';
    const [first, ...rest] = list;
    return { 'sap-message': JSON.stringify({ code: first.code || '', message: first.message, severity: sev(first), target: first.target || '', details: rest.map(m => ({ code: m.code || '', message: m.message, severity: sev(m), target: m.target || '' })) }) };
  } catch { return {}; }
}
function part(res, contentId) {
  const isJson = res.body !== null && typeof res.body === 'object';
  const body = res.body === null || res.body === undefined ? '' : isJson ? JSON.stringify(res.body) : String(res.body);
  const hdrs = { ...(body ? { 'Content-Type': isJson ? 'application/json' : (res.headers?.['Content-Type'] || 'text/plain') } : {}), ...Object.fromEntries(Object.entries(res.headers || {}).filter(([k]) => k !== 'Content-Type')), 'Content-Length': Buffer.byteLength(body) };
  return `Content-Type: application/http\r\nContent-Transfer-Encoding: binary\r\n${contentId ? `Content-ID: ${contentId}\r\n` : ''}\r\nHTTP/1.1 ${res.status} ${STATUS_TEXT[res.status] || ''}\r\n${Object.entries(hdrs).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n${body}\r\n`;
}
