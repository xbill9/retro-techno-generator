// Retro Techno Generator: SmartSpectra signals -> WebSocket -> browser synth.
//
//   SMARTSPECTRA_API_KEY=... node server.js            live camera
//   SMARTSPECTRA_API_KEY=... node server.js --file x.mp4   pre-recorded video
//   node server.js --fake                             no SDK, sliders in the page
//
// Open http://localhost:8080. The camera starts only when you press Start.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8080);
const KEY = process.env.SMARTSPECTRA_API_KEY;
const args = process.argv.slice(2);
const FAKE = args.includes('--fake') || !KEY;
const fileArg = args.indexOf('--file');
const FILE = fileArg >= 0 ? args[fileArg + 1] : null;
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const EXPR = ['unspecified', 'angry', 'contempt', 'disgust', 'fear', 'happy', 'neutral', 'sad', 'surprise'];

const server = http.createServer(async (req, res) => {
  const path = normalize(new URL(req.url, 'http://x').pathname).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC, path === '/' ? 'index.html' : path);
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});

const wss = new WebSocketServer({ server });
const broadcast = (msg) => { const s = JSON.stringify(msg); for (const c of wss.clients) if (c.readyState === 1) c.send(s); };

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'hello', source: FAKE ? 'fake' : FILE ? 'file' : 'camera' }));
  ws.on('message', async (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    try {
      if (msg.type === 'start') await startSdk();
      if (msg.type === 'stop') await stopSdk();
    } catch (e) { broadcast({ type: 'error', message: String(e.message || e) }); }
  });
});

// ---- SmartSpectra -------------------------------------------------------

let sdk = null;
let wasBlinking = false;
const last = (a) => (a && a.length ? a[a.length - 1] : null);

async function startSdk() {
  if (FAKE || sdk) return;
  const S = await import('@smartspectra/node-sdk');
  sdk = new S.SmartSpectraSDK({
    apiKey: KEY,
    requestedMetrics: [...S.breathingMetrics, ...S.cardioMetrics, ...S.faceMetrics],
    enableTelemetry: false,
  });
  sdk.on('metrics', (buf) => onMetrics(S.decodeMetrics(buf)));
  sdk.on('validationStatus', (code, _ts, hint) => broadcast({ type: 'status', code, hint }));
  sdk.on('processingStatus', (status) => broadcast({ type: 'processing', status }));
  sdk.on('error', (code, message) => broadcast({ type: 'error', code, message }));
  if (FILE) sdk.useFile(FILE, { interframeDelayMs: 33 });
  else sdk.useCamera(S.CameraSelection.default);
  sdk.start();
  console.log(FILE ? `measuring from ${FILE}` : 'camera on');
}

async function stopSdk() {
  if (!sdk) return;
  const s = sdk; sdk = null;
  await s.stopAsync();
  await s.destroy();
  console.log('camera off');
}

function onMetrics(m) {
  const out = { type: 'signals' };
  const pulse = last(m.cardio?.pulseRate);
  if (pulse) Object.assign(out, { pulse: pulse.value, pulseConfidence: pulse.confidence, pulseStable: pulse.stable });
  const breath = last(m.breathing?.rate);
  if (breath) out.breath = breath.value;
  if (m.breathing?.upperTrace?.length) out.breathTrace = m.breathing.upperTrace.map((t) => t.value);
  const blinks = m.face?.blinking;
  if (blinks?.length) {
    if (blinks.some((b) => b.detected) && !wasBlinking) out.blink = true;
    wasBlinking = !!last(blinks).detected;
  }
  const talk = last(m.face?.talking);
  if (talk) out.talking = !!talk.detected;
  const expr = last(m.face?.expression);
  if (expr?.scores?.length) {
    out.expr = {};
    for (const s of expr.scores) out.expr[EXPR[s.type] ?? String(s.type).toLowerCase()] = s.confidence;
  }
  broadcast(out);
}

process.on('SIGINT', async () => { await stopSdk().catch(() => {}); process.exit(0); });

server.listen(PORT, '127.0.0.1', () =>
  console.log(`Retro Techno Generator on http://localhost:${PORT} (${FAKE ? 'fake signals' : FILE ? 'video file' : 'live camera'})`));
