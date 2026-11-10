// Function groups on the ABAP runtime: a group becomes a class (zfugr_<group> style name $fugr_<group>) whose static
// methods are the function modules and the FORM routines, and whose static attributes are the global data of the
// TOP include. The sources keep their files and lines (the FUNCTION / FORM statements become METHOD statements), so
// errors point at the right place. CALL FUNCTION finds a function module through $rt.functions.
import fs from 'node:fs';
import path from 'node:path';
import { parseFunction } from '../classic/fugr.mjs';

export const fugrClass = group => `zfugr_${group.toLowerCase()}`;

// files: the group's .abap files; returns { units: [{ src, file }], functions: [names], group, cls }
export function functionGroupUnits(group, files, rel) {
  const cls = fugrClass(group);
  const read = f => fs.readFileSync(f, 'utf8');
  const includeOf = f => path.basename(f).split('.fugr.')[1].replace(/\.abap$/i, '').toLowerCase();
  const fms = [], forms = [], top = [];
  for (const f of files) {
    const inc = includeOf(f);
    const src = read(f);
    if (/^sapl/.test(inc) || /^l\w+uxx$/.test(inc)) continue;          // main program and the include of includes
    if (/^\s*FUNCTION\s+[\w/]+\s*\./im.test(src)) fms.push({ f, src, fn: parseFunction(src) });
    else if (/^l\w+top$/.test(inc)) top.push({ f, src });
    else forms.push({ f, src });
  }
  // the TOP include inside the public section: DATA -> CLASS-DATA, TABLES dbtab -> a work area, no FUNCTION-POOL
  const topSrc = top.map(t => ({ file: rel(t.f), src: t.src
    .replace(/^(\s*)FUNCTION-POOL\b[^.]*\./gim, (m, s) => `${s}${'*'.padEnd(m.length - s.length, ' ')}`)
    .replace(/^(\s*)DATA\b/gim, '$1CLASS-DATA')
    .replace(/^(\s*)TABLES\s+([\w/]+)\s*\./gim, '$1CLASS-DATA $2 TYPE $2.') }));
  // FORM name [TABLES t [STRUCTURE s]] [USING p [TYPE t] ...] [CHANGING p [TYPE t] ...]: all parameters by reference
  const formSigs = [];
  const formSrc = forms.map(x => ({ file: rel(x.f), src: x.src.replace(/^(\s*)FORM\s+([\w/]+)([^.]*)\./gim, (m, s, name, rest) => {
    formSigs.push(formSignature(name, rest));
    return `${s}METHOD ${name}.${'\n'.repeat((m.match(/\n/g) || []).length)}`;
  }).replace(/^(\s*)ENDFORM\b/gim, '$1ENDMETHOD') }));
  const fmDecl = fms.filter(x => x.fn).map(x => methodSignature(x.fn));
  const head = `CLASS ${cls} DEFINITION PUBLIC CREATE PUBLIC.\n  PUBLIC SECTION.\n`;
  const decls = `${[...fmDecl, ...formSigs].join('\n')}\nENDCLASS.\nCLASS ${cls} IMPLEMENTATION.\n`;
  const fmSrc = fms.map(x => ({ file: rel(x.f), src: x.src.replace(/^(\s*)FUNCTION\s+([\w/]+)\s*\./im, '$1METHOD $2.').replace(/^(\s*)ENDFUNCTION\b/im, '$1ENDMETHOD') }));
  const groupFile = rel(fms[0]?.f || files[0]);
  return {
    group: group.toLowerCase(), cls, functions: fms.filter(x => x.fn).map(x => x.fn.name),
    units: [{ src: head, file: groupFile }, ...topSrc, { src: decls, file: groupFile }, ...fmSrc, ...formSrc, { src: 'ENDCLASS.\n', file: groupFile }],
  };
}

const typing = p => (p.typ ? `${p.kind === 'TYPE REF TO' ? 'TYPE REF TO' : 'TYPE'} ${p.typ.toLowerCase()}` : 'TYPE any');
function methodSignature(fn) {
  const sec = (name, list, f) => (list?.length ? `\n      ${name} ${list.map(f).join(' ')}` : '');
  const opt = p => (p.default ? ` DEFAULT ${p.default}` : p.optional ? ' OPTIONAL' : '');
  // TABLES parameters are tables passed by reference: CHANGING, with the line type of STRUCTURE / LIKE / TYPE
  const tables = (fn.sections.TABLES || []).map(p => `${p.parameter.toLowerCase()} TYPE ${p.typ ? `STANDARD TABLE OF ${p.typ.toLowerCase()} WITH DEFAULT KEY` : 'STANDARD TABLE'}${p.optional ? ' OPTIONAL' : ''}`);
  const changing = [...(fn.sections.CHANGING || []).map(p => `${p.parameter.toLowerCase()} ${typing(p)}${opt(p)}`), ...tables];
  return `    CLASS-METHODS ${fn.name.toLowerCase()}`
    + sec('IMPORTING', fn.sections.IMPORTING, p => `${p.parameter.toLowerCase()} ${typing(p)}${opt(p)}`)
    + sec('EXPORTING', fn.sections.EXPORTING, p => `${p.parameter.toLowerCase()} ${typing(p)}`)
    + (changing.length ? `\n      CHANGING ${changing.join(' ')}` : '')
    + sec('EXCEPTIONS', fn.sections.EXCEPTIONS, p => p.parameter.toLowerCase()) + '.';
}
function formSignature(name, rest) {
  const params = [];
  const toks = rest.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  for (let k = 0; k < toks.length; k++) {
    const u = toks[k].toUpperCase();
    if (['TABLES', 'USING', 'CHANGING', 'RAISING'].includes(u)) { params.kind = u; continue; }
    if (params.kind === 'RAISING') continue;
    let p = toks[k].replace(/^VALUE\((.*)\)$/i, '$1').toLowerCase();
    let typ = params.kind === 'TABLES' ? 'STANDARD TABLE' : 'any';
    if (/^(TYPE|LIKE|STRUCTURE)$/i.test(toks[k + 1] || '')) {
      const kw = toks[k + 1].toUpperCase();
      if (/^REF$/i.test(toks[k + 2]) && /^TO$/i.test(toks[k + 3])) { typ = `REF TO ${toks[k + 4]}`; k += 4; }
      else { typ = params.kind === 'TABLES' || kw === 'STRUCTURE' ? `STANDARD TABLE OF ${toks[k + 2]} WITH DEFAULT KEY` : toks[k + 2]; k += 2; }
      if (kw === 'LIKE' && params.kind !== 'TABLES') typ = 'any';
    }
    params.push(`${p} TYPE ${typ}`);
  }
  return `    CLASS-METHODS ${name.toLowerCase()}${params.length ? `\n      CHANGING ${params.map(x => `${x} OPTIONAL`).join(' ')}` : ''}.`;
}
