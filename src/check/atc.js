// Code checks of an app, like the ABAP Test Cockpit: a check variant (markdown, knowledge/checks/variants) selects
// abaplint rules and RAP Studio's own checks per category with a severity; an app's checks.md can change rows.
// Findings carry the category, the severity and whether a quick fix exists; fixAtc applies the quick fixes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { listSources } from '../rap/model.js';
import { systemCatalog } from '../rap/catalog.js';
import { parseFunction, fugrXml, topInclude, mainProgram } from '../classic/fugr.mjs';
import { parseCds } from '../ddl/cds.js';
import { tablXml, ddicKinds } from '../studio/abapgit.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const KNOWLEDGE = path.join(ROOT, 'knowledge');
const STDLIB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'stdlib');
const RAP_FILES = /\.(clas\.abap|clas\.locals_imp\.abap|clas\.locals_def\.abap|clas\.testclasses\.abap|intf\.abap|ddls\.asddls|bdef\.asbdef|srvd\.srvdsrv|ddlx\.asddlxs)$/i;
const CLASSIC_FILES = /\.(prog\.abap|prog\.screen_\d+\.abap|fugr\.[^/]+\.abap)$/i;
const OWN_RULES = new Set(['released_api', 'modern_syntax', 'rap_commit']);
// rules that need the whole system (standard classes, DDIC) and are not run on classic programs
const CLASSIC_SKIP = new Set(['check_syntax', 'uncaught_exception', 'implement_methods', 'released_api', 'sy_read_restriction', 'unknown_types']);
const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };

// ---------------------------------------------------------------- check variants (markdown)
// "## Category" headings, then rows "| check | severity | settings |"
export function parseVariant(text) {
  const meta = {};
  const fm = /^---\n([\s\S]*?)\n---/.exec(text);
  if (fm) for (const l of fm[1].split('\n')) { const i = l.indexOf(':'); if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
  const rules = new Map();
  let category = 'General';
  for (const line of text.replace(/^---\n[\s\S]*?\n---/, '').split('\n')) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h) { category = h[1].trim(); continue; }
    const cells = /^\|(.+)\|\s*$/.exec(line)?.[1].split('|').map(c => c.trim());
    if (!cells || !/^[a-z0-9_]+$/i.test(cells[0]) || /^-+$/.test(cells[1] || '') || cells[0].toLowerCase() === 'check') continue;
    let settings = {};
    if (cells[2]) { try { settings = JSON.parse(cells[2]); } catch { settings = {}; } }
    rules.set(cells[0].toLowerCase(), { rule: cells[0].toLowerCase(), severity: (cells[1] || 'warning').toLowerCase(), settings, category });
  }
  return { ...meta, rules };
}
export function listVariants() {
  const dir = path.join(KNOWLEDGE, 'checks', 'variants');
  return fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => { const v = parseVariant(fs.readFileSync(path.join(dir, f), 'utf8')); return { id: f.replace(/\.md$/, ''), name: v.name, title: v.title, description: v.description, checks: v.rules.size }; });
}
export function loadVariant(appDir, id = 'default') {
  const file = path.join(KNOWLEDGE, 'checks', 'variants', `${String(id).replace(/[^a-z0-9_-]/gi, '')}.md`);
  if (!fs.existsSync(file)) throw Object.assign(new Error(`Check variant ${id} does not exist`), { status: 404 });
  const v = parseVariant(fs.readFileSync(file, 'utf8'));
  // the app's own checks.md changes or adds rows (severity "off" switches a check off)
  const own = appDir && path.join(appDir, 'checks.md');
  if (own && fs.existsSync(own)) for (const [k, r] of parseVariant(fs.readFileSync(own, 'utf8')).rules) v.rules.set(k, { ...(v.rules.get(k) || {}), ...r, category: v.rules.get(k)?.category || r.category });
  for (const [k, r] of v.rules) if (r.severity === 'off') v.rules.delete(k);
  return { id, ...v };
}

