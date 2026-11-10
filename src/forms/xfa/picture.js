// XFA picture clauses: date{…}, time{…}, datetime{…}, num{…}, text{…} and the locale's predefined ones
// (date.short / medium / long / full, time.*, datetime.*): formatting values for display and parsing data values.
const MONTHS = (locale, style) => Array.from({ length: 12 }, (_, m) => new Intl.DateTimeFormat(locale, { month: style, timeZone: 'UTC' }).format(Date.UTC(2024, m, 15)));
const DAYS = (locale, style) => Array.from({ length: 7 }, (_, d) => new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC' }).format(Date.UTC(2024, 0, 7 + d)));   // Sunday first
const bcp = locale => String(locale || 'en_US').replace('_', '-');

// an initial ABAP date (00000000, 0000-00-00): printed blank, as on SAP's screens and lists
export const isInitialDate = v => /^0{4}-?0{2}-?0{2}$/.test(String(v ?? '').trim());
// a data value -> { y, m, d } / { h, mi, s }: ISO (2024-11-01, 13:30:00), ABAP (20241101, 133000), ISO date time
export function parseDate(v, picture) {
  const s = String(v ?? '').trim();
  if (!s || /^0+$/.test(s.replace(/\D/g, ''))) return null;
  let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
  if (picture && /D+.*M+|M+.*D+/.test(picture)) {   // a data picture such as DD.MM.YYYY
    const order = [...picture.matchAll(/Y+|M+|D+/g)].map(x => x[0][0]);
    const nums = s.match(/\d+/g);
    if (nums?.length >= 3 && !/^\d{8}$/.test(s)) { const o = {}; order.forEach((k, i) => { o[k] = Number(nums[i]); }); return { y: o.Y < 100 ? 2000 + o.Y : o.Y, m: o.M, d: o.D }; }
  }
  if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  return m ? { y: Number(m[3]), m: Number(m[2]), d: Number(m[1]) } : null;
}
export function parseTime(v) {
  const s = String(v ?? '').trim();
  const m = /(?:T|^|\s)(\d{2}):?(\d{2}):?(\d{2})?/.exec(s);
  return m ? { h: Number(m[1]), mi: Number(m[2]), s: Number(m[3] || 0) } : null;
}

function fmtDate(d, pat, locale) {
  if (!d) return '';
  const L = bcp(locale), dow = new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay();
  const doy = Math.round((Date.UTC(d.y, d.m - 1, d.d) - Date.UTC(d.y, 0, 1)) / 86400000) + 1;
  return pat.replace(/'([^']*)'|YYYY|YY|MMMM|MMM|MM|M|DD|D|EEEE|EEE|E|JJJ|J/g, (t, lit) => {
    if (lit !== undefined) return lit;
    switch (t) {
      case 'YYYY': return String(d.y).padStart(4, '0');
      case 'YY': return String(d.y % 100).padStart(2, '0');
      case 'MMMM': return MONTHS(L, 'long')[d.m - 1];
      case 'MMM': return MONTHS(L, 'short')[d.m - 1].replace(/\.$/, '');
      case 'MM': return String(d.m).padStart(2, '0');
      case 'M': return String(d.m);
      case 'DD': return String(d.d).padStart(2, '0');
      case 'D': return String(d.d);
      case 'EEEE': return DAYS(L, 'long')[dow];
      case 'EEE': return DAYS(L, 'short')[dow].replace(/\.$/, '');
      case 'E': return String(dow + 1);
      case 'JJJ': return String(doy).padStart(3, '0');
      case 'J': return String(doy);
      default: return t;
    }
  });
}
function fmtTime(t, pat) {
  if (!t) return '';
  return pat.replace(/'([^']*)'|HH|H|hh|h|KK|K|kk|k|MM|M|SS|S|A/g, (x, lit) => {
    if (lit !== undefined) return lit;
    const h12 = t.h % 12 || 12;
    switch (x) {
      case 'HH': return String(t.h).padStart(2, '0');
      case 'H': return String(t.h);
      case 'hh': return String(h12).padStart(2, '0');
      case 'h': return String(h12);
      case 'KK': return String(t.h % 12).padStart(2, '0');
      case 'K': return String(t.h % 12);
      case 'kk': return String(t.h || 24).padStart(2, '0');
      case 'k': return String(t.h || 24);
      case 'MM': return String(t.mi).padStart(2, '0');
      case 'M': return String(t.mi);
      case 'SS': return String(t.s).padStart(2, '0');
      case 'S': return String(t.s);
      case 'A': return t.h < 12 ? 'AM' : 'PM';
      default: return x;
    }
  });
}
// num{zzz,zz9.99}, num{$z,zz9.99}, num.integer{}, num.decimal{}, num.currency{}, num.percent{}
function fmtNum(v, pat, locale) {
  const n = Number(String(v ?? '').replace(/\s/g, ''));
  if (v === '' || v === null || v === undefined || Number.isNaN(n)) return String(v ?? '');
  const L = bcp(locale);
  if (!pat) return new Intl.NumberFormat(L, { maximumFractionDigits: 10 }).format(n);
  const dot = pat.indexOf('.') >= 0 ? pat.indexOf('.') : pat.indexOf('v') >= 0 ? pat.indexOf('v') : -1;
  const frac = dot < 0 ? 0 : (pat.slice(dot + 1).match(/[9zZ8]/g) || []).length;
  const minFrac = dot < 0 ? 0 : (pat.slice(dot + 1).match(/9/g) || []).length;
  const intPart = dot < 0 ? pat : pat.slice(0, dot);
  const grouping = /,/.test(intPart);
  const minInt = Math.max((intPart.match(/9/g) || []).length, 0);
  const parts = new Intl.NumberFormat(L, { useGrouping: grouping, minimumFractionDigits: minFrac, maximumFractionDigits: frac, minimumIntegerDigits: Math.max(1, minInt) }).formatToParts(Math.abs(n));
  let s = parts.map(p => p.value).join('');
  if (minInt === 0 && /^0(?:\D|$)/.test(s) && Math.abs(n) < 1 && minFrac === 0 && frac === 0) s = '';
  const sign = n < 0 ? (/\(/.test(pat) ? ['(', ')'] : /CR/.test(pat) ? ['', ' CR'] : ['-', '']) : ['', ''];
  const cur = /\$/.test(pat) ? new Intl.NumberFormat(L, { style: 'currency', currency: currencyOf(L) }).formatToParts(0).find(p => p.type === 'currency')?.value || '$' : '';
  const pct = /%/.test(pat) ? '%' : '';
  const lead = pat.match(/^[^9zZ8,.(-]*/)?.[0].replace(/[$%]/g, '').replace(/'([^']*)'/g, '$1') || '';
  return `${sign[0]}${lead}${cur}${s}${pct}${sign[1]}`;
}
const currencyOf = L => ({ 'en-US': 'USD', 'en-GB': 'GBP', 'en-IN': 'INR', 'ja-JP': 'JPY', 'zh-CN': 'CNY' }[L] || (/-(DE|FR|IT|ES|NL|AT|BE|FI|IE|PT)$/.test(L) ? 'EUR' : 'USD'));
const PREDEF = {
  date: { short: { dateStyle: 'short' }, medium: { dateStyle: 'medium' }, long: { dateStyle: 'long' }, full: { dateStyle: 'full' }, default: { dateStyle: 'medium' } },
  time: { short: { timeStyle: 'short' }, medium: { timeStyle: 'medium' }, long: { timeStyle: 'medium' }, full: { timeStyle: 'medium' }, default: { timeStyle: 'medium' } },
};

// a value formatted with a picture clause (display); kind: the value's type (date, time, dateTime, decimal, …)
export function formatPicture(value, picture, locale = 'en_US', kind = 'text') {
  const pic = String(picture || '').trim();
  const v = value ?? '';
  if (!pic) {
    if (kind === 'date') { const d = parseDate(v); return d ? fmtDate(d, 'YYYY-MM-DD', locale) : isInitialDate(v) ? '' : String(v); }
    if (kind === 'time') { const t = parseTime(v); return t ? fmtTime(t, 'HH:MM:SS') : String(v); }
    if (kind === 'decimal' || kind === 'float') return v === '' ? '' : fmtNum(v, null, locale);
    return String(v);
  }
  // several alternatives: the first one
  const first = pic.split('|')[0].trim();
  const m = /^(date|time|datetime|num|text|zero|null)(?:\.(\w+))?(?:\(([\w_-]+)\))?\{(.*)\}$/s.exec(first);
  if (!m) return String(v);
  const [, cat, style, loc, pat] = m;
  const L = loc || locale;
  if (cat === 'date') {
    const d = parseDate(v);
    if (!d) return isInitialDate(v) ? '' : String(v);
    if (style) return new Intl.DateTimeFormat(bcp(L), { ...(PREDEF.date[style] || PREDEF.date.default), timeZone: 'UTC' }).format(Date.UTC(d.y, d.m - 1, d.d));
    return fmtDate(d, pat, L);
  }
  if (cat === 'time') {
    const t = parseTime(v);
    if (!t) return String(v);
    if (style) return new Intl.DateTimeFormat(bcp(L), { ...(PREDEF.time[style] || PREDEF.time.default), timeZone: 'UTC' }).format(Date.UTC(2000, 0, 1, t.h, t.mi, t.s));
    return fmtTime(t, pat);
  }
  if (cat === 'datetime') {
    const d = parseDate(v), t = parseTime(String(v).replace(/^\d{4}-?\d{2}-?\d{2}/, ''));
    if (!d) return String(v);
    const ms = Date.UTC(d.y, d.m - 1, d.d, t?.h || 0, t?.mi || 0, t?.s || 0);
    if (style || !pat) return new Intl.DateTimeFormat(bcp(L), { dateStyle: { short: 'short', medium: 'medium', long: 'long', full: 'full' }[style] || 'medium', timeStyle: { full: 'long', long: 'medium' }[style] || 'short', timeZone: 'UTC' }).format(ms);
    const [dp, tp = ''] = pat.split('T');
    return `${fmtDate(d, dp, L)}${tp ? ` ${fmtTime(t || { h: 0, mi: 0, s: 0 }, tp)}` : ''}`;
  }
  if (cat === 'num') {
    if (style === 'integer') return fmtNum(v, 'z,zzz,zzz,zz9', L);
    if (style === 'decimal') return fmtNum(v, 'z,zzz,zzz,zz9.99', L);
    if (style === 'currency') return fmtNum(v, '$z,zzz,zzz,zz9.99', L);
    if (style === 'percent') return fmtNum(Number(v) * 100, 'z,zz9%', L);
    return fmtNum(v, pat, L);
  }
  if (cat === 'text') {   // text{999-999}: 9 digit, A letter, X any, O/0 alnum; others literal
    const chars = [...String(v)];
    let i = 0;
    return pat.replace(/'([^']*)'|[9AXO0]/g, (t, lit) => (lit !== undefined ? lit : chars[i++] ?? ''));
  }
  if (cat === 'zero') return Number(v) === 0 ? pat : null;
  if (cat === 'null') return v === '' ? pat : null;
  return String(v);
}
