// Database adapters. The runtime talks to one small synchronous interface:
//   db.prepare(sql).all(...params) / .get(...params) / .run(...params)  (params as "?" placeholders)
//   db.exec(sql), db.close(), db.kind, db.dialect
//   db.tableExists(name), db.tableColumns(name), db.views(), db.dropView(name)
// Implementations:
//   sqlite   node:sqlite (default, file per app in .rap/data.db)
//   postgres any PostgreSQL server: --db postgres://user:pw@host:5432/db  (one schema per app)
//   pglite   embedded PostgreSQL (WebAssembly):  --db pglite  (data in .rap/pgdata)  or  pglite:memory
// PostgreSQL drivers are asynchronous; the ABAP runtime is synchronous, so the PostgreSQL adapter runs the
// driver in a worker thread and waits for each result with Atomics.wait (same semantics as a blocking DB call).
import { DatabaseSync } from 'node:sqlite';
import { Worker, MessageChannel, receiveMessageOnPort } from 'node:worker_threads';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function openDatabase({ url, dir, schema }) {
  const u = url || process.env.RAP_DB || 'sqlite';
  if (u === 'sqlite' || u.startsWith('sqlite:') || u === ':memory:' || u.endsWith('.db')) {
    const file = u === ':memory:' || u === 'sqlite:memory' ? ':memory:' : u.startsWith('sqlite:') ? u.slice(7) : u.endsWith('.db') ? u : path.join(dir, '.rap', 'data.db');
    return new SqliteAdapter(file);
  }
  if (u === 'pglite' || u.startsWith('pglite:')) {
    const target = u === 'pglite:memory' ? 'memory' : (u.startsWith('pglite:') ? u.slice(7) : path.join(dir, '.rap', 'pgdata'));
    return new PostgresAdapter({ driver: 'pglite', target, schema });
  }
  if (/^postgres(ql)?:\/\//.test(u)) return new PostgresAdapter({ driver: 'pg', target: u, schema });
  throw new Error(`Unsupported database ${u} (use sqlite, pglite or postgres://...)`);
}

// ------------------------------------------------------------------------------------------------ SQLite
class SqliteAdapter {
  constructor(file) {
    this.kind = 'sqlite';
    this.dialect = SQLITE;
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    // the studio server and CLI runs (rap run / curl tests by the agent) share the file: WAL + busy timeout
    if (file !== ':memory:') { try { this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;'); } catch {} }
    this.sessionUser = 'DEVELOPER';
    this.db.function('rap_session_user', { deterministic: false }, () => this.sessionUser);
    // ABAP SQL functions SQLite does not have: div (integer division) and division (rounded to n decimals)
    this.db.function('div', { deterministic: true }, (a, b) => (b == 0 ? null : Math.trunc(Number(a) / Number(b))));
    this.db.function('division', { deterministic: true }, (a, b, d) => (b == 0 ? null : Number((Number(a) / Number(b)).toFixed(Number(d)))));
  }
  setSessionUser(u) { this.sessionUser = u; }
  // values with a database form of their own (exact packed numbers: their decimal text) are bound as that
  prepare(sql) {
    const st = this.db.prepare(sql);
    const p = a => a.map(dbParam);
    return Object.assign(Object.create(st), { all: (...a) => st.all(...p(a)), get: (...a) => st.get(...p(a)), run: (...a) => st.run(...p(a)), iterate: (...a) => st.iterate(...p(a)) });
  }
  exec(sql) { return this.db.exec(sql); }
  close() { this.db.close(); }
  tableExists(name) { return !!this.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name); }
  tableColumns(name) { return this.db.prepare(`PRAGMA table_info("${name}")`).all().map(r => r.name); }
  views() { return this.db.prepare(`SELECT name FROM sqlite_master WHERE type = 'view'`).all().map(r => r.name); }
  dropView(name) { this.db.exec(`DROP VIEW IF EXISTS "${name}"`); }
}

// ------------------------------------------------------------------------------------------------ PostgreSQL
class PostgresAdapter {
  constructor({ driver, target, schema }) {
    this.kind = 'postgres';
    this.driver = driver;
    this.dialect = POSTGRES;
    this.schema = (schema || 'rap').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    this.depth = 0; // emulated transaction nesting (SAVEPOINT outside a transaction -> BEGIN)
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    this.flag = new Int32Array(new SharedArrayBuffer(4));
    const workerFile = path.join(path.dirname(fileURLToPath(import.meta.url)), 'pg-worker.js');
    this.worker = new Worker(workerFile, { workerData: { driver, target, schema: this.schema, port: port2, flag: this.flag.buffer }, transferList: [port2] });
    this.worker.unref();
    this.call({ op: 'init' });
  }
  call(msg) {
    Atomics.store(this.flag, 0, 0);
    this.port.postMessage(msg);
    const r = Atomics.wait(this.flag, 0, 0, 120000);
    if (r === 'timed-out') throw new Error('Database call timed out');
    let m;
    for (let i = 0; i < 1000 && !(m = receiveMessageOnPort(this.port)); i++) Atomics.wait(this.flag, 0, 1, 5);
    if (!m) throw new Error('No response from database worker');
    if (m.message.error) {
      const e = new Error(m.message.error);
      e.sql = msg.sql;
      throw e;
    }
    return m.message.result;
  }
  prepare(sql) {
    const text = toPgPlaceholders(this.dialect.translate(sql));
    return {
      all: (...params) => this.call({ op: 'query', sql: text, params: params.map(pgParam) }).rows,
      get: (...params) => this.call({ op: 'query', sql: text, params: params.map(pgParam) }).rows[0],
      run: (...params) => ({ changes: this.call({ op: 'query', sql: text, params: params.map(pgParam) }).rowCount }),
    };
  }
  exec(sql) {
    // savepoints only exist inside transactions in PostgreSQL: the outermost one becomes BEGIN / COMMIT / ROLLBACK
    const s = sql.trim();
    let m;
    if ((m = /^SAVEPOINT\s+(\w+)$/i.exec(s))) { this.call({ op: 'exec', sql: this.depth++ === 0 ? 'BEGIN' : s }); return; }
    if ((m = /^RELEASE\s+(\w+)$/i.exec(s))) { this.call({ op: 'exec', sql: --this.depth === 0 ? 'COMMIT' : s }); return; }
    if ((m = /^ROLLBACK\s+TO\s+(\w+)$/i.exec(s))) { this.call({ op: 'exec', sql: this.depth === 1 ? 'ROLLBACK' : s }); if (this.depth === 1) this.rolledBack = true; return; }
    if (/^BEGIN$/i.test(s)) { this.depth++; this.call({ op: 'exec', sql: 'BEGIN' }); return; }
    if (/^COMMIT$/i.test(s)) { this.depth = Math.max(0, this.depth - 1); this.call({ op: 'exec', sql: 'COMMIT' }); return; }
    if (/^ROLLBACK$/i.test(s)) { this.depth = Math.max(0, this.depth - 1); this.call({ op: 'exec', sql: 'ROLLBACK' }); return; }
    this.call({ op: 'exec', sql: this.dialect.translate(sql) });
  }
  close() { try { this.call({ op: 'close' }); } catch {} this.worker.terminate(); }
  setSessionUser(u) { if (u !== this.sessionUser) { this.sessionUser = u; this.call({ op: 'exec', sql: `SELECT set_config('rap.user', '${String(u).replace(/'/g, "''")}', false)` }); } }
  tableExists(name) { return !!this.prepare(`SELECT 1 AS x FROM information_schema.tables WHERE table_schema = ? AND table_name = ? AND table_type = 'BASE TABLE'`).get(this.schema, name); }
  tableColumns(name) { return this.prepare(`SELECT column_name AS name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?`).all(this.schema, name).map(r => r.name); }
  views() { return this.prepare(`SELECT table_name AS name FROM information_schema.views WHERE table_schema = ?`).all(this.schema).map(r => r.name); }
  dropView(name) { this.exec(`DROP VIEW IF EXISTS "${name}" CASCADE`); }
}

function pgParam(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 'X' : '';
  return dbParam(v);
}
function dbParam(v) { return v !== null && typeof v === 'object' && typeof v.toDb === 'function' ? v.toDb() : v; }
// "?" -> $1, $2 ... (outside string literals and quoted identifiers)
function toPgPlaceholders(sql) {
  let out = '', n = 0, q = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (q) { out += c; if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; out += c; continue; }
    if (c === '?') { out += `$${++n}`; continue; }
    out += c;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ dialects
// Generated SQL is written once; dialect hooks produce the few constructs that differ.
const dateExpr = (x) => `to_date(NULLIF(${x}, ''), 'YYYYMMDD')`;
export const SQLITE = {
  name: 'sqlite',
  type(ti) {
    if (['i', 'int8'].includes(ti.t)) return 'INTEGER';
    if (['p', 'f', 'tsl', 'ts'].includes(ti.t)) return 'REAL';
    return 'TEXT';
  },
  today: () => `strftime('%Y%m%d','now')`,
  nowTimestamp: () => `CAST(strftime('%Y%m%d%H%M%S','now') AS INTEGER)`,
  daysBetween: (a, b) => `CAST(julianday(substr(${b},1,4)||'-'||substr(${b},5,2)||'-'||substr(${b},7,2)) - julianday(substr(${a},1,4)||'-'||substr(${a},5,2)||'-'||substr(${a},7,2)) AS INTEGER)`,
  addDays: (a, n) => `strftime('%Y%m%d', substr(${a},1,4)||'-'||substr(${a},5,2)||'-'||substr(${a},7,2), (${n}) || ' days')`,
  addMonths: (a, n) => `strftime('%Y%m%d', substr(${a},1,4)||'-'||substr(${a},5,2)||'-'||substr(${a},7,2), (${n}) || ' months')`,
  round: (a, n) => `round(${a}, ${n})`,
  div: (a, b) => `CAST((${a}) / (${b}) AS INTEGER)`,
  division: (a, b, d) => `round(CAST(${a} AS REAL) / (${b}), ${d})`,
  instr: (a, b) => `instr(${a}, ${b})`,
  castText: (a) => `CAST(${a} AS TEXT)`,
  upsert: (table, cols) => `INSERT OR REPLACE INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
  insertIgnore: (table, cols) => `INSERT OR IGNORE INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
  translate: (sql) => sql,
  sessionUser: () => 'rap_session_user()',
};
export const POSTGRES = {
  name: 'postgres',
  type(ti) {
    if (ti.t === 'i') return 'INTEGER';
    if (ti.t === 'int8') return 'BIGINT';
    if (['p', 'f', 'tsl', 'ts'].includes(ti.t)) return 'DOUBLE PRECISION';
    return 'TEXT';
  },
  today: () => `to_char(current_date, 'YYYYMMDD')`,
  nowTimestamp: () => `CAST(to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS') AS BIGINT)`,
  daysBetween: (a, b) => `(${dateExpr(b)} - ${dateExpr(a)})`,
  addDays: (a, n) => `to_char(${dateExpr(a)} + CAST(${n} AS INTEGER), 'YYYYMMDD')`,
  addMonths: (a, n) => `to_char(${dateExpr(a)} + make_interval(months => CAST(${n} AS INTEGER)), 'YYYYMMDD')`,
  round: (a, n) => `round(CAST(${a} AS NUMERIC), ${n})::double precision`,
  div: (a, b) => `CAST(trunc((${a}) / (${b})) AS INTEGER)`,
  division: (a, b, d) => `round(CAST(${a} AS NUMERIC) / (${b}), ${d})::double precision`,
  instr: (a, b) => `strpos(${a}, ${b})`,
  castText: (a) => `CAST(${a} AS TEXT)`,
  upsert: (table, cols, keys) => `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT (${keys.map(k => `"${k}"`).join(', ')}) DO UPDATE SET ${cols.filter(c => !keys.includes(c)).map(c => `"${c}" = EXCLUDED."${c}"`).join(', ') || `"${keys[0]}" = EXCLUDED."${keys[0]}"`}`,
  insertIgnore: (table, cols) => `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')}) ON CONFLICT DO NOTHING`,
  // SQLite-isms that may still appear in hand-written ABAP SQL translation
  translate: (sql) => sql.replace(/\bINSERT OR IGNORE INTO\b/gi, 'INSERT INTO').replace(/\bLIMIT\s+-1\b/gi, ''),
  sessionUser: () => `COALESCE(current_setting('rap.user', true), 'DEVELOPER')`,
};
