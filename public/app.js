// Retro Techno Generator: browser side. Everything is synthesised with Web Audio; no samples.

// ---- signals ------------------------------------------------------------

const sig = { pulse: 72, breath: 14, breathLevel: 0.5, smile: 0, surprise: 0, talking: false, move: 0 };
// Vitals need you still; dancing moves the music instead. Below STILL the
// pulse and breathing readings are trusted, above it the last good ones hold.
const STILL = 0.15;
let lastMoveAt = 0, noiseFloor = null;
const isStill = () => sig.move < STILL && performance.now() - lastMoveAt > 1500;
let source = 'camera';
let breathHist = [];
let fakeBreathPhase = 0;

const $ = (id) => document.getElementById(id);
const pct = (v) => Math.min(1, Math.max(0, v / 100)); // SDK expression confidence is a percentage, 0-100

const ws = new WebSocket(`ws://${location.host}`);
ws.binaryType = 'arraybuffer';
ws.onmessage = (e) => {
  if (e.data instanceof ArrayBuffer) { calib.frame(e.data); return; }
  const m = JSON.parse(e.data);
  if (m.type === 'hello') { source = m.source; if (source === 'fake') $('fake').style.display = 'flex'; setStatus(`source: ${source}`); }
  if (m.type === 'status') { calib.status(m.code, m.hint); setStatus(m.code === 0 ? 'in position' : m.hint || `check camera (${m.code})`); }
  if (m.type === 'error') setStatus(`error: ${m.message}`);
  if (m.type === 'motion') {
    // camera noise sets a floor that varies with room light (about 3.5 in a dim
    // room); track it from below so standing still reads as zero
    noiseFloor = noiseFloor === null || m.value < noiseFloor ? m.value : noiseFloor + (m.value - noiseFloor) * 0.003;
    const v = Math.min(1, Math.max(0, (m.value - noiseFloor - 1) / 10)); // -> 0..1
    sig.move += (v - sig.move) * (v > sig.move ? 0.6 : 0.15);  // fast attack, slow release
    if (sig.move >= STILL) lastMoveAt = performance.now();
  }
  if (m.type === 'signals') {
    calib.signals();
    const still = isStill();
    if (still && m.pulse > 0) sig.pulse = m.pulse;
    if (still && m.breath > 0) sig.breath = m.breath;
    if (still && m.breathTrace) {
      breathHist = breathHist.concat(m.breathTrace).slice(-300);
      const lo = Math.min(...breathHist), hi = Math.max(...breathHist);
      sig.breathLevel = hi > lo ? (breathHist[breathHist.length - 1] - lo) / (hi - lo) : 0.5;
    }
    if (m.expr) {
      sig.smile = pct(m.expr.happy || 0);
      const s = pct(m.expr.surprise || 0);
      if (s > 0.6 && sig.surprise <= 0.6) engine.hoover();
      sig.surprise = s;
    }
    if (m.talking !== undefined) sig.talking = m.talking;
    if (m.blink) engine.stutter();
  }
};
const setStatus = (t) => { $('status').textContent = t; };

// ---- alignment preview --------------------------------------------------
// Mirror view of the camera with a head-and-shoulders outline, a red/yellow/green
// border and one plain instruction, so you can line up without guessing. It
// fills the screen until measurements flow, then shrinks to a corner thumbnail.

const SAY = { // SDK ValidationCode -> what to do, in plain words
  0: '✓ Good spot. Hold still…',
  1: "Can't see a face. Sit in front of the camera",
  2: 'Only one person in view, please',
  3: 'Put your face inside the outline',
  4: 'Move back a little',
  5: 'Too dark. Put a light in front of you',
  6: 'Too bright. Move away from the light behind you',
  7: '⬇ Show your shoulders: lean back or tilt the screen forward',
  10: 'Camera adjusting… hold on',
  11: 'Camera too slow. Add more light',
  12: 'Moving. Freeze for a few seconds to re-read pulse',
  13: '↩ Too close. Lean back',
  14: '↪ Too far. Come closer',
  15: '⬇ Move down, or tilt the screen back',
  16: '⬆ Move up, or tilt the screen forward',
  17: 'Look straight at the camera',
};

