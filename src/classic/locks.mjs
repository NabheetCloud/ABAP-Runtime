// Lock objects (ENQUEUE_/DEQUEUE_<name> function modules) of the classic engine. open-abap generates them as calls
// to the KERNEL_LOCK class, which open-abap-core leaves empty (single-threaded Node.js); here it becomes a lock
// table in the app's database, held per user session like SAP's enqueue server:
//   - another session holding the same key -> exception FOREIGN_LOCK, sy-msgv1 = the user holding it
//   - the same session may lock again (cumulative); DEQUEUE releases; a lock expires after
//     RAP_DRAFT_LOCK_MINUTES (default 15) without a dialog step, like an abandoned draft lock
import { AsyncLocalStorage } from 'node:async_hooks';

export const session = new AsyncLocalStorage();   // { id, user } of the request being processed

const lockMs = () => Number(process.env.RAP_DRAFT_LOCK_MINUTES ?? 15) * 60000;

export function installLocks(abap, client) {
  const db = client.db;
  db.exec('CREATE TABLE IF NOT EXISTS rap_enqueue (lock_key TEXT PRIMARY KEY, lock_name TEXT, table_name TEXT, owner TEXT, username TEXT, touched INTEGER)');
  db.exec('DELETE FROM rap_enqueue');   // a new engine process: the sessions holding the old locks are gone
  const value = v => { try { return String(v?.get?.() ?? v ?? '').replace(/ +$/, ''); } catch { return ''; } };
  const keyOf = (name, table, input) => `${name}|${table}|${Object.keys(input || {}).filter(k => !/^(mode_|_scope|_wait|_collect|x_)/i.test(k)).sort()
    .map(k => `${k.toLowerCase()}=${value(input[k])}`).join('|')}`;
  const owner = () => session.getStore()?.id || 'background';
  const user = () => session.getStore()?.user || value(abap.builtin.sy.get().uname);

  abap.Classes.KERNEL_LOCK = {
    enqueue: async ({ table_name, enqueue_name, input }) => {
      const name = value(enqueue_name), table = value(table_name), key = keyOf(name, table, input);
      const now = Date.now();
      db.prepare('DELETE FROM rap_enqueue WHERE touched < ?').run(now - lockMs());
      const held = db.prepare('SELECT owner, username FROM rap_enqueue WHERE lock_key = ?').get(key);
      if (held && held.owner !== owner()) {
        const sy = abap.builtin.sy.get();
        sy.msgv1?.set?.(held.username);
        sy.msgid?.set?.('MC'); sy.msgty?.set?.('E'); sy.msgno?.set?.('601');
        throw new abap.ClassicError({ classic: 'FOREIGN_LOCK' });
      }
      db.prepare('INSERT OR REPLACE INTO rap_enqueue (lock_key, lock_name, table_name, owner, username, touched) VALUES (?, ?, ?, ?, ?, ?)')
        .run(key, name, table, owner(), user(), now);
      abap.builtin.sy.get().subrc.set(0);
    },
    dequeue: async ({ table_name, enqueue_name, input }) => {
      db.prepare('DELETE FROM rap_enqueue WHERE lock_key = ? AND owner = ?').run(keyOf(value(enqueue_name), value(table_name), input), owner());
      abap.builtin.sy.get().subrc.set(0);
    },
  };
  // a session's dialog step keeps its locks alive
  return { touch: id => db.prepare('UPDATE rap_enqueue SET touched = ? WHERE owner = ?').run(Date.now(), id) };
}
