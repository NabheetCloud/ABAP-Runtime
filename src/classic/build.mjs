// Classic ABAP engine, build step: an app's reports, module pools, function groups, DDIC objects and plain
// classes are compiled with open-abap's engine (abaplint transpiler + open-abap-core + the report/dynpro
// framework of open-abap-gui), next to the RAP runtime that keeps running the behavior pools.
//   .rap/classic/app        staged sources (CDS tables as DDIC XML, message classes as MSAG XML)
//   .rap/classic/generated  reports and module pools converted to classes
//   .rap/classic/output     transpiled JavaScript
//   .rap/classic/externals.json  other apps' tables the programs use (read from the owner's database)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listSources } from '../rap/model.js';
import { parseCds } from '../ddl/cds.js';
import { tablXml, msagXml, ddicKinds } from '../studio/abapgit.js';
import { expandIncludes, readDdic, builtinOf } from '../rap/ddic.js';
import { hasInit, initFunctionSource, initFunctionName } from '../forms/interface.js';
import { systemDirOf, systemCatalog } from '../rap/catalog.js';
import { parseFunction, fugrXml, topInclude, mainProgram } from './fugr.mjs';
import { instrumentClassic } from './debugmap.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const VENDOR = path.join(ROOT, 'vendor', 'open-abap');
const GUI = path.join(VENDOR, 'open-abap-gui');
// open-abap-jobs only holds stubs: RAP Studio's own ABAP (src/classic/abap: job function modules, application log
// tables) takes its place, implemented by the host (jobs.mjs, logs)
const LIBS = ['open-abap-core', 'express-icf-shim', 'open-abap-bal', 'open-abap-pdf', 'open-abap-lock', 'open-abap-xco'];
const OWN = path.join(ROOT, 'src', 'classic', 'abap');

// the transpiler leaves namespaced parameter names (/1BCDWB/FORMOUTPUT of a form's function module) unescaped in the
// importing / changing / tables lists of CALL FUNCTION: give them the escaped name the exporting list uses ($1bcdwb$x)
function fixNamespacedParams(dir) {
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith('.mjs')) fix(f); } };
  const fix = f => {
    const t = fs.readFileSync(f, 'utf8');
    if (!t.includes('FunctionModules')) return;
    const u = t.replace(/((?:importing|changing|tables): \{[^}]*)/g, m => m.replace(/([{,]\s*)\/(\w+)\/(\w+)\s*:/g, '$1$$$2$$$3:'));
    if (u !== t) fs.writeFileSync(f, u);
  };
  if (fs.existsSync(dir)) walk(dir);
}

export function classicAvailable() { return fs.existsSync(path.join(GUI, 'converter', 'build', 'src', 'api.js')); }

// objects of the app that belong to the classic engine
const CLASSIC = /\.(prog\.(abap|xml|screen_\d+\.abap)|fugr\.[^/]+|dtel\.xml|doma\.xml|ttyp\.xml|tabl\.xml|shlp\.xml|enqu\.xml|view\.xml|tran\.xml|intf\.(abap|xml)|clas\.(abap|xml|locals_imp\.abap|locals_def\.abap|testclasses\.abap|macros\.abap)|xslt\.(source\.xml|xml))$/i;
export function hasClassicSources(dir) { return listSources(dir).some(f => /\.(prog\.abap|fugr\.|form\.json)/i.test(path.basename(f))); }

const clientless = (def, kinds) => tablXml({ ...def, fields: def.fields.filter(x => x.type?.name !== 'abap.clnt') }, { kinds });

