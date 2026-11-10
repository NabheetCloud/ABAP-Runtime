// Worker thread owning the asynchronous PostgreSQL connection (node-postgres or PGlite).
// The main thread blocks on a SharedArrayBuffer flag until the result has been posted back.
import { workerData } from 'node:worker_threads';
import fs from 'node:fs';

const { driver, target, schema, port, flag: flagBuffer } = workerData;
const flag = new Int32Array(flagBuffer);
let db;

async function init() {
  if (driver === 'pglite') {
    const { PGlite } = await import('@electric-sql/pglite');
    if (target !== 'memory') fs.mkdirSync(target, { recursive: true });
    db = target === 'memory' ? new PGlite() : new PGlite(target);
    await db.waitReady;
    db.$query = (sql, params) => db.query(sql, params).then(r => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }));
    db.$exec = (sql) => db.exec(sql);
  } else {
    const pg = (await import('pg')).default;
    pg.types.setTypeParser(20, v => (v === null ? null : Number(v)));    // int8 -> number
    pg.types.setTypeParser(1700, v => (v === null ? null : Number(v)));  // numeric -> number
    db = new pg.Client({ connectionString: target });
    await db.connect();
    db.$query = (sql, params) => db.query(sql, params).then(r => ({ rows: r.rows, rowCount: r.rowCount }));
    db.$exec = (sql) => db.query(sql);
  }
  // one schema per application keeps several apps in one database apart
  await db.$exec(`CREATE SCHEMA IF NOT EXISTS "${schema}"; SET search_path TO "${schema}"`);
}

function reply(msg) {
  port.postMessage(msg);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
}

port.on('message', async (msg) => {
  try {
    if (msg.op === 'init') { await init(); return reply({ result: true }); }
    if (msg.op === 'close') { await (db.close?.() ?? db.end?.()); return reply({ result: true }); }
    if (msg.op === 'exec') { await db.$exec(msg.sql); return reply({ result: true }); }
    if (msg.op === 'query') {
      const r = await db.$query(msg.sql, msg.params);
      // normalise like SQLite: plain objects, numbers for numeric/int8 (PGlite returns them typed already)
      const rows = r.rows.map(row => {
        const o = {};
        for (const [k, v] of Object.entries(row)) o[k] = typeof v === 'bigint' ? Number(v) : (v instanceof Date ? v.toISOString() : v);
        return o;
      });
      return reply({ result: { rows, rowCount: r.rowCount } });
    }
    reply({ error: `Unknown operation ${msg.op}` });
  } catch (e) {
    reply({ error: e.message });
  }
});
