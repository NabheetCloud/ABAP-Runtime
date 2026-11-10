// ABAP/DDIC type handling: built-in types, known data elements, SQL storage and OData (Edm) mapping.
// Internal (ABAP) value formats are used everywhere inside the runtime and the database:
//   d '20261103'  t '235959'  timestampl 20261103235959.1234567 (number)  uuid 32 hex upper  bool 'X' / ''
// Conversion to OData JSON happens only at the HTTP boundary.

const DATA_ELEMENTS = {
  sysuuid_x16: { t: 'uuid' }, sysuuid_c32: { t: 'c', len: 32 }, sysuuid_c36: { t: 'c', len: 36 },
  abp_creation_user: { t: 'c', len: 12 }, abp_lastchange_user: { t: 'c', len: 12 }, abp_locinst_lastchange_user: { t: 'c', len: 12 },
  syuname: { t: 'c', len: 12 }, uname: { t: 'c', len: 12 }, xubname: { t: 'c', len: 12 },
  abp_creation_tstmpl: { t: 'tsl' }, abp_lastchange_tstmpl: { t: 'tsl' }, abp_locinst_lastchange_tstmpl: { t: 'tsl' },
  timestampl: { t: 'tsl' }, timestamp: { t: 'ts' }, tzntstmpl: { t: 'tsl' }, tzntstmps: { t: 'ts' },
  abap_boolean: { t: 'bool' }, abap_bool: { t: 'bool' }, xfeld: { t: 'bool' }, boole_d: { t: 'bool' }, flag: { t: 'bool' },
  datum: { t: 'd' }, sydatum: { t: 'd' }, dats: { t: 'd' }, uzeit: { t: 't' }, syuzeit: { t: 't' },
  waers: { t: 'c', len: 5 }, waers_curc: { t: 'c', len: 5 }, waerk: { t: 'c', len: 5 }, land1: { t: 'c', len: 3 }, spras: { t: 'c', len: 1 },
  string: { t: 'string' }, xstring: { t: 'string' }, int4: { t: 'i' }, int8: { t: 'int8' }, int2: { t: 'i' }, int1: { t: 'i' },
  meins: { t: 'c', len: 3 }, msehi: { t: 'c', len: 3 },
};

export function resolveType(type) {
  // type: { name, len, dec } from the CDS parser
  const n = type.name;
  if (n.startsWith('abap.')) {
    const b = n.slice(5);
    switch (b) {
      case 'char': return { t: 'c', len: type.len ?? 1 };
      case 'numc': return { t: 'n', len: type.len ?? 1 };
      case 'string': case 'sstring': case 'rawstring': return { t: 'string', len: type.len };
      case 'int1': case 'int2': case 'int4': return { t: 'i' };
      case 'int8': return { t: 'int8' };
      case 'dec': case 'curr': case 'quan': case 'd16n': case 'd34n': case 'decfloat16': case 'decfloat34': return { t: 'p', len: type.len ?? 16, dec: type.dec ?? 0 };
      case 'fltp': return { t: 'f' };
      case 'dats': case 'datn': return { t: 'd' };
      case 'tims': case 'timn': return { t: 't' };
      case 'cuky': return { t: 'c', len: 5 };
      case 'unit': return { t: 'c', len: type.len ?? 3 };
      case 'lang': return { t: 'c', len: 1 };
      case 'clnt': return { t: 'clnt' };
      case 'raw': return type.len === 16 ? { t: 'uuid' } : { t: 'string' };
      case 'utclong': case 'utcl': return { t: 'tsl' };
      case 'accp': return { t: 'n', len: 6 };
      case 'boolean': return { t: 'bool' };
    }
    return { t: 'c', len: type.len ?? 255 };
  }
  if (DATA_ELEMENTS[n]) return { ...DATA_ELEMENTS[n] };
  return { t: 'c', len: type.len ?? 255, de: n };
}

export const isNumeric = ti => ['i', 'int8', 'p', 'f', 'tsl', 'ts'].includes(ti?.t);

