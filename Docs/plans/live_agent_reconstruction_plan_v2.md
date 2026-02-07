# Live Agent Reconstruction Plan — V2 (Hybrid Proxy)

**Date:** 2025-02-07
**Prerequisite:** `Docs/audits/LIVE_AGENT_CURRENT_STATE.md` (approved)
**Reference:** `full_duplex_voice_agent/` (confirmed present in workspace)
**Supersedes:** `Docs/plans/live_agent_reconstruction_plan.md` (V1 — built from first principles, no reference)
**Objective:** Port a functional Live Voice Agent into the V2 architecture using a **Hybrid Proxy** pattern — reference audio logic on the frontend, our backend WebSocket relay to Gemini — with **strict operational isolation** from the Standard Agent.

---

## 0. What Changed from V1

V1 was written without access to the reference implementation and chose **Option A (Client-Side SDK direct to Gemini)**. Now that the reference (`full_duplex_voice_agent/`) is confirmed present, V2 makes a different architectural choice:

| Aspect | V1 Plan | V2 Plan (This Document) |
|---|---|---|
| **Architecture** | Client-Side SDK (browser → Gemini direct) | **Hybrid Proxy** (browser → FastAPI → Gemini) |
| **Audio Logic Source** | Built from Gemini SDK docs | **Ported from reference** `audioUtils.ts` + `geminiLiveClient.ts` |
| **Network Layer** | `@google/genai` SDK in browser | Custom WS client to our backend; backend relays to Gemini |
| **API Key Exposure** | Exposed in browser (accepted trade-off) | **Key stays server-side** (backend holds it) |
| **Backend `live_session.py`** | Deprecated, untouched | **Updated** (model ID, system prompt, sample rate) |
| **Reference Used** | None (first principles) | `full_duplex_voice_agent/` (confirmed) |

---

## 1. Reference Analysis

### 1a. `geminiLiveClient.ts` — Session & Audio Pipeline

**Source:** `full_duplex_voice_agent/services/geminiLiveClient.ts` (240 lines)

#### Key Findings

| Aspect | Reference Implementation | Line(s) |
|---|---|---|
| **SDK** | `@google/genai` — `GoogleGenAI`, `LiveServerMessage`, `Modality` | `:1` |
| **Input Sample Rate** | `16000` Hz (16kHz) | `:5` |
| **Output Sample Rate** | `24000` Hz (24kHz) | `:6` |
| **Voice** | `'Kore'` (prebuilt) | `:8` |
| **Model** | `gemini-2.5-flash-native-audio-preview-09-2025` | `:55` |
| **Response Modality** | `['AUDIO']` (string literal, not Enum) | `:70` |
| **System Instruction** | `Content` object with `parts[].text` (not raw string) | `:75-85` |
| **Transcription** | `inputAudioTranscription: {}`, `outputAudioTranscription: {}` enabled | `:86-87` |
| **Audio Capture** | `ScriptProcessorNode` (legacy, bufferSize=4096, mono) | `:141` |
| **Audio Send** | `session.sendRealtimeInput({ media: pcmBlob })` where `pcmBlob` is `{ data: base64, mimeType: 'audio/pcm;rate=16000' }` | `:156` |
| **Audio Playback** | `AudioBufferSourceNode` with gapless scheduling via `nextStartTime` | `:190-229` |
| **Interruption** | Stops all sources, clears queue, resets `nextStartTime` | `:233-238` |
| **Volume Viz** | `AnalyserNode` (fftSize=256) on both input and output chains | `:135-148`, `:203-220` |
| **Transcript Aggregation** | Accumulates partial transcripts, finalizes on `turnComplete` | `:165-185` |
| **Session Promise** | `ai.live.connect()` returns a Promise; session resolved in `onaudioprocess` callback | `:54, 154-157` |

#### Connection Lifecycle (Reference)

```
1. constructor()     → new GoogleGenAI({ apiKey })
2. connect()         → getUserMedia, create AudioContexts (16kHz in, 24kHz out)
                     → ai.live.connect({ model, callbacks, config }) → sessionPromise
3. handleOpen()      → create MediaStreamSource → ScriptProcessorNode
                     → onaudioprocess: Float32 → Int16 PCM → base64 → sendRealtimeInput
4. handleMessage()   → route: transcription | audio | interruption
5. disconnect()      → session.close(), stop tracks, close contexts, clear sources
```

#### Critical Detail: `sendRealtimeInput` Format

