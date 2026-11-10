# Print forms (SAP Adobe forms) in RAP Studio

The counterpart of SAP Interactive Forms by Adobe / SAP Forms Service by Adobe. A form has three parts, exactly as
in SAP:

1. **Data**: a *form data provider* (ABAP Cloud) = a service definition whose leading entity is the form's root,
   with child entities reached by associations; or, in the classic interface, whatever the driver program passes.
2. **Layout**: `src/z<form>.form.json` (JSON in place of the XDP from Adobe LiveCycle Designer).
3. **Output**: ABAP that renders the PDF and prints it, reads filled interactive forms back, or signs them.

A complete, working reference app is `examples/forms` (billing document: data provider, layout with every feature,
an interactive form, the output class). Copy its patterns.

## 1. Data provider

```cds
@ObjectModel.supportedCapabilities: [ #OUTPUT_FORM_DATA_PROVIDER ]
define root view entity ZI_BillingDoc as select from zbil_head
  association [0..*] to ZI_BillingDocItem as _Item on $projection.BillingDoc = _Item.BillingDoc
{ key billing_doc as BillingDoc, customer_name as CustomerName, currency as Currency, _Item }
```
```cds
@ObjectModel.leadingEntity.name: 'ZI_BILLINGDOC'
define service ZFDP_BILLINGDOC { expose ZI_BillingDoc as BillingDoc; expose ZI_BillingDocItem as BillingDocItem; }
```
The form's data are the root's fields in **lower case** (`billingdoc`, `customername`) and the children under the
association name (`_item`: a table, one line per item with its fields). Children are those reached by compositions or
by associations to entities the service exposes (three levels deep). The layout names the provider:
`"dataProvider": "ZFDP_BILLINGDOC"`.

## 2. Layout (`src/z<form>.form.json`)

```json
{
  "title": "Invoice {billingdoc:alpha}",
  "dataProvider": "ZFDP_BILLINGDOC",
  "locale": "de_DE",
  "page": { "size": "A4", "orientation": "portrait", "margin": { "top": "15mm", "right": "18mm", "bottom": "18mm", "left": "20mm" } },
  "fonts": { "noto": "NotoSans-Regular.ttf", "noto-bold": "NotoSans-Bold.ttf" }, "font": "noto",
  "variables": { "net": "Sum(_item.netvalue)", "tax": "Round(net * 0.19, 2)", "gross": "net + tax" },
  "styles": { "h1": { "size": 18, "bold": true, "color": "#0a3d7a" } },
  "texts": { "terms": { "en": "Payable within 30 days.", "de": "Zahlbar innerhalb von 30 Tagen." } },
  "watermark": { "text": "DRAFT", "if": "status = 'D'" },
  "interactive": true,
  "pdfa": false,
  "security": { "ownerPassword": "…", "permissions": ["print", "fill"] },
  "firstHeader": [], "header": [], "footer": [ { "text": "Page {page} of {pages}", "align": "center", "size": 8 } ],
  "content": [ ],
  "sample": { "billingdoc": "0090000099", "_item": [ { "netvalue": 10 } ] }
}
```
- `page.size`: `A4`, `A5`, `A3`, `Letter`, `Legal` or `[width, height]`; sizes in points or `"mm"`, `"cm"`, `"in"`.
- Master page: `header` and `footer` on every page, `firstHeader` instead of `header` on page 1; `{page}` / `{pages}`.
- `fonts`: TrueType files (`.ttf`) in `src/`, embedded as a subset: any script (Cyrillic, Greek, CJK, Arabic glyphs).
  The standard fonts (`helvetica`, `times`, `courier`) only show Western European characters (WinAnsi); the check
  warns when a text has characters the font cannot show. Variants: `<name>-bold`, `-italic`, `-bolditalic`.
  A style or item may set `"font"`.
- `variables`: calculated once, in order, before the layout; usable like data fields (Adobe's form variables /
  initialize scripts).
- `sample`: the data of the studio's preview and of the check, in the shape of the real data.
- `interactive`: input fields are fillable (default). The classic interface makes them fillable only with
  `docparams-fillable = abap_true` (or `"interactive": true`).
- `pdfa: true`: PDF/A-2b for archiving (fonts embedded — the standard fonts are replaced by Arimo, same widths as
  Helvetica —, sRGB output intent, XMP metadata, no JavaScript). Usually chosen in ABAP instead (see section 3).
