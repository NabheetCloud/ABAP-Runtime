// Lock objects on the RAP runtime: ENQUEUE_<lock object> / DEQUEUE_<lock object> of the app's lock objects
// (.enqu.xml), for classes of a classic app that run as console applications (F9) or in RAP code. They use the
// classic engine's lock table (rap_enqueue in the app's database, see src/classic/locks.mjs) with the same keys, so a
// lock set by a transaction of the classic engine is a FOREIGN_LOCK here, and the other way round. The locks of a
// console run belong to that run and are released when it ends (as SAP releases the locks of a program).
const lockMs = () => Number(process.env.RAP_DRAFT_LOCK_MINUTES ?? 15) * 60000;

// lock objects of the app: name -> { table } from the DD25V of each .enqu.xml
export function lockObjects(enqus) {
  const out = new Map();
  for (const [, xml] of enqus) {
    const name = /<VIEWNAME>([^<]+)<\/VIEWNAME>/.exec(xml)?.[1]?.trim().toUpperCase();
    const table = /<ROOTTAB>([^<]+)<\/ROOTTAB>/.exec(xml)?.[1]?.trim().toUpperCase();
    if (name) out.set(name, { table: table || '' });
  }
  return out;
}

export function installRapLocks(rt, db, objects) {
  if (!db || !objects?.size) return;
  let ready = false;
  const table = () => {
    if (!ready) { db.exec('CREATE TABLE IF NOT EXISTS rap_enqueue (lock_key TEXT PRIMARY KEY, lock_name TEXT, table_name TEXT, owner TEXT, username TEXT, touched INTEGER)'); ready = true; }
    return db;
  };
  const value = v => String(rt.s(v ?? '')).replace(/ +$/, '');
  // the key the classic engine builds: lock object | table | the parameters passed (not the mode / scope ones)
  const keyOf = (name, tab, args) => `${name}|${tab}|${Object.keys(args || {}).filter(k => !/^(mode_|_scope|_wait|_collect|x_)/i.test(k)).sort()
    .map(k => `${k.toLowerCase()}=${value(args[k])}`).join('|')}`;
  const owner = () => rt.$lockOwner || 'rap';
  rt.lockFunction = (fm, args) => {
    const m = /^(ENQUEUE|DEQUEUE)_(.+)$/.exec(fm);
    const obj = m && objects.get(m[2]);
    if (!obj) return null;
    const d = table(), key = keyOf(m[2], obj.table, args), now = Date.now();
    if (m[1] === 'DEQUEUE') { d.prepare('DELETE FROM rap_enqueue WHERE lock_key = ? AND owner = ?').run(key, owner()); rt.sy.subrc = 0; return {}; }
    d.prepare('DELETE FROM rap_enqueue WHERE touched < ?').run(now - lockMs());
    const held = d.prepare('SELECT owner, username FROM rap_enqueue WHERE lock_key = ?').get(key);
    if (held && held.owner !== owner()) {
      Object.assign(rt.sy, { msgv1: held.username, msgid: 'MC', msgty: 'E', msgno: '601' });
      throw rt.classicException('foreign_lock');
    }
    d.prepare('INSERT OR REPLACE INTO rap_enqueue (lock_key, lock_name, table_name, owner, username, touched) VALUES (?, ?, ?, ?, ?, ?)')
      .run(key, m[2], obj.table, owner(), String(rt.sy.uname || 'DEVELOPER'), now);
    rt.sy.subrc = 0;
    return {};
  };
  // the locks of one run (console class): released at its end
  rt.releaseLocks = who => { try { table().prepare('DELETE FROM rap_enqueue WHERE owner = ?').run(who); } catch {} };
}