The reference sends audio via:
```typescript
session.sendRealtimeInput({ media: pcmBlob });
// where pcmBlob = { data: base64String, mimeType: 'audio/pcm;rate=16000' }
```

This is the `@google/genai` SDK's `Blob` type (imported from `'@google/genai'`), NOT a browser `Blob`. The SDK internally wraps this into the correct `realtime_input.media_chunks` JSON envelope.

### 1b. `audioUtils.ts` — Audio Format Specification

**Source:** `full_duplex_voice_agent/utils/audioUtils.ts` (53 lines)

#### Functions

| Function | Purpose | Input → Output |
|---|---|---|
| `base64ToBytes(base64)` | Decode base64 to raw bytes | `string` → `Uint8Array` |
| `bytesToBase64(bytes)` | Encode raw bytes to base64 | `Uint8Array` → `string` |
| `decodeAudioData(data, ctx, sampleRate, numChannels)` | Convert raw PCM bytes to playable `AudioBuffer` | `Uint8Array` → `AudioBuffer` |
| `createPcmBlob(data)` | Convert Float32 mic samples to SDK-compatible PCM Blob | `Float32Array` → `{ data: base64, mimeType }` |

#### Audio Format Contract (Extracted from Reference)

**Input (Mic → Gemini):**
```
Float32Array (from AudioContext)
  → Clamp to [-1, 1]
  → Convert: float < 0 ? float * 0x8000 : float * 0x7FFF
  → Int16Array
  → Uint8Array (view of Int16 buffer)
  → base64 string
  → { data: base64, mimeType: 'audio/pcm;rate=16000' }
```

**Output (Gemini → Speaker):**
```
base64 string (from message.serverContent.modelTurn.parts[0].inlineData.data)
  → Uint8Array (via atob + charCodeAt)
  → Int16Array (view of Uint8 buffer)
  → Float32Array: int16[i] / 32768.0
  → AudioBuffer (numChannels=1, sampleRate=24000)
  → AudioBufferSourceNode → destination
```

### 1c. `Waveform.tsx` — Volume Visualization

**Source:** `full_duplex_voice_agent/components/Waveform.tsx` (32 lines)

Simple bar-based visualizer:
- 5 bars, height driven by `level` prop (0-1 normalized)
- Randomized per-bar height: `level * 32 * (Math.random() + 0.5)`
- Tailwind classes, `transition-all duration-75`
- Used for both user mic and model output visualization

**Adaptation:** We will create a similar component or integrate volume data into `LiveControls.tsx` directly.

---

## 2. Backend Analysis: What Needs to Change

**Source:** `backend/app/services/live_session.py` (147 lines)

### 2a. Current Backend Protocol vs Reference

| Aspect | Backend (`live_session.py`) | Reference (`geminiLiveClient.ts`) | Match? |
|---|---|---|---|
| **Audio MIME to Gemini** | `audio/pcm` (no rate) | `audio/pcm;rate=16000` | ⚠️ **MISMATCH** — rate missing |
| **Audio Input from Client** | Raw binary bytes (`data["bytes"]`) | N/A (reference talks direct to Gemini) | ✅ OK for proxy |
| **Audio Output to Client** | Raw bytes via `send_bytes()` | N/A (reference decodes locally) | ✅ OK for proxy |
| **Tool Call to Client** | JSON `{"type": "task_update", "data": args}` | N/A (reference has no tools) | ✅ OK (our addition) |
| **Model ID** | `gemini-2.0-flash-exp` | `gemini-2.5-flash-native-audio-preview-09-2025` | ❌ **STALE** |
| **System Prompt** | Batch-processing prompt from `task_processor.py` | Conversational persona prompt | ❌ **WRONG** |
| **WS Library** | Raw `websockets` | `@google/genai` SDK | ⚠️ Functional but fragile |
| **Transcription Config** | Not configured | `inputAudioTranscription: {}`, `outputAudioTranscription: {}` | ❌ **MISSING** |

### 2b. Required Backend Changes

| # | Change | File | Impact |
|---|---|---|---|
| 1 | Update model ID to `gemini-2.5-flash-native-audio-preview-09-2025` | `live_session.py:36` | Config only |
| 2 | Fix MIME type: `audio/pcm` → `audio/pcm;rate=16000` | `live_session.py:87` | Config only |
| 3 | Replace system prompt with conversational prompt (adapted from `voice_service.py:35-79`) | `live_session.py:46` | New constant |
| 4 | Add `inputAudioTranscription` and `outputAudioTranscription` to setup config | `live_session.py:52-60` | Setup message |
| 5 | Add `responseModalities: ['AUDIO']` to setup config | `live_session.py:52-60` | Setup message |
| 6 | Forward transcription events to client (new message type) | `live_session.py:103-147` | New handler |
| 7 | Handle `interrupted` events from Gemini | `live_session.py:103-147` | New handler |
| 8 | Add `speechConfig` with voice selection to setup | `live_session.py:52-60` | Setup message |

