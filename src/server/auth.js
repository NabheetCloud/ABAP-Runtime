// Users, roles and authorizations of a system, like SU01 users and PFCG roles on an SAP system.
// Stored in .rap-users.json next to the apps (the system folder) or in the app folder for `rap serve`:
//   { "users": { "ALICE": { "password": "scrypt$<salt>$<hash>", "fullName": "Alice", "roles": ["Z_SALES"], "admin": false } },
//     "roles": { "Z_SALES": { "ZSALES_ORG": [{ "ACTVT": ["01", "02", "03"], "ZSALESORG": ["1000", "2*"] }] } } }
// Without users the system runs in development mode: no login, the user is chosen freely and has all authorizations.
// With users, every request must be authenticated (login form + session cookie, or HTTP Basic).
import fs from 'node:fs';
import path from 'node:path';
import crypto, { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const USERS_FILE = '.rap-users.json';
const SESSION_HOURS = 12;

export function hashPassword(pw) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(String(pw), salt, 32).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const a = Buffer.from(hash, 'hex'), b = scryptSync(String(pw), salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}
const norm = n => String(n || '').toUpperCase().replace(/[^A-Z0-9_.@-]/g, '').slice(0, 12);

export class AuthStore {
  constructor(file) {
    this.file = file;
    this.sessions = new Map();   // token -> { user, expires }
    this.mtime = -1;
    this.data = { users: {}, roles: {} };
  }
  load() {
    let m = -1;
    try { m = fs.statSync(this.file).mtimeMs; } catch {}
    if (m !== this.mtime) {
      this.mtime = m;
      try { this.data = m < 0 ? { users: {}, roles: {} } : JSON.parse(fs.readFileSync(this.file, 'utf8')); }
      catch (e) { throw new Error(`${path.basename(this.file)} is not valid JSON: ${e.message}`); }
      this.data.users ||= {}; this.data.roles ||= {};
    }
    return this.data;
  }
  // password hashes: readable by the owner only
  save() { fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2) + '\n', { mode: 0o600 }); try { fs.chmodSync(this.file, 0o600); } catch {} this.mtime = fs.statSync(this.file).mtimeMs; }
  get enabled() { return Object.keys(this.load().users).length > 0; }
  user(name) { return this.load().users[norm(name)] || null; }

  // ---------------------------------------------------------------- administration (rap user / rap role)
  setUser(name, { password, fullName, roles, admin } = {}) {
    const d = this.load(), n = norm(name);
    if (!n) throw new Error('User name missing');
    const u = d.users[n] || { roles: [] };
    if (password !== undefined) u.password = hashPassword(password);
    if (!u.password) throw new Error(`User ${n} needs a password`);
    if (fullName !== undefined) u.fullName = fullName;
    if (roles !== undefined) u.roles = roles.map(r => String(r).toUpperCase());
    if (admin !== undefined) u.admin = !!admin;
    d.users[n] = u;
    this.save();
    return n;
  }
  deleteUser(name) { const d = this.load(); delete d.users[norm(name)]; this.save(); }
  // add one authorization (an instance of an authorization object) to a role
  grant(role, object, fields) {
    const d = this.load(), r = String(role).toUpperCase(), o = String(object).toUpperCase();
    ((d.roles[r] ||= {})[o] ||= []).push(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k.toUpperCase(), [].concat(v).map(String)])));
    this.save();
  }

  // ---------------------------------------------------------------- authentication
  login(name, password) {
    const n = norm(name), u = this.user(n);
    if (!u || !verifyPassword(password, u.password)) return null;
    const token = randomBytes(24).toString('hex');
    this.sessions.set(token, { user: n, expires: Date.now() + SESSION_HOURS * 3600e3 });
    return token;
  }
  logout(token) { this.sessions.delete(token); }
  // the authenticated user of a request, or null
  authenticate(headers = {}) {
    const token = /(?:^|;\s*)rap_session=([a-f0-9]+)/.exec(headers.cookie || '')?.[1];
    if (token) {
      const s = this.sessions.get(token);
      if (s && s.expires > Date.now() && this.user(s.user)) return s.user;
      this.sessions.delete(token);
    }
    if (/^Basic /i.test(headers.authorization || '')) {
      const [n, ...pw] = Buffer.from(headers.authorization.slice(6), 'base64').toString().split(':');
      const u = this.user(n);
      if (u && verifyPassword(pw.join(':'), u.password)) return norm(n);
    }
    return null;
  }

  // ---------------------------------------------------------------- authorizations
  // { OBJECT: [ { FIELD: [values] } ] } of a user, or null = all authorizations (development mode, admins)
  authorizationsOf(name) {
    if (!this.enabled) return null;
    const u = this.user(name);
    if (!u) return {};
    if (u.admin || (u.roles || []).includes('SAP_ALL')) return null;
    const out = {};
    for (const r of u.roles || []) for (const [o, inst] of Object.entries(this.load().roles[String(r).toUpperCase()] || {})) (out[o] ||= []).push(...inst);
    return out;
  }
}

