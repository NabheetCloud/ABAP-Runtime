// Function groups without abapGit metadata: the group XML (function list and parameters), the TOP include and
// the main program SAPL<group> are generated from the function modules' sources, whose interface is the
// standard "*"Local Interface:" comment block that SAP writes, e.g.
//   *"  IMPORTING
//   *"     VALUE(IV_CARRIER) TYPE  ZCFL_CARRIER
//   *"     REFERENCE(IV_MAX) TYPE  I DEFAULT 10 OPTIONAL
//   *"  EXPORTING
//   *"     REFERENCE(ET_FLIGHTS) TYPE  ZCFL_T_FLIGHTS
//   *"  TABLES
//   *"      T_ROWS STRUCTURE  ZCFLIGHT_A OPTIONAL
//   *"  EXCEPTIONS
//   *"      NOT_FOUND
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SECTIONS = { IMPORTING: ['IMPORT', 'RSIMP'], EXPORTING: ['EXPORT', 'RSEXP'], CHANGING: ['CHANGING', 'RSCHA'], TABLES: ['TABLES', 'RSTBL'], EXCEPTIONS: ['EXCEPTION', 'RSEXC'] };

// one function module: { name, sections: { IMPORTING: [{ parameter, reference, typ, default, optional, struct }] } }
export function parseFunction(src) {
  const name = /^\s*FUNCTION\s+([\w/]+)\s*\./im.exec(src)?.[1]?.toUpperCase();
  if (!name) return null;
  const sections = {};
  let current = null;
  for (const line of src.split('\n')) {
    const m = /^\*"\s*(.*)$/.exec(line);
    if (!m) { if (current && line.trim() && !line.trim().startsWith('*')) break; continue; }
    const t = m[1].trim();
    if (SECTIONS[t]) { current = t; sections[t] = []; continue; }
    if (!current || !t || /^-+$/.test(t) || /^\*/.test(t) || /Local Interface/i.test(t)) continue;
    if (current === 'EXCEPTIONS') { sections[current].push({ parameter: t.split(/\s+/)[0].toUpperCase() }); continue; }
    const p = /^(?:(VALUE|REFERENCE)\(\s*([\w/]+)\s*\)|([\w/]+))\s*(?:(TYPE\s+REF\s+TO|TYPE|LIKE|STRUCTURE)\s+([\w/=>-]+))?(.*)$/i.exec(t);
    if (!p) continue;
    const rest = p[6] || '';
    sections[current].push({
      parameter: (p[2] || p[3]).toUpperCase(),
      reference: !/^VALUE$/i.test(p[1] || ''),
      kind: (p[4] || '').toUpperCase().replace(/\s+/g, ' '),
      typ: (p[5] || '').toUpperCase(),
      default: /DEFAULT\s+(\S+)/i.exec(rest)?.[1],
      optional: /\bOPTIONAL\b/i.test(rest) || /DEFAULT/i.test(rest),
    });
  }
  return { name, sections };
}

function paramXml(sec, p) {
  const [, item] = SECTIONS[sec];
  if (sec === 'EXCEPTIONS') return `      <${item}>\n       <EXCEPTION>${esc(p.parameter)}</EXCEPTION>\n      </${item}>\n`;
  const tags = [['PARAMETER', p.parameter]];
  if (sec === 'TABLES') { if (p.typ) tags.push([p.kind === 'TYPE' ? 'TYP' : 'DBSTRUCT', p.typ]); if (p.optional) tags.push(['OPTIONAL', 'X']); }
  else {
    if (p.default) tags.push(['DEFAULT', p.default]);
    if (p.optional && sec !== 'EXPORTING') tags.push(['OPTIONAL', 'X']);
    if (p.reference) tags.push(['REFERENCE', 'X']);
    if (p.typ) tags.push([p.kind === 'TYPE REF TO' ? 'REF_CLASS' : p.kind === 'LIKE' ? 'DBFIELD' : 'TYP', p.typ]);
    if (p.kind === 'TYPE REF TO') tags.push(['TYP', p.typ]);
  }
  return `      <${item}>\n${tags.map(([k, v]) => `       <${k}>${esc(v)}</${k}>\n`).join('')}      </${item}>\n`;
}

export function fugrXml(group, functions) {
  const g = group.toUpperCase();
  const fns = functions.map(f => {
    let x = `    <item>\n     <FUNCNAME>${esc(f.name)}</FUNCNAME>\n     <SHORT_TEXT>${esc(f.name)}</SHORT_TEXT>\n`;
    for (const sec of Object.keys(SECTIONS)) {
      const list = f.sections[sec];
      if (list?.length) x += `     <${SECTIONS[sec][0]}>\n${list.map(p => paramXml(sec, p)).join('')}     </${SECTIONS[sec][0]}>\n`;
    }
    return x + '    </item>\n';
  }).join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_FUGR" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <AREAT>${esc(g)}</AREAT>
   <INCLUDES>
    <SOBJ_NAME>L${esc(g)}TOP</SOBJ_NAME>
    <SOBJ_NAME>SAPL${esc(g)}</SOBJ_NAME>
   </INCLUDES>
   <FUNCTIONS>
${fns}   </FUNCTIONS>
  </asx:values>
 </asx:abap>
</abapGit>
`;
}
export const topInclude = group => `FUNCTION-POOL ${group.toLowerCase()}.\n`;
export const mainProgram = group => `INCLUDE l${group.toLowerCase()}top.\nINCLUDE l${group.toLowerCase()}uxx.\n`;