**Note:** We keep the raw `websockets` library for now. Migrating to `google-genai` Python SDK's `client.aio.live.connect()` is a future improvement but not blocking.

---

## 3. Architecture: Hybrid Proxy

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        HYBRID PROXY ARCHITECTURE                            │
│                                                                             │
│  ┌──────────────┐    WS (binary PCM)     ┌──────────────┐    WS (JSON+b64) │
│  │   Browser     │ ─────────────────────► │   FastAPI     │ ───────────────► │
│  │              │                         │   Backend     │                  │
│  │  liveClient  │ ◄───────────────────── │  live_session │ ◄─────────────── │
│  │  .ts         │    WS (bytes + JSON)   │  .py          │    WS (JSON)     │
│  └──────┬───────┘                         └──────────────┘          │       │
│         │                                                     ┌─────┴─────┐ │
│  ┌──────┴───────┐                                             │  Gemini   │ │
│  │ Audio Logic  │                                             │  Live API │ │
│  │ (from ref)   │                                             │  (native  │ │
│  │              │                                             │   audio)  │ │
│  │ ScriptProc   │                                             └───────────┘ │
│  │ → Int16 PCM  │                                                           │
│  │ → send_bytes │                                                           │
│  │              │                                                           │
│  │ recv_bytes   │                                                           │
│  │ → Int16→F32  │                                                           │
│  │ → AudioBuf   │                                                           │
│  │ → playback   │                                                           │
│  └──────────────┘                                                           │
│                                                                             │
│  API Key: SERVER-SIDE ONLY (never exposed to browser)                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why Hybrid Proxy (not Client-Side Direct)

1. **API Key Security:** Key stays on the server. No `VITE_GEMINI_API_KEY` in the browser.
2. **Backend Already Exists:** `live_session.py` is 80% correct — just needs config updates.
3. **Tool Call Interception:** Backend can log, validate, or enrich tool calls before forwarding.
4. **Future-proof:** Server proxy enables auth, rate limiting, session logging without frontend changes.

### Why Port Audio Logic from Reference (not reinvent)

1. **Proven:** The reference's `createPcmBlob` / `decodeAudioData` / `ScriptProcessorNode` pipeline is a working, tested pattern.
2. **Format Match:** The reference's Int16 PCM ↔ Float32 conversion exactly matches what Gemini expects/returns.
3. **Volume Visualization:** The reference's `AnalyserNode` pattern gives us waveform data for free.

### Key Difference from Reference

The reference calls `session.sendRealtimeInput({ media: pcmBlob })` via the `@google/genai` SDK which handles JSON serialization internally. In our Hybrid Proxy:

- **Frontend** sends **raw binary bytes** (Int16 PCM as `ArrayBuffer`) over WebSocket to our backend.
- **Backend** receives bytes, base64-encodes them, wraps in `realtime_input.media_chunks` JSON, sends to Gemini.
- **Backend** receives Gemini's base64 audio, decodes to bytes, sends raw bytes to frontend.
- **Frontend** receives raw bytes, converts to `AudioBuffer`, plays back.

This means the frontend does NOT need `@google/genai` as a dependency. The SDK is only used server-side (implicitly, via raw WS protocol).

---

## 4. Protocol Contract

### 4a. Client → Backend WebSocket Messages

| Message Type | Format | Purpose |
|---|---|---|
| **Audio** | Binary frame (`ArrayBuffer` of Int16 PCM, 16kHz mono) | Streaming mic audio |
| **Control: stop** | Text frame: `{"type": "stop"}` | Request Gemini to stop generating |

### 4b. Backend → Client WebSocket Messages

| Message Type | Format | Purpose |
|---|---|---|
| **Audio** | Binary frame (raw bytes of Int16 PCM, 24kHz mono) | Model audio response |
| **Tool Call** | Text frame: `{"type": "task_update", "data": {...}}` | Task draft update from Gemini |
| **Transcription** | Text frame: `{"type": "transcript", "source": "user"|"model", "text": "...", "isComplete": bool}` | Real-time transcription |
| **Turn Complete** | Text frame: `{"type": "turn_complete"}` | Model finished speaking |
| **Interrupted** | Text frame: `{"type": "interrupted"}` | Model was interrupted by user speech |
| **Error** | Text frame: `{"type": "error", "message": "..."}` | Session error |

