// SVG images of XFA templates (image/svg+xml) drawn as PDF vector graphics: path (all commands, arcs as Bézier
// curves), rect, circle, ellipse, line, polyline, polygon, text / tspan; groups with transforms, fill and stroke
// (colors, opacity, stroke width), the viewBox. The result: PDF operators in the SVG's user space, scaled into a box.
import { parseXml } from '../../abap/xslt.js';

const els = n => (n?.children || []).filter(c => c.type === 'element');
const local = n => String(n.name).replace(/^.*:/, '');
const attr = (n, a) => n?.attrs?.find(x => x.name === a)?.value;
const num = v => (Math.round(Number(v) * 1000) / 1000).toString();
const NAMED = { black: '#000', white: '#fff', red: '#f00', green: '#008000', blue: '#00f', gray: '#808080', grey: '#808080', yellow: '#ff0', orange: '#ffa500', none: 'none' };
function color(v) {
  if (!v) return null;
  v = String(v).trim().toLowerCase();
  if (v === 'none' || v === 'transparent') return 'none';
  v = NAMED[v] || v;
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return [...m[1]].map(c => parseInt(c + c, 16) / 255);
  m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255);
  m = /^rgb\(\s*(\d+)\D+(\d+)\D+(\d+)/.exec(v);
  if (m) return [m[1], m[2], m[3]].map(x => Number(x) / 255);
  return null;
}
const styleOf = n => Object.fromEntries(String(attr(n, 'style') || '').split(';').map(s => s.split(':').map(x => x.trim())).filter(p => p[0]));
// the transform attribute -> a matrix [a b c d e f]
function transform(t) {
  let M = [1, 0, 0, 1, 0, 0];
  const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  for (const m of String(t || '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let T;
    switch (m[1]) {
      case 'matrix': T = a; break;
      case 'translate': T = [1, 0, 0, 1, a[0] || 0, a[1] || 0]; break;
      case 'scale': T = [a[0], 0, 0, a[1] ?? a[0], 0, 0]; break;
      case 'rotate': { const r = (a[0] || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); T = [c, s, -s, c, 0, 0]; if (a.length > 2) T = mul(mul([1, 0, 0, 1, a[1], a[2]], T), [1, 0, 0, 1, -a[1], -a[2]]); break; }
      case 'skewX': T = [1, 0, Math.tan(a[0] * Math.PI / 180), 1, 0, 0]; break;
      case 'skewY': T = [1, Math.tan(a[0] * Math.PI / 180), 0, 1, 0, 0]; break;
      default: continue;
    }
    M = mul(M, T);
  }
  return M;
}
// an elliptical arc -> cubic Bézier segments (SVG implementation notes F.6)
function arcToBeziers(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const p = phi * Math.PI / 180, cp = Math.cos(p), sp = Math.sin(p);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2, x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  const lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const sign = fa === fs ? -1 : 1;
  const sq = Math.max(0, (rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p) / (rx * rx * y1p * y1p + ry * ry * x1p * x1p));
  const co = sign * Math.sqrt(sq), cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
  const segs = Math.ceil(Math.abs(dt) / (Math.PI / 2)), out = [];
  const d = dt / segs, k = 4 / 3 * Math.tan(d / 4);
  let t = t1;
  for (let i = 0; i < segs; i++) {
    const c1 = Math.cos(t), s1 = Math.sin(t), c2 = Math.cos(t + d), s2 = Math.sin(t + d);
    const P = (x, y) => [cx + rx * x * cp - ry * y * sp, cy + rx * x * sp + ry * y * cp];
    const a = P(c1 - k * s1, s1 + k * c1), b = P(c2 + k * s2, s2 - k * c2), e = P(c2, s2);
    out.push([...a, ...b, ...e]);
    t += d;
  }
  return out;
}
// path data -> PDF path operators
function pathOps(d) {
  const toks = String(d || '').match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  const ops = [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, lcx = null, lcy = null, lqx = null, lqy = null;
  const n = () => Number(toks[i++]);
  const isNum = () => i < toks.length && !/^[a-zA-Z]$/.test(toks[i]);
  while (i < toks.length) {
    if (/^[a-zA-Z]$/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'Z') { ops.push('h'); x = sx; y = sy; lcx = lqx = null; continue; }
    if (!isNum()) { i++; continue; }
    switch (C) {
      case 'M': x = ox + n(); y = oy + n(); sx = x; sy = y; ops.push(`${num(x)} ${num(y)} m`); cmd = rel ? 'l' : 'L'; lcx = lqx = null; break;
      case 'L': x = ox + n(); y = oy + n(); ops.push(`${num(x)} ${num(y)} l`); lcx = lqx = null; break;
      case 'H': x = ox + n(); ops.push(`${num(x)} ${num(y)} l`); lcx = lqx = null; break;
      case 'V': y = oy + n(); ops.push(`${num(x)} ${num(y)} l`); lcx = lqx = null; break;
      case 'C': { const a = [ox + n(), oy + n(), ox + n(), oy + n(), ox + n(), oy + n()]; ops.push(`${a.map(num).join(' ')} c`); [lcx, lcy] = [a[2], a[3]]; [x, y] = [a[4], a[5]]; lqx = null; break; }
      case 'S': { const c1x = lcx !== null ? 2 * x - lcx : x, c1y = lcy !== null ? 2 * y - lcy : y; const a = [ox + n(), oy + n(), ox + n(), oy + n()]; ops.push(`${num(c1x)} ${num(c1y)} ${a.map(num).join(' ')} c`); [lcx, lcy] = [a[0], a[1]]; [x, y] = [a[2], a[3]]; lqx = null; break; }
      case 'Q': { const qx = ox + n(), qy = oy + n(), ex = ox + n(), ey = oy + n(); ops.push(`${num(x + 2 / 3 * (qx - x))} ${num(y + 2 / 3 * (qy - y))} ${num(ex + 2 / 3 * (qx - ex))} ${num(ey + 2 / 3 * (qy - ey))} ${num(ex)} ${num(ey)} c`); [lqx, lqy] = [qx, qy]; [x, y] = [ex, ey]; lcx = null; break; }
      case 'T': { const qx = lqx !== null ? 2 * x - lqx : x, qy = lqy !== null ? 2 * y - lqy : y, ex = ox + n(), ey = oy + n(); ops.push(`${num(x + 2 / 3 * (qx - x))} ${num(y + 2 / 3 * (qy - y))} ${num(ex + 2 / 3 * (qx - ex))} ${num(ey + 2 / 3 * (qy - ey))} ${num(ex)} ${num(ey)} c`); [lqx, lqy] = [qx, qy]; [x, y] = [ex, ey]; lcx = null; break; }
      case 'A': {
        const rx = n(), ry = n(), phi = n(), fa = n(), fs = n(), ex = ox + n(), ey = oy + n();
        for (const b of arcToBeziers(x, y, rx, ry, phi, fa, fs, ex, ey)) ops.push(`${b.map(num).join(' ')} c`);
        x = ex; y = ey; lcx = lqx = null; break;
      }
      default: i++;
    }
  }
  return ops.join(' ');
}
const ellipse = (cx, cy, rx, ry) => {
  const k = 0.5523;
  return `${num(cx + rx)} ${num(cy)} m ${num(cx + rx)} ${num(cy + ry * k)} ${num(cx + rx * k)} ${num(cy + ry)} ${num(cx)} ${num(cy + ry)} c ${num(cx - rx * k)} ${num(cy + ry)} ${num(cx - rx)} ${num(cy + ry * k)} ${num(cx - rx)} ${num(cy)} c ${num(cx - rx)} ${num(cy - ry * k)} ${num(cx - rx * k)} ${num(cy - ry)} ${num(cx)} ${num(cy - ry)} c ${num(cx + rx * k)} ${num(cy - ry)} ${num(cx + rx)} ${num(cy - ry * k)} ${num(cx + rx)} ${num(cy)} c h`;
};

// SVG source -> { width, height (of the viewBox), ops(textFn) }: PDF operators in a y-down space of the viewBox;
// text: textFn(x, y, string, { size, color, family, weight, anchor }) returns operators for it
export function svgImage(src) {
  const doc = parseXml(String(src).replace(/^﻿/, ''));
  const root = (function find(n) { for (const c of els(n)) { if (local(c) === 'svg') return c; const r = find(c); if (r) return r; } return null; })(doc);
  if (!root) throw new Error('No <svg> element in the image');
  const unit = v => { const m = /^([\d.]+)\s*(mm|cm|in|pt|px)?$/.exec(String(v || '')); if (!m) return null; const n = Number(m[1]); return m[2] === 'mm' ? n * 72 / 25.4 : m[2] === 'cm' ? n * 72 / 2.54 : m[2] === 'in' ? n * 72 : m[2] === 'pt' ? n : n * 0.75; };
  const vb = String(attr(root, 'viewBox') || '').split(/[\s,]+/).map(Number);
  const W = vb.length === 4 ? vb[2] : unit(attr(root, 'width')) || 100, H = vb.length === 4 ? vb[3] : unit(attr(root, 'height')) || 100;
  const ox = vb.length === 4 ? vb[0] : 0, oy = vb.length === 4 ? vb[1] : 0;
  const ratio = (unit(attr(root, 'width')) || W) / W;   // a size of the SVG in points (for text sizes)
  return {
    width: W, height: H, ratio,
    ops(textFn) {
      const out = [`1 0 0 1 ${num(-ox)} ${num(-oy)} cm`];
      const walk = (n, inh) => {
        const st = { ...inh, ...Object.fromEntries(['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'display', 'visibility'].map(k => [k, attr(n, k)]).filter(([, v]) => v !== undefined)), ...styleOf(n) };
        if (st.display === 'none' || st.visibility === 'hidden') return;
        const tag = local(n);
        if (['defs', 'title', 'desc', 'metadata', 'style', 'clipPath', 'mask', 'linearGradient', 'radialGradient', 'pattern', 'symbol'].includes(tag)) return;
        const t = attr(n, 'transform');
        if (t) { const m = transform(t); out.push(`q ${m.map(num).join(' ')} cm`); }
        const fill = color(st.fill ?? '#000'), stroke = color(st.stroke), sw = Number(String(st['stroke-width'] ?? '1').replace(/px$/, '')) || 1;
        const paint = geo => {
          if (!geo) return;
          const f = fill && fill !== 'none', s = stroke && stroke !== 'none';
          if (!f && !s) return;
          out.push(`q ${f ? `${fill.map(num).join(' ')} rg ` : ''}${s ? `${stroke.map(num).join(' ')} RG ${num(sw)} w ` : ''}${geo} ${f && s ? 'B' : f ? 'f' : 'S'} Q`);
        };
        const a = k => Number(attr(n, k) || 0);
        switch (tag) {
          case 'path': paint(pathOps(attr(n, 'd'))); break;
          case 'rect': {
            const rx = a('rx') || a('ry'), x = a('x'), y = a('y'), w = a('width'), h = a('height');
            paint(rx ? pathOps(`M${x + rx},${y} H${x + w - rx} A${rx},${rx} 0 0 1 ${x + w},${y + rx} V${y + h - rx} A${rx},${rx} 0 0 1 ${x + w - rx},${y + h} H${x + rx} A${rx},${rx} 0 0 1 ${x},${y + h - rx} V${y + rx} A${rx},${rx} 0 0 1 ${x + rx},${y} Z`) : `${num(x)} ${num(y)} ${num(w)} ${num(h)} re`);
            break;
          }
          case 'circle': paint(ellipse(a('cx'), a('cy'), a('r'), a('r'))); break;
          case 'ellipse': paint(ellipse(a('cx'), a('cy'), a('rx'), a('ry'))); break;
          case 'line': out.push(`q ${(stroke && stroke !== 'none' ? stroke : [0, 0, 0]).map(num).join(' ')} RG ${num(sw)} w ${num(a('x1'))} ${num(a('y1'))} m ${num(a('x2'))} ${num(a('y2'))} l S Q`); break;
          case 'polyline': case 'polygon': {
            const p = String(attr(n, 'points') || '').trim().split(/[\s,]+/).map(Number);
            if (p.length >= 4) paint(`${num(p[0])} ${num(p[1])} m ${p.slice(2).reduce((s, v, k, arr) => (k % 2 ? s : `${s} ${num(v)} ${num(arr[k + 1])} l`), '')}${tag === 'polygon' ? ' h' : ''}`);
            break;
          }
          case 'text': case 'tspan': {
            const x = attr(n, 'x') !== undefined ? a('x') : inh.$x ?? 0, y = attr(n, 'y') !== undefined ? a('y') : inh.$y ?? 0;
            const own = (n.children || []).filter(c => c.type === 'text').map(c => c.value).join('').replace(/\s+/g, ' ').trim();
            const size = Number(String(st['font-size'] || '16').replace(/px|pt/, '')) || 16;
            if (own && textFn) out.push(textFn(x, y, own, { size, color: fill && fill !== 'none' ? fill : [0, 0, 0], family: String(st['font-family'] || 'Arial').replace(/['"]/g, '').split(',')[0], weight: st['font-weight'], anchor: st['text-anchor'] }));
            for (const c of els(n)) walk(c, { ...st, $x: x, $y: y });
            if (t) out.push('Q');
            return;
          }
        }
        if (tag === 'svg' || tag === 'g' || tag === 'a' || tag === 'switch') for (const c of els(n)) walk(c, st);
        if (t) out.push('Q');
      };
      walk(root, {});
      return out.join('\n');
    },
  };
}
