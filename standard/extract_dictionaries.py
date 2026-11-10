#!/usr/bin/env python3
"""Reads S/4HANA data dictionary documents (markdown: pipe tables, pandoc simple and multi-line tables) and lists the
database tables with their key and other fields, and the CDS views with their source table, keys and fields.

    python3 standard/extract_dictionaries.py <doc.md> ... > standard/dictionaries.json

The result is the input of generate_transactional.py; nothing here is SAP's source, only names found in the documents.
"""
import json, re, sys

NAME = r'[A-Z][A-Z0-9_/]{1,29}'
TABLE_RE = re.compile(rf'^{NAME}$')
VIEW_RE = re.compile(r'^(?:I|C|P|R|A|E|X)_[A-Za-z0-9_]+$')
# words that look like table names in a table-name column but are not tables
NOT_TABLES = {'KEY', 'TABLE', 'FIELD', 'NOTE', 'NOTES', 'SEE', 'VERIFY', 'AREA', 'CDS', 'VIEW', 'OLD', 'NEW', 'SAP', 'ECC', 'S4', 'FI', 'CO', 'MM', 'SD', 'PP', 'PM',
              'QM', 'HR', 'AA', 'ML', 'GL', 'AP', 'AR', 'BP', 'PO', 'PR', 'GR', 'IR', 'GRIR', 'O2C', 'P2P', 'MANDT', 'CLIENT', 'MIRO', 'MIGO', 'VA01', 'ID', 'UUID', 'GUID',
              'NULL', 'HANA', 'ABAP', 'SQL', 'API', 'OK', 'TBD', 'YES', 'NO', 'X'}

tables, views = {}, {}

def tbl(name, desc=''):
    t = tables.setdefault(name, {'description': '', 'keys': [], 'fields': {}, 'sources': set()})
    if desc and not t['description']: t['description'] = desc.strip().rstrip('.')
    return t

def add_fields(t, names, key=False, meanings=None):
    for n in names:
        n = n.strip().upper()
        if not re.match(rf'^{NAME}$', n) or n in ('MANDT', 'CLIENT', 'RCLNT') or n in NOT_TABLES - {'ID'}: continue
        if key and n not in t['keys']: t['keys'].append(n)
        if n not in t['fields'] or (meanings and meanings.get(n) and not t['fields'][n]): t['fields'][n] = (meanings or {}).get(n, t['fields'].get(n, ''))

def tokens(text):
    """Field names in a cell: `BACKTICKED` names (also `A, B, C` lists), else comma / slash separated upper-case words
    (notes in parentheses dropped)."""
    ticked = []
    for span in re.findall(r'`([^`]+)`', text):
        ticked += [w.strip() for w in re.split(r'[,+]|\s+', span) if re.match(r'^[A-Za-z][A-Za-z0-9_/]*$', w.strip())]
    if ticked: return [t.upper() for t in ticked if t.upper() == t or t.isupper() or re.match(r'^[A-Z0-9_]+$', t.upper())]
    text = re.sub(r'\([^)]*\)', '', text)
    out = []
    for part in re.split(r'[,;]|\s+/\s+|\s\+\s', text):
        w = part.strip().rstrip('?.').split(' ')[0]
        if re.match(rf'^{NAME}$', w) and w.upper() == w: out.append(w)
    return out

def split_key_and_fields(cell):
    """'`MBLNR`, `MJAHR`; `BUDAT`, …' -> keys before ';', fields after."""
    if ';' in cell:
        head, rest = cell.split(';', 1)
        return tokens(head), tokens(rest)
    return [], tokens(cell)

def table_names(cell):
    names = []
    for part in re.split(r'\s*/\s*|\s*,\s*|\s+and\s+', re.sub(r'`', '', cell)):
        w = part.strip().split(' ')[0].rstrip('?*')
        if TABLE_RE.match(w) and w not in NOT_TABLES and not VIEW_RE.match(w): names.append(w)
    return names

# ------------------------------------------------------------------ pipe tables
def pipe_tables(lines, doc):
    i = 0
    while i < len(lines):
        if lines[i].startswith('|') and i + 1 < len(lines) and re.match(r'^\|[\s:|-]+\|$', lines[i + 1].strip()):
            head = [c.strip().lower() for c in lines[i].strip().strip('|').split('|')]
            rows = []
            j = i + 2
            while j < len(lines) and lines[j].startswith('|'):
                rows.append([c.strip() for c in lines[j].strip().strip('|').split('|')]); j += 1
            handle_pipe(head, rows, doc, lines, i)
            i = j
        else: i += 1

def col(head, *names):
    for n in names:
        for k, h in enumerate(head):
            if h.startswith(n): return k
    return None