### 4c. Audio Format Specification (from Reference `audioUtils.ts`)

| Direction | Sample Rate | Bit Depth | Channels | Encoding | MIME |
|---|---|---|---|---|---|
| **Input** (mic → backend → Gemini) | 16,000 Hz | 16-bit signed int (Int16) | 1 (Mono) | Raw PCM (no WAV header) | `audio/pcm;rate=16000` |
| **Output** (Gemini → backend → speaker) | 24,000 Hz | 16-bit signed int (Int16) | 1 (Mono) | Raw PCM (no WAV header) | N/A (binary frame) |

### 4d. Conversion Functions (Ported from Reference)

**Float32 → Int16 (Mic Capture):**
```typescript
// From audioUtils.ts:41-48
const s = Math.max(-1, Math.min(1, float32Sample));
int16Sample = s < 0 ? s * 0x8000 : s * 0x7FFF;
```

**Int16 → Float32 (Playback):**
```typescript
// From audioUtils.ts:34-36
float32Sample = int16Sample / 32768.0;
```

---

## 5. File Creation Plan (Strict Isolation)

### 5a. New Frontend Files

| # | File | Purpose | Lines (est.) | Ported From |
|---|---|---|---|---|
| 1 | `frontend/src/utils/liveAudioStreamer.ts` | Audio capture (ScriptProcessor → Int16 PCM) + playback (PCM → AudioBuffer → gapless queue) + volume analysis | ~120 | `audioUtils.ts` + `geminiLiveClient.ts:129-230` |
| 2 | `frontend/src/api/liveClient.ts` | WebSocket client to `ws://localhost:8000/api/v1/voice/live`, message routing (binary vs JSON), state machine | ~100 | `geminiLiveClient.ts:41-127` (adapted for proxy) |
| 3 | `frontend/src/store/useLiveStore.ts` | Zustand store: connection state, streaming, transcripts, task draft, volume levels | ~200 | `App.tsx` state logic + `useVoiceStore.ts` patterns |
| 4 | `frontend/src/components/voice/LiveControls.tsx` | Live-specific UI: connect/disconnect, mic status, waveform, error display | ~120 | `App.tsx:84-224` (adapted to our UI style) |

### 5b. Backend Files to Modify

| # | File | Change | Lines Changed (est.) |
|---|---|---|---|
| 5 | `backend/app/services/live_session.py` | Update model ID, MIME type, system prompt, setup config (add responseModalities, speechConfig, transcription), add transcript/interrupt forwarding | ~40 lines changed |

### 5c. Frontend Files to Modify (Minimal, Additive)

| # | File | Change | Impact on Standard Agent |
|---|---|---|---|
| 6 | `frontend/src/views/VoiceAgentView.tsx` | Add mode state, enable "Tempo Real" button, conditionally render `LiveControls` vs `VoiceControls` | **None** — Standard components untouched, conditionally shown |

### 5d. Files NOT Modified (Isolation Guarantee)

| File | Reason |
|---|---|
| `frontend/src/api/voice.ts` | Standard Agent HTTP API — untouched |
| `frontend/src/store/useVoiceStore.ts` | Standard Agent Zustand store — untouched |
| `frontend/src/components/voice/VoiceControls.tsx` | Standard Agent controls — untouched |
| `frontend/src/components/voice/ChatInterface.tsx` | Shared display — reused by Live via compatible message format |
| `frontend/src/components/voice/TaskDraftCard.tsx` | Shared display — reused by Live via compatible `VoiceState` type |
| `backend/app/api/endpoints/live.py` | Endpoint is already correct (`WS /api/v1/voice/live`) — untouched |
| `backend/app/api/endpoints/voice.py` | Standard Agent endpoints — untouched |
| `backend/app/services/voice_service.py` | Standard Agent service — untouched |

---

## 6. Detailed File Specifications

### 6a. `liveAudioStreamer.ts` — Audio Capture & Playback

Ported from: `audioUtils.ts` (all 4 functions) + `geminiLiveClient.ts:129-230` (capture & playback logic).