function stage(appDir, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const skipPools = new Set();
  for (const f of listSources(appDir)) {
    const b = path.basename(f).toLowerCase();
    // behavior pools and RAP event handlers stay with the RAP runtime (EML, FOR BEHAVIOR OF)
    if (/\.clas\.abap$/.test(b) && /FOR\s+(BEHAVIOR|EVENTS)\s+OF/i.test(fs.readFileSync(f, 'utf8'))) skipPools.add(b.split('.')[0]);
  }
  // classes and interfaces the classic objects use (directly or through other classes): only those are built for the
  // engine; an ABAP Cloud console class next to a print form (cl_fp_form_reader & co. run on the RAP runtime) is not
  {
    const files = listSources(appDir);
    const objName = f => path.basename(f).toLowerCase().split('.')[0];
    const oo = new Map();
    for (const f of files) if (/\.(clas|intf)\.[^/]*abap$/i.test(path.basename(f)) && !skipPools.has(objName(f))) (oo.get(objName(f)) || oo.set(objName(f), []).get(objName(f))).push(f);
    let text = files.filter(f => /\.(prog\.(abap|screen_\d+\.abap)|fugr\.[^/]+\.abap|sfpi\.json)$/i.test(path.basename(f))).map(f => fs.readFileSync(f, 'utf8')).join('\n').toLowerCase();
    const used = new Set();
    for (let grew = true; grew;) {
      grew = false;
      for (const [n, fs_] of oo) {
        if (used.has(n) || !new RegExp(`(^|[^\\w/])${n.replace(/[/$]/g, '\\$&')}($|[^\\w/])`).test(text)) continue;
        used.add(n); grew = true;
        text += '\n' + fs_.map(f => fs.readFileSync(f, 'utf8')).join('\n').toLowerCase();
      }
    }
    for (const n of oo.keys()) if (!used.has(n)) skipPools.add(n);
  }
  const staged = [];
  // tables and structures (CDS sources): include structures are written out (the engine gets flat components)
  const ddicDefs = new Map();
  for (const f of listSources(appDir)) {
    if (!/\.tabl\.cds$/i.test(f)) continue;
    try { for (const def of parseCds(fs.readFileSync(f, 'utf8'), path.basename(f))) if (def.kind === 'table' || def.kind === 'structure') ddicDefs.set(def.name, def); } catch { /* reported by the activation */ }
  }
  const kinds = ddicKinds(appDir);
  const ddicTypes = readDdic(listSources(appDir));
  for (const f of listSources(appDir)) {
    const b = path.basename(f).toLowerCase();
    if (skipPools.has(b.split('.')[0])) continue;
    // selection texts with a dictionary reference (TPOOL "D       ."): left out, the converter takes the data
    // element's label then; screen fields get the format of their type (a date is a date, not CHAR)
    if (/\.prog\.xml$/.test(b)) {
      const progSrc = path.join(path.dirname(f), b.replace(/\.xml$/, '.abap'));
      let xml = fs.readFileSync(f, 'utf8').replace(/[ \t]*<item>\s*<ID>S<\/ID>\s*<KEY>[^<]*<\/KEY>\s*<ENTRY>D\s*\.?<\/ENTRY>[\s\S]*?<\/item>[ \t]*\n?/g, '');
      if (fs.existsSync(progSrc)) xml = screenFormats(xml, fs.readFileSync(progSrc, 'utf8'), ddicDefs, ddicTypes);
      fs.writeFileSync(path.join(dir, b), xml); staged.push(b); continue;
    }
    if (CLASSIC.test(b)) { fs.copyFileSync(f, path.join(dir, b)); staged.push(b); continue; }
    // CDS "define table" sources become DDIC table XML (without the client field, like the shared database)
    if (/\.tabl\.cds$/.test(b)) {
      let defs = [];
      try { defs = parseCds(fs.readFileSync(f, 'utf8'), b); } catch { continue; }
      for (const def of defs) {
        // a draft table's "%admin" : include sych_bdl_draft_admin_inc stays with RAP
        if ((def.kind !== 'table' && def.kind !== 'structure') || def.fields.some(x => /^%/.test(String(x.name)) || /^include\b/i.test(String(x.type?.name ?? x.type ?? '')))) continue;
        let missing = false;
        const fields = expandIncludes(def, n => ddicDefs.get(n) || null, () => { missing = true; });
        if (missing) continue;
        fs.writeFileSync(path.join(dir, `${def.name}.tabl.xml`), clientless({ ...def, fields }, kinds));
        staged.push(`${def.name}.tabl.xml`);
      }
    }
    if (/\.msag\.json$/.test(b)) { const n = b.split('.')[0]; fs.writeFileSync(path.join(dir, `${n}.msag.xml`), msagXml(n, JSON.parse(fs.readFileSync(f, 'utf8')))); staged.push(`${n}.msag.xml`); }
  }
  // form interfaces with global data / initialization code: a function module per interface (ZFPIF_<interface>)
  const ddic = readDdic(listSources(appDir));
  const shape = (type, table) => {
    const t = String(type).toLowerCase();
    const comps = n => { const d = ddicDefs.get(n); return d ? expandIncludes(d, x => ddicDefs.get(x) || null).filter(f => f.name && f.type?.name !== 'abap.clnt').map(f => f.name) : null; };
    if (table) return { kind: 'table', fields: comps(t) || ['table_line'] };
    const tt = ddic.tableTypes.get(t);
    if (tt) return { kind: 'table', fields: comps(tt.rowtype) || ['table_line'] };
    const c = comps(t);
    return c ? { kind: 'struct', fields: c } : { kind: 'elem' };
  };
  for (const f of listSources(appDir)) {
    if (!/\.sfpi\.json$/i.test(f)) continue;
    let itf; try { itf = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    if (!hasInit(itf)) continue;
    const name = path.basename(f).split('.')[0];
    const file = `zrapfpif.fugr.${initFunctionName(name).toLowerCase()}.abap`;
    fs.writeFileSync(path.join(dir, file), initFunctionSource(name, itf, shape));
    staged.push(file);
  }
  completeFunctionGroups(dir, staged);
  return staged;
}

// A screen field takes its type from the program's data object, as on SAP (a field of a dictionary structure keeps
// its dictionary type): a date or time field drawn with FORMAT CHAR (the painter's default) becomes DATS / TIMS, so
// it shows blank when initial and the date in the user's format, not 00000000 / 20261110.
export function screenFormats(xml, source, ddicDefs, ddic) {
  const globals = new Map();
  for (const m of source.matchAll(/^\s*DATA:?\s+([\w/]+)\s+TYPE\s+([\w/=>-]+)/gim)) globals.set(m[1].toUpperCase(), m[2].toLowerCase());
  for (const m of source.matchAll(/^\s*TABLES:?\s+([\w/]+)/gim)) globals.set(m[1].toUpperCase(), m[1].toLowerCase());
  const kindOf = typeName => {
    const n = String(typeName || '').toLowerCase();
    if (['d', 'dats', 'abap.dats', 'datn', 'abap.datn', 'sy-datum', 'syst-datum', 'sydatum'].includes(n)) return 'DATS';
    if (['t', 'tims', 'abap.tims', 'timn', 'abap.timn', 'sy-uzeit', 'syst-uzeit', 'syuzeit'].includes(n)) return 'TIMS';
    const b = !n.startsWith('abap.') && builtinOf(n, ddic);
    return b ? kindOf(b.name) : null;
  };
  const fieldType = (struct, comp) => {
    const def = ddicDefs.get(struct);
    if (!def) return null;
    const fields = expandIncludes(def, x => ddicDefs.get(x) || null);
    return fields.find(x => String(x.name).toUpperCase() === comp)?.type?.name ?? null;
  };
  return xml.replace(/<RPY_DYFATC>([\s\S]*?)<\/RPY_DYFATC>/g, (all, body) => {
    if (!/<TYPE>TEMPLATE<\/TYPE>/.test(body)) return all;
    const name = /<NAME>([^<]+)<\/NAME>/.exec(body)?.[1]?.trim().toUpperCase() || '';
    const [head, ...path] = name.split('-');
    const g = globals.get(head);
    if (!g) return all;
    const type = path.length === 1 ? fieldType(g, path[0]) : path.length ? null : g;
    let out = all;
    const k = /<FORMAT>CHAR<\/FORMAT>/.test(body) && kindOf(type);
    if (k) out = out.replace('<FORMAT>CHAR</FORMAT>', `<FORMAT>${k}</FORMAT>`);
    // the field's data element (its domain's fixed values are the field's value help)
    const de = String(type || '').toLowerCase();
    if (de && !de.startsWith('abap.') && ddic?.dataElements?.has(de) && !/<ROLLNAME>/.test(body)) out = out.replace('</RPY_DYFATC>', `<ROLLNAME>${de.toUpperCase()}</ROLLNAME></RPY_DYFATC>`);
    return out;
  });
}

// function groups given only as function module sources (and maybe a TOP include) get their metadata generated
function completeFunctionGroups(dir, staged) {
  const groups = new Map();
  for (const f of staged) {
    const m = /^([\w$]+)\.fugr\.(.+)\.abap$/.exec(f);
    if (m) (groups.get(m[1]) || groups.set(m[1], []).get(m[1])).push(f);
  }
  for (const [g, files] of groups) {
    const add = (name, text) => { if (!staged.includes(name)) { fs.writeFileSync(path.join(dir, name), text); staged.push(name); } };
    if (!staged.includes(`${g}.fugr.xml`)) {
      const fns = files.map(f => parseFunction(fs.readFileSync(path.join(dir, f), 'utf8'))).filter(Boolean);
      add(`${g}.fugr.xml`, fugrXml(g, fns));
    }
    add(`${g}.fugr.l${g}top.abap`, topInclude(g));
    add(`${g}.fugr.sapl${g}.abap`, mainProgram(g));
  }
}

// tables of other apps in the system that the staged code names: their DDIC definition is staged too, and the
// host reads their rows from the owner app's database (like the RAP runtime does for shared master data)
function stageExternals(appDir, dir, staged, systemDir) {
  const cat = systemCatalog(systemDirOf(appDir, { systemDir }), appDir);
  if (!cat.size) return [];
  const local = new Set(staged.filter(f => /\.tabl\.xml$/.test(f)).map(f => f.split('.')[0]));
  const names = new Set();
  for (const f of staged) if (/\.abap$/.test(f)) for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/\b[a-z_]\w*/gi)) { const n = m[0].toLowerCase(); if (cat.has(n)) names.add(n); }
  const out = [];
  for (const n of names) {
    const x = cat.get(n);
    if (!x || x.def.kind !== 'table' || local.has(n) || x.def.fields.some(f => f.include)) continue;
    fs.writeFileSync(path.join(dir, `${n}.tabl.xml`), clientless(x.def));
    staged.push(`${n}.tabl.xml`);
    out.push({ name: n, app: x.app, db: path.join(x.appDir, '.rap', 'data.db') });
  }
  return out;
}

