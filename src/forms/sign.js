// Digital signatures for print forms: a PDF written with room for a signature (Pdf.render({ signature })) is signed
// with a private key and its certificate (PEM) as PKCS#7 detached (adbe.pkcs7.detached: CMS SignedData with the
// SHA-256 digest of the document in the signed attributes). Keys of an app live in its .rap/signing folder (not in
// src/, never committed); keygen() creates a self-signed certificate for development.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SIG_HEX } from './pdf.js';

// ---- DER
const len = n => (n < 0x80 ? Buffer.from([n]) : (() => { const b = []; while (n) { b.unshift(n & 0xff); n >>= 8; } return Buffer.from([0x80 | b.length, ...b]); })());
const tlv = (tag, ...content) => { const c = Buffer.concat(content); return Buffer.concat([Buffer.from([tag]), len(c.length), c]); };
const seq = (...c) => tlv(0x30, ...c), set = (...c) => tlv(0x31, ...c);
const oid = s => {
  const p = s.split('.').map(Number), out = [40 * p[0] + p[1]];
  for (const v of p.slice(2)) { const b = [v & 0x7f]; let x = v >> 7; while (x) { b.unshift(0x80 | (x & 0x7f)); x >>= 7; } out.push(...b); }
  return tlv(0x06, Buffer.from(out));
};
const int = v => { let b = Buffer.isBuffer(v) ? v : Buffer.from([v]); if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]); return tlv(0x02, b); };
const nul = () => Buffer.from([0x05, 0x00]);
const octet = b => tlv(0x04, b);
const utc = d => tlv(0x17, Buffer.from(`${d.toISOString().replace(/[-:T]/g, '').slice(2, 14)}Z`));
const ctx = (n, ...c) => tlv(0xa0 + n, ...c);
const OID = { data: '1.2.840.113549.1.7.1', signedData: '1.2.840.113549.1.7.2', sha256: '2.16.840.1.101.3.4.2.1', rsa: '1.2.840.113549.1.1.1', sha256rsa: '1.2.840.113549.1.1.11', ecdsaSha256: '1.2.840.10045.4.3.2',
  contentType: '1.2.840.113549.1.9.3', messageDigest: '1.2.840.113549.1.9.4', signingTime: '1.2.840.113549.1.9.5', cn: '2.5.4.3', o: '2.5.4.10' };

// reads one DER element: { tag, start, header, end } (start: the element, header: its content)
function read(b, p) {
  const tag = b[p];
  let l = b[p + 1], h = p + 2;
  if (l & 0x80) { const n = l & 0x7f; l = 0; for (let i = 0; i < n; i++) l = l * 256 + b[h + i]; h += n; }
  return { tag, start: p, header: h, end: h + l };
}
const children = (b, el) => { const out = []; for (let p = el.header; p < el.end;) { const c = read(b, p); out.push(c); p = c.end; } return out; };
// issuer and serial number of a certificate (DER), for the signer info
function issuerSerial(certDer) {
  const tbs = children(certDer, read(certDer, 0))[0];
  const parts = children(certDer, tbs);
  const k = parts[0].tag === 0xa0 ? 1 : 0;   // [0] version
  return seq(certDer.subarray(parts[k + 2].start, parts[k + 2].end), certDer.subarray(parts[k].start, parts[k].end));
}
const algo = key => (key.asymmetricKeyType === 'ec' ? { digestEnc: seq(oid(OID.ecdsaSha256)), certSig: seq(oid(OID.ecdsaSha256)) } : { digestEnc: seq(oid(OID.rsa), nul()), certSig: seq(oid(OID.sha256rsa), nul()) });

// the signed attributes (as a SET, which is what gets signed) for the digest of the document
export function signedAttributes(digest, when = new Date()) {
  return set(
    seq(oid(OID.contentType), set(oid(OID.data))),
    seq(oid(OID.signingTime), set(utc(when))),
    seq(oid(OID.messageDigest), set(octet(digest))),
  );
}
export function cms(digest, { key, cert, when = new Date() }) {
  const k = crypto.createPrivateKey(key);
  const certDer = new crypto.X509Certificate(cert).raw;
  const attrs = signedAttributes(digest, when);
  const sig = crypto.sign('sha256', attrs, k);
  const a = algo(k);
  const signerInfo = seq(int(1), issuerSerial(certDer), seq(oid(OID.sha256), nul()), Buffer.concat([Buffer.from([0xa0]), attrs.subarray(1)]), a.digestEnc, octet(sig));
  const signed = seq(int(1), set(seq(oid(OID.sha256), nul())), seq(oid(OID.data)), ctx(0, certDer), set(signerInfo));
  return seq(oid(OID.signedData), ctx(0, signed));
}

