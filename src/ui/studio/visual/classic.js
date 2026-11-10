// Source <-> model for the classic tools of the studio (pure functions, used by the node tests too):
//   - screens of a .prog.xml (DYNPROS): every element type of the screen painter (texts, input/output fields,
//     checkboxes, radio buttons, push buttons, frames, dropdowns), table controls and subscreen areas (containers);
//     tags the model does not know are kept as written
//   - flow logic templates (PBO / PAI, FIELD … MODULE … ON INPUT, CHAIN, LOOP WITH CONTROL, CALL SUBSCREEN, POV)
//   - the GUI status and titles (CUA): functions, function keys, application toolbar, menus
//   - text elements (TPOOL): title, text symbols, selection texts, list headings
//   - domains, data elements and table types (DD01V / DD04V / DD40V)
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = s => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const n3 = v => String(Number(v) || 0).padStart(3, '0');
const tag = (xml, t) => { const m = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(xml); return m ? m[1] : ''; };
// the leaf tags of a record in their order: [[tag, value]]
const leaves = rec => [...String(rec).matchAll(/<([A-Z0-9_]+)>([^<]*)<\/\1>/g)].map(m => [m[1], unesc(m[2])]);
const items = (xml, t) => [...String(xml || '').matchAll(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`, 'g'))].map(m => m[1]);
const block = (xml, t) => new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(xml)?.[1] ?? null;
// replaces (or adds before </asx:values>, or removes when text is empty) a top-level block of the values
function putBlock(xml, t, text, after = []) {
  const re = new RegExp(`[ \\t]*<${t}>[\\s\\S]*?</${t}>[ \\t]*\\n?`);
  if (re.test(xml)) return xml.replace(re, text ? `${text}\n` : '');
  if (!text) return xml;
  for (const a of after) { const m = new RegExp(`(</${a}>[ \\t]*\\n)`).exec(xml); if (m) return xml.slice(0, m.index + m[0].length) + `${text}\n` + xml.slice(m.index + m[0].length); }
  return xml.replace(/([ \t]*<\/asx:values>)/, `${text}\n$1`);
}

// ------------------------------------------------------------------ screens
const FIELD_ORDER = ['CONT_TYPE', 'CONT_NAME', 'TYPE', 'NAME', 'TEXT', 'DROPDOWN', 'LINE', 'COLUMN', 'LENGTH', 'VISLENGTH', 'HEIGHT', 'PUSH_FCODE', 'FORMAT', 'FROM_DICT', 'INPUT_FLD', 'OUTPUT_FLD', 'REQU_ENTRY', 'TC_HEADING'];
const KNOWN_FIELD = new Set(FIELD_ORDER);
const CONT_ORDER = ['TYPE', 'NAME', 'ELEMENT_OF', 'LINE', 'COLUMN', 'LENGTH', 'HEIGHT'];
export const ELEMENT_TYPES = { TEXT: 'Text', TEMPLATE: 'Input/output field', CHECK: 'Checkbox', RADIO: 'Radio button', PUSH: 'Push button', FRAME: 'Frame (box)', OKCODE: 'OK code field' };
export function parseScreens(xml) {
  const screens = [];
  const dyn = block(xml, 'DYNPROS');
  for (const item of dyn ? dyn.split(/<item>/).slice(1) : []) {
    const h = tag(item, 'HEADER');
    const containers = items(item, 'RPY_DYCATT').map(r => {
      const l = leaves(r), g = k => l.find(x => x[0] === k)?.[1] ?? '';
      return { type: g('TYPE'), name: g('NAME'), elementOf: g('ELEMENT_OF'), line: Number(g('LINE')) || 0, column: Number(g('COLUMN')) || 0, length: Number(g('LENGTH')) || 0, height: Number(g('HEIGHT')) || 0, other: l.filter(x => !CONT_ORDER.includes(x[0])) };
    });
    const fields = items(item, 'RPY_DYFATC').map(r => {
      const l = leaves(r), g = k => l.find(x => x[0] === k)?.[1] ?? '';
      const type = g('TYPE');
      return {
        type, name: g('NAME'), text: type === 'TEMPLATE' || type === 'OKCODE' ? '' : g('TEXT'), line: Number(g('LINE')) || 0, column: Number(g('COLUMN')) || 0,
        length: Number(g('LENGTH')) || 1, vislength: Number(g('VISLENGTH')) || 0, height: Number(g('HEIGHT')) || 1, format: g('FORMAT') || 'CHAR', input: g('INPUT_FLD') === 'X', output: g('OUTPUT_FLD') === 'X',
        required: g('REQU_ENTRY') === 'R', fcode: g('PUSH_FCODE'), dropdown: g('DROPDOWN'), heading: g('TC_HEADING') === 'X', contType: g('CONT_TYPE') || 'SCREEN', contName: g('CONT_NAME') || 'SCREEN',
        tags: l.map(x => x[0]), other: l.filter(x => !KNOWN_FIELD.has(x[0])),
      };
    });
    screens.push({ screen: tag(h, 'SCREEN'), descript: unesc(tag(h, 'DESCRIPT')), type: tag(h, 'TYPE') || 'N', next: tag(h, 'NEXTSCREEN'), lines: Number(tag(h, 'LINES')) || 24, columns: Number(tag(h, 'COLUMNS')) || 80, containers, fields });
  }
  return { program: tag(block(xml, 'PROGDIR') || '', 'NAME') || tag(xml, 'NAME'), subc: tag(xml, 'SUBC'), screens };
}
function fieldXml(f) {
  const v = {
    CONT_TYPE: f.contType || 'SCREEN', CONT_NAME: f.contName || 'SCREEN', TYPE: f.type, NAME: f.name,
    TEXT: f.type === 'TEMPLATE' || f.type === 'OKCODE' ? '_'.repeat(Math.max(1, f.length)) : f.text, DROPDOWN: f.dropdown || '',
    LINE: f.type === 'OKCODE' ? '' : n3(f.line), COLUMN: f.type === 'OKCODE' ? '' : n3(f.column), LENGTH: n3(f.length), VISLENGTH: n3(f.vislength || f.length), HEIGHT: n3(f.height || 1),
    PUSH_FCODE: f.type === 'PUSH' ? f.fcode || '' : '', FORMAT: f.format || 'CHAR', FROM_DICT: '',
    INPUT_FLD: f.input ? 'X' : '', OUTPUT_FLD: f.output ? 'X' : '', REQU_ENTRY: f.required ? 'R' : '', TC_HEADING: f.heading ? 'X' : '',
  };
  for (const [k, x] of f.other || []) if (!(k in v)) v[k] = x;
  // the tags in the order SAP writes them (the known ones), the others after them as they were
  const order = [...FIELD_ORDER, ...(f.other || []).map(x => x[0])];
  return `      <RPY_DYFATC>\n${order.filter((k, i) => order.indexOf(k) === i && v[k] !== '' && v[k] !== undefined).map(k => `       <${k}>${esc(v[k])}</${k}>`).join('\n')}\n      </RPY_DYFATC>`;
}
function containerXml(c) {
  const v = { TYPE: c.type, NAME: c.name, ELEMENT_OF: c.elementOf || '', LINE: c.line ? n3(c.line) : '', COLUMN: c.column ? n3(c.column) : '', LENGTH: c.length ? n3(c.length) : '', HEIGHT: c.height ? n3(c.height) : '' };
  return `      <RPY_DYCATT>\n${[...CONT_ORDER.filter(k => v[k]).map(k => `       <${k}>${esc(v[k])}</${k}>`), ...(c.other || []).map(([k, x]) => `       <${k}>${esc(x)}</${k}>`)].join('\n')}\n      </RPY_DYCATT>`;
}
export function writeScreens(xml, model) {
  const out = model.screens.map(s => {
    const conts = s.containers?.length ? s.containers : [{ type: 'SCREEN', name: 'SCREEN' }];
    return `    <item>
     <HEADER>
      <PROGRAM>${esc(model.program)}</PROGRAM>
      <SCREEN>${esc(s.screen)}</SCREEN>
      <LANGUAGE>E</LANGUAGE>
      <DESCRIPT>${esc(s.descript)}</DESCRIPT>
      <TYPE>${esc(s.type || 'N')}</TYPE>
      <NEXTSCREEN>${esc(s.next || s.screen)}</NEXTSCREEN>
      <LINES>${n3(s.lines)}</LINES>
      <COLUMNS>${n3(s.columns)}</COLUMNS>
     </HEADER>
     <CONTAINERS>
${conts.map(containerXml).join('\n')}
     </CONTAINERS>
     <FIELDS>
${s.fields.map(fieldXml).join('\n')}
     </FIELDS>
    </item>`;
  }).join('\n');
  return putBlock(xml, 'DYNPROS', model.screens.length ? `   <DYNPROS>\n${out}\n   </DYNPROS>` : '', ['PROGDIR']);
}
// a table control over an internal table: the container and a heading + an input/output field per column
export function tableControl({ name, line, column, width = 78, height = 8, wa, columns, input = true }) {
  const cont = { type: 'TABLE_CTRL', name, elementOf: 'SCREEN', line, column, length: width, height,
    other: [['C_SCROLL_V', 'X'], ['C_SCROLL_H', 'X'], ['TC_TABTYPE', 'ENTRY'], ['TC_SEPAR_V', 'X'], ['TC_SEPAR_H', 'X'], ['TC_HEADER', 'X'], ['TC_SEL_LNS', 'NONE'], ['TC_SEL_CLS', 'NONE']] };
  const fields = [];
  columns.forEach((c, i) => {
    const head = String(c.label || c.name);
    // the column is as wide as the field's output length and its heading (and a character for the cell's frame):
    // EBELP NUMC 5 under "Item" shows all five digits; the field keeps its own length (what can be typed)
    const len = Math.max(1, Math.min(60, c.length || 10));
    const width = Math.min(60, Math.max(len, head.length) + 1);
    fields.push({ type: 'TEXT', name: `HEAD_${c.name}`.toUpperCase().slice(0, 30), text: head, line: 1, column: i + 1, length: Math.max(1, head.length), format: 'CHAR', heading: true, contType: 'TABLE_CTRL', contName: name, other: [] });
    fields.push({ type: 'TEMPLATE', name: `${wa}-${c.name}`.toUpperCase(), text: '', line: 1, column: i + 1, length: len, vislength: width, format: c.format || 'CHAR', input: input && !c.readOnly, output: true, contType: 'TABLE_CTRL', contName: name, other: [] });
  });
  return { container: cont, fields };
}
// ABAP declarations and modules a new table control needs in its program
// tableType: a table type of the app with this line type (compatible with method / FM parameters typed with it)
export function tableControlCode({ name, table, wa, lineType, screen, spare = 10, tableType }) {
  const n = name.toLowerCase(), t = table.toLowerCase(), w = wa.toLowerCase();
  const mod = `modify_${n}`.slice(0, 30), lin = `${n}_lines`.slice(0, 30);
  return {
    decl: `CONTROLS ${n} TYPE TABLEVIEW USING SCREEN ${screen}.\nDATA ${t} TYPE ${tableType ? tableType.toLowerCase() : `STANDARD TABLE OF ${lineType.toLowerCase()} WITH DEFAULT KEY`}.\nDATA ${w} TYPE ${lineType.toLowerCase()}.\n\n`,
    modules: `
* table control ${name.toUpperCase()}: the rows of ${t} and ${spare} empty rows for new entries
MODULE ${lin} OUTPUT.
  ${n}-lines = lines( ${t} ) + ${spare}.
ENDMODULE.

* a changed row back into ${t}; a row typed into an empty line is added
MODULE ${mod} INPUT.
  IF ${n}-current_line > lines( ${t} ).
    IF ${w} IS NOT INITIAL.
      APPEND ${w} TO ${t}.
    ENDIF.
  ELSE.
    MODIFY ${t} FROM ${w} INDEX ${n}-current_line.
  ENDIF.
ENDMODULE.
`,
    pbo: `  MODULE ${lin}.\n  LOOP AT ${t} INTO ${w} WITH CONTROL ${n}\n    CURSOR ${n}-current_line.\n  ENDLOOP.`,
    // PAI: the rows first (before the module that handles the function code and clears it)
    pai: `  LOOP AT ${t}.\n    MODULE ${mod}.\n  ENDLOOP.`,
  };
}

// a tabstrip: the strip (STRIP_CTRL), a subscreen area in it, a push button per tab (its function code switches the
// tab) and a subscreen (type I) per tab; screens: the numbers of the tabs' subscreens
export function tabstrip({ name, line, column, width = 70, height = 8, tabs, screens, program }) {
  const N = name.toUpperCase(), area = `SUB_${N}`.slice(0, 30);
  const container = { type: 'STRIP_CTRL', name: N, elementOf: 'SCREEN', line, column, length: width, height, other: [] };
  const sub = { type: 'SUBSCREEN', name: area, elementOf: N, line: line + 2, column: column + 1, length: Math.max(10, width - 2), height: Math.max(1, height - 3), other: [] };
  const fields = tabs.map((t, i) => ({ type: 'PUSH', name: tabCode(N, i), text: t, line: 1, column: i + 1, length: Math.max(6, Math.min(20, t.length + 2)), height: 1, format: 'CHAR', fcode: tabCode(N, i), contType: 'STRIP_CTRL', contName: N, other: [] }));
  const subscreens = tabs.map((t, i) => ({ screen: screens[i], descript: t, type: 'I', next: screens[i], lines: Math.max(1, height - 3), columns: Math.max(10, width - 2), containers: [{ type: 'SCREEN', name: 'SCREEN', other: [] }],
    fields: [{ type: 'TEXT', name: `LBL_${screens[i]}`, text: `${t}: add the fields of this tab`, line: 1, column: 1, length: Math.min(60, t.length + 28), height: 1, format: 'CHAR', contType: 'SCREEN', contName: 'SCREEN', other: [] }] }));
  void program;
  return { container, area: sub, fields, subscreens };
}
export const tabCode = (strip, i) => `${strip.toUpperCase().slice(0, 25)}_T${i + 1}`;
// the program's part of a tabstrip: CONTROLS, the shown subscreen, the first tab at PBO, the tab function codes at PAI
export function tabstripCode({ name, tabs, screens, okcode = 'gv_ok_code' }) {
  const n = name.toLowerCase(), dyn = `gv_${n}_dynnr`.slice(0, 30), area = `sub_${n}`.slice(0, 30);
  const init = `${n}_init`.slice(0, 30), tab = `${n}_tabs`.slice(0, 30);
  return {
    decl: `CONTROLS ${n} TYPE TABSTRIP.\nDATA ${dyn} TYPE sy-dynnr VALUE '${screens[0]}'.\n\n`,
    modules: `\n* tabstrip ${name.toUpperCase()}: the first tab, then the tab the user chose (its function code)\nMODULE ${init} OUTPUT.\n  IF ${n}-activetab IS INITIAL.\n    ${n}-activetab = '${tabCode(name, 0)}'.\n    ${dyn} = '${screens[0]}'.\n  ENDIF.\nENDMODULE.\n\nMODULE ${tab} INPUT.\n  CASE ${okcode.toLowerCase()}.\n${tabs.map((t, i) => `    WHEN '${tabCode(name, i)}'.\n      ${n}-activetab = '${tabCode(name, i)}'.\n      ${dyn} = '${screens[i]}'.`).join('\n')}\n  ENDCASE.\nENDMODULE.\n`,
    pbo: `  MODULE ${init}.\n  CALL SUBSCREEN ${area} INCLUDING sy-repid ${dyn}.`,
    pai: `  CALL SUBSCREEN ${area}.\n  MODULE ${tab}.`,
  };
}

// ------------------------------------------------------------------ flow logic
export const FLOW_TEMPLATES = [
  ['module', 'MODULE', 'pai', m => `  MODULE ${m || 'user_command_0100'}.`],
  ['exit', 'MODULE … AT EXIT-COMMAND', 'pai', m => `  MODULE ${m || 'exit_0100'} AT EXIT-COMMAND.`],
  ['field', 'FIELD … MODULE … ON INPUT', 'pai', m => `  FIELD gv_field MODULE ${m || 'check_field'} ON INPUT.`],
  ['request', 'FIELD … MODULE … ON REQUEST', 'pai', m => `  FIELD gv_field MODULE ${m || 'check_field'} ON REQUEST.`],
  ['chain', 'CHAIN … ENDCHAIN', 'pai', m => `  CHAIN.\n    FIELD: gv_field1, gv_field2.\n    MODULE ${m || 'check_fields'} ON CHAIN-REQUEST.\n  ENDCHAIN.`],
  ['loop', 'LOOP AT … WITH CONTROL', 'pbo', () => '  LOOP AT gt_items INTO gs_item WITH CONTROL tc_items\n    CURSOR tc_items-current_line.\n  ENDLOOP.'],
  ['subscreen', 'CALL SUBSCREEN', 'pbo', () => "  CALL SUBSCREEN sub_area INCLUDING sy-repid '0200'."],
  ['pov', 'PROCESS ON VALUE-REQUEST (F4)', 'pov', m => `  FIELD gv_field MODULE ${m || 'f4_field'}.`],
];
// adds a template to a part of the flow logic (PBO / PAI / POV: created when missing)
export function addToFlow(text, part, snippet, at = 'end') {
  let t = String(text || 'PROCESS BEFORE OUTPUT.\n\nPROCESS AFTER INPUT.\n').replace(/\s*$/, '\n');
  const heads = { pbo: /^PROCESS\s+BEFORE\s+OUTPUT\s*\./im, pai: /^PROCESS\s+AFTER\s+INPUT\s*\./im, pov: /^PROCESS\s+ON\s+VALUE-REQUEST\s*\./im };
  if (!heads[part].test(t)) t += `\n${{ pbo: 'PROCESS BEFORE OUTPUT.', pai: 'PROCESS AFTER INPUT.', pov: 'PROCESS ON VALUE-REQUEST.' }[part]}\n`;
  const start = heads[part].exec(t);
  const rest = t.slice(start.index + start[0].length);
  const next = /^\s*PROCESS\s+/im.exec(rest);
  // at the start of the part (after MODULE … AT EXIT-COMMAND): before modules that use and clear the OK code
  if (at === 'start') {
    const lines = rest.split('\n');
    let k = 1;
    while (k < lines.length && (/AT\s+EXIT-COMMAND/i.test(lines[k]) || !lines[k].trim()) && !/^\s*PROCESS\s/i.test(lines[k])) k++;
    while (k > 1 && !lines[k - 1].trim()) k--;
    lines.splice(k, 0, snippet);
    return t.slice(0, start.index + start[0].length) + lines.join('\n');
  }
  const endAt = start.index + start[0].length + (next ? next.index : rest.length);
  const body = t.slice(0, endAt).replace(/\s*$/, '');
  return `${body}\n${snippet}\n${next ? `\n${t.slice(endAt).replace(/^\s*/, '')}` : ''}`.replace(/\n{3,}/g, '\n\n');
}
// the modules a flow logic calls: [{ name, kind: 'output' | 'input' }]
export function flowModules(text) {
  const out = [];
  let part = 'pbo';
  for (const line of String(text || '').split('\n')) {
    if (/^\s*PROCESS\s+BEFORE\s+OUTPUT/i.test(line)) part = 'pbo';
    else if (/^\s*PROCESS\s+(AFTER\s+INPUT|ON\s+VALUE-REQUEST|ON\s+HELP-REQUEST)/i.test(line)) part = 'pai';
    for (const m of line.matchAll(/\bMODULE\s+(\w+)/gi)) if (!out.some(x => x.name === m[1].toLowerCase())) out.push({ name: m[1].toLowerCase(), kind: part === 'pbo' ? 'output' : 'input' });
  }
  return out;
}
// MODULE … OUTPUT / INPUT stubs for the modules the program does not have yet
export function missingModules(flow, program) {
  const has = new Set([...String(program || '').matchAll(/^\s*MODULE\s+(\w+)\s+(?:OUTPUT|INPUT)\s*\./gim)].map(m => m[1].toLowerCase()));
  return flowModules(flow).filter(m => !has.has(m.name));
}
export const moduleStub = m => `\nMODULE ${m.name} ${m.kind === 'output' ? 'OUTPUT' : 'INPUT'}.\n${m.kind === 'output' && /^status/.test(m.name) ? "  SET PF-STATUS 'MAIN'.\n  SET TITLEBAR 'MAIN'.\n" : /exit/.test(m.name) ? '  LEAVE TO SCREEN 0.\n' : ''}ENDMODULE.\n`;

// ------------------------------------------------------------------ GUI status and titles (CUA)
// { statuses: [{ code, text, modal, keys: { '03': 'BACK' … }, toolbar: ['SAVE', '-', 'RELEASE'] }], functions: [{ code, text,
//   icon, iconText, exit }], menus: [{ text, items: ['SAVE', '-', 'BACK'] }], titles: [{ code, text }] }
export const STANDARD_KEYS = [['11', 'Save (Ctrl+S)'], ['03', 'Back (F3)'], ['15', 'Exit (Shift+F3)'], ['12', 'Cancel (F12)'], ['21', 'First page'], ['22', 'Previous page'], ['23', 'Next page'], ['24', 'Last page'], ['14', 'Delete (Shift+F2)'], ['13', 'Print (Ctrl+P)'], ['71', 'Find (Ctrl+F)']];
export const FREE_KEYS = [['05', 'F5'], ['06', 'F6'], ['07', 'F7'], ['08', 'F8'], ['09', 'F9'], ['17', 'Shift+F5'], ['18', 'Shift+F6'], ['19', 'Shift+F7'], ['20', 'Shift+F8'], ['16', 'Shift+F4'], ['25', 'Ctrl+F1'], ['26', 'Ctrl+F2']];
export const ICONS = ['', 'ICON_SYSTEM_SAVE', 'ICON_CREATE', 'ICON_CHANGE', 'ICON_DISPLAY', 'ICON_DELETE', 'ICON_EXECUTE_OBJECT', 'ICON_REFRESH', 'ICON_PRINT', 'ICON_CHECK', 'ICON_RELEASE', 'ICON_OKAY', 'ICON_CANCEL', 'ICON_INSERT_ROW', 'ICON_DELETE_ROW', 'ICON_SELECT_ALL', 'ICON_DESELECT_ALL', 'ICON_SEARCH', 'ICON_EXPORT', 'ICON_PDF', 'ICON_MAIL', 'ICON_LOCKED', 'ICON_UNLOCKED', 'ICON_COPY_OBJECT', 'ICON_DETAIL', 'ICON_OVERVIEW'];
export function parseCua(xml) {
  const cua = block(xml, 'CUA');
  const m = { statuses: [], functions: [], menus: [], titles: [] };
  if (cua === null) return m;
  const rec = (sec, it) => items(block(cua, sec) || '', it).map(r => Object.fromEntries(leaves(r)));
  const funs = rec('FUN', 'RSMPE_FUNT'), pfk = rec('PFK', 'RSMPE_PFK'), but = rec('BUT', 'RSMPE_BUT'), staf = rec('SET', 'RSMPE_STAF');
  for (const f of funs) if (!m.functions.some(x => x.code === f.CODE)) m.functions.push({ code: f.CODE, text: f.FUN_TEXT || '', icon: f.TEXT_NAME || '', iconText: f.ICON_TEXT || '', exit: f.TYPE === 'E' });
  for (const s of rec('STA', 'RSMPE_STAT')) {
    const keys = Object.fromEntries(pfk.filter(p => p.CODE === s.PFKCODE && p.FUNCODE).map(p => [p.PFNO, p.FUNCODE]));
    const toolbar = but.filter(b => b.PFK_CODE === s.PFKCODE).sort((a, b) => Number(a.NO) - Number(b.NO)).map(b => (String(b.PFNO).toUpperCase() === 'S' ? '-' : keys[b.PFNO] || '')).filter(Boolean);
    m.statuses.push({ code: s.CODE, text: s.INT_NOTE || '', modal: s.MODAL || 'D', keys, toolbar, assigned: staf.filter(x => x.STATUS === s.CODE).map(x => x.FUNCTION) });
  }
  const mtx = rec('MTX', 'RSMPE_MNLT'), men = rec('MEN', 'RSMPE_MEN');
  for (const t of mtx) m.menus.push({ code: t.CODE, text: t.TEXT || '', items: men.filter(x => x.CODE === t.CODE).sort((a, b) => Number(a.NO) - Number(b.NO)).map(x => (x.REF_TYPE === 'S' ? '-' : x.REF_CODE)) });
  m.titles = rec('TIT', 'RSMPE_TITT').map(t => ({ code: t.CODE, text: t.TEXT || '' }));
  return m;
}
const recXml = (t, o, ind = '     ') => `${ind}<${t}>\n${Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => `${ind} <${k}>${esc(v)}</${k}>`).join('\n')}\n${ind}</${t}>`;
// the application toolbar's buttons need function keys: functions without one get a free key (F13…F48 range)
export function writeCua(xml, m) {
  if (!m.statuses.length && !m.functions.length && !m.titles.length) return putBlock(xml, 'CUA', '');
  const sta = [], pfk = [], but = [], staf = [], act = [];
  m.statuses.forEach((s, i) => {
    const code = String(i + 1).padStart(6, '0');
    const keys = { ...s.keys };
    const keyOf = f => Object.entries(keys).find(([, c]) => c === f)?.[0];
    for (const f of s.toolbar.filter(x => x !== '-')) if (!keyOf(f)) { let n = 27; while (keys[String(n).padStart(2, '0')]) n++; keys[String(n).padStart(2, '0')] = f; }
    sta.push(recXml('RSMPE_STAT', { CODE: s.code, MODAL: s.modal || 'D', ACTCODE: code, PFKCODE: code, BUTCODE: String(i + 1).padStart(4, '0'), INT_NOTE: s.text }));
    for (const [pf, f] of Object.entries(keys).sort()) if (f) pfk.push(recXml('RSMPE_PFK', { CODE: code, PFNO: pf, FUNCODE: f, FUNNO: '001' }));
    let no = 0;
    for (const f of s.toolbar) but.push(recXml('RSMPE_BUT', { PFK_CODE: code, CODE: String(i + 1).padStart(4, '0'), NO: String(++no).padStart(2, '0'), PFNO: f === '-' ? 'S' : keyOf(f) || Object.entries(keys).find(([, c]) => c === f)[0] }));
    const used = new Set([...Object.values(keys), ...s.toolbar.filter(x => x !== '-'), ...m.menus.flatMap(x => x.items.filter(y => y !== '-')), ...(s.assigned || []).filter(f => m.functions.some(x => x.code === f))]);
    for (const f of m.functions) if (used.has(f.code)) staf.push(recXml('RSMPE_STAF', { STATUS: s.code, FUNCTION: f.code }));
    m.menus.forEach((x, j) => act.push(recXml('RSMPE_ACT', { CODE: code, NO: String(j + 1).padStart(2, '0'), MENUCODE: x.code || String(j + 1).padStart(6, '0') })));
  });
  const fun = m.functions.map(f => recXml('RSMPE_FUNT', { CODE: f.code, TEXTNO: '001', TYPE: f.exit ? 'E' : '', TEXT_TYPE: 'S', TEXT_NAME: f.icon || '', ICON_TEXT: f.icon ? f.iconText || f.text : '', FUN_TEXT: f.text }));
  const men = [], mtx = [];
  m.menus.forEach((x, j) => {
    const code = x.code || String(j + 1).padStart(6, '0');
    mtx.push(recXml('RSMPE_MNLT', { CODE: code, TEXTNO: '001', TEXT: x.text }));
    x.items.forEach((it, k) => men.push(recXml('RSMPE_MEN', { CODE: code, NO: String(k + 1).padStart(2, '0'), REF_TYPE: it === '-' ? 'S' : 'F', REF_CODE: it === '-' ? '' : it, REF_NO: it === '-' ? '' : '001' })));
  });
  const tit = m.titles.map(t => recXml('RSMPE_TITT', { CODE: t.code, TEXT: t.text }));
  const sec = (t, list) => (list.length ? `    <${t}>\n${list.join('\n')}\n    </${t}>\n` : '');
  const text = `   <CUA>\n    <ADM>\n     <ACTCODE>000001</ACTCODE>\n     <PFKCODE>000001</PFKCODE>\n    </ADM>\n${sec('STA', sta)}${sec('FUN', fun)}${sec('MEN', men)}${sec('MTX', mtx)}${sec('ACT', act)}${sec('BUT', but)}${sec('PFK', pfk)}${sec('SET', staf)}${sec('TIT', tit)}   </CUA>`;
  return putBlock(xml, 'CUA', text, ['DYNPROS', 'PROGDIR']);
}
// what SET PF-STATUS / SET TITLEBAR in a program name
export const statusesUsed = src => [...new Set([...String(src || '').matchAll(/SET\s+PF-STATUS\s+'([^']+)'/gi)].map(m => m[1].toUpperCase()))];
export const titlesUsed = src => [...new Set([...String(src || '').matchAll(/SET\s+TITLEBAR\s+'([^']+)'/gi)].map(m => m[1].toUpperCase()))];

// ------------------------------------------------------------------ text elements (TPOOL)
// { title, symbols: [{ key: '001', text, length }], selections: [{ key: 'P_EBELN', text }], headings: [{ key, text }] }
export function parseTpool(xml) {
  const t = { title: '', symbols: [], selections: [], headings: [] };
  for (const r of items(block(xml, 'TPOOL') || '', 'item')) {
    const o = Object.fromEntries(leaves(r));
    if (o.ID === 'R') t.title = o.ENTRY || '';
    else if (o.ID === 'I') t.symbols.push({ key: o.KEY || '', text: o.ENTRY || '', length: Number(o.LENGTH) || (o.ENTRY || '').length });
    else if (o.ID === 'S') t.selections.push({ key: o.KEY || '', text: String(o.ENTRY || '').replace(/^ {8}/, '').replace(/^D {7}\.?$/, ''), ddic: /^D {7}/.test(o.ENTRY || '') });
    else if (o.ID === 'H') t.headings.push({ key: o.KEY || '', text: o.ENTRY || '' });
  }
  return t;
}
export function writeTpool(xml, t) {
  const row = (id, key, entry, len) => `    <item>\n     <ID>${id}</ID>${key !== null ? `\n     <KEY>${esc(key)}</KEY>` : ''}\n     <ENTRY>${esc(entry)}</ENTRY>\n     <LENGTH>${len}</LENGTH>\n    </item>`;
  const rows = [];
  if (t.title) rows.push(row('R', null, t.title, Math.min(70, t.title.length)));
  for (const h of t.headings.filter(x => x.text)) rows.push(row('H', h.key || '001', h.text, h.text.length));
  for (const s of t.symbols.filter(x => x.key)) rows.push(row('I', String(s.key).padStart(3, '0'), s.text, Math.max(Number(s.length) || 0, s.text.length)));
  // a dictionary reference is only the marker (the label comes from the data element), never a text in its place
  for (const s of t.selections.filter(x => x.key && (x.text || x.ddic))) rows.push(row('S', String(s.key).toUpperCase(), s.ddic ? 'D       .' : `        ${s.text}`, s.ddic ? 9 : s.text.length + 8));
  return putBlock(xml, 'TPOOL', rows.length ? `   <TPOOL>\n${rows.join('\n')}\n   </TPOOL>` : '', ['CUA', 'DYNPROS', 'PROGDIR']);
}
// the selection screen elements and TEXT-nnn symbols of a program source
export function selectionNames(src) { return [...new Set([...String(src || '').matchAll(/^\s*(?:PARAMETERS|PARAMETER|SELECT-OPTIONS)\s*:?\s*([\w]+)/gim)].map(m => m[1].toUpperCase()))]; }
export function textSymbolsUsed(src) { return [...new Set([...String(src || '').matchAll(/\btext-(\w{3})\b/gi)].map(m => m[1].toUpperCase()))].sort(); }
// the data element of a selection parameter: PARAMETERS p TYPE zdtel / SELECT-OPTIONS s FOR tab-field
export function selectionType(src, name) {
  const re = new RegExp(`^\\s*(?:PARAMETERS|PARAMETER|SELECT-OPTIONS)\\s*:?\\s*${name}\\b([^.]*)\\.`, 'im');
  const m = re.exec(String(src || ''));
  if (!m) return null;
  const t = /\bTYPE\s+([\w/]+(?:-[\w/]+)?)/i.exec(m[1]) || /\bFOR\s+([\w/]+-[\w/]+)/i.exec(m[1]) || /\bLIKE\s+([\w/]+-[\w/]+)/i.exec(m[1]);
  return t ? t[1].toLowerCase() : null;
}

// ------------------------------------------------------------------ domains, data elements, table types (abapGit XML)
// a flat section (DD01V …): tag -> value; set writes the tags (empty: removed) in place, new ones before the end
export function getTags(xml, section) { const b = block(xml, section); return b === null ? null : Object.fromEntries(leaves(b)); }
export function setTags(xml, section, values) {
  const b = block(xml, section);
  if (b === null) return xml;
  let body = b;
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`\\n?[ \\t]*<${k}>[^<]*</${k}>`);
    if (v === '' || v === null || v === undefined || v === false) body = body.replace(re, '');
    else if (re.test(body)) body = body.replace(re, m => m.replace(/>[^<]*</, `>${esc(v === true ? 'X' : v)}<`));
    else body = body.replace(/(\n?[ \t]*)$/, `\n    <${k}>${esc(v === true ? 'X' : v)}</${k}>$1`);
  }
  return xml.replace(`<${section}>${b}</${section}>`, `<${section}>${body}</${section}>`);
}
const num6 = v => String(Math.max(0, Number(v) || 0)).padStart(6, '0');
export function parseDomaXml(xml) {
  const d = getTags(xml, 'DD01V') || {};
  const fixed = items(block(xml, 'DD07V_TAB') || '', 'DD07V').map(r => { const o = Object.fromEntries(leaves(r)); return { low: o.DOMVALUE_L || '', high: o.DOMVALUE_H || '', text: o.DDTEXT || '' }; });
  return { name: d.DOMNAME || '', text: d.DDTEXT || '', datatype: d.DATATYPE || 'CHAR', length: Number(d.LENG) || 0, decimals: Number(d.DECIMALS) || 0, outputlen: Number(d.OUTPUTLEN) || 0, lowercase: d.LOWERCASE === 'X', sign: d.SIGNFLAG === 'X', valueTable: d.ENTITYTAB || '', convexit: d.CONVEXIT || '', fixed };
}
export function writeDomaXml(xml, m) {
  let x = setTags(xml, 'DD01V', { DDTEXT: m.text, DATATYPE: m.datatype, LENG: num6(m.length), OUTPUTLEN: num6(m.outputlen || m.length), DECIMALS: m.decimals ? num6(m.decimals) : '', LOWERCASE: m.lowercase, SIGNFLAG: m.sign, VALEXI: m.fixed.length ? 'X' : '', ENTITYTAB: String(m.valueTable || '').toUpperCase(), CONVEXIT: m.convexit });
  const vals = m.fixed.filter(v => v.low !== '' || v.text);
  const tab = vals.length ? `   <DD07V_TAB>\n${vals.map((v, i) => `    <DD07V>\n     <DOMNAME>${esc(m.name)}</DOMNAME>\n     <VALPOS>${String(i + 1).padStart(4, '0')}</VALPOS>\n     <DDLANGUAGE>E</DDLANGUAGE>\n     <DOMVALUE_L>${esc(v.low)}</DOMVALUE_L>${v.high ? `\n     <DOMVALUE_H>${esc(v.high)}</DOMVALUE_H>` : ''}\n     <DDTEXT>${esc(v.text)}</DDTEXT>\n    </DD07V>`).join('\n')}\n   </DD07V_TAB>` : '';
  x = putBlock(x, 'DD07V_TAB', tab, ['DD01V']);
  return x;
}
export function parseDtelXml(xml) {
  const d = getTags(xml, 'DD04V') || {};
  return { name: d.ROLLNAME || '', text: d.DDTEXT || '', domain: d.DOMNAME || '', datatype: d.DATATYPE || 'CHAR', length: Number(d.LENG) || 0, decimals: Number(d.DECIMALS) || 0,
    short: d.SCRTEXT_S || '', medium: d.SCRTEXT_M || '', long: d.SCRTEXT_L || '', heading: d.REPTEXT || '' };
}
export function writeDtelXml(xml, m) {
  const dom = String(m.domain || '').trim().toUpperCase();
  return setTags(xml, 'DD04V', {
    DDTEXT: m.text, DOMNAME: dom, REFKIND: dom ? 'D' : '', DATATYPE: dom ? '' : m.datatype, LENG: dom ? '' : num6(m.length), DECIMALS: dom ? '' : num6(m.decimals),
    HEADLEN: String(Math.max(1, (m.heading || '').length)).padStart(2, '0'), SCRLEN1: '10', SCRLEN2: '20', SCRLEN3: '40',
    REPTEXT: m.heading, SCRTEXT_S: m.short, SCRTEXT_M: m.medium, SCRTEXT_L: m.long,
  });
}
export function parseTtypXml(xml) {
  const d = getTags(xml, 'DD40V') || {};
  return { name: d.TYPENAME || '', text: d.DDTEXT || '', rowtype: d.ROWTYPE || '', rowkind: d.ROWKIND || '', datatype: d.DATATYPE || '', length: Number(d.LENG) || 0, decimals: Number(d.DECIMALS) || 0, access: d.ACCESSMODE || 'T', keydef: d.KEYDEF || 'D', keykind: d.KEYKIND || 'N' };
}
export function writeTtypXml(xml, m) {
  const builtin = !m.rowtype;
  return setTags(xml, 'DD40V', { DDTEXT: m.text, ROWTYPE: String(m.rowtype || '').toUpperCase(), ROWKIND: builtin ? '' : m.rowkind || 'S', DATATYPE: builtin ? m.datatype : m.rowkind === 'E' ? 'CHAR' : 'STRU', LENG: builtin ? num6(m.length) : '', DECIMALS: builtin && m.decimals ? num6(m.decimals) : '', ACCESSMODE: m.access, KEYDEF: m.keydef, KEYKIND: m.access === 'H' ? 'U' : m.keykind || 'N' });
}

// declarations into a program: after the PROGRAM / REPORT statement and the comment lines that follow it; the
// statements a declaration of the same variable already exists for are left out
export function insertDeclarations(src, decl) {
  const lines = String(decl).split('\n').filter(l => {
    const m = /^\s*(?:DATA|CONTROLS|TABLES)\s+(\w+)/i.exec(l);
    return !m || !new RegExp(`^\\s*(?:DATA|CONTROLS|TABLES|CLASS-DATA)\\s*:?\\s+${m[1]}\\b`, 'im').test(src);
  });
  const text = lines.join('\n').replace(/^\n+/, '');
  if (!text.trim()) return src;
  const at = /^\s*(PROGRAM|REPORT)\b[^.]*\.[^\n]*\n/im.exec(src);
  if (!at) return `${text.replace(/\n*$/, '\n\n')}${src}`;
  let pos = at.index + at[0].length;
  const rest = src.slice(pos).split('\n');
  let k = 0;
  while (k < rest.length - 1 && (/^\s*$/.test(rest[k]) || /^\s*[*"]/.test(rest[k]))) k++;
  pos += rest.slice(0, k).join('\n').length + (k ? 1 : 0);
  return `${src.slice(0, pos)}${text.replace(/\n*$/, '\n\n')}${src.slice(pos)}`;
}

// a flow-logic snippet after a line (1-based) of the text
export function insertAtLine(text, line, snippet) {
  const lines = String(text || '').split('\n');
  const at = Math.max(0, Math.min(lines.length, line));
  lines.splice(at, 0, snippet);
  return lines.join('\n');
}