export function sqlType(ti) {
  if (['i', 'int8'].includes(ti.t)) return 'INTEGER';
  if (['p', 'f', 'tsl', 'ts'].includes(ti.t)) return 'REAL';
  return 'TEXT';
}

export function initialValue(ti) { return isNumeric(ti) ? 0 : ''; }

export function edmType(ti) {
  switch (ti?.t) {
    case 'i': return 'Edm.Int32';
    case 'int8': return 'Edm.Int64';
    case 'p': return 'Edm.Decimal';
    case 'f': return 'Edm.Double';
    case 'd': return 'Edm.Date';
    case 't': return 'Edm.TimeOfDay';
    case 'tsl': case 'ts': return 'Edm.DateTimeOffset';
    case 'uuid': return 'Edm.Guid';
    case 'bool': return 'Edm.Boolean';
    default: return 'Edm.String';
  }
}

// internal -> OData JSON
export function toOData(v, ti) {
  if (v === null || v === undefined) v = initialValue(ti || {});
  switch (ti?.t) {
    case 'd': return /^\d{8}$/.test(String(v)) && v !== '00000000' ? `${String(v).slice(0, 4)}-${String(v).slice(4, 6)}-${String(v).slice(6)}` : null;
    case 't': return /^\d{6}$/.test(String(v)) ? `${String(v).slice(0, 2)}:${String(v).slice(2, 4)}:${String(v).slice(4)}` : null;
    case 'tsl': case 'ts': {
      const n = Number(v);
      if (!n) return null;
      const s = n.toFixed(3);
      const [a, frac] = s.split('.');
      if (a.length !== 14) return null;
      return `${a.slice(0, 4)}-${a.slice(4, 6)}-${a.slice(6, 8)}T${a.slice(8, 10)}:${a.slice(10, 12)}:${a.slice(12, 14)}${ti.t === 'tsl' ? '.' + frac : ''}Z`;
    }
    case 'uuid': {
      const s = String(v).replace(/-/g, '').toLowerCase();
      return s.length === 32 && !/^0+$/.test(s) ? `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}` : null;
    }
    case 'bool': return v === 'X' || v === true;
    case 'i': case 'int8': case 'p': case 'f': return Number(v) || 0;
    default: return v === null || v === undefined ? '' : String(v).replace(/ +$/, '');
  }
}

// OData JSON -> internal
export function fromOData(v, ti) {
  switch (ti?.t) {
    case 'd': return v ? String(v).replace(/-/g, '').slice(0, 8) : '';
    case 't': return v ? String(v).replace(/:/g, '').slice(0, 6) : '';
    case 'tsl': case 'ts': {
      if (!v) return 0;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return 0;
      const p = (n, l = 2) => String(n).padStart(l, '0');
      return Number(`${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`);
    }
    case 'uuid': return v ? String(v).replace(/-/g, '').toUpperCase() : '';
    case 'bool': return v === true || v === 'X' || v === 'true' ? 'X' : '';
    case 'i': case 'int8': return v === '' || v === null || v === undefined ? 0 : Math.trunc(Number(v));
    case 'p': case 'f': return v === '' || v === null || v === undefined ? 0 : Number(v);
    case 'n': return v === '' || v === null || v === undefined ? '' : String(v);
    default: return v === null || v === undefined ? '' : String(v);
  }
}

// normalise a value before it is written to the database
export function toDb(v, ti) {
  if (v === undefined || v === null) return initialValue(ti);
  if (typeof v === 'object') return JSON.stringify(v);
  switch (ti.t) {
    case 'n': { const s = String(v).replace(/ +$/, ''); return /^0*$/.test(s) ? '' : s.padStart(ti.len || s.length, '0').slice(-(ti.len || s.length)); } // all-zero NUMC is initial
    case 'i': case 'int8': return Math.trunc(Number(v) || 0);
    case 'p': return Number(Number(v || 0).toFixed(ti.dec ?? 2));
    case 'f': case 'tsl': case 'ts': return Number(v) || 0;
    case 'c': { const s = String(v).replace(/ +$/, ''); return ti.len ? s.slice(0, ti.len) : s; }
    default: return String(v);
  }
}
