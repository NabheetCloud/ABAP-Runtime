// Classic ABAP engine, debugger build step: puts a statement hook in front of every executable ABAP statement of
// the app's own code in the transpiled JavaScript, and writes the map from the app's source lines to those hooks
// (.rap/classic/debug-map.json). The host (debug.mjs) stops at a hook when a breakpoint is set on its line.
//
// A hook costs one property read while nothing is debugged:
//   if (globalThis.__rapDbg?.on) await __rapDbg.at(17, () => ({ ls_out: () => ls_out, ... }), this);
//
// Reports and module pools run as classes the converter generated from them (generated/*.clas.abap, local classes
// in helper classes, globals as attributes of the owner object), so a program line is found in the generated code
// by aligning the statements of each generated method with the program's statements. Classes, interfaces and
// function groups of the app are transpiled as they are (app/*): there a line is its own line.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as abaplint from '@abaplint/core';
import { listSources } from '../rap/model.js';

// the converter (open-abap-gui, patched) marks the code of each program statement with its source line
// (*@src zprog.prog.abap:42 ... *@src -): the build imports this module before it converts the programs
process.env.GGCONV_SOURCE_LINES ??= '1';

// statements a debugger does not stop at: declarations, block ends, branches (their condition belongs to the block),
// event and routine headers
const PASSIVE = new Set(['Comment', 'Empty', 'Unknown', 'NativeSQL', 'Report', 'Program', 'FunctionPool', 'Include', 'Tables', 'Parameter', 'SelectOption', 'SelectionScreen', 'Controls',
  'Data', 'DataBegin', 'DataEnd', 'Type', 'TypeBegin', 'TypeEnd', 'TypeEnum', 'TypeEnumBegin', 'TypeEnumEnd', 'TypeMesh', 'TypeMeshBegin', 'TypeMeshEnd', 'Constant', 'ConstantBegin', 'ConstantEnd',
  'Static', 'StaticBegin', 'StaticEnd', 'FieldSymbol', 'Ranges', 'TypePools', 'TypePool', 'Define', 'EndOfDefinition', 'Nodes',
  'ClassDefinition', 'ClassImplementation', 'ClassDefinitionLoad', 'ClassDeferred', 'EndClass', 'InterfaceDef', 'Interface', 'EndInterface', 'InterfaceDeferred', 'InterfaceLoad',
  'PublicSection', 'ProtectedSection', 'PrivateSection', 'MethodDef', 'MethodImplementation', 'EndMethod', 'ClassData', 'ClassDataBegin', 'ClassDataEnd', 'Events', 'Aliases', 'ClassFriends',
  'Public', 'Private', 'Protected', 'Form', 'EndForm', 'FormDefinition', 'FunctionModule', 'EndFunction', 'Module', 'EndModule',
  'Else', 'ElseIf', 'When', 'WhenOthers', 'WhenType', 'EndIf', 'EndLoop', 'EndDo', 'EndWhile', 'EndCase', 'EndTry', 'Catch', 'Cleanup', 'EndSelect', 'EndAt', 'EndProvide', 'EndOn', 'EndEnhancementSection', 'EndExec',
  'StartOfSelection', 'EndOfSelection', 'Initialization', 'AtSelectionScreen', 'AtLineSelection', 'AtUserCommand', 'AtPF', 'TopOfPage', 'EndOfPage', 'LoadOfProgram', 'Get', 'EndOfPage']);
// statements every method has (they carry little weight when statements are aligned)
const TRIVIAL = new Set(['EndIf', 'EndLoop', 'EndDo', 'EndWhile', 'EndCase', 'EndTry', 'Else', 'EndMethod', 'EndForm', 'Return', 'Continue', 'Exit', 'EndSelect', 'EndAt']);
const EVENTS = { StartOfSelection: 'START-OF-SELECTION', EndOfSelection: 'END-OF-SELECTION', Initialization: 'INITIALIZATION', AtSelectionScreen: 'AT SELECTION-SCREEN',
  AtLineSelection: 'AT LINE-SELECTION', AtUserCommand: 'AT USER-COMMAND', AtPF: 'AT PF', TopOfPage: 'TOP-OF-PAGE', EndOfPage: 'END-OF-PAGE', LoadOfProgram: 'LOAD-OF-PROGRAM' };