```
Module: frontend/src/utils/liveAudioStreamer.ts

Constants:
  INPUT_SAMPLE_RATE = 16000
  OUTPUT_SAMPLE_RATE = 24000
  SCRIPT_PROCESSOR_BUFFER_SIZE = 4096  // From reference :141

--- Audio Format Conversion (from audioUtils.ts) ---

  float32ToInt16(float32Data: Float32Array): Int16Array
    - Clamp each sample to [-1, 1]
    - Convert: s < 0 ? s * 0x8000 : s * 0x7FFF
    - Return Int16Array
    (Ported from: audioUtils.ts:41-48, createPcmBlob)

  int16ToFloat32(int16Data: Int16Array): Float32Array
    - Convert: int16[i] / 32768.0
    - Return Float32Array
    (Ported from: audioUtils.ts:28-38, decodeAudioData)

--- Audio Capture ---

  createAudioCapture(onPcmChunk: (pcmBytes: ArrayBuffer) => void, onVolume: (level: number) => void):
    - getUserMedia({ audio: true }) → MediaStream
    - AudioContext({ sampleRate: INPUT_SAMPLE_RATE })  // 16kHz
    - MediaStreamSource → AnalyserNode (fftSize=256) → ScriptProcessorNode(BUFFER_SIZE, 1, 1)
    - onaudioprocess:
        1. Read Float32 from inputBuffer.getChannelData(0)
        2. Compute volume from AnalyserNode (avg of frequencyBinCount / 255)
        3. Convert Float32 → Int16 via float32ToInt16()
        4. Call onPcmChunk(int16Array.buffer)  // Send raw ArrayBuffer
        5. Call onVolume(normalizedLevel)
    - Connect: source → analyser; source → scriptProcessor → destination
    - Return { stop(): void }  // Stops tracks, closes context
    (Ported from: geminiLiveClient.ts:129-162)

--- Audio Playback ---

  createAudioPlayback(onVolume: (level: number) => void):
    - outputContext: AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE })  // 24kHz
    - nextStartTime: number = 0
    - sources: Set<AudioBufferSourceNode>

    enqueue(pcmBytes: ArrayBuffer): void
      1. Wrap as Int16Array view
      2. Convert to Float32 via int16ToFloat32()
      3. Create AudioBuffer(1, frameCount, OUTPUT_SAMPLE_RATE)
      4. copyToChannel(float32Data, 0)
      5. Create AudioBufferSourceNode, connect to AnalyserNode → destination
      6. Schedule: source.start(nextStartTime), nextStartTime += duration
      7. Report volume via AnalyserNode + requestAnimationFrame loop
      8. Track source in Set, remove on 'ended'
      (Ported from: geminiLiveClient.ts:188-230)

    interrupt(): void
      - Stop all sources, clear Set, reset nextStartTime
      (Ported from: geminiLiveClient.ts:233-238)

    stop(): void
      - interrupt() + close outputContext

    Return { enqueue, interrupt, stop }
```

### 6b. `liveClient.ts` — WebSocket Client (Proxy-Adapted)

Unlike the reference (which uses `@google/genai` SDK directly), this connects to **our backend** via a plain WebSocket.

```
Module: frontend/src/api/liveClient.ts

Types:
  LiveMessageHandler:
    onAudioChunk: (pcmBytes: ArrayBuffer) => void
    onTaskUpdate: (data: Record<string, any>) => void
    onTranscript: (source: 'user' | 'model', text: string, isComplete: boolean) => void
    onTurnComplete: () => void
    onInterrupted: () => void
    onError: (message: string) => void
    onClose: () => void

Functions:
  createLiveConnection(handlers: LiveMessageHandler):
    - url = `ws://${window.location.hostname}:8000/api/v1/voice/live`
    - ws = new WebSocket(url)

    ws.binaryType = 'arraybuffer'  // CRITICAL: receive binary as ArrayBuffer, not Blob

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // Binary frame = audio from Gemini
        handlers.onAudioChunk(event.data)
      } else {
        // Text frame = JSON control message
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case 'task_update':   handlers.onTaskUpdate(msg.data); break
          case 'transcript':    handlers.onTranscript(msg.source, msg.text, msg.isComplete); break
          case 'turn_complete': handlers.onTurnComplete(); break
          case 'interrupted':   handlers.onInterrupted(); break
          case 'error':         handlers.onError(msg.message); break
        }
      }
    }

    ws.onclose = () => handlers.onClose()
    ws.onerror = (e) => handlers.onError('WebSocket error')

    sendAudio(pcmBuffer: ArrayBuffer): void
      - ws.send(pcmBuffer)  // Binary frame

    sendControl(type: string): void
      - ws.send(JSON.stringify({ type }))

    close(): void
      - ws.close()

    Return { sendAudio, sendControl, close, ws }

