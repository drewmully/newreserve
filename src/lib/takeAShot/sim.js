// Mully "Take a Shot" shared simulation. Pure JS (typed in sim.d.ts), no DOM, no I/O.
// Runs in the browser (to animate) and on the server (to decide the result),
// so both sides compute the exact same shot from the same inputs.
// World units are yards. Origin is the tee. +x is right, +y is toward the green.
// Ported from the staged sim.js; only the discount table moved to ./config.
import { HOLED_PERCENT, ON_GREEN_PERCENT, RING_COLORS, RING_TIERS } from "./config";

export const SIM_VERSION = 1;


/** Distance to hole in feet -> % off. Inner first. Percentages come from ./config. */
export const TIERS = RING_TIERS.map((t, i) => ({ ft: t.ft, pct: t.pct, color: RING_COLORS[i % RING_COLORS.length] }));
export const ON_GREEN_PCT = ON_GREEN_PERCENT;
export const ON_GREEN_COLOR = "#FFFFFF";
export const HOLED_PCT = HOLED_PERCENT;
export const MAX_CARRY = 185;            // longest target you can pick, yards
export const SWEEP_TIME = 0.85;          // seconds for the needle to cross the full meter once
export const ZONE_PERFECT = 0.02;        // meter half-widths (1 = edge of the meter)
export const ZONE_GREEN = 0.10;
export const ZONE_YELLOW = 0.30;
export const WIND_MIN = 4, WIND_MAX = 17;

// ---------- small utils ----------
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const hyp = Math.hypot;
export function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}


// ---------- course geometry ----------
export const G_A = { x: -15, y: 143 }, G_B = { x: 17, y: 156 };
export const G_LEN = hyp(G_B.x - G_A.x, G_B.y - G_A.y);
export const G_AX = { x: (G_B.x - G_A.x) / G_LEN, y: (G_B.y - G_A.y) / G_LEN };
export const G_N = { x: -G_AX.y, y: G_AX.x };             // points to the back of the green
export const G_C = { x: (G_A.x + G_B.x) / 2, y: (G_A.y + G_B.y) / 2 };
export const G_ANG = Math.atan2(G_AX.y, G_AX.x);
export const gRad = (t) => 5.4 + 0.8 * t - 0.9 * Math.sin(Math.PI * t);
export function greenSdf(x, y) {
  const px = x - G_A.x, py = y - G_A.y;
  const t = clamp((px * G_AX.x + py * G_AX.y) / G_LEN, 0, 1);
  const cx = G_A.x + G_AX.x * G_LEN * t, cy = G_A.y + G_AX.y * G_LEN * t;
  return hyp(x - cx, y - cy) - gRad(t);
}
export function greenLocal(x, y) { const dx = x - G_C.x, dy = y - G_C.y; return { u: dx * G_AX.x + dy * G_AX.y, v: dx * G_N.x + dy * G_N.y }; }
export function fromGreen(t, v) { return { x: G_A.x + G_AX.x * G_LEN * t + G_N.x * v, y: G_A.y + G_AX.y * G_LEN * t + G_N.y * v }; }

export const creekC = (x) => 131.5 + 0.38 * x + 1.2 * Math.sin(x / 9);
export const creekHW = (x) => 3.2 + 0.5 * Math.sin(x / 13 + 1);
export const creekLo = (x) => creekC(x) - creekHW(x);
export const creekHi = (x) => creekC(x) + creekHW(x);
export const BANK_DEPTH = 9;

export const BUNKERS = [
  { x: 4.5, y: 141.4, rx: 5.6, ry: 1.9, a: G_ANG },
  { x: -9.5, y: 155.6, rx: 4.0, ry: 2.0, a: G_ANG + 0.15 },
  { x: 9.8, y: 163.4, rx: 4.4, ry: 2.1, a: G_ANG - 0.1 },
];
export function inBunker(x, y, pad = 0) {
  for (const b of BUNKERS) {
    const dx = x - b.x, dy = y - b.y, c = Math.cos(-b.a), s = Math.sin(-b.a);
    const lx = dx * c - dy * s, ly = dx * s + dy * c;
    if ((lx * lx) / ((b.rx + pad) ** 2) + (ly * ly) / ((b.ry + pad) ** 2) < 1) return true;
  }
  return false;
}

export const PINS = [
  { name: 'Middle', t: 0.38, v: 0.4 },
  { name: 'Back', t: 0.66, v: 2.0 },
  { name: 'Front left', t: 0.12, v: -2.3 },
  { name: 'Back right', t: 0.88, v: 1.7 },
];