// signs a PDF written with room for a signature; returns the signed PDF
export function signPdf(pdf, { key, cert, when }) {
  pdf = Buffer.from(pdf);
  const s = pdf.toString('latin1');
  const at = s.lastIndexOf('/ByteRange [0 ********** ********** **********]');
  if (at < 0) throw new Error('The PDF has no room for a signature');
  const lt = s.indexOf('/Contents <', at) + '/Contents '.length, gt = lt + SIG_HEX + 2;
  const range = [0, lt, gt, pdf.length - gt];
  const placeholder = '[0 ********** ********** **********]';
  const filled = `[${range.join(' ')}]`.padEnd(placeholder.length, ' ');
  pdf.write(filled, at + '/ByteRange '.length, 'latin1');
  const signedBytes = Buffer.concat([pdf.subarray(0, lt), pdf.subarray(gt)]);
  const digest = crypto.createHash('sha256').update(signedBytes).digest();
  const der = cms(digest, { key, cert, when });
  if (der.length * 2 > SIG_HEX) throw new Error('The signature does not fit');
  pdf.write(der.toString('hex').padEnd(SIG_HEX, '0'), lt + 1, 'latin1');
  return pdf;
}

// a key pair with a self-signed certificate (development): { key, cert } as PEM
export function keygen(name, { org = 'RAP Studio', days = 3650 } = {}) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const dn = seq(set(seq(oid(OID.cn), tlv(0x0c, Buffer.from(name)))), set(seq(oid(OID.o), tlv(0x0c, Buffer.from(org)))));
  const now = new Date(), until = new Date(now.getTime() + days * 86400000);
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  // extensions: key usage digitalSignature + nonRepudiation (critical)
  const keyUsage = seq(oid('2.5.29.15'), Buffer.from([0x01, 0x01, 0xff]), octet(tlv(0x03, Buffer.from([0x06, 0xc0]))));
  const tbs = seq(ctx(0, int(2)), int(crypto.randomBytes(8)), seq(oid(OID.sha256rsa), nul()), dn, seq(utc(now), utc(until)), dn, spki, tlv(0xa3, seq(keyUsage)));
  const sig = crypto.sign('sha256', tbs, privateKey);
  const certDer = seq(tbs, seq(oid(OID.sha256rsa), nul()), tlv(0x03, Buffer.concat([Buffer.from([0]), sig])));
  const pem = (label, der) => `-----BEGIN ${label}-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: pem('CERTIFICATE', certDer) };
}

// the signing keys of an app: .rap/signing/<name>.key.pem and <name>.cert.pem
export function signingKey(appDir, name) {
  const base = path.join(appDir, '.rap', 'signing', String(name || 'default').toLowerCase());
  if (!fs.existsSync(`${base}.key.pem`) || !fs.existsSync(`${base}.cert.pem`)) return null;
  return { key: fs.readFileSync(`${base}.key.pem`, 'utf8'), cert: fs.readFileSync(`${base}.cert.pem`, 'utf8') };
}
export function createSigningKey(appDir, name, opts) {
  const dir = path.join(appDir, '.rap', 'signing');
  fs.mkdirSync(dir, { recursive: true });
  const k = keygen(String(name).toUpperCase(), opts);
  const base = path.join(dir, String(name).toLowerCase());
  fs.writeFileSync(`${base}.key.pem`, k.key, { mode: 0o600 });
  fs.writeFileSync(`${base}.cert.pem`, k.cert);
  return { ...k, files: [`${base}.key.pem`, `${base}.cert.pem`] };
}
// the signatures of a PDF: [{ field, name, reason, signedAt, valid, covers }] (valid: the digest and the signature match)
export function verifyPdf(pdf) {
  pdf = Buffer.from(pdf);
  const s = pdf.toString('latin1'), out = [];
  for (const m of s.matchAll(/\/ByteRange \[(\d+) (\d+) (\d+) (\d+)\s*\]/g)) {
    const [a, b, c, d] = m.slice(1).map(Number);
    // the signature is padded with zeros: its length is in its DER header (its last bytes may be zeros themselves)
    const raw = Buffer.from(s.slice(b + 1, c - 1), 'hex');
    let der = raw;
    try { der = raw.subarray(0, read(raw, 0).end); } catch {}
    const digest = crypto.createHash('sha256').update(Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)])).digest();
    let valid = false, signer = '';
    try {
      // find the signed attributes ([0] IMPLICIT in the signer info), the signature and the certificate
      const signed = children(der, read(der, children(der, read(der, 0))[1].header));
      const certEl = signed.find(e => e.tag === 0xa0);
      const certDer = der.subarray(read(der, certEl.header).start, read(der, certEl.header).end);
      const x509 = new crypto.X509Certificate(certDer);
      signer = (/CN=([^\n,]+)/.exec(x509.subject) || [])[1] || x509.subject;
      const info = children(der, children(der, signed.at(-1))[0]);   // SET OF SignerInfo -> the first one
      const attrsEl = info.find(e => e.tag === 0xa0), sigEl = info.at(-1);
      const attrs = Buffer.concat([Buffer.from([0x31]), der.subarray(attrsEl.start + 1, attrsEl.end)]);
      const hasDigest = attrs.includes(digest);
      valid = hasDigest && crypto.verify('sha256', attrs, x509.publicKey, der.subarray(sigEl.header, sigEl.end));
    } catch { valid = false; }
    const dict = s.slice(Math.max(0, m.index - 600), m.index + 400 + (c - b));
    const field = (/\/Reason ?\(([^)]*)\)/.exec(dict) || [])[1] || '';
    out.push({ signer, reason: field, valid, covers: a + b + d === pdf.length - (c - b) });
  }
  return out;
}

// signs a signature field of an existing PDF (one written by the form engine, or any PDF with a classic cross-reference
// table): an incremental update adds the signature value and the signed field, the original bytes stay as they are
export function signField(pdf, { field, name, reason, location, contact, key, cert, when = new Date() }) {
  pdf = Buffer.from(pdf);
  const s = pdf.toString('latin1');
  if (!/startxref\s+\d+\s+%%EOF\s*$/.test(s) || !/\btrailer\b/.test(s)) throw new Error('The PDF cannot be updated (cross-reference streams are not supported)');
  // the signature fields: /FT /Sig with /T (name)
  const objs = [...s.matchAll(/(?:^|[\r\n])(\d+) 0 obj\s*(<<[\s\S]*?>>)\s*endobj/g)];
  const sigs = objs.filter(m => /\/FT\s*\/Sig\b/.test(m[2]));
  const pick = sigs.filter(m => !field || new RegExp(`/T\\s*\\(${String(field).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`).test(m[2])).at(-1);
  if (!pick) throw new Error(`The PDF has no signature field${field ? ` ${field}` : ''}`);
  if (/\/V\s+\d+ 0 R/.test(pick[2])) throw new Error('The signature field is signed already');
  const num = Number(pick[1]);
  const trailer = s.slice(s.lastIndexOf('trailer'));
  const size = Number(/\/Size\s+(\d+)/.exec(trailer)[1]);
  const root = /\/Root\s+(\d+ \d+ R)/.exec(trailer)[1], info = /\/Info\s+(\d+ \d+ R)/.exec(trailer)?.[1];
  const prev = Number(/startxref\s+(\d+)\s+%%EOF\s*$/.exec(s)[1]);
  const str = t => `(${String(t).replace(/[\\()]/g, c => `\\${c}`)})`;
  const date = `D:${when.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;
  const sigObj = `${size} 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0 ********** ********** **********] /Contents <${'0'.repeat(SIG_HEX)}> /M ${str(date)}${name ? ` /Name ${str(name)}` : ''}${reason ? ` /Reason ${str(reason)}` : ''}${location ? ` /Location ${str(location)}` : ''}${contact ? ` /ContactInfo ${str(contact)}` : ''} >>\nendobj\n`;
  const fieldObj = `${num} 0 obj\n${pick[2].replace(/>>\s*$/, ` /V ${size} 0 R >>`)}\nendobj\n`;
  let at = pdf.length + 1;
  const off1 = at; at += Buffer.byteLength(sigObj, 'latin1');
  const off2 = at; at += Buffer.byteLength(fieldObj, 'latin1');
  const xref = `xref\n0 1\n0000000000 65535 f \n${num} 1\n${String(off2).padStart(10, '0')} 00000 n \n${size} 1\n${String(off1).padStart(10, '0')} 00000 n \ntrailer\n<< /Size ${size + 1} /Root ${root}${info ? ` /Info ${info}` : ''} /Prev ${prev} >>\nstartxref\n${at}\n%%EOF\n`;
  const updated = Buffer.concat([pdf, Buffer.from(`\n${sigObj}${fieldObj}${xref}`, 'latin1')]);
  return signPdf(updated, { key, cert, when });
}
