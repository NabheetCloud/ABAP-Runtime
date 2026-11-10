// Released ABAP Cloud APIs on the ABAP runtime (step 3 of the full local runtime):
//   hashing and HMAC (CL_ABAP_MESSAGE_DIGEST), base64 / URL / UTF-8 helpers (CL_WEB_HTTP_UTILITY), code pages
//   (CL_ABAP_CONV_CODEPAGE), number ranges (CL_NUMBERRANGE_RUNTIME / _INTERVALS / _OBJECTS), application logs
//   (CL_BALI_*, saved to the tables the Logs page of the classic engine shows), the HTTP client with destinations
//   (CL_WEB_HTTP_CLIENT_MANAGER, CL_HTTP_DESTINATION_PROVIDER) and e-mail (CL_BCS_MAIL_*, into a local outbox).
// Byte data (xstring) is upper-case hex text, as everywhere in this runtime.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const hex = b => Buffer.from(b).toString('hex').toUpperCase();
const bytes = h => Buffer.from(String(h ?? '').replace(/[^0-9a-fA-F]/g, ''), 'hex');
const isHex = s => typeof s === 'string' && s.length % 2 === 0 && /^[0-9A-Fa-f]*$/.test(s);

export function installCloudApis(rt, { def, iface, AbapObject, cxStatic, cxDyn }) {
  const s = v => rt.s(v);
  const first = (p, ...names) => { for (const n of names) if (p[n] !== undefined) return p[n]; return p.$0; };
  const db = () => rt.sql?.db;
  const ts = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return Number(`${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`); };

  // ---------------------------------------------------------------- hashing, encodings, code pages
  def('cx_abap_message_digest', class extends cxStatic {});
  const ALG = a => ({ SHA1: 'sha1', SHA256: 'sha256', SHA384: 'sha384', SHA512: 'sha512', MD5: 'md5' })[s(a || 'SHA1').toUpperCase().replace('-', '')];
  const digestOut = (buf, pre) => ({ $ret: '', [`ef_${pre}string`]: hex(buf), [`ef_${pre}xstring`]: hex(buf), [`ef_${pre}b64string`]: Buffer.from(buf).toString('base64') });
  const hash = (p, data) => { const a = ALG(p.if_algorithm); if (!a) throw rt.new('cx_abap_message_digest', { text: `Unknown algorithm ${s(p.if_algorithm)}` }); return crypto.createHash(a).update(data).digest(); };
  const hmac = (p, data) => { const a = ALG(p.if_algorithm); if (!a) throw rt.new('cx_abap_message_digest', { text: `Unknown algorithm ${s(p.if_algorithm)}` }); return crypto.createHmac(a, bytes(p.if_key)).update(data).digest(); };
  def('cl_abap_message_digest', class extends AbapObject {
    static calculate_hash_for_char(p = {}) { return digestOut(hash(p, Buffer.from(s(p.if_data), 'utf8')), 'hash'); }
    static calculate_hash_for_raw(p = {}) { return digestOut(hash(p, bytes(p.if_data)), 'hash'); }
    static calculate_hmac_for_char(p = {}) { return digestOut(hmac(p, Buffer.from(s(p.if_data), 'utf8')), 'hmac'); }
    static calculate_hmac_for_raw(p = {}) { return digestOut(hmac(p, bytes(p.if_data)), 'hmac'); }
    static string_to_xstring(p = {}) { return { $ret: hex(Buffer.from(s(p.input ?? p.$0), 'utf8')), output: hex(Buffer.from(s(p.input ?? p.$0), 'utf8')) }; }
  });
  def('cl_abap_hmac', rt.cls('cl_abap_message_digest'));
  const Util = class extends AbapObject {
    static encode_base64(p = {}) { return { $ret: Buffer.from(s(first(p, 'unencoded')), 'utf8').toString('base64') }; }
    static decode_base64(p = {}) { return { $ret: Buffer.from(s(first(p, 'encoded')), 'base64').toString('utf8') }; }
    static encode_x_base64(p = {}) { return { $ret: bytes(first(p, 'unencoded')).toString('base64') }; }
    static decode_x_base64(p = {}) { return { $ret: hex(Buffer.from(s(first(p, 'encoded')), 'base64')) }; }
    static encode_utf8(p = {}) { return { $ret: hex(Buffer.from(s(first(p, 'unencoded')), 'utf8')) }; }
    static decode_utf8(p = {}) { return { $ret: bytes(first(p, 'encoded')).toString('utf8') }; }
    static escape_url(p = {}) { return { $ret: encodeURIComponent(s(first(p, 'unescaped'))) }; }
    static unescape_url(p = {}) { return { $ret: decodeURIComponent(s(first(p, 'escaped')).replace(/\+/g, ' ')) }; }
    static escape_html(p = {}) { return { $ret: s(first(p, 'unescaped')).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') }; }
  };
  def('cl_web_http_utility', Util);
  def('cl_http_utility', class extends Util {});
  // code pages: text <-> bytes (UTF-8, ISO-8859-1 / Latin-1, UTF-16LE); create_in also accepts text that is not hex
  const enc = cp => ({ 'UTF-8': 'utf8', UTF8: 'utf8', 'ISO-8859-1': 'latin1', LATIN1: 'latin1', 'UTF-16LE': 'utf16le', 'UTF-16': 'utf16le', 'US-ASCII': 'ascii' })[s(cp || 'UTF-8').toUpperCase()] || 'utf8';
  const Conv = def('cl_abap_conv_codepage', class extends AbapObject {
    static create_in(p = {}) { const o = new Conv(); o.$dir = 'in'; o.$enc = enc(p.codepage); return { $ret: o }; }
    static create_out(p = {}) { const o = new Conv(); o.$dir = 'out'; o.$enc = enc(p.codepage); return { $ret: o }; }
    convert(p = {}) {
      const src = p.source ?? p.$0;
      if (this.$dir === 'out') return { $ret: hex(Buffer.from(s(src), this.$enc)) };
      return { $ret: isHex(s(src)) && s(src) !== '' ? bytes(src).toString(this.$enc) : s(src) };
    }
  });
  iface('if_abap_conv_in', {}); iface('if_abap_conv_out', {});
  Conv.$meta = { interfaces: ['if_abap_conv_in', 'if_abap_conv_out'] };

  // ---------------------------------------------------------------- number ranges
  // intervals per object / subobject / range number / year in rap_nr_interval; an object without intervals gets
  // interval 01 from 1 to 99999999 on first use
  def('cx_number_ranges', class extends cxStatic {});
  def('cx_nr_object_not_found', class extends rt.cls('cx_number_ranges') {});
  def('cx_nr_interval_not_found', class extends rt.cls('cx_number_ranges') {});
  const nrTable = () => {
    if (rt.$nrReady) return;
    db()?.exec?.('CREATE TABLE IF NOT EXISTS rap_nr_interval (object TEXT NOT NULL, subobject TEXT NOT NULL, nrrangenr TEXT NOT NULL, toyear TEXT NOT NULL, fromnumber TEXT, tonumber TEXT, nrlevel TEXT, externind TEXT, PRIMARY KEY (object, subobject, nrrangenr, toyear))');
    rt.$nrReady = true;
  };
  const nrKey = p => [s(p.object).trim().toUpperCase(), s(p.subobject ?? '').trim().toUpperCase(), s(p.nr_range_nr ?? p.nrrangenr ?? '01').trim() || '01', s(p.toyear ?? '0000').trim() || '0000'];
  const readIv = k => db().prepare('SELECT * FROM rap_nr_interval WHERE object = ? AND subobject = ? AND nrrangenr = ? AND toyear = ?').get(...k);
  const writeIv = (k, iv) => {   // (delete + insert: portable across SQLite and PostgreSQL)
    db().prepare('DELETE FROM rap_nr_interval WHERE object = ? AND subobject = ? AND nrrangenr = ? AND toyear = ?').run(...k);
    db().prepare('INSERT INTO rap_nr_interval (object, subobject, nrrangenr, toyear, fromnumber, tonumber, nrlevel, externind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(...k, s(iv.fromnumber), s(iv.tonumber), s(iv.nrlevel ?? ''), s(iv.externind ?? iv.procind ?? ''));
  };
  def('cl_numberrange_runtime', class extends AbapObject {
    // number_get( nr_range_nr object [subobject] [quantity] [toyear] ): the next number(s) of the interval
    static number_get(p = {}) {
      if (!db()) throw rt.new('cx_number_ranges', { text: 'Number ranges need a database' });
      nrTable();
      const k = nrKey(p);
      if (!k[0]) throw rt.new('cx_nr_object_not_found', { text: 'Number range object missing' });
      let iv = readIv(k);
      if (!iv) { writeIv(k, { fromnumber: '00000001', tonumber: '99999999', nrlevel: '' }); iv = readIv(k); }
      const width = Math.max(s(iv.tonumber).length, 1);
      const qty = Math.max(1, rt.n(p.quantity ?? 1));
      const from = BigInt(s(iv.fromnumber) || '1'), to = BigInt(s(iv.tonumber) || '99999999');
      const level = s(iv.nrlevel).trim() ? BigInt(s(iv.nrlevel)) : from - 1n;
      const last = level + BigInt(qty);
      if (last > to) throw rt.new('cx_number_ranges', { text: `Number range ${k[2]} of ${k[0]} is exhausted` });
      writeIv(k, { ...iv, nrlevel: last.toString().padStart(width, '0') });
      const number = (level + 1n).toString().padStart(width, '0');
      return { $ret: '', number, returncode: last === to ? '1' : '', returned_quantity: qty };
    }
    static number_status(p = {}) { nrTable(); const iv = readIv(nrKey(p)); return { $ret: '', number: iv ? s(iv.nrlevel) : '' }; }
  });
  def('cl_numberrange_intervals', class extends AbapObject {
    // create / update( interval = [ { nrrangenr fromnumber tonumber procind ... } ] object [subobject] )
    static create(p = {}) { nrTable(); for (const r of p.interval || []) writeIv(nrKey({ ...p, nr_range_nr: r.nrrangenr, toyear: r.toyear }), r); return { $ret: '', error: '', error_inf: {}, error_iv: [], warning: '' }; }
    static update(p = {}) { return this.create(p); }
    static read(p = {}) { nrTable(); const rows = db().prepare('SELECT * FROM rap_nr_interval WHERE object = ? AND subobject = ?').all(s(p.object).toUpperCase(), s(p.subobject ?? '').toUpperCase()); return { $ret: '', interval: rows.map(r => ({ nrrangenr: r.nrrangenr, toyear: r.toyear, fromnumber: r.fromnumber, tonumber: r.tonumber, nrlevel: r.nrlevel, externind: r.externind })) }; }
    static delete(p = {}) { nrTable(); for (const r of p.interval || []) db().prepare('DELETE FROM rap_nr_interval WHERE object = ? AND subobject = ? AND nrrangenr = ?').run(s(p.object).toUpperCase(), s(p.subobject ?? '').toUpperCase(), s(r.nrrangenr)); return { $ret: '' }; }
  });
  def('cl_numberrange_objects', class extends AbapObject {
    static create(p = {}) { return { $ret: '', errors: [], returncode: '' }; }
    static read(p = {}) { return { $ret: '', attributes: { object: s(p.object).toUpperCase() } }; }
  });

  // ---------------------------------------------------------------- application logs (CL_BALI_*)
  iface('if_bali_constants', { c_severity_error: 'E', c_severity_warning: 'W', c_severity_information: 'I', c_severity_status: 'S', c_severity_exit: 'X', c_severity_abort: 'A',
    c_category_free_text: 'F', c_category_message: 'M', c_category_exception: 'E' });
  iface('if_bali_log', {}); iface('if_bali_header_setter', {}); iface('if_bali_item_setter', {}); iface('if_bali_log_db', {});
  const Item = class extends AbapObject {
    get_message_text() { return { $ret: this.text }; }
    get_severity() { return { $ret: this.severity }; }
  };
  def('cl_bali_free_text_setter', class extends Item { static create(p = {}) { const o = new this(); Object.assign(o, { severity: s(p.severity || 'I'), text: s(p.text), category: 'F' }); return { $ret: o }; } });
  def('cl_bali_message_setter', class extends Item {
    static create(p = {}) {
      const o = new this();
      const vars = [p.variable_1, p.variable_2, p.variable_3, p.variable_4].map(v => (v === undefined ? '' : s(v)));
      Object.assign(o, { severity: s(p.severity || 'I'), id: s(p.id).toUpperCase(), number: s(p.number), category: 'M', text: rt.msgText(s(p.id).toLowerCase(), s(p.number).padStart(3, '0'), vars) });
      return { $ret: o };
    }
    static create_from_sy() { return this.create({ severity: rt.sy.msgty || 'I', id: rt.sy.msgid, number: rt.sy.msgno, variable_1: rt.sy.msgv1, variable_2: rt.sy.msgv2, variable_3: rt.sy.msgv3, variable_4: rt.sy.msgv4 }); }
  });
  def('cl_bali_exception_setter', class extends Item { static create(p = {}) { const o = new this(); const e = p.exception ?? p.$0; Object.assign(o, { severity: s(p.severity || 'E'), category: 'E', text: e?.get_text ? s(e.get_text({}).$ret) : s(e?.message ?? e) }); return { $ret: o }; } });
  const Header = def('cl_bali_header_setter', class extends AbapObject {
    static create(p = {}) { const o = new Header(); Object.assign(o, { object: s(p.object).toUpperCase(), subobject: s(p.subobject).toUpperCase(), external_id: s(p.external_id) }); return { $ret: o }; }
    set_expiry(p = {}) { this.expiry = s(p.expiry_date); return { $ret: this }; }
    set_descriptor(p = {}) { this.descriptor = s(p.descriptor); return { $ret: this }; }
    get_object() { return { $ret: this.object }; }
    get_subobject() { return { $ret: this.subobject }; }
    get_external_id() { return { $ret: this.external_id }; }
  });
  Header.$meta = { interfaces: ['if_bali_header_setter'] };
  const Log = def('cl_bali_log', class extends AbapObject {
    static create() { const o = new Log(); o.items = []; o.header = null; o.handle = crypto.randomUUID().replace(/-/g, '').slice(0, 22).toUpperCase(); return { $ret: o }; }
    static create_with_header(p = {}) { const r = Log.create(); r.$ret.header = p.header ?? p.$0; return r; }
    set_header(p = {}) { this.header = p.header ?? p.$0; return { $ret: this }; }
    get_header() { if (!this.header) throw rt.new('cx_bali_runtime', { text: 'The log has no header' }); return { $ret: this.header }; }
    add_item(p = {}) { this.items.push(p.item ?? p.$0); return { $ret: this }; }
    add_all_items_from_other_log(p = {}) { this.items.push(...((p.source_log ?? p.$0)?.items || [])); return { $ret: this }; }
    get_all_items() { return { $ret: this.items.map((item, k) => ({ log_item_number: k + 1, item })) }; }
    get_handle() { return { $ret: this.handle }; }
  });
  Log.$meta = { interfaces: ['if_bali_log'] };
  // saved to zrap_balhdr / zrap_balmsg, the tables the classic engine's Logs page (and rap logs) read
  const balTables = () => {
    if (rt.$balReady) return;
    db().exec('CREATE TABLE IF NOT EXISTS zrap_balhdr (log_handle TEXT PRIMARY KEY, object TEXT, subobject TEXT, external_id TEXT, log_user TEXT, program TEXT, created_at BIGINT, msg_count INTEGER, errors INTEGER, warnings INTEGER)');
    db().exec('CREATE TABLE IF NOT EXISTS zrap_balmsg (log_handle TEXT, item_no INTEGER, severity TEXT, message TEXT, PRIMARY KEY (log_handle, item_no))');
    rt.$balReady = true;
  };
  const LogDb = def('cl_bali_log_db', class extends AbapObject {
    static get_instance() { return { $ret: new LogDb() }; }
    save_log(p = {}) {
      const log = p.log ?? p.$0;
      if (!db()) throw rt.new('cx_bali_runtime', { text: 'Application logs need a database' });
      if (!log?.header) throw rt.new('cx_bali_runtime', { text: 'The log has no header (set_header)' });
      balTables();
      const h = log.header, items = log.items;
      db().prepare('DELETE FROM zrap_balmsg WHERE log_handle = ?').run(log.handle);
      db().prepare('DELETE FROM zrap_balhdr WHERE log_handle = ?').run(log.handle);
      db().prepare('INSERT INTO zrap_balhdr (log_handle, object, subobject, external_id, log_user, program, created_at, msg_count, errors, warnings) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(log.handle, h.object, h.subobject, h.external_id, s(rt.sy.uname || 'DEVELOPER'), s(rt.callStack?.[0]?.split(' ')[0] || ''), ts(), items.length,
          items.filter(i => ['E', 'A', 'X'].includes(i.severity)).length, items.filter(i => i.severity === 'W').length);
      const ins = db().prepare('INSERT INTO zrap_balmsg (log_handle, item_no, severity, message) VALUES (?, ?, ?, ?)');
      items.forEach((i, k) => ins.run(log.handle, k + 1, i.severity, i.text));
      if (rt.$currentJob && p.assign_to_current_appl_job !== '') rt.$currentJob.logs.push(log.handle);   // the job's log
      return { $ret: '' };
    }
    load_log(p = {}) {
      balTables();
      const handle = s(p.handle ?? p.$0);
      const h = db().prepare('SELECT * FROM zrap_balhdr WHERE log_handle = ?').get(handle);
      if (!h) throw rt.new('cx_bali_runtime', { text: `Log ${handle} not found` });
      const log = Log.create().$ret;
      log.handle = handle;
      log.header = Header.create({ object: h.object, subobject: h.subobject, external_id: h.external_id }).$ret;
      log.items = db().prepare('SELECT * FROM zrap_balmsg WHERE log_handle = ? ORDER BY item_no').all(handle).map(m => rt.cls('cl_bali_free_text_setter').create({ severity: m.severity, text: m.message }).$ret);
      return { $ret: log };
    }
    delete_log(p = {}) { balTables(); const handle = (p.log ?? p.$0)?.handle; db().prepare('DELETE FROM zrap_balmsg WHERE log_handle = ?').run(handle); db().prepare('DELETE FROM zrap_balhdr WHERE log_handle = ?').run(handle); return { $ret: '' }; }
  });
  LogDb.$meta = { interfaces: ['if_bali_log_db'] };

  // ---------------------------------------------------------------- HTTP client and destinations
  // destinations by name (cloud destinations, communication arrangements) in <app>/.rap/destinations.json:
  //   { "NAME": { "url": "https://...", "user": "", "password": "", "headers": { ... } } }  (outside the sources)
  def('cx_http_dest_provider_error', class extends cxStatic {});
  def('cx_web_http_client_error', class extends cxStatic {});
  def('cx_web_message_error', class extends cxStatic {});
  iface('if_web_http_client', { get: 'GET', post: 'POST', put: 'PUT', delete: 'DELETE', patch: 'PATCH', head: 'HEAD', options: 'OPTIONS' });
  iface('if_http_destination', {}); iface('if_web_http_request', {}); iface('if_web_http_response', {});
  const destinations = () => { try { return JSON.parse(fs.readFileSync(path.join(rt.appDir || process.cwd(), '.rap', 'destinations.json'), 'utf8')); } catch { return {}; } };
  const Dest = class extends AbapObject {};
  const named = name => {
    const all = destinations();
    const d = all[name] ?? all[name.toUpperCase()] ?? Object.entries(all).find(([k]) => k.toUpperCase() === name.toUpperCase())?.[1];
    if (!d?.url) throw rt.new('cx_http_dest_provider_error', { text: `Destination ${name} is not defined (.rap/destinations.json of the app)` });
    return Object.assign(new Dest(), d);
  };
  def('cl_http_destination_provider', class extends AbapObject {
    static create_by_url(p = {}) { const url = s(p.i_url ?? p.$0); if (!/^https?:\/\//i.test(url)) throw rt.new('cx_http_dest_provider_error', { text: `Invalid URL ${url}` }); return { $ret: Object.assign(new Dest(), { url }) }; }
    static create_by_cloud_destination(p = {}) { return { $ret: named(s(p.i_name ?? p.$0)) }; }
    static create_by_comm_arrangement(p = {}) { return { $ret: named(s(p.comm_scenario ?? p.$0) + (p.service_id ? `/${s(p.service_id)}` : '')) }; }
  });
  const Request = class extends AbapObject {
    set_uri_path(p = {}) { this.path = s(p.i_uri_path ?? p.$0); return { $ret: this }; }
    set_query(p = {}) { this.query = s(p.query ?? p.$0); return { $ret: this }; }
    set_header_field(p = {}) { this.headers[s(p.i_name)] = s(p.i_value); return { $ret: this }; }
    set_header_fields(p = {}) { for (const f of p.i_fields || []) this.headers[s(f.name)] = s(f.value); return { $ret: this }; }
    get_header_field(p = {}) { return { $ret: this.headers[s(p.i_name ?? p.$0)] ?? '' }; }
    set_content_type(p = {}) { this.headers['Content-Type'] = s(p.content_type ?? p.$0); return { $ret: this }; }
    set_text(p = {}) { this.body = Buffer.from(s(p.i_text ?? p.$0), 'utf8').toString('base64'); return { $ret: this }; }
    set_binary(p = {}) { this.body = bytes(p.i_data ?? p.$0).toString('base64'); return { $ret: this }; }
    set_form_field(p = {}) { (this.form ||= []).push([s(p.i_name), s(p.i_value)]); return { $ret: this }; }
    set_authorization_basic(p = {}) { this.headers.Authorization = `Basic ${Buffer.from(`${s(p.i_username)}:${s(p.i_password)}`).toString('base64')}`; return { $ret: this }; }
    set_authorization_bearer(p = {}) { this.headers.Authorization = `Bearer ${s(p.i_bearer ?? p.$0)}`; return { $ret: this }; }
    get_text() { return { $ret: this.body ? Buffer.from(this.body, 'base64').toString('utf8') : '' }; }
  };
  const Response = class extends AbapObject {
    get_status() { return { $ret: { code: this.status, reason: this.reason } }; }
    get_text() { return { $ret: Buffer.from(this.body || '', 'base64').toString('utf8') }; }
    get_binary() { return { $ret: hex(Buffer.from(this.body || '', 'base64')) }; }
    get_header_field(p = {}) { const n = s(p.i_name ?? p.$0).toLowerCase(); return { $ret: this.headers[n] ?? '' }; }
    get_header_fields() { return { $ret: Object.entries(this.headers).map(([name, value]) => ({ name, value })) }; }
    get_content_type() { return { $ret: this.headers['content-type'] ?? '' }; }
  };
  const Client = class extends AbapObject {
    get_http_request() { return { $ret: this.request }; }
    // execute( i_method ): a synchronous HTTP call (child process; 60 s), the response object
    execute(p = {}) {
      const r = this.request, d = this.dest;
      let url = d.url.replace(/\/+$/, '') + (r.path ? (r.path.startsWith('/') ? r.path : `/${r.path}`) : '');
      if (r.query) url += (url.includes('?') ? '&' : '?') + r.query.replace(/^\?/, '');
      const headers = { ...(d.headers || {}), ...r.headers };
      if (d.user && !headers.Authorization) headers.Authorization = `Basic ${Buffer.from(`${d.user}:${d.password ?? ''}`).toString('base64')}`;
      let body = r.body;
      if (r.form?.length && !body) { body = Buffer.from(new URLSearchParams(r.form).toString()).toString('base64'); headers['Content-Type'] ??= 'application/x-www-form-urlencoded'; }
      const method = s(p.i_method ?? p.$0 ?? 'GET').toUpperCase();
      const script = `const r=JSON.parse(require('fs').readFileSync(0,'utf8'));fetch(r.url,{method:r.method,headers:r.headers,body:r.body?Buffer.from(r.body,'base64'):undefined,signal:AbortSignal.timeout(55000)}).then(async x=>{const b=Buffer.from(await x.arrayBuffer());process.stdout.write(JSON.stringify({status:x.status,reason:x.statusText,headers:Object.fromEntries(x.headers),body:b.toString('base64')}))}).catch(e=>process.stdout.write(JSON.stringify({error:String(e.cause?.message||e.message)})))`;
      let out;
      try { out = JSON.parse(execFileSync(process.execPath, ['-e', script], { input: JSON.stringify({ url, method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : body }), encoding: 'utf8', timeout: 60000, maxBuffer: 64 << 20 })); }
      catch (e) { throw rt.new('cx_web_http_client_error', { text: `HTTP ${method} ${url}: ${e.message.slice(0, 200)}` }); }
      if (out.error) throw rt.new('cx_web_http_client_error', { text: `HTTP ${method} ${url}: ${out.error}` });
      return { $ret: Object.assign(new Response(), out) };
    }
    close() { return { $ret: '' }; }
  };
  def('cl_web_http_client_manager', class extends AbapObject {
    static create_by_http_destination(p = {}) {
      const dest = p.i_destination ?? p.$0;
      if (!dest?.url) throw rt.new('cx_web_http_client_error', { text: 'No destination' });
      const c = new Client(); c.dest = dest; c.request = Object.assign(new Request(), { headers: {} });
      return { $ret: c };
    }
  });

  // ---------------------------------------------------------------- e-mail (CL_BCS_MAIL_MESSAGE)
  // send( ) puts the mail into the app's outbox: rap_mail_outbox and an .eml file in <app>/.rap/outbox
  def('cx_bcs_mail', class extends cxStatic {});
  const Part = class extends AbapObject {};
  def('cl_bcs_mail_textpart', class extends Part { static create_instance(p = {}) { const o = new this(); Object.assign(o, { content: s(p.iv_content), type: s(p.iv_content_type || 'text/plain'), filename: s(p.iv_filename ?? ''), binary: false }); return { $ret: o }; } });
  def('cl_bcs_mail_binarypart', class extends Part { static create_instance(p = {}) { const o = new this(); Object.assign(o, { content: s(p.iv_content), type: s(p.iv_content_type || 'application/octet-stream'), filename: s(p.iv_filename ?? ''), binary: true }); return { $ret: o }; } });
  const Mail = def('cl_bcs_mail_message', class extends AbapObject {
    static create_instance() { const m = new Mail(); Object.assign(m, { sender: '', to: [], cc: [], bcc: [], subject: '', main: null, attachments: [] }); return { $ret: m }; }
    set_sender(p = {}) { this.sender = s(p.iv_address ?? p.$0); return { $ret: this }; }
    add_recipient(p = {}) { const kind = s(p.iv_copy || 'T').toUpperCase(); (kind === 'C' ? this.cc : kind === 'B' ? this.bcc : this.to).push(s(p.iv_address ?? p.$0)); return { $ret: this }; }
    set_subject(p = {}) { this.subject = s(p.iv_subject ?? p.$0); return { $ret: this }; }
    set_main(p = {}) { this.main = p.io_main ?? p.$0; return { $ret: this }; }
    add_attachment(p = {}) { this.attachments.push(p.io_attachment ?? p.$0); return { $ret: this }; }
    send() {
      if (!this.to.length && !this.cc.length && !this.bcc.length) throw rt.new('cx_bcs_mail', { text: 'The mail has no recipient' });
      const dbx = db();
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const boundary = `rap-${id}`;
      const part = x => `--${boundary}\r\nContent-Type: ${x.type}${x.filename ? `; name="${x.filename}"` : ''}\r\n${x.filename ? `Content-Disposition: attachment; filename="${x.filename}"\r\n` : ''}Content-Transfer-Encoding: base64\r\n\r\n${(x.binary ? bytes(x.content) : Buffer.from(x.content, 'utf8')).toString('base64').replace(/(.{76})/g, '$1\r\n')}\r\n`;
      const eml = `From: ${this.sender || 'developer@rap.local'}\r\nTo: ${this.to.join(', ')}\r\n${this.cc.length ? `Cc: ${this.cc.join(', ')}\r\n` : ''}Subject: ${this.subject}\r\nDate: ${new Date().toUTCString()}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n${[this.main, ...this.attachments].filter(Boolean).map(part).join('')}--${boundary}--\r\n`;
      const dir = path.join(rt.appDir || process.cwd(), '.rap', 'outbox');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${id}.eml`), eml);
      if (dbx) {
        dbx.exec('CREATE TABLE IF NOT EXISTS rap_mail_outbox (id TEXT PRIMARY KEY, sent_at BIGINT, sender TEXT, recipients TEXT, subject TEXT, body TEXT, attachments INTEGER)');
        dbx.prepare('INSERT INTO rap_mail_outbox (id, sent_at, sender, recipients, subject, body, attachments) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(id, ts(), this.sender, [...this.to, ...this.cc, ...this.bcc].join(', '), this.subject, this.main ? (this.main.binary ? '' : this.main.content) : '', this.attachments.length);
      }
      return { $ret: '', et_status: [...this.to, ...this.cc, ...this.bcc].map(r => ({ recipient: r, status: 'S' })), ev_mail_status: 'S' };
    }
  });
}

// ---------------------------------------------------------------- background processing (bgPF) and application jobs
// bgPF: save_for_execution( ) registers the operation; it runs when the transaction commits (RAP save or COMMIT WORK),
// after the commit; a rollback drops it. Application jobs: a job catalog entry (src/<name>.sajc.json, ABAP file
// format) names the class, a job template (src/<name>.sajt.json) its catalog entry; cl_apj_rt_api schedules a template,
// the studio runs due jobs (Workspace.runDueJobs), periodic jobs are scheduled again.
export function installBackground(rt, { def, iface, AbapObject, cxStatic }) {
  const s = v => rt.s(v);
  const db = () => rt.sql?.rap?.db ?? rt.sql?.db;   // the runtime's own bookkeeping is not part of the SQL trace
  const now = () => Date.now();
  const stamp = ms => { const d = new Date(ms); const p = n => String(n).padStart(2, '0'); return Number(`${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`); };
  const tables = () => {
    if (rt.$bgReady || !db()) return;
    db().exec('CREATE TABLE IF NOT EXISTS rap_bgpf_process (id TEXT PRIMARY KEY, name TEXT, operation TEXT, state TEXT, created_at BIGINT, ended_at BIGINT, message TEXT)');
    db().exec('CREATE TABLE IF NOT EXISTS rap_apj_job (jobname TEXT NOT NULL, jobcount TEXT NOT NULL, template TEXT, catalog TEXT, class TEXT, text TEXT, status TEXT, username TEXT, start_at BIGINT, period_min INTEGER, params TEXT, started BIGINT, ended BIGINT, message TEXT, log_handle TEXT, PRIMARY KEY (jobname, jobcount))');
    rt.$bgReady = true;
  };
  rt.backgroundTables = tables;

  // ---- bgPF
  def('cx_bgmc', class extends cxStatic {});
  def('cx_bgmc_operation', class extends cxStatic {});
  iface('if_bgmc_op_single', {}); iface('if_bgmc_op_single_tx_uncontr', {});
  iface('if_bgmc_process_monitor', { gcs_state: { new: 'NEW', running: 'RUNNING', successful: 'SUCCESSFUL', erroneous: 'ERRONEOUS', unknown: 'UNKNOWN' } });
  const pending = [];
  const Monitor = class extends AbapObject {
    get_state() { tables(); const r = db()?.prepare('SELECT state FROM rap_bgpf_process WHERE id = ?').get(this.id); return { $ret: r?.state || 'UNKNOWN' }; }
    to_string() { return { $ret: this.id }; }
  };
  const Process = class extends AbapObject {
    set_name(p = {}) { this.name = s(p.iv_name ?? p.$0); return { $ret: this }; }
    set_operation(p = {}) { this.op = p.io_operation ?? p.$0; this.tx = true; return { $ret: this }; }
    set_operation_tx_uncontrolled(p = {}) { this.op = p.io_operation ?? p.$0; this.tx = false; return { $ret: this }; }
    save_for_execution() {
      if (!this.op) throw rt.new('cx_bgmc', { text: 'No operation (set_operation)' });
      tables();
      const m = new Monitor(); m.id = `BGPF${now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      db()?.prepare('INSERT INTO rap_bgpf_process (id, name, operation, state, created_at) VALUES (?, ?, ?, ?, ?)').run(m.id, this.name || '', String(this.op.constructor?.$name || '').toUpperCase(), 'NEW', stamp(now()));
      pending.push({ id: m.id, op: this.op, tx: this.tx });
      return { $ret: m };
    }
  };
  const Factory = class extends AbapObject { create() { return { $ret: new Process() }; } };
  def('cl_bgmc_process_factory', class extends AbapObject {
    static get_default() { return { $ret: new Factory() }; }
    static create_monitor_from_string(p = {}) { const m = new Monitor(); m.id = s(p.iv_monitor_string ?? p.$0); return { $ret: m }; }
  });
  // after a successful commit: the registered operations run, each in its own transaction (if_bgmc_op_single: its
  // EML changes are saved afterwards; uncontrolled operations commit themselves)
  let running = false;
  rt.bgpfRollback = () => { for (const p of pending.splice(0)) db()?.prepare("UPDATE rap_bgpf_process SET state = 'ERRONEOUS', message = ? WHERE id = ?").run('Rolled back before execution', p.id); };
  rt.runBackground = () => {
    if (running || !pending.length) return;
    running = true;
    try {
      while (pending.length) {
        const p = pending.shift();
        const upd = (state, msg) => db()?.prepare('UPDATE rap_bgpf_process SET state = ?, ended_at = ?, message = ? WHERE id = ?').run(state, state === 'RUNNING' ? null : stamp(now()), msg || '', p.id);
        upd('RUNNING');
        try {
          rt.call(p.op, p.tx ? 'if_bgmc_op_single~execute' : 'if_bgmc_op_single_tx_uncontr~execute', {});
          if (p.tx) rt.eml?.commit?.();
          upd('SUCCESSFUL');
        } catch (e) {
          try { rt.eml?.rollback?.(); } catch {}
          rt.onError?.(e, `Background process ${p.id}`);
          upd('ERRONEOUS', e?.get_text ? s(e.get_text({}).$ret) : String(e?.message || e));
        }
      }
    } finally { running = false; }
  };

  // ---- application jobs
  def('cx_apj_rt', class extends cxStatic {});
  def('cx_apj_dt', class extends cxStatic {});
  def('cx_apj_rt_content', class extends cxStatic {});
  def('cx_apj_dt_content', class extends cxStatic {});
  iface('if_apj_dt_exec_object', {}); iface('if_apj_rt_exec_object', {}); iface('if_apj_rt_run', {});
  iface('if_apj_rt_types', {});
  const appFiles = re => { const dir = path.join(rt.appDir || process.cwd(), 'src'); try { return fs.readdirSync(dir).filter(f => re.test(f)).map(f => [f, path.join(dir, f)]); } catch { return []; } };
  const find = (obj, key) => { if (!obj || typeof obj !== 'object') return undefined; for (const [k, v] of Object.entries(obj)) { if (k.toLowerCase() === key.toLowerCase() && typeof v === 'string') return v; const r = find(v, key); if (r) return r; } return undefined; };
  const json = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  // template -> { catalog, class }: src/<template>.sajt.json -> src/<catalog>.sajc.json; a template may also name
  // a catalog entry directly, or a class that implements IF_APJ_RT_EXEC_OBJECT
  const resolve = template => {
    const t = s(template).trim().toLowerCase();
    let catalog = t;
    const tf = appFiles(/\.sajt\.json$/i).find(([f]) => f.split('.')[0].toLowerCase() === t);
    if (tf) catalog = (find(json(tf[1]), 'catalogName') || find(json(tf[1]), 'jobCatalogEntryName') || t).toLowerCase();
    const cf = appFiles(/\.sajc\.json$/i).find(([f]) => f.split('.')[0].toLowerCase() === catalog);
    const cls = cf ? (find(json(cf[1]), 'className') || '').toLowerCase() : (rt.hasClass(t) ? t : '');
    if (!cls) throw rt.new('cx_apj_rt', { text: `Job template ${t.toUpperCase()} not found (src/${t}.sajt.json with a catalog entry src/<name>.sajc.json)` });
    return { catalog, cls };
  };
  const nextCount = () => String(Math.floor(now() / 1000) % 100000000).padStart(8, '0');
  const API = def('cl_apj_rt_api', class extends AbapObject {
    // schedule_job( iv_job_template_name iv_job_text is_start_info is_scheduling_info it_job_parameter_value ) -> ev_jobname ev_jobcount
    static schedule_job(p = {}) {
      if (!db()) throw rt.new('cx_apj_rt', { text: 'Application jobs need a database' });
      tables();
      const { catalog, cls } = resolve(p.iv_job_template_name);
      const si = p.is_start_info || {}, sch = p.is_scheduling_info || {};
      let startAt = now();
      if (si.start_immediately !== 'X' && si.timestamp) { const t = String(Math.floor(rt.n(si.timestamp))).padEnd(14, '0'); startAt = Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(8, 10), +t.slice(10, 12), +t.slice(12, 14)); }
      const unit = { MI: 1, H: 60, D: 1440, W: 10080 }[s(sch.periodic_granularity).toUpperCase()] || 0;
      const period = unit * rt.n(sch.periodic_value || 0);
      const jobname = s(p.iv_job_text || p.iv_job_template_name).toUpperCase().slice(0, 32);
      let jobcount = nextCount();
      while (db().prepare('SELECT 1 FROM rap_apj_job WHERE jobname = ? AND jobcount = ?').get(jobname, jobcount)) jobcount = String(Number(jobcount) + 1).padStart(8, '0');
      db().prepare('INSERT INTO rap_apj_job (jobname, jobcount, template, catalog, class, text, status, username, start_at, period_min, params) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(jobname, jobcount, s(p.iv_job_template_name).toUpperCase(), catalog.toUpperCase(), cls, s(p.iv_job_text), 'S', s(rt.sy.uname || 'DEVELOPER'), startAt, period, JSON.stringify(p.it_job_parameter_value || []));
      return { $ret: '', ev_jobname: jobname, ev_jobcount: jobcount };
    }
    static get_job_status(p = {}) {
      tables();
      const j = db()?.prepare('SELECT status, message FROM rap_apj_job WHERE jobname = ? AND jobcount = ?').get(s(p.iv_jobname).toUpperCase(), s(p.iv_jobcount));
      if (!j) throw rt.new('cx_apj_rt', { text: `Job ${s(p.iv_jobname)} ${s(p.iv_jobcount)} not found` });
      const text = { S: 'Scheduled', R: 'Running', F: 'Finished', A: 'Aborted', C: 'Cancelled' }[j.status] || j.status;
      return { $ret: '', ev_job_status: j.status, ev_job_status_text: text };
    }
    static cancel_job(p = {}) { tables(); db()?.prepare("UPDATE rap_apj_job SET status = 'C' WHERE jobname = ? AND jobcount = ? AND status = 'S'").run(s(p.iv_jobname).toUpperCase(), s(p.iv_jobcount)); return { $ret: '' }; }
    static get_job_runtime_info() { const j = rt.$currentJob; return { $ret: '', ev_jobname: j?.jobname || '', ev_jobcount: j?.jobcount || '', ev_catalog_name: j?.catalog || '', ev_template_name: j?.template || '', ev_running_in_job: j ? 'X' : '' }; }
    static generate_jobname() { return { $ret: `JOB_${nextCount()}` }; }
  });
  void API;
  // runs the jobs that are due (the studio calls this every few seconds); returns how many ran
  rt.runDueJobs = (at = now()) => {
    if (!db()) return 0;
    tables();
    const due = db().prepare("SELECT * FROM rap_apj_job WHERE status = 'S' AND start_at <= ? ORDER BY start_at").all(at);
    for (const j of due) {
      const set = (status, extra = {}) => db().prepare('UPDATE rap_apj_job SET status = ?, started = COALESCE(?, started), ended = ?, message = ?, log_handle = COALESCE(?, log_handle) WHERE jobname = ? AND jobcount = ?')
        .run(status, extra.started ?? null, extra.ended ?? null, extra.message ?? '', extra.log ?? null, j.jobname, j.jobcount);
      set('R', { started: now() });
      rt.$currentJob = { ...j, logs: [] };
      // parameters: [{ name, t_value: [{ sign option low high }] }] -> selection rows for execute( it_parameters )
      const params = (JSON.parse(j.params || '[]')).flatMap(x => (x.t_value || []).map(v => ({ selname: s(x.name).toUpperCase(), kind: (x.t_value || []).length > 1 || v.option !== 'EQ' ? 'S' : 'P', sign: s(v.sign || 'I'), option: s(v.option || 'EQ'), low: s(v.low), high: s(v.high) })));
      try {
        const obj = rt.new(j.class);
        const run = typeof obj['if_apj_rt_exec_object~execute'] === 'function' || rt.cls(j.class).$meta?.interfaces?.includes?.('if_apj_rt_exec_object') ? 'if_apj_rt_exec_object~execute' : 'if_apj_rt_run~execute';
        rt.call(obj, run, { it_parameters: params });
        rt.eml?.commit?.();
        set('F', { ended: now(), log: rt.$currentJob.logs[0] ?? null });
      } catch (e) {
        try { rt.eml?.rollback?.(); } catch {}
        rt.onError?.(e, `Application job ${j.jobname} ${j.jobcount}`);
        set('A', { ended: now(), message: e?.get_text ? s(e.get_text({}).$ret) : String(e?.message || e), log: rt.$currentJob.logs[0] ?? null });
      } finally { rt.$currentJob = null; }
      if (j.period_min > 0) db().prepare('INSERT INTO rap_apj_job (jobname, jobcount, template, catalog, class, text, status, username, start_at, period_min, params) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(j.jobname, String(Number(j.jobcount) + 1).padStart(8, '0'), j.template, j.catalog, j.class, j.text, 'S', j.username, j.start_at + j.period_min * 60000, j.period_min, j.params);
    }
    return due.length;
  };
}
