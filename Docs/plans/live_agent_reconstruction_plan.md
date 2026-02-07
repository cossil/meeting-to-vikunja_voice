# Live Agent Reconstruction Plan

**Date:** 2025-02-07
**Prerequisite:** `Docs/audits/LIVE_AGENT_CURRENT_STATE.md` (approved)
**Objective:** Port a functional Live Voice Agent into the V2 architecture with **strict operational isolation** — zero modifications to Standard Agent files.

---

## 0. Critical Correction: No Working Reference Exists

The prompt references `full_duplex_voice_agent/` as a working reference. **This directory does not exist** in the workspace (confirmed via filesystem scan and git history). It was never committed.

The `task_assistant/` directory that does exist is a **turn-based** agent (MediaRecorder → Blob → `generateContent` HTTP call → separate TTS call). It has **no WebSocket, no streaming audio, no ScriptProcessorNode, no AudioWorklet**. It is architecturally identical to the Standard Agent, just client-side-only.

**Consequence:** This plan is built from first principles using the official Gemini Live API documentation (`@google/genai` JS SDK + Python `google-genai` SDK), not from reverse-engineering a reference.

---

## 1. Architecture Decision: Client-Side SDK (Direct) vs Server-Side Proxy

### Option A: Client-Side SDK (Browser → Gemini Direct)
```
Browser ──── @google/genai SDK ──── Gemini Live API (WS)
  │              (ai.live.connect)
  │
  └── AudioWorklet (16kHz PCM capture)
  └── AudioContext (24kHz PCM playback)
```

### Option B: Server-Side Proxy (Browser → FastAPI → Gemini)
```
Browser ──── WS ──── FastAPI ──── google-genai SDK ──── Gemini Live API (WS)
  │                    │           (client.aio.live.connect)
  │                    │
  └── AudioWorklet     └── Relay logic
```

### Decision: **Option A — Client-Side SDK**

**Rationale:**
1. **Latency:** Eliminates the backend relay hop. Audio goes directly browser ↔ Gemini.
2. **Simplicity:** No backend WS proxy to maintain. The `@google/genai` SDK handles the WS protocol, setup messages, and serialization internally.
3. **Proven pattern:** The official Gemini SDK samples (`sdk-samples/index.html`) use this exact pattern — AudioWorklet in browser, `ai.live.connect()` direct to Gemini.
4. **Backend `live_session.py` is stale:** Uses raw `websockets` library with deprecated model ID and wrong system prompt. Rewriting it as a proxy adds complexity for no benefit.
5. **API Key handling:** The `@google/genai` SDK is already a dependency in `task_assistant/package.json`. The API key can be injected via `VITE_GEMINI_API_KEY` env var (same pattern as the task_assistant PoC).

**Trade-off acknowledged:** The API key is exposed to the browser. For a production deployment, a server-side proxy with auth would be needed. For our current internal-use V2, client-side is acceptable and dramatically simpler.

**Backend impact:** `live.py` and `live_session.py` become **officially deprecated zombie code**. They will not be modified or deleted in this phase — just documented as superseded.

---

## 2. Protocol Contract

Based on the official Gemini Live API documentation:

### Audio Input (Browser → Gemini)

| Property | Value |
|---|---|
| **Capture method** | `AudioWorklet` (AudioWorkletProcessor) |
| **Sample rate** | **16,000 Hz** (16kHz) |
| **Format** | **Int16 PCM** (16-bit signed integer, little-endian) |
| **Channels** | 1 (Mono) |
| **Chunk size** | 2048 samples (~128ms at 16kHz) |
| **Transport** | `session.sendRealtimeInput({ audio: { data: base64String, mimeType: "audio/pcm;rate=16000" } })` |
| **Encoding** | Base64 string of the Int16Array buffer |

### Audio Output (Gemini → Browser)

| Property | Value |
|---|---|
| **Format** | **Int16 PCM** (16-bit signed integer, little-endian) |
| **Sample rate** | **24,000 Hz** (24kHz) |
| **Channels** | 1 (Mono) |
| **Delivery** | `response.data` — base64-encoded PCM chunks via `onmessage` callback |
| **Playback method** | `AudioContext` + `AudioBufferSourceNode` with scheduled queue |
| **Conversion** | Base64 → Int16Array → Float32Array (÷32768 normalization) → `AudioBuffer` |

### Tool Calls (Gemini → Browser → Gemini)

| Property | Value |
|---|---|
| **Detection** | `response.toolCall.functionCalls[]` in `onmessage` callback |
| **Response** | `session.sendToolResponse({ functionResponses: [{ id, name, response }] })` |
| **Tool name** | `update_task_draft` |
| **Tool schema** | Same as current `live_session.py:13-31` (title, description, assignee, dueDate, priority) |

