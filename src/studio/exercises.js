// ABAP exercises: the practice exercises of exercism's ABAP track (https://github.com/exercism/abap, MIT), done in
// the studio. Each exercise is a class to complete, its ABAP Unit tests and a reference solution; the learner's work
// lives in <apps>/.exercises/<slug>/src (the original starter files stay in the track), progress in progress.json.
// Tests run in a child process (exercise-runner.mjs) with a time limit, so an endless loop cannot block the studio.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TRACK = path.join(ROOT, 'vendor', 'exercism-abap');
// the commit of the track RAP Studio is tested with (54 practice exercises)
export const TRACK_COMMIT = 'acd06e102d5be4169a665ae3ade655bdc9309a19';
export function fetchTrack(dir = TRACK) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore', timeout: 120000 });
  git('init', '-q'); git('remote', 'add', 'origin', 'https://github.com/exercism/abap.git');
  git('fetch', '-q', '--depth', '1', 'origin', TRACK_COMMIT); git('checkout', '-q', '--detach', 'FETCH_HEAD');
}
const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'exercise-runner.mjs');
const SLUG = /^[a-z0-9-]{1,60}$/;
const LEVELS = [[2, 'Easy'], [4, 'Medium'], [99, 'Hard']];

const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const err = (status, message) => Object.assign(new Error(message), { status });

export class Exercises {
  constructor(appsDir) {
    this.dir = path.join(appsDir, '.exercises');
    this.progressFile = path.join(this.dir, 'progress.json');
  }
  // the track is fetched once (git clone), like the conformance script does
  track() {
    if (!fs.existsSync(path.join(TRACK, 'config.json'))) {
      try { fetchTrack(); }
      catch { throw err(503, 'The exercises could not be downloaded from github.com/exercism/abap. Check the internet connection and try again.'); }
    }
    return readJson(path.join(TRACK, 'config.json'), { exercises: { practice: [] } });
  }
  progress() { return readJson(this.progressFile, {}); }
  saveProgress(slug, entry) {
    const p = this.progress();
    p[slug] = { ...p[slug], ...entry, updated: new Date().toISOString() };
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.progressFile, JSON.stringify(p, null, 1));
  }
  list() {
    const p = this.progress();
    const items = this.track().exercises.practice.filter(e => e.status !== 'deprecated' && fs.existsSync(path.join(TRACK, 'exercises', 'practice', e.slug))).map(e => {
      const meta = readJson(path.join(TRACK, 'exercises', 'practice', e.slug, '.meta', 'config.json'), {});
      const level = LEVELS.find(([max]) => e.difficulty <= max)[1];
      return { slug: e.slug, name: e.name, difficulty: e.difficulty, level, blurb: meta.blurb || '', status: p[e.slug]?.status || 'new', passed: p[e.slug]?.passed ?? null, total: p[e.slug]?.total ?? null };
    });
    return { exercises: items, levels: LEVELS.map(([, l]) => l), done: items.filter(i => i.status === 'passed').length };
  }
  source(slug) {
    if (!SLUG.test(slug)) throw err(400, 'Invalid exercise');
    const d = path.join(TRACK, 'exercises', 'practice', slug);
    if (!fs.existsSync(d)) throw err(404, `Exercise ${slug} not found`);
    return { d, meta: readJson(path.join(d, '.meta', 'config.json'), { files: {} }) };
  }
  workDir(slug) { return path.join(this.dir, slug); }
  // the learner's copy: starter files on first open
  ensure(slug) {
    const { d } = this.source(slug);
    const w = path.join(this.workDir(slug), 'src');
    if (!fs.existsSync(w)) {
      fs.mkdirSync(w, { recursive: true });
      for (const f of fs.readdirSync(d)) if (/\.(abap|xml)$/.test(f) && !f.endsWith('.devc.xml')) fs.copyFileSync(path.join(d, f), path.join(w, f));
      this.saveProgress(slug, { status: 'started' });
    }
    return w;
  }
  open(slug) {
    const { d, meta } = this.source(slug);
    const w = this.ensure(slug);
    const doc = f => { try { return fs.readFileSync(path.join(d, '.docs', f), 'utf8'); } catch { return ''; } };
    const solution = meta.files?.solution || [];
    const tests = meta.files?.test || [];
    const files = [...solution.map(f => ({ name: f, role: 'solution' })), ...tests.map(f => ({ name: f, role: 'test' }))]
      .filter(f => fs.existsSync(path.join(w, f.name))).map(f => ({ ...f, text: fs.readFileSync(path.join(w, f.name), 'utf8') }));
    const e = this.list().exercises.find(x => x.slug === slug);
    return { ...e, instructions: [doc('introduction.md'), doc('instructions.md'), doc('instructions.append.md')].filter(Boolean).join('\n\n'), hints: doc('hints.md'), files,
      source: meta.source_url || null, authors: meta.authors || [] };
  }
  save(slug, name, text) {
    const { meta } = this.source(slug);
    if (!(meta.files?.solution || []).includes(name)) throw err(400, 'Only the solution file can be changed');
    fs.writeFileSync(path.join(this.ensure(slug), name), text);
  }
  reset(slug) {
    fs.rmSync(this.workDir(slug), { recursive: true, force: true });
    const p = this.progress(); delete p[slug];
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.progressFile, JSON.stringify(p, null, 1));
    return this.open(slug);
  }
  // the reference solution (the studio shows it after the tests pass, or when the learner asks for it)
  example(slug) {
    const { d, meta } = this.source(slug);
    const files = meta.files?.example || meta.files?.exemplar || [];
    return { files: files.filter(f => fs.existsSync(path.join(d, f))).map(f => ({ name: path.basename(f), text: fs.readFileSync(path.join(d, f), 'utf8') })) };
  }
  // runs the ABAP Unit tests of the exercise: { activation errors, results per test, passed/total }
  test(slug, { timeoutMs = 20000 } = {}) {
    const w = path.dirname(this.ensure(slug));
    return new Promise(resolve => {
      const child = spawn(process.execPath, [RUNNER, w], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', errText = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
      child.stdout.on('data', d => { out += d; });
      child.stderr.on('data', d => { errText += d; });
      child.on('close', () => {
        clearTimeout(timer);
        let r;
        try { r = JSON.parse(out.slice(out.lastIndexOf('@@RESULT@@') + 10)); if (!out.includes('@@RESULT@@')) throw new Error(); }
        catch { r = { errors: [{ file: '', line: null, message: child.killed ? `The tests did not finish within ${timeoutMs / 1000} seconds: is there an endless loop?` : (errText || out || 'The tests could not run').trim().slice(-600) }], results: [] }; }
        const total = r.results.length, passed = r.results.filter(t => t.status === 'passed').length;
        const ok = !r.errors.length && total > 0 && passed === total;
        const before = this.progress()[slug]?.status;
        // a solved exercise stays solved (and keeps its score) when a later attempt fails
        this.saveProgress(slug, before === 'passed' && !ok ? { lastOk: false } : { status: ok ? 'passed' : 'started', passed, total, lastOk: ok });
        resolve({ ok, passed, total, ...r });
      });
    });
  }
}