// ---------------------------------------------------------------- running the checks
let released = null;
function releasedObjects() {
  if (!released) released = JSON.parse(fs.readFileSync(path.join(KNOWLEDGE, 'sap', 'released-objects.json'), 'utf8'));
  return released;
}

function registry(files, version, ruleConf) {
  const abaplint = require('@abaplint/core');
  const config = new abaplint.Config(JSON.stringify({
    global: { files: '/**/*.*' },
    syntax: { version: abaplint.Version[version] ?? abaplint.Version.Cloud, errorNamespace: '^(Z|Y|LCL_|LHC_|LSC_|LTC_|LTH_|LIF_|TY_)' },
    rules: ruleConf,
  }));
  const reg = new abaplint.Registry(config);
  for (const [name, text] of files) reg.addFile(new abaplint.MemoryFile(name, text));
  for (const f of fs.readdirSync(STDLIB)) reg.addDependency(new abaplint.MemoryFile(f, fs.readFileSync(path.join(STDLIB, f), 'utf8')));
  reg.parse();
  return reg;
}

// the app's sources: lower-case abapGit name -> { path, text, classic }
// overrides: { relative path: text } checks unsaved editor content instead of the file
function sourcesOf(dir, overrides = {}) {
  const out = new Map();
  for (const f of listSources(dir)) {
    const b = path.basename(f).toLowerCase(), rel = path.relative(dir, f);
    if (RAP_FILES.test(b) || CLASSIC_FILES.test(b)) out.set(b, { path: f, rel, text: overrides[rel] ?? fs.readFileSync(f, 'utf8'), classic: CLASSIC_FILES.test(b) });
  }
  return out;
}