const calib = (() => {
  const box = $('calib'), cv = $('preview'), g = cv.getContext('2d');
  const off = document.createElement('canvas'), og = off.getContext('2d');
  // Pixelate: draws the preview as coarse blocks, enough to line up against the
  // outline without showing a recognisable face (for streaming or recording)
  const tiny = document.createElement('canvas'), tg = tiny.getContext('2d');
  let pixelate = false;
  try { pixelate = localStorage.getItem('pixelate') === '1'; } catch {}
  let code = null, hint = '', lastSignal = 0, running = false, view = 'auto', locked = false; // view: auto | hidden
  const measuring = () => Date.now() - lastSignal < 3000;

  function layout() {
    const show = running && view !== 'hidden';
    box.style.display = show ? 'flex' : 'none';
    if (measuring() && code === 0) locked = true; // first good reading: from now on stay a thumbnail
    box.classList.toggle('small', locked);
    box.classList.toggle('ok', code === 0);
    const colour = code === 0 ? (measuring() ? '#39ff14' : '#fc3') : '#f33';
    cv.style.borderColor = colour;
    $('c-say').textContent = code === null ? 'Starting camera…' : measuring() && code === 0 ? '✓ Measuring' : SAY[code] || hint || `Check camera (${code})`;
    $('c-sub').textContent = code !== null && code !== 0 && hint ? `(${hint})` : code === 0 && !measuring() ? 'First readings take a few seconds.' : '';
  }

  function frame(ab) {
    const v = new DataView(ab), w = v.getUint16(0, true), h = v.getUint16(2, true);
    const rgb = new Uint8Array(ab, 4), img = og.createImageData(w, h);
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) { img.data[j] = rgb[i]; img.data[j + 1] = rgb[i + 1]; img.data[j + 2] = rgb[i + 2]; img.data[j + 3] = 255; }
    if (off.width !== w || off.height !== h) { off.width = w; off.height = h; }
    og.putImageData(img, 0, 0);
    const W = cv.width, H = cv.height;
    let src = off;
    if (pixelate) {
      tiny.width = 24; tiny.height = Math.round(24 * h / w);
      tg.drawImage(off, 0, 0, tiny.width, tiny.height); src = tiny;
    }
    g.imageSmoothingEnabled = !pixelate;
    g.save(); g.translate(W, 0); g.scale(-1, 1); g.drawImage(src, 0, 0, W, H); g.restore(); // mirror
    // target outline: head in the upper middle, shoulders along the bottom
    g.setLineDash([6, 5]); g.lineWidth = 2; g.strokeStyle = code === 0 ? '#39ff14' : '#ffffffcc';
    g.beginPath(); g.ellipse(W / 2, H * 0.40, W * 0.085, H * 0.21, 0, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(W * 0.22, H); g.quadraticCurveTo(W * 0.26, H * 0.70, W * 0.42, H * 0.67);
    g.moveTo(W * 0.78, H); g.quadraticCurveTo(W * 0.74, H * 0.70, W * 0.58, H * 0.67); g.stroke();
    g.setLineDash([]);
    layout();
  }

  return {
    frame,
    status(c, h) { code = c; hint = h || ''; layout(); },
    signals() { lastSignal = Date.now(); layout(); },
    start() { running = source !== 'fake'; code = null; view = 'auto'; locked = false; layout(); },
    stop() { running = false; layout(); },
    setPixelate(on) {
      pixelate = on; try { localStorage.setItem('pixelate', on ? '1' : '0'); } catch {}
      $('pixel').textContent = on ? 'Show face' : 'Pixelate';
    },
    get pixelate() { return pixelate; },
    toggle() { view = view === 'hidden' ? 'auto' : 'hidden'; layout(); },
  };
})();

// fake-signal panel
$('f-pulse').oninput = (e) => { sig.pulse = +e.target.value; };
$('f-breath').oninput = (e) => { sig.breath = +e.target.value; };
$('f-smile').oninput = (e) => { sig.smile = e.target.value / 100; };
$('f-talk').onchange = (e) => { sig.talking = e.target.checked; };
$('f-blink').onclick = () => engine.stutter();
$('f-surprise').onclick = () => engine.hoover();

