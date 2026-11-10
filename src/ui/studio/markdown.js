// The studio's small Markdown renderer (chat answers, docs, exercises): code blocks, `code`, **bold**, headings, lists,
// tables, links. Everything is escaped first.
// links: 'html' (Build mode, docs) or 'text' (the data assistant's answers): in 'text' mode a link is shown as its
// label and its full address as plain text, never as a clickable element, so text from the assistant cannot lead to a
// one-click request to another host.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function md(src, { links = 'html' } = {}) {
  const blocks = [];
  let s = src.replace(/```(\w*)\n([\s\S]*?)```/g, (_, l, c) => { blocks.push(`<pre><code>${esc(c.replace(/\n$/, ''))}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  const link = links === 'text'
    ? (_, label, url) => `${label} (<span class="md-url">${url}</span>)`
    : (_, label, url) => `<a href="${url}" target="_blank">${label}</a>`;
  const inline = t => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, link);
  const out = [];
  const lines = s.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\u0000\d+\u0000$/.test(l.trim())) { out.push(blocks[Number(l.trim().slice(1, -1))]); continue; }
    if (/^#{1,4} /.test(l)) { out.push(`<p><strong>${inline(l.replace(/^#+ /, ''))}</strong></p>`); continue; }
    if (/^\s*[-*] /.test(l)) { const items = []; while (i < lines.length && /^\s*[-*] /.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*[-*] /, ''))}</li>`); i--; out.push(`<ul>${items.join('')}</ul>`); continue; }
    if (/^\s*\d+\. /.test(l)) { const items = []; while (i < lines.length && /^\s*\d+\. /.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*\d+\. /, ''))}</li>`); i--; out.push(`<ol>${items.join('')}</ol>`); continue; }
    if (/^\|.*\|$/.test(l.trim())) { const rows = []; while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { if (!/^\|[\s:-]+\|/.test(lines[i].trim().replace(/\|[\s:-]*(?=\|)/g, '|-'))) rows.push(lines[i]); i++; } i--; out.push(`<table>${rows.filter(r => !/^\|\s*-/.test(r.trim())).map(r => `<tr>${r.trim().slice(1, -1).split('|').map(c => `<td>${inline(c.trim())}</td>`).join('')}</tr>`).join('')}</table>`); continue; }
    if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, n) => blocks[n]);
}

