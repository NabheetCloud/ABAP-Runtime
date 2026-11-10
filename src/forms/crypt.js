// PDF encryption: the standard security handler, AES-256 (V 5, R 6, PDF 2.0 / Acrobat X and later): a document
// password (needed to open the PDF) and / or a permissions password with restrictions (printing, changing, copying,
// filling in, …). Every string and stream of the document is encrypted with the file key (AES-256-CBC, a random IV in
// front); the Encrypt dictionary carries the key, encrypted under each password (U / UE, O / OE), and the
// permissions (P, Perms).
import crypto from 'node:crypto';

// permissions (PDF 32000-2, table 22) by name
const BITS = { print: 3, modify: 4, copy: 5, annotate: 6, fill: 9, accessibility: 10, assemble: 11, printHigh: 12 };
export const PERMISSIONS = Object.keys(BITS);
export function permissionValue(allowed = PERMISSIONS) {
  let p = 0xfffff0c0;   // reserved bits 7, 8 and 13-32 set
  for (const a of allowed) { if (!(a in BITS)) throw new Error(`Unknown permission ${a} (${PERMISSIONS.join(', ')})`); p |= 1 << (BITS[a] - 1); }
  return p | 0;   // as a signed 32-bit number
}
const pw = s => Buffer.from(String(s ?? '').normalize('NFKC'), 'utf8').subarray(0, 127);
const aes = (mode, key, iv, data, pad) => { const c = crypto.createCipheriv(mode, key, iv); c.setAutoPadding(pad); return Buffer.concat([c.update(data), c.final()]); };
const unaes = (key, data) => { const d = crypto.createDecipheriv('aes-256-cbc', key, Buffer.alloc(16)); d.setAutoPadding(false); return Buffer.concat([d.update(data), d.final()]); };
// algorithm 2.B: the hash of a password (R 6)
function hash(password, salt, udata = Buffer.alloc(0)) {
  let k = crypto.createHash('sha256').update(Buffer.concat([password, salt, udata])).digest();
  for (let i = 0; ; i++) {
    const k1 = Buffer.concat(Array(64).fill(Buffer.concat([password, k, udata])));
    const e = aes('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32), k1, false);
    let sum = 0; for (let j = 0; j < 16; j++) sum += e[j];
    k = crypto.createHash(['sha256', 'sha384', 'sha512'][sum % 3]).update(e).digest();
    if (i >= 63 && e[e.length - 1] <= i + 1 - 32) break;
  }
  return k.subarray(0, 32);
}

// the Encrypt dictionary and the file key; { userPassword, ownerPassword, permissions: ['print', 'fill', …] }
export function securityHandler({ userPassword = '', ownerPassword, permissions } = {}) {
  const key = crypto.randomBytes(32);
  const P = permissionValue(permissions);
  const user = pw(userPassword), owner = pw(ownerPassword || crypto.randomBytes(16).toString('hex'));
  const uvs = crypto.randomBytes(8), uks = crypto.randomBytes(8);
  const U = Buffer.concat([hash(user, uvs), uvs, uks]);
  const UE = aes('aes-256-cbc', hash(user, uks), Buffer.alloc(16), key, false);
  const ovs = crypto.randomBytes(8), oks = crypto.randomBytes(8);
  const O = Buffer.concat([hash(owner, ovs, U), ovs, oks]);
  const OE = aes('aes-256-cbc', hash(owner, oks, U), Buffer.alloc(16), key, false);
  const perms = Buffer.alloc(16);
  perms.writeInt32LE(P, 0); perms.writeUInt32LE(0xffffffff, 4); perms.write('Tadb', 8, 'latin1'); crypto.randomBytes(4).copy(perms, 12);
  const Perms = aes('aes-256-ecb', key, null, perms, false);
  const hex = b => `<${b.toString('hex')}>`;
  const dict = `<< /Filter /Standard /V 5 /R 6 /Length 256 /CF << /StdCF << /AuthEvent /DocOpen /CFM /AESV3 /Length 32 >> >> /StmF /StdCF /StrF /StdCF /O ${hex(O)} /U ${hex(U)} /OE ${hex(OE)} /UE ${hex(UE)} /Perms ${hex(Perms)} /P ${P} /EncryptMetadata true >>`;
  const encrypt = data => { const iv = crypto.randomBytes(16); return Buffer.concat([iv, aes('aes-256-cbc', key, iv, data, true)]); };
  return { dict, encrypt, key };
}
// the key from a password (the document password, or the permissions password), for reading an encrypted PDF
export function fileKey(enc, password = '') {
  const p = pw(password), U = enc.U, O = enc.O;
  if (hash(p, O.subarray(32, 40), U.subarray(0, 48)).equals(O.subarray(0, 32))) return unaes(hash(p, O.subarray(40, 48), U.subarray(0, 48)), enc.OE);
  if (hash(p, U.subarray(32, 40)).equals(U.subarray(0, 32))) return unaes(hash(p, U.subarray(40, 48)), enc.UE);
  return null;
}
export const decrypt = (key, data) => { const d = crypto.createDecipheriv('aes-256-cbc', key, data.subarray(0, 16)); return Buffer.concat([d.update(data.subarray(16)), d.final()]); };

// the strings of an object's text (dictionaries, arrays) encrypted: (literal) and <hex> become <encrypted hex>
export function encryptStrings(src, encrypt) {
  let out = '';
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === '<' && src[i + 1] === '<') { out += '<<'; i += 2; continue; }
    if (c === '>' && src[i + 1] === '>') { out += '>>'; i += 2; continue; }
    if (c === '<') { const j = src.indexOf('>', i); const hx = src.slice(i + 1, j).replace(/\s/g, ''); out += `<${encrypt(Buffer.from(hx.length % 2 ? `${hx}0` : hx, 'hex')).toString('hex')}>`; i = j + 1; continue; }
    if (c === '(') {
      let depth = 1, j = i + 1, raw = '';
      while (j < src.length && depth) {
        const ch = src[j];
        if (ch === '\\') {
          const n = src[j + 1];
          if (/[0-7]/.test(n)) { let o = ''; let k = j + 1; while (o.length < 3 && /[0-7]/.test(src[k])) o += src[k++]; raw += String.fromCharCode(parseInt(o, 8) & 0xff); j = k; continue; }
          raw += { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[n] ?? (n === '\n' || n === '\r' ? '' : n); j += 2; continue;
        }
        if (ch === '(') depth++;
        if (ch === ')' && --depth === 0) break;
        raw += ch; j++;
      }
      out += `<${encrypt(Buffer.from(raw, 'latin1')).toString('hex')}>`;
      i = j + 1; continue;
    }
    if (c === '/') { let j = i + 1; while (j < src.length && !/[\s/<>[\]()%{}]/.test(src[j])) j++; out += src.slice(i, j); i = j; continue; }
    out += c; i++;
  }
  return out;
}
