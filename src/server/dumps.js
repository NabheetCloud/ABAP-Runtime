// Runtime errors (like ST22): an exception that no ABAP code caught is recorded with its class, text, the ABAP call
// stack (file, line, class, method of every frame) and the source around the failing statement. The generated code
// carries the statements' positions (/*file:line*/) and a source name per class (abap:<class>), so the JavaScript
// stack trace maps back to ABAP. Kept in the app's database (rap_dump, the last 200).
import fs from 'node:fs';
import path from 'node:path';

const TAG = /\/\*([^*:]*\.abap):(\d+)\*\//g;

// the ABAP frames of an error: [{ cls, method, file, line }], innermost first
export function abapFrames(err, model) {
  const out = [];
  for (const l of String(err?.stack || '').split('\n')) {
    const m = /at (?:\S+\.)?([\w$~/]+) \(abap:([\w/$]+):(\d+):(\d+)\)/.exec(l) || /at (abap):([\w/$]+):(\d+):(\d+)/.exec(l);
    if (!m) continue;
    const [, method, cls, ln, col] = m;
    const lines = model?.classes.get(cls)?.js?.split('\n');
    let file = '', line = null;
    // the statement: the last position tag at or before the column on that line, else on the lines above it
    for (let k = Number(ln) - 3; lines && k >= 0 && !file; k--) {
      const text = k === Number(ln) - 3 ? lines[k]?.slice(0, Number(col)) : lines[k];
      const tags = [...String(text || '').matchAll(TAG)];
      if (tags.length) { file = tags.at(-1)[1]; line = Number(tags.at(-1)[2]); }
    }
    out.push({ cls, method: method === 'abap' ? '' : method.replace(/^\$cls\./, ''), file, line });
  }
  return out;
}

const ensure = db => db.exec('CREATE TABLE IF NOT EXISTS rap_dump (id INTEGER PRIMARY KEY, created BIGINT, username TEXT, context TEXT, exception TEXT, message TEXT, file TEXT, line INTEGER, frames TEXT, source TEXT)');

export function recordDump(ws, err, context) {
  try {
    const db = ws.app?.db;
    if (!db || !err || typeof err !== 'object') return null;   // (the debugger's stop is not an error)
    ensure(db);
    const rt = ws.app.rt;
    const frames = abapFrames(err, ws.app.model);
    const top = frames.find(f => f.file) || {};
    let source = [];
    if (top.file) {
      try {
        const lines = fs.readFileSync(path.join(ws.dir, top.file), 'utf8').split('\n');
        source = lines.slice(Math.max(0, top.line - 6), top.line + 4).map((text, k) => ({ line: Math.max(0, top.line - 6) + k + 1, text }));
      } catch {}
    }
    const exception = String(err?.constructor?.$name || err?.name || 'Error').toUpperCase();
    const message = err?.get_text ? rt.s(err.get_text({}).$ret) : String(err?.message || err);
    const id = Number(db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM rap_dump').get().n);   // (portable: SQLite and PostgreSQL)
    db.prepare('INSERT INTO rap_dump (id, created, username, context, exception, message, file, line, frames, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, Date.now(), rt.sy.uname || 'DEVELOPER', context || '', exception, message, top.file || '', top.line ?? null, JSON.stringify(frames), JSON.stringify(source));
    db.prepare('DELETE FROM rap_dump WHERE id <= ?').run(id - 200);
    return id;
  } catch (e) { if (process.env.RAP_DEBUG) console.error('runtime error not recorded:', e); return null; }
}

export function listDumps(ws, top = 50) {
  try { ensure(ws.app.db); } catch { return []; }
  return ws.app.db.prepare('SELECT id, created, username, context, exception, message, file, line FROM rap_dump ORDER BY id DESC LIMIT ?').all(top);
}
export function getDump(ws, id) {
  ensure(ws.app.db);
  const d = ws.app.db.prepare('SELECT * FROM rap_dump WHERE id = ?').get(Number(id));
  return d ? { ...d, frames: JSON.parse(d.frames || '[]'), source: JSON.parse(d.source || '[]') } : null;
}
export function clearDumps(ws) { ensure(ws.app.db); ws.app.db.exec('DELETE FROM rap_dump'); }