// ---- audio engine -------------------------------------------------------

let ctx, bus, master, scope, crunch, noiseBuf;
const mtof = (n) => 440 * 2 ** ((n - 69) / 12);
const MINOR = [0, 3, 5, 7, 10], MAJOR = [0, 2, 4, 7, 9];
const ROOT = 45; // A2

function initAudio() {
  ctx = new AudioContext();
  master = ctx.createBiquadFilter(); master.type = 'lowpass'; master.frequency.value = 18000;
  const comp = ctx.createDynamicsCompressor();
  scope = ctx.createAnalyser(); scope.fftSize = 2048;
  bus = ctx.createGain(); bus.gain.value = 0.8;
  bus.connect(master).connect(comp).connect(scope).connect(ctx.destination);
  crunch = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 6); }
  crunch.curve = curve; crunch.connect(bus);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

function env(g, t, peak, a, dec) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
}

function kick(t, hard) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.setValueAtTime(hard ? 220 : 150, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  env(g, t, hard ? 1 : 0.9, 0.002, hard ? 0.35 : 0.3);
  o.connect(g).connect(hard ? crunch : bus); o.start(t); o.stop(t + 0.5);
}

function noise(t, type, freq, peak, dec, q = 1) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; f.type = type; f.frequency.value = freq; f.Q.value = q;
  env(g, t, peak, 0.001, dec);
  s.connect(f).connect(g).connect(bus); s.start(t); s.stop(t + dec + 0.05);
}
const hat = (t, open) => noise(t, 'highpass', 8000, 0.25, open ? 0.15 : 0.04);
const snare = (t, v = 0.5) => { noise(t, 'bandpass', 1800, v, 0.12, 0.8); tone(t, 'triangle', 190, v * 0.6, 0.08); };
const clap = (t) => { for (const dt of [0, 0.01, 0.02]) noise(t + dt, 'bandpass', 1200, 0.35, 0.09, 2); };

function tone(t, type, freq, peak, dec, dest = bus) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.value = freq; env(g, t, peak, 0.003, dec);
  o.connect(g).connect(dest); o.start(t); o.stop(t + dec + 0.05);
}

// TB-303-style voice: saw -> resonant lowpass with a snappy filter envelope
function acid(t, note, accent, dur) {
  const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  o.type = 'sawtooth'; o.frequency.value = mtof(note);
  const base = 180 + sig.smile * 2200 + sig.breathLevel * 500 + sig.move * 2500;
  f.type = 'lowpass'; f.Q.value = 14 + sig.smile * 10;
  f.frequency.setValueAtTime(base * (accent ? 5 : 3), t);
  f.frequency.exponentialRampToValueAtTime(base, t + (accent ? 0.25 : 0.15));
  g.gain.setValueAtTime(accent ? 0.45 : 0.3, t);
  g.gain.setTargetAtTime(0.0001, t + dur * 0.8, 0.02);
  o.connect(f).connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.2);
}

function pad(t, notes, dur) {
  for (const n of notes) for (const det of [-8, 8]) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = det;
    f.type = 'lowpass'; f.frequency.value = 600 + sig.breathLevel * 1400;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + dur * 0.4);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.1);
  }
}

// rave piano stab: a stack of triangles and squares with a fast decay
function stab(t, notes) {
  for (const n of notes) { tone(t, 'triangle', mtof(n), 0.18, 0.35); tone(t, 'square', mtof(n), 0.05, 0.2); }
}

// formant "vocal" chop, pitched up
function vox(t) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sawtooth'; o.frequency.value = mtof(ROOT + 36 + pick(scale()));
  env(g, t, 0.4, 0.005, 0.12);
  for (const [fr, q] of [[800, 8], [1200, 10]]) {
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = fr * (0.8 + Math.random() * 0.6); f.Q.value = q;
    o.connect(f).connect(g);
  }
  g.connect(bus); o.start(t); o.stop(t + 0.2);
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const scale = () => (sig.smile > 0.5 ? MAJOR : MINOR);
const chord = (deg) => { const s = scale(); return [0, 2, 4].map((i) => ROOT + 24 + s[(deg + i) % 5] + (deg + i >= 5 ? 12 : 0)); };