- `security`: AES-256 encryption. `userPassword` (needed to open), `ownerPassword` (needed to change the
  permissions), `permissions`: any of `print printHigh fill copy modify annotate accessibility assemble` (default:
  all). Prefer passing passwords from ABAP (`iv_password`) over storing them in the layout. Not together with PDF/A
  or a signature (sign first).

### Items
Every item may have `"if": "<expression>"`, `"style"`, `"keepTogether": true`, `"pageBreakBefore": true`.

| Item | What |
|---|---|
| `{ "text": "Dear **{name}**", "size", "bold", "italic", "color", "align", "font", "lineHeight" }` | wrapped text; `**bold**` inline; `\n` new line |
| `{ "textModule": "terms" }` | a text of `texts` in the form's language (Adobe text modules) |
| `{ "fields": [["Label", "{field}"], ["Date", "{date}", "date"]], "size" }` | label / value rows; long values wrap |
| `{ "table": "_item", "columns": [ … ], "total": { "netvalue": "sum" }, "totalLabel", "groupBy": "category", "groupHeader": "{category}", "subtotal": true, "subtotalLabel", "stripes": true, "headerColor", "size" }` | a table; the header repeats on every page; long cells wrap; totals `sum`, `avg`, `count`, `min`, `max` |
| column `{ "title", "field", "value": "{a} {b}", "calc": "quantity * unitprice", "width", "align", "format", "if", "wrap": false }` | `calc` adds a calculated field (also visible to totals and variables); `width` is relative |
| `{ "repeat": "_item", "items": [ … ] }` | a repeating subform: the items once per line (`{index}` = line number) |
| `{ "columns": [ { "width": 2, "items": [ … ] }, { "width": 1, "items": [ … ] } ], "gap": 12 }` | side by side |
| `{ "box": [ … ], "x": "20mm", "y": "45mm", "width": "85mm", "height", "border": "#94a3b8", "fill", "padding" }` | positioned on the page (address window, stamp); does not move the flow |
| `{ "image": "logo.png", "width": "40mm", "align" }` / `{ "image": "{picture}" }` | PNG / JPEG from `src/`, or data (hex / base64) |
| `{ "barcode": "qr", "value": "{field}", "size" (square 2D codes), "width", "height" (linear codes, PDF417), "text": false, "level": "M" }` | barcodes: 2D `qr datamatrix gs1datamatrix pdf417 aztec maxicode`; linear `code128 gs1-128 code39 code93 ean13 ean8 upca upce itf itf14 codabar` (any bwip-js symbology name works). A SEPA payment QR is `"BCD\n002\n1\nSCT\n<BIC>\n<name>\n<IBAN>\nEUR{=Str(gross, 2)}\n\n\n<text>"`; GS1-128 values use application identifiers `(01)09521234543213(10)LOT1` |
| `{ "input": "remark", "label": "Remark", "type": "text" \| "multiline" \| "checkbox" \| "dropdown" \| "signature", "value": "{remark}", "options": ["A", "B"], "width", "height", "required": true, "readOnly": true, "maxLength", "calc": "qty * price" }` | a fillable field (interactive forms); names must be unique (`"input": "qty_{index}"` in repeats). `calc`: an expression over the data and the fillable fields above it — its value when rendered, and recalculated in Acrobat / Reader while the user types (Adobe's calculate scripts) |
| `{ "line": true, "color" }`, `{ "space": 12 }`, `{ "pagebreak": true }` | |

### Values, formats, expressions
- `{field}`, `{struct.field}` or `{struct-field}`, `{sy-datum}`, `{sy-uname}`, `{page}`, `{pages}`.
- Formats: `{x:date}` `{x:time}` `{x:amount}` `{x:number}` `{x:integer}` `{x:currency:EUR}` `{x:currency:{waers}}`
  `{x:alpha}` (no leading zeros) `{x:upper}` `{x:lower}`. Dates and numbers follow the locale.
- Calculations (FormCalc-like): `{= net * 1.19 :amount}`, `{= if paid = 'X' then 'Paid' else 'Open' endif}`,
  `{= AmountInWords(gross, currency)}`. Operators `+ - * / mod &` (concatenation), `= <> < > <= >=`, `and or not`.
  Functions: `Sum Count Avg Min Max` (over a table column: `Sum(_item.netvalue)`), `Round(n, 2) Abs Floor Ceil Mod Pow`,
  `Concat Upper Lower Trim Len Left Right Substr(s, start, n) Replace Str(n, 2) Num`, `If(c, a, b) Choose Oneof Within
  HasValue Exists`, `Date() Time() AddDays(d, n) DaysBetween(d1, d2)`, `Format(v, 'amount')`, `WordNum(n)`,
  `AmountInWords(n, 'EUR')`. Field names in expressions use dots: `header.status`.
- Table columns work row by row: `Sum(_item.quantity * _item.price)`, `Sum(If(_item.status = 'X', _item.amount, 0))`,
  `Count(_item.matnr)`.
- Conditions (`if`) are expressions: `"status = 'D'"`, `"taxrate = 0"`, `"overdue and not paid"`.

## 3. Output in ABAP

ABAP Cloud (SAP Forms Service by Adobe):
```abap
DATA(reader) = cl_fp_form_reader=>create_form_reader( 'ZBILLING_DOC' ).
DATA(fdp) = cl_fp_fdp_services=>get_instance( reader->get_fdp_name( ) ).
DATA(keys) = fdp->get_keys( ).
keys[ name = 'BILLINGDOC' ]-value = iv_billing_doc.
DATA(xml) = fdp->read_to_xml_v2( keys ).
cl_fp_ads_util=>render_pdf( EXPORTING iv_xdp_layout = reader->get_layout( ) iv_xml_data = xml iv_locale = 'de_DE'
                            IMPORTING ev_pdf = DATA(pdf) ev_pages = DATA(pages) ).
DATA(item) = cl_print_queue_utils=>create_queue_item_by_data( iv_qname = 'INVOICES' iv_print_data = pdf
                                                              iv_name_of_main_doc = 'Invoice' ).
```
Exceptions: `cx_fp_form_reader`, `cx_fp_fdp_error`, `cx_fp_ads_util`. `is_options = VALUE #( trace_level = 4 )` returns
the warnings in `ev_trace_string`.

Classic (Interactive Forms by Adobe, driver program):
```abap
DATA fm_name TYPE rs38l_fnam.  DATA outputparams TYPE sfpoutputparams.
DATA docparams TYPE sfpdocparams.  DATA formoutput TYPE fpformoutput.
outputparams-getpdf = abap_true.                      " the PDF back instead of printing
CALL FUNCTION 'FP_JOB_OPEN' CHANGING ie_outputparams = outputparams EXCEPTIONS OTHERS = 1.
CALL FUNCTION 'FP_FUNCTION_MODULE_NAME' EXPORTING i_name = 'ZBILLING_DOC' IMPORTING e_funcname = fm_name.
docparams-langu = 'D'. docparams-country = 'DE'.      " the locale; docparams-fillable = abap_true: interactive
CALL FUNCTION fm_name EXPORTING /1bcdwb/docparams = docparams is_doc = ls_doc
                      IMPORTING /1bcdwb/formoutput = formoutput EXCEPTIONS OTHERS = 1.
CALL FUNCTION 'FP_JOB_CLOSE' EXCEPTIONS OTHERS = 1.
" formoutput-pdf, formoutput-pages
```
The function module's parameters are the data: a structure parameter also lends its components to the top level
(`is_doc-billingdoc` is `{billingdoc}`), tables are tables (`{_item}` or the parameter name).

Interactive forms and signatures (`cl_fp` PDF object):
```abap
DATA(pdfobj) = cl_fp=>get_reference( )->create_pdf_object( ).
pdfobj->set_document( pdfdata = filled_pdf ).
pdfobj->set_extractdata( ).
pdfobj->execute( ).
pdfobj->get_data( IMPORTING formdata = DATA(xml) ).     " <data><REMARK>…</REMARK>…</data> (check boxes: X)

pdfobj->set_signature( keyname = 'ZBILLING' fieldname = 'signature' reason = 'Approved' location = 'Walldorf' ).
pdfobj->execute( ).                                      " cx_fp_runtime_usage when the key or field is missing
pdfobj->get_document( IMPORTING pdfdata = DATA(signed) ).
pdfobj->set_task_verifysignature( ). pdfobj->execute( ). " get_signature_status( ): V valid, I invalid
```
Signing keys live in the app's `.rap/signing` (never in `src/`): create one with `rap form key ZBILLING`.

Short forms: `zcl_rap_form=>render( iv_form = 'ZBILLING_DOC' is_data = ls_doc )` (PDF),
`zcl_rap_form=>print( iv_form is_data iv_title )` (output request number), `zcl_rap_form=>read_fields( pdf )`
(table of name / value), `zcl_rap_form=>sign( iv_pdf iv_field iv_key iv_reason )`; sy-subrc 4 on errors.

Archiving and protection:
```abap
outputparams-pdftype = 'A'.                              " classic: PDF/A (before FP_JOB_OPEN)
DATA(archived) = zcl_rap_form=>render( iv_form = 'ZBILLING_DOC' is_data = ls_doc iv_pdfa = abap_true ).
DATA(locked) = zcl_rap_form=>render( iv_form = 'ZBILLING_DOC' is_data = ls_doc
                                     iv_password = 'secret'            " needed to open (optional)
                                     iv_owner_password = 'admin'       " needed to change the permissions
                                     iv_permissions = 'print,fill' ).  " allowed: print printHigh fill copy modify …
DATA(fields) = zcl_rap_form=>read_fields( iv_pdf = locked iv_password = 'secret' ).   " sy-subrc 4 without it
```
`zcl_rap_form=>render` / `print` also take `iv_locale`.

## 4. Commands (run inside the app folder)

| Command | What |
|---|---|
| `rap form check [FORM]` | checks the layouts: JSON, data provider, unknown fields / styles / fonts / images / items, failing expressions (also part of `rap check`) |
| `rap form <FORM> BILLINGDOC=0090000001 [--locale en_US] [--out x.pdf]` | renders with a record of the data provider and prints the text of every page, the fillable fields and the warnings |
| `rap form <FORM> --data '{"billingdoc": "1", "_item": [ … ]}'` | renders with given data (`--data @file.json`); without data: the sample, else the first record |
| `rap form <FORM> … --print [--title T]` / `rap outputs` / `rap output <nr> --out x.pdf` / `rap output delete <nr>` | the output queue |
| `rap form <FORM> … --sign KEY [--field signature]`, `rap form key KEY`, `rap form verify x.pdf`, `rap form fields x.pdf` | signatures and fillable fields |
| `rap form import layout.xdp [--name ZFORM]` | imports an Adobe LiveCycle Designer layout (XDP) as `src/zform.form.json` (see below) |

## Adobe forms with XDP layouts (SAP Forms Service by Adobe) — the SAP way, end to end

RAP Studio renders Adobe XFA layouts (`.xdp`, Adobe LiveCycle Designer) natively, like Adobe Document Services:
the same layout and the same ABAP code work on SAP BTP / S/4HANA. Use this when the user asks for an "Adobe
form", an XDP, a LiveCycle layout, or brings an `.xdp`. Reference app (SAP's cinema sample, runs as is):
`examples/adobe-forms` (`zf_cine_ticket.xdp`, form object, data provider `ZCINE_TICKET_SRVD`, `zcl_cine_print_ticket`).

**A form = form object + layout + data provider** (like a form in ADT):
- `src/<form>.xdp` — the XFA layout; `src/<form>.form.json` — `{ "title", "layout": "<form>.xdp", "dataProvider": "ZSRVD" }`.
- The data provider: a service definition with `@ObjectModel.leadingEntity.name` exposing the root view and the views
  its associations lead to (the root view may carry `@ObjectModel.supportedCapabilities: [ #OUTPUT_FORM_DATA_PROVIDER ]`).
- Its XML (what the layout binds to) is SAP's: `<Form><Alias>` with the CDS element names *as written in the view*,
  to-one associations as nested elements under the name the view exposes them (`_schedule as Schedule` → `Schedule`),
  to-many associations wrapping one element per row named by the target's exposure alias
  (`<_Item><Item>…</Item><Item>…</Item></_Item>`); dates `YYYY-MM-DD`, times `HH:MM:SS`, booleans `true`/`false`,
  raw strings (images) base64. Bindings: `$.Alias.Element`, `$.Alias.Schedule.Room.Name`, rows `$.Alias._Item.Item[*]`
  and inside a row `$.Element`. XFA binding is case-sensitive: use the names exactly.

**Commands** (inside the app folder):
- `rap form xdp <FORM> --fdp <SRVD> --title "…"` — a new Adobe form: a starter XDP from the data provider (A4, title,
  "Page n of m", header fields with captions, a table per to-many association) plus its form object. Then refine
  the XDP (it is XML: edit it like code) and check it.
- `rap form add <file.xdp> --fdp <SRVD>` — the user's own LiveCycle layout as a form (keeps it untouched).
- The studio's Code tab opens an `.xdp` in its **Design** view: a visual designer like LiveCycle Designer's Design
  View (the page as it prints, Object Library, Hierarchy, Data View of the data provider, properties). The user may
  have changed the XDP there; it writes plain XFA (positions and sizes in mm, `$.` data references), so read the
  file again before editing it.
- `rap form schema <SRVD> [--out file.xsd]` — the data's XML schema (ADT's Download Schema: the data connection the
  user uploads in LiveCycle Designer).
