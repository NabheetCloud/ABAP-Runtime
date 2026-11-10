// Syntax check with abaplint (https://github.com/abaplint/abaplint), the open-source ABAP parser.
// abaplint validates ABAP statements against the official grammar for the chosen language version
// (default: ABAP for Cloud Development). Our own compiler then executes the code.
// Released SAP APIs that the runtime implements are provided as ABAP stubs in ./stdlib.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { listSources } from '../rap/model.js';

const require = createRequire(import.meta.url);
const STDLIB = path.join(path.dirname(fileURLToPath(import.meta.url)), 'stdlib');
// abapGit object types abaplint understands
const LINTABLE = /\.(clas\.abap|clas\.locals_imp\.abap|clas\.locals_def\.abap|clas\.testclasses\.abap|intf\.abap|ddls\.asddls|bdef\.asbdef|srvd\.srvdsrv|tabl\.xml|ddlx\.asddlxs)$/i;
// findings of these rules block activation; everything else is reported as a warning
const BLOCKING = new Set(['parser_error', 'structure']);

export function syntaxCheck(dir, { version = 'Cloud', knownObjects = new Set() } = {}) {
  const abaplint = require('@abaplint/core');
  const config = new abaplint.Config(JSON.stringify({
    global: { files: '/**/*.*' },
    syntax: { version: abaplint.Version[version] ?? abaplint.Version.Cloud, errorNamespace: '^(Z|Y|LCL_|LHC_|LSC_|LTC_|LTH_|LIF_|TY_)' },
    rules: { parser_error: true, structure: true, check_syntax: true },
  }));
  const reg = new abaplint.Registry(config);
  const own = new Set();
  for (const f of listSources(dir)) {
    const base = path.basename(f);
    if (!LINTABLE.test(base)) continue;
    own.add(base.toLowerCase());
    reg.addFile(new abaplint.MemoryFile(base.toLowerCase(), fs.readFileSync(f, 'utf8')));
  }
  for (const f of fs.readdirSync(STDLIB)) reg.addDependency(new abaplint.MemoryFile(f, fs.readFileSync(path.join(STDLIB, f), 'utf8')));
  reg.parse();
  const errors = [], warnings = [];
  const rel = new Map(listSources(dir).map(f => [path.basename(f).toLowerCase(), path.relative(dir, f)]));
  // the app's function modules and the lock function modules of its lock objects exist (classic engine and RAP)
  const appFunctions = new Set();
  for (const b of rel.keys()) {
    let m;
    if ((m = /^[\w$#]+\.fugr\.([\w$#]+)\.abap$/.exec(b)) && !/^(sapl|l\w+top$|l\w+uxx$)/.test(m[1])) appFunctions.add(m[1].toUpperCase());
    if ((m = /^([\w$#]+)\.enqu\.xml$/.exec(b))) { appFunctions.add(`ENQUEUE_${m[1].toUpperCase()}`); appFunctions.add(`DEQUEUE_${m[1].toUpperCase()}`); }
  }
  knownObjects = new Set([...knownObjects, ...[...appFunctions].map(f => `fm:${f}`)]);
  for (const issue of reg.findIssues()) {
    const file = issue.getFilename();
    if (!own.has(file)) continue;
    const entry = { file: rel.get(file) || file, line: issue.getStart().getRow(), message: `[abaplint ${issue.getKey()}] ${issue.getMessage()}` };
    if (BLOCKING.has(issue.getKey()) && !parserGap(reg, file, entry.line)) errors.push(entry);
    else if (!isKnownGap(issue, knownObjects) && !appFunction(issue.getMessage(), dir)) warnings.push(entry);
  }
  return { errors, warnings };
}

// valid ABAP that abaplint cannot parse yet: our compiler is the judge for these statements
const ABAPLINT_GAPS = [/\bENTITIES\s+OPERATIONS\b/i, /CORRESPONDING\s+#\(.*\bFROM\b.*\bUSING\b/i];
function parserGap(reg, file, line) {
  const src = reg.getFileByName?.(file)?.getRaw?.() || '';
  const stmt = src.split('\n').slice(Math.max(0, line - 1), line + 3).join(' ');
  return ABAPLINT_GAPS.some(re => re.test(stmt));
}

// function modules and Z classes the runtime implements itself (form output: src/abap/forms-apis.js)
const RUNTIME_FUNCTIONS = /^(FP_JOB_OPEN|FP_JOB_CLOSE|FP_FUNCTION_MODULE_NAME|\/1BCDWB\/.*)$/i;
const RUNTIME_CLASSES = /^(zcl_rap_form)$/i;
// tables defined as CDS "define table" sources are unknown to abaplint (it expects abapGit XML)
function isKnownGap(issue, known) {
  const msg = issue.getMessage();
  const fm = /Function module "([^"]+)" not found/.exec(msg);
  if (fm && (RUNTIME_FUNCTIONS.test(fm[1]) || known.has(`fm:${fm[1].toUpperCase()}`))) return true;
  const cls = /Class (\S+) not found/.exec(msg);
  if (cls && RUNTIME_CLASSES.test(cls[1])) return true;
  const m = /Database table or view "([^"]+)" not found/.exec(msg);
  return !!m && known.has(m[1].toLowerCase());
}

// the app's function modules and its lock objects' ENQUEUE_ / DEQUEUE_ function modules exist
function appFunction(msg, dir) {
  const m = /Function module "([^"]+)" not found/i.exec(msg);
  if (!m) return false;
  const want = m[1].toUpperCase();
  for (const f of listSources(dir)) {
    const b = path.basename(f).toLowerCase();
    const g = /^[\w$#]+\.fugr\.([\w$#]+)\.abap$/.exec(b);
    if (g && g[1].toUpperCase() === want) return true;
    const e = /^([\w$#]+)\.enqu\.xml$/.exec(b);
    if (e && (want === `ENQUEUE_${e[1].toUpperCase()}` || want === `DEQUEUE_${e[1].toUpperCase()}`)) return true;
  }
  return false;
}