export function buildBlob() {
  const pts = [], n = 2.5, cx = 0, cy = 86, rx = 52, ry = 104;
  for (let i = 0; i < 160; i++) {
    const th = (i / 160) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th);
    const w = 1 + 0.035 * Math.sin(3 * th + 0.4) + 0.02 * Math.sin(5 * th + 1.3);
    pts.push([cx + rx * w * Math.sign(c) * Math.abs(c) ** (2 / n), cy + ry * w * Math.sign(s) * Math.abs(s) ** (2 / n)]);
  }
  return pts;
}
export function buildFairway() {
  const pts = [];
  for (let i = 0; i < 120; i++) {
    const th = (i / 120) * Math.PI * 2;
    let x = -3 + 28 * Math.cos(th) * (1 + 0.05 * Math.sin(2 * th));
    let y = 80 + 48 * Math.sin(th);
    y = Math.min(y, creekLo(x) - 1.6);
    pts.push([x, y]);
  }
  return pts;
}
export function buildSdfPoly(off) {
  const pts = [];
  for (let i = 0; i < 180; i++) {
    const th = (i / 180) * Math.PI * 2, dx = Math.cos(th), dy = Math.sin(th);
    let lo = 0, hi = 30;
    for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (greenSdf(G_C.x + dx * m, G_C.y + dy * m) < off) lo = m; else hi = m; }
    pts.push([G_C.x + dx * lo, G_C.y + dy * lo]);
  }
  return pts;
}
export function buildCreek() {
  const lo = [], hi = [];
  for (let x = -70; x <= 70; x += 1.5) { lo.push([x, creekLo(x)]); hi.push([x, creekHi(x)]); }
  return lo.concat(hi.reverse());
}
export function buildBank() {
  const lo = [], hi = [];
  for (let x = -27; x <= 33; x += 1.5) { lo.push([x, creekHi(x)]); hi.push([x, creekHi(x) + BANK_DEPTH]); }
  return lo.concat(hi.reverse());
}
export function buildTrees() {
  const r = mulberry32(12);
  const trees = [], azaleas = [];
  const addTree = (x, y, rad) => {
    const blobs = [];
    const k = 5 + Math.floor(r() * 3);
    for (let i = 0; i < k; i++) { const a = r() * Math.PI * 2, d = r() * rad * 0.45; blobs.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, r: rad * (0.45 + r() * 0.25) }); }
    trees.push({ x, y, r: rad, blobs });
  };
  // Back treeline behind the green, following its diagonal
  for (let x = -54; x <= 48; x += 5.2 + r() * 2) addTree(x, 173 + 0.38 * x + (r() - 0.5) * 5, 4.2 + r() * 1.8);
  for (let x = -50; x <= 44; x += 6 + r() * 3) addTree(x + 2, 181 + 0.38 * x + r() * 4, 4.6 + r() * 1.5);
  // Azalea bed in front of the back trees
  for (let x = -44; x <= 40; x += 1.6 + r() * 1.4) azaleas.push({ x, y: 168.5 + 0.38 * x + (r() - 0.5) * 3.4, r: 0.9 + r() * 0.8 });
  // Left trees by the creek
  for (let i = 0; i < 6; i++) addTree(-44 + r() * 10, 116 + i * 4.2 + r() * 2, 3.6 + r() * 1.4);
  // Right trees beside the green
  for (let i = 0; i < 5; i++) addTree(40 + r() * 8, 140 + i * 5 + r() * 2, 3.4 + r() * 1.4);
  for (let i = 0; i < 10; i++) azaleas.push({ x: 37 + r() * 4, y: 138 + i * 2.6, r: 0.8 + r() * 0.6 });
  // Lower left cluster near the tee
  for (let i = 0; i < 6; i++) addTree(-36 + r() * 12, 4 + r() * 16, 3.4 + r() * 1.4);
  return { trees, azaleas };
}

export const BLOB = buildBlob();
export const FAIRWAY = buildFairway();
export const GREEN = buildSdfPoly(0);
export const FRINGE = buildSdfPoly(1.4);
export const CREEK = buildCreek();
export const BANK = buildBank();
const _TA = buildTrees();
export const TREES = _TA.trees, AZALEAS = _TA.azaleas;

