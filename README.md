# Retro Techno Generator

Your pulse plays 90s acid techno and hardcore. The Presage SmartSpectra SDK reads your pulse, breathing and expressions from a webcam, and a browser page turns them into music with Web Audio. No samples; every sound is synthesised.

The page never shows the camera image. It shows an oscilloscope, a step grid and the numbers.

#### What does what

| Signal | Effect |
| --- | --- |
| Pulse | Tempo is pulse × 2 (100–190 BPM). Under ~70: ambient pads. 70–90: acid techno. Over ~90: early-90s hardcore breaks and piano stabs. |
| Breathing waveform | Opens and closes the master filter, so the track breathes with you. |
| Smile (happy expression) | Opens the 303 acid filter and switches to a major key. |
| Surprise | Fires a hoover synth. |
| Blink | Stutters the drums and tears the visuals. |
| Talking | Pitched-up formant "vocal" chops. |

The mode dropdown overrides the pulse-based style.

#### Run it

Needs Node 20+ on Linux x64/arm64 (glibc 2.35+), macOS Apple Silicon or Windows x64.

```bash
npm install                     # pulls the SDK's native runtimes, ~390 MB
npm run fake                    # no camera, no key: sliders in the page
SMARTSPECTRA_API_KEY=... npm start                      # live camera
SMARTSPECTRA_API_KEY=... node server.js --file me.mp4   # pre-recorded video
```

Open http://localhost:8080 and press Start. Get a free API key at https://physiology.presagetech.com/auth/register.

#### Consent and data

- The camera turns on only after you press Start, and off when you press Stop.
- Video frames go from the camera to the SDK in the Node process. They are never sent to the page, displayed, recorded or written to disk.
- Only numbers (pulse, breathing rate, breathing trace, blink/talk flags, expression scores) cross the local WebSocket to the page. The server listens on 127.0.0.1 only. Nothing is stored.
- SDK telemetry is switched off (`enableTelemetry: false`). The SDK still needs an authenticated session with Presage's servers to measure; see Presage's terms for what that session carries.
- This is a music toy. It makes no health or medical claims.

#### Files

- `server.js`: static server, WebSocket, SmartSpectra session.
- `public/app.js`: synth engine, sequencer, visuals.
- `public/index.html`: consent screen and HUD.

MIT licence for this repo's code. The SmartSpectra SDK has its own licence.