def handle_pipe(head, rows, doc, lines, at):
    ti, di, ki, fi = col(head, 'table', 'source table', 'main source table'), col(head, 'description', 'purpose', 'meaning', 'infotype', 'area'), col(head, 'key'), col(head, 'important', 'fields', 'typical fields', 'common fields')
    if fi is None and ki is not None and 'common' in head[ki]: fi = ki
    cdsi = col(head, 'cds candidate', 'cds entity', 'cds view candidate')
    if cdsi is not None:      # CDS catalogue: entity | purpose | (source) | key concept
        kc = col(head, 'key concept', 'typical key')
        for r in rows:
            for v in re.findall(r'`?((?:I|C|A|P)_[A-Za-z0-9_]+)`?', r[cdsi] if cdsi < len(r) else ''):
                vv = views.setdefault(v, {'table': '', 'keys': [], 'fields': {}, 'description': ''})
                vv.setdefault('docs', set()).add(doc)
                if di is not None and di < len(r) and not vv['description']: vv['description'] = r[di].strip('` ')
                if kc is not None and kc < len(r) and not vv['keys']: vv['keys'] = [x.strip() for x in re.split(r'\+|,', re.sub(r'\([^)]*\)|`', '', r[kc])) if re.match(r'^[A-Za-z][A-Za-z0-9_]*$', x.strip())]
        return
    vi = col(head, 'cds view', 'view', 'released view')
    if vi is not None and ti is not None:      # view <-> table <-> keys
        for r in rows:
            if len(r) <= max(vi, ti): continue
            for v in re.findall(r'(?:I|C)_[A-Za-z0-9_]+', r[vi]):
                vv = views.setdefault(v, {'table': '', 'keys': [], 'fields': {}, 'description': ''})
                tn = table_names(r[ti])
                if tn and not vv['table']: vv['table'] = tn[0]
                if ki is not None and ki < len(r): vv['keys'] += [k.strip() for k in re.split(r',|\+', re.sub(r'\([^)]*\)', '', r[ki])) if re.match(r'^[A-Za-z][A-Za-z0-9_]*$', k.strip()) and k.strip() not in vv['keys']]
        return
    if head[:2] == ['table field', 'cds field']:   # field mapping: the caption above names "TABLE → View"
        cap = next((lines[k] for k in range(at - 1, max(at - 4, -1), -1) if '→' in lines[k]), '')
        m = re.search(r'\*\*\s*([A-Z0-9_/]+)\s*→\s*([A-Za-z0-9_]+)', cap)
        if not m: return
        vv = views.setdefault(m.group(2), {'table': m.group(1), 'keys': [], 'fields': {}, 'description': ''})
        vv['table'] = vv['table'] or m.group(1)
        for r in rows:
            if len(r) < 2: continue
            tf = [x.strip() for x in r[0].split('/')]
            cf = [x.strip() for x in r[1].split('/')]
            for a, b in zip(tf, cf):
                b = b.split(' ')[0]
                if re.match(rf'^{NAME}$', a) and re.match(r'^[A-Za-z][A-Za-z0-9_]*$', b): vv['fields'][a] = b
        return
    if ti is None: return
    for r in rows:
        if len(r) <= ti: continue
        for name in table_names(r[ti]):
            t = tbl(name, r[di] if di is not None and di < len(r) else '')
            t['sources'].add(doc)
            if ki is not None and ki < len(r): add_fields(t, tokens(r[ki]), key=True)
            if fi is not None and fi < len(r): add_fields(t, tokens(r[fi]))

# ------------------------------------------------------------------ pandoc tables: section "--- `TAB`" with "`FIELD`  Meaning  Notes" rows
def section_tables(lines, doc):
    cur = None
    for ln in lines:
        h = re.match(r'^#+\s.*?---\s*`([A-Z0-9_/]+)`', ln) or re.match(r'^###\s+()([A-Z][A-Z0-9_/]+)\s+[—–-]\s+(.*)$', ln)
        if h and h.lastindex == 3:
            cur = tbl(h.group(2), h.group(3)); cur['sources'].add(doc); continue
        if h:
            cur = tbl(h.group(1), re.sub(r'^#+\s*[\d.]*\s*', '', ln.split('---')[0]).strip()); cur['sources'].add(doc); continue
        if ln.startswith('#'): cur = None if not re.match(r'^#+\s.*`[A-Z0-9_]+`', ln) else cur; continue
        if cur is None: continue
        k = re.match(r'^\*\*Key:\*\*(.*)', ln)
        if k: add_fields(cur, tokens(k.group(1)), key=True); continue
        pm = re.match(r'^\|\s*([A-Z][A-Z0-9_/]*)\s*\|\s*(.*?)\s*\|\s*$', ln)
        if pm and pm.group(1) not in ('FIELD',):
            add_fields(cur, [pm.group(1)], meanings={pm.group(1): pm.group(2)}); continue
        m = re.match(r'^\s{2,}`([A-Z][A-Z0-9_/]*)`\s{2,}(.*?)(?:\s{2,}(.*))?$', ln)
        if m:
            meaning = m.group(2).strip()
            add_fields(cur, [m.group(1)], key='key' in (m.group(3) or '').lower() and m.group(1) not in cur['keys'] and len(cur['keys']) < 8 and (m.group(3) or '').strip().lower().startswith('key'), meanings={m.group(1): meaning})