### Session Lifecycle

| Event | SDK Method |
|---|---|
| **Connect** | `ai.live.connect({ model, callbacks, config })` → returns `Session` |
| **Send audio** | `session.sendRealtimeInput({ audio: { data, mimeType } })` |
| **Send text** | `session.sendClientContent({ turns: "text" })` |
| **Receive** | `callbacks.onmessage(message)` — dispatches audio, text, tool calls |
| **Tool response** | `session.sendToolResponse({ functionResponses })` |
| **Disconnect** | `session.close()` |

---

## 3. Gemini Model Selection

| Model ID | Purpose | Notes |
|---|---|---|
| `gemini-live-2.5-flash-preview` | Live session (text responses) | Standard live model |
| `gemini-2.5-flash-native-audio-preview-12-2025` | Live session (audio responses + tool calling) | Native audio I/O with function calling |

**Selected:** `gemini-2.5-flash-native-audio-preview-12-2025`

This model supports:
- `responseModalities: [Modality.AUDIO]` — native audio output (no separate TTS call needed)
- Function calling (tool declarations in config)
- Real-time audio input via `sendRealtimeInput`

---

## 4. File Creation Plan (Strict Isolation)

### New Files to Create

| # | File | Purpose | Lines (est.) |
|---|---|---|---|
| 1 | `frontend/src/utils/liveAudioWorklet.ts` | AudioWorkletProcessor code (Float32→Int16 PCM conversion, chunked buffering) | ~50 |
| 2 | `frontend/src/utils/liveAudioPlayback.ts` | PCM playback queue (Base64→Float32, AudioContext scheduling) | ~80 |
| 3 | `frontend/src/api/liveClient.ts` | Gemini Live SDK session wrapper (connect, send audio, receive, tool calls) | ~150 |
| 4 | `frontend/src/store/useLiveStore.ts` | Zustand store for live session state (connection, streaming, task drafts) | ~200 |
| 5 | `frontend/src/components/voice/LiveControls.tsx` | Live-specific UI controls (start/stop session, visual indicators) | ~120 |

### Files to Modify (Minimal, Additive Only)

| # | File | Change | Impact on Standard Agent |
|---|---|---|---|
| 6 | `frontend/src/views/VoiceAgentView.tsx` | Enable "Tempo Real" tab button, add mode toggle state, conditionally render `LiveControls` vs `VoiceControls` | **None** — Standard Agent components remain untouched, just conditionally shown |
| 7 | `frontend/package.json` | Add `@google/genai` dependency (if not already present) | **None** — additive only |

### Files NOT Modified (Isolation Guarantee)

| File | Reason |
|---|---|
| `frontend/src/api/voice.ts` | Standard Agent HTTP API — untouched |
| `frontend/src/store/useVoiceStore.ts` | Standard Agent Zustand store — untouched |
| `frontend/src/components/voice/VoiceControls.tsx` | Standard Agent controls — untouched |
| `frontend/src/components/voice/AudioRecorder.tsx` | Zombie code — untouched (separate cleanup task) |
| `frontend/src/components/voice/ChatInterface.tsx` | Shared display component — untouched (Live will reuse it) |
| `frontend/src/components/voice/TaskDraftCard.tsx` | Shared display component — untouched (Live will reuse it) |
| `backend/app/services/live_session.py` | Deprecated — untouched |
| `backend/app/api/endpoints/live.py` | Deprecated — untouched |

---

## 5. Detailed File Specifications

### 5a. `liveAudioWorklet.ts` — Audio Capture Processor

Based on the official Gemini SDK sample `AudioProcessingWorklet`:

```
Purpose: AudioWorkletProcessor that captures mic audio and converts to Int16 PCM chunks.

Class: AudioProcessingWorklet extends AudioWorkletProcessor
- buffer: Int16Array(2048)
- bufferWriteIndex: number

process(inputs):
  - Read Float32 samples from inputs[0][0]
  - Convert each sample: int16Value = float32Value * 32768
  - Write to buffer
  - When buffer full (2048 samples): postMessage({ int16arrayBuffer })
  - Return true (keep processing)

Export: String containing the worklet source code (to be loaded via Blob URL)

Audio constraints:
  - AudioContext sampleRate: 16000
  - Chunk size: 2048 samples (~128ms)
  - Output: Int16Array buffer posted via MessagePort
```

### 5b. `liveAudioPlayback.ts` — Audio Playback Queue

Based on the official Gemini SDK sample `playAudioData`:

```
Purpose: Queue-based PCM playback using Web Audio API.

Functions:
  base64ToFloat32(base64: string): Float32Array
    - atob → Uint8Array → Int16 pairs → Float32 (÷32768)

  createPlaybackManager():
    - audioCtx: AudioContext | null
    - queue: Float32Array[]
    - nextStartTime: number
    - isProcessing: boolean

    enqueue(base64Chunk: string): void
      - Convert to Float32, push to queue
      - If not processing, start drain loop

    drain(): void
      - While queue has items:
        - Create AudioBuffer (1 channel, chunk.length, 24000)
        - copyToChannel(chunk, 0)
        - Create AudioBufferSourceNode, connect to destination
        - Schedule at nextStartTime (gapless)
        - nextStartTime += buffer.duration

    stop(): void
      - Close AudioContext, clear queue

Audio constraints:
  - Playback sampleRate: 24000 (Gemini output rate)
  - Gapless scheduling via nextStartTime tracking
```

### 5c. `liveClient.ts` — Gemini Live SDK Wrapper

```
Purpose: Encapsulate @google/genai Live API session management.

Dependencies: @google/genai (GoogleGenAI, Modality)

Types:
  LiveSessionCallbacks:
    onAudioChunk: (base64: string) => void
    onToolCall: (name: string, args: Record<string, any>, id: string) => void
    onTurnComplete: () => void
    onError: (error: Error) => void
    onClose: () => void

Functions:
  createLiveSession(apiKey: string, callbacks: LiveSessionCallbacks):
    - const ai = new GoogleGenAI({ apiKey })
    - const model = "gemini-2.5-flash-native-audio-preview-12-2025"
    - const config = {
        responseModalities: [Modality.AUDIO],
        systemInstruction: LIVE_SYSTEM_INSTRUCTION,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
        tools: [{ functionDeclarations: [updateTaskDraftTool] }]
      }
    - session = await ai.live.connect({ model, config, callbacks: {
        onopen: () => ...,
        onmessage: (msg) => {
          if (msg.data) callbacks.onAudioChunk(msg.data)
          if (msg.toolCall) → for each fc: callbacks.onToolCall(fc.name, fc.args, fc.id)
          if (msg.serverContent?.turnComplete) callbacks.onTurnComplete()
        },
        onerror: (e) => callbacks.onError(e),
        onclose: () => callbacks.onClose()
      }})
    - Return { session, sendAudio, sendText, sendToolResponse, close }

  sendAudio(session, base64Pcm: string):
    - session.sendRealtimeInput({ audio: { data: base64Pcm, mimeType: "audio/pcm;rate=16000" } })

  sendText(session, text: string):
    - session.sendClientContent({ turns: text })

  sendToolResponse(session, id: string, name: string, result: object):
    - session.sendToolResponse({ functionResponses: [{ id, name, response: result }] })

Constants (in same file or imported):
  LIVE_SYSTEM_INSTRUCTION: string — Conversational agent prompt (adapted from Standard Agent's
    voice_service.py SYSTEM_INSTRUCTION, NOT the batch-processing prompt from task_processor.py)

  updateTaskDraftTool: FunctionDeclaration — Same schema as live_session.py:13-31
```

### 5d. `useLiveStore.ts` — Zustand State Management

```
Purpose: Independent Zustand store for Live Agent state.

State:
  isConnected: boolean
  isStreaming: boolean (mic active)
  isModelSpeaking: boolean
  error: string | null
  messages: Message[] (reuse same Message type from useVoiceStore or shared types)
  currentTask: VoiceState (reuse same type)

  // Internal refs (not reactive)
  _session: LiveSession | null
  _audioWorkletNode: AudioWorkletNode | null
  _mediaStream: MediaStream | null
  _playbackManager: PlaybackManager | null

Actions:
  connectSession(): Promise<void>
    - Create playback manager
    - Create live session via liveClient.createLiveSession()
    - Set isConnected = true

  startStreaming(): Promise<void>
    - getUserMedia({ audio: true })
    - Create AudioContext({ sampleRate: 16000 })
    - Load AudioWorklet via Blob URL
    - Connect: mediaStream → AudioWorkletNode
    - workletNode.port.onmessage → arrayBufferToBase64 → sendAudio(session, base64)
    - Set isStreaming = true

  stopStreaming(): void
    - Disconnect worklet, stop media tracks
    - Set isStreaming = false

  disconnect(): void
    - Stop streaming, close session, stop playback
    - Set isConnected = false

  handleAudioChunk(base64: string): void
    - playbackManager.enqueue(base64)
    - Set isModelSpeaking = true

  handleToolCall(name: string, args: object, id: string): void
    - If name === "update_task_draft": update currentTask with args
    - Add agent message to messages
    - sendToolResponse(session, id, name, { status: "ok" })

  handleTurnComplete(): void
    - Set isModelSpeaking = false

  handleError(error: Error): void
    - Set error = error.message, disconnect

  reset(): void
    - Disconnect, clear all state
```

