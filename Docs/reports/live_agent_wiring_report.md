# Phase 2 Execution — Step 3: Live Network & State Layers

**Date:** 2025-02-07
**Status:** COMPLETE
**Plan:** `Docs/plans/live_agent_reconstruction_plan_v2.md` — Phases 2c + 2d

---

## Files Created

| File | Lines | Purpose |
|---|---|---|
| `frontend/src/api/liveClient.ts` | 183 | WebSocket client — binary/JSON protocol routing |
| `frontend/src/store/useLiveStore.ts` | 311 | Zustand store — session lifecycle, audio wiring, state management |

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         useLiveStore.connect()                          │
│                                                                         │
│  1. createAudioPlayback(onVolume → set modelVolume)                     │
│  2. createLiveConnection(handlers)                                      │
│  3. createAudioCapture(onPcmChunk, onVolume → set userVolume)           │
│                                                                         │
│  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐    │
│  │ AudioCapture │         │ LiveClient   │         │AudioPlayback │    │
│  │ (16kHz mic)  │         │ (WebSocket)  │         │(24kHz spkr)  │    │
│  │              │         │              │         │              │    │
│  │ onPcmChunk ──┼────────►│ sendAudio()  │         │              │    │
│  │              │  binary  │              │         │              │    │
│  │ onVolume ────┼──► set  │              │         │              │    │
│  │   userVolume │         │ onAudioChunk─┼────────►│ enqueue()    │    │
│  │              │         │              │  binary  │              │    │
│  │              │         │ onTaskUpdate─┼──► set  │ onVolume ────┼──► │
│  │              │         │  currentTask │         │  set model   │    │
│  │              │         │              │         │  Volume      │    │
│  │              │         │ onTranscript─┼──► aggregate + set     │    │
│  │              │         │  messages    │         │              │    │
│  │              │         │              │         │              │    │
│  │              │         │ onTurnCompl──┼──► set isModelSpeaking │    │
│  │              │         │              │    = false             │    │
│  │              │         │              │         │              │    │
│  │              │         │ onInterrupt──┼────────►│ interrupt()  │    │
│  │              │         │              │         │              │    │
│  └──────────────┘         └──────────────┘         └──────────────┘    │
│                                                                         │
│  useLiveStore.disconnect()                                              │
│    capture.stop() → playback.stop() → connection.close()                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## liveClient.ts — Protocol Implementation

### WS URL Derivation
```
VITE_API_URL = "http://localhost:8000/api/v1"
  → replace /^http/ → "ws://localhost:8000/api/v1"
  → append "/voice/live"
  → "ws://localhost:8000/api/v1/voice/live"
```
Same env var pattern as `api/client.ts` (axios base URL).

### Inbound Message Routing

| Frame Type | Check | Handler |
|---|---|---|
| Binary (`ArrayBuffer`) | `event.data instanceof ArrayBuffer` | `handlers.onAudioChunk(data)` |
| Text JSON `task_update` | `msg.type === 'task_update'` | `handlers.onTaskUpdate(msg.data)` |
| Text JSON `transcript` | `msg.type === 'transcript'` | `handlers.onTranscript(msg.source, msg.text, msg.isComplete)` |
| Text JSON `turn_complete` | `msg.type === 'turn_complete'` | `handlers.onTurnComplete()` |
| Text JSON `interrupted` | `msg.type === 'interrupted'` | `handlers.onInterrupted()` |
| Text JSON `error` | `msg.type === 'error'` | `handlers.onError(msg.message)` |

### Outbound Methods

| Method | Frame Type | Content |
|---|---|---|
| `sendAudio(buffer)` | Binary | Raw Int16 PCM ArrayBuffer |
| `sendControl(type)` | Text | `JSON.stringify({ type })` |

### Critical Setting
`ws.binaryType = 'arraybuffer'` — ensures binary frames arrive as `ArrayBuffer`, not `Blob`.

---

## useLiveStore.ts — State Management

### Reactive State (Zustand)

| Field | Type | Purpose | UI Consumer |
|---|---|---|---|
| `connectionState` | `'disconnected' \| 'connecting' \| 'connected' \| 'error'` | WS lifecycle | LiveControls status indicator |
| `error` | `string \| null` | Error display | LiveControls error banner |
| `isStreaming` | `boolean` | Mic active | LiveControls mic indicator |
| `isModelSpeaking` | `boolean` | Playback active | LiveControls model waveform |
| `userVolume` | `number` (0-1) | Mic volume level | LiveControls user waveform |
| `modelVolume` | `number` (0-1) | Speaker volume level | LiveControls model waveform |
| `messages` | `LiveMessage[]` | Transcript history | ChatInterface |
| `currentTask` | `VoiceState` | Task draft fields | TaskDraftCard |

### Non-Reactive Refs (module-level)

| Ref | Type | Reason |
|---|---|---|
| `_connection` | `LiveConnection \| null` | Avoid re-renders on WS instance changes |
| `_capture` | `AudioCapture \| null` | Avoid re-renders on mic instance changes |
| `_playback` | `AudioPlayback \| null` | Avoid re-renders on playback instance changes |
| `_currentUserTranscript` | `string` | Accumulate partial transcripts before commit |
| `_currentModelTranscript` | `string` | Accumulate partial transcripts before commit |

### Transcript Aggregation Logic

Mirrors reference `geminiLiveClient.ts:165-185`:

1. `onTranscript(source, text, isComplete=false)` → accumulate into `_current*Transcript`
2. `onTranscript(source, text, isComplete=true)` → commit to `messages[]`, reset accumulator
3. `onTurnComplete` → safety net: flush any remaining accumulated text
4. `onInterrupted` → clear model transcript accumulator (partial speech discarded)

### connect() Sequence

1. Guard against double-connect
2. `createAudioPlayback(onVolume)` — 24kHz output context
3. `createLiveConnection(handlers)` — WS open, message routing wired
4. Set `connectionState = 'connected'`
5. `createAudioCapture(onPcmChunk, onVolume)` — 16kHz mic, wired to `sendAudio`
6. Set `isStreaming = true`

### disconnect() Sequence

1. `_capture.stop()` — release mic, close input AudioContext
2. `_playback.stop()` — interrupt + close output AudioContext
3. `_connection.close()` — close WebSocket
4. Reset all transcript accumulators
5. Reset reactive state (volumes, flags)

---

## Compatibility with Existing Components

| Component | Standard Agent Source | Live Agent Source | Compatible? |
|---|---|---|---|
| `ChatInterface` | `useVoiceStore.messages` (`Message[]`) | `useLiveStore.messages` (`LiveMessage[]`) | ✅ Same `{role, content}` shape |
| `TaskDraftCard` | `useVoiceStore.currentTask` (`VoiceState`) | `useLiveStore.currentTask` (`VoiceState`) | ✅ Same type |
| `syncToVikunja` | `useVoiceStore.syncToVikunja()` | `useLiveStore.syncToVikunja()` | ✅ Same pattern (dynamic import of `batchApi`) |

---

## Isolation Guarantee

| Constraint | Status |
|---|---|
| No imports from `useVoiceStore` | ✅ |
| No imports from `api/voice.ts` | ✅ |
| No imports from `api/client.ts` | ✅ |
| Existing files unmodified | ✅ |
| No new dependencies | ✅ |

---

## Next Steps

- **Phase 2e:** Create `LiveControls.tsx` + modify `VoiceAgentView.tsx` (mode toggle)
- **Phase 2f:** End-to-end testing
