// Command line for an app's print forms (run inside the app folder, like the classic commands). Renders with the
// ABAP runtime's form engine; no classic engine needed.
//   rap forms                                         the layouts: title, data provider, findings
//   rap form <FORM> [KEY=value ...] [--data '<json>' | --data @file.json] [--locale de_DE] [--out file.pdf]
//            [--print [--title T]] [--sign KEY [--field F] [--reason R]] [--flat] [--fillable (Adobe layouts)]
//                                                     render: pages, the text of every page, fields, warnings
//                                                     (KEY=value: a record of the data provider; without data:
//                                                     the layout's sample data, else the first record)
//   rap form check [FORM]                             check the layouts (JSON, data provider, fields, fonts, images)
//   rap form xdp <FORM> --fdp <SRVD> [--title T]      a new Adobe form: a starter XDP layout from the data provider
//                                                     (src/<form>.xdp) and its form object (src/<form>.form.json)
//   rap form add <file.xdp> --fdp <SRVD> [--name F]   an Adobe LiveCycle Designer layout as a form (rendered natively)
//   rap form schema <SRVD> [--out file.xsd]           the data provider's XML schema (ADT: Download Schema)
//   rap form import <file.xdp> [--name ZFORM]         convert an XDP into a RAP Studio layout (src/<name>.form.json)
//   rap form key <NAME>                               create a signing key (.rap/signing, self-signed, development)
//   rap form fields <file.pdf>                        the values of the fillable fields of a (filled) PDF
//   rap form verify <file.pdf>                        the signatures of a PDF and whether they are valid
//   rap outputs [--top 20] | rap output <nr> [--out file.pdf] | rap output delete <nr>   the output queue
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const has = name => argv.includes(name);
const VALUE_FLAGS = new Set(['--fdp', '--data', '--locale', '--out', '--title', '--sign', '--field', '--reason', '--name', '--top', '--port', '--db']);
const positional = () => { const out = []; for (let i = 1; i < argv.length; i++) { if (argv[i].startsWith('--')) { if (VALUE_FLAGS.has(argv[i])) i++; continue; } out.push(argv[i]); } return out; };
const fail = m => { console.log(m); process.exit(1); };
const when = ms => (ms ? new Date(Number(ms)).toISOString().replace('T', ' ').slice(0, 19) : '');