export async function buildClassic(appDir, { log = () => {}, systemDir } = {}) {
  if (!classicAvailable()) throw new Error('The classic ABAP engine is not installed: run npm run setup:open-abap');
  appDir = fs.realpathSync(path.resolve(appDir));
  const work = path.join(appDir, '.rap', 'classic');
  const app = path.join(work, 'app'), generated = path.join(work, 'generated');
  fs.mkdirSync(work, { recursive: true });
  // transpiled code imports @abaplint/runtime by name: resolve it from RAP Studio's packages wherever the app is
  const nm = path.join(work, 'node_modules');
  if (!fs.existsSync(nm)) fs.symlinkSync(path.join(ROOT, 'node_modules'), nm, 'dir');
  const staged = stage(appDir, app);
  // print form layouts, read by the host (forms.mjs)
  const formsDir = path.join(work, 'forms');
  fs.rmSync(formsDir, { recursive: true, force: true });
  fs.mkdirSync(formsDir, { recursive: true });
  for (const f of listSources(appDir)) if (/\.form\.json$|\.xdp$|\.sfpi\.json$/i.test(f)) fs.copyFileSync(f, path.join(formsDir, path.basename(f).toLowerCase()));
  // images of the forms (logos): PNG / JPEG files of the app's src folder
  for (const f of fs.existsSync(path.join(appDir, 'src')) ? fs.readdirSync(path.join(appDir, 'src')) : []) if (/\.(png|jpe?g)$/i.test(f)) fs.copyFileSync(path.join(appDir, 'src', f), path.join(formsDir, f));
  const externals = stageExternals(appDir, app, staged, systemDir);
  // RAP Studio's own ABAP objects, with function group metadata generated like an app's
  const ownStage = path.join(work, 'rap');
  fs.rmSync(ownStage, { recursive: true, force: true });
  fs.mkdirSync(ownStage, { recursive: true });
  const own = fs.readdirSync(OWN);
  for (const f of own) fs.copyFileSync(path.join(OWN, f), path.join(ownStage, f));
  completeFunctionGroups(ownStage, own);
  fs.writeFileSync(path.join(work, 'externals.json'), JSON.stringify(externals, null, 1));
  const excluded = new Set();
  const diagnostics = [];
  const config = {
    input_folder: ['app', 'generated', 'rap', ...[['src'], ['framework']].map(p => path.relative(work, path.join(GUI, ...p)))],
    input_filter: [], exclude_filter: [],
    output_folder: 'output',
    write_unit_tests: false, write_source_map: true, incremental_output: true, skip_duplicate_dependencies: true,   // source maps: where the debugger's hooks go
    options: { setup: { filename: pathToFileURL(path.join(ROOT, 'src', 'classic', 'setup.mjs')).href, preFunction: 'setupDatabase' }, ignoreSyntaxCheck: false, addFilenames: true, addCommonJS: true },
    libs: LIBS.map(l => ({ folder: path.relative(work, path.join(VENDOR, l)) })),
    converter: { input_folder: ['app'], output_folder: 'generated', module_pools: true },
  };
  const cfgFile = path.join(work, 'abap_transpile.json');
  const write = () => fs.writeFileSync(cfgFile, JSON.stringify(config, null, 2));
  write();

  // reports and module pools -> classes (open-abap-gui converter)
  fs.rmSync(generated, { recursive: true, force: true });
  fs.mkdirSync(generated, { recursive: true });
  const programs = [];
  if (staged.some(f => /\.prog\.abap$/.test(f))) {
    const cwd = process.cwd();
    process.chdir(work);
    try {
      // the converter marks the source lines of the programs (the debugger's breakpoints bind to them)
      process.env.GGCONV_SOURCE_LINES ??= '1';
      const { convertConfiguredPrograms } = await import(pathToFileURL(path.join(GUI, 'converter', 'build', 'src', 'batch.js')).href);
      const { discoverPrograms, loadTranspileConfig } = await import(pathToFileURL(path.join(GUI, 'converter', 'build', 'src', 'config.js')).href);
      const loaded = await loadTranspileConfig(cfgFile);
      const found = await discoverPrograms(loaded);
      const summary = await convertConfiguredPrograms({ config: loaded, programs: found });
      if (process.env.RAP_CLASSIC_TRACE) console.log(JSON.stringify(found).slice(0, 400), JSON.stringify(summary).slice(0, 800));
      for (const p of summary.programs) {
        programs.push({ name: p.programName ?? p.filename, file: p.filename, supported: p.supported, tcode: p.transactionCode || undefined });
        for (const d of p.diagnostics || []) diagnostics.push({ file: p.filename, line: d.line ?? d.location?.line ?? d.start?.line ?? null, message: `${d.code ?? ''} ${d.message ?? d.text ?? ''}`.trim(), severity: d.severity || 'error' });
        // a program the converter could not take does not run: say so (its errors are above)
        if (!p.supported && !(p.diagnostics || []).some(d => (d.severity || 'error') === 'error')) diagnostics.push({ file: p.filename, line: null, message: `${String(p.programName ?? p.filename).toUpperCase()} cannot run on the classic engine: the conversion failed`, severity: 'error' });
      }
    } finally { process.chdir(cwd); }
  }

  // transpile; an app source abaplint rejects is left out (and reported) so the rest still runs
  const cli = path.join(ROOT, 'node_modules', '@abaplint', 'transpiler-cli', 'abap_transpile');
  for (let attempt = 0; attempt < 25; attempt++) {
    const r = spawnSync(process.execPath, [cli, cfgFile], { cwd: work, encoding: 'utf8', maxBuffer: 64 << 20 });
    const out = `${r.stdout}\n${r.stderr}`;
    if (r.status === 0) {
      log(out.trim().split('\n').pop());
      writeManifest(appDir, work, app, programs, diagnostics);
      fixNamespacedParams(path.join(work, 'output'));
      // statement hooks for the debugger (they cost nothing while the debugger is off)
      try { diagnostics.push(...instrumentClassic(appDir, work).diagnostics); }
      catch (e) { diagnostics.push({ file: '', line: null, message: `debugger: ${e.message}`, severity: 'warning' }); }
      return { ok: true, work, output: path.join(work, 'output'), programs, diagnostics: located(appDir, work, diagnostics), excluded: [...excluded], externals };
    }
    const m = /Error:\s*([^\n]*?),\s*([^\s,:]+\.(?:abap|xml)):(\d+)/.exec(out) || /Error:\s*([^\n]*?)\s+([^\s,:]+\.(?:abap|xml)):(\d+)/.exec(out);
    const file = m?.[2]?.toLowerCase();
    if (file && fs.existsSync(path.join(app, file)) && !excluded.has(file)) {
      diagnostics.push({ file, line: Number(m[3]), message: `classic engine: ${m[1]}`, severity: 'error' });
      excluded.add(file);
      config.exclude_filter.push(`${file.replace(/[.]/g, '\\.')}$`);
      write();
      continue;
    }
    const gen = file && fs.existsSync(path.join(generated, file));
    return { ok: false, work, programs, diagnostics: located(appDir, work, [...diagnostics, { file: file || '', line: m ? Number(m[3]) : null, message: (m ? `${gen ? 'converted program: ' : ''}${m[1]}` : out.split('\n').find(l => /Error/.test(l)) || 'transpile failed').slice(0, 400), severity: 'error' }]), excluded: [...excluded] };
  }
  return { ok: false, work, programs, diagnostics: located(appDir, work, diagnostics), excluded: [...excluded] };
}
// every diagnostic of the build at the app's source file and line, as Problems shows it: staged names
// (app/zprog.prog.abap) become the source path (src/zprog.prog.abap); a line of a class the converter generated
// from a program (or of its JavaScript) becomes the program line its code is from (the *@src marks)
export function located(appDir, work, list) {
  const rel = new Map(listSources(appDir).map(f => [path.basename(f).toLowerCase(), path.relative(appDir, f).split(path.sep).join('/')]));
  const generated = path.join(work, 'generated');
  const genInfo = new Map();
  const info = name => {
    if (genInfo.has(name)) return genInfo.get(name);
    const f = path.join(generated, name.replace(/\.mjs$/, '.abap'));
    let r = null;
    if (fs.existsSync(f)) {
      const text = fs.readFileSync(f, 'utf8');
      const src = /^\* Source file: (?:.*[\\/])?([^\\/\s]+)\s*$/m.exec(text)?.[1]?.toLowerCase();
      const marks = [];
      let cur = null;
      text.split('\n').forEach((l, i) => { const m = /^\*@src \S+:(\d+)/.exec(l); if (m) cur = Number(m[1]); else if (/^\*@src -/.test(l)) cur = null; else marks[i + 1] = cur; });
      r = src ? { src, marks } : null;
    }
    genInfo.set(name, r);
    return r;
  };
  return list.map(sfpiDiag).map(d => {
    const b = path.basename(String(d.file || '')).toLowerCase();
    if (!b) return d;
    if (rel.has(b)) return { ...d, file: rel.get(b) };
    const g = info(b);
    if (g && rel.has(g.src)) return { ...d, file: rel.get(g.src), line: d.line ? g.marks[d.line] ?? null : null };
    return d;
  });
}

