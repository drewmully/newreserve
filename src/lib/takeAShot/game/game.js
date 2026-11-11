// Mully "Take a Shot" game module. Loaded only after the shopper taps "Take a Shot".
// Ported from the staged build. The server decides every shot (pin, wind,
// hidden noise, result); this module only animates the same simulation and
// sends inputs. No offline mode, no local codes, no test hooks.
// World units are yards. Origin is the tee. +x is right, +y is toward the green.
/* eslint-disable */
import { GAME_CSS } from './styles';
import {
  SIM_VERSION, TIERS, ON_GREEN_PCT, ON_GREEN_COLOR, HOLED_PCT, MAX_CARRY, SWEEP_TIME, ZONE_PERFECT, ZONE_GREEN, ZONE_YELLOW, WIND_MIN, clamp, lerp, hyp, mulberry32, pointInPoly, G_A, G_LEN, G_AX, G_N, G_C, G_ANG, gRad, greenSdf, greenLocal, fromGreen, creekC, creekHW, creekLo, creekHi, BANK_DEPTH, BUNKERS, inBunker, PINS, buildBlob, buildFairway, buildSdfPoly, buildCreek, buildBank, buildTrees, BLOB, FAIRWAY, GREEN, FRINGE, CREEK, BANK, TREES, inTrees, inBank, surfaceAt, greenSlope, slopeAt, FRICTION, ROLL_V0, NOTES, tierFor, tierColor, zoneFor, pinPos, windFrom, clampTarget, simulateShot, AZALEAS, WIND_MAX,
  shotNoise,
} from '../sim.js';


const C = {
  page: '#FAF7F0', rough: '#5E9244', roughEdge: '#4E7E38', fair: '#8CBB5E', fairStripe: '#97C568',
  tee: '#A4CF74', surround: '#6FA34F', bank: '#7DB056', fringe: '#86BA5C', green: '#A9D47C', greenStripe: '#B5DB8A',
  sand: '#F3ECDC', sandShadow: '#D9CDB4', water: '#43A9DA', waterDeep: '#2F8FC5', waterEdge: '#CDEEFA',
  tree: '#4C7A30', treeMid: '#5E8E3A', treeHi: '#7FAE4E', azalea: '#E0679F', azaleaHi: '#F4A3C6', mulch: '#8A5A3A',
  shadow: 'rgba(38,52,26,0.30)', flag: '#8A2432', ink: '#2B2018', brown: '#4A3528', camel: '#B08558',
};

function tracePoly(ctx, poly) { ctx.beginPath(); ctx.moveTo(poly[0][0], poly[0][1]); for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]); ctx.closePath(); }

const PREFS = { tipsOff: false };   // lives for the page visit

// ---------- audio (tiny, synthesized) ----------
let AC = null;
function audio() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } } if (AC && AC.state === 'suspended') AC.resume(); return AC; }
function noise(dur, freq, q, gain) {
  const ac = audio(); if (!ac) return;
  const b = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 2;
  const s = ac.createBufferSource(); s.buffer = b;
  const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = ac.createGain(); g.gain.value = gain;
  s.connect(f).connect(g).connect(ac.destination); s.start();
}
function tone(freq, dur, gain) {
  const ac = audio(); if (!ac) return;
  const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = freq; o.type = 'sine';
  g.gain.setValueAtTime(gain, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + dur);
}
const sfx = {
  tick: () => tone(880, 0.05, 0.04),
  strike: () => { noise(0.12, 2400, 1.2, 0.5); tone(420, 0.08, 0.08); },
  splash: () => noise(0.6, 700, 0.6, 0.5),
  thud: () => noise(0.08, 300, 1, 0.3),
  cup: () => { tone(1250, 0.18, 0.12); setTimeout(() => tone(1650, 0.2, 0.1), 90); },
};
const buzz = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} };

// ---------- mount ----------
function injectCss() {
  if (document.getElementById('mts-game-css')) return;
  const st = document.createElement('style');
  st.id = 'mts-game-css';
  st.textContent = GAME_CSS;
  document.head.appendChild(st);
}

const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