// the statements of an ABAP source with the block (method, form, event, module, function) each belongs to
export function statementsOf(name, source) {
  let file;
  try { file = new abaplint.Registry().addFile(new abaplint.MemoryFile(name, source)).parse().getFirstObject()?.getABAPFiles()?.[0]; } catch { return []; }
  if (!file) return [];
  const out = [];
  let cls = '', block = '';
  for (const s of file.getStatements()) {
    const type = s.get().constructor.name;
    if (type === 'Comment' || type === 'Empty') continue;
    const text = s.concatTokens();
    const word = n => (text.split(/\s+/)[n] || '').replace(/\.$/, '').toUpperCase();
    if (type === 'ClassImplementation') cls = word(1);
    else if (type === 'EndClass') cls = '';
    else if (type === 'MethodImplementation') block = cls ? `${cls}->${word(1)}` : `METHOD ${word(1)}`;
    else if (type === 'Form') block = `FORM ${word(1)}`;
    else if (type === 'FunctionModule') block = `FUNCTION ${word(1)}`;
    else if (type === 'Module') block = `MODULE ${word(1)}`;
    else if (EVENTS[type]) block = EVENTS[type];
    out.push({ type, row: s.getStart().getRow(), end: s.getEnd().getRow(), text, block, exec: !PASSIVE.has(type), words: words(text) });
  }
  return out;
}

