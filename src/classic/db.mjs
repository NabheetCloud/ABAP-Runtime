// Database client for the classic ABAP engine (@abaplint/runtime) on the app's own SQLite file, so reports,
// module pools and function modules work on the same tables as the RAP application.
// Implements the client interface of @abaplint/database-sqlite with node:sqlite instead of in-memory sql.js.
import { DatabaseSync } from 'node:sqlite';

export class AppDatabaseClient {
  name = 'sqlite';
  constructor(file, { trace = false } = {}) { this.file = file; this.trace = trace; this.inTransaction = false; this.columns = new Map(); }

  async connect() {
    this.db = new DatabaseSync(this.file);
    try { this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;'); } catch {}
    if (globalThis.abap?.context?.databaseConnections?.DEFAULT === this) globalThis.abap.builtin.sy.get().dbsys?.set(this.name);
  }
  async disconnect() { await this.commit(); this.db.close(); }

  // other apps' tables [{ name, app, db }]: the owner's database is attached and read through TEMP views
  attachExternals(list) {
    const aliases = new Map();
    for (const x of list) {
      try {
        let alias = aliases.get(x.db);
        if (!alias) { alias = `ext${aliases.size + 1}`; this.db.exec(`ATTACH DATABASE '${x.db.replace(/'/g, "''")}' AS ${alias}`); aliases.set(x.db, alias); }
        this.db.exec(`CREATE TEMP VIEW IF NOT EXISTS "${x.name}" AS SELECT * FROM ${alias}."${x.name}"`);
      } catch (e) { console.error(`[classic] table ${x.name} of app ${x.app} cannot be read: ${e.message}`); }
    }
  }

  // the RAP runtime owns the app's tables; the classic engine only adds the ones it does not have yet
  async createMissing(statements, skip = new Set()) {
    for (const s of [].concat(statements || [])) {
      if (!s) continue;
      const table = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?[`'"]?(\w+)/i.exec(s)?.[1]?.toLowerCase();
      if (table && skip.has(table)) continue;
      const sql = s.replace(/^\s*CREATE TABLE\s+(?!IF NOT EXISTS)/i, 'CREATE TABLE IF NOT EXISTS ');
      try { this.db.exec(sql); } catch (e) { if (this.trace) console.error(`[classic db] ${e.message}: ${sql.slice(0, 120)}`); }
    }
    this.columns.clear();
  }
  async upsert(statements) {
    for (const s of [].concat(statements || []).flatMap(x => String(x).split(/;\s*\n(?=INSERT)/i))) {
      if (!s.trim()) continue;
      try { this.db.exec(s.replace(/^\s*INSERT INTO/i, 'INSERT OR REPLACE INTO')); } catch (e) { if (this.trace) console.error(`[classic db] ${e.message}`); }
    }
  }
  async execute(sql) {
    if (!sql) return;
    if (Array.isArray(sql)) { for (const s of sql) await this.execute(s); return; }
    this.db.exec(sql);
  }
  async beginTransaction() { if (this.inTransaction) return; this.db.exec('BEGIN'); this.inTransaction = true; }
  async commit() { this.end('COMMIT'); }
  async rollback() { this.end('ROLLBACK'); }
  end(sql) { if (!this.inTransaction) return; this.db.exec(sql); this.inTransaction = false; }

  // columns of a table, for leaving out fields the shared table does not have (e.g. MANDT)
  cols(table) {
    const t = String(table).replace(/["`']/g, '').toLowerCase();
    if (!this.columns.has(t)) { try { this.columns.set(t, new Set(this.db.prepare(`PRAGMA table_info("${t}")`).all().map(r => r.name.toLowerCase()))); } catch { this.columns.set(t, new Set()); } }
    return this.columns.get(t);
  }
  changes(sql) {
    sql = trimLiterals(sql);
    if (this.trace) console.log(sql);
    try { const r = this.db.prepare(sql).run(); return { subrc: r.changes ? 0 : 4, dbcnt: Number(r.changes) }; }
    catch (e) { if (this.trace) console.error(e.message); return { subrc: 4, dbcnt: 0 }; }
  }
  async delete(o) { await this.beginTransaction(); return this.changes(`DELETE FROM ${o.table}${o.where ? ` WHERE ${o.where}` : ''}`); }
  async update(o) {
    await this.beginTransaction();
    const have = this.cols(o.table);
    const set = have.size ? o.set.filter(s => have.has(s.split('=')[0].trim().replace(/["'`]/g, '').toLowerCase())) : o.set;
    if (!set.length) return { subrc: 4, dbcnt: 0 };
    return this.changes(`UPDATE ${o.table} SET ${set.join(', ')} WHERE ${o.where}`);
  }
  async insert(o) {
    await this.beginTransaction();
    const have = this.cols(o.table);
    const idx = o.columns.map((c, i) => [c, i]).filter(([c]) => !have.size || have.has(String(c).toLowerCase()));
    const r = this.changes(`INSERT INTO ${o.table} (${idx.map(([c]) => `"${c}"`).join(',')}) VALUES (${idx.map(([, i]) => o.values[i]).join(',')})`);
    return r.subrc ? r : { subrc: 0, dbcnt: 1 };
  }
  fix(select, primaryKey) {
    let s = select.replace(/ UP TO (\d+) ROWS(.*)/i, '$2 LIMIT $1');
    s = primaryKey ? s.replace(/ ORDER BY PRIMARY KEY/i, ' ORDER BY ' + primaryKey.join(', ')) : s.replace(/ ORDER BY PRIMARY KEY/i, '');
    return trimLiterals(s).replace(/ ASCENDING/ig, ' ASC').replace(/ DESCENDING/ig, ' DESC').replace(/~/g, '.').replace(/ LIMIT 0/g, '')
      .replace(/\bLEFT\s*\(\s*(.+?)\s*,\s*(\d+)\s*\)/ig, 'substr($1, 1, $2)').replace(/\bRIGHT\s*\(\s*(.+?)\s*,\s*(\d+)\s*\)/ig, 'substr($1, -$2)');
  }
  async select(o) {
    const sql = this.fix(o.select, o.primaryKey);
    if (this.trace) console.log(sql);
    try { return { rows: this.db.prepare(sql).all() }; }
    catch (e) {
      const cx = globalThis.abap?.Classes?.CX_SY_DYNAMIC_OSQL_SEMANTICS;
      if (cx) throw await new cx().constructor_({ sqlmsg: e.message || '' });
      throw e;
    }
  }
  async openCursor(o) {
    const it = this.db.prepare(this.fix(o.select)).iterate();
    return {
      fetchNextCursor: async (size) => { const rows = []; for (let r = it.next(); !r.done; r = it.next()) { rows.push(r.value); if (rows.length === size) break; } return { rows }; },
      closeCursor: async () => { it.return?.(); },
    };
  }
}

// CHAR values are compared without trailing blanks in ABAP; the RAP runtime stores them trimmed, so string
// literals of the classic engine ('LH ') are trimmed too
function trimLiterals(sql) { return sql.replace(/'((?:[^']|'')*)'/g, (all, body) => `'${body.replace(/ +$/, '')}'`); }