// ---- sequencer ----------------------------------------------------------

const engine = {
  running: false, step: 0, nextTime: 0, bpm: 140, mode: 'acid', bar: 0,
  stutterSteps: 0, acidPat: [], drawQueue: [],

  newAcid() {
    this.acidPat = Array.from({ length: 16 }, () =>
      Math.random() < 0.7 ? { note: ROOT + pick([0, 0, 12, 3, 7, 10, 15]), accent: Math.random() < 0.3 } : null);
  },
  mutateAcid() { for (let i = 0; i < 2; i++) this.acidPat[Math.floor(Math.random() * 16)] = Math.random() < 0.7 ? { note: ROOT + pick([0, 12, 3, 7, 10]), accent: Math.random() < 0.3 } : null; },
  stutter() { this.stutterSteps = 4; glitchUntil = performance.now() + 250; },
  hoover() {
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const det of [-25, -10, 0, 10, 25]) {
      const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o.detune.value = det;
      o.frequency.setValueAtTime(mtof(ROOT + 12), t);
      o.frequency.linearRampToValueAtTime(mtof(ROOT + 24), t + 0.08);
      o.frequency.exponentialRampToValueAtTime(mtof(ROOT), t + 0.9);
      f.type = 'lowpass'; f.frequency.value = 3000;
      env(g, t, 0.08, 0.02, 1);
      o.connect(f).connect(g).connect(bus); o.start(t); o.stop(t + 1.1);
    }
    glitchUntil = performance.now() + 400;
  },

  pickMode() {
    const o = $('override').value;
    if (o !== 'auto') return o;
    const p = sig.pulse, m = this.mode; // 3 bpm hysteresis so it doesn't flap at the edges
    if (p < (m === 'ambient' ? 73 : 67)) return 'ambient';
    if (p > (m === 'hardcore' ? 87 : 93)) return 'hardcore';
    return 'acid';
  },

  playStep(s, t) {
    const sixteenth = 60 / this.bpm / 4;
    if (this.stutterSteps > 0) {
      this.stutterSteps--;
      for (let i = 0; i < 2; i++) snare(t + i * sixteenth / 2, 0.3 + i * 0.1);
      return;
    }
    const mode = this.mode;
    if (mode === 'ambient') {
      if (s === 0 && this.bar % 2 === 0) pad(t, chord(pick([0, 3, 4, 1])), sixteenth * 32);
      if (s % 4 === 2 && Math.random() < 0.6) tone(t, 'sine', mtof(ROOT + 36 + pick(scale())), 0.12, 0.6);
      if (s === 0) kick(t, false);
    } else if (mode === 'acid') {
      if (s % 4 === 0) kick(t, false);
      if (s % 4 === 2) hat(t, true); else if (s % 2 === 1 || sig.move > 0.5) hat(t, false);
      if (s === 4 || s === 12) clap(t);
      const n = this.acidPat[s]; if (n) acid(t, n.note, n.accent, sixteenth);
      if (sig.talking && s % 4 === 3) vox(t);
    } else {
      if (s % 4 === 0) kick(t, true);
      if ([4, 12].includes(s)) snare(t, 0.7);
      if ([7, 9, 15].includes(s)) snare(t, 0.25);
      if (s % 2 === 0 || sig.move > 0.5) hat(t, s % 4 === 2);
      if ([0, 3, 6, 10].includes(s)) stab(t, chord(this.bar % 4 === 3 ? 4 : 0));
      if (s % 4 === 0) tone(t, 'sine', mtof(ROOT - 12), 0.4, sixteenth * 3);
      if (sig.talking && s % 2 === 1) vox(t);
    }
  },

  tick() {
    while (this.nextTime < ctx.currentTime + 0.1) {
      if (this.step === 0) {
        this.bar++;
        const m = this.pickMode();
        if (m !== this.mode) { this.mode = m; this.newAcid(); }
        if (this.bar % 8 === 0) this.mutateAcid();
      }
      // tempo glides toward pulse x 2; ambient plays at half feel
      const target = Math.min(190, Math.max(100, Math.round(sig.pulse * 2)));
      this.bpm += (target - this.bpm) * 0.05;
      this.playStep(this.step, this.nextTime);
      this.drawQueue.push({ step: this.step, time: this.nextTime });
      this.nextTime += 60 / this.bpm / 4;
      this.step = (this.step + 1) % 16;
    }
    // master filter: movement opens it, breathing sways it while you're still
    if (!isStill()) sig.breathLevel += (0.5 - sig.breathLevel) * 0.02;
    master.frequency.setTargetAtTime(1200 + sig.move * 14000 + sig.breathLevel * 4000, ctx.currentTime, 0.1);
  },

  start() {
    if (!ctx) initAudio();
    ctx.resume();
    this.newAcid();
    this.nextTime = ctx.currentTime + 0.05;
    this.running = true;
    this.timer = setInterval(() => this.tick(), 25);
  },
  stop() { this.running = false; clearInterval(this.timer); ctx?.suspend(); },
};