### 5e. `LiveControls.tsx` — Live-Specific UI

```
Purpose: Controls for the Live Agent mode (distinct from VoiceControls.tsx).

Uses: useLiveStore (NOT useVoiceStore)

UI Elements:
  - Connection status indicator (dot: gray/green/red)
  - "Conectar" / "Desconectar" button (session lifecycle)
  - "Falar" / "Parar" button (mic streaming toggle) — only enabled when connected
  - Visual audio level indicator (optional, phase 2)
  - Error display

Layout: Same footer position as VoiceControls, swapped in by VoiceAgentView based on active mode.
```

### 5f. `VoiceAgentView.tsx` — Mode Toggle (Minimal Modification)

```
Changes:
  - Add state: const [mode, setMode] = useState<'standard' | 'live'>('standard')
  - Enable the "Tempo Real" button: add onClick={() => setMode('live')}
  - Conditionally render:
    - mode === 'standard': <VoiceControls /> + useVoiceStore init
    - mode === 'live': <LiveControls /> + useLiveStore
  - ChatInterface and TaskDraftCard remain shared (both stores use compatible Message/VoiceState types)

Impact: VoiceControls.tsx is NOT modified. It is simply conditionally rendered.
```

---

## 6. System Prompt for Live Agent

The Live Agent needs a **conversational** system prompt (like the Standard Agent's `voice_service.py:35-79`), NOT the batch-processing prompt from `task_processor.py`. The prompt will be defined as a constant in `liveClient.ts`:

```
Key differences from Standard Agent prompt:
- No JSON output format (the model uses tool calls instead of structured JSON)
- Explicit instruction to use the update_task_draft tool
- Same persona rules (Humilde, prestativo...)
- Same Two-Strike Rule
- Same Golden Record fields
- Same title/description constraints
- Glossary rules injected (fetched from backend at session start, or hardcoded initially)
```

A `GET /api/v1/voice/glossary` endpoint may be needed to fetch glossary rules for the frontend. This is a minor backend addition that does NOT touch existing endpoints.

---

## 7. Dependency Check

### Frontend (`package.json`)

| Package | Status | Action |
|---|---|---|
| `@google/genai` | Not in `frontend/package.json` (only in `task_assistant/package.json`) | **Add** `^1.39.0` |
| `react`, `zustand`, `lucide-react` | Already present | None |
| `tailwindcss`, `shadcn/ui` | Already present | None |

### Backend

No new backend dependencies. The existing `live.py` and `live_session.py` are left untouched (deprecated in place).

---

## 8. Execution Phases

| Phase | Scope | Files | Deliverable |
|---|---|---|---|
| **Phase 2a** | Audio Infrastructure | `liveAudioWorklet.ts`, `liveAudioPlayback.ts` | Mic capture → PCM chunks, PCM playback queue |
| **Phase 2b** | Network Layer | `liveClient.ts` | Gemini Live SDK wrapper with tool call handling |
| **Phase 2c** | State Management | `useLiveStore.ts` | Full session lifecycle, audio routing, task state |
| **Phase 2d** | UI Integration | `LiveControls.tsx`, `VoiceAgentView.tsx` (modify) | Mode toggle, live controls, end-to-end flow |
| **Phase 2e** | Testing & Polish | Manual testing, error handling, edge cases | Working Live Agent |

Each phase builds on the previous. Phases 2a and 2b can be developed in parallel.

---

## 9. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **API key exposure in browser** | Certain | Medium (internal tool) | Accept for V2. Document. Plan server proxy for V3. |
| **`@google/genai` browser WS compatibility** | Low | High | SDK officially supports browser. Fallback: raw WS to Gemini endpoint. |
| **Model ID deprecation** | Medium | High | Use latest documented model. Pin version in constants. Easy to update. |
| **AudioWorklet not supported in old browsers** | Low | Medium | Target Chrome 66+. Add feature detection with error message. |
| **CORS/CSP blocking WS to Google** | Low | Medium | SDK handles this. Vite dev server has no restrictive CSP. |
| **Glossary not available client-side** | Certain | Low | Phase 1: hardcode glossary in prompt. Phase 2: add GET endpoint. |

---

## 10. Success Criteria

1. User clicks "Tempo Real" → session connects to Gemini Live API
2. User speaks → AudioWorklet captures 16kHz Int16 PCM → sent as base64 via SDK
3. Gemini responds with audio → PCM chunks played back at 24kHz via AudioContext
4. Gemini calls `update_task_draft` tool → TaskDraftCard updates in real-time
5. User clicks "Desconectar" → session closes cleanly, mic released
6. Standard Agent ("Padrão") continues to work exactly as before — zero regression

---

*End of Plan. Awaiting approval before implementation.*
