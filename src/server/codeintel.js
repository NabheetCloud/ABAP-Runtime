// Code intelligence for the studio editor (ADT-like): completion, go to definition, where-used, rename, hover and
// the outline of a source. Text-based over the app's sources (src/), backed by the activated model (tables, views,
// entities with their fields, classes with methods) and the system catalogue (other apps, the SAP standard layer).
import fs from 'node:fs';
import path from 'node:path';
import { listSources } from '../rap/model.js';
import { systemCatalog } from '../rap/catalog.js';

const ABAP_KEYWORDS = ['ABAP_TRUE', 'ABAP_FALSE', 'APPEND', 'ASSIGN', 'AT', 'AUTHORITY-CHECK', 'BEGIN OF', 'BREAK-POINT', 'CALL FUNCTION', 'CALL METHOD', 'CASE', 'CATCH', 'CHECK', 'CLASS', 'CLASS-DATA', 'CLASS-METHODS', 'CLEANUP', 'CLEAR', 'COMMIT ENTITIES', 'COMMIT WORK', 'CONCATENATE', 'CONDENSE', 'CONSTANTS', 'CONTINUE', 'CORRESPONDING', 'COND', 'CREATE OBJECT', 'DATA', 'DEFINITION', 'DELETE', 'DESCRIBE', 'DO', 'ELSE', 'ELSEIF', 'END OF', 'ENDCASE', 'ENDCLASS', 'ENDDO', 'ENDFORM', 'ENDIF', 'ENDINTERFACE', 'ENDLOOP', 'ENDMETHOD', 'ENDMODULE', 'ENDSELECT', 'ENDTRY', 'ENDWHILE', 'EXIT', 'EXPORTING', 'FIELD-SYMBOLS', 'FINAL', 'FOR', 'FORM', 'FROM', 'FUNCTION', 'IF', 'IMPLEMENTATION', 'IMPORTING', 'IN LOCAL MODE', 'INHERITING FROM', 'INSERT', 'INTERFACE', 'INTERFACES', 'INTO TABLE', 'INTO CORRESPONDING FIELDS OF', 'IS INITIAL', 'IS NOT INITIAL', 'LINES', 'LOOP AT', 'MESSAGE', 'METHOD', 'METHODS', 'MODIFY', 'MODIFY ENTITIES OF', 'MODULE', 'MOVE-CORRESPONDING', 'NEW', 'ORDER BY', 'OTHERS', 'PARAMETERS', 'PERFORM', 'PRIVATE SECTION', 'PROTECTED SECTION', 'PUBLIC', 'PUBLIC SECTION', 'RAISE', 'RAISE EXCEPTION', 'READ ENTITIES OF', 'READ TABLE', 'REDEFINITION', 'REDUCE', 'REF', 'REFRESH', 'REPORT', 'RESULT', 'RETURN', 'RETURNING', 'SELECT', 'SELECT SINGLE', 'SELECT-OPTIONS', 'SORT', 'SPLIT', 'START-OF-SELECTION', 'STANDARD TABLE OF', 'SWITCH', 'TABLES', 'TRY', 'TYPE', 'TYPE REF TO', 'TYPES', 'UP TO', 'UPDATE', 'VALUE', 'WHERE', 'WHILE', 'WITH', 'WRITE'];
const CDS_KEYWORDS = ['define', 'root', 'view', 'entity', 'as', 'select', 'from', 'projection on', 'provider contract transactional_query', 'association', 'association to parent', 'composition', 'of', 'key', 'where', 'and', 'or', 'not', 'case', 'when', 'then', 'else', 'end', 'cast', 'redirected to', 'redirected to parent', 'redirected to composition child', 'define table', 'define abstract entity', 'annotate entity', 'with', 'define service', 'expose', 'inner join', 'left outer join', 'on', 'group by', 'having', 'distinct', '$projection', '$session.system_date', '$session.user', '$parameters'];
const BDEF_KEYWORDS = ['managed', 'unmanaged', 'implementation in class', 'unique', 'strict ( 2 )', 'with draft', 'define behavior for', 'alias', 'persistent table', 'draft table', 'lock master', 'lock dependent by', 'total etag', 'etag master', 'authorization master ( instance )', 'authorization master ( global )', 'authorization dependent by', 'create', 'update', 'delete', 'association', 'field ( readonly )', 'field ( mandatory )', 'field ( numbering : managed, readonly )', 'field ( features : instance )', 'action', 'internal action', 'static action', 'factory action', 'result [1] $self', 'parameter', 'determination', 'validation', 'on modify', 'on save', 'mapping for', 'draft action Edit', 'draft action Activate optimized', 'draft action Discard', 'draft action Resume', 'draft determine action Prepare', 'side effects', 'event', 'projection', 'use create', 'use update', 'use delete', 'use action', 'use association', 'use draft', 'use etag', 'with additional save', 'with unmanaged save', 'late numbering', 'early numbering', 'changedocuments master'];
const ANNOTATIONS = {
  '@AccessControl.authorizationCheck': ['#NOT_REQUIRED', '#CHECK', '#MANDATORY', '#NOT_ALLOWED'],
  '@EndUserText.label': ["'Label'"], '@Metadata.allowExtensions': ['true'], '@Metadata.layer': ['#CUSTOMER', '#PARTNER', '#INDUSTRY', '#LOCALIZATION', '#CORE'],
  '@ObjectModel.text.element': ["['Field']"], '@ObjectModel.resultSet.sizeCategory': ['#XS'], '@ObjectModel.leadingEntity.name': ["'ZI_X'"],
  '@ObjectModel.query.implementedBy': ["'ABAP:ZCL_X'"], '@Consumption.valueHelpDefinition': ["[{ entity: { name: 'ZI_X', element: 'Key' } }]"],
  '@Search.searchable': ['true'], '@Search.defaultSearchElement': ['true'], '@Semantics.amount.currencyCode': ["'Currency'"], '@Semantics.quantity.unitOfMeasure': ["'Unit'"],
  '@Semantics.user.createdBy': ['true'], '@Semantics.systemDateTime.createdAt': ['true'], '@Semantics.user.lastChangedBy': ['true'], '@Semantics.systemDateTime.lastChangedAt': ['true'],
  '@Semantics.systemDateTime.localInstanceLastChangedAt': ['true'], '@Semantics.largeObject': ["{ mimeType: 'MimeType', fileName: 'FileName', contentDispositionPreference: #ATTACHMENT }"], '@Semantics.mimeType': ['true'],
  '@UI.headerInfo': ["{ typeName: 'X', typeNamePlural: 'Xs', title: { value: 'Field' } }"], '@UI.lineItem': ['[{ position: 10 }]', "[{ type: #FOR_ACTION, dataAction: 'action', label: 'Label' }]"],
  '@UI.identification': ['[{ position: 10 }]'], '@UI.selectionField': ['[{ position: 10 }]'], '@UI.facet': ["[{ id: 'Id', purpose: #STANDARD, type: #IDENTIFICATION_REFERENCE, label: 'Label', position: 10 }]"],
  '@UI.fieldGroup': ["[{ qualifier: 'Group', position: 10 }]"], '@UI.hidden': ['true'], '@UI.presentationVariant': ["[{ sortOrder: [{ by: 'Field', direction: #DESC }] }]"],
  '@UI.chart': ["[{ qualifier: 'X', chartType: #COLUMN, dimensions: ['Dim'], measures: ['Measure'] }]"], '@Aggregation.default': ['#SUM', '#MAX', '#MIN', '#AVG', '#COUNT_DISTINCT'],
  '@AbapCatalog.enhancement.category': ['#NOT_EXTENSIBLE'], '@AbapCatalog.tableCategory': ['#TRANSPARENT'], '@AbapCatalog.deliveryClass': ['#A', '#C'], '@AbapCatalog.dataMaintenance': ['#RESTRICTED', '#ALLOWED'],
  '@OData.hierarchy.recursiveHierarchy': ["[{ entity.name: 'ZI_X_Hier' }]"], '@Environment.systemField': ['#SYSTEM_DATE', '#USER', '#SYSTEM_LANGUAGE'],
};
const SNIPPETS = {
  abap: [
    ['method', 'METHOD ${1:name}.\n  $0\nENDMETHOD.', 'Method implementation'],
    ['class', 'CLASS ${1:zcl_name} DEFINITION PUBLIC FINAL CREATE PUBLIC.\n  PUBLIC SECTION.\n    $0\nENDCLASS.\n\nCLASS ${1:zcl_name} IMPLEMENTATION.\nENDCLASS.', 'Class definition and implementation'],
    ['classrun', 'CLASS ${1:zcl_name} DEFINITION PUBLIC FINAL CREATE PUBLIC.\n  PUBLIC SECTION.\n    INTERFACES if_oo_adt_classrun.\nENDCLASS.\n\nCLASS ${1:zcl_name} IMPLEMENTATION.\n  METHOD if_oo_adt_classrun~main.\n    out->write( $0 ).\n  ENDMETHOD.\nENDCLASS.', 'Console class (if_oo_adt_classrun)'],
    ['select', 'SELECT FROM ${1:table}\n  FIELDS ${2:*}\n  WHERE ${3:condition}\n  INTO TABLE @DATA(${4:result}).', 'SELECT … INTO TABLE @DATA( )'],
    ['selectsingle', 'SELECT SINGLE FROM ${1:table}\n  FIELDS ${2:*}\n  WHERE ${3:condition}\n  INTO @DATA(${4:result}).', 'SELECT SINGLE'],
    ['loop', 'LOOP AT ${1:itab} INTO DATA(${2:line}).\n  $0\nENDLOOP.', 'LOOP AT … INTO DATA( )'],
    ['loopfs', 'LOOP AT ${1:itab} ASSIGNING FIELD-SYMBOL(<${2:line}>).\n  $0\nENDLOOP.', 'LOOP AT … ASSIGNING FIELD-SYMBOL( )'],
    ['readentities', 'READ ENTITIES OF ${1:zr_root} IN LOCAL MODE\n  ENTITY ${2:Alias}\n    ALL FIELDS WITH CORRESPONDING #( keys )\n  RESULT DATA(${3:rows}).', 'READ ENTITIES (EML)'],
    ['modifyentities', 'MODIFY ENTITIES OF ${1:zr_root} IN LOCAL MODE\n  ENTITY ${2:Alias}\n    UPDATE FIELDS ( ${3:Field} )\n    WITH VALUE #( FOR key IN keys ( %tky = key-%tky ${3:Field} = ${4:value} ) ).', 'MODIFY ENTITIES (EML)'],
    ['try', 'TRY.\n    $0\n  CATCH ${1:cx_root} INTO DATA(${2:error}).\n    ${3:out->write( error->get_text( ) ).}\nENDTRY.', 'TRY … CATCH … ENDTRY'],
    ['if', 'IF ${1:condition}.\n  $0\nENDIF.', 'IF … ENDIF'],
    ['case', 'CASE ${1:value}.\n  WHEN ${2:x}.\n    $0\n  WHEN OTHERS.\nENDCASE.', 'CASE … ENDCASE'],
    ['report', 'REPORT ${1:zreport}.\n\nPARAMETERS ${2:p_x} TYPE ${3:c LENGTH 10}.\n\nSTART-OF-SELECTION.\n  $0', 'Report skeleton'],
  ],
  cds: [
    ['defineview', "@AccessControl.authorizationCheck: #NOT_REQUIRED\n@EndUserText.label: '${2:Label}'\ndefine view entity ${1:ZI_Name}\n  as select from ${3:ztable}\n{\n  key ${4:field} as ${5:Field},\n      $0\n}", 'define view entity'],
    ['definerootview', "@AccessControl.authorizationCheck: #NOT_REQUIRED\n@EndUserText.label: '${2:Label}'\ndefine root view entity ${1:ZR_Name}\n  as select from ${3:ztable}\n{\n  key ${4:field} as ${5:Field},\n      $0\n}", 'define root view entity'],
    ['projection', "@AccessControl.authorizationCheck: #NOT_REQUIRED\n@Metadata.allowExtensions: true\ndefine root view entity ${1:ZC_Name}\n  provider contract transactional_query\n  as projection on ${2:ZR_Name}\n{\n  key ${3:Key},\n      $0\n}", 'Projection view'],
    ['definetable', "@EndUserText.label : '${2:Label}'\ndefine table ${1:ztable} {\n  key client : abap.clnt not null;\n  key ${3:id} : sysuuid_x16 not null;\n  $0\n}", 'define table'],
    ['behavior', 'managed implementation in class ${1:zbp_r_name} unique;\nstrict ( 2 );\n\ndefine behavior for ${2:ZR_Name} alias ${3:Alias}\npersistent table ${4:ztable}\nlock master\nauthorization master ( instance )\netag master LocalLastChangedAt\n{\n  create;\n  update;\n  delete;\n  $0\n}', 'Managed behavior definition'],
    ['service', 'define service ${1:ZUI_NAME} {\n  expose ${2:ZC_Name} as ${3:Name};\n}', 'Service definition'],
    ['association', 'association [0..1] to ${1:ZI_Target} as _${2:Target} on \\$projection.${3:Key} = _${2:Target}.${3:Key}', 'association'],
  ],
};