// AUTHORITY-CHECK semantics: sy-subrc 0 = authorized, 4 = not for these values, 12 = no authorization for the object
export function authorityCheck(auths, object, fields) {
  if (auths === null) return 0;
  const inst = auths[String(object).toUpperCase()];
  if (!inst?.length) return 12;
  return inst.some(a => Object.entries(fields).every(([f, v]) => v === undefined || valueAllowed(a[f.toUpperCase()], v))) ? 0 : 4;
}
export function valueAllowed(allowed, v) {
  if (!allowed) return false;
  const s = String(v ?? '');
  return allowed.some(p => p === '*' || p === s || (p.endsWith('*') && s.startsWith(p.slice(0, -1))));
}

const stores = new Map();
export function authStoreFor(dir) {
  const f = path.resolve(dir, USERS_FILE);
  if (!stores.has(f)) stores.set(f, new AuthStore(f));
  return stores.get(f);
}

// login page and gate for a server; returns true when the request was answered here
export function authGate(store, req, res, body, { allowAnonymous = [] } = {}) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  if (p === '/login' && req.method === 'POST') {
    const f = new URLSearchParams(body || '');
    const token = store.enabled ? store.login(f.get('user'), f.get('password')) : null;
    const next = safeNext(f.get('next'));
    if (!token) { res.writeHead(302, { Location: `/login?failed=1&next=${encodeURIComponent(next)}` }); res.end(); return true; }
    res.writeHead(302, { Location: next, 'Set-Cookie': `rap_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}` });
    res.end();
    return true;
  }
  if (p === '/login') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(loginPage(url.searchParams.get('failed'), safeNext(url.searchParams.get('next')))); return true; }
  if (p === '/logout') {
    const token = /(?:^|;\s*)rap_session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
    if (token) store.logout(token);
    res.writeHead(302, { Location: '/login', 'Set-Cookie': ['rap_session=; Path=/; Max-Age=0', 'rap_csig=; Path=/; Max-Age=0'] });
    res.end();
    return true;
  }
  // development mode: the user comes from the x-rap-user header / rap_user cookie as before
  delete req.headers['x-rap-auth'];
  if (!store.enabled) return false;
  const user = store.authenticate(req.headers);
  if (!user) {
    if (allowAnonymous.some(a => p.startsWith(a))) return false;
    const wantsHtml = req.method === 'GET' && /text\/html/.test(req.headers.accept || '');
    if (wantsHtml) { res.writeHead(302, { Location: `/login?next=${encodeURIComponent(url.pathname + url.search)}` }); res.end(); return true; }
    // no Basic challenge for browsers (cached Basic credentials would go with requests other sites make)
    const browser = /mozilla/i.test(req.headers['user-agent'] || '');
    res.writeHead(401, { 'Content-Type': 'application/json', ...(browser ? {} : { 'WWW-Authenticate': 'Basic realm="RAP"' }) });
    res.end(JSON.stringify({ error: { code: '401', message: 'Log on first' } }));
    return true;
  }
  // the authenticated user replaces anything the client claims; the classic engines learn it from a signed cookie
  const sig = signUser(path.dirname(store.file), user);
  if (!String(req.headers.cookie || '').split(/;\s*/).includes(`rap_csig=${sig}`)) res.appendHeader?.('Set-Cookie', `rap_csig=${sig}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`);
  req.headers['x-rap-user'] = user;
  req.headers['x-rap-auth'] = '1';
  req.headers.cookie = String(req.headers.cookie || '').replace(/(?:^|;\s*)rap_user=[^;]*/g, '');
  return false;
}
// after login only a path on this server: one "/" followed by neither "/" nor "\\" (browsers treat "/\\host" as
// "//host"), no control characters or whitespace (they are stripped or folded by browsers)
export function safeNext(n) {
  if (typeof n !== 'string' || n.length > 2000 || !/^\/(?![/\\])/.test(n)) return '/';
  for (let i = 0; i < n.length; i++) { const c = n.charCodeAt(i); if (c <= 32 || c === 127 || c === 92) return '/'; }
  return n;
}

