// A starter Adobe XDP layout for a form data provider (like a new form in Adobe LiveCycle Designer with the data
// connection of ADT's Download Schema): A4, a title and "Page n of m" on the master page, the leading entity's
// elements as captioned fields, to-one associations as sections, to-many associations as tables (header row,
// one row per record, header repeated on every page). The bindings are SAP's ($.Alias.Element …), so the layout
// renders the same in RAP Studio and on SAP BTP; open it in Adobe LiveCycle Designer to refine the design.
import { assocName } from '../../abap/forms-apis.js';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const words = s => String(s).replace(/^_+/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const pictureOf = f => (f?.ti?.t === 'd' ? 'date{DD.MM.YYYY}' : f?.ti?.t === 't' ? 'time{HH:MM}' : f?.ti?.t === 'p' && f.ti.dec ? `num{z,zzz,zzz,zz9.${'9'.repeat(Math.min(f.ti.dec, 6))}}` : null);
const isTech = f => f.isAssoc || /^(client|mandt)$/i.test(f.name) || /uuid|^(created|last_?changed|local_last)/i.test(f.name) || f.ti?.t === 'raw' || f.ti?.t === 'rawstring' || f.ti?.t === 'xstring';

function field(f, ref, { x = 0, w = 180, capW = 50, h = 7, grow = false } = {}) {
  const pic = pictureOf(f);
  const ui = f.ti?.t === 'd' || f.ti?.t === 't' ? 'dateTimeEdit' : f.ti?.t === 'p' || f.ti?.t === 'i' || f.ti?.t === 'int8' ? 'numericEdit' : 'textEdit';
  const val = f.ti?.t === 'd' ? '<date/>' : f.ti?.t === 't' ? '<time/>' : f.ti?.t === 'p' ? `<decimal fracDigits="${f.ti.dec ?? 2}"/>` : f.ti?.t === 'i' || f.ti?.t === 'int8' ? '<integer/>' : '<text/>';
  return `<field name="${esc(f.label || f.name)}" x="${x}mm" w="${w}mm" ${grow ? `minH="${h}mm"` : `h="${h}mm"`} access="readOnly">
  <ui><${ui}${grow && ui === 'textEdit' ? ' multiLine="1"' : ''}><border presence="hidden"/><margin/></${ui}></ui>
  <font typeface="Arial" size="9pt"/>
  <margin topInset="0.5mm" bottomInset="0.5mm" leftInset="1mm" rightInset="1mm"/>
  <para vAlign="middle"/>
  <caption reserve="${capW}mm"><font typeface="Arial" size="9pt" weight="bold"/><para vAlign="middle"/><value><text>${esc(f.caption || words(f.label || f.name))}</text></value></caption>
  <value>${val}</value>${pic ? `\n  <format><picture>${pic}</picture></format>` : ''}
  <bind match="dataRef" ref="${esc(ref)}"/>
</field>`;
}
const heading = (name, text) => `<draw name="${esc(name)}" w="180mm" h="9mm">
  <ui><textEdit/></ui><value><text>${esc(text)}</text></value>
  <font typeface="Arial" size="11pt" weight="bold"/><margin topInset="3mm" bottomInset="1mm" leftInset="1mm" rightInset="0mm"/><para vAlign="bottom"/>
  <border><edge presence="hidden"/><edge presence="hidden"/><edge thickness="0.5pt"/><edge presence="hidden"/></border>
</draw>`;

export function generateXdp({ title, srv, model }) {
  const lead = String(srv.ann?.objectmodel?.leadingentity?.name || '').toLowerCase();
  const root = srv.exposes.find(e => e.entity === lead || e.alias.toLowerCase() === lead) || srv.exposes[0];
  const ent = model.entities.get(root.entity);
  if (!ent) throw new Error(`The leading entity ${root.entity} of ${srv.name} was not found`);
  const parts = [];
  const fields = ent.fields.filter(f => !isTech(f) || f.key && !/uuid/i.test(f.name) && f.ti?.t !== 'raw');
  parts.push(`<subform name="${esc(root.alias)}Header" layout="tb" w="180mm"><bind match="none"/>
${fields.map(f => field(f, `$.${root.alias}.${f.label || f.name}`)).join('\n')}
</subform>`);
  for (const a of ent.assocs?.values() || []) {
    if (a.toParent || !srv.exposes.some(e => e.entity === a.target)) continue;
    const target = model.entities.get(a.target);
    if (!target) continue;
    const an = assocName(ent, a), rowAlias = srv.exposes.find(e => e.entity === a.target).alias;
    const tf = target.fields.filter(f => !isTech(f) && !(target.keys || []).some(k => k === f.name && ent.keys?.includes(k)));
    if (a.card?.max === 1) {
      parts.push(`<subform name="${esc(an)}" layout="tb" w="180mm"><bind match="none"/>
${heading(`${an}Title`, words(an))}
${tf.map(f => field(f, `$.${root.alias}.${an}.${f.label || f.name}`)).join('\n')}
</subform>`);
      continue;
    }
    // a table: up to 6 columns, the widths split by the fields' lengths
    const cols = tf.slice(0, 6);
    const weights = cols.map(f => Math.min(40, Math.max(8, f.ti?.len || (f.ti?.t === 'd' ? 10 : 12))));
    const sum = weights.reduce((x, y) => x + y, 0);
    const widths = weights.map(wt => Math.round(wt / sum * 180 * 100) / 100);
    const head = cols.map((f, i) => `<draw name="${esc(f.label || f.name)}Head" w="${widths[i]}mm" h="7mm">
  <ui><textEdit/></ui><value><text>${esc(f.caption || words(f.label || f.name))}</text></value>
  <font typeface="Arial" size="9pt" weight="bold"/><margin topInset="0.5mm" bottomInset="0.5mm" leftInset="1mm" rightInset="1mm"/><para vAlign="middle"${f.ti?.t === 'p' || f.ti?.t === 'i' ? ' hAlign="right"' : ''}/>
  <border><edge thickness="0.5pt"/><fill><color value="230,234,240"/></fill></border>
</draw>`).join('\n');
    const row = cols.map((f, i) => field(f, `$.${f.label || f.name}`, { capW: 0, w: widths[i], h: 6, grow: true }).replace(/<caption[\s\S]*?<\/caption>\n  /, '').replace('<para vAlign="middle"/>', `<para vAlign="middle"${f.ti?.t === 'p' || f.ti?.t === 'i' ? ' hAlign="right"' : ''}/>`).replace('<ui>', '<border><edge thickness="0.5pt"/></border>\n  <ui>')).join('\n');
    parts.push(`<subform name="${esc(an)}Section" layout="tb" w="180mm"><bind match="none"/>
${heading(`${an}Title`, words(an))}
<subform name="${esc(an)}" layout="table" columnWidths="${widths.map(x => `${x}mm`).join(' ')}"><bind match="none"/>
<subform name="HeaderRow" layout="row"><assist role="TH"/>
${head}
</subform>
<subform name="${esc(rowAlias)}" layout="row"><occur min="0" max="-1"/><bind match="dataRef" ref="$.${esc(root.alias)}.${esc(an)}.${esc(rowAlias)}[*]"/>
${row}
</subform>
</subform>
</subform>`);
  }
  return xdpDocument(title, parts);
}

// a table of rows (header row repeated on every page): up to 6 columns, widths split by the fields' lengths
function tableXml(name, rowName, rowRef, fields) {
  const cols = fields.slice(0, 6);
  const weights = cols.map(f => Math.min(40, Math.max(8, f.ti?.len || (f.ti?.t === 'd' ? 10 : 12))));
  const sum = weights.reduce((x, y) => x + y, 0);
  const widths = weights.map(wt => Math.round(wt / sum * 180 * 100) / 100);
  const head = cols.map((f, i) => `<draw name="${esc(f.label || f.name)}Head" w="${widths[i]}mm" h="7mm">
  <ui><textEdit/></ui><value><text>${esc(f.caption || words(f.label || f.name))}</text></value>
  <font typeface="Arial" size="9pt" weight="bold"/><margin topInset="0.5mm" bottomInset="0.5mm" leftInset="1mm" rightInset="1mm"/><para vAlign="middle"${f.ti?.t === 'p' || f.ti?.t === 'i' ? ' hAlign="right"' : ''}/>
  <border><edge thickness="0.5pt"/><fill><color value="230,234,240"/></fill></border>
</draw>`).join('\n');
  const row = cols.map((f, i) => field(f, `$.${f.label || f.name}`, { capW: 0, w: widths[i], h: 6, grow: true }).replace(/<caption[\s\S]*?<\/caption>\n  /, '').replace('<para vAlign="middle"/>', `<para vAlign="middle"${f.ti?.t === 'p' || f.ti?.t === 'i' ? ' hAlign="right"' : ''}/>`).replace('<ui>', '<border><edge thickness="0.5pt"/></border>\n  <ui>')).join('\n');
  return `<subform name="${esc(name)}Section" layout="tb" w="180mm"><bind match="none"/>
${heading(`${name}Title`, words(name))}
<subform name="${esc(name)}" layout="table" columnWidths="${widths.map(x => `${x}mm`).join(' ')}"><bind match="none"/>
<subform name="HeaderRow" layout="row"><assist role="TH"/>
${head}
</subform>
<subform name="${esc(rowName)}" layout="row"><occur min="0" max="-1"/><bind match="dataRef" ref="${esc(rowRef)}"/>
${row}
</subform>
</subform>
</subform>`;
}

// a starter layout for a classic form interface (resolveParams of src/forms/interface.js): a structure parameter as
// captioned fields ($.IS_HEADER.EBELN), a table parameter as a table ($.IT_ITEMS.DATA[*]), elementary ones as fields
export function generateXdpFromInterface({ title, params }) {
  const parts = [];
  const elems = params.filter(p => p.shape === 'elem');
  if (elems.length) parts.push(`<subform name="Parameters" layout="tb" w="180mm"><bind match="none"/>\n${elems.map(p => field({ name: p.name, ti: p.ti }, `$.${p.name}`)).join('\n')}\n</subform>`);
  for (const p of params.filter(x => x.shape === 'struct')) {
    parts.push(`<subform name="${esc(p.name)}" layout="tb" w="180mm"><bind match="none"/>
${heading(`${p.name}Title`, words(p.name.replace(/^[A-Z]{2}_/, '').toLowerCase()))}
${p.fields.filter(f => !isTech(f)).map(f => field(f, `$.${p.name}.${f.name}`)).join('\n')}
</subform>`);
  }
  for (const p of params.filter(x => x.shape === 'table')) parts.push(tableXml(p.name, 'Row', `$.${p.name}.DATA[*]`, p.fields.filter(f => !isTech(f))));
  return xdpDocument(title, parts);
}

function xdpDocument(title, parts) {
  const pageNo = (id, script) => `<field name="${id}" w="15mm" h="5mm" presence="hidden" id="${id}"><ui><numericEdit/></ui><value><integer/></value><calculate><script contentType="application/x-javascript">this.rawValue = ${script};</script></calculate><bind match="none"/></field>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<?xfa generator="RAP Studio" APIVersion="3.6.0"?>
<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">
<template xmlns="http://www.xfa.org/schema/xfa-template/3.3/">
<subform name="Form" layout="tb" locale="en_US" restoreState="auto">
<pageSet>
<pageArea name="Page1" id="Page1">
<contentArea x="15mm" y="22mm" w="180mm" h="258mm"/>
<medium stock="a4" short="210mm" long="297mm"/>
<draw name="Title" x="15mm" y="8mm" w="180mm" h="10mm">
  <ui><textEdit/></ui><value><text>${esc(title)}</text></value>
  <font typeface="Arial" size="16pt" weight="bold"/><para vAlign="middle"/>
  <border><edge presence="hidden"/><edge presence="hidden"/><edge thickness="1pt"/><edge presence="hidden"/></border>
</draw>
${pageNo('PageNumber', 'xfa.layout.page(this)')}
${pageNo('PageCount', 'xfa.layout.pageCount()')}
<draw name="PageOfPages" x="155mm" y="284mm" w="40mm" h="6mm">
  <ui><textEdit/></ui>
  <value><exData contentType="text/html"><body xmlns="http://www.w3.org/1999/xhtml" xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/"><p style="text-align:right">Page <span xfa:embedType="uri" xfa:embedMode="raw" xfa:embed="#PageNumber"/> of <span xfa:embedType="uri" xfa:embedMode="raw" xfa:embed="#PageCount"/></p></body></exData></value>
  <font typeface="Arial" size="8pt"/><para hAlign="right" vAlign="middle"/>
</draw>
</pageArea>
</pageSet>
${parts.join('\n')}
</subform>
</template>
</xdp:xdp>
`;
}