const kindOfFile = f => {
  const b = path.basename(f).toLowerCase();
  if (/\.tabl\.cds$/.test(b)) return 'table';
  if (/\.ddls\.asddls$/.test(b)) return 'view';
  if (/\.ddlx\.asddlxs$/.test(b)) return 'metadata extension';
  if (/\.bdef\.asbdef$/.test(b)) return 'behavior definition';
  if (/\.srvd\.srvdsrv$/.test(b)) return 'service definition';
  if (/\.clas\./.test(b)) return 'class';
  if (/\.intf\./.test(b)) return 'interface';
  if (/\.prog\./.test(b)) return 'program';
  if (/\.fugr\./.test(b)) return 'function group';
  if (/\.(dtel|doma|ttyp)\.xml$/.test(b)) return b.split('.')[1] === 'dtel' ? 'data element' : b.split('.')[1] === 'doma' ? 'domain' : 'table type';
  if (/\.form\.json$|\.xdp$/.test(b)) return 'form';
  if (/\.msag\.json$/.test(b)) return 'message class';
  return 'object';
};
const langOf = f => (/\.abap$/i.test(f) ? 'abap' : /\.asbdef$/i.test(f) ? 'bdef' : /\.(asddls|asddlxs|srvdsrv|cds)$/i.test(f) ? 'cds' : 'other');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripComments = (line, lang) => (lang === 'abap' ? (/^\*/.test(line) ? '' : line.replace(/".*$/, '')) : line.replace(/\/\/.*$/, ''));

export class CodeIntel {
  constructor(ws) { this.ws = ws; this._cat = null; }
  get dir() { return this.ws.dir; }
  // the app's sources: relative path -> text
  sources() {
    const out = new Map();
    for (const f of listSources(this.dir)) {
      if (!/\.(abap|cds|asddls|asddlxs|asbdef|srvdsrv|json|xml)$/i.test(f)) continue;
      try { out.set(path.relative(this.dir, f), fs.readFileSync(f, 'utf8')); } catch {}
    }
    return out;
  }
  catalog() {
    if (!this._cat) { try { this._cat = systemCatalog(this.ws.opts?.systemDir || null, this.dir); } catch { this._cat = new Map(); } }
    return this._cat;
  }
  get model() { return this.ws.app?.model; }

  // ---------------------------------------------------------------- outline: the symbols of one source
  symbols(text, file) {
    const lang = langOf(file);
    const out = [];
    const lines = String(text).split('\n');
    let cls = null;
    lines.forEach((raw, i) => {
      const l = stripComments(raw, lang);
      let m;
      if (lang === 'abap') {
        if ((m = /^\s*CLASS\s+([\w/$]+)\s+(DEFINITION|IMPLEMENTATION)/i.exec(l))) { cls = m[1].toLowerCase(); out.push({ name: m[1], kind: m[2].toUpperCase() === 'DEFINITION' ? 'class' : 'class implementation', line: i + 1 }); }
        else if ((m = /^\s*INTERFACE\s+([\w/$]+)(?!\s+LOAD)/i.exec(l)) && !/DEFERRED/i.test(l)) out.push({ name: m[1], kind: 'interface', line: i + 1 });
        else if ((m = /^\s*(CLASS-)?METHODS\s+([\w~]+)/i.exec(l))) out.push({ name: m[2], kind: 'method declaration', line: i + 1, container: cls });
        else if ((m = /^\s*METHOD\s+([\w~]+)\s*\./i.exec(l))) out.push({ name: m[1], kind: 'method', line: i + 1, container: cls });
        else if ((m = /^\s*(FORM|MODULE|FUNCTION)\s+([\w/]+)/i.exec(l))) out.push({ name: m[2], kind: m[1].toLowerCase(), line: i + 1 });
        else if ((m = /^\s*(REPORT|PROGRAM)\s+([\w/]+)/i.exec(l))) out.push({ name: m[2], kind: 'program', line: i + 1 });
        else if ((m = /^\s*(START-OF-SELECTION|END-OF-SELECTION|INITIALIZATION|AT SELECTION-SCREEN)\b/i.exec(l))) out.push({ name: m[1].toUpperCase(), kind: 'event', line: i + 1 });
        else if ((m = /^\s*TYPES\s*:?\s*BEGIN\s+OF\s+([\w]+)/i.exec(l))) out.push({ name: m[1], kind: 'type', line: i + 1 });
      } else if (lang === 'cds') {
        if ((m = /define\s+(?:root\s+)?(?:view\s+entity|table|abstract\s+entity|custom\s+entity|view|service|table\s+function|hierarchy)\s+([\w/]+)/i.exec(l))) out.push({ name: m[1], kind: 'definition', line: i + 1 });
        else if ((m = /annotate\s+(?:entity|view)\s+([\w/]+)/i.exec(l))) out.push({ name: m[1], kind: 'metadata extension', line: i + 1 });
        else if ((m = /^\s*(association|composition)\b.*?\bas\s+(_\w+)/i.exec(l))) out.push({ name: m[2], kind: m[1].toLowerCase(), line: i + 1 });
        else if ((m = /^\s*expose\s+([\w/]+)(?:\s+as\s+(\w+))?/i.exec(l))) out.push({ name: m[2] || m[1], kind: 'entity set', line: i + 1 });
        else if ((m = /^\s*(key\s+)?([\w.]+)\s*(?:as\s+(\w+))?\s*[,:]/i.exec(l)) && !/^\s*(@|define|association|composition|\}|\{)/i.test(l)) out.push({ name: m[3] || m[2].split('.').pop(), kind: m[1] ? 'key field' : 'field', line: i + 1 });
      } else if (lang === 'bdef') {
        if ((m = /define\s+behavior\s+for\s+([\w/]+)(?:\s+alias\s+(\w+))?/i.exec(l))) out.push({ name: m[2] ? `${m[1]} (${m[2]})` : m[1], kind: 'entity behavior', line: i + 1 });
        else if ((m = /\b(action|determination|validation|event|function)\b(?:\s*\([^)]*\))?\s+(\w+)/i.exec(l))) out.push({ name: m[2], kind: m[1].toLowerCase(), line: i + 1 });
      }
    });
    return out;
  }

  // ---------------------------------------------------------------- objects of the app (name -> where)
  objects() {
    const out = new Map();
    for (const [rel, text] of this.sources()) {
      const base = path.basename(rel).split('.')[0].toLowerCase();
      if (!out.has(base)) out.set(base, { name: base, file: rel, line: 1, kind: kindOfFile(rel) });
      for (const s of this.symbols(text, rel)) {
        if (['class', 'interface', 'definition', 'program', 'form', 'function'].includes(s.kind)) {
          const k = s.name.toLowerCase();
          const prev = out.get(k);
          if (!prev || prev.line === 1) out.set(k, { name: k, file: rel, line: s.line, kind: s.kind === 'definition' ? kindOfFile(rel) : s.kind });
        }
      }
    }
    return out;
  }

  // fields of a table / view / entity (app model, then the system catalogue): [{ name, type, key, desc }]
  fieldsOf(name) {
    const n = String(name || '').toLowerCase();
    const m = this.model;
    const t = m?.tables?.get(n);
    if (t) return t.fields.filter(f => !/^(client|mandt)$/i.test(f.name)).map(f => ({ name: f.name, type: typeText(f.ti), key: !!f.key }));
    const e = m?.entities?.get(n);
    if (e) return e.fields.map(f => ({ name: f.label || f.name, type: typeText(f.ti), key: (e.keys || []).includes(f.name) })).concat((e.assocs ? [...e.assocs.values()] : []).map(a => ({ name: a.label || a.name, type: `association to ${a.target}`, assoc: a.target })));
    const c = this.catalog().get(n);
    if (c) {
      const d = c.def;
      return (d.fields || d.elements || []).filter(f => !/^(client|mandt)$/i.test(f.name || '')).map(f => ({ name: f.label || f.alias || f.name, type: String(f.type?.name ?? f.type ?? ''), key: !!f.key })).concat((d.assocs || []).map(a => ({ name: a.alias || a.name, type: `association to ${a.target}`, assoc: a.target })));
    }
    return null;
  }
  // a class of the app: methods and attributes
  classOf(name) {
    const c = this.model?.classes?.get(String(name || '').toLowerCase());
    if (!c) return null;
    const methods = Array.isArray(c.methods) ? c.methods : c.methods instanceof Map ? [...c.methods.values()] : Object.values(c.methods || {});
    const attrs = Array.isArray(c.attrs) ? c.attrs : c.attrs instanceof Map ? [...c.attrs.values()] : Object.values(c.attrs || {});
    const params = x => [...(x.importing || []), ...(x.exporting || []), ...(x.changing || []), ...(x.returning ? [x.returning] : []), ...(x.params || [])].map(p => p?.name).filter(Boolean);
    return { name: c.name, file: c.file, line: c.line, methods: methods.map(x => ({ name: x.name, isStatic: !!(x.static ?? x.isStatic), params: params(x), line: x.line })), attrs: attrs.map(a => ({ name: a.name, isStatic: !!(a.static ?? a.isStatic) })), interfaces: c.interfaces || [], superName: c.superName };
  }

  // ---------------------------------------------------------------- the word at a position and what it qualifies
  at(text, line, col) {
    const l = String(text).split('\n')[line - 1] || '';
    const i = Math.max(0, col - 1);
    let s = i, e = i;
    const W = /[\w/$%]/;
    while (s > 0 && W.test(l[s - 1])) s--;
    while (e < l.length && W.test(l[e])) e++;
    // a field symbol: <name>
    if (l[s - 1] === '<' && l[e] === '>') { s--; e++; }
    const word = l.slice(s, e);
    const before = l.slice(0, s);
    const q = /([\w/$]+)\s*(~|=>|->|-|\.)\s*$/.exec(before);
    return { word, start: s + 1, end: e + 1, qualifier: q ? q[1] : null, sep: q ? q[2] : null, lineText: l };
  }
  // what a qualifier stands for in the current source: a table / view, a class, a variable's type
  typeOfQualifier(q, text, file) {
    const name = String(q).toLowerCase();
    if (name === 'me') { const cls = [...String(text).matchAll(/^\s*CLASS\s+([\w/]+)\s+IMPLEMENTATION/gim)].pop(); return cls ? { kind: 'class', name: cls[1].toLowerCase() } : null; }
    if (this.fieldsOf(name)) return { kind: 'structure', name };
    if (this.classOf(name)) return { kind: 'class', name };
    const src = String(text);
    // SELECT … FROM tab AS alias
    let m = new RegExp(`\\b(?:from|join)\\s+([\\w/]+)\\s+as\\s+${esc(name)}\\b`, 'i').exec(src);
    if (m) return { kind: 'structure', name: m[1].toLowerCase() };
    // DATA x TYPE tab / TYPE STANDARD TABLE OF tab / TYPE REF TO cls / TYPE TABLE FOR … ent
    m = new RegExp(`\\b(?:DATA|CLASS-DATA|FIELD-SYMBOLS|PARAMETERS)\\s*:?\\s*<?${esc(name)}>?\\s+(?:TYPE|LIKE)\\s+(REF\\s+TO\\s+|(?:STANDARD\\s+|SORTED\\s+|HASHED\\s+)?TABLE\\s+OF\\s+|(?:TABLE|STRUCTURE)\\s+FOR\\s+\\w+(?:\\s+\\w+)?\\s+)?([\\w/\\\\~]+)`, 'i').exec(src);
    if (m) { const t = m[2].toLowerCase().split(/[\\~]/)[0]; return /^REF/i.test(m[1] || '') ? { kind: 'class', name: t } : { kind: 'structure', name: t }; }
    // SELECT … FROM tab … INTO TABLE @DATA(name) / INTO @DATA(name)
    m = new RegExp(`\\bFROM\\s+([\\w/]+)[\\s\\S]{0,400}?INTO\\s+(?:TABLE\\s+|CORRESPONDING\\s+FIELDS\\s+OF\\s+(?:TABLE\\s+)?)?@DATA\\(\\s*${esc(name)}\\s*\\)`, 'i').exec(src);
    if (m) return { kind: 'structure', name: m[1].toLowerCase() };
    // LOOP AT itab INTO DATA(name) / ASSIGNING FIELD-SYMBOL(<name>): the table's line type
    m = new RegExp(`LOOP\\s+AT\\s+([\\w/@-]+)\\s+(?:INTO\\s+DATA\\(\\s*${esc(name)}\\s*\\)|ASSIGNING\\s+FIELD-SYMBOL\\(\\s*<${esc(name.replace(/[<>]/g, ''))}>\\s*\\))`, 'i').exec(src);
    if (m) return this.typeOfQualifier(m[1].replace(/^@/, ''), text, file);
    // CDS: _assoc of the view being edited
    if (/^_/.test(name) && /\.(asddls|asddlxs|cds)$/i.test(file)) {
      const def = /define\s+(?:root\s+)?view\s+entity\s+([\w/]+)/i.exec(src);
      const own = def && this.fieldsOf(def[1]);
      const a = own?.find(f => f.assoc && f.name.toLowerCase() === name);
      if (a) return { kind: 'structure', name: a.assoc.toLowerCase() };
      m = new RegExp(`(?:association|composition)[^;\\n]*?\\b(?:to|of)\\s+(?:parent\\s+)?([\\w/]+)\\s+as\\s+${esc(name)}\\b`, 'i').exec(src);
      if (m) return { kind: 'structure', name: m[1].toLowerCase() };
    }
    return null;
  }

  // ---------------------------------------------------------------- completion
  complete({ file, text, line, col }) {
    const lang = langOf(file);
    const l = String(text).split('\n')[line - 1] || '';
    const before = l.slice(0, Math.max(0, col - 1));
    const items = [];
    const add = (label, kind, detail, insert, snippet) => items.push({ label, kind, detail, insertText: insert ?? label, snippet: !!snippet });
    // annotations
    const ann = /@([\w.]*)$/.exec(before);
    if (ann && lang !== 'abap') {
      for (const [a, vals] of Object.entries(ANNOTATIONS)) if (a.toLowerCase().startsWith(`@${ann[1]}`.toLowerCase())) add(a, 'annotation', vals.join(' | '), `${a.slice(1)}: \${1|${vals.map(v => v.replace(/[,|]/g, m => `\\${m}`)).join(',')}|}`, true);
      return { items };
    }
    // members: x~ / x- / x. / cls=> / obj->
    const mem = /([\w/$<>]+)\s*(~|=>|->|-|\.)\s*([\w]*)$/.exec(before);
    if (mem && !(lang === 'abap' && mem[2] === '.' )) {
      const t = this.typeOfQualifier(mem[1].replace(/[<>]/g, ''), text, file);
      if (t?.kind === 'structure') for (const f of this.fieldsOf(t.name) || []) add(f.name, f.assoc ? 'association' : 'field', `${f.type}${f.key ? ' (key)' : ''}`);
      if (t?.kind === 'class') {
        const c = this.classOf(t.name);
        if (c) {
          const staticOnly = mem[2] === '=>';
          for (const m of c.methods) if (!staticOnly || m.isStatic) add(m.name, 'method', `${m.isStatic ? 'static ' : ''}method of ${c.name}`, `${m.name}( $0 )`, true);
          for (const a of c.attrs) if (!staticOnly || a.isStatic) add(a.name, 'attribute', `attribute of ${c.name}`);
        }
      }
      if (items.length) return { items };
    }
    const kw = lang === 'abap' ? ABAP_KEYWORDS : lang === 'bdef' ? BDEF_KEYWORDS : lang === 'cds' ? CDS_KEYWORDS : [];
    for (const k of kw) add(k, 'keyword', 'keyword');
    for (const [label, body, detail] of SNIPPETS[lang === 'bdef' ? 'cds' : lang] || []) add(label, 'snippet', detail, body, true);
    // local names of the source: variables, methods, types
    const seen = new Set();
    for (const m of String(text).matchAll(/(?:DATA\(|FIELD-SYMBOL\(|\bDATA\s*:?\s+|\bTYPES\s*:?\s+(?:BEGIN\s+OF\s+)?|\bCONSTANTS\s*:?\s+|\bPARAMETERS\s+|\bSELECT-OPTIONS\s+|\bMETHODS\s+)(<?[\w]+>?)/gi)) {
      const n = m[1];
      if (seen.has(n.toLowerCase()) || /^(begin|end|type)$/i.test(n)) continue;
      seen.add(n.toLowerCase());
      add(n, 'variable', 'local name');
    }
    // objects: the app's, then the system catalogue (tables, views incl. I_ views)
    for (const o of this.objects().values()) add(o.name, 'object', `${o.kind} · ${o.file}`, lang === 'abap' ? o.name : o.name);
    for (const [n, x] of this.catalog()) add(x.def?.label || n, 'object', `${x.def?.kind === 'table' ? 'table' : 'view'} · ${x.standard ? 'SAP standard' : `app ${x.app}`}`);
    for (const c of this.model?.classes?.values() || []) if (!this.objects().has(c.name)) add(c.name, 'class', 'class');
    return { items: items.slice(0, 3000) };
  }

  // ---------------------------------------------------------------- go to definition
  definition({ file, text, line, col }) {
    const w = this.at(text, line, col);
    const name = w.word.replace(/[<>]/g, '').toLowerCase();
    if (!name) return null;
    const src = String(text);
    // a member: method / attribute / field of what the qualifier stands for
    if (w.qualifier) {
      const t = this.typeOfQualifier(w.qualifier.replace(/[<>]/g, ''), text, file);
      if (t?.kind === 'class') {
        const loc = this.findInSources(new RegExp(`^\\s*METHOD\\s+${esc(name)}\\s*\\.`, 'i'), t.name) || this.findInSources(new RegExp(`^\\s*(CLASS-)?(METHODS|DATA)\\s+${esc(name)}\\b`, 'i'), t.name);
        if (loc) return loc;
      }
      if (t?.kind === 'structure') {
        const o = this.objects().get(t.name);
        if (o) { const loc = this.lineIn(o.file, new RegExp(`\\b${esc(name)}\\b`, 'i'), o.line); if (loc) return loc; }
        return this.standardDef(t.name, name);
      }
    }
    // local: METHOD / FORM / DATA in this source
    const local = [`^\\s*METHOD\\s+${esc(name)}\\s*\\.`, `^\\s*(CLASS-)?METHODS\\s+${esc(name)}\\b`, `^\\s*FORM\\s+${esc(name)}\\b`, `^\\s*CLASS\\s+${esc(name)}\\s+DEFINITION`, `\\bDATA\\(\\s*${esc(name)}\\s*\\)`, `\\b(?:DATA|CONSTANTS|TYPES|PARAMETERS|SELECT-OPTIONS)\\s*:?\\s+${esc(name)}\\b`, `FIELD-SYMBOL\\(\\s*<${esc(name)}>\\s*\\)`]
      .map(r => new RegExp(r, 'i'));
    const lines = src.split('\n');
    for (const r of local) { const i = lines.findIndex(x => r.test(x)); if (i >= 0 && i + 1 !== line) return { file, line: i + 1 }; }
    // an object of the app
    const o = this.objects().get(name);
    if (o) return { file: o.file, line: o.line };
    // an object of the system / the SAP standard layer: read-only
    return this.standardDef(name);
  }
  standardDef(name, member) {
    const x = this.catalog().get(String(name).toLowerCase());
    if (!x) return null;
    let text = '';
    try { text = fs.readFileSync(x.file, 'utf8'); } catch { return null; }
    let ln = 1;
    if (member) { const i = text.split('\n').findIndex(l => new RegExp(`\\b${esc(member)}\\b`, 'i').test(l)); if (i >= 0) ln = i + 1; }
    return { readOnly: true, title: `${x.def?.label || name} · ${x.standard ? 'SAP standard' : `app ${x.app}`} (read-only)`, file: x.rel, text, line: ln };
  }
  findInSources(re, preferBase) {
    const src = this.sources();
    const order = [...src.keys()].sort((a, b) => Number(path.basename(b).toLowerCase().startsWith(`${preferBase}.`)) - Number(path.basename(a).toLowerCase().startsWith(`${preferBase}.`)));
    for (const rel of order) {
      if (preferBase && !path.basename(rel).toLowerCase().startsWith(`${preferBase}.`)) continue;
      const i = src.get(rel).split('\n').findIndex(l => re.test(l));
      if (i >= 0) return { file: rel, line: i + 1 };
    }
    return null;
  }
  lineIn(rel, re, from = 1) {
    const text = this.sources().get(rel);
    if (!text) return null;
    const lines = text.split('\n');
    for (let i = Math.max(0, from - 1); i < lines.length; i++) if (re.test(lines[i])) return { file: rel, line: i + 1 };
    return null;
  }

  // ---------------------------------------------------------------- where-used
  whereUsed(name, { file, member } = {}) {
    const n = String(name || '').replace(/[<>]/g, '');
    if (!n) return [];
    const re = new RegExp(`(^|[^\\w/$])(${esc(n)})(?![\\w/$])`, 'gi');
    const out = [];
    for (const [rel, text] of member && file ? [[file, this.sources().get(file) || '']] : this.sources()) {
      if (!/\.(abap|asddls|asddlxs|asbdef|srvdsrv|cds)$/i.test(rel)) continue;
      const lang = langOf(rel);
      text.split('\n').forEach((raw, i) => {
        const l = stripComments(raw, lang);
        for (const m of l.matchAll(re)) out.push({ file: rel, line: i + 1, col: m.index + m[1].length + 1, text: raw.trim().slice(0, 160) });
      });
    }
    // the object's own files
    for (const rel of this.sources().keys()) if (path.basename(rel).split('.')[0].toLowerCase() === n.toLowerCase() && !out.some(o => o.file === rel)) out.push({ file: rel, line: 1, col: 1, text: '(the object\'s file)' });
    return out;
  }

  // ---------------------------------------------------------------- rename
  // kind 'object': files named <old>.* become <new>.*, references in every source change; 'local': this source only
  rename({ name, newName, file, scope = 'object', apply = false }) {
    const oldN = String(name || '').trim(), newN = String(newName || '').trim();
    if (!oldN || !newN) throw new Error('Old and new name are needed');
    if (!/^[A-Za-z_/][\w/$]*$/.test(newN)) throw new Error(`${newN} is not a valid name`);
    if (oldN.toLowerCase() === newN.toLowerCase() && oldN === newN) throw new Error('The new name is the same');
    const objs = this.objects();
    if (scope === 'object' && objs.has(newN.toLowerCase()) && newN.toLowerCase() !== oldN.toLowerCase()) throw new Error(`${newN} exists already`);
    const re = new RegExp(`(^|[^\\w/$])(${esc(oldN)})(?![\\w/$])`, 'gi');
    const cased = found => (found === found.toUpperCase() && found !== found.toLowerCase() ? newN.toUpperCase() : found === found.toLowerCase() ? newN.toLowerCase() : newN);
    const changes = [], files = [];
    const src = this.sources();
    for (const [rel, text] of scope === 'local' ? [[file, src.get(file) ?? '']] : src) {
      if (!/\.(abap|asddls|asddlxs|asbdef|srvdsrv|cds|json|xml)$/i.test(rel)) continue;
      const lines = text.split('\n');
      let changed = false;
      const next = lines.map((l, i) => {
        if (!re.test(l)) return l;
        re.lastIndex = 0;
        const n = l.replace(re, (m, pre, found) => `${pre}${cased(found)}`);
        if (n !== l) { changes.push({ file: rel, line: i + 1, before: l.trim().slice(0, 160), after: n.trim().slice(0, 160) }); changed = true; }
        return n;
      });
      re.lastIndex = 0;
      if (changed) files.push({ rel, text: next.join('\n') });
    }
    const moves = scope === 'object' ? [...src.keys()].filter(rel => path.basename(rel).split('.')[0].toLowerCase() === oldN.toLowerCase())
      .map(rel => ({ from: rel, to: path.join(path.dirname(rel), [newN.toLowerCase(), ...path.basename(rel).split('.').slice(1)].join('.')) })) : [];
    if (apply) {
      for (const f of files) fs.writeFileSync(path.join(this.dir, f.rel), f.text);
      for (const m of moves) fs.renameSync(path.join(this.dir, m.from), path.join(this.dir, m.to));
      this._cat = null;
    }
    return { changes, moves, applied: !!apply };
  }

  // ---------------------------------------------------------------- hover
  hover({ file, text, line, col }) {
    const w = this.at(text, line, col);
    const name = w.word.replace(/[<>]/g, '').toLowerCase();
    if (!name) return null;
    if (w.qualifier) {
      const t = this.typeOfQualifier(w.qualifier.replace(/[<>]/g, ''), text, file);
      if (t?.kind === 'structure') { const f = (this.fieldsOf(t.name) || []).find(x => x.name.toLowerCase() === name); if (f) return { title: `${t.name.toUpperCase()}-${f.name}`, text: `${f.assoc ? 'Association' : 'Field'}: ${f.type}${f.key ? ' · key' : ''}` }; }
      if (t?.kind === 'class') { const c = this.classOf(t.name); const m = c?.methods.find(x => x.name.toLowerCase() === name); if (m) return { title: `${c.name.toUpperCase()}${m.isStatic ? '=>' : '->'}${m.name.toUpperCase()}`, text: `Method${m.params.length ? ` (${m.params.join(', ')})` : ''}` }; }
    }
    // a variable of this source: its declaration
    const decl = String(text).split('\n').find(l => new RegExp(`(\\bDATA\\(\\s*${esc(name)}\\s*\\)|\\b(?:DATA|CONSTANTS|PARAMETERS|CLASS-DATA)\\s*:?\\s+${esc(name)}\\b|FIELD-SYMBOL\\(\\s*<${esc(name)}>)`, 'i').test(l));
    if (decl) return { title: w.word, text: decl.trim() };
    const fields = this.fieldsOf(name);
    if (fields) {
      const x = this.catalog().get(name), o = this.objects().get(name);
      const kind = this.model?.tables?.has(name) ? 'Table' : this.model?.entities?.has(name) ? 'CDS view entity' : x?.def?.kind === 'table' ? 'Table' : 'CDS view entity';
      const label = this.model?.tables?.get(name)?.ann?.endusertext?.label || x?.def?.ann?.endusertext?.label || '';
      return { title: `${kind} ${name.toUpperCase()}`, text: `${label ? `${String(label).replace(/^'|'$/g, '')}\n` : ''}${x?.standard ? 'SAP standard layer\n' : o ? `${o.file}\n` : x ? `app ${x.app}\n` : ''}${fields.slice(0, 12).map(f => `${f.key ? 'key ' : ''}${f.name}: ${f.type}`).join('\n')}${fields.length > 12 ? `\n… ${fields.length - 12} more` : ''}` };
    }
    const c = this.classOf(name);
    if (c) return { title: `Class ${c.name.toUpperCase()}`, text: `${c.superName ? `inherits from ${c.superName}\n` : ''}${c.interfaces?.length ? `interfaces ${c.interfaces.join(', ')}\n` : ''}${c.methods.length} method(s): ${c.methods.slice(0, 10).map(m => m.name).join(', ')}` };
    const o = this.objects().get(name);
    if (o) return { title: `${o.kind} ${name.toUpperCase()}`, text: o.file };
    return null;
  }
}

function typeText(ti) {
  if (!ti) return '';
  const t = ti.t;
  const map = { c: 'abap.char', n: 'abap.numc', d: 'abap.dats', t: 'abap.tims', p: 'abap.dec', i: 'abap.int4', int8: 'abap.int8', f: 'abap.fltp', string: 'abap.string', x: 'abap.raw', xstring: 'abap.rawstring', uuid: 'sysuuid_x16', bool: 'abap_boolean', ts: 'timestampl', utcl: 'abap.utclong' };
  const base = map[t] || t;
  return ti.len ? `${base}(${ti.len}${ti.dec ? `,${ti.dec}` : ''})` : base;
}

// the HTTP endpoints: /api/codeintel/<op> (POST with { file, text, line, col, … })
export function codeintelRoute(ws, p, req, json, send, res) {
  if (!p.startsWith('/api/codeintel/')) return false;
  const op = p.slice('/api/codeintel/'.length);
  ws._codeintel ||= new CodeIntel(ws);
  const ci = ws._codeintel;
  ci._cat = null;
  try {
    const b = req.method === 'POST' ? json() : {};
    if (b.file && b.text === undefined) { try { b.text = fs.readFileSync(ws.resolveFile(b.file), 'utf8'); } catch { b.text = ''; } }
    if (op === 'complete') return send(res, 200, ci.complete(b)), true;
    if (op === 'definition') return send(res, 200, { location: ci.definition(b) }), true;
    if (op === 'whereused') return send(res, 200, { name: b.name, refs: ci.whereUsed(b.name, b) }), true;
    if (op === 'hover') return send(res, 200, { hover: ci.hover(b) }), true;
    if (op === 'symbols') return send(res, 200, { symbols: ci.symbols(b.text || '', b.file || '') }), true;
    if (op === 'rename') {
      const r = ci.rename(b);
      if (r.applied) { ws.activate(); return send(res, 200, { ...r, summary: ws.summary() }), true; }
      return send(res, 200, r), true;
    }
    if (op === 'word') return send(res, 200, ci.at(b.text, b.line, b.col)), true;
    send(res, 404, { error: { message: `Unknown operation ${op}` } });
  } catch (e) { send(res, 400, { error: { message: e.message } }); }
  return true;
}
