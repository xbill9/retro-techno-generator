// Retro Techno Generator: browser side. Everything is synthesised with Web Audio; no samples.

// ---- signals ------------------------------------------------------------

const sig = { pulse: 72, breath: 14, breathLevel: 0.5, smile: 0, surprise: 0, talking: false };
let source = 'camera';
let breathHist = [];
let fakeBreathPhase = 0;

const $ = (id) => document.getElementById(id);
const pct = (v) => Math.min(1, Math.max(0, v / 100)); // SDK expression confidence is a percentage, 0-100

const ws = new WebSocket(`ws://${location.host}`);
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.type === 'hello') { source = m.source; if (source === 'fake') $('fake').style.display = 'flex'; setStatus(`source: ${source}`); }
  if (m.type === 'status') setStatus(m.code === 0 ? 'measuring' : m.hint || `check camera (${m.code})`);
  if (m.type === 'error') setStatus(`error: ${m.message}`);
  if (m.type === 'signals') {
    if (m.pulse > 0) sig.pulse = m.pulse;
    if (m.breath > 0) sig.breath = m.breath;
    if (m.breathTrace) {
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
  const base = 180 + sig.smile * 2200 + sig.breathLevel * 500;
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
      if (s % 4 === 2) hat(t, true); else if (s % 2 === 1) hat(t, false);
      if (s === 4 || s === 12) clap(t);
      const n = this.acidPat[s]; if (n) acid(t, n.note, n.accent, sixteenth);
      if (sig.talking && s % 4 === 3) vox(t);
    } else {
      if (s % 4 === 0) kick(t, true);
      if ([4, 12].includes(s)) snare(t, 0.7);
      if ([7, 9, 15].includes(s)) snare(t, 0.25);
      if (s % 2 === 0) hat(t, s % 4 === 2);
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
    // master filter breathes with you
    master.frequency.setTargetAtTime(1500 + sig.breathLevel * 16000, ctx.currentTime, 0.1);
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
}
draw();

// ---- start / stop -------------------------------------------------------

$('start').onclick = () => {
  $('consent').style.display = 'none';
  engine.start();
  ws.send(JSON.stringify({ type: 'start' }));
};
$('stop').onclick = () => {
  engine.stop();
  ws.send(JSON.stringify({ type: 'stop' }));
  $('consent').style.display = 'grid';
  setStatus('stopped, camera off');
};