export function inTrees(x, y) {
  for (const t of TREES) if (hyp(x - t.x, y - t.y) < t.r * 0.85) return 'trees';
  for (const a of AZALEAS) if (hyp(x - a.x, y - a.y) < a.r + 0.6) return 'azaleas';
  return null;
}
export function inBank(x, y) { return x > -27 && x < 33 && y > creekHi(x) && y < creekHi(x) + BANK_DEPTH; }

export function surfaceAt(x, y) {
  if (!pointInPoly(x, y, BLOB)) return 'out';
  if (Math.abs(y - creekC(x)) < creekHW(x)) return 'water';
  if (inBunker(x, y)) return 'sand';
  const tr = inTrees(x, y); if (tr) return tr;
  const sd = greenSdf(x, y);
  if (sd < 0) return 'green';
  if (sd < 1.4) return 'fringe';
  if (Math.abs(x) < 3.5 && Math.abs(y) < 2.2) return 'tee';
  if (inBank(x, y)) return 'bank';
  if (pointInPoly(x, y, FAIRWAY)) return 'fairway';
  if (sd < 7) return 'surround';
  return 'rough';
}

// Downhill acceleration (yd/s^2). The green tilts toward the creek with a ridge running through it.
export function greenSlope(x, y) {
  const { u, v } = greenLocal(x, y);
  const au = 0.30 * Math.cos(u / 5.5 + 0.6) + 0.10;
  const av = -0.30 - 0.20 * Math.sin(u / 4.0) + 0.10 * Math.cos(v / 2.5);
  return { x: au * G_AX.x + av * G_N.x, y: au * G_AX.y + av * G_N.y };
}
export function slopeAt(x, y, surf) {
  if (surf === 'green' || surf === 'fringe') return greenSlope(x, y);
  if (surf === 'bank') { const d = 0.38 + Math.cos(x / 9) * 1.2 / 9; const m = hyp(d, 1); return { x: (d / m) * 2.3, y: (-1 / m) * 2.3 }; }
  return { x: 0, y: 0 };
}
export const FRICTION = { green: 1.05, fringe: 1.9, bank: 1.4, fairway: 2.4, tee: 2.4, surround: 3.2, rough: 6, sand: 99, trees: 99, azaleas: 99, out: 99, water: 99 };
export const ROLL_V0 = { green: 1.9, fringe: 1.7, bank: 2.8, fairway: 3.4, tee: 3, surround: 1.6, rough: 0.7 };

export const NOTES = {
  water: 'In the creek.', sand: 'In the bunker.', trees: 'In the trees.', azaleas: 'In the azaleas.',
  out: 'Out of play.', fringe: 'Just off the green.', surround: 'Just missed the green.', rough: 'Missed the green.',
  bank: 'Short of the green.', fairway: 'Short of the green.', tee: 'Barely moved it.',
};
export function tierFor(feet) { for (const t of TIERS) if (feet <= t.ft) return t.pct; return ON_GREEN_PCT; }
export function tierColor(pct) { const t = TIERS.find((x) => x.pct === pct); return t ? t.color : ON_GREEN_COLOR; }

// Hidden variance the server adds to every shot (yards). Triangular, so small misses are common.
export function shotNoise(r) { return { carry: +((r() + r() - 1) * 1.6).toFixed(3), lat: +((r() + r() - 1) * 1.1).toFixed(3) }; }
export function zoneFor(e) { const a = Math.abs(e); return a <= ZONE_PERFECT ? 'Perfect' : a <= ZONE_GREEN ? 'Good' : a <= ZONE_YELLOW ? 'Off' : 'Bad'; }
export function pinPos(i) { const p = PINS[((i % PINS.length) + PINS.length) % PINS.length]; return fromGreen(p.t, p.v); }
export function windFrom(mph, dirDeg) { const d = (dirDeg * Math.PI) / 180; return { mph, dirDeg, dir: d, x: Math.sin(d) * mph, y: Math.cos(d) * mph }; }
export function clampTarget(x, y) {
  let d = hyp(x, y), a = Math.atan2(x, y);
  if (!isFinite(d) || !isFinite(a)) { d = 150; a = 0; }
  a = clamp(a, -0.6, 0.6); d = clamp(d, 20, MAX_CARRY);
  return { x: Math.sin(a) * d, y: Math.cos(a) * d };
}