/** Mounts the game into `root`. Returns a cleanup function. opts.backend is required. opts.terms is a short code-terms line. */
export function mount(root, opts) {
  injectCss();
  const shotsTotal = opts.shots || 1;
  const emit = opts.emit || (() => {});
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'g-wrap';
  wrap.innerHTML = `
    <canvas class="g-canvas" aria-label="Par 3 golf hole"></canvas>
    <div class="g-hud">
      <div class="g-hud-l"><div class="g-shotballs"></div><span class="g-hud-small g-shotlabel"></span></div>
      <div class="g-hud-c"><b class="g-yds">0</b><span class="g-hud-small">yds to pin</span></div>
      <div class="g-hud-r"><svg class="g-wind" viewBox="0 0 32 32" width="30" height="30" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="rgba(250,247,240,.92)"/><g class="g-wind-arrow"><path d="M16 5 L22 15 H18 V26 H14 V15 H10 Z" fill="${C.brown}"/></g></svg><span><b class="g-mph">0</b><span class="g-hud-small"> mph</span></span></div>
    </div>
    <button class="g-read" type="button" aria-label="Read the green"><span>Read</span></button>
    <div class="g-best" hidden></div>
    <div class="g-panel">
      <div class="g-hint">Drag to aim</div>
      <div class="g-meter" aria-hidden="true">
        <div class="g-meter-track">
          <div class="g-z g-z-y"></div>
          <div class="g-z g-z-g"></div>
          <div class="g-z g-z-p"></div>
          <div class="g-meter-mark"></div>
          <div class="g-meter-needle"></div>
        </div>
      </div>
      <div class="g-controls">
        <button class="g-swing" type="button">Swing</button>
      </div>
    </div>
    <div class="g-card" hidden></div>
    <div class="g-tip" hidden role="status" aria-live="polite"><span class="g-tip-n"></span><span class="g-tip-t"></span><button class="g-tip-x" type="button">Hide</button></div>`;
  root.appendChild(wrap);

  const $ = (s) => wrap.querySelector(s);
  const canvas = $('.g-canvas'), ctx = canvas.getContext('2d');
  const el = {
    yds: $('.g-yds'), mph: $('.g-mph'), windArrow: $('.g-wind-arrow'), shotballs: $('.g-shotballs'), shotlabel: $('.g-shotlabel'),
    hint: $('.g-hint'), needle: $('.g-meter-needle'), mark: $('.g-meter-mark'), swing: $('.g-swing'),
    card: $('.g-card'), tip: $('.g-tip'), tipT: $('.g-tip-t'), tipN: $('.g-tip-n'), windBox: $('.g-hud-r'), read: $('.g-read'), panel: $('.g-panel'), best: $('.g-best'), hud: $('.g-hud'),
  };
  const mp = (e) => ((e + 1) / 2) * 100 + '%';
  const zone = (cls, w) => { const z = $(cls); z.style.left = mp(-w); z.style.width = w * 100 + '%'; };
  zone('.g-z-y', ZONE_YELLOW); zone('.g-z-g', ZONE_GREEN); zone('.g-z-p', ZONE_PERFECT);
  const floorPct = opts.session.floor;
  const hasPhone = !!(opts.lead && opts.lead.smsConsent);

  const rng = Math.random;
  const sess = opts.session;               // from the server: pin, wind per shot
  const backend = opts.backend;            // server calls: shot(), claim()
  const pinIdx = sess.pin;
  const pinDef = PINS[pinIdx];
  const PIN = pinPos(pinIdx);

  const S = {
    phase: 'aim', shot: 0, results: [], best: null,
    wind: { mph: 0, dir: 0, x: 0, y: 0 },
    aim: 0, target: { x: 0, y: 150 }, meter: 0, sweep: 0, err: 0, hit: null,
    ball: { x: 0, y: 0, h: 0, vx: 0, vy: 0 }, trail: [],
    flight: null, roll: null, rest: null, landSurf: null, holed: false, splash: null,
    cam: { x: 0, y: 86, s: 3 }, camT: { x: 0, y: 86, s: 3 }, readMode: false,
    W: 0, H: 0, dpr: 1, topPad: 64, botPad: 170, cy0: 0, overview: null, dirty: true, time: 0,
  };

  function newWind() {
    const w = sess.winds[S.shot];
    S.wind = windFrom(w.mph, w.dirDeg);
    el.mph.textContent = S.wind.mph;
    el.windArrow.setAttribute('transform', `rotate(${S.wind.dirDeg} 16 16)`);
  }
  function pinDist() { return hyp(PIN.x, PIN.y); }
  function aimToPin() { return (Math.atan2(PIN.x, PIN.y) * 180) / Math.PI; }

  function renderShotBalls() {
    let h = '';
    for (let i = 0; i < shotsTotal; i++) {
      const r = S.results[i];
      h += `<i class="${r ? (r.pct > 0 ? 'won' : 'used') : i === S.shot ? 'now' : ''}"></i>`;
    }
    el.shotballs.innerHTML = h;
    el.shotlabel.textContent = `Shot ${Math.min(S.shot + 1, shotsTotal)} of ${shotsTotal}`;
  }

  function setupShot() {
    S.phase = 'aim';
    S.ball = { x: 0, y: 0, h: 0, vx: 0, vy: 0 };
    S.trail = []; S.flight = null; S.roll = null; S.rest = null; S.holed = false; S.splash = null;
    S.target = { x: PIN.x, y: PIN.y }; S.aim = aimToPin();
    S.sweep = rng() * 2; S.err = 0; S.hit = null;
    S.readMode = false; el.read.classList.remove('on');
    newWind();
    el.yds.textContent = Math.round(pinDist());
    renderShotBalls();
    setHint('Tap the course to aim');
    el.swing.textContent = 'Swing';
    el.swing.disabled = false;
    el.panel.classList.remove('busy');
    el.mark.style.opacity = 0;
    S.camT = { ...S.overview };
    updateMeter();
    if (S.shot === 0) tipShow(TIPS);
    else tipShow([{ key: 'wind', t: 'New wind. Check it.', dur: 2.6, el: () => el.windBox }]);
  }

  function setHint(t) { el.hint.textContent = t; }

  // ---------- in-game tips ----------
  const TIPS = [
    { key: 'wind', t: 'Check the wind', dur: 2.6, el: () => el.windBox },
    { key: 'read', t: 'Read the green. Tap it to zoom.', dur: 3, el: () => el.read },
    { key: 'aim', t: 'Tap the course to aim', dur: 0, el: () => null },
    { key: 'swing', t: 'Tap Swing when the needle hits the middle bar', dur: 0, el: () => el.swing },
  ];
  let tipsOff = !!PREFS.tipsOff;
  const tip = { i: -1, t: 0, list: TIPS };
  function tipShow(list) {
    if (tipsOff) return;
    tip.list = list; tip.i = -1; tipNext();
  }
  function tipNext() {
    const prev = tip.list[tip.i]; if (prev && prev.el()) prev.el().classList.remove('g-glow');
    tip.i++; tip.t = 0;
    const cur = tip.list[tip.i];
    if (!cur || tipsOff) { el.tip.hidden = true; el.hint.style.visibility = ''; return; }
    el.tipT.textContent = cur.t;
    el.tipN.textContent = tip.list.length > 1 ? (tip.i + 1) + '/' + tip.list.length : 'Tip';
    el.tip.hidden = false; el.hint.style.visibility = 'hidden';
    el.tip.classList.remove('pop'); void el.tip.offsetWidth; el.tip.classList.add('pop');
    if (cur.el()) cur.el().classList.add('g-glow');
  }
  function tipDone(key) { const cur = tip.list[tip.i]; if (cur && (cur.key === key || key === '*')) { if (key === '*') { tip.i = tip.list.length - 1; } tipNext(); } }
  function tipHide() {
    const cur = tip.list[tip.i]; if (cur && cur.el()) cur.el().classList.remove('g-glow');
    el.tip.hidden = true; el.hint.style.visibility = ''; tip.i = tip.list.length;
  }
  el.tip.querySelector('.g-tip-x').addEventListener('click', (e) => {
    e.stopPropagation(); tipsOff = true; PREFS.tipsOff = true; tipHide();
  });
  function tipTick(dt) {
    const cur = tip.list[tip.i]; if (!cur || el.tip.hidden) return;
    tip.t += dt; if (cur.dur && tip.t >= cur.dur) tipNext();
  }

  // ---------- layout ----------
  function resize() {
    const r = wrap.getBoundingClientRect();
    S.W = Math.max(280, r.width); S.H = Math.max(420, r.height);
    S.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(S.W * S.dpr); canvas.height = Math.round(S.H * S.dpr);
    canvas.style.width = S.W + 'px'; canvas.style.height = S.H + 'px';
    S.botPad = el.panel.offsetHeight + 8;
    S.topPad = 58;
    const avail = S.H - S.topPad - S.botPad;
    S.cy0 = S.topPad + avail / 2;
    const s = Math.min(avail / 196, S.W / 96);
    S.overview = { x: 0, y: 86, s };
    if (S.phase === 'aim') { S.camT = { ...S.overview }; S.cam = { ...S.overview }; }
    cache.key = '';
  }
  function greenCam(focus) {
    const avail = S.H - S.topPad - S.botPad;
    const s = Math.min(S.W / 30, avail / 26);
    let fx = PIN.x, fy = PIN.y;
    if (focus) {
      const dx = focus.x - PIN.x, dy = focus.y - PIN.y;
      const need = Math.max(Math.abs(dx) * 2 + 10, 0) * s > S.W || Math.abs(dy) * 2 * s + 60 > avail;
      fx = PIN.x + dx * 0.5; fy = PIN.y + dy * 0.5;
      if (need) {
        const s2 = Math.min(S.W / (Math.abs(dx) + 14), avail / (Math.abs(dy) + 14));
        return { x: fx, y: fy, s: clamp(s2, S.overview.s, s) };
      }
    }
    return { x: fx, y: fy, s };
  }

  // ---------- drawing ----------
  const cache = { canvas: document.createElement('canvas'), key: '' };
  function worldXf(c, cam, ox, oy, s) { c.setTransform(s * S.dpr, 0, 0, -s * S.dpr, ox * S.dpr - s * S.dpr * cam.x, oy * S.dpr + s * S.dpr * cam.y); }

  function drawCourse(c, cam, cx, cy, detail) {
    const s = cam.s;
    worldXf(c, cam, cx, cy, s);
    // blob shadow + rough
    c.save();
    c.shadowColor = 'rgba(60,50,30,0.18)'; c.shadowBlur = 18 * S.dpr; c.shadowOffsetY = 6 * S.dpr;
    tracePoly(c, BLOB); c.fillStyle = C.rough; c.fill();
    c.restore();
    c.save();
    tracePoly(c, BLOB); c.clip();
    // subtle rough texture rings
    c.strokeStyle = C.roughEdge; c.lineWidth = 3; c.globalAlpha = 0.35; tracePoly(c, BLOB); c.stroke(); c.globalAlpha = 1;
    // surround (first cut) around green
    c.fillStyle = C.surround; tracePoly(c, buildSurround()); c.fill();
    // fairway with mowing stripes
    tracePoly(c, FAIRWAY); c.fillStyle = C.fair; c.fill();
    c.save(); tracePoly(c, FAIRWAY); c.clip(); c.fillStyle = C.fairStripe;
    for (let y = 20; y < 140; y += 8) c.fillRect(-60, y, 120, 4);
    c.restore();
    // tee box
    c.fillStyle = C.tee; roundRect(c, -4, -2.6, 8, 5.2, 1); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(-4, -0.4, 8, 1.6);
    // bank
    tracePoly(c, BANK); c.fillStyle = C.bank; c.fill();
    // creek
    tracePoly(c, CREEK); c.fillStyle = C.water; c.fill();
    c.save(); tracePoly(c, CREEK); c.clip();
    c.strokeStyle = C.waterDeep; c.globalAlpha = 0.35; c.lineWidth = 1.6;
    c.beginPath(); for (let x = -70; x <= 70; x += 2) { const y = creekC(x) + 0.4; x === -70 ? c.moveTo(x, y) : c.lineTo(x, y); } c.stroke();
    c.globalAlpha = 0.25; c.strokeStyle = '#fff'; c.lineWidth = 0.25;
    for (let k = -1; k <= 1; k += 2) { c.beginPath(); for (let x = -70; x <= 70; x += 2) { const y = creekC(x) + k * 1.6 + Math.sin(x * 0.7) * 0.2; x === -70 ? c.moveTo(x, y) : c.lineTo(x, y); } c.stroke(); }
    c.restore();
    c.globalAlpha = 0.9; c.strokeStyle = C.waterEdge; c.lineWidth = 0.45;
    c.beginPath(); for (let x = -70; x <= 70; x += 1.5) { x === -70 ? c.moveTo(x, creekLo(x)) : c.lineTo(x, creekLo(x)); } c.stroke();
    c.beginPath(); for (let x = -70; x <= 70; x += 1.5) { x === -70 ? c.moveTo(x, creekHi(x)) : c.lineTo(x, creekHi(x)); } c.stroke();
    c.globalAlpha = 1;
    // fringe + green
    tracePoly(c, FRINGE); c.fillStyle = C.fringe; c.fill();
    tracePoly(c, GREEN); c.fillStyle = C.green; c.fill();
    c.save(); tracePoly(c, GREEN); c.clip();
    c.translate(G_C.x, G_C.y); c.rotate(G_ANG + 0.9); c.fillStyle = C.greenStripe;
    for (let u = -30; u < 30; u += 3) c.fillRect(u, -30, 1.5, 60);
    c.restore();
    // rings, each band its own color
    c.save(); tracePoly(c, GREEN); c.clip();
    for (let i = 0; i < TIERS.length; i++) {
      const r = TIERS[i].ft / 3, r0 = i ? TIERS[i - 1].ft / 3 : 0;
      c.beginPath(); c.arc(PIN.x, PIN.y, r, 0, Math.PI * 2);
      if (r0) { c.moveTo(PIN.x + r0, PIN.y); c.arc(PIN.x, PIN.y, r0, 0, Math.PI * 2, true); }
      c.globalAlpha = 0.5; c.fillStyle = TIERS[i].color; c.fill('evenodd'); c.globalAlpha = 1;
      c.beginPath(); c.arc(PIN.x, PIN.y, r, 0, Math.PI * 2);
      c.lineWidth = 1.2 / s; c.strokeStyle = 'rgba(255,255,255,0.85)'; c.stroke();
    }
    c.restore();
    tracePoly(c, GREEN); c.lineWidth = 1 / s; c.strokeStyle = 'rgba(255,255,255,0.35)'; c.stroke();
    // slope arrows
    if (detail || s > 6) drawSlope(c, s);
    // bunkers
    for (const b of BUNKERS) {
      c.save(); c.translate(b.x, b.y); c.rotate(b.a);
      c.beginPath(); c.ellipse(0, 0, b.rx + 0.5, b.ry + 0.5, 0, 0, Math.PI * 2); c.fillStyle = 'rgba(70,90,40,0.35)'; c.fill();
      c.beginPath(); c.ellipse(0, 0, b.rx, b.ry, 0, 0, Math.PI * 2); c.fillStyle = C.sand; c.fill();
      c.beginPath(); c.ellipse(-0.3, 0.35, b.rx * 0.9, b.ry * 0.7, 0, Math.PI * 0.05, Math.PI * 0.95); c.strokeStyle = C.sandShadow; c.lineWidth = 0.35; c.stroke();
      c.restore();
    }
    // mulch beds
    c.fillStyle = C.mulch; c.globalAlpha = 0.55;
    for (const a of AZALEAS) { c.beginPath(); c.arc(a.x, a.y, a.r + 0.9, 0, Math.PI * 2); c.fill(); }
    c.globalAlpha = 1;
    c.restore(); // end blob clip

    // trees + azaleas (can hang over the course edge)
    c.fillStyle = C.shadow;
    for (const t of TREES) { c.beginPath(); c.arc(t.x + 1.6, t.y - 1.8, t.r * 0.95, 0, Math.PI * 2); c.fill(); }
    for (const a of AZALEAS) { c.fillStyle = C.azalea; c.beginPath(); c.arc(a.x, a.y, a.r, 0, Math.PI * 2); c.fill(); c.fillStyle = C.azaleaHi; c.beginPath(); c.arc(a.x - a.r * 0.3, a.y + a.r * 0.3, a.r * 0.45, 0, Math.PI * 2); c.fill(); }
    for (const t of TREES) {
      for (const b of t.blobs) { c.fillStyle = C.tree; c.beginPath(); c.arc(t.x + b.x, t.y + b.y, b.r, 0, Math.PI * 2); c.fill(); }
      for (const b of t.blobs) { c.fillStyle = C.treeMid; c.beginPath(); c.arc(t.x + b.x - b.r * 0.2, t.y + b.y + b.r * 0.2, b.r * 0.7, 0, Math.PI * 2); c.fill(); }
      for (const b of t.blobs) { c.fillStyle = C.treeHi; c.beginPath(); c.arc(t.x + b.x - b.r * 0.35, t.y + b.y + b.r * 0.35, b.r * 0.32, 0, Math.PI * 2); c.fill(); }
    }
    // tee markers
    c.fillStyle = C.camel; for (const x of [-3, 3]) { c.beginPath(); c.arc(x, 1.2, Math.max(0.35, 2 / s), 0, Math.PI * 2); c.fill(); }
  }
  let _surround = null;
  function buildSurround() { if (!_surround) _surround = buildSdfPoly(6.5); return _surround; }
  function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

  function drawSlope(c, s) {
    c.save(); tracePoly(c, GREEN); c.clip();
    c.strokeStyle = 'rgba(255,255,255,0.55)'; c.fillStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1.2 / s;
    const step = 2.2;
    for (let u = -20; u <= 20; u += step) for (let v = -8; v <= 8; v += step) {
      const x = G_C.x + u * G_AX.x + v * G_N.x, y = G_C.y + u * G_AX.y + v * G_N.y;
      if (greenSdf(x, y) > -0.5) continue;
      if (hyp(x - PIN.x, y - PIN.y) < 0.9) continue;
      const a = greenSlope(x, y), m = hyp(a.x, a.y), L = 0.5 + m * 2.2;
      const ex = x + (a.x / m) * L * 0.5, ey = y + (a.y / m) * L * 0.5, sx = x - (a.x / m) * L * 0.5, sy = y - (a.y / m) * L * 0.5;
      c.beginPath(); c.moveTo(sx, sy); c.lineTo(ex, ey); c.stroke();
      const hx = a.x / m, hy = a.y / m, hs = 0.35;
      c.beginPath(); c.moveTo(ex, ey); c.lineTo(ex - hx * hs * 1.6 - hy * hs, ey - hy * hs * 1.6 + hx * hs); c.lineTo(ex - hx * hs * 1.6 + hy * hs, ey - hy * hs * 1.6 - hx * hs); c.closePath(); c.fill();
    }
    c.restore();
  }

  function toScreen(cam, cx, cy, x, y) { return { x: cx + (x - cam.x) * cam.s, y: cy - (y - cam.y) * cam.s }; }

  function drawPin(c, cam, cx, cy, big) {
    const p = toScreen(cam, cx, cy, PIN.x, PIN.y);
    c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    const hr = Math.max(2.4, 0.07 * cam.s);
    const stick = big ? 46 : 26;
    // stick shadow
    c.strokeStyle = 'rgba(30,40,20,0.35)'; c.lineWidth = 1.6; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + stick * 0.55, p.y + stick * 0.25); c.stroke();
    c.fillStyle = '#1d1a14'; c.beginPath(); c.arc(p.x, p.y, hr, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#F7F2E6'; c.lineWidth = big ? 2 : 1.6; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x, p.y - stick); c.stroke();
    const fw = big ? 16 : 11, fh = big ? 10 : 7;
    const wave = Math.sin(S.time * 6) * 1.2;
    const wdir = S.wind.x >= 0 ? 1 : -1;
    c.fillStyle = C.flag; c.beginPath(); c.moveTo(p.x, p.y - stick); c.quadraticCurveTo(p.x + wdir * fw * 0.5, p.y - stick + fh * 0.5 - 2 + wave, p.x + wdir * fw, p.y - stick + fh * 0.5); c.lineTo(p.x, p.y - stick + fh); c.closePath(); c.fill();
    return p;
  }

  function drawRingLabels(c, cam, cx, cy) {
    if (cam.s < 7) return;
    c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    c.font = '700 10px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const angs = [-0.75, -2.4, 0.75, 2.4, -1.57, 1.57, 0, Math.PI];
    const pin = toScreen(cam, cx, cy, PIN.x, PIN.y);
    const placed = [{ x: pin.x + 6, y: pin.y - 40 }, { x: pin.x, y: pin.y - 22 }];
    for (const t of TIERS) {
      const r = t.ft / 3;
      for (const ang of angs) {
        const wx = PIN.x + Math.cos(ang) * r, wy = PIN.y + Math.sin(ang) * r;
        if (greenSdf(wx, wy) > -0.5) continue;
        const p = toScreen(cam, cx, cy, wx, wy);
        if (placed.some((q) => hyp(q.x - p.x, q.y - p.y) < 22)) continue;
        placed.push(p);
        c.fillStyle = t.color;
        roundRect(c, p.x - 11, p.y - 7, 22, 14, 7); c.fill();
        c.fillStyle = '#2B2018';
        c.fillText(t.pct, p.x, p.y + 0.5);
        break;
      }
    }
  }

  function drawBall(c, cam, cx, cy) {
    const b = S.ball;
    if (S.splash && S.splash.t > 0.25) return;
    const g = toScreen(cam, cx, cy, b.x, b.y);
    c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    if (S.holed && S.roll && S.roll.done) return;
    const lift = b.h * cam.s * 0.55;
    const r = Math.max(3.4, 0.1 * cam.s) * (1 + b.h / 20);
    // shadow
    c.fillStyle = `rgba(20,30,10,${0.35 - Math.min(0.2, b.h / 120)})`;
    c.beginPath(); c.ellipse(g.x + Math.min(8, b.h * 0.12), g.y + Math.min(4, b.h * 0.06), r * 0.95, r * 0.6, 0, 0, Math.PI * 2); c.fill();
    // trail
    if (S.trail.length > 1) {
      c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 1.5; c.lineCap = 'round';
      c.beginPath();
      S.trail.forEach((t, i) => { const p = toScreen(cam, cx, cy, t.x, t.y); const y = p.y - t.h * cam.s * 0.55; i ? c.lineTo(p.x, y) : c.moveTo(p.x, y); });
      c.stroke();
    }
    c.fillStyle = '#fff'; c.beginPath(); c.arc(g.x, g.y - lift, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1; c.stroke();
    if (S.phase === 'settle' || S.phase === 'result') {
      const k = (S.time * 1.2) % 1;
      c.strokeStyle = `rgba(255,255,255,${0.9 * (1 - k)})`; c.lineWidth = 2;
      c.beginPath(); c.arc(g.x, g.y, r + 3 + k * 12, 0, Math.PI * 2); c.stroke();
    }
  }

  function drawAim(c, cam, cx, cy) {
    if (S.phase !== 'aim') return;
    const t = toScreen(cam, cx, cy, 0, 0), e = toScreen(cam, cx, cy, S.target.x, S.target.y);
    c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 1.6; c.setLineDash([5, 6]); c.lineDashOffset = -S.time * 18;
    c.beginPath(); c.moveTo(t.x, t.y); c.lineTo(e.x, e.y); c.stroke(); c.setLineDash([]);
    const rr = Math.max(8, 1.6 * cam.s);
    c.lineWidth = 2; c.strokeStyle = '#fff';
    c.beginPath(); c.arc(e.x, e.y, rr, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(e.x - rr - 5, e.y); c.lineTo(e.x - rr + 3, e.y); c.moveTo(e.x + rr - 3, e.y); c.lineTo(e.x + rr + 5, e.y);
    c.moveTo(e.x, e.y - rr - 5); c.lineTo(e.x, e.y - rr + 3); c.moveTo(e.x, e.y + rr - 3); c.lineTo(e.x, e.y + rr + 5); c.stroke();
    const yd = Math.round(hyp(S.target.x, S.target.y));
    c.font = '700 12px Inter, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const lx = e.x, ly = e.y + rr + 16;
    c.fillStyle = 'rgba(43,32,24,0.85)'; roundRect(c, lx - 20, ly - 9, 40, 18, 9); c.fill();
    c.fillStyle = '#FAF7F0'; c.fillText(yd + ' y', lx, ly + 0.5);
  }

  function drawHit(c, cam, cx, cy) {
    const h = S.hit; if (!h) return;
    const t = h.t, b = toScreen(cam, cx, cy, S.ball.x, S.ball.y), pin = toScreen(cam, cx, cy, PIN.x, PIN.y);
    const pulse = 0.5 + 0.5 * Math.sin(t * 9);
    const fade = Math.min(1, t / 0.25);
    // light up the band
    worldXf(c, cam, cx, cy, cam.s);
    c.save(); tracePoly(c, GREEN); c.clip();
    if (h.ring >= 0) {
      const r = TIERS[h.ring].ft / 3, r0 = h.ring ? TIERS[h.ring - 1].ft / 3 : 0;
      c.beginPath(); c.arc(PIN.x, PIN.y, r, 0, Math.PI * 2);
      if (r0) { c.moveTo(PIN.x + r0, PIN.y); c.arc(PIN.x, PIN.y, r0, 0, Math.PI * 2, true); }
      c.globalAlpha = fade * (0.45 + 0.35 * pulse); c.fillStyle = h.color; c.fill('evenodd');
      c.globalAlpha = fade; c.lineWidth = (3 + pulse * 2) / cam.s; c.strokeStyle = '#fff';
      c.beginPath(); c.arc(PIN.x, PIN.y, r, 0, Math.PI * 2); c.stroke();
      if (r0) { c.beginPath(); c.arc(PIN.x, PIN.y, r0, 0, Math.PI * 2); c.stroke(); }
    } else {
      tracePoly(c, GREEN); c.globalAlpha = fade * (0.18 + 0.2 * pulse); c.fillStyle = '#fff'; c.fill();
    }
    c.restore();
    c.globalAlpha = 1;
    c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    // ripple from the ball
    for (let i = 0; i < 2; i++) {
      const k = clamp((t - i * 0.25) / 0.9, 0, 1); if (k <= 0 || k >= 1) continue;
      c.strokeStyle = h.color; c.globalAlpha = 1 - k; c.lineWidth = 3;
      c.beginPath(); c.arc(b.x, b.y, 6 + k * 60, 0, Math.PI * 2); c.stroke();
    }
    c.globalAlpha = 1;
    // sparkles
    for (const p of h.sparks) {
      const k = clamp(t / p.life, 0, 1); if (k >= 1) continue;
      const d = p.v * (1 - (1 - k) * (1 - k));
      const x = b.x + Math.cos(p.a) * d, y = b.y + Math.sin(p.a) * d - 18 * k;
      c.globalAlpha = 1 - k; c.fillStyle = p.c;
      c.beginPath(); c.arc(x, y, p.r * (1 - k * 0.5), 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
    // discount pop
    const pk = clamp((t - 0.15) / 0.45, 0, 1);
    if (pk > 0) {
      const back = 1 + 2.4 * Math.pow(pk - 1, 3) + 1.4 * Math.pow(pk - 1, 2);
      const sc = Math.max(0.01, back);
      const lx = clamp((b.x + pin.x) / 2, 70, S.W - 70), ly = Math.max(S.topPad + 70, Math.min(b.y, pin.y) - 54 - pk * 8);
      c.save(); c.translate(lx, ly); c.scale(sc, sc);
      c.shadowColor = 'rgba(30,22,16,0.3)'; c.shadowBlur = 14; c.shadowOffsetY = 4;
      c.fillStyle = h.color; roundRect(c, -62, -22, 124, 44, 22); c.fill();
      c.shadowColor = 'transparent';
      c.lineWidth = 2; c.strokeStyle = '#fff'; c.stroke();
      c.fillStyle = '#2B2018'; c.font = '700 22px "Playfair Display", Georgia, serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(h.label, 0, 1);
      c.restore();
    }
  }

  function drawSplash(c, cam, cx, cy) {
    if (!S.splash) return;
    const p = toScreen(cam, cx, cy, S.splash.x, S.splash.y), t = S.splash.t;
    c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    for (let i = 0; i < 3; i++) {
      const k = clamp(t * 1.4 - i * 0.18, 0, 1);
      if (k <= 0) continue;
      c.strokeStyle = `rgba(255,255,255,${0.8 * (1 - k)})`; c.lineWidth = 2;
      c.beginPath(); c.ellipse(p.x, p.y, 4 + k * 22, 2.5 + k * 12, 0, 0, Math.PI * 2); c.stroke();
    }
  }

  function drawInset() {
    if (S.phase !== 'aim' || S.readMode) { el.read.style.display = S.phase === 'aim' ? '' : 'none'; return; }
    el.read.style.display = '';
    const R = 46, cx = S.W - R - 12, cy = S.topPad + R + 10;
    const icam = { x: PIN.x, y: PIN.y, s: 4.4 };
    ctx.save();
    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.beginPath(); ctx.arc(cx, cy, R + 3, 0, Math.PI * 2); ctx.fillStyle = 'rgba(250,247,240,0.95)'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    drawCourse(ctx, icam, cx, cy, true);
    drawPin(ctx, icam, cx, cy, false);
    ctx.restore();
  }

  function render() {
    const cam = S.cam;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.page; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const key = `${cam.x.toFixed(2)}|${cam.y.toFixed(2)}|${cam.s.toFixed(3)}|${S.W}|${S.H}|${S.dpr}`;
    const moving = hyp(S.camT.x - cam.x, S.camT.y - cam.y) > 0.02 || Math.abs(S.camT.s - cam.s) > 0.002;
    if (moving) {
      drawCourse(ctx, cam, S.W / 2, S.cy0, S.readMode);
    } else {
      if (cache.key !== key + S.readMode) {
        cache.canvas.width = canvas.width; cache.canvas.height = canvas.height;
        const cc = cache.canvas.getContext('2d');
        cc.setTransform(1, 0, 0, 1, 0, 0); cc.clearRect(0, 0, canvas.width, canvas.height);
        drawCourse(cc, cam, S.W / 2, S.cy0, S.readMode);
        cache.key = key + S.readMode;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(cache.canvas, 0, 0);
    }
    drawAim(ctx, cam, S.W / 2, S.cy0);
    drawPin(ctx, cam, S.W / 2, S.cy0, cam.s > 7);
    drawRingLabels(ctx, cam, S.W / 2, S.cy0);
    drawSplash(ctx, cam, S.W / 2, S.cy0);
    drawBall(ctx, cam, S.W / 2, S.cy0);
    drawHit(ctx, cam, S.W / 2, S.cy0);
    drawInset();
  }

  // ---------- meter ----------
  function updateMeter() { el.needle.style.left = mp(S.meter); }
  function meterAt(sw) { const k = sw % 2; return k < 1 ? -1 + 2 * k : 1 - 2 * (k - 1); }

  // ---------- shot logic ----------
  function setTarget(x, y) {
    let d = hyp(x, y), a = Math.atan2(x, y);
    a = clamp(a, -0.6, 0.6); d = clamp(d, 20, MAX_CARRY);
    S.target = { x: Math.sin(a) * d, y: Math.cos(a) * d };
    S.aim = (a * 180) / Math.PI;
  }
  function strike() {
    if (S.phase !== 'aim') return;
    audio();
    tipHide();
    const e = S.meter;
    S.err = e;
    buzz(14); sfx.strike();
    el.mark.style.left = mp(e); el.mark.style.opacity = 1;
    el.swing.disabled = true;
    el.panel.classList.add('busy');
    const zoneName = Math.abs(e) <= ZONE_PERFECT ? 'Perfect' : Math.abs(e) <= ZONE_GREEN ? 'Good' : Math.abs(e) <= ZONE_YELLOW ? 'Off' : 'Bad';
    setHint(zoneName === 'Perfect' ? 'Perfect strike' : zoneName === 'Good' ? 'Good strike' : e < 0 ? 'Early. Pulled left.' : 'Late. Pushed right.');
    if (S.readMode) { S.readMode = false; el.read.classList.remove('on'); el.read.querySelector('span').textContent = 'Read'; }
    S.camT = { ...S.overview };
    S.phase = 'wait';
    const shotNo = S.shot, target = { ...S.target };
    const req = backend.shot({ shot: shotNo, target, e });
    req.then((r) => launch(e, target, r)).catch((err) => {
      S.phase = 'aim'; el.swing.disabled = false; el.panel.classList.remove('busy'); el.mark.style.opacity = 0;
      setHint(err && err.message ? err.message : 'Lost the connection. Try that swing again.');
    });
  }
  function launch(e, target, r) {
    const sim = simulateShot({ pin: pinIdx, wind: S.wind, target, e, noise: r.noise });
    S.sim = sim;
    S.serverResult = r.result || sim.result;
    S.flight = { ...sim.flight, t: 0 };
    S.phase = 'flight';
    S.shotMeta = { strike: zoneFor(e), err: +e.toFixed(3), target: { x: +sim.target.x.toFixed(1), y: +sim.target.y.toFixed(1), yds: Math.round(hyp(sim.target.x, sim.target.y)) }, wind: { mph: S.wind.mph, dirDeg: S.wind.dirDeg }, carry: +sim.flight.carry.toFixed(1) };
  }
  function flightPos(f, t) {
    return { x: f.d.x * f.carry * t + f.pr.x * f.lat * t * t, y: f.d.y * f.carry * t + f.pr.y * f.lat * t * t, h: f.apex * 4 * t * (1 - t) };
  }
  function land() {
    const f = S.flight, p = flightPos(f, 1), sim = S.sim;
    S.ball.x = p.x; S.ball.y = p.y; S.ball.h = 0;
    S.landSurf = sim.landSurf;
    if (sim.landSurf === 'water') { splash(p.x, p.y); return; }
    if (['sand', 'trees', 'azaleas', 'out'].includes(sim.landSurf)) { sfx.thud(); finishRoll(); return; }
    S.roll = { k: 0, frames: sim.frames };
    S.phase = 'roll';
    sfx.thud();
    if (hyp(p.x - PIN.x, p.y - PIN.y) < 30) S.camT = greenCam(p);
  }
  function splash(x, y) {
    S.splash = { x, y, t: 0 };
    S.phase = 'splash';
    sfx.splash(); buzz(30);
    if (hyp(x - PIN.x, y - PIN.y) < 35) S.camT = greenCam({ x, y });
  }
  // plays back the precomputed roll (60 frames per second)
  function stepRoll(dt) {
    const r = S.roll, b = S.ball;
    r.k += dt * 60;
    const i = Math.min(r.frames.length - 1, Math.floor(r.k)), fr = r.frames[i];
    b.x = fr.x; b.y = fr.y; b.h = fr.h;
    if (hyp(b.x - PIN.x, b.y - PIN.y) < 30 && r.k > 12) S.camT = greenCam(b);
    if (i >= r.frames.length - 1) {
      if (S.sim.splash) splash(b.x, b.y);
      else finishRoll();
    }
  }
  function finishRoll() {
    S.phase = 'settle';
    S.settleT = 0;
    const b = S.ball;
    // the server's result is the one that counts
    const res = { ...S.serverResult };
    if (res.rest) { b.x = res.rest.x; b.y = res.rest.y; b.h = 0; }
    S.holed = res.surf === 'holed';
    if (S.holed) { sfx.cup(); buzz([20, 40, 60]); }
    Object.assign(res, S.shotMeta || {}, { shot: S.shot + 1, pin: pinDef.name });
    S.results[S.shot] = res;
    if (res.pct > 0) {
      const ring = res.surf === 'holed' ? 0 : TIERS.findIndex((t) => t.pct === res.pct);
      const color = res.surf === 'holed' ? TIERS[0].color : tierColor(res.pct);
      const sparks = [];
      const n = res.pct >= 30 ? 26 : 16;
      for (let i = 0; i < n; i++) sparks.push({ a: rng() * Math.PI * 2, v: 26 + rng() * 46, r: 2 + rng() * 2.5, life: 0.7 + rng() * 0.5, c: i % 3 ? color : '#ffffff' });
      S.hit = { t: 0, ring, color, sparks, label: (res.surf === 'holed' ? 'Ace! ' : '') + res.pct + '% off' };
      sfx.cup && res.surf !== 'holed' && tone(660 + res.pct * 12, 0.25, 0.08);
    }
    frameResult();
    if (!S.best || res.pct > S.best.pct || (res.pct === S.best.pct && res.pct > 0 && res.feet < S.best.feet)) S.best = res;
    emit('shot', res);
    renderShotBalls();
  }

  function frameResult() {
    const ch = 214, visTop = S.topPad + 70, visBot = S.H - ch - 10;
    const b = S.ball, midY = (b.y + PIN.y) / 2, midX = (b.x + PIN.x) / 2;
    if (hyp(b.x - PIN.x, b.y - PIN.y) > 40) return;
    const span = Math.max(Math.abs(b.y - PIN.y), Math.abs(b.x - PIN.x) * (visBot - visTop) / S.W) + 6;
    const sFit = clamp(Math.min((visBot - visTop) / span, S.W / (Math.abs(b.x - PIN.x) + 12)), S.overview.s, S.W / 30);
    S.camT = { x: midX, y: midY - ((S.cy0 - (visTop + visBot) / 2) / sFit), s: sFit };
  }

  // ---------- cards ----------
  function showResult() {
    const r = S.results[S.shot];
    const left = shotsTotal - S.shot - 1;
    S.phase = 'result';
    el.panel.classList.add('busy');
    const big = r.surf === 'holed' ? 'Ace' : r.surf === 'green' ? `${r.feet} ft` : r.surf === 'water' ? 'Splash' : 'Missed';
    const chip = r.pct > 0 ? `<span class="g-chip">${r.pct}% off</span>` : '';
    const bestTxt = S.best && S.best.pct > 0 ? 'Best so far: ' + S.best.pct + '% off. ' : '';
    const bestLine = left > 0 && r.pct < HOLED_PCT ? `<p class="g-card-sub">${bestTxt}Your best shot is the one we keep.</p>` : '';
    let btns = '';
    if (r.pct >= HOLED_PCT || left === 0) btns = `<button class="g-btn" data-act="final">Get my code</button>`;
    else {
      btns = `<button class="g-btn" data-act="next">Next shot <small>${left} left</small></button>`;
      btns += `<button class="g-btn g-btn-ghost" data-act="final">Skip to my code</button>`;
    }
    el.card.innerHTML = `<div class="g-card-in"><div class="g-card-top"><b class="g-big">${big}</b>${chip}</div><p class="g-card-note">${r.note}</p>${bestLine}<div class="g-card-btns">${btns}</div></div>`;
    el.card.hidden = false;
    requestAnimationFrame(() => el.card.classList.add('on'));
    const first = el.card.querySelector('.g-btn'); if (first) first.focus({ preventScroll: true });
  }
  function hideCard() { el.card.classList.remove('on'); el.card.hidden = true; }

  function showFinal() {
    S.phase = 'done';
    el.panel.classList.add('busy');
    el.card.innerHTML = '<div class="g-final-in"><p class="g-eyebrow">One sec</p><h3 class="g-final-h">Getting your code</h3><span class="g-spin"></span></div>';
    el.card.hidden = false;
    el.card.classList.add('final');
    requestAnimationFrame(() => el.card.classList.add('on'));
    backend.claim().then(renderFinal).catch((err) => {
      el.card.innerHTML = `<div class="g-final-in"><p class="g-eyebrow">Hmm</p><h3 class="g-final-h">We could not load your code.</h3><p class="g-card-sub">${(err && err.message) || 'Check your connection.'}</p><button class="g-btn" data-act="final" type="button">Load my code</button></div>`;
    });
  }
  function renderFinal(c) {
    const best = S.best && S.best.pct > 0 ? S.best : null;
    const pct = c.pct, won = c.won, pending = c.status === 'pending';
    const chips = S.results.map((r) => `<span class="${r === best ? 'best' : ''}">${r.surf === 'holed' ? 'Ace' : r.surf === 'green' ? r.feet + ' ft' : r.surf === 'water' ? 'Creek' : 'Miss'}${r.pct ? ' · ' + r.pct + '%' : ''}</span>`).join('');
    S.code = pending ? null : c.code;
    const leftNow = shotsTotal - S.shot - 1;
    const canResume = leftNow > 0 && !(best && best.pct >= HOLED_PCT);
    const resumeBtn = canResume ? `<button class="g-btn" data-act="resume" type="button">Take my ${leftNow} other shot${leftNow > 1 ? 's' : ''}</button><p class="g-card-sub">Your best shot is kept. It can only go up.</p>` : '';
    emit('claim', { pct, won: !!won, floor: floorPct, shots: S.results.length, pending });
    if (!pending && opts.onReward) opts.onReward({ code: c.code, percent: pct, expiresAt: c.expiresAt });
    const head = won
      ? `<p class="g-eyebrow">You won</p><h3 class="g-final-h">${pct}% off</h3>`
      : `<p class="g-eyebrow">Tough hole</p><h3 class="g-final-h">${pct}% off anyway.</h3><p class="g-card-sub">${hasPhone ? 'For joining the list and adding your phone.' : 'For joining the list.'}</p>`;
    const exp = c.expiresAt ? `<p class="g-card-sub">One use. Expires ${new Date(c.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.${opts.terms ? ` ${esc(opts.terms)}` : ''}</p>` : '';
    const codeBox = pending
      ? `<p class="g-card-sub g-pending">Your code is on its way. We will email it to you in a few minutes.</p>`
      : `<div class="g-code"><span class="g-code-txt">${c.code}</span><button class="g-copy" type="button">Copy</button></div>${exp}<p class="g-card-sub">Saved to your bag on this device. We sent it to your email too.</p>`;
    el.card.innerHTML = `<div class="g-final-in">
        ${head}
        <div class="g-shots-sum">${chips}</div>
        ${codeBox}
        ${resumeBtn}
        <button class="g-btn${resumeBtn ? ' g-btn-ghost' : ''}" data-act="close" type="button">Keep shopping</button>
      </div>`;
  }

  el.card.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (b) {
      const act = b.dataset.act;
      if (act === 'next') { hideCard(); S.shot++; setupShot(); }
      else if (act === 'final') { hideCard(); showFinal(); }
      else if (act === 'resume') { hideCard(); el.card.classList.remove('final'); S.code = null; emit('resume', {}); S.shot++; setupShot(); }
      else if (act === 'close') { opts.onClose && opts.onClose(); }
      return;
    }
    const cp = e.target.closest('.g-copy');
    if (cp && S.code) {
      const done = () => { cp.textContent = 'Copied'; setTimeout(() => (cp.textContent = 'Copy'), 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(S.code).then(done, () => selectCode());
      else selectCode();
    }
  });
  function selectCode() { const t = el.card.querySelector('.g-code-txt'); const r = document.createRange(); r.selectNodeContents(t); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }

  // ---------- input ----------
  el.swing.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); strike(); });
  el.swing.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); strike(); } });
  window.addEventListener('keydown', onKey);
  function onKey(e) {
    if (!wrap.isConnected) { window.removeEventListener('keydown', onKey); return; }
    if (e.target && e.target.closest && e.target.closest('.g-swing')) return;
    if (e.key === ' ' && S.phase === 'aim') { e.preventDefault(); strike(); }
  }
  function screenToWorld(cx, cy) {
    const r = canvas.getBoundingClientRect(), c = S.cam;
    const sx = cx - r.left, sy = cy - r.top;
    return { x: c.x + (sx - S.W / 2) / c.s, y: c.y - (sy - S.cy0) / c.s };
  }
  let drag = null;
  const aimAt = (e) => { const w = screenToWorld(e.clientX, e.clientY); setTarget(w.x, w.y); const cur = tip.list[tip.i]; if (cur && (cur.key === 'wind' || cur.key === 'read' || cur.key === 'aim') && tip.list.length > 1) { tip.i = 2; tipNext(); } };
  canvas.addEventListener('pointerdown', (e) => {
    if (S.phase !== 'aim') return;
    drag = e.pointerId; canvas.setPointerCapture(e.pointerId); aimAt(e);
  });
  canvas.addEventListener('pointermove', (e) => { if (drag === null || S.phase !== 'aim') return; aimAt(e); });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  el.read.addEventListener('click', () => {
    if (S.phase !== 'aim') return;
    S.readMode = !S.readMode;
    tipDone('read');
    el.read.classList.toggle('on', S.readMode);
    el.read.querySelector('span').textContent = S.readMode ? 'Back' : 'Read';
    S.camT = S.readMode ? greenCam() : { ...S.overview };
  });

  // ---------- loop ----------
  function update(dt) {
    S.time += dt;
    tipTick(dt);
    if (S.phase === 'aim') {
      S.sweep += dt / SWEEP_TIME;
      S.meter = meterAt(S.sweep);
      updateMeter();
    } else if (S.phase === 'flight') {
      const f = S.flight;
      f.t = Math.min(1, f.t + dt / f.dur);
      const p = flightPos(f, f.t);
      S.ball.x = p.x; S.ball.y = p.y; S.ball.h = p.h;
      S.trail.push({ x: p.x, y: p.y, h: p.h }); if (S.trail.length > 26) S.trail.shift();
      if (f.t >= 1) { S.trail = []; land(); }
    } else if (S.phase === 'roll') {
      stepRoll(dt);
    } else if (S.phase === 'splash') {
      S.splash.t += dt;
      if (S.splash.t > 0.9) { S.ball.x = S.splash.x; S.ball.y = S.splash.y; finishRoll(); }
    }
    if (S.hit) S.hit.t += dt;
    if (S.phase === 'settle') {
      S.settleT += dt;
      if (S.settleT > (S.holed ? 2.0 : S.hit ? 1.6 : 0.8)) showResult();
    }
    // camera
    const k = 1 - Math.exp(-dt * 4);
    S.cam.x = lerp(S.cam.x, S.camT.x, k); S.cam.y = lerp(S.cam.y, S.camT.y, k); S.cam.s = lerp(S.cam.s, S.camT.s, k);
  }

  let last = performance.now(), raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!wrap.isConnected) { cancelAnimationFrame(raf); return; }
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    update(dt);
    render();
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(wrap);
  resize();
  S.cam = { ...S.overview }; S.camT = { ...S.overview };
  newWind(); S.aim = aimToPin(); el.yds.textContent = Math.round(pinDist()); renderShotBalls();
  raf = requestAnimationFrame(frame);
  if (sess.results && sess.results.length) {
    S.results = sess.results.slice(); S.shot = S.results.length;
    for (const r of S.results) if (!S.best || r.pct > S.best.pct) S.best = r;
  }
  if (S.shot >= shotsTotal) { S.shot = shotsTotal - 1; renderShotBalls(); showFinal(); } else setupShot();

  return () => {
    ro.disconnect();
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    root.innerHTML = '';
  };
}