- `rap form check [FORM]` — the layout renders and every `$.…` binding exists in the data provider.
- `rap form <FORM> KEY=value` — renders a record, prints the text of every page (read it: missing values, wrong
  formats); `--out x.pdf`, `--data @file.xml`, `--locale de_DE`, `--print` (output queue).

**Writing XFA** (keep Designer's structure so the user can open it in LiveCycle Designer):
- `<xdp:xdp><template xmlns="http://www.xfa.org/schema/xfa-template/3.3/"><subform name="Form" layout="tb" locale="en_US">`
  with `<pageSet><pageArea name="Page1" id="Page1"><contentArea x y w h/><medium stock="a4" short="210mm" long="297mm"/>`
  and master page content (logos, titles, page numbers) in the pageArea; the body flows into the content area.
- Subforms: `layout="position"` (children at `x`/`y`, `anchorType`, `rotate="90"`), `tb` (top to bottom), `lr-tb`,
  `table` (`columnWidths="40mm 60mm …"`) with `row` subforms; a header row with `<assist role="TH"/>` (repeated on every
  page); a repeating row `<occur min="0" max="-1"/><bind match="dataRef" ref="$.Alias._Item.Item[*]"/>`.
- Fields: `<field name w h|minH><ui><textEdit multiLine="1"/>|<dateTimeEdit/>|<numericEdit/>|<checkButton/>|<imageEdit/>|<barcode type="QRCode"/></ui>`
  `<font typeface="Arial" size="9pt" weight="bold"/> <margin …Inset/> <para hAlign vAlign/> <caption reserve="40mm"><value><text>Label</text></value></caption>`
  `<format><picture>date{DD.MM.YYYY}</picture></format> <bind match="dataRef" ref="$.Alias.Element"/>`; `minH` grows with
  the text, fixed `h` clips. Pictures: `date{EEEE, D. MMM, YYYY}`, `date.long{}`, `time{HH:MM}`, `num{z,zzz,zz9.99}`,
  `datetime.long{}`. Booleans: check boxes with `<items><text>true</text><text>false</text></items>`.
- Draws: text (`<value><text>`), rich text (`<exData contentType="text/html">` XHTML with spans, fonts, colors),
  lines, rectangles (`<border><edge thickness="0.5pt"/><fill><color value="230,234,240"/></fill></border>`), images
  (`<image contentType="image/png" href="logo.png"/>` next to the layout in src/, or embedded base64; SVG works).
- Floating fields: hidden fields with an `id`, embedded in rich text as `<span xfa:embedType="uri" xfa:embed="#id"/>`
  ("{Zip} {City}", "Page {n} of {m}" with calculate scripts `xfa.layout.page(this)` / `xfa.layout.pageCount()`).
- Fonts: system TrueType fonts are embedded (Arial, Times New Roman, Courier New …); SAP's `72` family (`72`,
  `72 Brand`, `72 Brand Medium`, Bold / Semibold / Light / Condensed / Mono) and `SAP-icons` are fetched once and
  cached; other fonts: put the `.ttf` files into the app's `fonts/` folder.
