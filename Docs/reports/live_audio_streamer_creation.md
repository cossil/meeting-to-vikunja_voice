# Phase 2 Execution — Step 2: Live Audio Streamer Creation

**Date:** 2025-02-07
**Status:** COMPLETE
**Plan:** `Docs/plans/live_agent_reconstruction_plan_v2.md` — Phase 2b
**File Created:** `frontend/src/utils/liveAudioStreamer.ts` (268 lines)

---

## Objective

Create a self-contained audio capture & playback engine for the Live Voice Agent, ported from the reference implementation (`full_duplex_voice_agent/`).

---

## PCM Logic Verification — Reference Match

### Float32 → Int16 (Mic Capture)

| Aspect | Reference (`audioUtils.ts:41-48`) | Our Implementation (`liveAudioStreamer.ts:31-38`) | Match? |
|---|---|---|---|
| Clamp | `Math.max(-1, Math.min(1, data[i]))` | `Math.max(-1, Math.min(1, float32Data[i]))` | ✅ |
| Negative | `s * 0x8000` | `s * 0x8000` | ✅ |
| Positive | `s * 0x7FFF` | `s * 0x7fff` | ✅ |
| Output type | `Int16Array` | `Int16Array` | ✅ |

### Int16 → Float32 (Playback)

| Aspect | Reference (`audioUtils.ts:28-36`) | Our Implementation (`liveAudioStreamer.ts:45-52`) | Match? |
|---|---|---|---|
| Division | `dataInt16[i] / 32768.0` | `int16Data[i] / 32768.0` | ✅ |
| Output type | `Float32Array` (via `AudioBuffer.getChannelData`) | `Float32Array` | ✅ |
| Channels | `numChannels` param (1 in practice) | Hardcoded mono (1 channel) | ✅ Simplified |

### Audio Capture Pipeline

| Aspect | Reference (`geminiLiveClient.ts`) | Our Implementation | Match? |
|---|---|---|---|
| Input sample rate | `16000` (:5) | `16000` (:18) | ✅ |
| AudioContext | `new AudioContext({ sampleRate: 16000 })` (:43-45) | Same (:101-103) | ✅ |
| ScriptProcessor buffer | `4096` (:141) | `4096` (:20, :114) | ✅ |
| ScriptProcessor channels | `(4096, 1, 1)` (:141) | `(4096, 1, 1)` (:114-117) | ✅ |
| Volume analyser | `AnalyserNode fftSize=256` (:135-136) | Same (:108-109) | ✅ |
| Volume calc | `avg / 255` (:148) | `sum / (length * 255)` (:61) | ✅ Equivalent |
| Output format | base64 string (SDK wraps) | **ArrayBuffer** (binary WS frame) | ✅ Adapted for proxy |

### Audio Playback Pipeline

| Aspect | Reference (`geminiLiveClient.ts`) | Our Implementation | Match? |
|---|---|---|---|
| Output sample rate | `24000` (:6) | `24000` (:19) | ✅ |
| AudioContext | `new AudioContext({ sampleRate: 24000 })` (:46-48) | Same (:166-168) | ✅ |
| Gapless scheduling | `nextStartTime = Math.max(nextStartTime, ctx.currentTime)` (:190) | Same (:214) | ✅ |
| Duration tracking | `nextStartTime += audioBuffer.duration` (:228) | Same (:216) | ✅ |
| Source tracking | `Set<AudioBufferSourceNode>` (:20) | Same (:171) | ✅ |
| Source cleanup | `'ended'` event → delete from Set (:223-225) | Same (:220-222) | ✅ |
| Volume analyser | Per-source AnalyserNode (:203-207) | Shared AnalyserNode (:174-177) | ✅ Optimized |
| Volume loop | `requestAnimationFrame` (:216) | Same (:185) | ✅ |

### Interrupt Logic

| Aspect | Reference (`geminiLiveClient.ts:233-238`) | Our Implementation (:234-248) | Match? |
|---|---|---|---|
| Stop all sources | `sources.forEach(src => src.stop())` | Same with try/catch | ✅ |
| Clear set | `sources.clear()` | Same | ✅ |
| Reset time | `nextStartTime = 0` | Same | ✅ |

---

## Key Adaptation: Proxy Protocol

The reference sends audio as `{ data: base64, mimeType: 'audio/pcm;rate=16000' }` via the `@google/genai` SDK's `sendRealtimeInput()`. Our Hybrid Proxy architecture differs:

- **Capture output:** Raw `ArrayBuffer` (Int16 PCM bytes) — sent as binary WS frame to backend
- **Playback input:** Raw `ArrayBuffer` (Int16 PCM bytes) — received as binary WS frame from backend
- **No base64 in frontend:** Backend handles base64 encoding/decoding for Gemini

This eliminates the need for `base64ToBytes` and `bytesToBase64` utility functions in the frontend.

---

## Isolation Guarantee

| Constraint | Status |
|---|---|
| No imports from Standard Agent voice modules | ✅ Self-contained |
| Existing `AudioRecorder.tsx` untouched | ✅ |
| No new dependencies added | ✅ |
| No modifications to any existing files | ✅ |

---

## Exports

| Export | Type | Purpose |
|---|---|---|
| `createAudioCapture(onPcmChunk, onVolume)` | `async function → AudioCapture` | Mic → Int16 PCM chunks |
| `createAudioPlayback(onVolume)` | `function → AudioPlayback` | PCM chunks → gapless speaker output |
| `PcmChunkCallback` | type | `(pcmBuffer: ArrayBuffer) => void` |
| `VolumeCallback` | type | `(level: number) => void` |
| `AudioCapture` | interface | `{ stop() }` |
| `AudioPlayback` | interface | `{ enqueue(), interrupt(), stop() }` |

---

## Next Steps

- **Phase 2c:** Create `frontend/src/api/liveClient.ts` (WebSocket client)
- **Phase 2d:** Create `frontend/src/store/useLiveStore.ts` (wires audio + network + state)