export async function formsCli(cmd) {
  const dir = process.cwd();
  if (!fs.existsSync(path.join(dir, 'src'))) fail('Run this inside an app folder (it has a src folder).');
  const pos = positional();
  // commands that need no activation
  if (cmd === 'form' && pos[0] === 'import') {
    const { importXdp } = await import('./xdp.js');
    const file = pos[1];
    if (!file || !fs.existsSync(file)) fail('usage: rap form import <file.xdp> [--name ZFORM]');
    const name = (opt('--name') || path.basename(file).replace(/\.(xdp|xml)$/i, '')).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const r = importXdp(fs.readFileSync(file, 'utf8'), { name });
    const target = path.join(dir, 'src', `${name}.form.json`);
    fs.writeFileSync(target, `${JSON.stringify(r.form, null, 2)}\n`);
    for (const [f, b] of Object.entries(r.assets)) { fs.writeFileSync(path.join(dir, 'src', f), b); console.log(`  image   src/${f}`); }
    console.log(`Imported ${path.basename(file)} as src/${name}.form.json`);
    for (const w of r.warnings) console.log(`  warning ${w}`);
    console.log(`Next: rap form check ${name.toUpperCase()}, then rap form ${name.toUpperCase()} --data '{…}'`);
    return;
  }
  if (cmd === 'form' && pos[0] === 'add') {
    const file = pos[1];
    if (!file || !fs.existsSync(file)) fail('usage: rap form add <file.xdp> --fdp <SRVD> [--name ZFORM]');
    const name = (opt('--name') || path.basename(file).replace(/\.(xdp|xml)$/i, '')).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    fs.copyFileSync(file, path.join(dir, 'src', `${name}.xdp`));
    fs.writeFileSync(path.join(dir, 'src', `${name}.form.json`), `${JSON.stringify({ title: opt('--title') || name.toUpperCase(), layout: `${name}.xdp`, ...(opt('--fdp') ? { dataProvider: opt('--fdp').toUpperCase() } : {}) }, null, 1)}\n`);
    console.log(`Form ${name.toUpperCase()}: layout src/${name}.xdp, form object src/${name}.form.json${opt('--fdp') ? ` (data provider ${opt('--fdp').toUpperCase()})` : ''}`);
    console.log(`Next: rap form check ${name.toUpperCase()}, then rap form ${name.toUpperCase()} KEY=value`);
    return;
  }
  if (cmd === 'form' && pos[0] === 'key') {
    const { createSigningKey } = await import('./sign.js');
    if (!pos[1]) fail('usage: rap form key <NAME>');
    const k = createSigningKey(dir, pos[1]);
    console.log(`Signing key ${pos[1].toUpperCase()} created (self-signed, for development):\n${k.files.map(f => `  ${path.relative(dir, f)}`).join('\n')}\nUse it with set_signature( keyname = '${pos[1].toUpperCase()}' … ) or rap form <FORM> --sign ${pos[1].toUpperCase()}. Keep .rap/ out of git.`);
    return;
  }
  if (cmd === 'form' && (pos[0] === 'fields' || pos[0] === 'verify')) {
    if (!pos[1] || !fs.existsSync(pos[1])) fail(`usage: rap form ${pos[0]} <file.pdf>`);
    const pdf = fs.readFileSync(pos[1]);
    if (pos[0] === 'fields') {
      const { readFields } = await import('./pdfread.js');
      const f = readFields(pdf);
      if (!Object.keys(f).length) console.log('The PDF has no fillable fields.');
      for (const [k, v] of Object.entries(f)) console.log(`${k.padEnd(28)} ${JSON.stringify(v)}`);
    } else {
      const { verifyPdf } = await import('./sign.js');
      const v = verifyPdf(pdf);
      if (!v.length) console.log('The PDF is not signed.');
      for (const x of v) console.log(`${x.valid ? 'VALID  ' : 'INVALID'} signed by ${x.signer}${x.reason ? `, reason: ${x.reason}` : ''}${x.covers ? '' : ' (does not cover the whole document)'}`);
      if (v.some(x => !x.valid)) process.exit(1);
    }
    return;
  }

  const { Workspace } = await import('../server/server.js');
  const ws = new Workspace(dir, { lint: false });
  const { formStore } = await import('./engine.js');
  const { checkForms } = await import('./check.js');
  const store = formStore(dir);
  let ok = true;
  try {
    if (cmd === 'form' && (pos[0] === 'xdp' || pos[0] === 'schema')) {
      const srvd = (pos[0] === 'schema' ? pos[1] : opt('--fdp')) || '';
      const srv = ws.app.model.services.get(srvd.toLowerCase());
      if (!srv) fail(`usage: rap form ${pos[0] === 'schema' ? 'schema <SRVD>' : 'xdp <FORM> --fdp <SRVD>'}: ${srvd ? `service definition ${srvd.toUpperCase()} not found` : 'the data provider (a service definition) is missing'}`);
      if (pos[0] === 'schema') {
        const xsd = ws.app.rt.formXsd(srvd);
        if (opt('--out')) { fs.writeFileSync(opt('--out'), xsd); console.log(`Saved ${opt('--out')}`); } else console.log(xsd);
      } else {
        const name = String(pos[1] || '').toLowerCase().replace(/[^a-z0-9_]/g, '_');
        if (!name) fail('usage: rap form xdp <FORM> --fdp <SRVD> [--title T]');
        const { generateXdp } = await import('./xfa/generate.js');
        const xdp = generateXdp({ title: opt('--title') || name.toUpperCase(), srv, model: ws.app.model });
        fs.writeFileSync(path.join(dir, 'src', `${name}.xdp`), xdp);
        fs.writeFileSync(path.join(dir, 'src', `${name}.form.json`), `${JSON.stringify({ title: opt('--title') || name.toUpperCase(), layout: `${name}.xdp`, dataProvider: srvd.toUpperCase() }, null, 1)}\n`);
        console.log(`Form ${name.toUpperCase()}: Adobe layout src/${name}.xdp (starter, from ${srvd.toUpperCase()}), form object src/${name}.form.json`);
        console.log(`Next: rap form ${name.toUpperCase()} KEY=value (render a record), refine the layout (XFA) and check it with rap form check ${name.toUpperCase()}`);
      }
    } else if (cmd === 'forms') {
      const list = store.list();
      if (!list.length) console.log('No print forms yet (src/<name>.form.json).');
      const findings = checkForms(dir, ws.app.model);
      for (const n of list) {
        let f = null; try { f = store.load(n); } catch {}
        const mine = findings.filter(x => x.file === `src/${n.toLowerCase()}.form.json`);
        console.log(`${n.padEnd(28)} ${String(f?.title || '').padEnd(30)} ${f?.dataProvider ? `data provider ${f.dataProvider}` : ''}${mine.length ? `  (${mine.length} finding${mine.length > 1 ? 's' : ''}: rap form check ${n})` : ''}`);
      }
    } else if (cmd === 'form' && pos[0] === 'check') {
      const findings = checkForms(dir, ws.app.model, pos[1]);
      for (const f of findings) console.log(`  ${f.severity === 'error' ? 'ERROR  ' : 'warning'} ${f.file}:${f.line}  ${f.message}`);
      const n = (pos[1] ? 1 : store.list().length);
      console.log(findings.length ? `${findings.filter(f => f.severity === 'error').length} error(s), ${findings.filter(f => f.severity !== 'error').length} warning(s)` : `${n} layout(s) OK`);
      ok = !findings.some(f => f.severity === 'error');
    } else if (cmd === 'form') {
      const name = pos[0];
      if (!name) fail("usage: rap form <FORM> [KEY=value ...] [--data '<json>'] [--locale de_DE] [--out file.pdf] [--print] [--sign KEY]");
      let form;
      try { form = store.load(name); } catch (e) { fail(`src/${name.toLowerCase()}.form.json is not valid JSON: ${e.message}`); }
      if (!form) fail(`Form ${name.toUpperCase()} does not exist (src/${name.toLowerCase()}.form.json); rap forms lists the forms`);
      const rt = ws.app.rt;
      const keys = pos.slice(1).filter(a => a.includes('=')).map(a => { const i = a.indexOf('='); return { name: a.slice(0, i).toUpperCase(), value: a.slice(i + 1) }; });
      let data, source;
      if (opt('--data')) {
        const raw = opt('--data');
        data = JSON.parse(raw.startsWith('@') ? fs.readFileSync(raw.slice(1), 'utf8') : raw);
        source = 'the given data';
      } else if (keys.length) {
        if (!form.dataProvider) fail(`Form ${name.toUpperCase()} has no data provider: pass --data instead`);
        data = rt.formRead(form.dataProvider, keys);
        source = `${form.dataProvider} ${keys.map(k => `${k.name}=${k.value}`).join(' ')}`;
      } else if (form.sample) { data = form.sample; source = 'the sample data'; }
      else if (form.dataProvider) {
        try { data = rt.formRead(form.dataProvider, []); source = `the first record of ${form.dataProvider}`; } catch (e) { fail(e.get_text ? rt.s(e.get_text().$ret) : e.message); }
      } else { data = {}; source = 'no data'; }
      let signature;
      if (opt('--sign')) {
        const { signingKey } = await import('./sign.js');
        const k = signingKey(dir, opt('--sign'));
        if (!k) fail(`Signing key ${opt('--sign').toUpperCase()} not found: rap form key ${opt('--sign').toUpperCase()}`);
        signature = { ...k, field: opt('--field'), reason: opt('--reason'), name: 'DEVELOPER' };
      }
      if (form.xdp) {
        // an Adobe layout: the data provider's XML (SAP's shape), or the given data (XML or JSON)
        const { renderXdp } = await import('./xfa/render.js');
        let xml = null, src = 'no data';
        if (opt('--data')) { const raw = opt('--data'); xml = raw.startsWith('@') ? fs.readFileSync(raw.slice(1), 'utf8') : raw; if (/^\s*[{[]/.test(xml)) xml = JSON.parse(xml); src = 'the given data'; }
        else if (form.dataProvider) { try { xml = rt.formXml(form.dataProvider, keys); src = keys.length ? `${form.dataProvider} ${keys.map(k => `${k.name}=${k.value}`).join(' ')}` : `the first record of ${form.dataProvider}`; } catch (e) { fail(e.get_text ? rt.s(e.get_text().$ret) : e.message); } }
        const r = renderXdp(form.xdp, xml, { locale: opt('--locale') || form.locale, fontDirs: store.fontDirs(), assetDir: path.join(dir, 'src'), ...(has('--fillable') ? { interactive: true } : has('--flat') ? { interactive: false } : {}) });
        console.log(`Form ${name.toUpperCase()} (Adobe layout ${form.layoutFile}) with ${src}: ${r.pages} page(s), ${r.pdf.length} bytes`);
        r.text.forEach((lines, i) => { console.log(`--- page ${i + 1}`); for (const l of lines) console.log(`  ${l}`); });
        if (r.warnings.length) { console.log('Warnings:'); for (const w of r.warnings) console.log(`  ${w}`); }
        if (opt('--out')) { fs.writeFileSync(opt('--out'), r.pdf); console.log(`Saved ${opt('--out')}`); }
        if (has('--print')) {
          const db = ws.app.db;
          db.exec(`CREATE TABLE IF NOT EXISTS rap_output (id INTEGER PRIMARY KEY, form TEXT, title TEXT, username TEXT, created BIGINT, pages INTEGER, pdf ${db.kind === 'postgres' ? 'BYTEA' : 'BLOB'})`);
          const id = Number(db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM rap_output').get().n);
          db.prepare('INSERT INTO rap_output (id, form, title, username, created, pages, pdf) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, name.toUpperCase(), opt('--title') || form.title || name, 'DEVELOPER', Date.now(), r.pages, r.pdf);
          console.log(`Output request ${id}`);
        }
        return;
      }
      const { renderForm } = await import('./engine.js');
      const r = renderForm(form, { sy: { datum: rt.s(rt.sy.datum), uzeit: rt.s(rt.sy.uzeit), uname: 'DEVELOPER' }, ...data }, { locale: opt('--locale') || form.locale, assets: n => store.assets(n), fillable: has('--flat') ? false : undefined, signature });
      console.log(`Form ${name.toUpperCase()} with ${source}: ${r.pages} page(s), ${r.pdf.length} bytes${signature ? ', signed' : ''}`);
      r.text.forEach((lines, i) => { console.log(`--- page ${i + 1}`); for (const l of lines) console.log(`  ${l}`); });
      if (r.fields.length) { console.log('Fillable fields:'); for (const f of r.fields) console.log(`  ${f.name.padEnd(24)} ${f.type.padEnd(10)} ${JSON.stringify(f.value)}  (page ${f.page})`); }
      if (r.warnings.length) { console.log('Warnings:'); for (const w of r.warnings) console.log(`  ${w}`); }
      if (opt('--out')) { fs.writeFileSync(opt('--out'), r.pdf); console.log(`Saved ${opt('--out')}`); }
      if (has('--print')) {
        const db = ws.app.db;
        db.exec(`CREATE TABLE IF NOT EXISTS rap_output (id INTEGER PRIMARY KEY, form TEXT, title TEXT, username TEXT, created BIGINT, pages INTEGER, pdf ${db.kind === 'postgres' ? 'BYTEA' : 'BLOB'})`);
        const id = Number(db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM rap_output').get().n);
        db.prepare('INSERT INTO rap_output (id, form, title, username, created, pages, pdf) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, name.toUpperCase(), opt('--title') || r.text[0]?.[0] || name, 'DEVELOPER', Date.now(), r.pages, r.pdf);
        console.log(`Output request ${id}`);
      }
    } else if (cmd === 'outputs') {
      const db = ws.app.db;
      let list = [];
      try { list = db.prepare('SELECT id, form, title, username, created, pages FROM rap_output ORDER BY id DESC LIMIT ?').all(Number(opt('--top', 20))); } catch {}
      if (!list.length) console.log('The output queue is empty.');
      for (const o of list) console.log(`${String(o.id).padStart(4)}  ${when(o.created)}  ${String(o.form).padEnd(24)} ${o.title}  (${o.pages} page(s), ${o.username})`);
    } else if (cmd === 'output') {
      const db = ws.app.db;
      if (pos[0] === 'delete') { const n = db.prepare('DELETE FROM rap_output WHERE id = ?').run(Number(pos[1])).changes; console.log(n ? `Output request ${pos[1]} deleted` : `Output request ${pos[1]} does not exist`); ok = !!n; }
      else {
        const o = db.prepare('SELECT * FROM rap_output WHERE id = ?').get(Number(pos[0]));
        if (!o) fail(`Output request ${pos[0]} does not exist`);
        console.log(`${o.id}  ${o.form}  ${o.title}  ${o.pages} page(s), ${when(o.created)}, ${o.username}`);
        if (opt('--out')) { fs.writeFileSync(opt('--out'), Buffer.from(o.pdf)); console.log(`Saved ${opt('--out')}`); }
      }
    }
  } catch (e) {
    console.log(e?.get_text ? ws.app.rt.s(e.get_text().$ret) : e.message);
    ok = false;
  } finally { ws.close(); }
  process.exit(ok ? 0 : 1);
}
