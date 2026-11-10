// Per-user settings of a system (like SU3 defaults): the date format, as SAP's DATFM codes. Kept next to the users
// file in the system directory (.rap-user-settings.json), also without users (development mode: the user name only).
import fs from 'node:fs';
import path from 'node:path';

export const SETTINGS_FILE = '.rap-user-settings.json';
// SAP's date formats (USR01-DATFM): pattern, separator order
export const DATE_FORMATS = {
  1: 'DD.MM.YYYY', 2: 'MM/DD/YYYY', 3: 'MM-DD-YYYY', 4: 'YYYY.MM.DD', 5: 'YYYY/MM/DD', 6: 'YYYY-MM-DD',
};
const DEFAULTS = { dateFormat: '1' };
const known = c => c !== undefined && c !== null && Object.hasOwn(DATE_FORMATS, String(c));
const norm = n => String(n || 'DEVELOPER').trim().toUpperCase().slice(0, 12);

let cache = new Map();
function load(dir) {
  const file = path.join(dir, SETTINGS_FILE);
  let mtime = 0;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return { users: {} }; }
  const c = cache.get(file);
  if (c && c.mtime === mtime) return c.data;
  let data = { users: {} };
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); if (!data || typeof data.users !== 'object') data = { users: {} }; } catch { /* a broken file: defaults */ }
  cache.set(file, { mtime, data });
  return data;
}

export function settingsOf(dir, user) {
  const s = Object.hasOwn(load(dir).users, norm(user)) ? load(dir).users[norm(user)] : {};
  return { ...DEFAULTS, ...(known(s?.dateFormat) ? { dateFormat: String(s.dateFormat) } : {}) };
}

export function setSettings(dir, user, { dateFormat } = {}) {
  if (dateFormat !== undefined && !known(dateFormat)) throw Object.assign(new Error(`Unknown date format ${dateFormat}`), { status: 400 });
  const data = load(dir);
  const users = { ...data.users };
  const u = norm(user);
  users[u] = { ...(Object.hasOwn(users, u) ? users[u] : {}), ...(dateFormat !== undefined ? { dateFormat: String(dateFormat) } : {}) };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, SETTINGS_FILE), JSON.stringify({ users }, null, 2) + '\n');
  return settingsOf(dir, user);
}

// YYYYMMDD -> the user's format ('' for an initial date)
export function formatDate(internal, code = '1') {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(internal ?? '').trim());
  if (!m) return String(internal ?? '');
  if (m[0] === '00000000') return '';
  const [, y, mo, d] = m;
  return { 1: `${d}.${mo}.${y}`, 2: `${mo}/${d}/${y}`, 3: `${mo}-${d}-${y}`, 4: `${y}.${mo}.${d}`, 5: `${y}/${mo}/${d}`, 6: `${y}-${mo}-${d}` }[code] || `${d}.${mo}.${y}`;
}

// a date typed in the user's format (or YYYYMMDD) -> YYYYMMDD; null when it is no date in that format
export function parseUserDate(text, code = '1') {
  const s = String(text ?? '').trim();
  let y, mo, d, m;
  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) [, y, mo, d] = m;
  else if (!['4', '5', '6'].includes(code) && (m = /^(\d{2})[./-](\d{2})[./-](\d{4})$/.exec(s))) {
    // day first (1) or month first (2, 3)
    if (code === '2' || code === '3') [, mo, d, y] = m; else [, d, mo, y] = m;
  } else if (['4', '5', '6'].includes(code) && (m = /^(\d{4})[./-](\d{2})[./-](\d{2})$/.exec(s))) [, y, mo, d] = m;
  else return null;
  mo = mo.padStart(2, '0'); d = d.padStart(2, '0');
  if (`${y}${mo}${d}` === '00000000') return '00000000';
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  return dt.getUTCFullYear() === Number(y) && dt.getUTCMonth() === Number(mo) - 1 && dt.getUTCDate() === Number(d) ? `${y}${mo}${d}` : null;
}