Key Difference from Reference:
  - Reference: session.sendRealtimeInput({ media: { data: base64, mimeType } })
  - Ours: ws.send(arrayBuffer)  // Raw binary, backend handles base64 + JSON wrapping
```

### 6c. `useLiveStore.ts` — Zustand State Management

```
Module: frontend/src/store/useLiveStore.ts

Uses: createAudioCapture, createAudioPlayback from liveAudioStreamer.ts
Uses: createLiveConnection from liveClient.ts
Uses: VoiceState type from types/schema.ts (same as Standard Agent)

State:
  // Connection
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'error'
  error: string | null

  // Audio
  isStreaming: boolean          // Mic active
  isModelSpeaking: boolean      // Playback active
  userVolume: number            // 0-1 normalized
  modelVolume: number           // 0-1 normalized

  // Content
  messages: Message[]           // Reuse Message type from useVoiceStore pattern
  currentTask: VoiceState       // Reuse same type for TaskDraftCard compatibility

  // Internal refs (not reactive, stored via closure or ref)
  _connection: LiveConnection | null
  _capture: AudioCapture | null
  _playback: AudioPlayback | null

Actions:
  connect(): Promise<void>
    1. Set connectionState = 'connecting'
    2. Create playback manager: createAudioPlayback(onVolume → set modelVolume)
    3. Create WS connection: createLiveConnection({
         onAudioChunk → playback.enqueue(bytes), set isModelSpeaking=true
         onTaskUpdate → update currentTask, add agent message
         onTranscript → update/append to messages (partial aggregation like reference App.tsx:43-66)
         onTurnComplete → set isModelSpeaking=false
         onInterrupted → playback.interrupt(), set isModelSpeaking=false
         onError → set error, disconnect
         onClose → set connectionState='disconnected'
       })
    4. Wait for ws.onopen → set connectionState = 'connected'
    5. Start audio capture: createAudioCapture(
         onPcmChunk → connection.sendAudio(buffer)
         onVolume → set userVolume
       )
    6. Set isStreaming = true

  disconnect(): void
    1. _capture?.stop()
    2. _playback?.stop()
    3. _connection?.close()
    4. Reset: connectionState='disconnected', isStreaming=false, isModelSpeaking=false, volumes=0

  reset(): void
    - disconnect() + clear messages, currentTask, error

  // Reuse syncToVikunja pattern from useVoiceStore
  syncToVikunja(): Promise<void>
    - Same logic as useVoiceStore.syncToVikunja (import batchApi, map fields, call syncTasks)
```

### 6d. `LiveControls.tsx` — Live-Specific UI

```
Module: frontend/src/components/voice/LiveControls.tsx

Uses: useLiveStore (NOT useVoiceStore)
Uses: Lucide icons (Phone, PhoneOff, Mic, MicOff, AlertCircle)

Layout: Same footer position as VoiceControls.tsx

UI Elements:
  - Connection button: "Conectar" (green) / "Desconectar" (red)
  - Status indicator: dot (gray=disconnected, yellow=connecting, green=connected, red=error)
  - Waveform bars (5 bars, height driven by userVolume/modelVolume)
    - User waveform: shown when isStreaming && userVolume > 0.05
    - Model waveform: shown when isModelSpeaking && modelVolume > 0.05
  - Status text: "Ouvindo..." / "Assistente falando..." / "Pronto" / error message
  - Error display: red banner with error text + dismiss

Behavior:
  - On mount: nothing (user must click "Conectar")
  - "Conectar" click → useLiveStore.connect()
  - "Desconectar" click → useLiveStore.disconnect()
  - No separate mic toggle — mic starts automatically on connect (like reference)
```

### 6e. `VoiceAgentView.tsx` — Mode Toggle (Minimal Modification)

```
Changes to: frontend/src/views/VoiceAgentView.tsx

  + import { useState } from 'react'
  + import { LiveControls } from '../components/voice/LiveControls'
  + import { useLiveStore } from '../store/useLiveStore'

  + const [mode, setMode] = useState<'standard' | 'live'>('standard')

  - <span>Padrão (Ativo)</span>
  + <button onClick={() => setMode('standard')} className={mode === 'standard' ? 'active' : ''}>Padrão</button>

  - <Button className="opacity-50 cursor-not-allowed">Tempo Real (Em Breve)</Button>
  + <Button onClick={() => setMode('live')} className={mode === 'live' ? 'active' : ''}>Tempo Real</Button>

  Conditional rendering:
  - mode === 'standard': <ChatInterface /> + <VoiceControls /> (existing, untouched)
  - mode === 'live': <ChatInterface /> + <LiveControls />
    (ChatInterface reads from useLiveStore.messages when in live mode — 
     OR we pass messages as props. Decision: pass as props for isolation.)

  TaskDraftCard: reads from useLiveStore.currentTask when mode === 'live'

