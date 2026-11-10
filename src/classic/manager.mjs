// Classic ABAP engine of one app: builds it (build.mjs) when its classic sources change, runs the host process
// (host.mjs) on a free port, and stops it with the workspace.
import { USERS_FILE } from '../server/auth.js';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildClassic, classicAvailable, hasClassicSources } from './build.mjs';
import { listSources } from '../rap/model.js';

const HOST = path.join(path.dirname(fileURLToPath(import.meta.url)), 'host.mjs');
const OWN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'abap');
const RELEVANT = /\.(prog|fugr|dtel|doma|ttyp|tabl|shlp|msag|intf|clas|xslt|enqu|tran|form)\./i;

export class ClassicEngine {
  constructor(appDir, { dbFile, user, systemDir } = {}) {
    this.dir = path.resolve(appDir);
    this.systemDir = systemDir;
    this.dbFile = dbFile || path.join(this.dir, '.rap', 'data.db');
    this.user = user;
    this.state = 'idle';
    this.diagnostics = [];
    this.programs = [];
    this.port = null;
    this.proc = null;
    this.stamp = null;
    this.pending = null;
  }
  // a fingerprint of the sources the classic engine compiles
  fingerprint() {
    const own = fs.readdirSync(OWN).map(f => path.join(OWN, f));      // RAP Studio's own ABAP layer counts too,
    const engine = fs.readdirSync(path.dirname(HOST)).filter(f => /\.(mjs|css|js)$/.test(f)).map(f => path.join(path.dirname(HOST), f));   // and the engine's code
    return [...listSources(this.dir).filter(f => RELEVANT.test(path.basename(f))), ...own, ...engine].map(f => `${f}:${fs.statSync(f).mtimeMs}`).join('|');
  }
  status() {
    return { available: classicAvailable(), programs: hasClassicSources(this.dir), state: this.state, port: this.port, url: this.port ? `http://localhost:${this.port}/` : null, diagnostics: this.diagnostics, list: this.programs };
  }
  // build if needed and make sure the host runs; concurrent callers share one run
  ensure() {
    if (this.pending) return this.pending;
    this.pending = this.run().finally(() => { this.pending = null; });
    return this.pending;
  }
  async run() {
    if (!classicAvailable()) { this.state = 'unavailable'; return this.status(); }
    const stamp = this.fingerprint();
    if (this.proc && stamp === this.stamp) return this.status();
    this.state = 'building';
    const r = await buildClassic(this.dir, { systemDir: this.systemDir });
    this.diagnostics = r.diagnostics;
    this.programs = r.programs;
    // errors and debugger warnings in the server's console too, not only in Problems
    for (const d of r.diagnostics) if (d.severity === 'error' || /^debugger/.test(d.message)) console.warn(`[classic] ${d.severity === 'error' ? 'ERROR' : 'warning'} ${d.file || ''}${d.line ? `:${d.line}` : ''} ${d.message}`);
    try { this.onBuilt?.(r); } catch {}
    if (!r.ok) { this.state = 'error'; this.stop(); return this.status(); }
    this.stamp = stamp;
    this.stop();
    await this.start();
    return this.status();
  }
  start() {
    return new Promise((resolve) => {
      // the port of the previous host again (bookmarks and an open engine tab keep working after a rebuild)
      const proc = spawn(process.execPath, [HOST, path.join(this.dir, '.rap', 'classic'), String(this.lastPort || 0)], {
        env: { ...process.env, RAP_CLASSIC_DB: this.dbFile, RAP_CLASSIC_USER: this.user || 'DEVELOPER', RAP_CLASSIC_USERS: path.join(this.systemDir || this.dir, USERS_FILE) }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      this.proc = proc;
      let out = '';
      const done = () => { clearTimeout(t); resolve(); };
      const t = setTimeout(() => { if (this.state !== 'running') { this.state = 'error'; this.diagnostics.push({ file: '', line: null, message: `classic engine did not start: ${out.slice(-400)}`, severity: 'error' }); } done(); }, 30000);
      proc.stdout.on('data', d => {
        out += d;
        const m = /ready on (\d+)/.exec(out);
        if (m && this.state !== 'running') { this.port = this.lastPort = Number(m[1]); this.state = 'running'; done(); }
      });
      proc.stderr.on('data', d => { out += d; if (process.env.RAP_DEBUG) process.stderr.write(d); });
      proc.on('exit', code => {
        if (this.proc !== proc) return;
        this.proc = null; this.port = null;
        if (this.state === 'running' || this.state === 'building') { this.state = code ? 'error' : 'idle'; if (code) this.diagnostics.push({ file: '', line: null, message: `classic engine stopped: ${out.slice(-400)}`, severity: 'error' }); }
        done();
      });
    });
  }
  stop() {
    if (!this.proc) return;
    const p = this.proc;
    this.proc = null; this.port = null;
    try { p.kill('SIGTERM'); } catch {}
  }
}