// an error in the initialization of a form interface points at its .sfpi.json (the function module is generated)
function sfpiDiag(d) {
  const m = /^zrapfpif\.fugr\.zfpif_(.+)\.abap$/i.exec(String(d.file || ''));
  return m ? { ...d, file: `src/${m[1].toLowerCase()}.sfpi.json`, line: null, message: `initialization of the form interface: ${d.message}` } : d;
}

// programs for the launcher: name, title (text pool R), type (1 report, M module pool)
function writeManifest(appDir, work, app, programs, diagnostics = []) {
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(appDir, '.rap', 'app.json'), 'utf8')); } catch {}
  const list = programs.filter(p => p.supported).map(p => {
    const xml = path.join(app, `${String(p.name).toLowerCase()}.prog.xml`);
    const x = fs.existsSync(xml) ? fs.readFileSync(xml, 'utf8') : '';
    const title = /<ID>R<\/ID>\s*<ENTRY>([^<]*)<\/ENTRY>/.exec(x)?.[1]?.trim();
    const type = /<SUBC>([^<]*)<\/SUBC>/.exec(x)?.[1] || '1';
    return { name: String(p.name).toUpperCase(), title: title || '', type, tcode: p.tcode };
  });
  // programs that did not convert: Run shows their errors instead of an empty page
  const failed = programs.filter(p => !p.supported).map(p => ({ name: String(p.name).toUpperCase(), tcode: p.tcode, file: p.file,
    errors: diagnostics.filter(d => d.severity === 'error' && path.basename(String(d.file || '')).toLowerCase() === path.basename(String(p.file || '')).toLowerCase()).map(d => ({ line: d.line, message: d.message })) }));
  fs.writeFileSync(path.join(work, 'manifest.json'), JSON.stringify({ app: path.basename(appDir), title: meta.title || path.basename(appDir), programs: list, failed }, null, 1));
}