Impact: VoiceControls.tsx is NOT modified. It is conditionally rendered.
```

---

## 7. Backend Update Specification

### 7a. Updated Setup Message

Current (`live_session.py:52-60`):
```python
setup_msg = {
    "setup": {
        "model": f"models/{self.model}",
        "tools": [update_task_draft_tool],
        "system_instruction": {
            "parts": [{"text": system_instruction}]
        }
    }
}
```

Updated:
```python
setup_msg = {
    "setup": {
        "model": f"models/{self.model}",
        "generation_config": {
            "response_modalities": ["AUDIO"],
            "speech_config": {
                "voice_config": {
                    "prebuilt_voice_config": {
                        "voice_name": "Kore"
                    }
                }
            }
        },
        "tools": [update_task_draft_tool],
        "system_instruction": {
            "parts": [{"text": LIVE_SYSTEM_INSTRUCTION}]
        },
        "input_audio_transcription": {},
        "output_audio_transcription": {}
    }
}
```

### 7b. New System Prompt Constant

Adapted from `voice_service.py:35-79` (conversational), NOT `task_processor.py` (batch):

```python
LIVE_SYSTEM_INSTRUCTION = """
Você é o "Assistente de Tarefas". Sua missão é extrair informações de uma conversa por voz para criar uma "Ficha de Tarefa".
Fale APENAS em Português do Brasil (pt-BR).

**Sua Persona:**
- Humilde, prestativo, ansioso para aprender.
- Use frases como "Desculpe, não entendi...", "Só para confirmar...", "Anotei aqui...".
- NUNCA diga apenas "OK". Sempre reflita o que entendeu.
- Seja CONCISO. Use no máximo 2-3 frases curtas.

**Regras de Negócio:**
1. **The Two-Strike Rule**: Se o usuário fornecer informações pouco claras sobre um campo específico duas vezes, pare de perguntar e marque o campo como "A Revisar".
2. **Escuta Reflexiva**: Resuma brevemente o que já foi coletado.
3. **Golden Record**: Colete: Título, Descrição, Data de Vencimento, Responsável.
4. Use a ferramenta `update_task_draft` para atualizar a ficha sempre que coletar ou atualizar informações.

**Regras para Campos:**
- **Título**: MÁXIMO 6 PALAVRAS. Verbo + Objeto. Sem repetições.
- **Descrição**: Resumo objetivo (Max 150 caracteres).
- **Data de Vencimento**: Formato YYYY-MM-DD.
- **Prioridade**: 1 (Baixa) a 5 (Crítica).

{glossary_rules}
"""
```

### 7c. Updated `google_to_client` — New Event Types

```python
# In addition to existing audio + tool call handling:

# Handle Transcription
input_transcript = server_content.get("inputTranscription")
if input_transcript:
    await client_ws.send_json({
        "type": "transcript",
        "source": "user",
        "text": input_transcript.get("text", ""),
        "isComplete": False
    })

output_transcript = server_content.get("outputTranscription")
if output_transcript:
    await client_ws.send_json({
        "type": "transcript",
        "source": "model",
        "text": output_transcript.get("text", ""),
        "isComplete": False
    })

# Handle Turn Complete
if server_content.get("turnComplete"):
    await client_ws.send_json({"type": "turn_complete"})

# Handle Interruption
if server_content.get("interrupted"):
    await client_ws.send_json({"type": "interrupted"})