// The dictionary of the app as abaplint knows it (context only, never reported): domains, data elements, table types
// and lock objects as their DDIC XML, and tables / structures defined as CDS sources converted to DDIC XML, so a
// table type with a CDS structure as line type resolves (else e.g. "Loop, not a table type, ZPO_T_ITEMS not found")
function ddicContext(dir) {
  const out = [];
  let kinds;
  for (const f of listSources(dir)) {
    const b = path.basename(f).toLowerCase();
    let m;
    try {
      if (/\.(doma|dtel|ttyp|enqu)\.xml$/.test(b)) out.push([b, fs.readFileSync(f, 'utf8')]);
      else if ((m = /^(.+)\.tabl\.(cds|astabldt)$/.exec(b))) {
        for (const def of parseCds(fs.readFileSync(f, 'utf8'), b)) {
          if (def.kind === 'table' || def.kind === 'structure') out.push([`${def.name.toLowerCase()}.tabl.xml`, tablXml(def, { kinds: (kinds ??= ddicKinds(dir)) })]);
        }
      }
    } catch { /* an invalid source is reported by activation; the checks run without it */ }
  }
  // function groups given only as function module sources: their group XML, TOP include and main program, as the
  // classic build generates them (without them abaplint knows no function group: e.g. every SELECT * is reported)
  const files = listSources(dir).map(f => path.basename(f).toLowerCase());
  const groups = new Map();
  for (const b of files) { const m = /^([\w$#]+)\.fugr\.(.+)\.abap$/.exec(b); if (m) (groups.get(m[1]) || groups.set(m[1], []).get(m[1])).push(b); }
  for (const [g, members] of groups) {
    if (!files.includes(`${g}.fugr.xml`)) {
      const fns = members.map(b => { try { return parseFunction(fs.readFileSync(listSources(dir).find(f => path.basename(f).toLowerCase() === b), 'utf8')); } catch { return null; } }).filter(Boolean);
      out.push([`${g}.fugr.xml`, fugrXml(g, fns)]);
    }
    if (!files.includes(`${g}.fugr.l${g}top.abap`)) out.push([`${g}.fugr.l${g}top.abap`, topInclude(g)]);
    if (!files.includes(`${g}.fugr.sapl${g}.abap`)) out.push([`${g}.fugr.sapl${g}.abap`, mainProgram(g)]);
  }
  return out;
}

// file: report only the findings of this object (Check in the editor)
export function runAtc(dir, { variant = 'default', knownObjects = new Set(), overrides, file } = {}) {
  const t0 = Date.now();
  const v = typeof variant === 'object' ? variant : loadVariant(dir, variant);
  const src = sourcesOf(dir, overrides);
  const appFunctions = new Set();
  for (const f of listSources(dir)) {
    const b = path.basename(f).toLowerCase();
    let m;
    if ((m = /^[\w$#]+\.fugr\.([\w$#]+)\.abap$/.exec(b)) && !/^(sapl|l\w+top$|l\w+uxx$)/.test(m[1])) appFunctions.add(m[1].toUpperCase());
    if ((m = /^([\w$#]+)\.enqu\.xml$/.exec(b))) { appFunctions.add(`ENQUEUE_${m[1].toUpperCase()}`); appFunctions.add(`DEQUEUE_${m[1].toUpperCase()}`); }
  }
  const findings = [];
  const conf = (skip = new Set()) => Object.fromEntries([...v.rules.values()].filter(r => !OWN_RULES.has(r.rule) && !skip.has(r.rule))
    .map(r => [r.rule, Object.keys(r.settings).length ? r.settings : true]));
  let ddic;
  const run = (classic) => {
    const files = [...src].filter(([, s]) => s.classic === classic);
    if (!files.length) return;
    const reg = registry([...files.map(([n, s]) => [n, s.text]), ...(ddic ??= ddicContext(dir)).filter(([n]) => !src.has(n))], classic ? 'v758' : 'Cloud', { parser_error: true, ...conf(classic ? CLASSIC_SKIP : new Set()) });
    for (const issue of reg.findIssues()) {
      const name = issue.getFilename();
      const s = src.get(name);
      if (!s) continue;
      const key = issue.getKey();
      const r = v.rules.get(key) || { severity: 'error', category: 'Syntax and correctness' };
      const message = issue.getMessage();
      // tables defined as CDS sources are unknown to abaplint (it expects DDIC XML)
      const m = /(?:Database table or view|Type|Table) "([^"]+)" not found/i.exec(message);
      if (m && knownObjects.has(m[1].toLowerCase())) continue;
      // the app's function modules and the lock function modules of its lock objects exist (on both engines)
      const fmNf = /Function module "([^"]+)" not found/i.exec(message);
      if (fmNf && appFunctions.has(fmNf[1].toUpperCase())) continue;
      if (frameworkCalled(issue, s.text)) continue;
      findings.push({ file: s.rel, line: issue.getStart().getRow(), column: issue.getStart().getCol(), rule: key, category: r.category, severity: r.severity,
        message, fix: !!issue.getDefaultFix?.() });
    }
    if (v.rules.has('modern_syntax')) findings.push(...modernSyntax(reg, src, v.rules.get('modern_syntax')));
  };
  run(false);
  run(true);
  if (v.rules.has('released_api')) findings.push(...releasedApi(src, v.rules.get('released_api'), knownObjects));
  if (v.rules.has('rap_commit')) findings.push(...rapCommit(src, v.rules.get('rap_commit')));
  if (file) findings.splice(0, findings.length, ...findings.filter(f => f.file === file));
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.file.localeCompare(b.file) || a.line - b.line);
  const count = s => findings.filter(f => f.severity === s).length;
  return { variant: v.id, title: v.title, ms: Date.now() - t0, files: src.size, summary: { error: count('error'), warning: count('warning'), info: count('info'), fixable: findings.filter(f => f.fix).length },
    categories: [...new Set([...v.rules.values()].map(r => r.category))], findings };
}

// old statements that have a modern form (expressions and built-in functions of ABAP 7.40 and later); obsolete_statement
// (abaplint) covers MOVE, COMPUTE, ADD, REFRESH, OCCURS, RANGES …, this the rest. The message names the replacement.
const MODERN = {
  ReadTable: t => /\bTRANSPORTING NO FIELDS\b/.test(t) ? 'READ TABLE … TRANSPORTING NO FIELDS: use line_exists( itab[ … ] ) or line_index( itab[ … ] )'
    : 'READ TABLE: use a table expression, e.g. DATA(line) = VALUE #( itab[ key = value ] OPTIONAL ) or ASSIGN itab[ … ] TO FIELD-SYMBOL(<line>)',
  Concatenate: t => /\bLINES OF\b/.test(t) ? 'CONCATENATE LINES OF: use concat_lines_of( table = itab sep = … )' : 'CONCATENATE: use a string template |{ a }{ b }| or &&',
  Translate: t => /\bCASE\b/.test(t) ? 'TRANSLATE … CASE: use to_upper( ) or to_lower( )' : 'TRANSLATE … USING: use translate( val = … from = … to = … )',
  Condense: () => 'CONDENSE: use condense( val = … )',
  Describe: t => /\bLINES\b/.test(t) ? 'DESCRIBE TABLE … LINES: use lines( itab )' : null,
  Search: () => 'SEARCH is obsolete: use FIND or find( )',
  Shift: () => 'SHIFT: use shift_left( ) or shift_right( )',
  Write: t => /\sTO\s/.test(t) ? 'WRITE … TO: use a string template with formatting options, e.g. |{ value DATE = USER }|' : null,
  SelectLoop: () => 'SELECT … ENDSELECT: read into an internal table (INTO TABLE @DATA(…)) and loop over it',
  Form: () => 'FORM subroutines are obsolete: use methods of a local class',
};
function modernSyntax(reg, src, r) {
  const out = [];
  for (const obj of reg.getObjects()) {
    for (const f of obj.getABAPFiles?.() || []) {
      const s = src.get(f.getFilename().toLowerCase());
      if (!s) continue;
      for (const st of f.getStatements()) {
        const message = MODERN[st.get().constructor.name]?.(st.concatTokens().replace(/'[^']*'|`[^`]*`|\|[^|]*\|/g, "''").toUpperCase());
        if (message) out.push({ file: s.rel, line: st.getStart().getRow(), column: st.getStart().getCol(), rule: 'modern_syntax', category: r.category, severity: r.severity, message, fix: false });
      }
    }
  }
  return out;
}

// COMMIT WORK / ROLLBACK WORK in a behavior pool (the class FOR BEHAVIOR OF and its local handler and saver
// classes): RAP saves itself; on an SAP system the statement ends in the runtime error BEHAVIOR_ILLEGAL_STATEMENT
function rapCommit(src, r) {
  const pools = new Set();
  for (const [name, s] of src) if (/\.clas\.abap$/.test(name) && /\bFOR\s+BEHAVIOR\s+OF\b/i.test(s.text)) pools.add(name.split('.')[0]);
  const out = [];
  for (const [name, s] of src) {
    if (s.classic || !pools.has(name.split('.')[0])) continue;
    s.text.split('\n').forEach((line, i) => {
      const code = line.replace(/^\*.*$/, '').replace(/".*$/, '');
      const m = /(?:^|\.)\s*(COMMIT|ROLLBACK)\s+WORK\b/i.exec(code);
      if (m) out.push({ file: s.rel, line: i + 1, column: m.index + 1, rule: 'rap_commit', category: r.category, severity: r.severity,
        message: `${m[1].toUpperCase()} WORK is not allowed in a RAP behavior implementation: RAP saves the transaction itself (on SAP: runtime error BEHAVIOR_ILLEGAL_STATEMENT)`, fix: false });
    });
  }
  return out;
}

// What rap check reports in addition to activation: code that runs here but would not activate or run on an SAP
// system (BTP ABAP environment, S/4HANA Cloud): unknown types of the customer namespace (abaplint unknown_types with
// the app's dictionary), objects not released for ABAP Cloud, COMMIT WORK / ROLLBACK WORK in behavior pools
export function sapReadiness(dir, { knownObjects = new Set() } = {}) {
  const rule = (id) => [id, { rule: id, severity: 'warning', category: 'SAP system', settings: {} }];
  const variant = { id: 'sap-readiness', title: 'SAP readiness', rules: new Map([rule('unknown_types'), rule('released_api'), rule('rap_commit')]) };
  return runAtc(dir, { variant, knownObjects }).findings.filter(f => variant.rules.has(f.rule));
}

// SAP objects that are not released for ABAP Cloud, used in RAP code: name the released successor
function releasedApi(src, r, knownObjects) {
  const { successors } = releasedObjects();
  const standard = systemCatalog(null, null);   // the SAP standard layer: released views every app can use
  const available = n => knownObjects.has(n.toLowerCase()) || standard.has(n.toLowerCase());
  const out = [];
  for (const [name, s] of src) {
    if (s.classic) continue;
    const lines = s.text.split('\n');
    const cds = /\.(ddls|ddlx|bdef|srvd)\./.test(name);
    lines.forEach((line, i) => {
      // code only: no comments, no string literals
      const code = (cds ? line.replace(/\/\/.*$/, '') : line.replace(/^\*.*$/, '').replace(/".*$/, '')).replace(/'[^']*'|`[^`]*`|\|[^|]*\|/g, '');
      for (const m of code.matchAll(/\b[A-Za-z_][A-Za-z0-9_/]*\b/g)) {
        const id = m[0].toUpperCase();
        const x = successors[id];
        if (!x || id.length < 3) continue;
        // only where an object is used: FROM / JOIN / TO / TYPE / REF TO / NEW / CALL FUNCTION / =>
        const before = code.slice(0, m.index).toUpperCase();
        if (!/(\bFROM|\bJOIN|\bTO|\bTYPE|\bLIKE|\bNEW|\bCALL\s+FUNCTION|\bUPDATE|\bINSERT|\bMODIFY|\bDELETE|\bTABLE\s+OF|\bSINGLE)\s*['(]?\s*$/.test(before) && !/^\s*=>/.test(code.slice(m.index + m[0].length))) continue;
        const [type, , succ] = x;
        out.push({ file: s.rel, line: i + 1, column: m.index + 1, rule: 'released_api', category: r.category, severity: r.severity,
          message: `${id} (${type}) is not released for ABAP Cloud: use ${succ.join(' or ')}${succ.some(available) ? ' (available in this system)' : ''}`, fix: false });
      }
    });
  }
  return out;
}

// applies the quick fixes (all, or of one rule / one file), writes the changed files; returns what changed
// methods only the framework calls: RAP handlers (METHODS x FOR DETERMINE / VALIDATE / INSTANCE FEATURES / MODIFY /
// READ / LOCK / SAVE …) and event handlers (FOR EVENT): "unused" is no finding, and its quick fix must never delete them
function frameworkCalled(issue, text) {
  if (!/^unused_(methods|variables)$/.test(issue.getKey())) return false;
  const lines = String(text).split('\n');
  const row = issue.getStart().getRow() - 1;
  if (issue.getKey() === 'unused_variables') {
    // a parameter of a handler's signature (IMPORTING … REQUEST requested_features): fixed by the framework
    for (let i = row; i >= 0 && i > row - 6; i--) {
      const l = (lines[i] || '').replace(/".*$/, '');
      if (i < row && /\.\s*$/.test(l)) return false;
      if (/^\s*(class-)?methods\s+[\w~/]+\s+for\s/i.test(l)) return true;
      if (/^\s*(class-)?methods\b/i.test(l)) return false;
    }
    return false;
  }
  // the statement of the declaration (from its line up to the period), or the implementation's METHOD name.
  const name = /(?:method|methods)\s+"?([\w~/]+)/i.exec(issue.getMessage())?.[1] || /\b([\w~/]+)\b/.exec(lines[row].replace(/^\s*(class-)?methods?\s+/i, ''))?.[1];
  if (!name) return false;
  const decl = new RegExp(`(?:^|\\.)\\s*(?:class-)?methods\\s+${name.replace(/[~/]/g, m => `\\${m}`)}\\b([^.]*)`, 'i').exec(String(text).replace(/"[^\n]*/g, ''));
  return !!decl && /^\s+for\s/i.test(decl[1]);
}

export function fixAtc(dir, { variant = 'default', rule, file, knownObjects } = {}) {
  const abaplint = require('@abaplint/core');
  const v = loadVariant(dir, variant);
  const src = sourcesOf(dir);
  const changed = new Set();
  let fixed = 0;
  for (const classic of [false, true]) {
    for (let round = 0; round < 8; round++) {
      const files = [...src].filter(([, s]) => s.classic === classic);
      if (!files.length) break;
      const conf = Object.fromEntries([...v.rules.values()].filter(r => !OWN_RULES.has(r.rule) && (!rule || r.rule === rule) && !(classic && CLASSIC_SKIP.has(r.rule))).map(r => [r.rule, Object.keys(r.settings).length ? r.settings : true]));
      const reg = registry(files.map(([n, s]) => [n, s.text]), classic ? 'v758' : 'Cloud', conf);
      // one fix per file and round: edits of one rule run can overlap
      const seen = new Set();
      const edits = [];
      for (const issue of reg.findIssues()) {
        const n = issue.getFilename(), s = src.get(n);
        if (!s || seen.has(n) || (file && s.rel !== file) || (rule && issue.getKey() !== rule)) continue;
        if (frameworkCalled(issue, s.text)) continue;
        const fix = issue.getDefaultFix?.();
        if (!fix) continue;
        seen.add(n); edits.push(fix);
      }
      if (!edits.length) break;
      abaplint.Edits.applyEditList(reg, edits);
      for (const n of seen) { const raw = reg.getFileByName(n)?.getRaw(); if (raw !== undefined && raw !== src.get(n).text) { src.get(n).text = raw; changed.add(n); } }
      fixed += edits.length;
    }
  }
  for (const n of changed) fs.writeFileSync(src.get(n).path, src.get(n).text);
  return { fixed, files: [...changed].map(n => src.get(n).rel) };
}

// ---------------------------------------------------------------- explanations (markdown)
// RAP Studio's own docs, abaplint's rule documentation, and abapOpenChecks' description when abaplint names one
export function ruleDoc(rule) {
  const key = String(rule).toLowerCase().replace(/[^a-z0-9_]/g, '');
  const own = path.join(KNOWLEDGE, 'checks', 'rules', `${key}.md`);
  if (fs.existsSync(own)) return { rule: key, markdown: fs.readFileSync(own, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '') };
  const abaplint = require('@abaplint/core');
  const r = abaplint.ArtifactsRules.getRules().find(x => x.getMetadata().key === key);
  if (!r) return { rule: key, markdown: `No description for ${key}.` };
  const m = r.getMetadata();
  let md = `# ${m.title}\n\n${m.shortDescription || ''}\n\n${(m.extendedInformation || '').trim()}\n`;
  if (m.badExample) md += `\n**Instead of**\n\n\`\`\`abap\n${m.badExample.trim()}\n\`\`\`\n`;
  if (m.goodExample) md += `\n**Write**\n\n\`\`\`abap\n${m.goodExample.trim()}\n\`\`\`\n`;
  const oc = /abapopenchecks[^"\s)]*?checks\/(\d+)/i.exec(JSON.stringify(m))?.[1];
  const ocFile = oc && path.join(KNOWLEDGE, 'abapopenchecks', `${oc.padStart(2, '0')}.md`);
  if (ocFile && fs.existsSync(ocFile)) md += `\n---\n\n**abapOpenChecks CHECK_${oc}**\n\n${fs.readFileSync(ocFile, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '').trim()}\n`;
  md += `\n\nSource: [abaplint rule ${key}](https://rules.abaplint.org/${key}/)${oc ? `, [abapOpenChecks ${oc}](https://docs.abapopenchecks.org/checks/${oc}/)` : ''}.`;
  return { rule: key, markdown: md };
}
