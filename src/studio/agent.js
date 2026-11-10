// Bridge between the studio chat and the local Claude Code CLI.
// Each message runs `claude -p ... --output-format stream-json` inside the app folder; the CLI reads the app's
// CLAUDE.md (platform rules), edits the RAP sources and checks its work with `rap check` / `rap run`.
// The conversation continues across messages with --resume <session id>. History is kept in .rap/chat.json.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function findClaude() {
  if (process.env.RAP_CLAUDE_BIN) return process.env.RAP_CLAUDE_BIN;
  try { return execFileSync('/bin/sh', ['-lc', 'command -v claude'], { encoding: 'utf8' }).trim() || 'claude'; }
  catch { return 'claude'; }
}

export class AgentSession {
  constructor(appDir, { rapBin, port, extraDirs = [], model } = {}) {
    this.dir = appDir;
    this.file = path.join(appDir, '.rap', 'chat.json');
    this.rapBin = rapBin;
    this.port = port;
    this.extraDirs = extraDirs;
    this.model = model;
    this.proc = null;
    this.subscribers = new Set();
    this.state = this.load();
  }
  load() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch { return { sessionId: null, items: [], runs: 0, costUsd: 0 }; }
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.state, null, 1));
  }
  get running() { return !!this.proc; }
  history() { return { ...this.state, running: this.running }; }
  subscribe(fn) { this.subscribers.add(fn); return () => this.subscribers.delete(fn); }
  emit(ev) { for (const fn of this.subscribers) { try { fn(ev); } catch {} } }
  push(item) { this.state.items.push(item); this.emit({ type: 'item', id: this.state.items.length - 1, item }); return item; }

  stop() {
    if (!this.proc) return false;
    this.proc.kill('SIGTERM');
    return true;
  }

  run(message, { onDone, display, attachments } = {}) {
    if (this.proc) throw Object.assign(new Error('The agent is already working on this app'), { status: 409 });
    const bin = findClaude();
    const allowed = [
      'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'TodoWrite', 'LS',
      `Bash(node ${this.rapBin}:*)`,
      `Bash(curl -s http://localhost:${this.port}:*)`,
      `Bash(curl -s 'http://localhost:${this.port}:*)`,
      `Bash(curl -s "http://localhost:${this.port}:*)`,
      `Bash(curl -s -X POST 'http://localhost:${this.port}:*)`,
      `Bash(curl -s -X PATCH 'http://localhost:${this.port}:*)`,
      `Bash(curl -s -X DELETE 'http://localhost:${this.port}:*)`,
      `Bash(curl -s -X POST http://localhost:${this.port}:*)`,
      `Bash(curl -s -X PATCH http://localhost:${this.port}:*)`,
      `Bash(curl -s -X DELETE http://localhost:${this.port}:*)`,
      'Bash(ls:*)', 'Bash(mkdir:*)', 'Bash(sleep:*)', 'Bash(cd:*)',
      // reading sources and data, the rap command line (check, test, run, odata, catalog, events) and syntax checks
      'Bash(rap:*)', 'Bash(cat:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(wc:*)', 'Bash(grep:*)', 'Bash(find:*)',
      'Bash(sort:*)', 'Bash(diff:*)', 'Bash(pwd)', 'Bash(echo:*)', 'Bash(node --check:*)', 'Bash(xmllint --noout:*)',
      'Bash(sqlite3 -readonly:*)', 'Bash(cp:*)', 'Bash(mv:*)', 'Bash(sed -n:*)',
    ];
    const args = ['-p', message, '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      // acceptEdits, not bypassPermissions: file edits in the app's folders are allowed, and only the commands listed
      // above run (bypassPermissions would allow every command, also one an attachment or a source talks it into)
      '--permission-mode', 'acceptEdits', '--allowedTools', ...allowed];
    for (const d of this.extraDirs) args.push('--add-dir', d);
    if (this.state.sessionId) args.push('--resume', this.state.sessionId);
    if (this.model) args.push('--model', this.model);

    this.push({ role: 'user', text: display ?? message, ...(attachments?.length ? { attachments } : {}), at: new Date().toISOString() });
    const run = { role: 'run', at: new Date().toISOString(), status: 'running' };
    this.push(run);
    this.state.runs++;
    this.save();

    const started = Date.now();
    const proc = spawn(bin, args, { cwd: this.dir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, RAP_STUDIO: '1', RAP_PORT: String(this.port), RAP_APP: path.basename(this.dir) } });
    this.proc = proc;
    let buf = '';
    let current = null;        // assistant text item being streamed
    const tools = new Map();   // tool_use id -> item
    const blocks = new Map();  // content block index -> { item, json } while a tool call is being generated
    let stderr = '';

    const textItem = () => {
      if (!current) current = this.push({ role: 'assistant', text: '' });
      return current;
    };
    proc.stdout.on('data', chunk => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        this.handle(ev, { textItem, tools, blocks, run, resetText: () => { current = null; } });
      }
    });
    proc.stderr.on('data', c => { stderr += c; });
    proc.on('error', err => {
      console.error(`[rap] could not start the agent CLI (${bin}): ${err.message}`);
      this.push({ role: 'error', text: 'The AI agent could not be started on this machine. Ask your administrator to install and sign in to the agent CLI (see the server log).' });
    });
    proc.on('close', code => {
      this.proc = null;
      run.status = code === 0 ? 'done' : (run.status === 'running' ? 'stopped' : run.status);
      run.ms = Date.now() - started;
      if (code !== 0 && stderr.trim()) this.push({ role: 'error', text: stderr.trim().split('\n').slice(-6).join('\n') });
      this.save();
      this.emit({ type: 'end', run });
      onDone?.(run);
    });
  }

  // partial tool input -> file name and the code generated so far
  live(b) {
    const it = b.item;
    const file = partialString(b.json, 'file_path', true);
    if (file) it.file = rel(this.dir, file);
    it.code = partialString(b.json, it.name === 'Write' ? 'content' : 'new_string') ?? it.code;
    this.emit({ type: 'live', id: this.state.items.indexOf(it), file: it.file, code: it.code });
  }

  handle(ev, ctx) {
    if (ev.session_id && ev.session_id !== this.state.sessionId) { this.state.sessionId = ev.session_id; }
    switch (ev.type) {
      case 'stream_event': {
        const e = ev.event;
        if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
          const it = ctx.textItem();
          it.text += e.delta.text;
          this.emit({ type: 'delta', id: this.state.items.indexOf(it), text: e.delta.text });
        }
        if (e?.type === 'message_start') { ctx.resetText(); ctx.blocks.clear(); }
        // the model's thinking, streamed into the chat
        if (e?.type === 'content_block_start' && e.content_block?.type === 'thinking' && !ev.parent_tool_use_id) {
          ctx.resetText();
          ctx.blocks.set(e.index, { item: this.push({ role: 'thinking', text: '', status: 'running', at: Date.now() }) });
        }
        if (e?.type === 'content_block_delta' && e.delta?.type === 'thinking_delta') {
          const b = ctx.blocks.get(e.index);
          if (b?.item.role === 'thinking') { b.item.text += e.delta.thinking || ''; this.emit({ type: 'delta', id: this.state.items.indexOf(b.item), text: e.delta.thinking || '' }); }
        }
        if (e?.type === 'content_block_stop') {
          const b = ctx.blocks.get(e.index);
          if (b?.item.role === 'thinking') { b.item.status = 'done'; b.item.ms = Date.now() - b.item.at; this.emit({ type: 'update', id: this.state.items.indexOf(b.item), item: b.item }); }
        }
        // stream the file a Write/Edit is generating, so the user watches the ABAP/CDS being written
        if (e?.type === 'content_block_start' && e.content_block?.type === 'tool_use' && !ev.parent_tool_use_id) {
          ctx.resetText();
          const item = this.push({ role: 'tool', id: e.content_block.id, name: e.content_block.name, summary: e.content_block.name, status: 'writing' });
          ctx.tools.set(e.content_block.id, item);
          ctx.blocks.set(e.index, { item, json: '', last: 0 });
        }
        if (e?.type === 'content_block_delta' && e.delta?.type === 'input_json_delta') {
          const b = ctx.blocks.get(e.index);
          if (!b) return;
          b.json += e.delta.partial_json || '';
          if (!/^(Write|Edit|MultiEdit)$/.test(b.item.name)) return;
          const now = Date.now();
          if (now - b.last < 120) return;
          b.last = now;
          this.live(b);
        }
        if (e?.type === 'content_block_stop') { const b = ctx.blocks.get(e.index); if (b && /^(Write|Edit|MultiEdit)$/.test(b.item.name)) this.live(b); }
        return;
      }
      case 'assistant': {
        for (const c of ev.message?.content || []) {
          if (c.type === 'text') {
            const it = ctx.textItem();
            if (it.text.trim() !== c.text.trim()) { it.text = c.text; this.emit({ type: 'replace', id: this.state.items.indexOf(it), text: c.text }); }
            ctx.resetText();
          } else if (c.type === 'tool_use') {
            ctx.resetText();
            const fields = { name: c.name, summary: summarize(c.name, c.input, this.dir), file: fileOf(c.input, this.dir), status: 'running', code: codeOf(c.name, c.input), command: c.name === 'Bash' ? clean(c.input?.command, this.dir) : undefined };
            const known = ctx.tools.get(c.id);
            if (known) { Object.assign(known, fields); this.emit({ type: 'update', id: this.state.items.indexOf(known), item: known }); }
            else ctx.tools.set(c.id, this.push({ role: 'tool', id: c.id, ...fields }));
          }
        }
        return;
      }
      case 'user': {
        for (const c of ev.message?.content || []) {
          if (c.type !== 'tool_result') continue;
          const item = ctx.tools.get(c.tool_use_id);
          if (!item) continue;
          item.status = c.is_error ? 'error' : 'done';
          const text = Array.isArray(c.content) ? c.content.map(x => x.text || '').join('\n') : String(c.content ?? '');
          if (item.name === 'Bash' || c.is_error) item.output = text.slice(0, 4000);
          this.emit({ type: 'update', id: this.state.items.indexOf(item), item });
        }
        this.save();
        return;
      }
      case 'result': {
        ctx.run.status = ev.is_error ? 'error' : 'done';
        ctx.run.costUsd = ev.total_cost_usd;
        ctx.run.turns = ev.num_turns;
        this.state.costUsd = (this.state.costUsd || 0) + (ev.total_cost_usd || 0);
        if (ev.is_error && ev.result) this.push({ role: 'error', text: String(ev.result) });
        this.save();
        return;
      }
    }
  }
}