```

### 7d. Updated MIME Type

```python
# live_session.py:87
# Before:
"mime_type": "audio/pcm"
# After:
"mime_type": "audio/pcm;rate=16000"
```

---

## 8. Dependency Check

### Frontend (`package.json`)

| Package | Status | Action |
|---|---|---|
| `@google/genai` | **NOT needed** | None — Hybrid Proxy means SDK is only used server-side implicitly via raw WS |
| `react`, `zustand`, `lucide-react` | Already present | None |
| `tailwindcss`, `shadcn/ui` | Already present | None |

**No new frontend dependencies required.** This is a significant advantage of the Hybrid Proxy approach.

### Backend (`requirements.txt`)

| Package | Status | Action |
|---|---|---|
| `websockets` | Already present | None |
| `google-genai` | Already present (used by `voice_service.py`) | None |
| `fastapi`, `uvicorn` | Already present | None |

**No new backend dependencies required.**

---

## 9. Execution Phases

| Phase | Scope | Files | Deliverable | Depends On |
|---|---|---|---|---|
| **Phase 2a** | Backend Updates | `live_session.py` | Updated model, MIME, prompt, setup config, new event forwarding | None |
| **Phase 2b** | Audio Infrastructure | `liveAudioStreamer.ts` | Mic capture → Int16 PCM chunks, PCM playback queue, volume analysis | None |
| **Phase 2c** | Network Layer | `liveClient.ts` | WS client with binary/JSON message routing | None |
| **Phase 2d** | State Management | `useLiveStore.ts` | Full session lifecycle, audio routing, transcript aggregation, task state | 2b, 2c |
| **Phase 2e** | UI Integration | `LiveControls.tsx`, `VoiceAgentView.tsx` (modify) | Mode toggle, live controls, waveform visualization | 2d |
| **Phase 2f** | Testing & Polish | Manual E2E testing, error handling, edge cases | Working Live Agent | 2a-2e |

Phases 2a, 2b, and 2c can be developed in parallel. Phase 2d depends on 2b+2c. Phase 2e depends on 2d.

---

## 10. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **ScriptProcessorNode deprecation** | Medium | Low | Works in all current browsers. Future migration to AudioWorklet is straightforward (same PCM logic, different API surface). Reference uses ScriptProcessor successfully. |
| **Model ID change/deprecation** | Medium | High | Pin in constant. Easy single-line update. Monitor Gemini release notes. |
| **Raw `websockets` protocol mismatch** | Low | High | Backend uses same v1alpha BidiGenerateContent protocol as reference. Setup message format validated against reference. |
| **Binary/JSON mixed WS messages** | Low | Medium | Frontend checks `instanceof ArrayBuffer` (reference pattern). Backend already sends both types. |
| **24kHz playback glitches** | Low | Medium | Reference's gapless scheduling (`nextStartTime`) pattern handles this. Ported directly. |
| **Glossary not in Live prompt** | Certain | Low | Phase 2a: inject glossary into `LIVE_SYSTEM_INSTRUCTION` via `{glossary_rules}` placeholder (same pattern as current code). |
| **Transcription events not in v1alpha** | Low | Medium | Reference enables `inputAudioTranscription: {}`. If v1alpha doesn't support it, gracefully degrade (no transcript, audio-only). |

---

## 11. Success Criteria

1. User clicks "Tempo Real" → mode switches, "Conectar" button appears
2. User clicks "Conectar" → WS connects to backend → backend connects to Gemini → mic starts capturing
3. User speaks → ScriptProcessor captures 16kHz Int16 PCM → sent as binary WS frame → backend base64-encodes → forwards to Gemini
4. Gemini responds with audio → backend decodes base64 → sends raw bytes → frontend converts to AudioBuffer → plays at 24kHz
5. Gemini calls `update_task_draft` tool → backend forwards as JSON → TaskDraftCard updates in real-time
6. Real-time transcription appears in ChatInterface (both user and model)
7. User interrupts → Gemini sends `interrupted` → playback stops immediately
8. User clicks "Desconectar" → session closes cleanly, mic released, WS closed
9. User switches back to "Padrão" → Standard Agent works exactly as before — **zero regression**

---

## 12. Deliverables Summary

| # | File | Action | Est. Lines |
|---|---|---|---|
| 1 | `frontend/src/utils/liveAudioStreamer.ts` | **CREATE** | ~120 |
| 2 | `frontend/src/api/liveClient.ts` | **CREATE** | ~100 |
| 3 | `frontend/src/store/useLiveStore.ts` | **CREATE** | ~200 |
| 4 | `frontend/src/components/voice/LiveControls.tsx` | **CREATE** | ~120 |
| 5 | `backend/app/services/live_session.py` | **MODIFY** | ~40 lines changed |
| 6 | `frontend/src/views/VoiceAgentView.tsx` | **MODIFY** | ~15 lines changed |
| | | **Total new code:** | ~540 lines |
| | | **Total modified:** | ~55 lines |

---

*End of Plan V2. Awaiting approval before implementation.*