- Scripts run as on Adobe's server (JavaScript `contentType="application/x-javascript"` or FormCalc, the default):
  `<calculate><script>Qty * Price</script></calculate>` (the script's value is the field's value),
  `<event activity="initialize">`, `<validate><script>this.rawValue &lt; 1000</script><message>…</message></validate>`
  (a failed validation is a warning in the trace), form `ready` (`ref="$form"`), `docReady`, `prePrint`, page-area
  `layout:ready` and page numbers. The object model: `rawValue`, `formattedValue`, `isNull`, `presence`
  (`"hidden"` takes the object out of the layout), `fillColor` / `fontColor` / `border.fill.color.value`, `caption`,
  `resolveNode("…")`, `xfa.resolveNode`, `$record.X.value`, `instanceManager` / `_Row` (`count`, `addInstance`,
  `removeInstance`, `setInstances`), `Row.all.item(i)`, script objects (`<variables><script name="utils">`),
  `xfa.layout.page(this)` / `pageCount()`, `util.printd`. FormCalc: `Sum(Table.Row[*].Amount)`, `if … then … endif`,
  `for`/`while`/`foreach`, `func`, Concat/Substr/Round/Format/Num2Date/WordNum … Errors are warnings in the trace
  (`rap form <FORM>` prints them): read them.
