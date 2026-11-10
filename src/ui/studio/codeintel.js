// Code intelligence in the studio's code editor (ADT-like), on the server's /api/codeintel endpoints:
// completion (keywords, objects of the app and the SAP standard layer, fields after alias~ / struct- / _assoc.,
// methods after => / ->, annotations, snippets), go to definition (F3, Ctrl/Cmd-click; standard objects open
// read-only), where-used list (Ctrl/Cmd+Shift+G), rename (F2: preview, then files and references change and the
// app activates), hover (types, fields, declarations) and the outline (Ctrl/Cmd+Shift+O).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function mountCodeIntel(monaco, editor, { app, file, api, openFile, afterRename, toast }) {
  const LANGS = ['abap', 'cds'];
  const ok = () => !!app() && !!file() && /\.(abap|asddls|asddlxs|asbdef|srvdsrv|cds)$/i.test(file());
  const req = (op, body) => api('POST', `/a/${app()}/api/codeintel/${op}`, { file: file(), ...body });
  const pos = (model, p) => ({ text: model.getValue(), line: p.lineNumber, col: p.column });
  const K = monaco.languages.CompletionItemKind;
  const KIND = { keyword: K.Keyword, snippet: K.Snippet, field: K.Field, association: K.Reference, method: K.Method, attribute: K.Property, variable: K.Variable, object: K.Class, class: K.Class, annotation: K.Property };
  const SK = monaco.languages.SymbolKind;
  const SYM = { class: SK.Class, 'class implementation': SK.Class, interface: SK.Interface, method: SK.Method, 'method declaration': SK.Method, form: SK.Function, module: SK.Function, function: SK.Function, program: SK.Module, event: SK.Event, type: SK.Struct, definition: SK.Class, 'metadata extension': SK.Class, association: SK.Field, composition: SK.Field, 'entity set': SK.Field, 'key field': SK.Key, field: SK.Field, 'entity behavior': SK.Class, action: SK.Method, determination: SK.Method, validation: SK.Method, event2: SK.Event };
  const disposables = [];
  for (const lang of LANGS) {
    disposables.push(monaco.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: ['~', '-', '>', '.', '@'],
      async provideCompletionItems(model, p) {
        if (!ok() || model !== editor.getModel()) return { suggestions: [] };
        // a '.' that ends an ABAP statement (or a number) triggers nothing; CDS paths (_Assoc.Field) and alias. still do
        const before = model.getLineContent(p.lineNumber).slice(0, p.column - 1);
        if (lang === 'abap' && /\.\s*$/.test(before) && !/\\_\w*\.$|\b_\w+\.$/.test(before)) return { suggestions: [] };
        const flow = /\.prog\.screen_\d+\.abap$/i.test(file());
        const r = await req('complete', pos(model, p)).catch(() => ({ items: [] }));
        // flow logic (dynpro): no class / method snippets
        if (flow) r.items = (r.items || []).filter(it => !/^(class|method|methods|interface|try|select|loop at|data|types)\b/i.test(it.label) || /^(loop|module|field|chain|process)/i.test(it.label));
        const w = model.getWordUntilPosition(p);
        const ann = /@[\w.]*$/.exec(model.getLineContent(p.lineNumber).slice(0, p.column - 1));
        const range = ann ? new monaco.Range(p.lineNumber, p.column - ann[0].length, p.lineNumber, p.column) : new monaco.Range(p.lineNumber, w.startColumn, p.lineNumber, w.endColumn);
        return {
          suggestions: (r.items || []).map((it, i) => ({
            label: it.label, kind: KIND[it.kind] ?? K.Text, detail: it.detail, insertText: it.insertText,
            insertTextRules: it.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
            range, sortText: `${{ field: 0, method: 0, attribute: 1, association: 1, variable: 2, annotation: 0, snippet: 3, keyword: 4, object: 5, class: 5 }[it.kind] ?? 6}${String(i).padStart(5, '0')}`,
          })),
        };
      },
    }));
    disposables.push(monaco.languages.registerHoverProvider(lang, {
      async provideHover(model, p) {
        if (!ok() || model !== editor.getModel()) return null;
        const r = await req('hover', pos(model, p)).catch(() => null);
        if (!r?.hover) return null;
        return { contents: [{ value: `**${r.hover.title}**` }, { value: `\`\`\`\n${r.hover.text}\n\`\`\`` }] };
      },
    }));
    disposables.push(monaco.languages.registerDocumentSymbolProvider(lang, {
      async provideDocumentSymbols(model) {
        if (!ok() || model !== editor.getModel()) return [];
        const r = await req('symbols', { text: model.getValue() }).catch(() => ({ symbols: [] }));
        return (r.symbols || []).map(s => {
          const len = model.getLineMaxColumn(Math.min(s.line, model.getLineCount()));
          const range = new monaco.Range(s.line, 1, s.line, len);
          return { name: s.name, detail: s.kind, kind: SYM[s.kind] ?? SK.Variable, range, selectionRange: range, containerName: s.container || '' };
        });
      },
    }));
  }

  // ---------------------------------------------------------------- go to definition (F3, Ctrl/Cmd-click)
  async function gotoDefinition(p) {
    if (!ok()) return;
    const model = editor.getModel();
    const r = await req('definition', pos(model, p || editor.getPosition())).catch(e => ({ error: e.message }));
    const loc = r?.location;
    if (!loc) { toast?.('No definition found'); return; }
    if (loc.readOnly) return showReadOnly(loc);
    if (loc.file === file()) { editor.revealLineInCenter(loc.line); editor.setPosition({ lineNumber: loc.line, column: 1 }); editor.focus(); return; }
    openFile(loc.file, loc.line);
  }
  editor.addAction({ id: 'rap.definition', label: 'Go to Definition', keybindings: [monaco.KeyCode.F3], contextMenuGroupId: 'navigation', contextMenuOrder: 1, run: () => gotoDefinition() });
  editor.onMouseDown(e => {
    if ((e.event.metaKey || e.event.ctrlKey) && e.target.position && e.target.type === monaco.editor.MouseTargetType.CONTENT_TEXT) gotoDefinition(e.target.position);
  });

  // ---------------------------------------------------------------- panel under the editor (where-used, rename)
  const host = editor.getDomNode()?.closest('.editor-wrap') || document.body;
  let panel = host.querySelector('.ci-panel');
  if (!panel) { panel = document.createElement('div'); panel.className = 'ci-panel'; panel.hidden = true; host.appendChild(panel); }
  const closePanel = () => { panel.hidden = true; panel.innerHTML = ''; };
  const wordAt = async p => { const r = await req('word', pos(editor.getModel(), p || editor.getPosition())).catch(() => null); return r?.word ? r : null; };

  async function whereUsed() {
    if (!ok()) return;
    const w = await wordAt();
    if (!w) return toast?.('Put the cursor on a name');
    const name = w.word.replace(/[<>]/g, '');
    const local = !!w.qualifier || /^(lv_|ls_|lt_|lo_|lr_|gv_|gs_|gt_|mv_|ms_|mt_|iv_|is_|it_|ev_|es_|et_|rv_|rs_|rt_|cv_)/i.test(name);
    const r = await req('whereused', { name, member: false }).catch(e => ({ error: e.message, refs: [] }));
    const refs = r.refs || [];
    const byFile = new Map();
    for (const x of refs) { if (!byFile.has(x.file)) byFile.set(x.file, []); byFile.get(x.file).push(x); }
    panel.hidden = false;
    panel.innerHTML = `<div class="ci-head"><b>Where-used list</b> <code>${esc(name.toUpperCase())}</code><span class="muted">${refs.length} reference${refs.length === 1 ? '' : 's'} in ${byFile.size} object${byFile.size === 1 ? '' : 's'}${local ? ' (all names spelled like it)' : ''}</span><span class="spacer"></span><button class="btn sm ci-close" title="Close (Esc)">×</button></div>
      <div class="ci-body">${[...byFile].map(([f, list]) => `<div class="ci-file">${esc(f)}</div>${list.map(x => `<a href="#" class="ci-ref" data-f="${esc(x.file)}" data-l="${x.line}"><span class="ci-ln">${x.line}</span><code>${esc(x.text)}</code></a>`).join('')}`).join('') || '<div class="muted">Not used anywhere</div>'}</div>`;
    panel.querySelector('.ci-close').onclick = closePanel;
    panel.querySelectorAll('.ci-ref').forEach(a => a.onclick = ev => { ev.preventDefault(); const l = Number(a.dataset.l); if (a.dataset.f === file()) { editor.revealLineInCenter(l); editor.setPosition({ lineNumber: l, column: 1 }); editor.focus(); } else openFile(a.dataset.f, l); });
  }
  editor.addAction({ id: 'rap.whereUsed', label: 'Where-Used List', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyG], contextMenuGroupId: 'navigation', contextMenuOrder: 2, run: () => whereUsed() });

  async function rename() {
    if (!ok()) return;
    const w = await wordAt();
    if (!w) return toast?.('Put the cursor on a name');
    const name = w.word.replace(/[<>]/g, '');
    // an object of the app (a file of that name) or a local name of this source
    const sym = await api('POST', `/a/${app()}/api/codeintel/definition`, { file: file(), text: name, line: 1, col: 1 }).catch(() => null);
    const isObject = !!sym?.location && !sym.location.readOnly && sym.location.file !== file() || /\.(clas|intf|prog)\.abap$/i.test(file()) && new RegExp(`^${name}\\.`, 'i').test(file().split('/').pop());
    if (sym?.location?.readOnly) return toast?.(`${name.toUpperCase()} belongs to the SAP standard layer and cannot be renamed`);
    panel.hidden = false;
    panel.innerHTML = `<div class="ci-head"><b>Rename</b> <code>${esc(name)}</code><span class="muted">${isObject ? 'object: its files and every reference in the app' : 'in this source'}</span><span class="spacer"></span><button class="btn sm ci-close">×</button></div>
      <div class="ci-body"><div class="ci-row"><input class="input ci-new" value="${esc(name)}" spellcheck="false" aria-label="New name"><button class="btn sm ci-prev">Preview</button><button class="btn sm primary ci-apply" disabled>Rename and activate</button></div><div class="ci-changes"></div></div>`;
    const inp = panel.querySelector('.ci-new');
    inp.focus(); inp.select();
    panel.querySelector('.ci-close').onclick = closePanel;
    const scope = isObject ? 'object' : 'local';
    const preview = async () => {
      const r = await req('rename', { name, newName: inp.value.trim(), scope }).catch(e => ({ error: e.message }));
      const box = panel.querySelector('.ci-changes');
      if (r.error) { box.innerHTML = `<div class="ci-err">${esc(r.error)}</div>`; panel.querySelector('.ci-apply').disabled = true; return; }
      box.innerHTML = `${(r.moves || []).map(m => `<div class="ci-move">${esc(m.from)} → <b>${esc(m.to)}</b></div>`).join('')}${r.changes.map(c => `<div class="ci-chg"><span class="ci-ln">${esc(c.file)}:${c.line}</span><del>${esc(c.before)}</del><ins>${esc(c.after)}</ins></div>`).join('')}<div class="muted">${r.changes.length} change(s)${r.moves?.length ? `, ${r.moves.length} file(s) renamed` : ''}</div>`;
      panel.querySelector('.ci-apply').disabled = !r.changes.length && !r.moves?.length;
    };
    panel.querySelector('.ci-prev').onclick = preview;
    inp.onkeydown = e => { if (e.key === 'Enter') preview(); if (e.key === 'Escape') closePanel(); };
    panel.querySelector('.ci-apply').onclick = async () => {
      const nn = inp.value.trim();
      const r = await req('rename', { name, newName: nn, scope, apply: true }).catch(e => ({ error: e.message }));
      if (r.error) { panel.querySelector('.ci-changes').innerHTML = `<div class="ci-err">${esc(r.error)}</div>`; return; }
      const moved = (r.moves || []).find(m => m.from === file());
      const errs = r.summary?.diagnostics?.errors?.length || 0;
      panel.querySelector('.ci-changes').innerHTML = `<div class="${errs ? 'ci-err' : 'ci-ok'}">${errs ? `Renamed; ${errs} activation error(s): see Problems` : `✓ Renamed to ${esc(nn)} and activated`}</div>`;
      afterRename?.({ ...r, newFile: moved ? moved.to : file() });
    };
  }
  editor.addAction({ id: 'rap.rename', label: 'Rename…', keybindings: [monaco.KeyCode.F2], contextMenuGroupId: '1_modification', contextMenuOrder: 1, run: () => rename() });
  editor.addAction({ id: 'rap.outline', label: 'Outline (go to symbol)', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyO], run: () => editor.getAction('editor.action.quickOutline')?.run() });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden && panel.contains(document.activeElement)) closePanel(); });

  // a standard object (SAP standard layer, another app): its definition, read-only
  function showReadOnly(loc) {
    let ov = document.querySelector('.ci-ro');
    if (!ov) { ov = document.createElement('div'); ov.className = 'ci-ro'; document.body.appendChild(ov); }
    ov.innerHTML = `<div class="ci-ro-box"><div class="ci-head"><b>${esc(loc.title)}</b><span class="muted">${esc(loc.file)}</span><span class="spacer"></span><button class="btn sm ci-close">×</button></div><div class="ci-ro-ed"></div></div>`;
    ov.hidden = false;
    const ed = monaco.editor.create(ov.querySelector('.ci-ro-ed'), { value: loc.text, language: 'cds', readOnly: true, automaticLayout: true, minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'vs-dark' : 'vs' });
    ed.revealLineInCenter(loc.line || 1);
    if (loc.line > 1) ed.setSelection(new monaco.Range(loc.line, 1, loc.line, ed.getModel().getLineMaxColumn(loc.line)));
    const close = () => { ed.dispose(); ov.hidden = true; ov.innerHTML = ''; };
    ov.querySelector('.ci-close').onclick = close;
    ov.onclick = e => { if (e.target === ov) close(); };
  }
  return { dispose() { disposables.forEach(d => d.dispose()); panel.remove(); }, whereUsed, rename, gotoDefinition };
}