# ------------------------------------------------------------------ CDS sections: ### I_Entity, representative elements, key concept, associations
def cds_sections(lines, doc):
    cur, mode = [], None
    for ln in lines:
        h = re.match(r'^###\s+`?((?:I|C|A|P)_[A-Za-z0-9_]+)`?(.*)$', ln)
        if h:
            names = [h.group(1)] + re.findall(r'(?:I|C|A|P)_[A-Za-z0-9_]+', h.group(2))
            if re.search(r'/\s*Item', h.group(2)): names.append(h.group(1) + 'Item')
            cur = [views.setdefault(v, {'table': '', 'keys': [], 'fields': {}, 'description': ''}) for v in names]
            for v in cur: v.setdefault('docs', set()).add(doc)
            mode = None
            continue
        if ln.startswith('#'): cur, mode = [], None; continue
        if not cur: continue
        low = ln.lower()
        names = re.findall(r'`([A-Za-z_][A-Za-z0-9_]*)`', ln)
        if low.startswith('representative elements') or low.startswith('header representative') or low.startswith('item representative'):
            mode = 'el'
            target = cur[1:] if low.startswith('item') and len(cur) > 1 else cur[:1]
            for v in target: v.setdefault('elements', []).extend(n for n in names if not n.startswith('_') and n not in v.get('elements', []))
            continue
        if low.startswith('key concept'):
            mode = None
            if not cur[0]['keys']: cur[0]['keys'] = [n for n in names if not n.startswith('_')] or [x.strip(' .`') for x in re.split(r'\+|,', ln.split(':', 1)[1]) if x.strip(' .`')]
            continue
        if low.startswith('associations'):
            mode = None
            for v in cur: v.setdefault('associations', []).extend(n for n in names if n.startswith('_'))
            continue
        if mode == 'el' and re.match(r'^\s*[-*]\s', ln):
            for v in cur[:1]: v.setdefault('elements', []).extend(n for n in names if not n.startswith('_'))
        elif ln.strip() and not re.match(r'^\s*[-*]\s', ln): mode = None

# ------------------------------------------------------------------ pandoc multi-line tables (records separated by blank lines)
def multiline_tables(lines, doc):
    i = 0
    while i < len(lines):
        if re.match(r'^\s*-{10,}\s*$', lines[i]) and i + 2 < len(lines):
            # header line(s) then a line of dashes with gaps (column widths)
            j = i + 1
            while j < len(lines) and not re.match(r'^\s*-+(\s+-+)+\s*$', lines[j]): j += 1
            if j >= len(lines) or j - i > 4: i += 1; continue
            header = ' '.join(lines[i + 1:j]).lower()
            spans = [(m.start(), m.end()) for m in re.finditer(r'-+', lines[j])]
            k = j + 1
            rec = []
            def flush():
                if not rec: return
                cells = [' '.join(l[a:(spans[c + 1][0] if c + 1 < len(spans) else None)].strip() for l in rec) for c, (a, _) in enumerate(spans)]
                handle_record(header, cells, doc)
            while k < len(lines) and not re.match(r'^\s*-{10,}\s*$', lines[k]):
                if not lines[k].strip(): flush(); rec = []
                else: rec.append(lines[k])
                k += 1
            flush()
            i = k + 1
        else: i += 1

def handle_record(header, cells, doc):
    first = cells[0]
    if header.startswith('cds view') or header.startswith('view') or 'cds view' in header.split('  ')[0]:
        for v in re.findall(r'`((?:I|C)_[A-Za-z0-9_]+)`', first):
            vv = views.setdefault(v, {'table': '', 'keys': [], 'fields': {}, 'description': ''})
            if len(cells) > 1 and not vv['description']: vv['description'] = cells[1]
            if len(cells) > 2: vv.setdefault('cds_fields', []).extend(re.findall(r'`([A-Z][A-Za-z0-9_]*)`', cells[2]))
        return
    if not (header.startswith('table') or header.startswith('object')): return
    for name in table_names(first):
        t = tbl(name, cells[1] if len(cells) > 1 else '')
        t['sources'].add(doc)
        if len(cells) > 2:
            keys, rest = split_key_and_fields(cells[2])
            add_fields(t, keys, key=True)
            add_fields(t, rest)

for path in sys.argv[1:]:
    lines = open(path, encoding='utf-8').read().split('\n')
    doc = path.split('/')[-1]
    pipe_tables(lines, doc)
    section_tables(lines, doc)
    multiline_tables(lines, doc)
    cds_sections(lines, doc)

for t in tables.values(): t['sources'] = sorted(t['sources'])
for v in views.values():
    if 'docs' in v: v['docs'] = sorted(v['docs'])
    if 'elements' in v: v['elements'] = list(dict.fromkeys(v['elements']))
json.dump({'tables': dict(sorted(tables.items())), 'views': dict(sorted(views.items()))}, sys.stdout, indent=1, ensure_ascii=False)