function rel(dir, p) {
  if (!p || !path.isAbsolute(p)) return p;
  let real = dir; try { real = fs.realpathSync(dir); } catch {}
  // the CLI may report the resolved path (macOS: /var -> /private/var)
  const base = p.startsWith(real + path.sep) ? real : dir;
  return path.relative(base, p);
}
function fileOf(input, dir) { const p = input?.file_path || input?.path; return p ? rel(dir, p) : null; }
function clean(cmd = '', dir) { return cmd.split(dir + '/').join('').split(dir).join('.').replace(/node \S+rap\.js/g, 'rap'); }
function codeOf(name, input = {}) {
  if (name === 'Write') return String(input.content ?? '').slice(0, 30000);
  if (name === 'Edit') return String(input.new_string ?? '').slice(0, 8000);
  if (name === 'MultiEdit') return (input.edits || []).map(e => e.new_string).join('\n…\n').slice(0, 8000);
  return undefined;
}
// value of a JSON string property in an incomplete JSON text (tool input still streaming)
export function partialString(json, key, complete = false) {
  const m = new RegExp(`"${key}"\\s*:\\s*"`).exec(json);
  if (!m) return null;
  let out = '';
  for (let i = m.index + m[0].length; i < json.length; i++) {
    const ch = json[i];
    if (ch === '"') return out;
    if (ch !== '\\') { out += ch; continue; }
    const n = json[++i];
    if (n === undefined) break;
    if (n === 'u') { const h = json.slice(i + 1, i + 5); if (h.length < 4) break; out += String.fromCharCode(parseInt(h, 16)); i += 4; continue; }
    out += { n: '\n', t: '\t', r: '', b: '\b', f: '\f' }[n] ?? n;
  }
  return complete ? null : out;
}
function summarize(name, input = {}, dir) {
  switch (name) {
    case 'Write': return `Created ${rel(dir, input.file_path)}`;
    case 'Edit': case 'MultiEdit': return `Edited ${rel(dir, input.file_path)}`;
    case 'Read': return `Read ${rel(dir, input.file_path)}`;
    case 'Bash': return clean(input.command, dir) || 'Shell command';
    case 'Glob': return `Searched files ${input.pattern}`;
    case 'Grep': return `Searched for "${input.pattern}"`;
    case 'TodoWrite': return `Plan: ${(input.todos || []).map(t => `${t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '▸' : '○'} ${t.content}`).join(' · ')}`;
    case 'LS': return `Listed ${rel(dir, input.path)}`;
    default: return name;
  }
}