// fake breathing when there is no SDK
setInterval(() => {
  if (source !== 'fake') return;
  fakeBreathPhase += (sig.breath / 60) * 2 * Math.PI * 0.05;
  sig.breathLevel = 0.5 + 0.5 * Math.sin(fakeBreathPhase);
}, 50);

// ---- visuals ------------------------------------------------------------

const cv = $('scope'), g2 = cv.getContext('2d');
let glitchUntil = 0, curStep = 0;
const COLORS = { ambient: '#3fa9ff', acid: '#39ff14', hardcore: '#ff2bd6' };

function draw() {
  requestAnimationFrame(draw);
  const w = (cv.width = innerWidth * devicePixelRatio), h = (cv.height = innerHeight * devicePixelRatio);
  const col = COLORS[engine.mode];
  document.documentElement.style.setProperty('--fg', col);
  g2.fillStyle = '#000'; g2.fillRect(0, 0, w, h);
  if (!ctx) return;

  while (engine.drawQueue.length && engine.drawQueue[0].time <= ctx.currentTime) curStep = engine.drawQueue.shift().step;

  // step grid
  const cell = Math.min(w / 18, 60 * devicePixelRatio), gx = (w - cell * 16) / 2, gy = h * 0.72;
  for (let i = 0; i < 16; i++) {
    const on = engine.mode === 'acid' ? !!engine.acidPat[i] : i % 4 === 0;
    g2.fillStyle = i === curStep ? '#fff' : on ? col : '#222';
    g2.fillRect(gx + i * cell + 2, gy, cell - 4, cell - 4);
  }

  // oscilloscope
  const data = new Uint8Array(scope.fftSize); scope.getByteTimeDomainData(data);
  g2.strokeStyle = col; g2.lineWidth = 2 * devicePixelRatio; g2.shadowColor = col; g2.shadowBlur = 12;
  g2.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = (i / data.length) * w, y = h * 0.42 + ((data[i] - 128) / 128) * h * 0.25;
    i ? g2.lineTo(x, y) : g2.moveTo(x, y);
  }
  g2.stroke(); g2.shadowBlur = 0;

  // blink / surprise glitch: tear horizontal slices
  if (performance.now() < glitchUntil) {
    for (let i = 0; i < 12; i++) {
      const y = Math.random() * h, sh = Math.random() * 40 * devicePixelRatio;
      g2.drawImage(cv, 0, y, w, sh, (Math.random() - 0.5) * 120 * devicePixelRatio, y, w, sh);
    }
  }

  $('mode').textContent = engine.mode.toUpperCase();
  $('bpm').textContent = Math.round(engine.bpm);
  $('pulse').textContent = Math.round(sig.pulse);
  $('breath').textContent = Math.round(sig.breath);
  $('smile').textContent = `${Math.round(sig.smile * 100)}%`;
  $('move').textContent = '█'.repeat(Math.round(sig.move * 8)).padEnd(8, '·');
  $('vitals').textContent = source === 'fake' ? '-' : isStill() ? 'LIVE' : 'HELD';
}
draw();

// ---- start / stop -------------------------------------------------------

