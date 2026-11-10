// Export an app as an abapGit repository: the sources plus the object XML files abapGit expects, so the app
// can be pulled into an SAP system (ABAP Cloud / S/4HANA) with abapGit or ADT's abapGit plugin.
//   - CDS "define table" sources become TABL XML (DD02V / DD09L / DD03P); everything else keeps its source file
//   - one OData V4 UI service binding (SRVB) per service definition
//   - message classes (.msag.json) become MSAG XML
// The XML follows abapGit's serializers; it is generated, so review it on the first import.
import fs from 'node:fs';
import path from 'node:path';
import { parseCds } from '../ddl/cds.js';
import { listSources } from '../rap/model.js';

const HEAD = '<?xml version="1.0" encoding="utf-8"?>';
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const wrap = (serializer, inner) => `${HEAD}\n<abapGit version="v1.0.0" serializer="${serializer}" serializer_version="v1.0.0">\n <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">\n  <asx:values>\n${inner}\n  </asx:values>\n </asx:abap>\n</abapGit>\n`;
const tag = (name, fields, indent = '   ') => `${indent}<${name}>\n${Object.entries(fields).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${indent} <${k}>${esc(v)}</${k}>`).join('\n')}\n${indent}</${name}>`;
const upper = s => String(s).toUpperCase();
const text60 = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 60);

// built-in CDS types -> DDIC data type, ABAP internal type, internal length
function ddicType(t) {
  const n = t.name.replace(/^abap\./, '');
  const len = t.len ?? 0, dec = t.dec ?? 0;
  const pad = v => String(v).padStart(6, '0');
  const P = (l) => Math.ceil((l + 1) / 2);
  const map = {
    char: ['CHAR', 'C', len * 2, len], numc: ['NUMC', 'N', len * 2, len], dats: ['DATS', 'D', 16, 8], tims: ['TIMS', 'T', 12, 6],
    dec: ['DEC', 'P', P(len), len, dec], curr: ['CURR', 'P', P(len), len, dec], quan: ['QUAN', 'P', P(len), len, dec],
    int1: ['INT1', 'b', 1, 3], int2: ['INT2', 's', 2, 5], int4: ['INT4', 'I', 4, 10], int8: ['INT8', '8', 8, 19],
    clnt: ['CLNT', 'C', 6, 3], cuky: ['CUKY', 'C', 10, 5], unit: ['UNIT', 'C', (len || 3) * 2, len || 3], lang: ['LANG', 'C', 2, 1],
    raw: ['RAW', 'X', len, len], string: ['STRG', 'g', 8, 0], sstring: ['SSTR', 'g', 8, len], rawstring: ['RSTR', 'y', 8, 0],
    fltp: ['FLTP', 'F', 8, 16, 16], utclong: ['UTCL', 'p', 8, 27], datn: ['DATN', 'D', 16, 8], timn: ['TIMN', 'T', 12, 6],
    d16n: ['D16N', 'a', 8, 16], d34n: ['D34N', 'e', 16, 34], accp: ['ACCP', 'N', 12, 6], prec: ['PREC', 's', 2, 2],
  };
  const m = t.name.startsWith('abap.') ? map[n] : null;
  if (!m) return null;
  return { DATATYPE: m[0], INTTYPE: m[1], INTLEN: pad(m[2]), LENG: pad(m[3]), DECIMALS: m[4] ? pad(m[4]) : undefined };
}

// a table or structure (kind 'structure': TABCLASS INTTAB) as abapGit TABL XML. kinds(name) tells what a
// non-built-in component type is ('S' structure, 'L' table type, else a data element). Currency / quantity
// references (@Semantics.amount.currencyCode / quantity.unitOfMeasure), check tables (with foreign key), the delivery
// class and the technical settings (@AbapCatalog.technicalSettings.*) are written too.
const enumOf = v => String(v ?? '').replace(/^#/, '').toUpperCase();
export function tablXml(def, { kinds = () => null } = {}) {
  const name = upper(def.name);
  const structure = def.kind === 'structure';
  const refOf = f => {
    const r = f.ann?.semantics?.amount?.currencycode || f.ann?.semantics?.quantity?.unitofmeasure;
    if (!r) return {};
    const [t, fl] = String(r).includes('.') ? String(r).split('.') : [def.name, String(r)];
    return { REFTABLE: upper(t), REFFIELD: upper(fl) };
  };
  const fields = def.fields.map((f, i) => {
    if (f.include) {
      return tag('DD03P', { TABNAME: name, FIELDNAME: '.INCLUDE', ADMINFIELD: '0', PRECFIELD: upper(f.include), MASK: '      S', COMPTYPE: 'S', GROUPNAME: f.label ? upper(String(f.label).replace(/"/g, '')) : undefined }, '     ');
    }
    const builtin = ddicType(f.type);
    const k = builtin ? null : kinds(f.type.name);
    return tag('DD03P', {
      TABNAME: name, FIELDNAME: upper(f.name), POSITION: String(i + 1).padStart(4, '0'), KEYFLAG: f.key ? 'X' : undefined,
      ...(builtin ? { ADMINFIELD: '0', ...builtin, MASK: `  ${builtin.DATATYPE}`, DDTEXT: text60(f.ann?.endusertext?.label || f.label) } : { ROLLNAME: upper(f.type.name), ADMINFIELD: '0', ...(k === 'S' ? { DATATYPE: 'STRU', MASK: '  STRUS', COMPTYPE: 'S' } : k === 'L' ? { DATATYPE: 'TTYP', MASK: '  TTYPL', COMPTYPE: 'L' } : { COMPTYPE: 'E' }) }),
      ...(f.checkTable ? { CHECKTABLE: upper(f.checkTable) } : {}),
      ...refOf(f),
      NOTNULL: !structure && (f.notNull || f.key) ? 'X' : undefined,
    }, '     ');
  });
  const cat = def.ann?.abapcatalog || {};
  const ts = cat.technicalsettings || {};
  const buffering = enumOf(ts.buffering);
  return wrap('LCL_OBJECT_TABL', [
    tag('DD02V', { TABNAME: name, DDLANGUAGE: 'E', TABCLASS: structure ? 'INTTAB' : 'TRANSP', CLIDEP: !structure && def.fields.some(f => f.type?.name === 'abap.clnt') ? 'X' : undefined, DDTEXT: text60(def.ann?.endusertext?.label || name), MASTERLANG: 'E',
      CONTFLAG: structure ? undefined : (enumOf(cat.deliveryclass) || 'A'), EXCLASS: '1', MAINFLAG: structure ? undefined : ({ ALLOWED: 'X', RESTRICTED: '', NOT_ALLOWED: 'N' }[enumOf(cat.datamaintenance)] ?? undefined) }),
    ...(structure ? [] : [tag('DD09L', { TABNAME: name, AS4LOCAL: 'A', TABKAT: String(ts.sizecategory ?? '0').replace(/^#/, ''), TABART: enumOf(ts.dataclass) || 'APPL0',
      BUFALLOW: { ON: 'X', ALLOWED_BUT_OFF: 'A', NOT_ALLOWED: 'N' }[buffering] || 'N', PUFFERUNG: buffering === 'ON' ? ({ FULL: 'X', GENERIC: 'G', SINGLE: 'P' }[enumOf(ts.bufferingtype)] || 'P') : undefined })]),
    `   <DD03P_TABLE>\n${fields.join('\n')}\n   </DD03P_TABLE>`,
  ].join('\n'));
}

// DDLS source type: W view entity, P projection view, A abstract entity, Q custom entity, F table function
function ddlsType(src) {
  if (/define\s+(root\s+)?view\s+entity\s+\w+[\s\S]*?\bas\s+projection\s+on\b/i.test(src)) return 'P';
  if (/define\s+(root\s+)?abstract\s+entity/i.test(src)) return 'A';
  if (/define\s+(root\s+)?custom\s+entity/i.test(src)) return 'Q';
  if (/define\s+table\s+function/i.test(src)) return 'F';
  if (/define\s+hierarchy/i.test(src)) return 'H';
  return 'W';
}
const labelOf = src => /@EndUserText\.label\s*:\s*'((?:[^']|'')*)'/i.exec(src)?.[1]?.replace(/''/g, "'") || '';
const shortText = src => /"!\s*<p class="shorttext[^"]*"[^>]*>([^<]*)</i.exec(src)?.[1] || '';
const nice = n => upper(n).replace(/^Z[A-Z]?_?/, '').replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\w/g, c => c.toUpperCase());
const meta = (name, type, description, extra = {}) => tag('METADATA', { NAME: upper(name), TYPE: type, DESCRIPTION: text60(description || nice(name)), DESCRIPTION_TEXT_LIMIT: '60', LANGUAGE: 'EN', ...extra });

export function msagXml(name, msgs) {
  const t100 = Object.entries(msgs).map(([no, text]) => tag('T100', { SPRSL: 'E', ARBGB: upper(name), MSGNR: no.padStart(3, '0'), TEXT: String(text).slice(0, 73) }, '     '));
  return wrap('LCL_OBJECT_MSAG', `${tag('T100A', { ARBGB: upper(name), MASTERLANG: 'E', STEXT: text60(nice(name)) })}\n   <T100>\n${t100.join('\n')}\n   </T100>`);
}

// what a type name is in an app: 'S' a structure (define structure), 'L' a table type, null otherwise
export function ddicKinds(dir) {
  const map = new Map();
  for (const f of listSources(dir)) {
    const b = path.basename(f).toLowerCase();
    if (/\.ttyp\.xml$/.test(b)) map.set(b.split('.')[0], 'L');
    if (/\.tabl\.(cds|astabldt)$/.test(b)) { try { for (const d of parseCds(fs.readFileSync(f, 'utf8'), b)) if (d.kind === 'structure' || d.kind === 'table') map.set(d.name, 'S'); } catch {} }
  }
  return n => map.get(String(n).toLowerCase()) || null;
}

export function abapGitFiles(dir, { packageName, description } = {}) {
  const out = new Map();
  const appName = path.basename(dir);
  const pkg = upper(packageName || `Z${appName.replace(/[^a-z0-9]/gi, '').slice(0, 25)}`);
  out.set('.abapgit.xml', `${HEAD}\n<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">\n <asx:values>\n  <DATA>\n   <MASTER_LANGUAGE>E</MASTER_LANGUAGE>\n   <STARTING_FOLDER>/src/</STARTING_FOLDER>\n   <FOLDER_LOGIC>PREFIX</FOLDER_LOGIC>\n   <IGNORE>\n    <item>/.gitignore</item>\n    <item>/LICENSE</item>\n    <item>/README.md</item>\n    <item>/webapp/</item>\n   </IGNORE>\n  </DATA>\n </asx:values>\n</asx:abap>\n`);
  out.set('src/package.devc.xml', wrap('LCL_OBJECT_DEVC', tag('DEVC', { CTEXT: text60(description || nice(appName)) })));
  const classes = new Map();   // class -> { main, locals, tests, src }
  for (const file of listSources(dir)) {
    const base = path.basename(file).toLowerCase();
    const src = fs.readFileSync(file, 'utf8');
    const rel = `src/${base}`;
    let m;
    if ((m = /^(.+)\.clas\.(abap|locals_imp\.abap|locals_def\.abap|testclasses\.abap|macros\.abap)$/.exec(base))) {
      out.set(rel, src);
      const c = classes.get(m[1]) || {};
      if (m[2] === 'abap') c.src = src;
      if (m[2] === 'testclasses.abap') c.tests = true;
      classes.set(m[1], c);
    } else if ((m = /^(.+)\.intf\.abap$/.exec(base))) {
      out.set(rel, src);
      out.set(`src/${m[1]}.intf.xml`, wrap('LCL_OBJECT_INTF', tag('VSEOINTERF', { CLSNAME: upper(m[1]), LANGU: 'E', DESCRIPT: text60(shortText(src) || nice(m[1])), EXPOSURE: '2', STATE: '1', UNICODE: 'X' })));
    } else if ((m = /^(.+)\.ddls\.asddls$/.exec(base))) {
      out.set(rel, src);
      out.set(`src/${m[1]}.ddls.xml`, wrap('LCL_OBJECT_DDLS', tag('DDLS', { DDLNAME: upper(m[1]), DDLANGUAGE: 'E', DDTEXT: text60(labelOf(src) || nice(m[1])), SOURCE_TYPE: ddlsType(src) })));
    } else if ((m = /^(.+)\.ddlx\.asddlxs$/.exec(base))) {
      out.set(rel, src);
      out.set(`src/${m[1]}.ddlx.xml`, wrap('LCL_OBJECT_DDLX', tag('DDLX', {}).replace(/<DDLX>\n\s*<\/DDLX>/, `<DDLX>\n${meta(m[1], 'DDLX/EX', labelOf(src) || `Metadata extension ${upper(m[1])}`, { MASTER_LANGUAGE: 'EN' })}\n   </DDLX>`)));
    } else if ((m = /^(.+)\.bdef\.asbdef$/.exec(base))) {
      out.set(rel, src);
      out.set(`src/${m[1]}.bdef.xml`, wrap('LCL_OBJECT_BDEF', `   <BDEF>\n${meta(m[1], 'BDEF/BDO', `Behavior for ${upper(m[1])}`, { MASTER_LANGUAGE: 'EN' })}\n   </BDEF>`));
    } else if ((m = /^(.+)\.srvd\.srvdsrv$/.exec(base))) {
      out.set(rel, src);
      const srvd = upper(m[1]);
      out.set(`src/${m[1]}.srvd.xml`, wrap('LCL_OBJECT_SRVD', `   <SRVD>\n${meta(srvd, 'SRVD/SRV', labelOf(src) || `Service ${srvd}`, { MASTER_LANGUAGE: 'EN', SRVD_SOURCE_TYPE: 'S' })}\n   </SRVD>`));
      // a service binding (OData V4 - UI) for every service definition
      const srvb = `${srvd}_O4`.slice(0, 30);
      out.set(`src/${srvb.toLowerCase()}.srvb.xml`, wrap('LCL_OBJECT_SRVB', `   <SRVB>\n${meta(srvb, 'SRVB/SVB', `OData V4 UI binding for ${srvd}`, { MASTER_LANGUAGE: 'EN' })}\n    <BINDING_TYPE>ODATA</BINDING_TYPE>\n    <BINDING_TYPE_CATEGORY>0</BINDING_TYPE_CATEGORY>\n    <BINDING_TYPE_VERSION>V4</BINDING_TYPE_VERSION>\n    <SERVICES>\n     <item>\n      <NAME>${esc(srvb)}</NAME>\n      <VERSIONS>\n       <item>\n        <SERVICE_VERSION>0001</SERVICE_VERSION>\n        <SERVICE_DEFINITION>\n         <NAME>${esc(srvd)}</NAME>\n        </SERVICE_DEFINITION>\n        <RELEASE_STATE>NOT_RELEASED</RELEASE_STATE>\n       </item>\n      </VERSIONS>\n     </item>\n    </SERVICES>\n   </SRVB>`));
    } else if ((m = /^(.+)\.dcls\.asdcls$/.exec(base))) {
      out.set(rel, src);
      out.set(`src/${m[1]}.dcls.xml`, wrap('LCL_OBJECT_DCLS', tag('DCLS', { DCLNAME: upper(m[1]), DCLLANGU: 'E', DDTEXT: text60(labelOf(src) || nice(m[1])) })));
    } else if ((m = /^(.+)\.xslt\.source\.xml$/.exec(base))) {
      out.set(rel, src);
      if (!fs.existsSync(path.join(path.dirname(file), `${m[1]}.xslt.xml`))) out.set(`src/${m[1]}.xslt.xml`, wrap('LCL_OBJECT_XSLT', tag('ATTRIBUTES', { XSLTDESC: upper(m[1]), LANGU: 'E', DESCRIPT: text60(/<tt:transform/.test(src) ? `Simple transformation ${upper(m[1])}` : `XSLT ${upper(m[1])}`) })));
    } else if ((m = /^(.+)\.xslt\.xml$/.exec(base))) {
      out.set(rel, src);
    } else if ((m = /^(.+)\.tabl\.(cds|astabldt)$/.exec(base))) {
      for (const def of parseCds(src, base)) if (def.kind === 'table' || def.kind === 'structure') out.set(`src/${def.name}.tabl.xml`, tablXml(def, { kinds: ddicKinds(dir) }));
    } else if (/\.(doma|dtel|ttyp|enqu)\.xml$/.test(base)) {
      out.set(rel, src);
    } else if ((m = /^(.+)\.tabl\.xml$/.exec(base))) {
      out.set(rel, src);
    } else if ((m = /^(.+)\.msag\.json$/.exec(base))) {
      out.set(`src/${m[1]}.msag.xml`, msagXml(m[1], JSON.parse(src)));
    }
  }
  for (const [name, c] of classes) {
    const src = c.src || '';
    const bp = /FOR\s+BEHAVIOR\s+OF/i.test(src);
    out.set(`src/${name}.clas.xml`, wrap('LCL_OBJECT_CLAS', tag('VSEOCLASS', {
      CLSNAME: upper(name), LANGU: 'E', DESCRIPT: text60(shortText(src) || (bp ? `Behavior implementation ${upper(name)}` : nice(name))),
      CATEGORY: bp ? '06' : undefined, STATE: '1', CLSCCINCL: 'X', FIXPT: 'X', UNICODE: 'X', WITH_UNIT_TESTS: c.tests ? 'X' : undefined,
    })));
  }
  // the UI5 apps are deployed with the UI5 tooling, not abapGit; they travel along outside /src/
  const web = path.join(dir, 'webapp');
  if (fs.existsSync(web)) {
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.set(path.relative(dir, p).split(path.sep).join('/'), fs.readFileSync(p)); } };
    walk(web);
  }
  out.set('README.md', `# ${appName}\n\nabapGit repository exported from RAP Studio (package ${pkg}).\n\n1. Create package ${pkg} in your system (ABAP Cloud or S/4HANA).\n2. In ADT: abapGit Repositories > Link (or Clone) this repository into ${pkg}, then Pull.\n3. Activate everything, then publish the service binding(s) (*_O4).\n\nThe folder webapp/ holds the UI5 apps; deploy them with the UI5 tooling (\`npx fiori deploy\`). Test data from RAP Studio is not exported.\n`);
  return out;
}

export function writeAbapGit(dir, outDir, opts) {
  const files = abapGitFiles(dir, opts);
  for (const [rel, content] of files) {
    const f = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  }
  return [...files.keys()];
}
