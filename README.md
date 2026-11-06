# Retro Techno Generator

Your pulse plays 90s acid techno and hardcore. The Presage SmartSpectra SDK reads your pulse, breathing and expressions from a webcam, and a browser page turns them into music with Web Audio. No samples; every sound is synthesised.

The page shows an oscilloscope, a step grid, the numbers and a small mirror view of the camera for lining up.

#### What does what

| Signal | Effect |
| --- | --- |
| Pulse | Tempo is pulse × 2 (100–190 BPM). Under ~70: ambient pads. 70–90: acid techno. Over ~90: early-90s hardcore breaks and piano stabs. |
| Movement | Dancing opens the master filter, brightens the acid line and doubles the hi-hats. |
| Breathing waveform | Sways the master filter while you're still. |
| Smile (happy expression) | Opens the 303 acid filter and switches to a major key. |
| Surprise | Fires a hoover synth. |
| Blink | Stutters the drums and tears the visuals. |
| Talking | Pitched-up formant "vocal" chops. |

Pulse and breathing can only be read while you hold still, and dancing moves the music, so the two take turns. The VITALS readout says LIVE while you're still and HELD while you move; held values stay in force until the next still moment. Dance hard, freeze for a few seconds, and the higher pulse pushes the tempo up.

After Start, a mirror view of the camera with a head-and-shoulders outline helps you line up: the border turns green and the instruction underneath reads "✓ Measuring" once you're in position, then it shrinks to a corner thumbnail. The SDK needs your face and upper chest in frame, lit from the front. The **Pixelate** button turns the preview into coarse blocks, enough to line up against the outline without showing a recognisable face, for streaming or recording a demo; the setting is remembered in the browser.

The mode dropdown overrides the pulse-based style.

#### Run it

Needs Node 20+ on Linux x64/arm64 (glibc 2.35+), macOS Apple Silicon or Windows x64.

```bash
npm install                     # pulls the SDK's native runtimes, ~390 MB
npm run fake                    # no camera, no key: sliders in the page
SMARTSPECTRA_API_KEY=... npm start                      # live camera
SMARTSPECTRA_API_KEY=... node server.js --file me.mp4   # pre-recorded video
```

Put the key in `.env` as `SMARTSPECTRA_API_KEY=...` (git ignores it) and `npm start` picks it up. `node server.js --list-cameras` lists cameras; set `CAMERA=<id>` in `.env` to pick one other than the default.

Open http://localhost:8080 and press Start. Get a free API key at https://physiology.presagetech.com/auth/register.

#### Consent and data

- The camera turns on only after you press Start, and off when you press Stop.
- Video frames go from the camera to the SDK in the Node process. A shrunk copy goes to the page as the mirror preview; no frame is recorded or written to disk.
- Numbers (pulse, breathing rate, breathing trace, blink/talk flags, expression scores, a movement level) and a 320×180 mirror preview at about 10 frames a second cross the local WebSocket to the page. The server listens on 127.0.0.1 only. Nothing is recorded or stored.
- The SDK needs a network connection: measurements run inside an authenticated session with Presage's servers, opened with your API key.
- SDK telemetry is switched off (`enableTelemetry: false`). Per Presage's [Telemetry & Privacy](https://smartspectra.presagetech.com/docs/telemetry-and-privacy) page, the SDK then starts no telemetry session and transmits no session summary; even when on, that summary never contains video frames or measured values.
- This is a music toy. It makes no health or medical claims.

#### Files

- `server.js`: static server, WebSocket, SmartSpectra session.
- `public/app.js`: synth engine, sequencer, visuals.
- `public/index.html`: consent screen and HUD.

MIT licence for this repo's code. The SmartSpectra SDK has its own licence.