function loginPage(failed, next) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Log on</title>
<style>
:root{--bg:#f5f6f7;--card:#fff;--fg:#1d2d3e;--muted:#556b82;--line:#d9dee3;--accent:#0a6ed1;--err:#bb0000}
@media (prefers-color-scheme:dark){:root{--bg:#12171c;--card:#1d232a;--fg:#e8edf2;--muted:#9aa8b5;--line:#344150;--accent:#4db1ff;--err:#ff8888}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
form{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px;width:100%;max-width:340px;display:grid;gap:14px}
h1{font-size:20px;margin:0 0 4px}p{margin:0;color:var(--muted);font-size:13px}label{display:grid;gap:4px;font-size:13px;color:var(--muted)}
input{font:inherit;padding:9px 10px;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--fg)}
button{font:inherit;padding:10px;border:0;border-radius:6px;background:var(--accent);color:#fff;font-weight:600;cursor:pointer}.err{color:var(--err)}
</style></head><body><form method="post" action="/login"><h1>Log on</h1><p>RAP system</p>
${failed ? '<p class="err">User or password is wrong.</p>' : ''}
<label>User<input name="user" autocomplete="username" autofocus required></label>
<label>Password<input name="password" type="password" autocomplete="current-password" required></label>
<input type="hidden" name="next" value="${esc(next)}"><button type="submit">Log on</button></form></body></html>`;
}

// Requests from other sites and other host names never reach the servers (studio, rap serve): a web page the user
// visits cannot change anything (no CSRF, also with cached Basic credentials) and a DNS-rebinding name cannot read
// anything. Host: one of this machine's loopback names, or the host the server was exposed on (--host); a server
// bound to all interfaces (--host 0.0.0.0) accepts any Host and still refuses cross-site changes.
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
export function requestGuard(req, res, { host = '127.0.0.1' } = {}) {
  const hostName = String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  const anyHost = host === '0.0.0.0' || host === '::';
  if (!anyHost && hostName && !LOOPBACK.has(hostName) && hostName !== String(host).toLowerCase() && !hostName.endsWith('.localhost')) {
    res.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`This server does not answer for ${hostName}`);
    return true;
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const site = String(req.headers['sec-fetch-site'] || '');
    let crossOrigin = site === 'cross-site' || site === 'same-site';
    const origin = req.headers.origin;
    if (!crossOrigin && origin && origin !== 'null') {
      try { crossOrigin = new URL(origin).host.toLowerCase() !== String(req.headers.host || '').toLowerCase(); } catch { crossOrigin = true; }
    }
    if (origin === 'null' && site !== 'same-origin') crossOrigin = true;
    if (crossOrigin) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: '403', message: 'Requests from other sites are not accepted' } }));
      return true;
    }
  }
  return false;
}

// The user of the studio's logon, signed, for the classic engine of each app (a process of its own on its own port,
// which cannot see the studio's sessions): rap_csig = USER.hmac. The key is a random secret next to the users file,
// readable by its owner only.
const SECRET_FILE = '.rap-secret';
export function secretFor(dir) {
  const f = path.join(dir, SECRET_FILE);
  try { const s = fs.readFileSync(f, 'utf8').trim(); if (s.length >= 32) return s; } catch { /* created below */ }
  const s = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f, s + '\n', { mode: 0o600 });
  return s;
}
const mac = (dir, user) => crypto.createHmac('sha256', secretFor(dir)).update(`classic:${user}`).digest('hex');
export const signUser = (dir, user) => `${norm(user)}.${mac(dir, norm(user))}`;
export function verifyUser(dir, value) {
  const m = /^([A-Z0-9_.@-]{1,12})\.([a-f0-9]{64})$/.exec(String(value || ''));
  if (!m) return null;
  const want = Buffer.from(mac(dir, m[1]), 'hex'), got = Buffer.from(m[2], 'hex');
  return want.length === got.length && crypto.timingSafeEqual(want, got) ? m[1] : null;
}