// the words of a statement for comparing program statements with the converter's: without the qualifiers the
// converter adds (zcl_..._h1=>, io_owner->, me->), the owner and session parameters it passes, the mv_ prefix of
// program globals and its interface prefix of event methods
function words(text) {
  const t = String(text).toUpperCase()
    .replace(/\b(IO_OWNER|IO_SESSION)\s*=\s*[\w>-]+/g, ' ')
    .replace(/[\w$~]+(=>|->)/g, ' ')
    .replace(/\bZIF_GG_\w+~/g, ' ');
  return t.split(/[^A-Z0-9#]+/).filter(w => w && !/^(MV|MS|MT|MO|ZIF|GG|V1|IO|OWNER|SESSION)$/.test(w));
}

function similarity(a, b) {
  if (!a.words.length && !b.words.length) return a.type === b.type ? 1 : 0;
  const m = new Map();
  for (const w of a.words) m.set(w, (m.get(w) || 0) + 1);
  let common = 0;
  for (const w of b.words) { const n = m.get(w); if (n) { common++; m.set(w, n - 1); } }
  return (2 * common) / (a.words.length + b.words.length);
}

// best local alignment (Smith-Waterman) of the statements of one generated method with a program's statements:
// pairs [generated index, program index] of statements that correspond
export function align(gen, orig) {
  const n = gen.length, m = orig.length;
  if (!n || !m) return { score: 0, pairs: [] };
  const GAP = -0.35;
  const H = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
  const sims = Array.from({ length: n + 1 }, () => null);
  let best = 0, bi = 0, bj = 0;
  for (let i = 1; i <= n; i++) {
    const g = gen[i - 1], row = new Float32Array(m + 1);
    for (let j = 1; j <= m; j++) {
      const o = orig[j - 1];
      const sim = similarity(g, o);
      row[j] = sim;
      const match = sim >= 0.6 ? sim * (TRIVIAL.has(g.type) ? 0.2 : 1) : -0.6;
      const v = Math.max(0, H[i - 1][j - 1] + match, H[i - 1][j] + GAP, H[i][j - 1] + GAP);
      H[i][j] = v;
      if (v > best) { best = v; bi = i; bj = j; }
    }
    sims[i] = row;
  }
  const pairs = [];
  let i = bi, j = bj;
  while (i > 0 && j > 0 && H[i][j] > 0) {
    const sim = sims[i][j];
    const match = sim >= 0.6 ? sim * (TRIVIAL.has(gen[i - 1].type) ? 0.2 : 1) : -0.6;
    if (Math.abs(H[i][j] - (H[i - 1][j - 1] + match)) < 1e-4) { if (sim >= 0.6) pairs.push([i - 1, j - 1]); i--; j--; }
    else if (Math.abs(H[i][j] - (H[i - 1][j] + GAP)) < 1e-4) i--;
    else j--;
  }
  return { score: best, pairs: pairs.reverse() };
}

// the methods of a generated class: their statement lists
export function methodsOf(stmts) {
  const out = [];
  let cur = null;
  for (const s of stmts) {
    if (s.type === 'MethodImplementation') { cur = [s]; out.push(cur); continue; }
    if (cur) cur.push(s);
    if (s.type === 'EndMethod') cur = null;
  }
  return out;
}

// source maps (v3): for each JavaScript line the ABAP line of its first segment and that segment's column
const B64 = Object.fromEntries([...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'].map((c, i) => [c, i]));
function decodeVlq(s) {
  const out = [];
  let v = 0, shift = 0;
  for (const c of s) {
    const d = B64[c];
    v += (d & 31) << shift;
    if (d & 32) { shift += 5; continue; }
    out.push(v & 1 ? -(v >> 1) : v >> 1);
    v = 0; shift = 0;
  }
  return out;
}
export function firstSegments(mappings) {
  const lines = [];
  let src = 0, srcLine = 0, srcCol = 0;
  for (const line of mappings.split(';')) {
    let col = 0, first = null;
    for (const seg of line.split(',')) {
      if (!seg) continue;
      const v = decodeVlq(seg);
      col += v[0];
      if (v.length >= 4) { src += v[1]; srcLine += v[2]; srcCol += v[3]; if (!first) first = { col, src, line: srcLine + 1 }; }
    }
    lines.push(first);
  }
  return lines;
}

const HOOK = /^\s*if \(globalThis\.__rapDbg\?\.on\) await __rapDbg\.at\(.*\n/gm;
const MARK = '// rap-debug\n';
const strip = js => js.startsWith(MARK) ? js.slice(MARK.length).replace(HOOK, '') : js;
const CONTINUES = /^(\}|\)|\]|\.|,|:|\?|else\b|case\b|catch\b|finally\b|default\b)/;
const METHOD_START = /^\s{0,2}(static\s+)?async\s+(function\s+)?#?[\w$]+\s*\(/;
const shown = n => /^fs_(.+)_$/.test(n) ? `<${n.slice(3, -1)}>` : n;

// puts the hooks into one transpiled file: at = { 'source.abap:row' -> hook id }; returns the new text, or null when
// the file has no place for a hook
function instrument(js, map, at, allow, stmtsOf = () => []) {
  const lines = js.split('\n');
  const sources = (map.sources || []).map(s => path.basename(s).toLowerCase());
  const first = firstSegments(map.mappings || '').map(x => x && { ...x, key: `${sources[x.src]}:${x.line}` });
  const unmapped = catchBodyKeys(lines, first, sources, stmtsOf);
  const seen = new Set();
  const out = [];
  let vars = [];
  const jsLines = {}, starts = [];
  let parens = 0;    // open ( and [ at the end of the line: inside an expression written over several lines
  let stmt = null;   // the JavaScript statement being read: where it starts in out, whether it has its hook
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (METHOD_START.test(l)) { vars = []; starts.push(out.length + 2); parens = 0; stmt = null; }
    const seg = first[i];
    const indent = l.length - l.trimStart().length;
    const key = seg ? seg.key : unmapped[i];
    const id = key ? at[key] : undefined;
    // only where a JavaScript statement starts: a statement the transpiler wrote over several lines (a structure
    // built inline) can have an ABAP line mapped to one of its inner lines
    const prev = out.length ? out[out.length - 1].trim() : '{';
    const atStart = parens === 0 && (prev === '' || /[;{}]$/.test(prev) || prev.startsWith('//'));
    const opens = atStart && !CONTINUES.test(l.trim());
    if (opens) stmt = { at: out.length, indent, hooked: false };
    if (id !== undefined && !seen.has(id) && (opens || (stmt && !stmt.hooked))) {
      // on an inner line: the hook goes in front of the statement that line belongs to
      seen.add(id);
      const scope = [...new Set(vars)].filter(v => !allow || allow.has(v.replace(/^fs_(.+)_$/, '$1').toLowerCase())).map(v => `${JSON.stringify(shown(v))}: () => ${v}`).join(', ');
      const pos = opens ? out.length : stmt.at;
      jsLines[id] = pos + 2;   // 1-based, after the marker line
      out.splice(pos, 0, `${' '.repeat(opens ? indent : stmt.indent)}if (globalThis.__rapDbg?.on) await __rapDbg.at(${id}, () => ({${scope}}), this);`);
      stmt.hooked = true;
    }
    out.push(l);
    { const c = l.replace(/\\./g, '').replace(/'[^']*'|"[^"]*"|`[^`]*`/g, ''); parens = Math.max(0, parens + (c.match(/[([]/g) || []).length - (c.match(/[)\]]/g) || []).length); }
    const d = /^\s*let ([\w$]+)\s*=/.exec(l);
    if (d && !/^unique\d+$/.test(d[1]) && d[1] !== 'INPUT') vars.push(d[1]);
  }
  if (!seen.size) return null;
  return { text: MARK + out.join('\n'), jsLines, starts };
}

// The transpiler writes the code of a CATCH block without source map segments: its statements are found by their
// order. The k-th exception handler of a source (if ((X && e instanceof X)) {) is its k-th CATCH; when the handler's
// statement lines and the CATCH block's statements pair up one to one, each line gets its statement, else the first
// line gets the block's first statement. Returns js line index -> 'source:row'.
const HANDLER = /^(\} else )?if \(\(.* && e instanceof .*\)\) \{$/;
const CLOSERS = new Set(['EndIf', 'EndLoop', 'EndDo', 'EndWhile', 'EndCase', 'EndTry', 'EndSelect', 'EndAt', 'Else', 'ElseIf', 'When', 'WhenOthers', 'WhenType', 'Catch', 'Cleanup']);
export function catchBodies(stmts) {
  const out = [], open = [];
  let depth = 0;
  for (const s of stmts) {
    if (s.type === 'EndTry') { for (const b of open.filter(b => b.depth === depth)) b.done = true; depth--; }
    for (const b of open) if (!b.done && b.depth < depth + (s.type === 'Catch' || s.type === 'Cleanup' ? 0 : 1)) b.stmts.push(s);
    if (s.type === 'Catch' || s.type === 'Cleanup') {
      for (const b of open.filter(b => b.depth === depth)) b.done = true;
      if (s.type === 'Catch') { const b = { depth, stmts: [], done: false }; open.push(b); out.push(b); }
    }
    if (s.type === 'Try') depth++;
  }
  return out.map(b => b.stmts);
}
function catchBodyKeys(lines, first, sources, stmtsOf) {
  const keys = [], count = {}, cache = {};
  let src = null;
  const braces = t => { const c = t.replace(/\\./g, '').replace(/'[^']*'|"[^"]*"|`[^`]*`/g, ''); return (c.match(/\{/g) || []).length - (c.match(/\}/g) || []).length; };
  for (let i = 0; i < lines.length; i++) {
    if (first[i]) src = sources[first[i].src];
    const t = lines[i].trim();
    if (!src || !HANDLER.test(t)) continue;
    const bodies = cache[src] ||= catchBodies(stmtsOf(src) || []);
    const body = bodies[count[src] = (count[src] ?? -1) + 1];
    if (!body?.length) continue;
    let j = i + 1;
    if (/^[\w$.#]+(\.get\(\))?\.set\(e\);$/.test(lines[j]?.trim() || '')) j++;
    const jsStmts = [];
    for (let depth = 1; j < lines.length; j++) {
      const u = lines[j].trim();
      if (u.startsWith('}') && depth <= 1) break;
      if (u && !first[j] && !CONTINUES.test(u)) jsStmts.push(j);
      depth += braces(u);
    }
    const abap = body.filter(x => !CLOSERS.has(x.type));
    const pair = (j, x) => { if (x.exec && keys[j] === undefined) keys[j] = `${src}:${x.row}`; };
    if (jsStmts.length === abap.length) jsStmts.forEach((j, k) => pair(j, abap[k]));
    else if (jsStmts.length && abap.length) pair(jsStmts[0], abap[0]);
  }
  return keys;
}

// builds the map and instruments the output; returns { hooks, files, diagnostics }
export function instrumentClassic(appDir, work) {
  const output = path.join(work, 'output', 'project');
  const app = path.join(work, 'app'), generated = path.join(work, 'generated');
  const diagnostics = [];
  if (!fs.existsSync(output)) return { hooks: 0, diagnostics };
  // the app's sources by their staged name (staging lowercases the file names)
  const rel = new Map(listSources(appDir).map(f => [path.basename(f).toLowerCase(), path.relative(appDir, f).split(path.sep).join('/')]));
  const hooks = [];   // id -> { file, line, block }
  const targets = new Map(); // js file -> { 'source.abap:row' -> id }
  const target = js => targets.get(js) || targets.set(js, {}).get(js);
  const allowed = new Map();  // js file of a generated class -> the names of the programs (the converter's own variables are not shown)
  const add = (file, line, block) => { hooks.push({ file, line, block }); return hooks.length - 1; };
  const stmtsByName = new Map();   // staged / generated source -> its statements (CATCH blocks, see catchBodyKeys)

  // 1. classes, interfaces, function groups (and programs the converter did not take) of the app: line for line
  const programs = [];
  // programs the converter took run as their generated class (step 2), not as the transpiled program
  const converted = new Set((fs.existsSync(generated) ? fs.readdirSync(generated) : []).filter(f => /\.clas\.abap$/.test(f))
    .map(f => /^\* Source file: (?:.*[\\/])?([^\\/\s]+)\s*$/m.exec(fs.readFileSync(path.join(generated, f), 'utf8'))?.[1]?.toLowerCase()).filter(Boolean));
  for (const f of fs.existsSync(app) ? fs.readdirSync(app) : []) {
    if (!/\.abap$/.test(f) || !rel.has(f)) continue;
    const source = fs.readFileSync(path.join(app, f), 'utf8');
    const stmts = statementsOf(f, source);
    stmtsByName.set(f, stmts);
    if (/\.prog\.abap$/.test(f)) programs.push({ file: rel.get(f), stmts, rows: new Map(stmts.map(x => [x.row, x])) });
    const js = !converted.has(f) && jsFor(output, f);
    if (!js) continue;
    const at = target(js);
    for (const s of stmts) if (s.exec && at[`${f}:${s.row}`] === undefined) cover(at, f, s, add(rel.get(f), s.row, s.block));
  }
  // 2. the classes generated from reports and module pools: by the converter's source line marks, else aligned
  // with the program statements
  const byName = new Map(programs.map(p => [path.basename(p.file).toLowerCase(), p]));
  for (const f of fs.existsSync(generated) ? fs.readdirSync(generated) : []) {
    if (!/\.clas\.abap$/.test(f)) continue;
    const js = jsFor(output, f);
    if (!js || !programs.length) continue;
    const text = fs.readFileSync(path.join(generated, f), 'utf8');
    const stmts = statementsOf(f, text);
    stmtsByName.set(f, stmts);
    const at = target(js);
    allowed.set(js, new Set(programs.flatMap(p => p.stmts.flatMap(x => x.text.toLowerCase().match(/[\w$]+/g) || [])).concat(['me', 'io_owner'])));
    const marks = sourceMarks(text);
    if (marks) {
      // one hook per program statement: the first generated statement of its code (WRITE a, b -> two calls)
      let prev = null;
      for (const g of stmts) {
        if (!g.exec) continue;
        const m = marks[g.row];
        const p = m && byName.get(m.file);
        const o = p && p.rows.get(m.line);
        const key = o ? `${p.file}:${o.row}` : null;
        if (o && o.exec && key !== prev && at[`${f}:${g.row}`] === undefined) cover(at, f, g, add(p.file, o.row, o.block));
        prev = key;
      }
      continue;
    }
    for (const method of methodsOf(stmts)) {
      let best = null;
      for (const p of programs) { const r = align(method, p.stmts); if (!best || r.score > best.score) best = { ...r, p }; }
      if (!best || best.score < 0.9) continue;
      for (const [gi, oi] of best.pairs) {
        const g = method[gi], o = best.p.stmts[oi];
        if (g.exec && o.exec && at[`${f}:${g.row}`] === undefined) cover(at, f, g, add(best.p.file, o.row, o.block));
      }
    }
  }
  // 3. the hooks into the JavaScript (each file checked: a file that would not load stays without hooks)
  const files = {}, methods = {};   // js file -> hook id -> js line; js file -> the first lines of its methods
  for (const [js, at] of targets) {
    const mapFile = `${js}.map`;
    if (!fs.existsSync(mapFile)) continue;
    const plain = strip(fs.readFileSync(js, 'utf8'));
    let map;
    try { map = JSON.parse(fs.readFileSync(mapFile, 'utf8')); } catch { continue; }
    const r = Object.keys(at).length ? instrument(plain, map, at, allowed.get(js), n => stmtsByName.get(n)) : null;
    if (!r) { fs.writeFileSync(js, plain); continue; }
    fs.writeFileSync(js, r.text);
    const check = spawnSync(process.execPath, ['--check', js], { encoding: 'utf8' });
    if (check.status !== 0) {
      fs.writeFileSync(js, plain);
      diagnostics.push({ file: path.basename(js), line: null, message: `debugger: no breakpoints in ${path.basename(js)} (${(check.stderr || '').split('\n').find(l => /Error/.test(l)) || 'syntax check failed'})`, severity: 'warning' });
      continue;
    }
    files[path.basename(js)] = r.jsLines;
    methods[path.basename(js)] = r.starts;
  }
  // only hooks that made it into the code count
  const live = new Set(Object.values(files).flatMap(x => Object.keys(x).map(Number)));
  const lines = {};
  hooks.forEach((h, id) => { if (live.has(id)) ((lines[h.file] ||= {})[h.line] ||= []).push(id); });
  // the statements of the app's sources (row, last row, block): a breakpoint binds to a statement of its own block
  const stmts = {};
  for (const [f, list] of stmtsByName) if (rel.has(f)) stmts[rel.get(f)] = list.map(x => [x.row, x.end, x.block]);
  fs.writeFileSync(path.join(work, 'debug-map.json'), JSON.stringify({ hooks, lines, files, methods, stmts }));
  return { hooks: live.size, diagnostics };
}

// the converter's marks in a generated class: row -> { file, line } of the program statement the row's code is
// from; null when the class has none
function sourceMarks(text) {
  const rows = [];
  let cur = null, any = false;
  text.split('\n').forEach((l, i) => {
    const m = /^\*@src (\S+):(\d+)\s*$/.exec(l);
    if (m) { cur = { file: m[1].toLowerCase(), line: Number(m[2]) }; any = true; return; }
    if (/^\*@src -/.test(l)) { cur = null; return; }
    if (cur) rows[i + 1] = cur;
  });
  return any ? rows : null;
}

// a statement's hook belongs to every line of the statement (the transpiler maps a call to its last line)
function cover(at, f, s, id) { for (let r = s.row; r <= s.end; r++) at[`${f}:${r}`] ??= id; }

// the transpiled file of a staged or generated source (zcl_x.clas.abap -> zcl_x.clas.mjs, z.fugr.zfm.abap -> z.fugr.mjs)
function jsFor(output, f) {
  const parts = f.split('.');
  const name = parts[1] === 'fugr' || parts[1] === 'clas' || parts[1] === 'prog' || parts[1] === 'intf' ? `${parts[0]}.${parts[1]}.mjs` : null;
  const p = name && path.join(output, name);
  return p && fs.existsSync(p) ? p : null;
}