- Interactive (fillable) PDFs: `docparams-fillable = abap_true` (classic), the form's own setting
  (`<config …><present><pdf><interactive>1</interactive></pdf></present></config>` in the XDP) or
  `rap form <FORM> --fillable`: open input fields (text, numeric, date, check box, drop-down list, signature) become
  PDF form fields named by their SOM expression (`form1[0].Items[0].Row[1].Qty[0]`); radio buttons of an
  `exclGroup` become a radio group; fields keep the form's font, colour and alignment. Calculated fields become
  read-only fields whose calculate script keeps running in the PDF viewer (Acrobat, Chrome, pdf.js): JavaScript as
  written, FormCalc translated; validate, change, exit, enter and click scripts run too (initialize / ready /
  prePrint ran when the PDF was made). Numeric display patterns are format actions (the field holds the number).
  Fields with `access="readOnly"`/`protected` and no script, barcodes and images stay printed. Read filled values
  back with `rap form fields x.pdf` / `SET_EXTRACTDATA`.
- PDF/A-2b and passwords work for XDP layouts too: `outputparams-pdftype = 'A'` (classic), `is_options-pdfa = 'X'`
  (render_pdf), `zcl_rap_form=>render( … iv_pdfa / iv_password / iv_owner_password / iv_permissions )`.