$('start').onclick = () => {
  $('consent').style.display = 'none';
  calib.start();
  engine.start();
  ws.send(JSON.stringify({ type: 'start' }));
};
$('stop').onclick = () => {
  engine.stop();
  calib.stop();
  ws.send(JSON.stringify({ type: 'stop' }));
  $('consent').style.display = 'grid';
  setStatus('stopped, camera off');
};
$('view').onclick = () => calib.toggle();
$('pixel').onclick = () => calib.setPixelate(!calib.pixelate);
calib.setPixelate(calib.pixelate);

// ---- demo recorder --------------------------------------------------------
// Records what this page shows (scope, step grid, HUD, the alignment preview
// with its border and instruction) plus the synth's audio, straight from the
// page, and saves a .webm. Nothing is uploaded; the file lands in Downloads.

const recorder = (() => {
  const RW = 1280, RH = 720;
  const rc = document.createElement('canvas'); rc.width = RW; rc.height = RH;
  const rg = rc.getContext('2d');
  let mr = null, chunks = [], raf = 0, audioDest = null;

  function text(el, str = el.textContent) {
    const r = el.getBoundingClientRect(); if (!r.width || !str.trim()) return;
    const cs = getComputedStyle(el), { k, ox, oy } = fit();
    rg.fillStyle = cs.color; rg.textBaseline = 'top'; rg.textAlign = 'left';
    rg.font = `${cs.fontWeight} ${parseFloat(cs.fontSize) * k}px ${cs.fontFamily}`;
    rg.fillText(str.trim(), ox + r.left * k, oy + r.top * k);
  }
  // one scale for both axes, page centred in the 16:9 frame
  const fit = () => { const k = Math.min(RW / innerWidth, RH / innerHeight); return { k, ox: (RW - innerWidth * k) / 2, oy: (RH - innerHeight * k) / 2 }; };
  const visible = (el) => el.offsetParent !== null && getComputedStyle(el).display !== 'none';

  function frame() {
    const { k, ox, oy } = fit(), X = (v) => ox + v * k, Y = (v) => oy + v * k;
    rg.fillStyle = '#000'; rg.fillRect(0, 0, RW, RH);
    rg.drawImage(cv, ox, oy, innerWidth * k, innerHeight * k);
    for (const d of $('hud').children) { text(d, d.firstChild.textContent); text(d.querySelector('b')); }
    text($('status'));
    if (visible($('calib'))) {
      const pr = $('preview'), r = pr.getBoundingClientRect(), bw = parseFloat(getComputedStyle(pr).borderTopWidth);
      rg.fillStyle = '#000d'; const br = $('calib').getBoundingClientRect();
      rg.fillRect(X(br.left), Y(br.top), br.width * k, br.height * k);
      rg.fillStyle = pr.style.borderColor || '#f33';
      rg.fillRect(X(r.left), Y(r.top), r.width * k, r.height * k);
      rg.drawImage(pr, X(r.left + bw), Y(r.top + bw), (r.width - 2 * bw) * k, (r.height - 2 * bw) * k);
      for (const id of ['c-say', 'c-sub']) if (visible($(id))) text($(id));
    }
    rg.fillStyle = '#f33'; rg.beginPath(); rg.arc(RW - 24, 24, 8, 0, Math.PI * 2); rg.fill(); // REC dot
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (!ctx) { setStatus('press Start first, then Record'); return; }
    if (!audioDest) { audioDest = ctx.createMediaStreamDestination(); scope.connect(audioDest); }
    const stream = new MediaStream([...rc.captureStream(30).getVideoTracks(), ...audioDest.stream.getAudioTracks()]);
    const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    mr = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6e6 });
    chunks = [];
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mr.onstop = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
      a.download = `retro-techno-demo-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.webm`;
      a.click();
      setStatus(`saved ${a.download} to Downloads`);
    };
    mr.start(1000);
    frame();
    $('rec').textContent = '■ Stop recording';
  }
  function stop() { cancelAnimationFrame(raf); mr?.stop(); mr = null; $('rec').textContent = '● Record'; }
  return { toggle: () => (mr ? stop() : start()) };
})();
$('rec').onclick = () => recorder.toggle();