// Deterministic shot. Inputs: pin index, wind, target, meter tap e in [-1, 1], hidden noise from the server.
// Returns the flight, roll frames at 60 fps, and the outcome.
export function simulateShot({ pin, wind, target, e, noise }) {
  const PIN = pinPos(pin);
  const T = clampTarget(target.x, target.y);
  e = clamp(+e || 0, -1, 1);
  const n = noise || { carry: 0, lat: 0 };
  const eff = Math.abs(e) <= ZONE_PERFECT ? 0 : e;
  const tDist = hyp(T.x, T.y);
  const a0 = Math.atan2(T.x, T.y) + (eff * 2.0 * Math.PI) / 180;
  const d = { x: Math.sin(a0), y: Math.cos(a0) }, pr = { x: Math.cos(a0), y: -Math.sin(a0) };
  let carry = tDist * (1 - Math.abs(eff) * 0.16);
  const along = wind.x * d.x + wind.y * d.y, cross = wind.x * pr.x + wind.y * pr.y;
  carry += along >= 0 ? along * 0.95 : along * 1.5;
  carry += n.carry;
  const lat = eff * 12 * (carry / 150) + cross * 1.3 + n.lat;
  const power = tDist / 160;
  const flight = { d, pr, carry, lat, apex: 14 + power * 16, dur: 1.6 + carry / 160 };
  const fp = (t) => ({ x: d.x * carry * t + pr.x * lat * t * t, y: d.y * carry * t + pr.y * lat * t * t });
  const land = fp(1);
  const frames = [];
  let surf = surfaceAt(land.x, land.y), end = null;
  const landSurf = surf;
  const b = { x: land.x, y: land.y, vx: 0, vy: 0, h: 0 };
  if (surf === 'water') end = 'water';
  else if (['sand', 'trees', 'azaleas', 'out'].includes(surf)) end = surf;
  else {
    const vx = d.x * carry + pr.x * 2 * lat, vy = d.y * carry + pr.y * 2 * lat, m = hyp(vx, vy) || 1;
    const v0 = (ROLL_V0[surf] || 1) * (0.85 + Math.min(1.15, power) * 0.2);
    b.vx = (vx / m) * v0; b.vy = (vy / m) * v0;
    const hop = surf === 'green' || surf === 'fringe' ? 0.32 : 0.18;
    const dt = 1 / 240;
    for (let i = 0, t = 0; ; i++) {
      t += dt;
      b.h = t < hop ? Math.sin((t / hop) * Math.PI) * 0.9 : 0;
      const s = surfaceAt(b.x, b.y);
      if (s === 'water') { end = 'water'; break; }
      if (['sand', 'trees', 'azaleas', 'out'].includes(s)) { end = s; break; }
      const fr = FRICTION[s] || 3, sl = slopeAt(b.x, b.y, s), sp = hyp(b.vx, b.vy);
      const dp = hyp(b.x - PIN.x, b.y - PIN.y);
      if (s === 'green' && b.h < 0.05 && ((dp < 0.075 && sp < 2.4) || (dp < 0.11 && sp < 0.7))) { b.x = PIN.x; b.y = PIN.y; end = 'holed'; break; }
      if (sp < 0.03) {
        if (hyp(sl.x, sl.y) < fr * 0.9) { end = s; break; }
        b.vx += sl.x * dt; b.vy += sl.y * dt;
      } else {
        const nvx = b.vx + (sl.x - (b.vx / sp) * fr) * dt, nvy = b.vy + (sl.y - (b.vy / sp) * fr) * dt;
        if (nvx * b.vx + nvy * b.vy < 0 && hyp(sl.x, sl.y) < fr * 0.9) { b.vx = 0; b.vy = 0; } else { b.vx = nvx; b.vy = nvy; }
      }
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (i % 4 === 3) frames.push({ x: b.x, y: b.y, h: b.h });
      if (t > 16) { end = surfaceAt(b.x, b.y); break; }
    }
  }
  frames.push({ x: b.x, y: b.y, h: 0 });
  const yd = hyp(b.x - PIN.x, b.y - PIN.y);
  let result;
  if (end === 'holed') result = { surf: 'holed', feet: 0, pct: HOLED_PCT, note: 'Hole in one.' };
  else if (end === 'green') { const feet = yd * 3; result = { surf: 'green', feet: Math.max(1, Math.round(feet)), pct: tierFor(feet), note: feet <= 3 ? 'Tap in.' : 'On the green.' }; }
  else result = { surf: end, feet: Math.round(yd * 3), pct: 0, note: NOTES[end] || 'Missed the green.' };
  result.strike = zoneFor(e);
  result.rest = { x: +b.x.toFixed(3), y: +b.y.toFixed(3) };
  return { target: T, flight, landSurf, frames, splash: end === 'water', result };
}