- Pagination: `<overflow leader="#Header" trailer="#Continued"/>` (or subforms named overflowLeader /
  overflowTrailer): the leader starts, the trailer ends every page a flowed subform or table runs over. A long
  growable text is split between its lines over pages. "Page n of m" works in the body too.
- Scripts can ask the layout: `xfa.layout.page( node )`, `h / w / x / y( node, 'mm' )`, `pageSpan`, `pageContent(
  page, 'field' )` (a first layout pass provides it).
- Classic form jobs: everything between `FP_JOB_OPEN` and `FP_JOB_CLOSE` is one output request (the PDFs merged);
  `outputparams-dest` is the queue, `copies` / `covtitle` are kept, `FP_JOB_CLOSE` returns `e_result-spoolids`.
  `render_4_pq` returns print data in the queue's format: PDF, PostScript (when pdftops / Ghostscript is installed)
  or ZPL (`is_options-pdl`).
- Fonts: TrueType, OpenType (.otf, CFF) and collections (.ttc) from the system or the app's `fonts/` folder; SAP's
  72 is fetched once and cached (offline: put the 72 .ttf/.woff files into `fonts/`).

**ABAP output** (copy `examples/adobe-forms/src/zcl_cine_print_ticket.clas.abap`):
```abap
DATA(form) = cl_fp_form_reader=>create_form_reader( 'ZF_X' ).
DATA(fdp) = cl_fp_fdp_services=>get_instance( iv_service_definition = form->get_fdp_name( ) ).
DATA(keys) = fdp->get_keys( ).
keys[ name = 'ID' ]-value = lv_id.                         " the leading entity's key names in upper case
DATA(xml) = fdp->read_to_xml_v2( it_select = keys ).       " it_select_add: e.g. IsActiveEntity = abap_true
cl_fp_ads_util=>render_pdf( EXPORTING iv_xdp_layout = form->get_layout( ) iv_xml_data = xml iv_locale = 'en_US'
                                      is_options = VALUE #( trace_level = 4 )
                            IMPORTING ev_pdf = DATA(pdf) ev_pages = DATA(pages) ev_trace_string = DATA(trace) ).
cl_fp_ads_util=>render_4_pq( EXPORTING iv_pq_name = 'DEFAULT' iv_xdp_layout = form->get_layout( ) iv_xml_data = xml
                             IMPORTING ev_pdl = DATA(pdl) ).
cl_print_queue_utils=>create_queue_item_by_data( iv_qname = 'DEFAULT' iv_print_data = pdl iv_name_of_main_doc = 'Doc' ).
```
Put it into a console class, a RAP action (store the PDF in a `abap.rawstring` field with `@Semantics.largeObject` so
Fiori offers it for download) or a background operation; classic programs use `FP_JOB_OPEN` /
`FP_FUNCTION_MODULE_NAME` / `CALL FUNCTION fm_name` / `FP_JOB_CLOSE` (the XDP then binds the interface:
`$.PARAM.FIELD`, tables `$.ITAB.DATA[*]`). Errors: `cx_fp_form_reader`, `cx_fp_fdp_error`, `cx_fp_ads_util`.

**Form interface (classic forms without RAP)**: `src/<zfi>.sfpi.json` `{ "description": "…", "parameters": [{ "name":
"IS_HEADER", "type": "ZPO_S_HEADER" }, { "name": "IT_ITEMS", "type": "ZPO_T_ITEM" }] }` (a structure, a table type, or
`"table": true` with a structure for TYPE TABLE OF, or an elementary type) and the form object
`src/<zform>.form.json` `{ "title": "…", "layout": "<zform>.xdp", "interface": "ZFI_…", "sample": { … } }`. The
designer's Data View shows the interface (drag fields and tables), the preview uses `"sample"` or made-up values;
the driver passes the same parameters to the function module of `FP_FUNCTION_MODULE_NAME`. The New Object dialog
(Adobe form, Data: form interface) creates both and a starter layout bound to the interface. Global data and initialization like SAP's
form interface: `"global": [{ "name": "GV_TITLE", "type": "STRING" }]` and `"init": "gv_title = |PO { is_header-ebeln }|."`
(ABAP; the classic engine runs it in a generated function module before the layout is filled; the layout binds
`$.GV_TITLE` like a parameter; errors point at the .sfpi.json).

`rap form import <file.xdp>` still exists: it *converts* an XDP into a RAP Studio JSON layout; prefer rendering the
XDP itself (`rap form add`), which keeps the user's layout exact and has its own visual designer.

## The studio's form designer

The user can also edit a layout visually: the Design view of a `.form.json` (object library, hierarchy, data view to
drag fields onto the page, properties, move and resize on the page, undo). It writes the same JSON back, in the same
compact style — so keep layouts in the documented format (no comments, no other keys) and both stay in sync.

## Building a form from a request — the workflow

1. Data: tables with realistic seed data (`data/*.json`), the root view with associations to its children, the
   service definition with `@ObjectModel.leadingEntity.name`. `rap check .` until 0 errors.
2. Layout: start from `examples/forms/src/zbilling_doc.form.json`; add `sample` data in the provider's shape.
   `rap form check` until no findings.
3. Render it for a real record and read the page text: `rap form ZFORM KEY=value`. Fix what reads wrong.
4. Output class: the ABAP Cloud APIs (and the classic interface when the user asks for a driver program /
   function module), as a console class (`if_oo_adt_classrun`) so it can be run: `rap run . zcl_<name>`.
5. Delete test prints you made (`rap output delete <nr>`).

The user sees the layout next to a live PDF preview in the studio (Preview tab of the `.form.json` file), can pick a
record of the data provider and the locale there, and finds printed forms in the output queue.

## Limits

- Fillable XDP output is an AcroForm PDF with JavaScript (any viewer fills it in; scripts run where the viewer
  runs JavaScript). It is not an Adobe dynamic XFA form: subforms do not grow and instances cannot be added while
  filling in; scripts that add or remove instances work only when the PDF is made.
- OpenType fonts with CFF outlines are embedded whole (not subset); variable CFF2 fonts are not supported.
- PDF/A is PDF/A-2b; PDF/A files cannot be encrypted or contain JavaScript.
- Encryption is AES-256 (PDF 2.0 / Acrobat X and later); signing and encrypting the same PDF is not supported.
